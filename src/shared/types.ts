export type PerceptionSource = "screen" | "mic" | "system_audio";

export interface RoleCard {
  name: string;
  prompt: string;
  api?: string;
  scale?: number;
  wake_word?: string;
  pet_icon_path?: string;
  memory?: string[];
}

export interface PerceptionInput {
  source: PerceptionSource;
  content: string;
  image_path?: string;
  image_mime_type?: string;
  trigger_score?: number;
  allow_interrupt?: boolean;
  trigger_reason?: string;
  attachments?: {
    path: string;
    mime_type: string;
    label?: string;
  }[];
}

export interface ModelRequest {
  inputs: PerceptionInput[];
  memory?: string;
  role_prompt: string;
  default_prompt: string;
}

export interface ModelResponse {
  reasoning: string;
  emotion: string;
  content: string;
  memory_summary: string;
}

export interface AppSettings {
  perception_interval_sec: number;
  enable_screen: boolean;
  enable_mic: boolean;
  enable_system_audio: boolean;
  api_key?: string;
  scale?: number;
  tts_enabled: boolean;
}

export interface MemoryWriteback {
  role_card_path: string;
  memory_summary: string;
}

export interface ScreenAttentionDebugState {
  active: boolean;
  finalScore: number;
  excitementScore: number;
  interruptScore: number;
  noveltyScore: number;
  visualDelta: number;
  hashDistance: number;
  clusterScore: number;
  l0Pass: boolean;
  l1Pass: boolean;
  foregroundChanged?: boolean;
  foregroundTitle?: string;
  foregroundProcessName?: string;
  currentTickMs?: number;
  actualSampleIntervalMs?: number;
  tickDurationMs?: number;
  cooldownRemainingMs?: number;
  lastTriggerAt?: string;
  activeSamplingEnabled?: boolean;
  currentResponseScore?: number;
  responseActive?: boolean;
  responsePhase?: "idle" | "inflight" | "bubble";
  decision: "idle" | "drop" | "cooldown" | "trigger";
  reasons: string[];
}
