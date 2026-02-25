const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tablecat", {
  loadRoleCard: (path) => ipcRenderer.invoke("rolecard:load", path),
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
  }
});
