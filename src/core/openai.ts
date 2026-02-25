import { ModelRequest } from "../shared/types";
import { logError, logInfo } from "./logger";

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

export async function requestModel(
  config: OpenAIConfig,
  request: ModelRequest
): Promise<string> {
  logInfo(`OpenAI request model=${config.model}`);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildMessages(request)
    })
  });

  if (!response.ok) {
    const error = new Error(`OpenAI request failed: ${response.status}`);
    logError("OpenAI request failed", error);
    throw error;
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("OpenAI response missing content");
    logError("OpenAI response missing content", error);
    throw error;
  }
  logInfo("OpenAI response received");
  return content;
}

function buildMessages(request: ModelRequest) {
  const memoryText = request.memory ? `\n记忆: ${request.memory}` : "";
  const inputs = request.inputs
    .map((input) => `[source:${input.source}] ${input.content}`)
    .join("\n");

  const systemContent = `${request.default_prompt}\n${request.role_prompt}`;
  const userContent = `${inputs}${memoryText}`;

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
}
