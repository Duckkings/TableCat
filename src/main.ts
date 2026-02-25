import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { buildFirstGreetingRequest } from "./core/firstGreeting";
import { requestModel } from "./core/openai";
import { handleModelResponse, handleModelError } from "./core/assistant";
import { loadRoleCard } from "./core/roleCard";
import { loadAppConfig } from "./core/config";
import { logError, logInfo } from "./core/logger";
import { ModelRequest, RoleCard } from "./shared/types";

let mainWindow: BrowserWindow | null = null;
let activeRoleCard: RoleCard | null = null;
let activeRoleCardPath: string | null = null;

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
    try {
      logInfo("Window did-finish-load");
      const config = loadAppConfig();
      if (!config) {
        mainWindow?.webContents.send("ui:config", { bubbleTimeoutSec: 3 });
        mainWindow?.webContents.send("bubble:update", "缺少 app.config.json");
        return;
      }
      mainWindow?.webContents.send("ui:config", {
        bubbleTimeoutSec: config.bubble_timeout_sec ?? 3
      });
      const card = loadRoleCard(config.role_card_path);
      activeRoleCard = card;
      activeRoleCardPath = config.role_card_path;
      mainWindow?.webContents.send("pet:icon", card.pet_icon_path ?? "");
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
      mainWindow?.webContents.send("bubble:update", result.response.content);
    } catch (error) {
      handleModelError(error);
      mainWindow?.webContents.send("bubble:update", "配置加载失败");
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("rolecard:load", (_event, roleCardPath: string) => {
  logInfo(`IPC rolecard:load ${roleCardPath}`);
  const card = loadRoleCard(roleCardPath);
  activeRoleCard = card;
  activeRoleCardPath = roleCardPath;
  return card;
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
