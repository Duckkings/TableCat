import { ModelResponse } from "../shared/types";
import { logError, logInfo } from "./logger";

export class ResponseParseError extends Error {}

export function parseModelResponse(raw: string): ModelResponse {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    logError("Response parse fell back to plain text", buildRawPreview(trimmed));
    return buildFallbackResponse(trimmed);
  }

  const jsonText = trimmed.slice(jsonStart, jsonEnd + 1);
  try {
    const parsed = JSON.parse(jsonText) as Partial<ModelResponse>;
    validateResponse(parsed);
    logInfo("Model response parsed");
    return parsed as ModelResponse;
  } catch (error) {
    logError("Response parse JSON decode failed, falling back to plain text", error);
    return buildFallbackResponse(trimmed);
  }
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

function buildFallbackResponse(raw: string): ModelResponse {
  const content = raw.trim() || "（空回复）";
  return {
    reasoning: "",
    emotion: "neutral",
    content,
    memory_summary: ""
  };
}

function buildRawPreview(raw: string): Error {
  const preview = raw.length > 400 ? `${raw.slice(0, 400)}...` : raw;
  return new Error(preview || "(empty)");
}
