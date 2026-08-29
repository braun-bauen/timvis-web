import { env } from "./env";
import Options from "./options";
import type {
  Action,
  DomainData,
  RuntimeMessage,
  StatusMessage,
  StoredState,
} from "./types";
import { storageGet, storageSet } from "./utils";
import { evaluateDowntimeAccess } from "./downtime";

const WARN_BEFORE_MS = 60 * 1000;
const STATE_STORAGE_PREFIX = "timvis_state";
const CONTENT_SCRIPT_ID = "timvis_content";

const options = Options();

function getHourKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
}

function getStateStorageKey(config: DomainData): string {
  return `${STATE_STORAGE_PREFIX}:${config.id}`;
}

async function registerContentScripts(): Promise<void> {
  await chrome.scripting
    .unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] })
    .catch(() => undefined);

  const matches = await options.getContentMatches();
  if (matches.length === 0) {
    return;
  }

  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      matches,
      css: ["content.css"],
      js: ["content.js"],
      runAt: "document_idle",
    },
  ]);
}

async function getState(config: DomainData): Promise<StoredState> {
  const currentHour = getHourKey();
  const defaultState: StoredState = {
    hourKey: currentHour,
    usedMs: 0,
    warningShown: false,
    blocked: false,
  };

  const storageKey = getStateStorageKey(config);
  const stored = await storageGet<StoredState>(storageKey);
  const state = stored[storageKey] || defaultState;

  if (!state || state.hourKey !== currentHour) {
    return defaultState;
  }

  return {
    ...defaultState,
    ...state,
    blocked: state.blocked ?? state.usedMs >= config.limitMs,
  };
}

async function saveState(
  config: DomainData,
  state: StoredState,
): Promise<void> {
  await storageSet<StoredState>({ [getStateStorageKey(config)]: state });
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

async function sendMessageToDomainTabs(
  config: DomainData,
  message: Action,
): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    if (tab.url && options.getBlockedDomainForUrl([config], tab.url)) {
      sendMessageToTab(tab.id, message);
    }
  }
}

async function refreshOrInjectNewDomainTabs(domain: string): Promise<void> {
  const config = (await options.getDomains()).find(
    (candidate) => candidate.url === domain,
  );
  if (!config) {
    return;
  }

  const tabs = await chrome.tabs.query({
    url: options.getOriginPatterns(config),
  });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) {
        return;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, "refresh");
      } catch {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content.css"],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      }
    }),
  );
}

async function getConfigForUrl(
  url: string | undefined,
): Promise<DomainData | null> {
  if (!url) {
    return null;
  }
  const domains = await options.getDomains();
  return options.getBlockedDomainForUrl(domains, url);
}

async function handleTick(
  elapsedMs: number,
  senderTabId: number | null,
  url: string | undefined,
): Promise<void> {
  if (env.debug) {
    return;
  }

  const config = await getConfigForUrl(url);
  if (!config || !url) {
    return;
  }

  const state = await getState(config);
  const whitelisted = options.isWhitelistedUrl(config, url);
  const access = evaluateDowntimeAccess(config.downtimeRules, whitelisted);
  if (state.blocked || !access.shouldTrackUsage) {
    return;
  }
  const warnAtMs = config.limitMs - WARN_BEFORE_MS;
  state.usedMs += elapsedMs;

  if (state.usedMs >= config.limitMs && !state.blocked) {
    state.blocked = true;
    await sendMessageToDomainTabs(config, "block");
  } else if (warnAtMs > 0 && state.usedMs >= warnAtMs && !state.warningShown) {
    state.warningShown = true;
    sendMessageToTab(senderTabId, "warn");
  }

  await saveState(config, state);
}

async function handleGetStatus(
  url: string | undefined,
): Promise<StatusMessage> {
  if (env.debug) {
    return {
      blocked: false,
      downtime: false,
      showWarning: false,
      debug: true,
      whitelisted: false,
    };
  }

  const config = await getConfigForUrl(url);
  if (!config || !url) {
    return {
      blocked: false,
      downtime: false,
      showWarning: false,
      debug: false,
      whitelisted: false,
    };
  }

  const whitelisted = options.isWhitelistedUrl(config, url);
  const state = await getState(config);
  const access = evaluateDowntimeAccess(config.downtimeRules, whitelisted);
  const warnAtMs = config.limitMs - WARN_BEFORE_MS;
  let showWarning = false;

  if (
    !whitelisted &&
    !access.downtimeBlocked &&
    warnAtMs > 0 &&
    !state.blocked &&
    state.usedMs >= warnAtMs &&
    !state.warningShown
  ) {
    state.warningShown = true;
    showWarning = true;
    await saveState(config, state);
  }

  return {
    blocked: access.downtimeBlocked || (!whitelisted && state.blocked),
    downtime: access.downtimeBlocked,
    showWarning,
    debug: false,
    whitelisted: access.accessibleByWhitelist,
    domainConfigId: config.id,
    domain: config.url,
  };
}

async function handleDebugAction(
  action: Action | undefined,
): Promise<{ ok: boolean }> {
  if (!env.debug || !action) {
    return { ok: false };
  }

  const domains = await options.getDomains();

  if (action === "unblock") {
    await Promise.all(
      domains.map(async (config) => {
        const state = await getState(config);
        state.blocked = false;
        state.warningShown = false;
        await saveState(config, state);
      }),
    );
  }

  await Promise.all(
    domains.map(async (config) => {
      await sendMessageToDomainTabs(config, action);
    }),
  );

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
      const url = runtimeMessage.url ?? sender?.tab?.url;
      handleTick(elapsedMs, senderTabId, url)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (runtimeMessage.type === "getStatus") {
      handleGetStatus(runtimeMessage.url ?? sender?.tab?.url)
        .then((status) => sendResponse(status))
        .catch(() =>
          sendResponse({
            blocked: false,
            downtime: false,
            showWarning: false,
            debug: false,
            whitelisted: false,
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

    if (runtimeMessage.type === "optionsChanged") {
      registerContentScripts()
        .then(async () => {
          if (runtimeMessage.addedDomain) {
            await refreshOrInjectNewDomainTabs(runtimeMessage.addedDomain);
          } else {
            const domains = await options.getDomains();
            const tabs = await chrome.tabs.query({
              url: ["http://*/*", "https://*/*"],
            });
            tabs.forEach((tab) => {
              if (tab.url && options.getBlockedDomainForUrl(domains, tab.url)) {
                sendMessageToTab(tab.id, "refresh");
              }
            });
          }
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    return false;
  },
);

chrome.runtime.onInstalled.addListener(() => {
  registerContentScripts().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  registerContentScripts().catch(() => undefined);
});

export {};
