const api = window.tablecat;

const petStage = document.getElementById("petStage");
const petIcon = document.getElementById("petIcon");
const petPanel = document.getElementById("petPanel");
const bubble = document.getElementById("bubble");
const spinner = document.getElementById("spinner");
const settingsButton = document.getElementById("settingsButton");
const historyButton = document.getElementById("historyButton");
const settingsPanel = document.getElementById("settingsPanel");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const chatPanel = document.getElementById("chatPanel");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const roleCardPathInput = document.getElementById("roleCardPathInput");
const panelScaleInput = document.getElementById("panelScaleInput");
const panelScaleValue = document.getElementById("panelScaleValue");
const bubbleTimeoutInput = document.getElementById("bubbleTimeoutInput");
const enablePerceptionLoopInput = document.getElementById("enablePerceptionLoopInput");
const perceptionIntervalInput = document.getElementById("perceptionIntervalInput");
const screenAttentionEnabledInput = document.getElementById("screenAttentionEnabledInput");
const screenGateTickInput = document.getElementById("screenGateTickInput");
const screenActiveSamplingEnabledInput = document.getElementById("screenActiveSamplingEnabledInput");
const screenTriggerThresholdInput = document.getElementById("screenTriggerThresholdInput");
const screenGlobalCooldownInput = document.getElementById("screenGlobalCooldownInput");
const screenDebugSaveGateFramesInput = document.getElementById("screenDebugSaveGateFramesInput");
const activeCompanionEnabledInput = document.getElementById("activeCompanionEnabledInput");
const activeCompanionIntervalMinInput = document.getElementById("activeCompanionIntervalMinInput");
const enableScreenInput = document.getElementById("enableScreenInput");
const enableMicInput = document.getElementById("enableMicInput");
const enableSystemAudioInput = document.getElementById("enableSystemAudioInput");
const openScreenshotFolderBtn = document.getElementById("openScreenshotFolderBtn");
const openScreenAttentionFolderBtn = document.getElementById("openScreenAttentionFolderBtn");
const settingsTestApiBtn = document.getElementById("settingsTestApiBtn");
const settingsCancelBtn = document.getElementById("settingsCancelBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");
const scoreBadge = document.getElementById("scoreBadge");
const scoreDecision = document.getElementById("scoreDecision");
const scoreSummary = document.getElementById("scoreSummary");
const scoreL0L1 = document.getElementById("scoreL0L1");
const scoreTick = document.getElementById("scoreTick");
const scoreSampling = document.getElementById("scoreSampling");
const scoreRaw = document.getElementById("scoreRaw");
const scoreCool = document.getElementById("scoreCool");
const scorePerf = document.getElementById("scorePerf");
const scoreFg = document.getElementById("scoreFg");
const scoreRsp = document.getElementById("scoreRsp");
const scoreReason = document.getElementById("scoreReason");

const MAX_HISTORY = 100;
const MAX_CHAT_MESSAGES = 100;
const MIN_PANEL_SCALE = 1;
const MAX_PANEL_SCALE = 20;
const PANEL_SCALE_STEP = 0.1;

let bubbleTimeoutMs = 3000;
let bubbleTimer = null;
let currentRoleCardPath = "";
let currentPanelScale = 1;
let draftPanelScale = 1;
let currentEnablePerceptionLoop = false;
let currentPerceptionIntervalSec = 5;
let currentScreenAttentionEnabled = false;
let currentScreenGateTickMs = 500;
let currentScreenActiveSamplingEnabled = false;
let currentScreenTriggerThreshold = 0.35;
let currentScreenGlobalCooldownSec = 1;
let currentScreenDebugSaveGateFrames = true;
let currentActiveCompanionEnabled = false;
let currentActiveCompanionIntervalMin = 7;
let currentEnableScreen = true;
let currentEnableMic = true;
let currentEnableSystemAudio = true;
let isChatSending = false;
let scalePersistTimer = null;
const historyItems = [];
let pinnedDecisionState = null;
let pinnedDecisionUntilMs = 0;

function setSpinner(visible) {
  spinner.style.display = visible ? "block" : "none";
}

function setPetIcon(path) {
  if (!path) {
    petIcon.style.display = "none";
    petIcon.removeAttribute("src");
    return;
  }
  petIcon.src = path;
  petIcon.style.display = "block";
}

function normalizePanelScale(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return Math.min(MAX_PANEL_SCALE, Math.max(MIN_PANEL_SCALE, rounded));
}

function updatePanelScaleLabel(scale) {
  panelScaleValue.textContent = `${scale.toFixed(1)}x`;
}

function applyPanelScale(scale, options = {}) {
  const normalized = normalizePanelScale(scale);
  petStage.style.setProperty("--ui-scale", String(normalized));
  updatePanelScaleLabel(normalized);
  if (options.syncInput !== false) {
    panelScaleInput.value = normalized.toFixed(1);
  }
  return normalized;
}

function isOverlayTarget(target) {
  return Boolean(
    target.closest("#settingsPanel") ||
    target.closest("#historyPanel") ||
    target.closest("#chatPanel") ||
    target.closest("#settingsButton") ||
    target.closest("#historyButton")
  );
}

function restorePanelScaleDraft() {
  draftPanelScale = currentPanelScale;
  applyPanelScale(currentPanelScale);
}

async function persistPanelScale(scale) {
  if (!api?.updateRoleCardScale) {
    throw new Error("Scale update API unavailable");
  }
  const updatedRoleCard = await api.updateRoleCardScale(scale);
  currentPanelScale = normalizePanelScale(Number(updatedRoleCard?.scale ?? scale));
  draftPanelScale = currentPanelScale;
  applyPanelScale(currentPanelScale);
}

function schedulePanelScalePersist(scale) {
  if (scalePersistTimer) {
    clearTimeout(scalePersistTimer);
  }
  scalePersistTimer = setTimeout(() => {
    scalePersistTimer = null;
    void persistPanelScale(scale).catch(() => {
      restorePanelScaleDraft();
      showBubble("宠物缩放保存失败");
    });
  }, 120);
}

function addHistory(text) {
  if (!text) {
    return;
  }
  historyItems.push(text);
  if (historyItems.length > MAX_HISTORY) {
    historyItems.shift();
  }
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";
  historyItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.textContent = item;
    historyList.appendChild(row);
  });
}

function resetBubbleTimer() {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  if (bubbleTimeoutMs <= 0) {
    return;
  }
  bubbleTimer = setTimeout(() => {
    bubble.style.display = "none";
  }, bubbleTimeoutMs);
}

function showBubble(text) {
  bubble.style.display = "block";
  bubble.textContent = text;
  addHistory(text);
  resetBubbleTimer();
}

function openSettingsPanel() {
  historyPanel.classList.remove("visible");
  chatPanel.classList.remove("visible");
  settingsPanel.classList.add("visible");
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("visible");
}

function openChatPanel() {
  closeSettingsPanel();
  historyPanel.classList.remove("visible");
  chatPanel.classList.add("visible");
  chatInput.focus();
}

function closeChatPanel() {
  chatPanel.classList.remove("visible");
}

function appendChatMessage(role, text) {
  if (!text) {
    return;
  }

  const item = document.createElement("div");
  item.className = "chat-msg";
  if (role === "user") {
    item.classList.add("chat-msg-user");
    item.textContent = `你: ${text}`;
  } else if (role === "assistant") {
    item.classList.add("chat-msg-assistant");
    item.textContent = `猫: ${text}`;
  } else {
    item.classList.add("chat-msg-system");
    item.textContent = `系统: ${text}`;
  }

  chatLog.appendChild(item);
  while (chatLog.children.length > MAX_CHAT_MESSAGES) {
    chatLog.removeChild(chatLog.firstChild);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setChatSending(sending) {
  isChatSending = sending;
  chatInput.disabled = sending;
  chatSendBtn.disabled = sending;
  chatSendBtn.textContent = sending ? "发送中" : "发送";
}

function formatDecisionLabel(decision) {
  return String(decision || "idle").toUpperCase();
}

function renderScoreState(state) {
  const nowMs = Date.now();
  if (state?.decision === "trigger") {
    pinnedDecisionState = state;
    pinnedDecisionUntilMs = nowMs + 1500;
  } else if (
    state?.decision === "cooldown" &&
    pinnedDecisionState &&
    nowMs < pinnedDecisionUntilMs
  ) {
    state = {
      ...state,
      ...pinnedDecisionState,
      cooldownRemainingMs: state.cooldownRemainingMs,
      currentTickMs: state.currentTickMs,
      actualSampleIntervalMs: state.actualSampleIntervalMs,
      tickDurationMs: state.tickDurationMs,
      foregroundChanged: state.foregroundChanged,
      foregroundProcessName: state.foregroundProcessName,
      foregroundTitle: state.foregroundTitle
    };
  } else if (nowMs >= pinnedDecisionUntilMs) {
    pinnedDecisionState = null;
  }

  const decision = String(state?.decision || "idle");
  const finalScore = Number(state?.finalScore || 0);
  const excitementScore = Number(state?.excitementScore || 0);
  const interruptScore = Number(state?.interruptScore || 0);
  const noveltyScore = Number(state?.noveltyScore || 0);
  const reasons = Array.isArray(state?.reasons) ? state.reasons : [];
  const l0Pass = state?.l0Pass === true;
  const l1Pass = state?.l1Pass === true;
  const currentTickMs = Number(state?.currentTickMs || 0);
  const activeSamplingEnabled = state?.activeSamplingEnabled === true;
  const visualDelta = Number(state?.visualDelta || 0);
  const hashDistance = Number(state?.hashDistance || 0);
  const clusterScore = Number(state?.clusterScore || 0);
  const cooldownRemainingMs = Number(state?.cooldownRemainingMs || 0);
  const actualSampleIntervalMs = Number(state?.actualSampleIntervalMs || 0);
  const tickDurationMs = Number(state?.tickDurationMs || 0);
  const foregroundProcessName = String(state?.foregroundProcessName || "");
  const foregroundChanged = state?.foregroundChanged === true;
  const currentResponseScore = Number(state?.currentResponseScore || 0);
  const responseActive = state?.responseActive === true;
  const responsePhase = String(state?.responsePhase || "idle");

  scoreBadge.classList.remove("score-idle", "score-drop", "score-cooldown", "score-trigger");
  scoreBadge.classList.add(`score-${decision}`);
  scoreDecision.textContent = formatDecisionLabel(decision);
  scoreSummary.textContent =
    `S ${finalScore.toFixed(2)} E ${excitementScore.toFixed(2)} I ${interruptScore.toFixed(2)} N ${noveltyScore.toFixed(2)}`;
  scoreL0L1.textContent = `L0 ${l0Pass ? "ok" : "x"} L1 ${l1Pass ? "ok" : "x"}`;
  scoreTick.textContent = `Tick ${currentTickMs || 0}ms`;
  scoreSampling.textContent = activeSamplingEnabled ? "Adaptive" : "Base";
  scoreRaw.textContent = `d ${visualDelta.toFixed(2)} h ${hashDistance.toFixed(0)} c ${clusterScore.toFixed(2)}`;
  scoreCool.textContent = `cooldown ${cooldownRemainingMs}ms`;
  scorePerf.textContent = `dt ${tickDurationMs}ms it ${actualSampleIntervalMs}ms`;
  scoreFg.textContent = foregroundProcessName
    ? `fg ${foregroundProcessName}${foregroundChanged ? "*" : ""}`
    : "fg -";
  scoreRsp.textContent = responseActive
    ? `rsp ${currentResponseScore.toFixed(2)} ${responsePhase}`
    : "rsp -";
  scoreReason.textContent = reasons[0] || (state?.active ? "running" : "attention_disabled");
}

function applyConfigToInputs() {
  panelScaleInput.value = currentPanelScale.toFixed(1);
  updatePanelScaleLabel(currentPanelScale);
  draftPanelScale = currentPanelScale;
  enablePerceptionLoopInput.checked = currentEnablePerceptionLoop;
  perceptionIntervalInput.value = String(currentPerceptionIntervalSec);
  screenAttentionEnabledInput.checked = currentScreenAttentionEnabled;
  screenGateTickInput.value = String(currentScreenGateTickMs);
  screenActiveSamplingEnabledInput.checked = currentScreenActiveSamplingEnabled;
  screenTriggerThresholdInput.value = String(currentScreenTriggerThreshold);
  screenGlobalCooldownInput.value = String(currentScreenGlobalCooldownSec);
  screenDebugSaveGateFramesInput.checked = currentScreenDebugSaveGateFrames;
  activeCompanionEnabledInput.checked = currentActiveCompanionEnabled;
  activeCompanionIntervalMinInput.value = String(currentActiveCompanionIntervalMin);
  enableScreenInput.checked = currentEnableScreen;
  enableMicInput.checked = currentEnableMic;
  enableSystemAudioInput.checked = currentEnableSystemAudio;
}

async function loadSettings() {
  if (!api?.getConfig) {
    return;
  }

  try {
    const config = await api.getConfig();
    currentRoleCardPath = String(config?.role_card_path || "");
    roleCardPathInput.value = currentRoleCardPath;
    bubbleTimeoutInput.value = String(Number(config?.bubble_timeout_sec ?? 3));
    currentEnablePerceptionLoop = config?.enable_perception_loop === true;
    currentPerceptionIntervalSec = Number(config?.perception_interval_sec ?? 5);
    currentScreenAttentionEnabled = config?.screen_attention_enabled === true;
    currentScreenGateTickMs = Number(config?.screen_gate_tick_ms ?? 500);
    currentScreenActiveSamplingEnabled = config?.screen_active_sampling_enabled === true;
    currentScreenTriggerThreshold = Number(config?.screen_trigger_threshold ?? 0.35);
    currentScreenGlobalCooldownSec = Number(config?.screen_global_cooldown_sec ?? 1);
    currentScreenDebugSaveGateFrames = config?.screen_debug_save_gate_frames !== false;
    currentActiveCompanionEnabled = config?.active_companion_enabled === true;
    currentActiveCompanionIntervalMin = Number(config?.active_companion_interval_min ?? 7);
    currentEnableScreen = config?.enable_screen !== false;
    currentEnableMic = config?.enable_mic !== false;
    currentEnableSystemAudio = config?.enable_system_audio !== false;
  } catch (_error) {
    showBubble("读取设置失败");
  }

  applyConfigToInputs();
}

setSpinner(true);
applyPanelScale(currentPanelScale);
showBubble("准备中...");
renderScoreState({
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
  foregroundChanged: false,
  foregroundProcessName: "",
  currentTickMs: 500,
  actualSampleIntervalMs: 0,
  tickDurationMs: 0,
  cooldownRemainingMs: 0,
  activeSamplingEnabled: false,
  decision: "idle",
  reasons: ["waiting_for_frame"]
});

if (api?.onBubbleUpdate) {
  api.onBubbleUpdate((text) => {
    setSpinner(false);
    showBubble(text);
  });
}

if (api?.onPetIcon) {
  api.onPetIcon((path) => {
    setPetIcon(path);
  });
}

if (api?.onUiConfig) {
  api.onUiConfig((config) => {
    if (typeof config?.bubbleTimeoutSec === "number") {
      bubbleTimeoutMs = Math.max(0, config.bubbleTimeoutSec) * 1000;
    }
    if (typeof config?.panelScale === "number") {
      currentPanelScale = normalizePanelScale(config.panelScale);
      draftPanelScale = currentPanelScale;
      applyPanelScale(currentPanelScale);
    }
    if (typeof config?.enablePerceptionLoop === "boolean") {
      currentEnablePerceptionLoop = config.enablePerceptionLoop;
    }
    if (typeof config?.perceptionIntervalSec === "number") {
      currentPerceptionIntervalSec = config.perceptionIntervalSec;
    }
    if (typeof config?.screenAttentionEnabled === "boolean") {
      currentScreenAttentionEnabled = config.screenAttentionEnabled;
    }
    if (typeof config?.screenGateTickMs === "number") {
      currentScreenGateTickMs = config.screenGateTickMs;
    }
    if (typeof config?.screenActiveSamplingEnabled === "boolean") {
      currentScreenActiveSamplingEnabled = config.screenActiveSamplingEnabled;
    }
    if (typeof config?.screenTriggerThreshold === "number") {
      currentScreenTriggerThreshold = config.screenTriggerThreshold;
    }
    if (typeof config?.screenGlobalCooldownSec === "number") {
      currentScreenGlobalCooldownSec = config.screenGlobalCooldownSec;
    }
    if (typeof config?.screenDebugSaveGateFrames === "boolean") {
      currentScreenDebugSaveGateFrames = config.screenDebugSaveGateFrames;
    }
    if (typeof config?.activeCompanionEnabled === "boolean") {
      currentActiveCompanionEnabled = config.activeCompanionEnabled;
    }
    if (typeof config?.activeCompanionIntervalMin === "number") {
      currentActiveCompanionIntervalMin = config.activeCompanionIntervalMin;
    }
    if (typeof config?.enableScreen === "boolean") {
      currentEnableScreen = config.enableScreen;
    }
    if (typeof config?.enableMic === "boolean") {
      currentEnableMic = config.enableMic;
    }
    if (typeof config?.enableSystemAudio === "boolean") {
      currentEnableSystemAudio = config.enableSystemAudio;
    }
    applyConfigToInputs();
  });
}

if (api?.onDebugScore) {
  api.onDebugScore((state) => {
    renderScoreState(state);
  });
}

[settingsButton, historyButton].forEach((button) => {
  button.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("dblclick", (event) => {
    event.stopPropagation();
  });
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  openSettingsPanel();
  void loadSettings();
});

historyButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeSettingsPanel();
  closeChatPanel();
  historyPanel.classList.toggle("visible");
});

settingsCancelBtn.addEventListener("click", () => {
  restorePanelScaleDraft();
  closeSettingsPanel();
});

panelScaleInput.addEventListener("input", () => {
  draftPanelScale = normalizePanelScale(Number(panelScaleInput.value));
  applyPanelScale(draftPanelScale, { syncInput: false });
});

openScreenshotFolderBtn.addEventListener("click", async () => {
  if (!api?.openScreenshotFolder) {
    showBubble("当前版本不支持打开截图目录");
    return;
  }
  openScreenshotFolderBtn.disabled = true;
  try {
    await api.openScreenshotFolder();
    showBubble("已打开本次截图目录");
  } catch (_error) {
    showBubble("打开截图目录失败");
  } finally {
    openScreenshotFolderBtn.disabled = false;
  }
});

openScreenAttentionFolderBtn.addEventListener("click", async () => {
  if (!api?.openScreenAttentionFolder) {
    showBubble("当前版本不支持打开门控目录");
    return;
  }
  openScreenAttentionFolderBtn.disabled = true;
  try {
    await api.openScreenAttentionFolder();
    showBubble("已打开本次门控调试目录");
  } catch (_error) {
    showBubble("打开门控目录失败");
  } finally {
    openScreenAttentionFolderBtn.disabled = false;
  }
});

settingsTestApiBtn.addEventListener("click", async () => {
  if (!api?.testApiConnection) {
    showBubble("当前版本不支持 API 测试");
    return;
  }
  setSpinner(true);
  settingsTestApiBtn.disabled = true;
  try {
    await api.testApiConnection();
    showBubble("API 连通正常");
  } catch (_error) {
    showBubble("API 连通失败");
  } finally {
    setSpinner(false);
    settingsTestApiBtn.disabled = false;
  }
});

settingsSaveBtn.addEventListener("click", async () => {
  const roleCardPath = roleCardPathInput.value.trim();
  if (!roleCardPath) {
    showBubble("角色卡路径不能为空");
    return;
  }

  const bubbleTimeoutSec = Number(bubbleTimeoutInput.value);
  if (!Number.isInteger(bubbleTimeoutSec) || bubbleTimeoutSec < 0 || bubbleTimeoutSec > 600) {
    showBubble("气泡秒数请输入 0 到 600 的整数");
    return;
  }

  const panelScale = normalizePanelScale(Number(panelScaleInput.value));
  if (Number.isNaN(panelScale) || panelScale < MIN_PANEL_SCALE || panelScale > MAX_PANEL_SCALE) {
    showBubble("宠物缩放请输入 1.0 到 20.0 之间的数值");
    return;
  }

  const perceptionIntervalSec = Number(perceptionIntervalInput.value);
  if (!Number.isInteger(perceptionIntervalSec) || perceptionIntervalSec < 1 || perceptionIntervalSec > 30) {
    showBubble("轮询间隔请输入 5 到 30 的整数秒");
    return;
  }

  const screenGateTickMs = Number(screenGateTickInput.value);
  if (!Number.isInteger(screenGateTickMs) || screenGateTickMs < 100 || screenGateTickMs > 5000) {
    showBubble("截图检测间隔请输入 100 到 5000 的整数毫秒");
    return;
  }

  const screenTriggerThreshold = Number(screenTriggerThresholdInput.value);
  if (Number.isNaN(screenTriggerThreshold) || screenTriggerThreshold < 0 || screenTriggerThreshold > 1) {
    showBubble("触发阈值请输入 0 到 1 之间的数值");
    return;
  }

  const screenGlobalCooldownSec = Number(screenGlobalCooldownInput.value);
  if (!Number.isInteger(screenGlobalCooldownSec) || screenGlobalCooldownSec < 1 || screenGlobalCooldownSec > 600) {
    showBubble("AI 最短提交间隔请输入 1 到 600 的整数秒");
    return;
  }

  const activeCompanionIntervalMin = Number(activeCompanionIntervalMinInput.value);
  if (!Number.isInteger(activeCompanionIntervalMin) || activeCompanionIntervalMin < 1 || activeCompanionIntervalMin > 120) {
    showBubble("主动陪伴间隔请输入 1 到 120 的整数分钟");
    return;
  }

  if (!api?.updateConfig) {
    showBubble("当前版本不支持保存设置");
    return;
  }

  try {
    const updated = await api.updateConfig({
      role_card_path: roleCardPath,
      bubble_timeout_sec: bubbleTimeoutSec,
      enable_perception_loop: enablePerceptionLoopInput.checked,
      perception_interval_sec: perceptionIntervalSec,
      screen_attention_enabled: screenAttentionEnabledInput.checked,
      screen_gate_tick_ms: screenGateTickMs,
      screen_active_sampling_enabled: screenActiveSamplingEnabledInput.checked,
      screen_trigger_threshold: screenTriggerThreshold,
      screen_global_cooldown_sec: screenGlobalCooldownSec,
      screen_debug_save_gate_frames: screenDebugSaveGateFramesInput.checked,
      active_companion_enabled: activeCompanionEnabledInput.checked,
      active_companion_interval_min: activeCompanionIntervalMin,
      enable_screen: enableScreenInput.checked,
      enable_mic: enableMicInput.checked,
      enable_system_audio: enableSystemAudioInput.checked
    });

    const switchedRoleCard = roleCardPath !== currentRoleCardPath;
    currentRoleCardPath = String(updated?.role_card_path || roleCardPath);
    currentEnablePerceptionLoop = updated?.enable_perception_loop === true;
    currentPerceptionIntervalSec = Number(updated?.perception_interval_sec ?? perceptionIntervalSec);
    currentScreenAttentionEnabled = updated?.screen_attention_enabled === true;
    currentScreenGateTickMs = Number(updated?.screen_gate_tick_ms ?? screenGateTickMs);
    currentScreenActiveSamplingEnabled = updated?.screen_active_sampling_enabled === true;
    currentScreenTriggerThreshold = Number(updated?.screen_trigger_threshold ?? screenTriggerThreshold);
    currentScreenGlobalCooldownSec = Number(updated?.screen_global_cooldown_sec ?? screenGlobalCooldownSec);
    currentScreenDebugSaveGateFrames = updated?.screen_debug_save_gate_frames !== false;
    currentActiveCompanionEnabled = updated?.active_companion_enabled === true;
    currentActiveCompanionIntervalMin = Number(updated?.active_companion_interval_min ?? activeCompanionIntervalMin);
    currentEnableScreen = updated?.enable_screen !== false;
    currentEnableMic = updated?.enable_mic !== false;
    currentEnableSystemAudio = updated?.enable_system_audio !== false;
    bubbleTimeoutMs = Number(updated?.bubble_timeout_sec ?? bubbleTimeoutSec) * 1000;
    await persistPanelScale(panelScale);

    closeSettingsPanel();
    if (!switchedRoleCard) {
      showBubble("设置已保存");
    }
  } catch (_error) {
    showBubble("保存设置失败");
  }
});

chatCloseBtn.addEventListener("click", () => {
  closeChatPanel();
});

chatSendBtn.addEventListener("click", async () => {
  if (isChatSending) {
    return;
  }
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }
  if (!api?.sendChatMessage) {
    appendChatMessage("system", "当前版本不支持聊天");
    return;
  }

  appendChatMessage("user", text);
  chatInput.value = "";
  setChatSending(true);
  setSpinner(true);

  try {
    const response = await api.sendChatMessage(text);
    appendChatMessage("assistant", String(response?.content || "(空回复)"));
  } catch (_error) {
    appendChatMessage("system", "聊天请求失败");
    showBubble("聊天请求失败");
  } finally {
    setSpinner(false);
    setChatSending(false);
    chatInput.focus();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    chatSendBtn.click();
  }
});

petPanel.addEventListener("wheel", (event) => {
  const target = event.target;
  if (!(target instanceof Element) || isOverlayTarget(target)) {
    return;
  }

  event.preventDefault();
  const delta = event.deltaY < 0 ? PANEL_SCALE_STEP : -PANEL_SCALE_STEP;
  const nextScale = normalizePanelScale(currentPanelScale + delta);
  if (nextScale === currentPanelScale) {
    return;
  }

  currentPanelScale = nextScale;
  draftPanelScale = nextScale;
  applyPanelScale(nextScale);
  schedulePanelScalePersist(nextScale);
}, { passive: false });

petPanel.addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (isOverlayTarget(target)) {
    return;
  }

  if (chatPanel.classList.contains("visible")) {
    closeChatPanel();
    return;
  }
  openChatPanel();
});
