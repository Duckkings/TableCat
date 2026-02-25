import { ModelResponse, RoleCard } from "../shared/types";
import { parseModelResponse } from "./responseParser";
import { writeMemoryToRoleCard } from "./memory";
import { logError, logInfo } from "./logger";

export function handleModelResponse(
  raw: string,
  roleCardPath: string,
  roleCard: RoleCard
): { response: ModelResponse; roleCard: RoleCard } {
  logInfo("Handling model response");
  const response = parseModelResponse(raw);
  const updatedRoleCard = writeMemoryToRoleCard(
    roleCardPath,
    roleCard,
    response.memory_summary
  );
  logInfo("Memory writeback completed");
  return { response, roleCard: updatedRoleCard };
}

export function handleModelError(error: unknown): void {
  logError("Model handling failed", error);
}
