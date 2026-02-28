const api = window.tablecat;

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
const bubbleTimeoutInput = document.getElementById("bubbleTimeoutInput");
const enablePerceptionLoopInput = document.getElementById("enablePerceptionLoopInput");
const perceptionIntervalInput = document.getElementById("perceptionIntervalInput");
const enableScreenInput = document.getElementById("enableScreenInput");
const enableMicInput = document.getElementById("enableMicInput");
const enableSystemAudioInput = document.getElementById("enableSystemAudioInput");
const openScreenshotFolderBtn = document.getElementById("openScreenshotFolderBtn");
const settingsTestApiBtn = document.getElementById("settingsTestApiBtn");
const settingsCancelBtn = document.getElementById("settingsCancelBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");
const scoreBadge = document.getElementById("scoreBadge");
const scoreDecision = document.getElementById("scoreDecision");
const scoreSummary = document.getElementById("scoreSummary");
const scoreL0L1 = document.getElementById("scoreL0L1");
const scoreReason = document.getElementById("scoreReason");

const MAX_HISTORY = 100;
const MAX_CHAT_MESSAGES = 100;

let bubbleTimeoutMs = 3000;
let bubbleTimer = null;
let currentRoleCardPath = "";
let currentEnablePerceptionLoop = false;
let currentPerceptionIntervalSec = 5;
let currentEnableScreen = true;
let currentEnableMic = true;
let currentEnableSystemAudio = true;
let isChatSending = false;
const historyItems = [];

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
  const decision = String(state?.decision || "idle");
  const finalScore = Number(state?.finalScore || 0);
  const excitementScore = Number(state?.excitementScore || 0);
  const interruptScore = Number(state?.interruptScore || 0);
  const noveltyScore = Number(state?.noveltyScore || 0);
  const reasons = Array.isArray(state?.reasons) ? state.reasons : [];
  const l0Pass = state?.l0Pass === true;
  const l1Pass = state?.l1Pass === true;

  scoreBadge.classList.remove("score-idle", "score-drop", "score-cooldown", "score-trigger");
  scoreBadge.classList.add(`score-${decision}`);
  scoreDecision.textContent = formatDecisionLabel(decision);
  scoreSummary.textContent =
    `S ${finalScore.toFixed(2)}  E ${excitementScore.toFixed(2)}  I ${interruptScore.toFixed(2)}  N ${noveltyScore.toFixed(2)}`;
  scoreL0L1.textContent = `L0 ${l0Pass ? "ok" : "x"}  L1 ${l1Pass ? "ok" : "x"}`;
  scoreReason.textContent = reasons[0] || (state?.active ? "running" : "attention_disabled");
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
    currentEnableScreen = config?.enable_screen !== false;
    currentEnableMic = config?.enable_mic !== false;
    currentEnableSystemAudio = config?.enable_system_audio !== false;
  } catch (_error) {
    showBubble("读取设置失败");
  }

  enablePerceptionLoopInput.checked = currentEnablePerceptionLoop;
  perceptionIntervalInput.value = String(currentPerceptionIntervalSec);
  enableScreenInput.checked = currentEnableScreen;
  enableMicInput.checked = currentEnableMic;
  enableSystemAudioInput.checked = currentEnableSystemAudio;
}

setSpinner(true);
showBubble("准备中...");
renderScoreState({
  active: false,
  finalScore: 0,
  excitementScore: 0,
  interruptScore: 0,
  noveltyScore: 0,
  l0Pass: false,
  l1Pass: false,
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
    if (typeof config?.enablePerceptionLoop === "boolean") {
      currentEnablePerceptionLoop = config.enablePerceptionLoop;
      enablePerceptionLoopInput.checked = config.enablePerceptionLoop;
    }
    if (typeof config?.perceptionIntervalSec === "number") {
      currentPerceptionIntervalSec = config.perceptionIntervalSec;
      perceptionIntervalInput.value = String(config.perceptionIntervalSec);
    }
    if (typeof config?.enableScreen === "boolean") {
      currentEnableScreen = config.enableScreen;
      enableScreenInput.checked = config.enableScreen;
    }
    if (typeof config?.enableMic === "boolean") {
      currentEnableMic = config.enableMic;
      enableMicInput.checked = config.enableMic;
    }
    if (typeof config?.enableSystemAudio === "boolean") {
      currentEnableSystemAudio = config.enableSystemAudio;
      enableSystemAudioInput.checked = config.enableSystemAudio;
    }
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
  closeSettingsPanel();
});

openScreenshotFolderBtn.addEventListener("click", async () => {
  if (!api?.openScreenshotFolder) {
    showBubble("当前版本不支持打开截图目录");
    return;
  }
  openScreenshotFolderBtn.disabled = true;
  try {
    await api.openScreenshotFolder();
    showBubble("已打开本次启动的截图目录");
  } catch (_error) {
    showBubble("打开截图目录失败");
  } finally {
    openScreenshotFolderBtn.disabled = false;
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

  const perceptionIntervalSec = Number(perceptionIntervalInput.value);
  if (
    !Number.isInteger(perceptionIntervalSec) ||
    perceptionIntervalSec < 5 ||
    perceptionIntervalSec > 30
  ) {
    showBubble("轮询间隔请输入 5 到 30 的整数秒");
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
      enable_screen: enableScreenInput.checked,
      enable_mic: enableMicInput.checked,
      enable_system_audio: enableSystemAudioInput.checked
    });

    const switchedRoleCard = roleCardPath !== currentRoleCardPath;
    currentRoleCardPath = String(updated?.role_card_path || roleCardPath);
    currentEnablePerceptionLoop = updated?.enable_perception_loop === true;
    currentPerceptionIntervalSec = Number(updated?.perception_interval_sec ?? perceptionIntervalSec);
    currentEnableScreen = updated?.enable_screen !== false;
    currentEnableMic = updated?.enable_mic !== false;
    currentEnableSystemAudio = updated?.enable_system_audio !== false;
    bubbleTimeoutMs = Number(updated?.bubble_timeout_sec ?? bubbleTimeoutSec) * 1000;

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

petPanel.addEventListener("dblclick", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (
    target.closest("#settingsPanel") ||
    target.closest("#historyPanel") ||
    target.closest("#chatPanel") ||
    target.closest("#settingsButton") ||
    target.closest("#historyButton")
  ) {
    return;
  }

  if (chatPanel.classList.contains("visible")) {
    closeChatPanel();
    return;
  }
  openChatPanel();
});
