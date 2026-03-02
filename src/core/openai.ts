import { readFileSync } from "fs";
import { spawn } from "child_process";
import { ModelRequest, PerceptionInput } from "../shared/types";
import { logError, logInfo } from "./logger";
import { buildFormattedInput, buildMemoryBlock } from "./prompts";

export interface OpenAIConfig {
  apiKey: string;
  model: string;
}

type ChatMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function requestModel(
  config: OpenAIConfig,
  request: ModelRequest
): Promise<string> {
  logInfo(`OpenAI request model=${config.model}`);
  const payload = JSON.stringify({
    model: config.model,
    messages: buildMessages(request),
    response_format: {
      type: "json_object"
    }
  });

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: payload
    });
  } catch (error) {
    if (process.platform === "win32") {
      logInfo("Fetch failed, falling back to PowerShell request");
      return requestModelViaPowerShell(config, payload);
    }
    throw error;
  }

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

export async function testOpenAIConnection(config: OpenAIConfig): Promise<void> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      }
    });
    if (!response.ok) {
      const error = new Error(`OpenAI connectivity test failed: ${response.status}`);
      logError("OpenAI connectivity test failed", error);
      throw error;
    }
    logInfo("OpenAI connectivity test passed");
    return;
  } catch (error) {
    if (process.platform !== "win32") {
      throw error;
    }
    logInfo("Connectivity test fetch failed, falling back to PowerShell request");
    await testOpenAIConnectionViaPowerShell(config);
  }
}

async function requestModelViaPowerShell(
  config: OpenAIConfig,
  payload: string
): Promise<string> {
  const apiKeyBase64 = Buffer.from(config.apiKey, "utf8").toString("base64");
  const payloadBase64 = Buffer.from(payload, "utf8").toString("base64");

  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$apiKey = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${apiKeyBase64}'))`,
    `$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payloadBase64}'))`,
    "$payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)",
    "Add-Type -AssemblyName System.Net.Http",
    "$handler = New-Object System.Net.Http.HttpClientHandler",
    "$client = New-Object System.Net.Http.HttpClient($handler)",
    "$client.Timeout = [TimeSpan]::FromSeconds(60)",
    "$request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, 'https://api.openai.com/v1/chat/completions')",
    "$request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $apiKey)",
    "$request.Content = New-Object System.Net.Http.ByteArrayContent($payloadBytes)",
    "$request.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/json; charset=utf-8')",
    "$response = $client.SendAsync($request).GetAwaiter().GetResult()",
    "if (-not $response.IsSuccessStatusCode) { throw \"OpenAI request failed: $([int]$response.StatusCode)\" }",
    "$responseBytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()",
    "$responseJson = [System.Text.Encoding]::UTF8.GetString($responseBytes)",
    "$data = $responseJson | ConvertFrom-Json",
    "if (-not $data.choices -or -not $data.choices[0].message.content) { throw 'OpenAI response missing content' }",
    "$content = [string]$data.choices[0].message.content",
    "$contentBase64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($content))",
    "Write-Output $contentBase64"
  ].join("\n");

  const contentBase64 = await runPowerShell(script);
  if (!contentBase64) {
    const error = new Error("OpenAI response missing content");
    logError("PowerShell OpenAI response missing content", error);
    throw error;
  }
  const content = Buffer.from(contentBase64, "base64").toString("utf8");

  logInfo("OpenAI response received via PowerShell");
  return content;
}

async function testOpenAIConnectionViaPowerShell(
  config: OpenAIConfig
): Promise<void> {
  const apiKeyBase64 = Buffer.from(config.apiKey, "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$apiKey = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${apiKeyBase64}'))`,
    "$headers = @{ Authorization = \"Bearer $apiKey\" }",
    "$response = Invoke-RestMethod -Uri 'https://api.openai.com/v1/models' -Method Get -Headers $headers -TimeoutSec 30",
    "if (-not $response.data) { throw 'OpenAI connectivity test failed' }",
    "Write-Output OK"
  ].join("\n");

  const output = await runPowerShell(script);
  if (output !== "OK") {
    const error = new Error("OpenAI connectivity test failed");
    logError("PowerShell OpenAI connectivity test failed", error);
    throw error;
  }
  logInfo("OpenAI connectivity test passed via PowerShell");
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      logError("PowerShell process failed", error);
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const error = new Error(`PowerShell OpenAI request failed: ${stderr || stdout}`);
      logError("PowerShell OpenAI request failed", error);
      reject(error);
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

function buildMessages(request: ModelRequest) {
  const systemContent = `${request.default_prompt}\n${request.role_prompt}`;
  const userContent = buildUserContentParts(request.inputs, request.memory);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
}

function buildUserContentParts(
  inputs: PerceptionInput[],
  memory?: string
): ChatMessageContentPart[] {
  const parts: ChatMessageContentPart[] = [];

  for (const input of inputs) {
    parts.push({
      type: "text",
      text: buildFormattedInput(input)
    });
    if (input.attachments && input.attachments.length > 0) {
      for (const attachment of input.attachments) {
        parts.push({
          type: "image_url",
          image_url: {
            url: buildImageDataUrl(attachment.path, attachment.mime_type)
          }
        });
      }
      continue;
    }
    if (input.source === "screen" && input.image_path) {
      parts.push({
        type: "image_url",
        image_url: {
          url: buildImageDataUrl(input.image_path, input.image_mime_type ?? "image/png")
        }
      });
    }
  }

  if (memory) {
    parts.push({
      type: "text",
      text: buildMemoryBlock(memory)
    });
  }

  return parts;
}

function buildImageDataUrl(filePath: string, mimeType: string): string {
  const base64 = readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}
