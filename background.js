const LIMIT_MS = 5 * 60 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
const WARN_AT_MS = LIMIT_MS - WARN_BEFORE_MS;
const STORAGE_KEY = "tt_state";

function getHourKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });
}

async function getState() {
  const currentHour = getHourKey();
  const stored = await storageGet(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || {
    hourKey: currentHour,
    usedMs: 0,
    warningShown: false
  };

  if (state.hourKey !== currentHour) {
    return {
      hourKey: currentHour,
      usedMs: 0,
      warningShown: false
    };
  }

  return state;
}

async function saveState(state) {
  await storageSet({ [STORAGE_KEY]: state });
}

function sendMessageToTab(tabId, message) {
  if (!tabId) {
    return;
  }
  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
  });
}

async function sendMessageToAllTwitterTabs(message) {
  const tabs = await chrome.tabs.query({
    url: ["https://x.com/*", "https://*.x.com/*"]
  });
  for (const tab of tabs) {
    sendMessageToTab(tab.id, message);
  }
}

async function handleTick(elapsedMs, senderTabId) {
  const state = await getState();
  state.usedMs += elapsedMs;

  let shouldWarn = false;
  let shouldBlock = false;

  if (state.usedMs >= LIMIT_MS) {
    shouldBlock = true;
  } else if (state.usedMs >= WARN_AT_MS && !state.warningShown) {
    state.warningShown = true;
    shouldWarn = true;
  }

  await saveState(state);

  if (shouldWarn) {
    sendMessageToTab(senderTabId, {
      type: "warn",
      remainingMs: Math.max(0, LIMIT_MS - state.usedMs)
    });
  }

  if (shouldBlock) {
    await sendMessageToAllTwitterTabs({ type: "block" });
  }
}

async function handleGetStatus() {
  const state = await getState();
  const blocked = state.usedMs >= LIMIT_MS;
  let showWarning = false;

  if (!blocked && state.usedMs >= WARN_AT_MS && !state.warningShown) {
    state.warningShown = true;
    showWarning = true;
    await saveState(state);
  }

  return {
    usedMs: state.usedMs,
    limitMs: LIMIT_MS,
    warnAtMs: WARN_AT_MS,
    blocked,
    showWarning
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "tick") {
    const elapsedMs = Math.max(0, Number(message.elapsedMs) || 0);
    const senderTabId = sender?.tab?.id ?? null;
    handleTick(elapsedMs, senderTabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "getStatus") {
    handleGetStatus()
      .then((status) => sendResponse(status))
      .catch(() => sendResponse({
        usedMs: 0,
        limitMs: LIMIT_MS,
        warnAtMs: WARN_AT_MS,
        blocked: false,
        showWarning: false
      }));
    return true;
  }

  return false;
});
