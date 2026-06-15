import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import { storageGet, storageRemove, storageSet } from "./utils";

const OPTIONS_STORAGE_KEY = "timvis_options";
const STATE_STORAGE_PREFIX = "timvis_state";

const DEFAULT_OPTIONS: ExtensionOptions = {
  blockedDomains: [],
};

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

export function normalizePath(path: string): string {
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

function normalizeOptions(
  options: Partial<ExtensionOptions>,
): ExtensionOptions {
  const blockedDomains = (options.blockedDomains ?? [])
    .map(normalizeBlockedDomain)
    .filter((config): config is BlockedDomainConfig => Boolean(config));

  return {
    blockedDomains:
      blockedDomains.length > 0
        ? blockedDomains
        : DEFAULT_OPTIONS.blockedDomains,
  };
}

function getStateStorageKey(config: BlockedDomainConfig): string {
  return `${STATE_STORAGE_PREFIX}:${config.id}`;
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathMatches(pathname: string, pathPrefix: string): boolean {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function getOriginPatterns(config: BlockedDomainConfig): string[] {
  return [
    `http://${config.domain}/*`,
    `http://*.${config.domain}/*`,
    `https://${config.domain}/*`,
    `https://*.${config.domain}/*`,
  ];
}

export const getContentScriptMatches = getOriginPatterns;

export async function requestHostPermissions(
  configs: BlockedDomainConfig[],
): Promise<boolean> {
  const origins = Array.from(new Set(configs.flatMap(getOriginPatterns)));
  if (origins.length === 0) {
    return false;
  }

  const hasPermissions = await chrome.permissions.contains({ origins });
  if (hasPermissions) {
    return true;
  }

  return chrome.permissions.request({ origins });
}

export async function hasHostPermissions(
  config: BlockedDomainConfig,
): Promise<boolean> {
  return chrome.permissions.contains({ origins: getOriginPatterns(config) });
}

async function removeHostPermissions(configs: BlockedDomainConfig[]): Promise<void> {
  const origins = Array.from(new Set(configs.flatMap(getOriginPatterns)));
  if (origins.length === 0) {
    return;
  }

  await chrome.permissions.remove({ origins });
}

async function getConfigsMissingHostPermissions(
  configs: BlockedDomainConfig[],
): Promise<BlockedDomainConfig[]> {
  const missingPermissions: BlockedDomainConfig[] = [];

  for (const config of configs) {
    if (!(await hasHostPermissions(config))) {
      missingPermissions.push(config);
    }
  }

  return missingPermissions;
}

export function getBlockedDomainForUrl(
  options: ExtensionOptions,
  url: string,
): BlockedDomainConfig | null {
  try {
    const parsedUrl = new URL(url);
    return (
      options.blockedDomains.find((config) =>
        domainMatches(parsedUrl.hostname.toLowerCase(), config.domain),
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function isWhitelistedUrl(
  config: BlockedDomainConfig,
  url: string,
): boolean {
  try {
    const parsedUrl = new URL(url);
    return config.whitelistedPaths.some((pathPrefix) =>
      pathMatches(parsedUrl.pathname, pathPrefix),
    );
  } catch {
    return false;
  }
}

export async function getOptions(): Promise<ExtensionOptions> {
  const stored = await storageGet<ExtensionOptions>(OPTIONS_STORAGE_KEY);
  return normalizeOptions(stored[OPTIONS_STORAGE_KEY] ?? DEFAULT_OPTIONS);
}

export async function saveOptions(options: ExtensionOptions): Promise<void> {
  const previousOptions = await getOptions();
  const normalizedOptions = normalizeOptions(options);
  const configsNeedingPermission = await getConfigsMissingHostPermissions(
    normalizedOptions.blockedDomains,
  );
  const granted =
    configsNeedingPermission.length === 0 ||
    (await requestHostPermissions(configsNeedingPermission));
  if (!granted) {
    throw new Error("Host permissions were not granted.");
  }

  await storageSet<ExtensionOptions>({
    [OPTIONS_STORAGE_KEY]: normalizedOptions,
  });
  const currentIds = new Set(
    normalizedOptions.blockedDomains.map((config) => config.id),
  );
  const removedConfigs = previousOptions.blockedDomains.filter(
    (config) => !currentIds.has(config.id),
  );
  if (removedConfigs.length > 0) {
    await storageRemove(removedConfigs.map(getStateStorageKey));
    await removeHostPermissions(removedConfigs);
  }
  chrome.runtime.sendMessage({ type: "optionsChanged" });
}

export { DEFAULT_OPTIONS, OPTIONS_STORAGE_KEY };
