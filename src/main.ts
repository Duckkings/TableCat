import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { buildFirstGreetingRequest } from "./core/firstGreeting";
import { requestModel } from "./core/openai";
import { handleModelResponse, handleModelError } from "./core/assistant";
import { loadRoleCard } from "./core/roleCard";
import { AppConfig, AppConfigPatch, loadAppConfig, updateAppConfig } from "./core/config";
import { buildModelRequest } from "./core/modelRequest";
import { PerceptionScheduler } from "./core/perception/scheduler";
import { logError, logInfo } from "./core/logger";
import { ModelRequest, PerceptionInput, RoleCard } from "./shared/types";

let mainWindow: BrowserWindow | null = null;
let activeRoleCard: RoleCard | null = null;
let activeRoleCardPath: string | null = null;
let perceptionScheduler: PerceptionScheduler | null = null;
let perceptionInFlight = false;

function normalizeChineseGreeting(content: string): string {
  if (/[\u4e00-\u9fff]/.test(content)) {
    return content;
  }
  return "你好呀，我来啦。今天想先做什么？";
}

function normalizePerceptionInterval(sec: number | undefined): number {
  const value = typeof sec === "number" ? sec : 5;
  return Math.min(30, Math.max(5, Math.floor(value)));
}

function buildUiConfig(config: AppConfig) {
  return {
    bubbleTimeoutSec: config.bubble_timeout_sec ?? 3,
    enablePerceptionLoop: config.enable_perception_loop === true,
    perceptionIntervalSec: normalizePerceptionInterval(config.perception_interval_sec),
    enableScreen: config.enable_screen !== false,
    enableMic: config.enable_mic !== false,
    enableSystemAudio: config.enable_system_audio !== false
  };
}

function buildPlaceholderPerceptionInputs(config: AppConfig): PerceptionInput[] {
  const now = new Date().toISOString();
  const inputs: PerceptionInput[] = [];
  if (config.enable_screen !== false) {
    inputs.push({ source: "screen", content: `占位截图感知 ${now}` });
  }
  if (config.enable_mic !== false) {
    inputs.push({ source: "mic", content: `占位麦克风感知 ${now}` });
  }
  if (config.enable_system_audio !== false) {
    inputs.push({ source: "system_audio", content: `占位系统音频感知 ${now}` });
  }
  return inputs;
}

function restartPerceptionScheduler(config: AppConfig): void {
  if (perceptionScheduler) {
    perceptionScheduler.stop();
    perceptionScheduler = null;
  }
  if (!config.enable_perception_loop) {
    logInfo("Perception loop disabled");
    return;
  }
  const intervalSec = normalizePerceptionInterval(config.perception_interval_sec);
  perceptionScheduler = new PerceptionScheduler(
    intervalSec * 1000,
    async () => buildPlaceholderPerceptionInputs(config)
  );
  perceptionScheduler.start((inputs) => {
    void handlePerceptionBatch(config, inputs);
  });
  logInfo(`Perception loop started interval=${intervalSec}s`);
}

function stopPerceptionScheduler(): void {
  if (!perceptionScheduler) {
    return;
  }
  perceptionScheduler.stop();
  perceptionScheduler = null;
  logInfo("Perception loop stopped");
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

function createWindow() {
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

  const indexPath = path.join(process.cwd(), "src", "app", "index.html");
  mainWindow.loadFile(indexPath);
  logInfo("Main window created");
}

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
});

app.whenReady().then(() => {
  createWindow();

  mainWindow?.webContents.on("did-finish-load", async () => {
    logInfo("Window did-finish-load");

    let config: ReturnType<typeof loadAppConfig>;
    let card: RoleCard;

    try {
      config = loadAppConfig();
      if (!config) {
        mainWindow?.webContents.send("ui:config", { bubbleTimeoutSec: 3 });
        mainWindow?.webContents.send("bubble:update", "缺少 app.config.json");
        return;
      }
      mainWindow?.webContents.send("ui:config", buildUiConfig(config));
      card = loadRoleCard(config.role_card_path);
      activeRoleCard = card;
      activeRoleCardPath = config.role_card_path;
      mainWindow?.webContents.send("pet:icon", card.pet_icon_path ?? "");
    } catch (error) {
      handleModelError(error);
      mainWindow?.webContents.send("bubble:update", "配置加载失败");
      return;
    }

    try {
      const request = buildFirstGreetingRequest(card);
      const raw = await requestModel(
        { apiKey: config.openai.api_key, model: config.openai.model },
        request
      );
      if (!activeRoleCardPath) {
        return;
      }
      const result = handleModelResponse(raw, activeRoleCardPath, card);
      activeRoleCard = result.roleCard;
      mainWindow?.webContents.send(
        "bubble:update",
        normalizeChineseGreeting(result.response.content)
      );
    } catch (error) {
      handleModelError(error);
      mainWindow?.webContents.send("bubble:update", "首次问候失败：请检查网络或 API 配置");
    }

    restartPerceptionScheduler(config);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopPerceptionScheduler();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopPerceptionScheduler();
});

ipcMain.handle("rolecard:load", (_event, roleCardPath: string) => {
  logInfo(`IPC rolecard:load ${roleCardPath}`);
  const card = loadRoleCard(roleCardPath);
  activeRoleCard = card;
  activeRoleCardPath = roleCardPath;
  return card;
});

ipcMain.handle("config:get", () => {
  logInfo("IPC config:get");
  return loadAppConfig();
});

ipcMain.handle("config:update", async (
  _event,
  patch: AppConfigPatch
) => {
  logInfo("IPC config:update");
  let nextCard: RoleCard | null = null;
  if (patch.role_card_path !== undefined) {
    nextCard = loadRoleCard(patch.role_card_path);
  }

  const updated = updateAppConfig(patch);

  if (nextCard) {
    activeRoleCard = nextCard;
    activeRoleCardPath = updated.role_card_path;
    mainWindow?.webContents.send("pet:icon", nextCard.pet_icon_path ?? "");
  }

  mainWindow?.webContents.send("ui:config", buildUiConfig(updated));
  restartPerceptionScheduler(updated);

  if (nextCard && activeRoleCardPath) {
    try {
      const request = buildFirstGreetingRequest(nextCard);
      const raw = await requestModel(
        { apiKey: updated.openai.api_key, model: updated.openai.model },
        request
      );
      const result = handleModelResponse(raw, activeRoleCardPath, nextCard);
      activeRoleCard = result.roleCard;
      mainWindow?.webContents.send(
        "bubble:update",
        normalizeChineseGreeting(result.response.content)
      );
    } catch (error) {
      handleModelError(error);
      mainWindow?.webContents.send("bubble:update", "切换成功，但首次问候失败：请检查网络或 API 配置");
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

  const request = buildModelRequest(
    [{ source: "mic", content: text.trim() }],
    activeRoleCard
  );
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
    {
      inputs: [{ source: "screen", content: "API 连通性测试，请回复 ok。" }],
      role_prompt: "你是连接测试助手，只回复 ok。",
      default_prompt: "只输出纯文本 ok。"
    }
  );
  return { ok: true };
});
