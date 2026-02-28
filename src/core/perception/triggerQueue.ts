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

  getNoveltyScore(signature: string): number {
    return this.computeNovelty(signature);
  }

  decide(params: {
    nowMs: number;
    finalScore: number;
    triggerThreshold: number;
    signature: string;
    userIdleScore: number;
  }): { decision: "drop" | "cooldown" | "trigger"; reasons: string[]; noveltyScore: number } {
    const reasons: string[] = [];
    const noveltyScore = this.getNoveltyScore(params.signature);

    if (params.finalScore < params.triggerThreshold) {
      reasons.push("below_trigger_threshold");
      return { decision: "drop", reasons, noveltyScore };
    }

    if (params.nowMs - this.lastTriggerAtMs < this.config.globalCooldownMs) {
      reasons.push("global_cooldown");
      return { decision: "cooldown", reasons, noveltyScore };
    }

    const similarRecent = this.findSimilarRecent(params.signature);
    if (similarRecent && params.nowMs - similarRecent.atMs < this.config.sameTopicCooldownMs) {
      reasons.push("same_topic_cooldown");
      return { decision: "cooldown", reasons, noveltyScore };
    }

    if (
      params.userIdleScore < 0.35 &&
      params.nowMs - this.lastBusyTriggerAtMs < this.config.busyCooldownMs
    ) {
      reasons.push("busy_cooldown");
      return { decision: "cooldown", reasons, noveltyScore };
    }

    this.lastTriggerAtMs = params.nowMs;
    if (params.userIdleScore < 0.35) {
      this.lastBusyTriggerAtMs = params.nowMs;
    }
    this.recent.unshift({
      atMs: params.nowMs,
      signature: params.signature
    });
    this.recent = this.recent.slice(0, this.config.recentCacheSize);
    reasons.push("trigger_ready");
    return { decision: "trigger", reasons, noveltyScore };
  }

  peekCooldown(nowMs: number): boolean {
    return nowMs - this.lastTriggerAtMs >= this.config.globalCooldownMs;
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
