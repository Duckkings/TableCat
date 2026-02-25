import { RoleCard } from "../shared/types";
import { appendMemory, saveRoleCard } from "./roleCard";
import { logInfo } from "./logger";

export function writeMemoryToRoleCard(
  roleCardPath: string,
  roleCard: RoleCard,
  memorySummary: string
): RoleCard {
  const updated = appendMemory(roleCard, memorySummary);
  saveRoleCard(roleCardPath, updated);
  logInfo("Memory summary written to role card");
  return updated;
}
