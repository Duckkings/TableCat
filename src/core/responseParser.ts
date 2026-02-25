import { ModelResponse } from "../shared/types";
import { logError, logInfo } from "./logger";

export class ResponseParseError extends Error {}

export function parseModelResponse(raw: string): ModelResponse {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    const error = new ResponseParseError("Model response is not JSON");
    logError("Response parse failed", error);
    throw error;
  }
  const jsonText = trimmed.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonText) as Partial<ModelResponse>;
  validateResponse(parsed);
  logInfo("Model response parsed");
  return parsed as ModelResponse;
}

export function validateResponse(parsed: Partial<ModelResponse>): void {
  if (typeof parsed.reasoning !== "string") {
    const error = new ResponseParseError("Missing reasoning field");
    logError("Response validation failed", error);
    throw error;
  }
  if (typeof parsed.emotion !== "string") {
    const error = new ResponseParseError("Missing emotion field");
    logError("Response validation failed", error);
    throw error;
  }
  if (typeof parsed.content !== "string") {
    const error = new ResponseParseError("Missing content field");
    logError("Response validation failed", error);
    throw error;
  }
  if (typeof parsed.memory_summary !== "string") {
    const error = new ResponseParseError("Missing memory_summary field");
    logError("Response validation failed", error);
    throw error;
  }
}
