import { env } from "./env";
import type {
  Action,
  RuntimeMessage,
  StatusMessage,
  StoredState,
} from "./types";

const LIMIT_MS = 5 * 60 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
const WARN_AT_MS = LIMIT_MS - WARN_BEFORE_MS;
const STORAGE_KEY = "tt_state";

function getHourKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function storageGet(
  key: string,
): Promise<Record<string, StoredState | undefined>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      resolve(items as Record<string, StoredState | undefined>);
    });
  });
}

function storageSet(value: Record<string, StoredState>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, () => resolve());
  });
}

async function getState(): Promise<StoredState> {
  const currentHour = getHourKey();
  const defaultState: StoredState = {
    hourKey: currentHour,
    usedMs: 0,
    warningShown: false,
    blocked: false,
  };

  const stored = await storageGet(STORAGE_KEY);
  const state = stored[STORAGE_KEY] || defaultState;

  if (!state || state.hourKey !== currentHour) {
    return defaultState;
  }

  return {
    ...defaultState,
    ...state,
    blocked: state.blocked ?? state.usedMs >= LIMIT_MS,
  };
}

async function saveState(state: StoredState): Promise<void> {
  await storageSet({ [STORAGE_KEY]: state });
}

function sendMessageToTab(
  tabId: number | undefined | null,
  message: Action,
): void {
  if (!tabId) {
    return;
  }

  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
  });
}

async function sendMessageToAllTwitterTabs(message: Action): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ["https://x.com/*", "https://*.x.com/*"],
  });
  for (const tab of tabs) {
    sendMessageToTab(tab.id, message);
  }
}

async function handleTick(
  elapsedMs: number,
  senderTabId: number | null,
): Promise<void> {
  if (env.debug) {
    return;
  }

  const state = await getState();
  state.usedMs += elapsedMs;

  if (state.usedMs >= LIMIT_MS && !state.blocked) {
    state.blocked = true;
    await sendMessageToAllTwitterTabs("block");
  } else if (state.usedMs >= WARN_AT_MS && !state.warningShown) {
    state.warningShown = true;
    sendMessageToTab(senderTabId, "warn");
  }

  await saveState(state);
}

async function handleGetStatus(): Promise<StatusMessage> {
  if (env.debug) {
    return {
      blocked: false,
      showWarning: false,
      debug: true,
    };
  }

  const state = await getState();
  let showWarning = false;

  if (!state.blocked && state.usedMs >= WARN_AT_MS && !state.warningShown) {
    state.warningShown = true;
    showWarning = true;
    await saveState(state);
  }

  return {
    blocked: state.blocked,
    showWarning,
    debug: false,
  };
}

async function handleDebugAction(
  action: Action | undefined,
): Promise<{ ok: boolean }> {
  if (!env.debug || !action || (action !== "warn" && action !== "block")) {
    return { ok: false };
  }

  await sendMessageToAllTwitterTabs(action);
  return { ok: true };
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      typeof message.type !== "string"
    ) {
      return false;
    }

    const runtimeMessage = message as RuntimeMessage;

    if (runtimeMessage.type === "tick") {
      const elapsedMs = Math.max(0, Number(runtimeMessage.elapsedMs) || 0);
      const senderTabId = sender?.tab?.id ?? null;
      handleTick(elapsedMs, senderTabId)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (runtimeMessage.type === "getStatus") {
      handleGetStatus()
        .then((status) => sendResponse(status))
        .catch(() =>
          sendResponse({
            blocked: false,
            showWarning: false,
          } as StatusMessage),
        );
      return true;
    }

    if (runtimeMessage.type === "debug") {
      handleDebugAction(runtimeMessage.action)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    return false;
  },
);

export { };
