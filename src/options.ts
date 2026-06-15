import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import { storageGet, storageSet } from "./utils";

const OPTIONS_STORAGE_KEY = "timvis_options";
const DEFAULT_LIMIT_MS = 5 * 1000;

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

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function pathMatches(pathname: string, pathPrefix: string): boolean {
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function getOriginPatterns(config: BlockedDomainConfig): string[] {
  return [`http://${config.domain}/*`, `https://${config.domain}/*`];
}

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

export function getContentScriptMatches(config: BlockedDomainConfig): string[] {
  return [
    `http://${config.domain}/*`,
    `http://*.${config.domain}/*`,
    `https://${config.domain}/*`,
    `https://*.${config.domain}/*`,
  ];
}

/**
 * Returns the blocked domain config for the given URL, or null if the URL is invalid or not blocked.
 * The domain matching is done by checking if the URL's hostname is equal to or a subdomain of the config's domain.
 */
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
  const normalizedOptions = normalizeOptions(options);
  const granted = await requestHostPermissions(normalizedOptions.blockedDomains);
  if (!granted) {
    throw new Error("Host permissions were not granted.");
  }

  await storageSet<ExtensionOptions>({ [OPTIONS_STORAGE_KEY]: normalizedOptions });
  chrome.runtime.sendMessage({ type: "optionsChanged" });
}

export { DEFAULT_OPTIONS, OPTIONS_STORAGE_KEY };
