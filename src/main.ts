import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { buildFirstGreetingRequest } from "./core/firstGreeting";
import { requestModel, testOpenAIConnection } from "./core/openai";
import { handleModelError, handleModelResponse } from "./core/assistant";
import { loadRoleCard, saveRoleCard, updateRoleCardScale } from "./core/roleCard";
import { AppConfig, AppConfigPatch, loadAppConfig, updateAppConfig } from "./core/config";
import { buildModelRequest } from "./core/modelRequest";
import { normalizeRoleCardScale } from "./core/memoryEntry";
import { openScreenshotSessionFolder } from "./core/perception/screenCapture";
import { PerceptionScheduler } from "./core/perception/scheduler";
import { ScreenAttentionLoop } from "./core/perception/attentionLoop";
import { buildPlaceholderInput, validatePromptCatalog } from "./core/prompts";
import { getLogSessionInfo, logError, logInfo } from "./core/logger";
import { ModelRequest, PerceptionInput, RoleCard } from "./shared/types";

let mainWindow: BrowserWindow | null = null;
let activeRoleCard: RoleCard | null = null;
let activeRoleCardPath: string | null = null;
let perceptionScheduler: PerceptionScheduler | null = null;
let screenAttentionLoop: ScreenAttentionLoop | null = null;
let perceptionInFlight = false;
let inFlightPerceptionScore = 0;
let inFlightPerceptionInterruptible = false;
let activeBubbleUntilMs = 0;
let activeBubbleScore = 0;
let activeBubbleInterruptible = false;
let pendingPerceptionBatch:
  | {
      config: AppConfig;
      inputs: PerceptionInput[];
      score: number;
      interruptible: boolean;
    }
  | null = null;

const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 560;
const BASE_STAGE_WIDTH = 360;
const BASE_STAGE_HEIGHT = 560;

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.webContents.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function resizeMainWindowForScale(scale: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const normalizedScale = normalizeRoleCardScale(scale);
  const nextWidth = Math.max(
    MIN_WINDOW_WIDTH,
    Math.ceil(BASE_STAGE_WIDTH * normalizedScale)
  );
  const nextHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.ceil(BASE_STAGE_HEIGHT * normalizedScale)
  );
  const bounds = mainWindow.getBounds();

  mainWindow.setBounds({
    x: Math.round(bounds.x + (bounds.width - nextWidth) / 2),
    y: Math.round(bounds.y + bounds.height - nextHeight),
    width: nextWidth,
    height: nextHeight
  });
}

function normalizeChineseGreeting(content: string): string {
  if (/[\u4e00-\u9fff]/.test(content)) {
    return content;
  }
  return "你好，我来了。今天想先做什么？";
}

function normalizePerceptionInterval(sec: number | undefined): number {
  const value = typeof sec === "number" ? sec : 5;
  return Math.min(30, Math.max(1, Math.floor(value)));
}

function getBubbleTimeoutMs(config?: AppConfig | null): number {
  const timeoutSec = typeof config?.bubble_timeout_sec === "number" ? config.bubble_timeout_sec : 3;
  return Math.max(0, timeoutSec) * 1000;
}

function publishBubble(
  text: string,
  options?: {
    config?: AppConfig | null;
    score?: number;
    interruptible?: boolean;
  }
): void {
  const timeoutMs = getBubbleTimeoutMs(options?.config);
  activeBubbleUntilMs = timeoutMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  activeBubbleScore = options?.score ?? 0;
  activeBubbleInterruptible = options?.interruptible === true;
  sendToRenderer("bubble:update", text);
}

function isBubbleActive(): boolean {
  return activeBubbleUntilMs > Date.now();
}

function getPerceptionBatchScore(inputs: PerceptionInput[]): number {
  return inputs.reduce((maxScore, input) => {
    return Math.max(maxScore, typeof input.trigger_score === "number" ? input.trigger_score : 0);
  }, 0);
}

function getPerceptionBatchInterruptible(inputs: PerceptionInput[]): boolean {
  return inputs.some((input) => input.allow_interrupt === true);
}

function getCurrentResponseState(): {
  active: boolean;
  interruptible: boolean;
  score: number;
  phase: "idle" | "inflight" | "bubble";
} {
  if (perceptionInFlight) {
    return {
      active: true,
      interruptible: inFlightPerceptionInterruptible,
      score: inFlightPerceptionScore,
      phase: "inflight"
    };
  }
  if (isBubbleActive()) {
    return {
      active: true,
      interruptible: activeBubbleInterruptible,
      score: activeBubbleScore,
      phase: "bubble"
    };
  }
  return {
    active: false,
    interruptible: false,
    score: 0,
    phase: "idle"
  };
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

function buildUiConfig(config: AppConfig, roleCard?: RoleCard | null) {
  return {
    bubbleTimeoutSec: config.bubble_timeout_sec ?? 3,
    panelScale: normalizeRoleCardScale(roleCard?.scale),
    enablePerceptionLoop: config.enable_perception_loop === true,
    perceptionIntervalSec: normalizePerceptionInterval(config.perception_interval_sec),
    enableScreen: config.enable_screen !== false,
    enableMic: config.enable_mic !== false,
    enableSystemAudio: config.enable_system_audio !== false,
    screenAttentionEnabled: resolveScreenAttentionEnabled(config),
    screenGateTickMs: config.screen_gate_tick_ms ?? 500,
    screenActiveSamplingEnabled: config.screen_active_sampling_enabled === true,
    screenTriggerThreshold: config.screen_trigger_threshold ?? 0.35,
    screenGlobalCooldownSec: config.screen_global_cooldown_sec ?? 1,
    screenDebugSaveGateFrames: config.screen_debug_save_gate_frames !== false,
    activeCompanionEnabled: config.active_companion_enabled === true,
    activeCompanionIntervalMin: config.active_companion_interval_min ?? 7
  };
}

function syncRoleCardUi(config: AppConfig | null | undefined, roleCard: RoleCard | null | undefined): void {
  const panelScale = normalizeRoleCardScale(roleCard?.scale);
  resizeMainWindowForScale(panelScale);
  if (roleCard) {
    sendToRenderer("pet:icon", roleCard.pet_icon_path ?? "");
  }
  if (config) {
    sendToRenderer("ui:config", buildUiConfig(config, roleCard));
    return;
  }
  sendToRenderer("ui:config", { panelScale });
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
    sendToRenderer("debug:score", {
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
      currentTickMs: config.screen_gate_tick_ms ?? 500,
      activeSamplingEnabled: config.screen_active_sampling_enabled === true,
      decision: "idle",
      reasons: ["attention_disabled"],
      ts: new Date().toISOString()
    });
    logInfo("Screen attention disabled");
    return;
  }

  screenAttentionLoop = new ScreenAttentionLoop(config, {
    onDebugState: (state) => {
      sendToRenderer("debug:score", state);
    },
    onTrigger: async (input) => {
      await handlePerceptionBatch(config, [input]);
    },
    getResponseState: () => getCurrentResponseState()
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
  if (inputs.length === 0) {
    return;
  }
  if (!activeRoleCard || !activeRoleCardPath) {
    return;
  }

  const score = getPerceptionBatchScore(inputs);
  const interruptible = getPerceptionBatchInterruptible(inputs);

  if (perceptionInFlight) {
    if (interruptible && score > inFlightPerceptionScore) {
      if (!pendingPerceptionBatch || score > pendingPerceptionBatch.score) {
        pendingPerceptionBatch = { config, inputs, score, interruptible };
        logInfo(
          `Perception request queued as interrupt ` +
          `score=${score.toFixed(2)} inflight=${inFlightPerceptionScore.toFixed(2)}`
        );
      }
    }
    return;
  }

  perceptionInFlight = true;
  inFlightPerceptionScore = score;
  inFlightPerceptionInterruptible = interruptible;
  try {
    logInfo(
      `Perception tick sources=${inputs.map((item) => item.source).join(",")} ` +
      `score=${score.toFixed(2)} interruptible=${interruptible ? "yes" : "no"}`
    );
    const request = buildModelRequest(inputs, activeRoleCard);
    const raw = await requestModel(
      { apiKey: config.openai.api_key, model: config.openai.model },
      request
    );
    if (pendingPerceptionBatch && pendingPerceptionBatch.score > score) {
      logInfo(
        `Perception response skipped as stale score=${score.toFixed(2)} ` +
        `pending=${pendingPerceptionBatch.score.toFixed(2)}`
      );
      return;
    }
    const result = handleModelResponse(raw, activeRoleCardPath, activeRoleCard);
    activeRoleCard = result.roleCard;
    publishBubble(result.response.content, {
      config,
      score,
      interruptible
    });
  } catch (error) {
    handleModelError(error);
    publishBubble("这次没接上，我稍后再试。", { config });
  } finally {
    perceptionInFlight = false;
    inFlightPerceptionScore = 0;
    inFlightPerceptionInterruptible = false;
    const pending = pendingPerceptionBatch;
    pendingPerceptionBatch = null;
    if (pending) {
      logInfo(`Perception interrupt dispatched score=${pending.score.toFixed(2)}`);
      void handlePerceptionBatch(pending.config, pending.inputs);
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 560,
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
      sendToRenderer("ui:config", { bubbleTimeoutSec: 3, panelScale: 1 });
      publishBubble("缺少 app.config.json");
      return;
    }

    validatePromptCatalog();
    roleCard = loadRoleCard(config.role_card_path);
    activeRoleCard = roleCard;
    activeRoleCardPath = config.role_card_path;
    syncRoleCardUi(config, roleCard);
  } catch (error) {
    handleModelError(error);
    publishBubble("配置加载失败");
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
    publishBubble(normalizeChineseGreeting(result.response.content), { config });
  } catch (error) {
    handleModelError(error);
    sendToRenderer(
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
  const logSession = getLogSessionInfo();
  logInfo(`Runtime ready session_id=${logSession.sessionId} session_log=${logSession.sessionLogPath}`);
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
  syncRoleCardUi(loadAppConfig(), roleCard);
  return roleCard;
});

ipcMain.handle("rolecard:update-scale", async (_event, scale: number) => {
  logInfo(`IPC rolecard:update-scale ${scale}`);
  if (!activeRoleCard || !activeRoleCardPath) {
    throw new Error("Role card not loaded");
  }

  const updatedRoleCard = updateRoleCardScale(activeRoleCard, scale);
  saveRoleCard(activeRoleCardPath, updatedRoleCard);
  activeRoleCard = updatedRoleCard;
  syncRoleCardUi(loadAppConfig(), updatedRoleCard);
  return updatedRoleCard;
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
  }

  syncRoleCardUi(updated, activeRoleCard);
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
      sendToRenderer(
        "bubble:update",
        normalizeChineseGreeting(result.response.content)
      );
    } catch (error) {
      handleModelError(error);
      sendToRenderer(
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
  publishBubble(result.response.content, { config });
  return result.response;
});

ipcMain.handle("api:test-connection", async () => {
  logInfo("IPC api:test-connection");
  const config = loadAppConfig();
  if (!config) {
    throw new Error("Missing app.config.json");
  }
  await testOpenAIConnection({
    apiKey: config.openai.api_key,
    model: config.openai.model
  });
  return { ok: true };
});

ipcMain.handle("debug:open-screenshot-folder", async () => {
  logInfo("IPC debug:open-screenshot-folder");
  const folderPath = await openScreenshotSessionFolder();
  return { path: folderPath };
});

ipcMain.handle("debug:open-screen-attention-folder", async () => {
  logInfo("IPC debug:open-screen-attention-folder");
  if (!screenAttentionLoop) {
    throw new Error("Screen attention is not active");
  }
  const folderPath = await screenAttentionLoop.openSessionFolder();
  return { path: folderPath };
});
