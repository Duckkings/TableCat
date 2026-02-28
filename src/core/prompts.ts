import { existsSync, readFileSync } from "fs";
import path from "path";
import { ModelRequest, PerceptionInput, PerceptionSource } from "../shared/types";
import { logError } from "./logger";

type PromptKind = "system" | "input" | "placeholder";

interface PromptRow {
  key: string;
  kind: PromptKind;
  source: string;
  description: string;
  template: string;
}

type PromptKey =
  | "default_system_prompt"
  | "memory_block"
  | "screen_input_template"
  | "mic_input_template"
  | "system_audio_input_template"
  | "first_greeting_input"
  | "placeholder_screen_content"
  | "placeholder_mic_content"
  | "placeholder_system_audio_content"
  | "api_test_default_prompt"
  | "api_test_role_prompt"
  | "api_test_input";

const PROMPTS_CSV_PATH = path.join(process.cwd(), "prompts.csv");
const REQUIRED_PROMPT_KEYS: PromptKey[] = [
  "default_system_prompt",
  "memory_block",
  "screen_input_template",
  "mic_input_template",
  "system_audio_input_template",
  "first_greeting_input",
  "placeholder_screen_content",
  "placeholder_mic_content",
  "placeholder_system_audio_content",
  "api_test_default_prompt",
  "api_test_role_prompt",
  "api_test_input"
];

const INPUT_TEMPLATE_BY_SOURCE: Record<PerceptionSource, PromptKey> = {
  screen: "screen_input_template",
  mic: "mic_input_template",
  system_audio: "system_audio_input_template"
};

const PLACEHOLDER_TEMPLATE_BY_SOURCE: Record<PerceptionSource, PromptKey> = {
  screen: "placeholder_screen_content",
  mic: "placeholder_mic_content",
  system_audio: "placeholder_system_audio_content"
};

export function validatePromptCatalog(): void {
  void loadPromptCatalog();
}

export function buildDefaultSystemPrompt(): string {
  return getPromptTemplate("default_system_prompt");
}

export function buildFormattedInput(input: PerceptionInput): string {
  const templateKey = INPUT_TEMPLATE_BY_SOURCE[input.source];
  return formatPromptTemplate(getPromptTemplate(templateKey), {
    content: input.content
  });
}

export function buildMemoryBlock(memory: string): string {
  return formatPromptTemplate(getPromptTemplate("memory_block"), {
    memory
  });
}

export function buildFirstGreetingInput(): PerceptionInput {
  return {
    source: "screen",
    content: getPromptTemplate("first_greeting_input")
  };
}

export function buildPlaceholderInput(
  source: PerceptionSource,
  timestamp: string
): PerceptionInput {
  const templateKey = PLACEHOLDER_TEMPLATE_BY_SOURCE[source];
  return {
    source,
    content: formatPromptTemplate(getPromptTemplate(templateKey), {
      timestamp
    })
  };
}

export function buildApiTestRequest(): ModelRequest {
  return {
    inputs: [
      {
        source: "screen",
        content: getPromptTemplate("api_test_input")
      }
    ],
    role_prompt: getPromptTemplate("api_test_role_prompt"),
    default_prompt: getPromptTemplate("api_test_default_prompt")
  };
}

function getPromptTemplate(key: PromptKey): string {
  const catalog = loadPromptCatalog();
  const row = catalog.get(key);
  if (!row) {
    const error = new Error(`Missing prompt template: ${key}`);
    logError("Prompt lookup failed", error);
    throw error;
  }
  return row.template;
}

function loadPromptCatalog(): Map<string, PromptRow> {
  if (!existsSync(PROMPTS_CSV_PATH)) {
    const error = new Error(`Prompt catalog not found: ${PROMPTS_CSV_PATH}`);
    logError("Prompt catalog load failed", error);
    throw error;
  }

  const raw = readFileSync(PROMPTS_CSV_PATH, "utf8");
  const rows = parsePromptCsv(raw);
  const catalog = new Map<string, PromptRow>();

  for (const row of rows) {
    validatePromptRow(row);
    if (catalog.has(row.key)) {
      const error = new Error(`Duplicate prompt key: ${row.key}`);
      logError("Prompt catalog validation failed", error);
      throw error;
    }
    catalog.set(row.key, row);
  }

  for (const key of REQUIRED_PROMPT_KEYS) {
    if (!catalog.has(key)) {
      const error = new Error(`Prompt catalog missing required key: ${key}`);
      logError("Prompt catalog validation failed", error);
      throw error;
    }
  }

  return catalog;
}

function validatePromptRow(row: PromptRow): void {
  if (row.key.trim() === "") {
    const error = new Error("Prompt key cannot be empty");
    logError("Prompt catalog validation failed", error);
    throw error;
  }
  if (!["system", "input", "placeholder"].includes(row.kind)) {
    const error = new Error(`Invalid prompt kind: ${row.kind}`);
    logError("Prompt catalog validation failed", error);
    throw error;
  }
  if (
    row.source !== "" &&
    row.source !== "screen" &&
    row.source !== "mic" &&
    row.source !== "system_audio"
  ) {
    const error = new Error(`Invalid prompt source: ${row.source}`);
    logError("Prompt catalog validation failed", error);
    throw error;
  }
  if (row.template.trim() === "") {
    const error = new Error(`Prompt template cannot be empty: ${row.key}`);
    logError("Prompt catalog validation failed", error);
    throw error;
  }
}

function parsePromptCsv(raw: string): PromptRow[] {
  const normalized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const rows = parseCsv(normalized).filter((row) => row.some((value) => value.trim() !== ""));
  if (rows.length < 2) {
    const error = new Error("Prompt catalog must include a header row and data rows");
    logError("Prompt catalog validation failed", error);
    throw error;
  }

  const header = rows[0].map((value) => value.trim());
  const expectedHeader = ["key", "kind", "source", "description", "template"];
  if (
    header.length !== expectedHeader.length ||
    header.some((value, index) => value !== expectedHeader[index])
  ) {
    const error = new Error("Prompt catalog header must be key,kind,source,description,template");
    logError("Prompt catalog validation failed", error);
    throw error;
  }

  return rows.slice(1).map((row) => ({
    key: (row[0] ?? "").trim(),
    kind: ((row[1] ?? "").trim() as PromptKind),
    source: (row[2] ?? "").trim(),
    description: (row[3] ?? "").trim(),
    template: row[4] ?? ""
  }));
}

function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const nextChar = raw[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (nextChar === "\"") {
          currentCell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }
    currentCell += char;
  }

  if (inQuotes) {
    const error = new Error("Prompt catalog has an unterminated quoted field");
    logError("Prompt catalog validation failed", error);
    throw error;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows;
}

function formatPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => variables[key] ?? "");
}
