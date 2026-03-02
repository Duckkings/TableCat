import { ModelRequest, PerceptionInput, RoleCard } from "../shared/types";
import { formatMemoryEntriesForPrompt } from "./memoryEntry";
import { buildDefaultSystemPrompt } from "./prompts";

export function buildModelRequest(
  inputs: PerceptionInput[],
  roleCard: RoleCard,
  memory?: string
): ModelRequest {
  const memoryText = memory ?? formatMemoryEntriesForPrompt(roleCard.memory);
  return {
    inputs,
    memory: memoryText || undefined,
    role_prompt: roleCard.prompt,
    default_prompt: buildDefaultSystemPrompt()
  };
}
