import { getUsageWindow } from "../usage-window";
import Options from "../options";
import { evaluateDowntime, evaluateDowntimeAccess, getDowntimeRules } from "../downtime";
import type { RuntimeMessage, ExtensionData } from "../types";

// LAN previews use HTTP, where randomUUID is unavailable outside localhost.
if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

const OPTIONS_STORAGE_KEY = "timvis_options";

const mockOptions: ExtensionData = {
  domains: [
    {
      id: "mock-social",
      url: "social.example.com",
      limitMs: 15 * 60_000,
      whitelistedPaths: ["/messages", "/settings"],
      downtimeRules: [
        {
          id: "mock-evenings",
          weekdays: [1, 2, 3, 4, 5],
          startMinutes: 21 * 60,
          endMinutes: 7 * 60,
          allDay: false,
          allowWhitelistedPaths: true,
        },
      ],
    },
    {
      id: "mock-video",
      url: "video.example.com",
      limitMs: 30_000,
      whitelistedPaths: [],
      downtimeRules: [
        {
          id: "mock-weekend",
          weekdays: [0, 6],
          startMinutes: 0,
          endMinutes: 0,
          allDay: true,
          allowWhitelistedPaths: false,
        },
      ],
    },
    {
      id: "mock-empty",
      url: "news.example.com",
      limitMs: 5 * 60_000,
      whitelistedPaths: [],
      downtimeRules: [],
    },
  ],
};

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

const data: Record<string, unknown> = {
  [OPTIONS_STORAGE_KEY]: structuredClone(mockOptions),
  timvis_theme: "system",
};
const storageListeners = new Set<StorageListener>();

const mockChrome = {
  storage: {
    local: {
      get(key: string, callback: (items: Record<string, unknown>) => void) {
        callback({ [key]: data[key] });
      },
      set(values: Record<string, unknown>, callback?: () => void) {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [key, newValue] of Object.entries(values)) {
          changes[key] = { oldValue: data[key], newValue };
          data[key] = newValue;
        }
        storageListeners.forEach((listener) => listener(changes, "local"));
        callback?.();
      },
      remove(keys: string[], callback?: () => void) {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        keys.forEach((key) => {
          changes[key] = { oldValue: data[key] };
          delete data[key];
        });
        storageListeners.forEach((listener) => listener(changes, "local"));
        callback?.();
      },
    },
    onChanged: {
      addListener(listener: StorageListener) {
        storageListeners.add(listener);
      },
    },
  },
  permissions: {
    contains: async () => true,
    request: async () => true,
    remove: async () => true,
  },
  tabs: { query: async () => [{ id: 1, url: "https://news.example.com/" }] },
  runtime: {
    async sendMessage(message: RuntimeMessage) {
      if (message.type !== "getPopupStatus") return { ok: true };
      const options = Options();
      const domains = await options.getDomains();
      const domain = message.domainConfigId
        ? domains.find((item) => item.id === message.domainConfigId)
        : options.getBlockedDomainForUrl(domains, message.url ?? "");
      if (!domain)
        return {
          blocked: false,
          downtime: false,
          showWarning: false,
          debug: false,
          whitelisted: false,
        };
      const access = evaluateDowntimeAccess(
        getDowntimeRules(domain),
        options.isWhitelistedUrl(domain, message.url ?? ""),
      );
      return {
        blocked: access.downtimeBlocked,
        downtime: access.downtimeBlocked,
        showWarning: false,
        debug: false,
        whitelisted: access.accessibleByWhitelist,
        domainConfigId: domain.id,
        domain: domain.url,
        usedMs: 0,
        allowanceMs: domain.limitMs,
        remainingMs: domain.limitMs,
        resetAt: getUsageWindow(domain.resetHours ?? 1).resetAt,
        downtimeActive: evaluateDowntime(getDowntimeRules(domain)).active,
      };
    },
  },
};

const existingChrome = (globalThis as { chrome?: Record<string, unknown> }).chrome;

if (existingChrome) {
  Object.assign(existingChrome, mockChrome);
} else {
  (globalThis as { chrome?: Record<string, unknown> }).chrome = mockChrome;
}
