import { DEFAULT_ROLE_PROMPT } from "../shared/defaults";
import { ModelRequest, PerceptionInput, RoleCard } from "../shared/types";

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
    default_prompt: DEFAULT_ROLE_PROMPT
  };
}
