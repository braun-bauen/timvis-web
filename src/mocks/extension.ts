import type { ExtensionData } from "../types";

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
  runtime: {
    sendMessage: () => undefined,
  },
};

const existingChrome = (globalThis as { chrome?: Record<string, unknown> }).chrome;

if (existingChrome) {
  Object.assign(existingChrome, mockChrome);
} else {
  (globalThis as { chrome?: Record<string, unknown> }).chrome = mockChrome;
}
