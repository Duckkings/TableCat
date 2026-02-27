import { PerceptionInput, RoleCard } from "../shared/types";
import { buildModelRequest } from "./modelRequest";

const FIRST_GREETING_INPUT: PerceptionInput = {
  source: "screen",
  content: "应用刚启动，用户尚未输入。请忽略历史记忆，用中文做一句简短友好的首次问候。必须使用中文，不得使用英文。"
};

export function buildFirstGreetingRequest(roleCard: RoleCard) {
  return buildModelRequest([FIRST_GREETING_INPUT], roleCard, "");
}
