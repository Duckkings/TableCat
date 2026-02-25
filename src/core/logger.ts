import { appendFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "LOG");
const LOG_FILE = path.join(LOG_DIR, "app.log");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLine(level: string, message: string): void {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  appendFileSync(LOG_FILE, line, "utf8");
}

export function logInfo(message: string): void {
  writeLine("INFO", message);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  writeLine("ERROR", detail ? `${message} | ${detail}` : message);
}
