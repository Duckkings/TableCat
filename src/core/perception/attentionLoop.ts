import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { powerMonitor } from "electron";
import { AppConfig } from "../config";
import { logError, logInfo } from "../logger";
import { PerceptionInput } from "../../shared/types";
import {
  AttentionThresholds,
  AttentionUiState,
  FrameAnalysisSnapshot,
  MomentCandidate,
  TriggerQueueConfig
} from "./attentionTypes";
import {
  buildFrameSnapshot,
  buildRoiProposal,
  computeClusterScore,
  computeHashDistance,
  computeVisualDelta
} from "./frameGate";
import { buildMomentScores, computeUserIdleScore } from "./momentScore";
import {
  CapturedScreenImage,
  captureScreenImage,
  captureScreenPerceptionInput,
  cropImageToPngBuffer,
  savePngBuffer
} from "./screenCapture";
import { TriggerQueue } from "./triggerQueue";

export interface AttentionLoopCallbacks {
  onDebugState: (state: AttentionUiState) => void;
  onTrigger: (input: PerceptionInput) => Promise<void>;
}

interface AttentionLoopDirs {
  root: string;
  events: string;
  frames: string;
  roi: string;
  metrics: string;
}

export class ScreenAttentionLoop {
  private readonly sessionId = buildSessionId(new Date());
  private readonly dirs: AttentionLoopDirs;
  private readonly triggerQueue: TriggerQueue;
  private timer: NodeJS.Timeout | null = null;
  private runningTick = false;
  private previousFrame: FrameAnalysisSnapshot | null = null;
  private tickCount = 0;
  private triggerCount = 0;
  private cooldownCount = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly callbacks: AttentionLoopCallbacks
  ) {
    const root = path.join(process.cwd(), "LOG", "screen-attention", this.sessionId);
    this.dirs = {
      root,
      events: path.join(root, "events"),
      frames: path.join(root, "frames"),
      roi: path.join(root, "roi"),
      metrics: path.join(root, "metrics")
    };
    ensureDir(this.dirs.events);
    ensureDir(this.dirs.frames);
    ensureDir(this.dirs.roi);
    ensureDir(this.dirs.metrics);
    this.triggerQueue = new TriggerQueue(buildTriggerQueueConfig(config));
  }

  start(): void {
    if (this.timer) {
      return;
    }
    const tickMs = normalizeInteger(this.config.screen_gate_tick_ms, 500);
    this.callbacks.onDebugState(buildIdleState(true));
    this.timer = setInterval(() => {
      void this.runTick();
    }, tickMs);
    logInfo(`Screen attention loop started tick=${tickMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.runningTick = false;
    this.previousFrame = null;
    this.callbacks.onDebugState(buildIdleState(false));
    void this.writeMetrics();
    logInfo("Screen attention loop stopped");
  }

  private async runTick(): Promise<void> {
    if (this.runningTick) {
      return;
    }
    this.runningTick = true;

    try {
      const capture = await captureScreenImage({
        width: normalizeInteger(this.config.screen_thumb_width, 160),
        height: normalizeInteger(this.config.screen_thumb_height, 90)
      });
      const now = capture.capturedAt;
      const snapshot = buildFrameSnapshot(capture.bitmapBuffer, capture.width, capture.height);
      const thresholds = buildThresholds(this.config);
      const visualDelta = computeVisualDelta(this.previousFrame, snapshot);
      const hashDistance = computeHashDistance(this.previousFrame, snapshot);
      const clusterScore = computeClusterScore(this.previousFrame, snapshot);
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const userIdleScore = computeUserIdleScore(idleSeconds);
      const cooldownOk = this.triggerQueue.peekCooldown(now.getTime());
      const inputIntensity = 0;

      const l0Reasons = collectL0Reasons(
        this.previousFrame,
        visualDelta,
        hashDistance,
        inputIntensity,
        cooldownOk,
        thresholds
      );
      const l0Pass = l0Reasons.length === 0;

      const l1Reasons = collectL1Reasons(l0Pass, clusterScore, userIdleScore, thresholds);
      const l1Pass = l1Reasons.length === 0;

      const roi = buildRoiProposal(this.previousFrame, snapshot, capture.width, capture.height);
      const signature = buildSignature(snapshot, roi);
      const noveltyScore = this.triggerQueue.getNoveltyScore(signature);
      const scores = buildMomentScores({
        visualDelta,
        hashDistance,
        clusterScore,
        userIdleScore,
        cooldownOk,
        noveltyScore
      });

      let decision: "idle" | "drop" | "cooldown" | "trigger" = "drop";
      let reasons = [...l0Reasons, ...l1Reasons];

      if (!this.previousFrame) {
        decision = "idle";
        reasons = ["baseline_pending"];
      } else if (l0Pass && l1Pass) {
        const queueResult = this.triggerQueue.decide({
          nowMs: now.getTime(),
          finalScore: scores.finalScore,
          triggerThreshold: thresholds.triggerThreshold,
          signature,
          userIdleScore
        });
        decision = queueResult.decision;
        reasons = queueResult.reasons;
      }

      const candidate: MomentCandidate = {
        ts: now.toISOString(),
        l0: {
          visualDelta,
          hashDistance,
          inputIntensity,
          cooldownOk,
          pass: l0Pass,
          reasons: l0Reasons
        },
        l1: {
          foregroundChanged: false,
          clusterScore,
          userIdleScore,
          audioPeakScore: 0,
          pass: l1Pass,
          reasons: l1Reasons
        },
        roi,
        scores,
        signature,
        decision,
        reasons
      };

      this.tickCount += 1;
      if (decision === "trigger") {
        this.triggerCount += 1;
      }
      if (decision === "cooldown") {
        this.cooldownCount += 1;
      }

      await this.writeEvent(candidate, capture);
      this.callbacks.onDebugState(toUiState(candidate));

      if (decision === "trigger") {
        try {
          const input = await captureScreenPerceptionInput();
          await this.callbacks.onTrigger(input);
        } catch (error) {
          logError("Screen attention trigger failed", error);
        }
      }

      this.previousFrame = snapshot;
      await this.writeMetrics();
    } catch (error) {
      logError("Screen attention tick failed", error);
      this.callbacks.onDebugState({
        ...buildIdleState(true),
        decision: "drop",
        reasons: ["tick_failed"]
      });
    } finally {
      this.runningTick = false;
    }
  }

  private async writeEvent(
    candidate: MomentCandidate,
    capture: CapturedScreenImage
  ): Promise<void> {
    const stamp = candidate.ts.replace(/[:.]/g, "-");
    const eventPath = path.join(this.dirs.events, `${stamp}.json`);
    const payload = {
      ts: candidate.ts,
      l0: candidate.l0,
      l1: candidate.l1,
      roi: candidate.roi,
      score: candidate.scores,
      cooldown: {
        cooldownOk: candidate.l0.cooldownOk
      },
      decision: candidate.decision,
      reasons: candidate.reasons
    };
    writeFileSync(eventPath, JSON.stringify(payload, null, 2), "utf8");

    if (this.config.screen_debug_save_gate_frames === false) {
      return;
    }

    const framePath = path.join(this.dirs.frames, `${stamp}.png`);
    savePngBuffer(framePath, capture.pngBuffer);

    candidate.roi.boxes.forEach((box, index) => {
      const roiPath = path.join(this.dirs.roi, `${stamp}_${index + 1}.png`);
      savePngBuffer(roiPath, cropImageToPngBuffer(capture, box));
    });
  }

  private async writeMetrics(): Promise<void> {
    const metricsPath = path.join(this.dirs.metrics, "summary.json");
    const payload = {
      sessionId: this.sessionId,
      tickCount: this.tickCount,
      triggerCount: this.triggerCount,
      cooldownCount: this.cooldownCount
    };
    writeFileSync(metricsPath, JSON.stringify(payload, null, 2), "utf8");
  }
}

function buildThresholds(config: AppConfig): AttentionThresholds {
  return {
    l0VisualDeltaThreshold: normalizeNumber(config.screen_l0_visual_delta_threshold, 0.18),
    l0HashDistanceThreshold: normalizeInteger(config.screen_l0_hash_distance_threshold, 6),
    l0InputIntensityThreshold: normalizeNumber(config.screen_l0_input_intensity_threshold, 0.1),
    l1ClusterThreshold: normalizeNumber(config.screen_l1_cluster_threshold, 0.25),
    triggerThreshold: normalizeNumber(config.screen_trigger_threshold, 0.35)
  };
}

function buildTriggerQueueConfig(config: AppConfig): TriggerQueueConfig {
  return {
    globalCooldownMs: normalizeInteger(config.screen_global_cooldown_sec, 45) * 1000,
    sameTopicCooldownMs: normalizeInteger(config.screen_same_topic_cooldown_sec, 120) * 1000,
    busyCooldownMs: normalizeInteger(config.screen_busy_cooldown_sec, 180) * 1000,
    recentCacheSize: normalizeInteger(config.screen_recent_cache_size, 30)
  };
}

function buildIdleState(active: boolean): AttentionUiState {
  return {
    ts: new Date().toISOString(),
    active,
    finalScore: 0,
    excitementScore: 0,
    interruptScore: 0,
    noveltyScore: 0,
    visualDelta: 0,
    hashDistance: 0,
    clusterScore: 0,
    l0Pass: false,
    l1Pass: false,
    decision: "idle",
    reasons: active ? ["waiting_for_frame"] : ["attention_disabled"]
  };
}

function toUiState(candidate: MomentCandidate): AttentionUiState {
  return {
    ts: candidate.ts,
    active: true,
    finalScore: candidate.scores.finalScore,
    excitementScore: candidate.scores.excitementScore,
    interruptScore: candidate.scores.interruptScore,
    noveltyScore: candidate.scores.noveltyScore,
    visualDelta: candidate.l0.visualDelta,
    hashDistance: candidate.l0.hashDistance,
    clusterScore: candidate.l1.clusterScore,
    l0Pass: candidate.l0.pass,
    l1Pass: candidate.l1.pass,
    decision: candidate.decision,
    reasons: candidate.reasons
  };
}

function collectL0Reasons(
  previousFrame: FrameAnalysisSnapshot | null,
  visualDelta: number,
  hashDistance: number,
  inputIntensity: number,
  cooldownOk: boolean,
  thresholds: AttentionThresholds
): string[] {
  const reasons: string[] = [];
  if (!previousFrame) {
    reasons.push("baseline_pending");
    return reasons;
  }
  if (!cooldownOk) {
    reasons.push("global_cooldown");
  }
  if (
    visualDelta < thresholds.l0VisualDeltaThreshold &&
    hashDistance < thresholds.l0HashDistanceThreshold &&
    inputIntensity < thresholds.l0InputIntensityThreshold
  ) {
    reasons.push("l0_not_salient");
  }
  return reasons;
}

function collectL1Reasons(
  l0Pass: boolean,
  clusterScore: number,
  userIdleScore: number,
  thresholds: AttentionThresholds
): string[] {
  if (!l0Pass) {
    return ["l0_blocked"];
  }
  if (clusterScore >= thresholds.l1ClusterThreshold || userIdleScore >= 0.35) {
    return [];
  }
  return ["l1_not_worthy"];
}

function buildSignature(snapshot: FrameAnalysisSnapshot, candidate: MomentCandidate["roi"]): string {
  const roiSignature = candidate.boxes
    .map((box) => `${box.x},${box.y},${box.width},${box.height}`)
    .join("|");
  return `${snapshot.signatureBits}:${roiSignature}`;
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function normalizeNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function ensureDir(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
}

function buildSessionId(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") +
    "_" +
    [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join("-");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
