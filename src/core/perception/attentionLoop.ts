import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { nativeImage, powerMonitor, shell } from "electron";
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
import { getForegroundWindowInfo } from "./foregroundWindow";
import { buildMomentScores, computeUserIdleScore } from "./momentScore";
import {
  CapturedScreenImage,
  capturePrimaryDisplayImage,
  captureScreenImage,
  cropImageToPngBuffer,
  savePngBuffer
} from "./screenCapture";
import { TriggerQueue } from "./triggerQueue";

export interface AttentionLoopCallbacks {
  onDebugState: (state: AttentionUiState) => void;
  onTrigger: (input: PerceptionInput) => Promise<void>;
  getResponseState?: () => {
    active: boolean;
    interruptible: boolean;
    score: number;
    phase: "idle" | "inflight" | "bubble";
  };
}

interface AttentionLoopDirs {
  root: string;
  events: string;
  frames: string;
  roi: string;
  llm: string;
  metrics: string;
}

interface CaptureHistoryItem {
  atMs: number;
  capture: CapturedScreenImage;
  llmCapture: CapturedScreenImage | null;
}

export class ScreenAttentionLoop {
  private readonly sessionId = buildSessionId(new Date());
  private readonly dirs: AttentionLoopDirs;
  private readonly triggerQueue: TriggerQueue;
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private runningTick = false;
  private previousFrame: FrameAnalysisSnapshot | null = null;
  private captureHistory: CaptureHistoryItem[] = [];
  private previousForegroundKey = "";
  private lastResolvedTickMs = 0;
  private lastTickCompletedAtMs = 0;
  private lastTickDurationMs = 0;
  private tickDurationTotalMs = 0;
  private overrunCount = 0;
  private companionTriggerCount = 0;
  private lastCompanionAtMs = 0;
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
      llm: path.join(root, "llm"),
      metrics: path.join(root, "metrics")
    };
    ensureDir(this.dirs.events);
    ensureDir(this.dirs.frames);
    ensureDir(this.dirs.roi);
    ensureDir(this.dirs.llm);
    ensureDir(this.dirs.metrics);
    this.triggerQueue = new TriggerQueue(buildTriggerQueueConfig(config));
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const tickMs = getBaseTickMs(this.config);
    this.callbacks.onDebugState(buildIdleState(true, this.config));
    this.scheduleNextTick(tickMs);
    logInfo(`Screen attention loop started tick=${tickMs}ms`);
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.runningTick = false;
    this.previousFrame = null;
    this.captureHistory = [];
    this.callbacks.onDebugState(buildIdleState(false, this.config));
    void this.writeMetrics();
    logInfo("Screen attention loop stopped");
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.started) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runTick();
    }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (this.runningTick) {
      this.overrunCount += 1;
      return;
    }
    this.runningTick = true;
    const tickStartedAtMs = Date.now();

    try {
      const capture = await captureScreenImage({
        width: normalizeInteger(this.config.screen_thumb_width, 160),
        height: normalizeInteger(this.config.screen_thumb_height, 90)
      });
      const llmCapture = await capturePrimaryDisplayImage();
      const now = capture.capturedAt;
      const snapshot = buildFrameSnapshot(capture.bitmapBuffer, capture.width, capture.height);
      this.captureHistory.push({ atMs: now.getTime(), capture, llmCapture });
      this.captureHistory = this.captureHistory.slice(-12);
      const thresholds = buildThresholds(this.config);
      const visualDelta = computeVisualDelta(this.previousFrame, snapshot);
      const hashDistance = computeHashDistance(this.previousFrame, snapshot);
      const clusterScore = computeClusterScore(this.previousFrame, snapshot);
      const idleSeconds = powerMonitor.getSystemIdleTime();
      const userIdleScore = computeUserIdleScore(idleSeconds);
      const cooldownOk = this.triggerQueue.peekCooldown(now.getTime());
      const foreground = await getForegroundWindowInfo(now.getTime());
      const foregroundKey = foreground
        ? `${foreground.processName}::${foreground.title}`
        : "";
      const foregroundChanged = this.previousForegroundKey !== "" && foregroundKey !== "" && foregroundKey !== this.previousForegroundKey;
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

      const l1Reasons = collectL1Reasons(
        l0Pass,
        clusterScore,
        userIdleScore,
        foregroundChanged,
        thresholds
      );
      const l1Pass = l1Reasons.length === 0;

      const roi = buildRoiProposal(this.previousFrame, snapshot, capture.width, capture.height);
      const signature = buildSignature(snapshot, roi, foreground?.processName, foreground?.title);
      const noveltyScore = this.triggerQueue.getNoveltyScore(signature);
      const scores = buildMomentScores({
        visualDelta,
        hashDistance,
        clusterScore: foregroundChanged ? Math.max(clusterScore, thresholds.l1ClusterThreshold) : clusterScore,
        userIdleScore,
        cooldownOk,
        noveltyScore
      });

      let decision: "idle" | "drop" | "cooldown" | "trigger" = "drop";
      let reasons = [...l0Reasons, ...l1Reasons];
      let cooldownRemainingMs = this.triggerQueue.getGlobalCooldownRemainingMs(now.getTime());
      const responseState = this.callbacks.getResponseState?.() ?? {
        active: false,
        interruptible: false,
        score: 0,
        phase: "idle" as const
      };

      if (!this.previousFrame) {
        decision = "idle";
        reasons = ["baseline_pending"];
      } else if (l0Pass && l1Pass) {
        const queueResult = this.triggerQueue.decide({
          nowMs: now.getTime(),
          finalScore: scores.finalScore,
          triggerThreshold: thresholds.triggerThreshold,
          signature,
          userIdleScore,
          interruptActiveResponse: responseState.active && responseState.interruptible,
          currentResponseScore: responseState.score
        });
        decision = queueResult.decision;
        reasons = queueResult.reasons;
        cooldownRemainingMs = queueResult.cooldownRemainingMs ?? 0;
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
          foregroundChanged,
          foregroundTitle: foreground?.title,
          foregroundProcessName: foreground?.processName,
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
      this.callbacks.onDebugState(
        toUiState(candidate, this.config, {
          actualSampleIntervalMs: this.lastTickCompletedAtMs > 0 ? tickStartedAtMs - this.lastTickCompletedAtMs : undefined,
          tickDurationMs: Date.now() - tickStartedAtMs,
          cooldownRemainingMs,
          lastTriggerAt: this.triggerQueue.getLastTriggerAtMs() > 0
            ? new Date(this.triggerQueue.getLastTriggerAtMs()).toISOString()
            : undefined,
          currentResponseScore: responseState.score,
          responseActive: responseState.active,
          responsePhase: responseState.phase
        })
      );

      const companionReady = this.shouldTriggerCompanion(now.getTime(), visualDelta, hashDistance, clusterScore, userIdleScore);

      this.previousFrame = snapshot;
      this.previousForegroundKey = foregroundKey || this.previousForegroundKey;
      this.lastTickDurationMs = Date.now() - tickStartedAtMs;
      this.tickDurationTotalMs += this.lastTickDurationMs;
      const resolvedTickMs = resolveNextTickMs(this.config, {
        visualDelta,
        hashDistance,
        clusterScore,
        l0Pass,
        l1Pass,
        decision
      });
      this.lastResolvedTickMs = resolvedTickMs;
      this.lastTickCompletedAtMs = Date.now();
      await this.writeMetrics();
      this.scheduleNextTick(resolvedTickMs);

      if (decision === "trigger") {
        try {
          const input = await this.buildTriggeredInput(candidate, capture, foreground);
          logInfo(
            `Screen attention trigger dispatch ` +
            `score=${candidate.scores.finalScore.toFixed(2)} ` +
            `reasons=${candidate.reasons.join(",") || "none"} ` +
            `foreground=${foreground?.processName ?? "-"}`
          );
          void this.dispatchTrigger(input, "screen_attention");
        } catch (error) {
          logError("Screen attention trigger failed", error);
        }
      } else if (companionReady) {
        try {
          const input = await this.buildCompanionInput(candidate, capture, foreground);
          this.companionTriggerCount += 1;
          this.lastCompanionAtMs = now.getTime();
          logInfo(
            `Active companion trigger dispatch ` +
            `score=${candidate.scores.finalScore.toFixed(2)} ` +
            `reasons=${candidate.reasons.join(",") || "active_companion"}`
          );
          void this.dispatchTrigger(input, "active_companion");
        } catch (error) {
          logError("Active companion trigger failed", error);
        }
      }
    } catch (error) {
      logError("Screen attention tick failed", error);
      this.lastTickDurationMs = Date.now() - tickStartedAtMs;
      this.tickDurationTotalMs += this.lastTickDurationMs;
      this.callbacks.onDebugState({
        ...buildIdleState(true, this.config),
        decision: "drop",
        reasons: ["tick_failed"]
      });
      this.scheduleNextTick(getBaseTickMs(this.config));
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

    if (
      this.config.screen_debug_save_gate_frames === false ||
      (this.config.screen_active_sampling_enabled === true && this.lastResolvedTickMs > 0 && this.lastResolvedTickMs <= 100)
    ) {
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
      cooldownCount: this.cooldownCount,
      companionTriggerCount: this.companionTriggerCount,
      averageTickDurationMs: this.tickCount > 0 ? this.tickDurationTotalMs / this.tickCount : 0,
      lastTickDurationMs: this.lastTickDurationMs,
      currentTickMs: this.lastResolvedTickMs,
      overrunCount: this.overrunCount
    };
    writeFileSync(metricsPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async openSessionFolder(): Promise<string> {
    const errorMessage = await shell.openPath(this.dirs.root);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return this.dirs.root;
  }

  private async buildTriggeredInput(
    candidate: MomentCandidate,
    capture: CapturedScreenImage,
    foreground: { bounds: { x: number; y: number; width: number; height: number } | null } | null
  ): Promise<PerceptionInput> {
    const stamp = candidate.ts.replace(/[:.]/g, "-");
    const currentLlmCapture =
      this.findCurrentOriginalCapture(candidate.ts) ??
      await capturePrimaryDisplayImage();
    const globalPath = path.join(this.dirs.llm, `${stamp}_global.png`);
    const globalCapture = shouldSendForegroundWindowOnly(this.config) && foreground?.bounds
      ? cropCaptureToBounds(currentLlmCapture, foreground.bounds)
      : currentLlmCapture;
    savePngBuffer(globalPath, globalCapture.pngBuffer);

    const roiBox = candidate.roi.boxes[0] ?? {
      x: 0,
      y: 0,
      width: capture.width,
      height: capture.height
    };
    const scaledRoiBox = scaleRoiBoxToCapture(roiBox, capture, currentLlmCapture);

    const currentRoiPath = path.join(this.dirs.llm, `${stamp}_current_roi.png`);
    savePngBuffer(currentRoiPath, cropImageToPngBuffer(currentLlmCapture, scaledRoiBox));

    const previousLlmCapture = this.findHistoricalOriginalCapture(candidate.ts);
    let previousRoiPath: string | null = null;
    if (previousLlmCapture) {
      const previousScaledRoiBox = scaleRoiBoxToCapture(roiBox, capture, previousLlmCapture);
      previousRoiPath = path.join(this.dirs.llm, `${stamp}_previous_roi.png`);
      savePngBuffer(previousRoiPath, cropImageToPngBuffer(previousLlmCapture, previousScaledRoiBox));
    }

    const attachments = [
      { path: currentRoiPath, mime_type: "image/png", label: "current_roi" },
      previousRoiPath
        ? {
            path: previousRoiPath,
            mime_type: "image/png",
            label: "previous_roi_original"
          }
        : null,
      {
        path: globalPath,
        mime_type: "image/png",
        label: shouldSendForegroundWindowOnly(this.config) ? "foreground_window_full" : "global_full"
      }
    ].filter((item): item is { path: string; mime_type: string; label: string } => item !== null);

    const metadataPath = path.join(this.dirs.llm, `${stamp}.json`);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          ts: candidate.ts,
          decision: candidate.decision,
          finalScore: candidate.scores.finalScore,
          reasons: candidate.reasons,
          imageSource: "original",
          globalImageMode: shouldSendForegroundWindowOnly(this.config) ? "foreground_window_only" : "full_desktop",
          gateCaptureSize: {
            width: capture.width,
            height: capture.height
          },
          llmCaptureSize: {
            width: currentLlmCapture.width,
            height: currentLlmCapture.height
          },
          globalCaptureSize: {
            width: globalCapture.width,
            height: globalCapture.height
          },
          roiBox,
          scaledRoiBox,
          foregroundBounds: foreground?.bounds ?? null,
          attachments
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      source: "screen",
      trigger_score: candidate.scores.finalScore,
      allow_interrupt: true,
      trigger_reason: candidate.reasons.join(",") || "trigger_ready",
      content: [
        `门控已触发，时间：${candidate.ts}。`,
        "请优先依据附带图片判断用户当前在做什么，再决定是否需要简短回应。",
        shouldSendForegroundWindowOnly(this.config)
          ? "附图顺序是：当前 ROI 原图裁剪、历史 ROI 原图裁剪（如果有）、当前前台窗口原图。"
          : "附图顺序是：当前 ROI 原图裁剪、历史 ROI 原图裁剪（如果有）、当前全局原图。",
        `当前决策：${candidate.decision}；评分：${candidate.scores.finalScore.toFixed(2)}。`,
        `触发原因：${candidate.reasons.join("、") || "无"}。`
      ].join(" "),
      attachments
    };
  }

  private findCurrentOriginalCapture(ts: string): CapturedScreenImage | null {
    const targetMs = new Date(ts).getTime();
    for (let index = this.captureHistory.length - 1; index >= 0; index -= 1) {
      const item = this.captureHistory[index];
      if (Math.abs(item.atMs - targetMs) <= 1000 && item.llmCapture) {
        return item.llmCapture;
      }
    }
    return null;
  }

  private findHistoricalOriginalCapture(ts: string): CapturedScreenImage | null {
    const targetMs = new Date(ts).getTime() - 2000;
    let bestMatch: CaptureHistoryItem | null = null;

    for (const item of this.captureHistory) {
      if (item.atMs > targetMs || !item.llmCapture) {
        continue;
      }
      bestMatch = item;
    }

    if (bestMatch?.llmCapture) {
      return bestMatch.llmCapture;
    }
    return null;
  }

  private shouldTriggerCompanion(
    nowMs: number,
    visualDelta: number,
    hashDistance: number,
    clusterScore: number,
    userIdleScore: number
  ): boolean {
    if (this.config.active_companion_enabled !== true) {
      return false;
    }
    const intervalMin = normalizeInteger(this.config.active_companion_interval_min, 7);
    if (nowMs - this.lastCompanionAtMs < intervalMin * 60 * 1000) {
      return false;
    }
    if (this.triggerQueue.getGlobalCooldownRemainingMs(nowMs) > 0) {
      return false;
    }
    if (userIdleScore < 0.8) {
      return false;
    }
    if (visualDelta >= 0.03 || hashDistance >= 2 || clusterScore >= 0.08) {
      return false;
    }
    return true;
  }

  private async buildCompanionInput(
    candidate: MomentCandidate,
    capture: CapturedScreenImage,
    foreground: { bounds: { x: number; y: number; width: number; height: number } | null } | null
  ): Promise<PerceptionInput> {
    const stamp = `${candidate.ts.replace(/[:.]/g, "-")}_companion`;
    const llmCapture =
      this.findCurrentOriginalCapture(candidate.ts) ??
      await capturePrimaryDisplayImage();
    const globalCapture = shouldSendForegroundWindowOnly(this.config) && foreground?.bounds
      ? cropCaptureToBounds(llmCapture, foreground.bounds)
      : llmCapture;
    const globalPath = path.join(this.dirs.llm, `${stamp}_global.png`);
    savePngBuffer(globalPath, globalCapture.pngBuffer);
    const attachments = [
      {
        path: globalPath,
        mime_type: "image/png",
        label: shouldSendForegroundWindowOnly(this.config) ? "companion_foreground_window_full" : "companion_global_full"
      }
    ];
    const metadataPath = path.join(this.dirs.llm, `${stamp}.json`);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          ts: candidate.ts,
          kind: "active_companion",
          finalScore: candidate.scores.finalScore,
          reasons: ["active_companion"],
          imageSource: "original",
          globalImageMode: shouldSendForegroundWindowOnly(this.config) ? "foreground_window_only" : "full_desktop",
          gateCaptureSize: {
            width: capture.width,
            height: capture.height
          },
          llmCaptureSize: {
            width: llmCapture.width,
            height: llmCapture.height
          },
          globalCaptureSize: {
            width: globalCapture.width,
            height: globalCapture.height
          },
          foregroundBounds: foreground?.bounds ?? null
        },
        null,
        2
      ),
      "utf8"
    );
    return {
      source: "screen",
      trigger_score: candidate.scores.finalScore,
      allow_interrupt: true,
      trigger_reason: "active_companion",
      content: [
        `当前是主动陪伴时刻，时间：${candidate.ts}。`,
        "屏幕已稳定一段时间，且用户看起来处于较空闲状态。",
        "请只基于可见内容给一句低打扰、简短的陪伴式评论，不要过度脑补。"
      ].join(" "),
      attachments
    };
  }

  private async dispatchTrigger(input: PerceptionInput, source: string): Promise<void> {
    try {
      await this.callbacks.onTrigger(input);
      logInfo(`${source} dispatch completed`);
    } catch (error) {
      logError(`${source} dispatch failed`, error);
    }
  }
}

function shouldSendForegroundWindowOnly(config: AppConfig): boolean {
  return config.screen_send_foreground_window_only === true;
}

function cropCaptureToBounds(
  capture: CapturedScreenImage,
  bounds: { x: number; y: number; width: number; height: number }
): CapturedScreenImage {
  const normalizedBounds = {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width: Math.max(1, Math.ceil(bounds.width)),
    height: Math.max(1, Math.ceil(bounds.height))
  };
  const pngBuffer = cropImageToPngBuffer(capture, normalizedBounds);
  const image = nativeImage.createFromBuffer(pngBuffer);

  return {
    capturedAt: capture.capturedAt,
    width: image.getSize().width,
    height: image.getSize().height,
    pngBuffer,
    bitmapBuffer: image.toBitmap(),
    image
  };
}

function scaleRoiBoxToCapture(
  box: { x: number; y: number; width: number; height: number },
  sourceCapture: CapturedScreenImage,
  targetCapture: CapturedScreenImage
): { x: number; y: number; width: number; height: number } {
  const scaleX = targetCapture.width / Math.max(1, sourceCapture.width);
  const scaleY = targetCapture.height / Math.max(1, sourceCapture.height);
  const x = Math.max(0, Math.floor(box.x * scaleX));
  const y = Math.max(0, Math.floor(box.y * scaleY));
  const width = Math.max(1, Math.ceil(box.width * scaleX));
  const height = Math.max(1, Math.ceil(box.height * scaleY));
  const maxWidth = Math.max(1, targetCapture.width - x);
  const maxHeight = Math.max(1, targetCapture.height - y);

  return {
    x,
    y,
    width: Math.min(width, maxWidth),
    height: Math.min(height, maxHeight)
  };
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

function resolveNextTickMs(
  config: AppConfig,
  state: {
    visualDelta: number;
    hashDistance: number;
    clusterScore: number;
    l0Pass: boolean;
    l1Pass: boolean;
    decision: "idle" | "drop" | "cooldown" | "trigger";
  }
): number {
  const baseTickMs = getBaseTickMs(config);
  if (config.screen_active_sampling_enabled !== true) {
    return baseTickMs;
  }

  const activeTickMs = Math.min(baseTickMs, 100);
  const isActive =
    state.decision === "trigger" ||
    state.decision === "cooldown" ||
    state.l0Pass ||
    state.l1Pass ||
    state.visualDelta >= 0.12 ||
    state.hashDistance >= 4 ||
    state.clusterScore >= 0.18;

  return isActive ? activeTickMs : baseTickMs;
}

function buildTriggerQueueConfig(config: AppConfig): TriggerQueueConfig {
  return {
    globalCooldownMs: normalizeInteger(config.screen_global_cooldown_sec, 1) * 1000,
    sameTopicCooldownMs: normalizeInteger(config.screen_same_topic_cooldown_sec, 0) * 1000,
    busyCooldownMs: normalizeInteger(config.screen_busy_cooldown_sec, 0) * 1000,
    recentCacheSize: normalizeInteger(config.screen_recent_cache_size, 30)
  };
}

function buildIdleState(active: boolean, config?: AppConfig): AttentionUiState {
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
    foregroundChanged: false,
    foregroundTitle: "",
    foregroundProcessName: "",
    currentTickMs: config ? getBaseTickMs(config) : undefined,
    actualSampleIntervalMs: undefined,
    tickDurationMs: undefined,
    cooldownRemainingMs: undefined,
    lastTriggerAt: undefined,
    activeSamplingEnabled: config?.screen_active_sampling_enabled === true,
    decision: "idle",
    reasons: active ? ["waiting_for_frame"] : ["attention_disabled"]
  };
}

function toUiState(
  candidate: MomentCandidate,
  config?: AppConfig,
  runtime?: {
    actualSampleIntervalMs?: number;
    tickDurationMs?: number;
    cooldownRemainingMs?: number;
    lastTriggerAt?: string;
    currentResponseScore?: number;
    responseActive?: boolean;
    responsePhase?: "idle" | "inflight" | "bubble";
  }
): AttentionUiState {
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
    foregroundChanged: candidate.l1.foregroundChanged,
    foregroundTitle: candidate.l1.foregroundTitle,
    foregroundProcessName: candidate.l1.foregroundProcessName,
    currentTickMs: config ? resolveNextTickMs(config, {
      visualDelta: candidate.l0.visualDelta,
      hashDistance: candidate.l0.hashDistance,
      clusterScore: candidate.l1.clusterScore,
      l0Pass: candidate.l0.pass,
      l1Pass: candidate.l1.pass,
      decision: candidate.decision
    }) : undefined,
    actualSampleIntervalMs: runtime?.actualSampleIntervalMs,
    tickDurationMs: runtime?.tickDurationMs,
    cooldownRemainingMs: runtime?.cooldownRemainingMs,
    lastTriggerAt: runtime?.lastTriggerAt,
    activeSamplingEnabled: config?.screen_active_sampling_enabled === true,
    currentResponseScore: runtime?.currentResponseScore,
    responseActive: runtime?.responseActive,
    responsePhase: runtime?.responsePhase,
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
  foregroundChanged: boolean,
  thresholds: AttentionThresholds
): string[] {
  if (!l0Pass) {
    return ["l0_blocked"];
  }
  if (
    clusterScore >= thresholds.l1ClusterThreshold ||
    userIdleScore >= 0.35 ||
    foregroundChanged
  ) {
    return [];
  }
  return ["l1_not_worthy"];
}

function buildSignature(
  snapshot: FrameAnalysisSnapshot,
  candidate: MomentCandidate["roi"],
  foregroundProcessName?: string,
  foregroundTitle?: string
): string {
  const roiSignature = candidate.boxes
    .map((box) => `${box.x},${box.y},${box.width},${box.height}`)
    .join("|");
  return `${snapshot.signatureBits}:${roiSignature}:${foregroundProcessName ?? ""}:${foregroundTitle ?? ""}`;
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function getBaseTickMs(config: AppConfig): number {
  return Math.max(100, normalizeInteger(config.screen_gate_tick_ms, 500));
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
