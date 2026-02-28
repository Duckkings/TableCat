import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { buildFirstGreetingRequest } from "./core/firstGreeting";
import { requestModel } from "./core/openai";
import { handleModelError, handleModelResponse } from "./core/assistant";
import { loadRoleCard } from "./core/roleCard";
import { AppConfig, AppConfigPatch, loadAppConfig, updateAppConfig } from "./core/config";
import { buildModelRequest } from "./core/modelRequest";
import { openScreenshotSessionFolder } from "./core/perception/screenCapture";
import { PerceptionScheduler } from "./core/perception/scheduler";
import { ScreenAttentionLoop } from "./core/perception/attentionLoop";
import { buildApiTestRequest, buildPlaceholderInput, validatePromptCatalog } from "./core/prompts";
import { logError, logInfo } from "./core/logger";
import { ModelRequest, PerceptionInput, RoleCard } from "./shared/types";

let mainWindow: BrowserWindow | null = null;
let activeRoleCard: RoleCard | null = null;
let activeRoleCardPath: string | null = null;
let perceptionScheduler: PerceptionScheduler | null = null;
let screenAttentionLoop: ScreenAttentionLoop | null = null;
let perceptionInFlight = false;

function normalizeChineseGreeting(content: string): string {
  if (/[\u4e00-\u9fff]/.test(content)) {
    return content;
  }
  return "你好，我来了。今天想先做什么？";
}

function normalizePerceptionInterval(sec: number | undefined): number {
  const value = typeof sec === "number" ? sec : 5;
  return Math.min(30, Math.max(5, Math.floor(value)));
}

function resolveScreenAttentionEnabled(config: AppConfig): boolean {
  if (config.enable_screen === false) {
    return false;
  }
  if (typeof config.screen_attention_enabled === "boolean") {
    return config.screen_attention_enabled;
  }
  return config.enable_perception_loop === true;
}

function buildUiConfig(config: AppConfig) {
  return {
    bubbleTimeoutSec: config.bubble_timeout_sec ?? 3,
    enablePerceptionLoop: config.enable_perception_loop === true,
    perceptionIntervalSec: normalizePerceptionInterval(config.perception_interval_sec),
    enableScreen: config.enable_screen !== false,
    enableMic: config.enable_mic !== false,
    enableSystemAudio: config.enable_system_audio !== false,
    screenAttentionEnabled: resolveScreenAttentionEnabled(config)
  };
}

async function buildPerceptionInputs(config: AppConfig): Promise<PerceptionInput[]> {
  const now = new Date().toISOString();
  const inputs: PerceptionInput[] = [];

  if (config.enable_mic !== false) {
    inputs.push(buildPlaceholderInput("mic", now));
  }
  if (config.enable_system_audio !== false) {
    inputs.push(buildPlaceholderInput("system_audio", now));
  }
  return inputs;
}

function restartPerceptionScheduler(config: AppConfig): void {
  if (perceptionScheduler) {
    perceptionScheduler.stop();
    perceptionScheduler = null;
  }
  if (!config.enable_perception_loop) {
    logInfo("Perception scheduler disabled");
    return;
  }

  const shouldScheduleAnything =
    config.enable_mic !== false || config.enable_system_audio !== false;
  if (!shouldScheduleAnything) {
    logInfo("Perception scheduler skipped because mic/system_audio are disabled");
    return;
  }

  const intervalSec = normalizePerceptionInterval(config.perception_interval_sec);
  perceptionScheduler = new PerceptionScheduler(
    intervalSec * 1000,
    async () => buildPerceptionInputs(config)
  );
  perceptionScheduler.start((inputs) => {
    void handlePerceptionBatch(config, inputs);
  });
  logInfo(`Perception scheduler started interval=${intervalSec}s`);
}

function stopPerceptionScheduler(): void {
  if (!perceptionScheduler) {
    return;
  }
  perceptionScheduler.stop();
  perceptionScheduler = null;
  logInfo("Perception scheduler stopped");
}

function restartScreenAttention(config: AppConfig): void {
  stopScreenAttention();

  if (!resolveScreenAttentionEnabled(config)) {
    mainWindow?.webContents.send("debug:score", {
      active: false,
      finalScore: 0,
      excitementScore: 0,
      interruptScore: 0,
      noveltyScore: 0,
      visualDelta: 0,
      hashDistance: 0,
      clusterScore: 0,
      l0Pass: false,
      l1Pass: false,
      decision: "idle",
      reasons: ["attention_disabled"],
      ts: new Date().toISOString()
    });
    logInfo("Screen attention disabled");
    return;
  }

  screenAttentionLoop = new ScreenAttentionLoop(config, {
    onDebugState: (state) => {
      mainWindow?.webContents.send("debug:score", state);
    },
    onTrigger: async (input) => {
      await handlePerceptionBatch(config, [input]);
    }
  });
  screenAttentionLoop.start();
}

function stopScreenAttention(): void {
  if (!screenAttentionLoop) {
    return;
  }
  screenAttentionLoop.stop();
  screenAttentionLoop = null;
}

async function handlePerceptionBatch(config: AppConfig, inputs: PerceptionInput[]): Promise<void> {
  if (inputs.length === 0 || perceptionInFlight) {
    return;
  }
  if (!activeRoleCard || !activeRoleCardPath) {
    return;
  }

  perceptionInFlight = true;
  try {
    logInfo(`Perception tick sources=${inputs.map((item) => item.source).join(",")}`);
    const request = buildModelRequest(inputs, activeRoleCard);
    const raw = await requestModel(
      { apiKey: config.openai.api_key, model: config.openai.model },
      request
    );
    const result = handleModelResponse(raw, activeRoleCardPath, activeRoleCard);
    activeRoleCard = result.roleCard;
    mainWindow?.webContents.send("bubble:update", result.response.content);
  } catch (error) {
    handleModelError(error);
  } finally {
    perceptionInFlight = false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 420,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(process.cwd(), "src", "preload.js")
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setSkipTaskbar(true);
  mainWindow.loadFile(path.join(process.cwd(), "src", "app", "index.html"));
  logInfo("Main window created");
}

async function initializeAppSession(): Promise<void> {
  let config: AppConfig | null;
  let roleCard: RoleCard | null = null;

  try {
    config = loadAppConfig();
    if (!config) {
      mainWindow?.webContents.send("ui:config", { bubbleTimeoutSec: 3 });
      mainWindow?.webContents.send("bubble:update", "缺少 app.config.json");
      return;
    }

    validatePromptCatalog();
    mainWindow?.webContents.send("ui:config", buildUiConfig(config));
    roleCard = loadRoleCard(config.role_card_path);
    activeRoleCard = roleCard;
    activeRoleCardPath = config.role_card_path;
    mainWindow?.webContents.send("pet:icon", roleCard.pet_icon_path ?? "");
  } catch (error) {
    handleModelError(error);
    mainWindow?.webContents.send("bubble:update", "配置加载失败");
    return;
  }

  try {
    if (!roleCard) {
      return;
    }
    const request = buildFirstGreetingRequest(roleCard);
    const raw = await requestModel(
      { apiKey: config.openai.api_key, model: config.openai.model },
      request
    );
    if (!activeRoleCardPath) {
      return;
    }
    const result = handleModelResponse(raw, activeRoleCardPath, roleCard);
    activeRoleCard = result.roleCard;
    mainWindow?.webContents.send(
      "bubble:update",
      normalizeChineseGreeting(result.response.content)
    );
  } catch (error) {
    handleModelError(error);
    mainWindow?.webContents.send(
      "bubble:update",
      "首次问候失败：请检查网络或 API 配置"
    );
  }

  restartPerceptionScheduler(config);
  restartScreenAttention(config);
}

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
});

app.whenReady().then(() => {
  createWindow();

  mainWindow?.webContents.on("did-finish-load", () => {
    logInfo("Window did-finish-load");
    void initializeAppSession();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopPerceptionScheduler();
  stopScreenAttention();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopPerceptionScheduler();
  stopScreenAttention();
});

ipcMain.handle("rolecard:load", (_event, roleCardPath: string) => {
  logInfo(`IPC rolecard:load ${roleCardPath}`);
  const roleCard = loadRoleCard(roleCardPath);
  activeRoleCard = roleCard;
  activeRoleCardPath = roleCardPath;
  return roleCard;
});

ipcMain.handle("config:get", () => {
  logInfo("IPC config:get");
  return loadAppConfig();
});

ipcMain.handle("config:update", async (_event, patch: AppConfigPatch) => {
  logInfo("IPC config:update");
  let nextRoleCard: RoleCard | null = null;

  if (patch.role_card_path !== undefined) {
    nextRoleCard = loadRoleCard(patch.role_card_path);
  }

  const updated = updateAppConfig(patch);

  if (nextRoleCard) {
    activeRoleCard = nextRoleCard;
    activeRoleCardPath = updated.role_card_path;
    mainWindow?.webContents.send("pet:icon", nextRoleCard.pet_icon_path ?? "");
  }

  mainWindow?.webContents.send("ui:config", buildUiConfig(updated));
  restartPerceptionScheduler(updated);
  restartScreenAttention(updated);

  if (nextRoleCard && activeRoleCardPath) {
    try {
      const request = buildFirstGreetingRequest(nextRoleCard);
      const raw = await requestModel(
        { apiKey: updated.openai.api_key, model: updated.openai.model },
        request
      );
      const result = handleModelResponse(raw, activeRoleCardPath, nextRoleCard);
      activeRoleCard = result.roleCard;
      mainWindow?.webContents.send(
        "bubble:update",
        normalizeChineseGreeting(result.response.content)
      );
    } catch (error) {
      handleModelError(error);
      mainWindow?.webContents.send(
        "bubble:update",
        "角色已切换，但首次问候失败：请检查网络或 API 配置"
      );
    }
  }

  return updated;
});

ipcMain.handle("model:first-greeting", async (_event, config: { apiKey: string; model: string }) => {
  logInfo("IPC model:first-greeting");
  if (!activeRoleCard) {
    throw new Error("Role card not loaded");
  }
  const request = buildFirstGreetingRequest(activeRoleCard);
  const raw = await requestModel(config, request);
  if (!activeRoleCardPath) {
    throw new Error("Role card path missing");
  }
  const result = handleModelResponse(raw, activeRoleCardPath, activeRoleCard);
  activeRoleCard = result.roleCard;
  return result.response;
});

ipcMain.handle("model:request", async (
  _event,
  config: { apiKey: string; model: string },
  request: ModelRequest
) => {
  logInfo("IPC model:request");
  if (!activeRoleCard) {
    throw new Error("Role card not loaded");
  }
  const raw = await requestModel(config, request);
  if (!activeRoleCardPath) {
    throw new Error("Role card path missing");
  }
  const result = handleModelResponse(raw, activeRoleCardPath, activeRoleCard);
  activeRoleCard = result.roleCard;
  return result.response;
});

ipcMain.handle("chat:send", async (_event, text: string) => {
  logInfo("IPC chat:send");
  if (!activeRoleCard || !activeRoleCardPath) {
    throw new Error("Role card not loaded");
  }
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Chat text is empty");
  }

  const config = loadAppConfig();
  if (!config) {
    throw new Error("Missing app.config.json");
  }

  const request = buildModelRequest([{ source: "mic", content: text.trim() }], activeRoleCard);
  const raw = await requestModel(
    { apiKey: config.openai.api_key, model: config.openai.model },
    request
  );
  const result = handleModelResponse(raw, activeRoleCardPath, activeRoleCard);
  activeRoleCard = result.roleCard;
  mainWindow?.webContents.send("bubble:update", result.response.content);
  return result.response;
});

ipcMain.handle("api:test-connection", async () => {
  logInfo("IPC api:test-connection");
  const config = loadAppConfig();
  if (!config) {
    throw new Error("Missing app.config.json");
  }
  await requestModel(
    { apiKey: config.openai.api_key, model: config.openai.model },
    buildApiTestRequest()
  );
  return { ok: true };
});

ipcMain.handle("debug:open-screenshot-folder", async () => {
  logInfo("IPC debug:open-screenshot-folder");
  const folderPath = await openScreenshotSessionFolder();
  return { path: folderPath };
});
