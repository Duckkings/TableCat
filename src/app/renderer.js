const petIcon = document.getElementById("petIcon");
const petPanel = document.getElementById("petPanel");
const bubble = document.getElementById("bubble");
const spinner = document.getElementById("spinner");
const settingsButton = document.getElementById("settingsButton");
const historyButton = document.getElementById("historyButton");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");

const MAX_HISTORY = 100;
let bubbleTimeoutMs = 3000;
let bubbleTimer = null;
const historyItems = [];

function setSpinner(visible) {
  spinner.style.display = visible ? "block" : "none";
}

function setPetIcon(path) {
  if (!path) {
    petIcon.style.display = "none";
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
    const div = document.createElement("div");
    div.className = "history-item";
    div.textContent = item;
    historyList.appendChild(div);
  });
}

function showBubble(text) {
  bubble.style.display = "block";
  bubble.textContent = text;
  addHistory(text);
  resetBubbleTimer();
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

const api = window.tablecat;

setSpinner(true);
showBubble("准备中…");

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
  });
}

settingsButton.addEventListener("click", () => {
  showBubble("设置功能待接入");
});

historyButton.addEventListener("click", () => {
  historyPanel.classList.toggle("visible");
});
