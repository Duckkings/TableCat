import { MemoryEntry, ModelResponse } from "../shared/types";

export const MIN_ROLE_CARD_SCALE = 1;
export const MAX_ROLE_CARD_SCALE = 20;

const DEFAULT_EMOTION = "平静";

const EMOTION_LABEL_MAP: Record<string, string> = {
  neutral: "平静",
  calm: "平静",
  happy: "开心",
  playful: "调皮",
  curious: "好奇",
  excited: "兴奋",
  annoyed: "嫌弃",
  sarcastic: "吐槽",
  caring: "关心",
  sleepy: "困倦",
  shy: "害羞",
  surprised: "惊讶",
  focused: "认真"
};

export function buildMemoryEntry(
  response: Pick<ModelResponse, "memory_summary" | "emotion" | "content">
): MemoryEntry | null {
  const memoryContent = normalizeMemoryContent(response.memory_summary, response.content);
  if (!memoryContent) {
    return null;
  }

  return {
    返回时间: formatReplyTimestamp(new Date()),
    回复时的心情: normalizeEmotionLabel(response.emotion),
    记忆内容: memoryContent
  };
}

export function normalizeMemoryEntries(memory: unknown): {
  entries?: MemoryEntry[];
  migrated: boolean;
} {
  if (memory === undefined) {
    return { entries: undefined, migrated: false };
  }
  if (!Array.isArray(memory)) {
    throw new Error("Role card memory must be an array");
  }

  const entries: MemoryEntry[] = [];
  let migrated = false;

  for (const item of memory) {
    const normalized = normalizeMemoryEntryItem(item);
    if (!normalized) {
      migrated = true;
      continue;
    }
    migrated ||= normalized.migrated;
    entries.push(normalized.entry);
  }

  return { entries, migrated };
}

export function formatMemoryEntriesForPrompt(memory?: MemoryEntry[]): string | undefined {
  const lines = memory?.map((entry) => formatMemoryEntry(entry)).filter(Boolean);
  if (!lines || lines.length === 0) {
    return undefined;
  }
  return lines.join("\n");
}

export function formatMemoryEntry(entry: MemoryEntry): string {
  return JSON.stringify(entry);
}

export function normalizeRoleCardScale(scale: number | undefined): number {
  if (typeof scale !== "number" || Number.isNaN(scale)) {
    return 1;
  }
  return clampScale(scale);
}

function normalizeMemoryEntryItem(item: unknown): { entry: MemoryEntry; migrated: boolean } | null {
  if (typeof item === "string") {
    return normalizeMemoryString(item);
  }
  if (item && typeof item === "object") {
    const entry = normalizeMemoryObject(item as Record<string, unknown>);
    return entry ? { entry, migrated: !isMemoryEntry(item) } : null;
  }
  throw new Error("Role card memory items must be objects or strings");
}

function normalizeMemoryString(value: string): { entry: MemoryEntry; migrated: boolean } | null {
  const trimmed = normalizeSingleLine(value);
  if (!trimmed) {
    return null;
  }

  const parsed = tryParseMemoryJson(trimmed);
  if (parsed) {
    return { entry: parsed, migrated: true };
  }

  return {
    entry: {
      返回时间: formatReplyTimestamp(new Date()),
      回复时的心情: DEFAULT_EMOTION,
      记忆内容: trimmed
    },
    migrated: true
  };
}

function tryParseMemoryJson(value: string): MemoryEntry | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return normalizeMemoryObject(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

function normalizeMemoryObject(value: Record<string, unknown>): MemoryEntry | null {
  const returnedAt = pickString(value, ["返回时间", "returned_at", "reply_time"]);
  const emotion = pickString(value, ["回复时的心情", "emotion", "mood"]);
  const content = pickString(value, ["记忆内容", "content", "memory_content", "memory"]);

  const normalizedContent = normalizeSingleLine(content);
  if (!normalizedContent) {
    return null;
  }

  return {
    返回时间: normalizeSingleLine(returnedAt) || formatReplyTimestamp(new Date()),
    回复时的心情: normalizeEmotionLabel(emotion),
    记忆内容: normalizedContent
  };
}

function pickString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof value[key] === "string") {
      return value[key] as string;
    }
  }
  return "";
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<MemoryEntry>;
  return (
    typeof candidate.返回时间 === "string" &&
    typeof candidate.回复时的心情 === "string" &&
    typeof candidate.记忆内容 === "string"
  );
}

function normalizeMemoryContent(memorySummary: string, content: string): string {
  const summary = normalizeSingleLine(memorySummary);
  if (summary && containsChinese(summary)) {
    return summary;
  }

  const replyContent = normalizeSingleLine(content);
  if (containsChinese(replyContent)) {
    return `本轮回复要点：${replyContent.slice(0, 120)}`;
  }

  return "";
}

function normalizeEmotionLabel(emotion: string): string {
  const normalized = normalizeSingleLine(emotion);
  if (!normalized) {
    return DEFAULT_EMOTION;
  }
  if (containsChinese(normalized)) {
    return normalized;
  }

  const mapped = EMOTION_LABEL_MAP[normalized.toLowerCase()];
  return mapped ?? DEFAULT_EMOTION;
}

function formatReplyTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
  const offsetRemainderMinutes = absoluteOffsetMinutes % 60;

  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-") +
    " " +
    [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join(":") +
    ` ${sign}${pad2(offsetHours)}:${pad2(offsetRemainderMinutes)}`;
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function clampScale(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(MAX_ROLE_CARD_SCALE, Math.max(MIN_ROLE_CARD_SCALE, rounded));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
