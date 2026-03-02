import { readFileSync, writeFileSync } from "fs";
import { MemoryEntry, RoleCard } from "../shared/types";
import {
  MAX_ROLE_CARD_SCALE,
  MIN_ROLE_CARD_SCALE,
  normalizeMemoryEntries,
  normalizeRoleCardScale
} from "./memoryEntry";
import { logError, logInfo } from "./logger";

export class RoleCardError extends Error {}

export function loadRoleCard(path: string): RoleCard {
  const raw = readFileSync(path, "utf8");
  const normalized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const parsed = JSON.parse(normalized) as Partial<RoleCard>;
  const { roleCard, migrated } = normalizeRoleCard(parsed);
  validateRoleCard(roleCard);
  if (migrated) {
    saveRoleCard(path, roleCard as RoleCard);
    logInfo(`Role card migrated: ${path}`);
  }
  logInfo(`Role card loaded: ${path}`);
  return roleCard as RoleCard;
}

export function saveRoleCard(path: string, roleCard: RoleCard): void {
  const json = JSON.stringify(roleCard, null, 2);
  writeFileSync(path, json, "utf8");
  logInfo(`Role card saved: ${path}`);
}

export function appendMemory(roleCard: RoleCard, memoryEntry: MemoryEntry): RoleCard {
  const memory = roleCard.memory ?? [];
  return {
    ...roleCard,
    memory: [...memory, memoryEntry]
  };
}

export function updateRoleCardScale(roleCard: RoleCard, scale: number): RoleCard {
  return {
    ...roleCard,
    scale: normalizeRoleCardScale(scale)
  };
}

function normalizeRoleCard(card: Partial<RoleCard>): { roleCard: Partial<RoleCard>; migrated: boolean } {
  const { entries, migrated } = normalizeMemoryEntries(card.memory);
  const normalizedScale =
    card.scale === undefined ? undefined : normalizeRoleCardScale(card.scale);
  const scaleMigrated = normalizedScale !== card.scale;

  return {
    roleCard: {
      ...card,
      scale: normalizedScale,
      memory: entries
    },
    migrated: migrated || scaleMigrated
  };
}

function validateRoleCard(card: Partial<RoleCard>): void {
  if (!card || typeof card !== "object") {
    const error = new RoleCardError("Role card must be a JSON object");
    logError("Role card validation failed", error);
    throw error;
  }
  if (typeof card.name !== "string" || card.name.trim() === "") {
    const error = new RoleCardError("Role card requires a non-empty name");
    logError("Role card validation failed", error);
    throw error;
  }
  if (typeof card.prompt !== "string" || card.prompt.trim() === "") {
    const error = new RoleCardError("Role card requires a non-empty prompt");
    logError("Role card validation failed", error);
    throw error;
  }
  if (
    card.scale !== undefined &&
    (typeof card.scale !== "number" ||
      Number.isNaN(card.scale) ||
      card.scale < MIN_ROLE_CARD_SCALE ||
      card.scale > MAX_ROLE_CARD_SCALE)
  ) {
    const error = new RoleCardError(
      `Role card scale must be a number between ${MIN_ROLE_CARD_SCALE} and ${MAX_ROLE_CARD_SCALE}`
    );
    logError("Role card validation failed", error);
    throw error;
  }
  if (card.wake_word !== undefined && typeof card.wake_word !== "string") {
    const error = new RoleCardError("Role card wake_word must be a string");
    logError("Role card validation failed", error);
    throw error;
  }
  if (card.pet_icon_path !== undefined && typeof card.pet_icon_path !== "string") {
    const error = new RoleCardError("Role card pet_icon_path must be a string");
    logError("Role card validation failed", error);
    throw error;
  }
  if (card.memory !== undefined) {
    if (
      !Array.isArray(card.memory) ||
      card.memory.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          typeof item.返回时间 !== "string" ||
          typeof item.回复时的心情 !== "string" ||
          typeof item.记忆内容 !== "string"
      )
    ) {
      const error = new RoleCardError("Role card memory must be an array of structured memory objects");
      logError("Role card validation failed", error);
      throw error;
    }
  }
}
