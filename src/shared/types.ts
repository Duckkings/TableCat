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
