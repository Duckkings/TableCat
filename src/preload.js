const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tablecat", {
  loadRoleCard: (path) => ipcRenderer.invoke("rolecard:load", path),
  getConfig: () => ipcRenderer.invoke("config:get"),
  updateConfig: (patch) => ipcRenderer.invoke("config:update", patch),
  sendChatMessage: (text) => ipcRenderer.invoke("chat:send", text),
  testApiConnection: () => ipcRenderer.invoke("api:test-connection"),
  openScreenshotFolder: () => ipcRenderer.invoke("debug:open-screenshot-folder"),
  openScreenAttentionFolder: () => ipcRenderer.invoke("debug:open-screen-attention-folder"),
  requestFirstGreeting: (config) => ipcRenderer.invoke("model:first-greeting", config),
  requestModel: (config, request) => ipcRenderer.invoke("model:request", config, request),
  onBubbleUpdate: (handler) => {
    ipcRenderer.on("bubble:update", (_event, text) => handler(text));
  },
  onPetIcon: (handler) => {
    ipcRenderer.on("pet:icon", (_event, path) => handler(path));
  },
  onUiConfig: (handler) => {
    ipcRenderer.on("ui:config", (_event, config) => handler(config));
  },
  onDebugScore: (handler) => {
    ipcRenderer.on("debug:score", (_event, payload) => handler(payload));
  }
});
