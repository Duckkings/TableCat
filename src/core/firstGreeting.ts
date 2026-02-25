import { PerceptionInput, RoleCard } from "../shared/types";
import { buildModelRequest } from "./modelRequest";

const FIRST_GREETING_INPUT: PerceptionInput = {
  source: "screen",
  content: "应用启动，用户尚未输入。请进行首次问候。"
};

export function buildFirstGreetingRequest(roleCard: RoleCard) {
  return buildModelRequest([FIRST_GREETING_INPUT], roleCard);
}
