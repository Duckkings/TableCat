import { ModelResponse, RoleCard } from "../shared/types";
import { buildMemoryEntry } from "./memoryEntry";
import { appendMemory, saveRoleCard } from "./roleCard";
import { logInfo } from "./logger";

export function writeMemoryToRoleCard(
  roleCardPath: string,
  roleCard: RoleCard,
  response: Pick<ModelResponse, "memory_summary" | "emotion" | "content">
): RoleCard {
  const memoryEntry = buildMemoryEntry(response);
  if (!memoryEntry) {
    logInfo("Memory writeback skipped because memory_summary is empty");
    return roleCard;
  }

  const updated = appendMemory(roleCard, memoryEntry);
  saveRoleCard(roleCardPath, updated);
  logInfo("Structured memory written to role card");
  return updated;
}
