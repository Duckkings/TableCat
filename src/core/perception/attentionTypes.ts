import { ScreenAttentionDebugState } from "../../shared/types";

export interface ROIBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ROIProposal {
  boxes: ROIBox[];
  coverageRatio: number;
  heatmapScore: number;
}

export interface L0GateResult {
  visualDelta: number;
  hashDistance: number;
  inputIntensity: number;
  cooldownOk: boolean;
  pass: boolean;
  reasons: string[];
}

export interface L1GateResult {
  foregroundChanged: boolean;
  foregroundTitle?: string;
  foregroundProcessName?: string;
  clusterScore: number;
  userIdleScore: number;
  audioPeakScore: number;
  pass: boolean;
  reasons: string[];
}

export interface AttentionScores {
  excitementScore: number;
  interruptScore: number;
  noveltyScore: number;
  finalScore: number;
}

export interface MomentCandidate {
  ts: string;
  l0: L0GateResult;
  l1: L1GateResult;
  roi: ROIProposal;
  scores: AttentionScores;
  signature: string;
  decision: "idle" | "drop" | "cooldown" | "trigger";
  reasons: string[];
}

export interface AttentionThresholds {
  l0VisualDeltaThreshold: number;
  l0HashDistanceThreshold: number;
  l0InputIntensityThreshold: number;
  l1ClusterThreshold: number;
  triggerThreshold: number;
}

export interface TriggerQueueConfig {
  globalCooldownMs: number;
  sameTopicCooldownMs: number;
  busyCooldownMs: number;
  recentCacheSize: number;
}

export interface FrameAnalysisSnapshot {
  width: number;
  height: number;
  grayscale: Uint8Array;
  gridEnergy: number[];
  signatureBits: string;
}

export interface AttentionUiState extends ScreenAttentionDebugState {
  ts: string;
}
