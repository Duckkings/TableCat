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
}

export interface AppConfigPatch {
  bubble_timeout_sec?: number;
  role_card_path?: string;
  perception_interval_sec?: number;
  enable_perception_loop?: boolean;
  enable_screen?: boolean;
  enable_mic?: boolean;
  enable_system_audio?: boolean;
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

  const next: AppConfig = {
    ...current
  };
  if (patch.bubble_timeout_sec !== undefined) {
    if (typeof patch.bubble_timeout_sec !== "number" || Number.isNaN(patch.bubble_timeout_sec)) {
      const error = new Error("Invalid bubble_timeout_sec");
      logError("Config update failed", error);
      throw error;
    }
    next.bubble_timeout_sec = patch.bubble_timeout_sec;
  }
  if (patch.role_card_path !== undefined) {
    if (typeof patch.role_card_path !== "string" || patch.role_card_path.trim() === "") {
      const error = new Error("Invalid role_card_path");
      logError("Config update failed", error);
      throw error;
    }
    next.role_card_path = patch.role_card_path.trim();
  }
  if (patch.perception_interval_sec !== undefined) {
    if (
      typeof patch.perception_interval_sec !== "number" ||
      Number.isNaN(patch.perception_interval_sec) ||
      !Number.isInteger(patch.perception_interval_sec) ||
      patch.perception_interval_sec < 5 ||
      patch.perception_interval_sec > 30
    ) {
      const error = new Error("Invalid perception_interval_sec");
      logError("Config update failed", error);
      throw error;
    }
    next.perception_interval_sec = patch.perception_interval_sec;
  }
  if (patch.enable_perception_loop !== undefined) {
    if (typeof patch.enable_perception_loop !== "boolean") {
      const error = new Error("Invalid enable_perception_loop");
      logError("Config update failed", error);
      throw error;
    }
    next.enable_perception_loop = patch.enable_perception_loop;
  }
  if (patch.enable_screen !== undefined) {
    if (typeof patch.enable_screen !== "boolean") {
      const error = new Error("Invalid enable_screen");
      logError("Config update failed", error);
      throw error;
    }
    next.enable_screen = patch.enable_screen;
  }
  if (patch.enable_mic !== undefined) {
    if (typeof patch.enable_mic !== "boolean") {
      const error = new Error("Invalid enable_mic");
      logError("Config update failed", error);
      throw error;
    }
    next.enable_mic = patch.enable_mic;
  }
  if (patch.enable_system_audio !== undefined) {
    if (typeof patch.enable_system_audio !== "boolean") {
      const error = new Error("Invalid enable_system_audio");
      logError("Config update failed", error);
      throw error;
    }
    next.enable_system_audio = patch.enable_system_audio;
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
  if (parsed.bubble_timeout_sec !== undefined) {
    const value = typeof parsed.bubble_timeout_sec === "string"
      ? Number(parsed.bubble_timeout_sec)
      : parsed.bubble_timeout_sec;
    if (Number.isNaN(value) || typeof value !== "number") {
      const error = new Error("Invalid bubble_timeout_sec");
      logError("Config validation failed", error);
      throw error;
    }
    parsed.bubble_timeout_sec = value;
  }
  if (
    parsed.perception_interval_sec !== undefined &&
    typeof parsed.perception_interval_sec !== "number"
  ) {
    const error = new Error("Invalid perception_interval_sec");
    logError("Config validation failed", error);
    throw error;
  }
  if (
    parsed.perception_interval_sec !== undefined &&
    (
      !Number.isInteger(parsed.perception_interval_sec) ||
      parsed.perception_interval_sec < 5 ||
      parsed.perception_interval_sec > 30
    )
  ) {
    const error = new Error("Invalid perception_interval_sec");
    logError("Config validation failed", error);
    throw error;
  }
  if (
    parsed.enable_perception_loop !== undefined &&
    typeof parsed.enable_perception_loop !== "boolean"
  ) {
    const error = new Error("Invalid enable_perception_loop");
    logError("Config validation failed", error);
    throw error;
  }
  if (parsed.enable_screen !== undefined && typeof parsed.enable_screen !== "boolean") {
    const error = new Error("Invalid enable_screen");
    logError("Config validation failed", error);
    throw error;
  }
  if (parsed.enable_mic !== undefined && typeof parsed.enable_mic !== "boolean") {
    const error = new Error("Invalid enable_mic");
    logError("Config validation failed", error);
    throw error;
  }
  if (
    parsed.enable_system_audio !== undefined &&
    typeof parsed.enable_system_audio !== "boolean"
  ) {
    const error = new Error("Invalid enable_system_audio");
    logError("Config validation failed", error);
    throw error;
  }
  return parsed as AppConfig;
}
