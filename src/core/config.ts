import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { logError, logInfo } from "./logger";

export interface AppConfig {
  role_card_path: string;
  openai: {
    api_key: string;
    model: string;
  };
  bubble_timeout_sec?: number;
  perception_interval_sec?: number;
  enable_perception_loop?: boolean;
  enable_screen?: boolean;
  enable_mic?: boolean;
  enable_system_audio?: boolean;
  screen_attention_enabled?: boolean;
  screen_gate_tick_ms?: number;
  screen_thumb_width?: number;
  screen_thumb_height?: number;
  screen_l0_visual_delta_threshold?: number;
  screen_l0_hash_distance_threshold?: number;
  screen_l0_input_intensity_threshold?: number;
  screen_l1_cluster_threshold?: number;
  screen_trigger_threshold?: number;
  screen_global_cooldown_sec?: number;
  screen_same_topic_cooldown_sec?: number;
  screen_busy_cooldown_sec?: number;
  screen_recent_cache_size?: number;
  screen_debug_save_gate_frames?: boolean;
}

export interface AppConfigPatch {
  bubble_timeout_sec?: number;
  role_card_path?: string;
  perception_interval_sec?: number;
  enable_perception_loop?: boolean;
  enable_screen?: boolean;
  enable_mic?: boolean;
  enable_system_audio?: boolean;
  screen_attention_enabled?: boolean;
  screen_gate_tick_ms?: number;
  screen_thumb_width?: number;
  screen_thumb_height?: number;
  screen_l0_visual_delta_threshold?: number;
  screen_l0_hash_distance_threshold?: number;
  screen_l0_input_intensity_threshold?: number;
  screen_l1_cluster_threshold?: number;
  screen_trigger_threshold?: number;
  screen_global_cooldown_sec?: number;
  screen_same_topic_cooldown_sec?: number;
  screen_busy_cooldown_sec?: number;
  screen_recent_cache_size?: number;
  screen_debug_save_gate_frames?: boolean;
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "app.config.json");

export function loadAppConfig(
  configPath = DEFAULT_CONFIG_PATH
): AppConfig | null {
  if (!existsSync(configPath)) {
    logInfo("app.config.json not found");
    return null;
  }
  const parsed = parseAppConfig(readFileSync(configPath, "utf8"));
  logInfo(`Config loaded: ${configPath}`);
  return parsed;
}

export function updateAppConfig(
  patch: AppConfigPatch,
  configPath = DEFAULT_CONFIG_PATH
): AppConfig {
  const current = loadAppConfig(configPath);
  if (!current) {
    const error = new Error("Cannot update config: app.config.json not found");
    logError("Config update failed", error);
    throw error;
  }

  const next: AppConfig = { ...current };

  assignNumberPatch(next, patch, "bubble_timeout_sec", 0, 600);
  assignIntegerPatch(next, patch, "perception_interval_sec", 5, 30);
  assignBooleanPatch(next, patch, "enable_perception_loop");
  assignBooleanPatch(next, patch, "enable_screen");
  assignBooleanPatch(next, patch, "enable_mic");
  assignBooleanPatch(next, patch, "enable_system_audio");
  assignBooleanPatch(next, patch, "screen_attention_enabled");
  assignIntegerPatch(next, patch, "screen_gate_tick_ms", 200, 5000);
  assignIntegerPatch(next, patch, "screen_thumb_width", 16, 1920);
  assignIntegerPatch(next, patch, "screen_thumb_height", 16, 1080);
  assignNumberPatch(next, patch, "screen_l0_visual_delta_threshold", 0, 1);
  assignIntegerPatch(next, patch, "screen_l0_hash_distance_threshold", 0, 64);
  assignNumberPatch(next, patch, "screen_l0_input_intensity_threshold", 0, 1);
  assignNumberPatch(next, patch, "screen_l1_cluster_threshold", 0, 1);
  assignNumberPatch(next, patch, "screen_trigger_threshold", 0, 1);
  assignIntegerPatch(next, patch, "screen_global_cooldown_sec", 0, 600);
  assignIntegerPatch(next, patch, "screen_same_topic_cooldown_sec", 0, 600);
  assignIntegerPatch(next, patch, "screen_busy_cooldown_sec", 0, 600);
  assignIntegerPatch(next, patch, "screen_recent_cache_size", 1, 200);
  assignBooleanPatch(next, patch, "screen_debug_save_gate_frames");

  if (patch.role_card_path !== undefined) {
    if (typeof patch.role_card_path !== "string" || patch.role_card_path.trim() === "") {
      const error = new Error("Invalid role_card_path");
      logError("Config update failed", error);
      throw error;
    }
    next.role_card_path = patch.role_card_path.trim();
  }

  saveAppConfig(next, configPath);
  logInfo(`Config updated: ${configPath}`);
  return next;
}

function saveAppConfig(config: AppConfig, configPath = DEFAULT_CONFIG_PATH): void {
  const json = JSON.stringify(config, null, 2);
  writeFileSync(configPath, json, "utf8");
}

function parseAppConfig(raw: string): AppConfig {
  const normalized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const parsed = JSON.parse(normalized) as Partial<AppConfig>;
  if (!parsed.role_card_path || !parsed.openai?.api_key || !parsed.openai?.model) {
    const error = new Error("Invalid app.config.json");
    logError("Config validation failed", error);
    throw error;
  }

  normalizeOptionalNumber(parsed, "bubble_timeout_sec", 0, 600, false);
  normalizeOptionalNumber(parsed, "perception_interval_sec", 5, 30, true);
  normalizeOptionalBoolean(parsed, "enable_perception_loop");
  normalizeOptionalBoolean(parsed, "enable_screen");
  normalizeOptionalBoolean(parsed, "enable_mic");
  normalizeOptionalBoolean(parsed, "enable_system_audio");
  normalizeOptionalBoolean(parsed, "screen_attention_enabled");
  normalizeOptionalNumber(parsed, "screen_gate_tick_ms", 200, 5000, true);
  normalizeOptionalNumber(parsed, "screen_thumb_width", 16, 1920, true);
  normalizeOptionalNumber(parsed, "screen_thumb_height", 16, 1080, true);
  normalizeOptionalNumber(parsed, "screen_l0_visual_delta_threshold", 0, 1, false);
  normalizeOptionalNumber(parsed, "screen_l0_hash_distance_threshold", 0, 64, true);
  normalizeOptionalNumber(parsed, "screen_l0_input_intensity_threshold", 0, 1, false);
  normalizeOptionalNumber(parsed, "screen_l1_cluster_threshold", 0, 1, false);
  normalizeOptionalNumber(parsed, "screen_trigger_threshold", 0, 1, false);
  normalizeOptionalNumber(parsed, "screen_global_cooldown_sec", 0, 600, true);
  normalizeOptionalNumber(parsed, "screen_same_topic_cooldown_sec", 0, 600, true);
  normalizeOptionalNumber(parsed, "screen_busy_cooldown_sec", 0, 600, true);
  normalizeOptionalNumber(parsed, "screen_recent_cache_size", 1, 200, true);
  normalizeOptionalBoolean(parsed, "screen_debug_save_gate_frames");

  return parsed as AppConfig;
}

function assignBooleanPatch(
  target: AppConfig,
  patch: AppConfigPatch,
  key: keyof AppConfigPatch
): void {
  const value = patch[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config update failed", error);
    throw error;
  }
  target[key as keyof AppConfig] = value as never;
}

function assignIntegerPatch(
  target: AppConfig,
  patch: AppConfigPatch,
  key: keyof AppConfigPatch,
  min: number,
  max: number
): void {
  const value = patch[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isInteger(value) || value < min || value > max) {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config update failed", error);
    throw error;
  }
  target[key as keyof AppConfig] = value as never;
}

function assignNumberPatch(
  target: AppConfig,
  patch: AppConfigPatch,
  key: keyof AppConfigPatch,
  min: number,
  max: number
): void {
  const value = patch[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value) || value < min || value > max) {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config update failed", error);
    throw error;
  }
  target[key as keyof AppConfig] = value as never;
}

function normalizeOptionalBoolean(parsed: Partial<AppConfig>, key: keyof AppConfig): void {
  const value = parsed[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config validation failed", error);
    throw error;
  }
}

function normalizeOptionalNumber(
  parsed: Partial<AppConfig>,
  key: keyof AppConfig,
  min: number,
  max: number,
  integerOnly: boolean
): void {
  const value = parsed[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config validation failed", error);
    throw error;
  }
  if (integerOnly && !Number.isInteger(value)) {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config validation failed", error);
    throw error;
  }
  if (value < min || value > max) {
    const error = new Error(`Invalid ${String(key)}`);
    logError("Config validation failed", error);
    throw error;
  }
}
