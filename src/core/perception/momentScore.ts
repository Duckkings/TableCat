import { AttentionScores } from "./attentionTypes";

export function buildMomentScores(params: {
  visualDelta: number;
  hashDistance: number;
  clusterScore: number;
  userIdleScore: number;
  cooldownOk: boolean;
  noveltyScore: number;
}): AttentionScores {
  const excitementScore = clamp01(
    Math.max(
      params.visualDelta,
      params.hashDistance / 64,
      params.clusterScore
    )
  );
  const interruptScore = clamp01(
    params.userIdleScore * 0.7 + (params.cooldownOk ? 0.3 : 0)
  );
  const finalScore = clamp01(
    excitementScore * 0.45 +
    interruptScore * 0.30 +
    params.noveltyScore * 0.25
  );

  return {
    excitementScore,
    interruptScore,
    noveltyScore: clamp01(params.noveltyScore),
    finalScore
  };
}

export function computeUserIdleScore(idleSeconds: number): number {
  return clamp01(idleSeconds / 15);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
