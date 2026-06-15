import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import { storageGet, storageSet } from "./utils";

const OPTIONS_STORAGE_KEY = "timvis_options";
const DEFAULT_LIMIT_MS = 5 * 60 * 1000;

const DEFAULT_OPTIONS: ExtensionOptions = {
  blockedDomains: [
    {
      id: "x.com",
      domain: "x.com",
      limitMs: DEFAULT_LIMIT_MS,
      whitelistedPaths: ["/i/bookmarks", "/i/chat"],
    },
  ],
};

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeBlockedDomain(
  config: Partial<BlockedDomainConfig>,
): BlockedDomainConfig | null {
  const domain = normalizeDomain(config.domain ?? "");
  if (!domain) {
    return null;
  }

  const limitMs = Math.max(0, Math.floor(Number(config.limitMs) || 0));
  if (!limitMs) {
    return null;
  }

  return {
    id: config.id?.trim() || domain,
    domain,
    limitMs,
    whitelistedPaths: Array.from(
      new Set(
        (config.whitelistedPaths ?? [])
          .map(normalizePath)
          .filter((path) => path.length > 0),
      ),
    ),
  };
}

function normalizeOptions(options: Partial<ExtensionOptions>): ExtensionOptions {
  const blockedDomains = (options.blockedDomains ?? [])
    .map(normalizeBlockedDomain)
    .filter((config): config is BlockedDomainConfig => Boolean(config));

  return {
    blockedDomains:
      blockedDomains.length > 0 ? blockedDomains : DEFAULT_OPTIONS.blockedDomains,
  };
}

export async function getOptions(): Promise<ExtensionOptions> {
  const stored = await storageGet<ExtensionOptions>(OPTIONS_STORAGE_KEY);
  return normalizeOptions(stored[OPTIONS_STORAGE_KEY] ?? DEFAULT_OPTIONS);
}

export async function saveOptions(options: ExtensionOptions): Promise<void> {
  await storageSet<ExtensionOptions>({ [OPTIONS_STORAGE_KEY]: normalizeOptions(options) });
}

export { DEFAULT_OPTIONS, OPTIONS_STORAGE_KEY };
