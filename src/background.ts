import { getUsageWindow, legacyResetAt } from "./usage-window";
import { env } from "./env";
import Options from "./options";
import type { Action, DomainData, RuntimeMessage, StatusMessage, StoredState } from "./types";
import { storageGet, storageSet } from "./utils";
import { evaluateDowntime, evaluateDowntimeAccess, getDowntimeRules } from "./downtime";

const WARN_BEFORE_MS = 60 * 1000;
const STATE_STORAGE_PREFIX = "timvis_state";
const CONTENT_SCRIPT_ID = "timvis_content";

const options = Options();
// Serialize state reads and writes so ticks and webpage warnings cannot overwrite each other.
let pending = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
  const resetHours = config.resetHours ?? 1;
  const window = getUsageWindow(resetHours);
  const defaultState: StoredState = {
    hourKey: window.key,
    resetHours,
    resetAt: window.resetAt,
    usedMs: 0,
    warningShown: false,
    blocked: false,
  };

  const storageKey = getStateStorageKey(config);
  const stored = await storageGet<StoredState>(storageKey);
  const state = stored[storageKey] || defaultState;

  const intervalChanged = (state.resetHours ?? 1) !== resetHours;
  const previousReset = state.resetAt ?? legacyResetAt(state.hourKey);
  if (intervalChanged ? Date.now() >= previousReset : state.hourKey !== window.key) {
    return defaultState;
  }

  return {
    ...defaultState,
    ...state,
    hourKey: window.key,
    resetHours,
    resetAt: window.resetAt,
    blocked: state.usedMs >= config.limitMs,
  };
}

async function saveState(config: DomainData, state: StoredState): Promise<void> {
  await storageSet<StoredState>({ [getStateStorageKey(config)]: state });
}

function sendMessageToTab(tabId: number | undefined | null, message: Action): void {
  if (!tabId) {
    return;
  }

  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
  });
}

async function sendMessageToDomainTabs(config: DomainData, message: Action): Promise<void> {
  const domains = await options.getDomains();
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    if (tab.url && options.getBlockedDomainForUrl(domains, tab.url)?.id === config.id) {
      sendMessageToTab(tab.id, message);
    }
  }
}

async function refreshOrInjectNewDomainTabs(domain: string): Promise<void> {
  const config = (await options.getDomains()).find((candidate) => candidate.url === domain);
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

async function getConfigForUrl(url: string | undefined): Promise<DomainData | null> {
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
  const access = evaluateDowntimeAccess(getDowntimeRules(config), whitelisted);
  if (state.blocked || !access.shouldTrackUsage) {
    return;
  }
  const warnAtMs = config.limitMs - WARN_BEFORE_MS;
  state.usedMs += elapsedMs;

  if (state.usedMs >= config.limitMs && !state.blocked) {
    state.blocked = true;
    await saveState(config, state);
    await sendMessageToDomainTabs(config, "refresh");
    return;
  } else if (warnAtMs > 0 && state.usedMs >= warnAtMs && !state.warningShown) {
    state.warningShown = true;
    sendMessageToTab(senderTabId, "warn");
  }

  await saveState(config, state);
}

async function handleGetStatus(
  url: string | undefined,
  readOnly = false,
  domainConfigId?: string,
  loadedDomains?: DomainData[],
): Promise<StatusMessage> {
  if (env.debug && !readOnly) {
    return {
      blocked: false,
      downtime: false,
      showWarning: false,
      debug: true,
      whitelisted: false,
    };
  }

  const domains = loadedDomains ?? (await options.getDomains());
  const config =
    readOnly && domainConfigId
      ? (domains.find((domain) => domain.id === domainConfigId) ?? null)
      : options.getBlockedDomainForUrl(domains, url ?? "");
  if (readOnly && domainConfigId && config) url = `https://${config.url}/`;
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
  const access = evaluateDowntimeAccess(getDowntimeRules(config), whitelisted);
  const warnAtMs = config.limitMs - WARN_BEFORE_MS;
  let showWarning = false;

  if (
    !readOnly &&
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
    debug: env.debug,
    whitelisted: access.accessibleByWhitelist,
    domainConfigId: config.id,
    domain: config.url,
    usedMs: state.usedMs,
    allowanceMs: config.limitMs,
    remainingMs: Math.max(0, config.limitMs - state.usedMs),
    resetAt: state.resetAt,
    downtimeActive: evaluateDowntime(getDowntimeRules(config)).active,
  };
}

async function handleDebugAction(action: Action | undefined): Promise<{ ok: boolean }> {
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
    enqueue(() => handleTick(elapsedMs, senderTabId, url))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (runtimeMessage.type === "getPopupStatuses") {
    enqueue(async () => {
      const domains = await options.getDomains();
      const url = runtimeMessage.url ?? sender?.tab?.url;
      const currentSite = await handleGetStatus(url, true, undefined, domains);
      const statuses = await Promise.all(
        domains.map((domain) =>
          domain.id === currentSite.domainConfigId
            ? currentSite
            : handleGetStatus(undefined, true, domain.id, domains),
        ),
      );
      return { currentSite, domains: statuses };
    })
      .then(sendResponse)
      .catch(() => sendResponse(undefined));
    return true;
  }

  if (runtimeMessage.type === "getStatus" || runtimeMessage.type === "getPopupStatus") {
    enqueue(() =>
      handleGetStatus(
        runtimeMessage.url ?? sender?.tab?.url,
        runtimeMessage.type === "getPopupStatus",
        runtimeMessage.domainConfigId,
      ),
    )
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
    enqueue(() => handleDebugAction(runtimeMessage.action))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (runtimeMessage.type === "optionsChanged") {
    enqueue(async () => {
      for (const config of await options.getDomains()) {
        const key = getStateStorageKey(config);
        if ((await storageGet<StoredState>(key))[key]) {
          await saveState(config, await getState(config));
        }
      }
      await registerContentScripts();
      if (runtimeMessage.addedDomain) {
        await refreshOrInjectNewDomainTabs(runtimeMessage.addedDomain);
      } else {
        const tabs = await chrome.tabs.query({
          url: ["http://*/*", "https://*/*"],
        });
        tabs.forEach((tab) => {
          if (tab.url) {
            sendMessageToTab(tab.id, "refresh");
          }
        });
      }
    })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  registerContentScripts().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  registerContentScripts().catch(() => undefined);
});
