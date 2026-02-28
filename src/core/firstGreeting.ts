import { RoleCard } from "../shared/types";
import { buildModelRequest } from "./modelRequest";
import { buildFirstGreetingInput } from "./prompts";

export function buildFirstGreetingRequest(roleCard: RoleCard) {
  return buildModelRequest([buildFirstGreetingInput()], roleCard, "");
}
