import { existsSync, readFileSync } from "fs";
import path from "path";
import { logError, logInfo } from "./logger";

export interface AppConfig {
  role_card_path: string;
  openai: {
    api_key: string;
    model: string;
  };
  bubble_timeout_sec?: number;
}

export function loadAppConfig(
  configPath = path.join(process.cwd(), "app.config.json")
): AppConfig | null {
  if (!existsSync(configPath)) {
    logInfo("app.config.json not found");
    return null;
  }
  const raw = readFileSync(configPath, "utf8");
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
  logInfo(`Config loaded: ${configPath}`);
  return parsed as AppConfig;
}
