import { ModelRequest, PerceptionInput, RoleCard } from "../shared/types";
import { buildDefaultSystemPrompt } from "./prompts";

export function buildModelRequest(
  inputs: PerceptionInput[],
  roleCard: RoleCard,
  memory?: string
): ModelRequest {
  const memoryText = memory ?? roleCard.memory?.join("\n");
  return {
    inputs,
    memory: memoryText,
    role_prompt: roleCard.prompt,
    default_prompt: buildDefaultSystemPrompt()
  };
}
