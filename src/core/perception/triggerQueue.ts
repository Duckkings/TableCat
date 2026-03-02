import { TriggerQueueConfig } from "./attentionTypes";

interface TriggerMemory {
  atMs: number;
  signature: string;
}

export class TriggerQueue {
  private lastTriggerAtMs = 0;
  private lastBusyTriggerAtMs = 0;
  private recent: TriggerMemory[] = [];

  constructor(private readonly config: TriggerQueueConfig) {}

  getLastTriggerAtMs(): number {
    return this.lastTriggerAtMs;
  }

  getGlobalCooldownRemainingMs(nowMs: number): number {
    return Math.max(0, this.config.globalCooldownMs - (nowMs - this.lastTriggerAtMs));
  }

  getNoveltyScore(signature: string): number {
    return this.computeNovelty(signature);
  }

  decide(params: {
    nowMs: number;
    finalScore: number;
    triggerThreshold: number;
    signature: string;
    userIdleScore: number;
    interruptActiveResponse?: boolean;
    currentResponseScore?: number;
  }): {
    decision: "drop" | "cooldown" | "trigger";
    reasons: string[];
    noveltyScore: number;
    cooldownRemainingMs?: number;
  } {
    const reasons: string[] = [];
    const noveltyScore = this.getNoveltyScore(params.signature);

    if (params.finalScore < params.triggerThreshold) {
      reasons.push("below_trigger_threshold");
      return { decision: "drop", reasons, noveltyScore, cooldownRemainingMs: 0 };
    }

    if (
      params.interruptActiveResponse === true &&
      typeof params.currentResponseScore === "number" &&
      params.finalScore > params.currentResponseScore
    ) {
      this.recordTrigger(params.nowMs, params.signature, params.userIdleScore);
      reasons.push("interrupt_active_reply");
      return { decision: "trigger", reasons, noveltyScore, cooldownRemainingMs: 0 };
    }

    const cooldownBlock = this.getCooldownBlock(
      params.nowMs,
      params.signature,
      params.userIdleScore
    );
    if (cooldownBlock) {
      reasons.push(cooldownBlock.reason);
      return {
        decision: "cooldown",
        reasons,
        noveltyScore,
        cooldownRemainingMs: cooldownBlock.remainingMs
      };
    }

    this.recordTrigger(params.nowMs, params.signature, params.userIdleScore);
    reasons.push("trigger_ready");
    return { decision: "trigger", reasons, noveltyScore, cooldownRemainingMs: 0 };
  }

  peekCooldown(nowMs: number): boolean {
    return nowMs - this.lastTriggerAtMs >= this.config.globalCooldownMs;
  }

  private getCooldownBlock(
    nowMs: number,
    signature: string,
    userIdleScore: number
  ): { reason: string; remainingMs: number } | null {
    const globalRemainingMs = this.getGlobalCooldownRemainingMs(nowMs);
    if (globalRemainingMs > 0) {
      return { reason: "global_cooldown", remainingMs: globalRemainingMs };
    }

    if (this.config.sameTopicCooldownMs > 0) {
      const similarRecent = this.findSimilarRecent(signature);
      if (similarRecent) {
        const sameTopicRemainingMs =
          similarRecent.atMs + this.config.sameTopicCooldownMs - nowMs;
        if (sameTopicRemainingMs > 0) {
          return { reason: "same_topic_cooldown", remainingMs: sameTopicRemainingMs };
        }
      }
    }

    if (this.config.busyCooldownMs > 0 && userIdleScore < 0.35) {
      const busyRemainingMs = this.lastBusyTriggerAtMs + this.config.busyCooldownMs - nowMs;
      if (busyRemainingMs > 0) {
        return { reason: "busy_cooldown", remainingMs: busyRemainingMs };
      }
    }

    return null;
  }

  private computeNovelty(signature: string): number {
    if (this.recent.length === 0) {
      return 1;
    }
    let minDistance = Number.MAX_SAFE_INTEGER;
    for (const item of this.recent) {
      minDistance = Math.min(minDistance, hammingDistance(item.signature, signature));
    }
    return Math.max(0, Math.min(1, minDistance / Math.max(signature.length, 1)));
  }

  private findSimilarRecent(signature: string): TriggerMemory | undefined {
    return this.recent.find((item) => hammingDistance(item.signature, signature) <= 4);
  }

  private recordTrigger(nowMs: number, signature: string, userIdleScore: number): void {
    this.lastTriggerAtMs = nowMs;
    if (userIdleScore < 0.35) {
      this.lastBusyTriggerAtMs = nowMs;
    }
    this.recent.unshift({
      atMs: nowMs,
      signature
    });
    this.recent = this.recent.slice(0, this.config.recentCacheSize);
  }
}

function hammingDistance(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  let distance = 0;
  for (let index = 0; index < maxLength; index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) {
      distance += 1;
    }
  }
  return distance;
}
