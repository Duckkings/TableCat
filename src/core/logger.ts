import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "LOG");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const SESSION_DIR = path.join(LOG_DIR, "sessions");
const SESSION_ID = buildSessionId(new Date());
const SESSION_LOG_FILE = path.join(SESSION_DIR, `${SESSION_ID}.log`);
const LATEST_SESSION_FILE = path.join(LOG_DIR, "latest-session.txt");

let sessionInitialized = false;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function appendLine(filePath: string, line: string): void {
  appendFileSync(filePath, line, "utf8");
}

function ensureSessionInitialized(): void {
  ensureLogDir();
  if (sessionInitialized) {
    return;
  }
  sessionInitialized = true;
  writeFileSync(LATEST_SESSION_FILE, `${SESSION_ID}\n${SESSION_LOG_FILE}\n`, "utf8");
  const timestamp = new Date().toISOString();
  const startupLine =
    `[${timestamp}] [INFO] Session started ` +
    `session_id=${SESSION_ID} pid=${process.pid} platform=${process.platform} cwd=${process.cwd()}\n`;
  appendLine(LOG_FILE, startupLine);
  appendLine(SESSION_LOG_FILE, startupLine);
}

function writeLine(level: string, message: string): void {
  ensureSessionInitialized();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;
  appendLine(LOG_FILE, line);
  appendLine(SESSION_LOG_FILE, line);
}

export function logInfo(message: string): void {
  writeLine("INFO", message);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error ?? "");
  writeLine("ERROR", detail ? `${message} | ${detail}` : message);
}

export function getLogSessionInfo(): {
  sessionId: string;
  logDir: string;
  appLogPath: string;
  sessionLogPath: string;
} {
  ensureSessionInitialized();
  return {
    sessionId: SESSION_ID,
    logDir: LOG_DIR,
    appLogPath: LOG_FILE,
    sessionLogPath: SESSION_LOG_FILE
  };
}

function buildSessionId(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") +
    "_" +
    [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join("-") +
    `_pid${process.pid}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
