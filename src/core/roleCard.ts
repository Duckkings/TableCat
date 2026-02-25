import { readFileSync, writeFileSync } from "fs";
import { RoleCard } from "../shared/types";
import { logError, logInfo } from "./logger";

export class RoleCardError extends Error {}

export function loadRoleCard(path: string): RoleCard {
  const raw = readFileSync(path, "utf8");
  const normalized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const parsed = JSON.parse(normalized) as Partial<RoleCard>;
  validateRoleCard(parsed);
  logInfo(`Role card loaded: ${path}`);
  return parsed as RoleCard;
}

export function saveRoleCard(path: string, roleCard: RoleCard): void {
  const json = JSON.stringify(roleCard, null, 2);
  writeFileSync(path, json, "utf8");
  logInfo(`Role card saved: ${path}`);
}

export function appendMemory(roleCard: RoleCard, memorySummary: string): RoleCard {
  const memory = roleCard.memory ?? [];
  return {
    ...roleCard,
    memory: [...memory, memorySummary]
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
  if (card.scale !== undefined && typeof card.scale !== "number") {
    const error = new RoleCardError("Role card scale must be a number");
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
  if (card.memory !== undefined && !Array.isArray(card.memory)) {
    const error = new RoleCardError("Role card memory must be an array of strings");
    logError("Role card validation failed", error);
    throw error;
  }
}
