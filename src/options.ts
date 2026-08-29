import type { DomainData, DowntimeRule, ExtensionData, ValidatedUrl } from "./types";
import { storageGet, storageRemove, storageSet } from "./utils";


export default function Options() {
  const OPTIONS_STORAGE_KEY = "timvis_options";
  const STATE_STORAGE_PREFIX = "timvis_state";

  async function getData(): Promise<ExtensionData> {
    const stored = await storageGet<ExtensionData>(OPTIONS_STORAGE_KEY);
    const data = stored[OPTIONS_STORAGE_KEY] ?? {
      domains: []
    }

    return normalizeData(data);
  }

  async function save(
    data: ExtensionData,
    addedDomain?: string,
  ): Promise<void> {
    await storageSet<ExtensionData>({
      [OPTIONS_STORAGE_KEY]: normalizeData(data),
    });

    chrome.runtime.sendMessage({ type: "optionsChanged", addedDomain });
  }

  async function getDomains(): Promise<DomainData[]> {
    const { domains } = await getData();
    return domains;
  }

  async function addDomain(domain: DomainData): Promise<{ error?: string }> {
    const data = await getData();

    const validatedUrl = await validateUrl(domain.url);
    if (validatedUrl.error) {
      return { error: `Invalid domain URL: ${validatedUrl.error}` };
    }

    domain.url = validatedUrl.url;

    data.domains.push(domain);

    const granted = await requestHostPermissions(domain);
    if (!granted) {
      return { error: `Host permissions were not granted for domain: ${domain.url}` };
    }

    await save(data, domain.url);
    return { error: undefined };
  }

  async function removeDomain(domain: DomainData): Promise<void> {
    const data = await getData();
    data.domains = data.domains.filter((config) => config.id !== domain.id);
    await save(data);

    await Promise.all([
      storageRemove([getStateStorageKey(domain)]),
      removeHostPermissions(domain),
    ]);
  }

  async function updateDomain(domain: DomainData): Promise<{ error?: string }> {
    const data = await getData();
    const index = data.domains.findIndex((config) => config.id === domain.id);
    if (index === -1) {
      return { error: `Domain with id ${domain.id} not found.` };
    }
    data.domains[index] = domain;
    await save(data);
    return { error: undefined };
  }

  async function getContentMatches(): Promise<string[]> {
    const domains = await getDomains();
    const matches = new Set<string>();

    await Promise.all(
      domains.map(async (domain) => {
        if (await hasHostPermissions(domain)) {
          getOriginPatterns(domain).forEach((pattern) => matches.add(pattern));
        }
      })
    );

    return Array.from(matches);
  }

  function normalizeData(data: Partial<ExtensionData>): ExtensionData {
    const normalized = (data.domains ?? [])
      .map(normalizeDomain)
      .filter((config): config is DomainData => config !== null);

    const uniqueByUrl = new Map(normalized.map((domain) => [domain.url, domain]));
    return { domains: Array.from(uniqueByUrl.values()) };
  }

  function normalizeUrl(url: string): string {
    return url
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0];
  }

  /**
   * Validates a given domain string. Checks if the domain is non-empty and is not duplicate.
   */
  async function validateUrl(url: string): Promise<ValidatedUrl> {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return { url: normalizedUrl, error: "empty" };
    }

    const domains = await getDomains();
    const isDuplicate = domains.some((config) => config.url === normalizedUrl);
    if (isDuplicate) {
      return { url: normalizedUrl, error: "duplicate" };
    }

    return { url: normalizedUrl };
  }

  function normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  function normalizeDomain(
    config: Partial<DomainData>,
  ): DomainData | null {
    const domain = normalizeUrl(config.url ?? "");
    if (!domain) {
      return null;
    }

    const limitMs = Math.max(0, Math.floor(Number(config.limitMs) || 0));
    if (!limitMs) {
      return null;
    }

    return {
      id: (config.id ? String(config.id).trim() : "") || domain,
      url: domain,
      limitMs,
      whitelistedPaths: Array.from(
        new Set(
          (config.whitelistedPaths ?? [])
            .map(normalizePath)
            .filter((path) => path.length > 0),
        ),
      ),
      downtimeRules: (config.downtimeRules ?? []).map(normalizeDowntimeRule),
    };
  }

  function normalizeDowntimeRule(rule: Partial<DowntimeRule>): DowntimeRule {
    return {
      id: String(rule.id || crypto.randomUUID()),
      weekdays: Array.from(new Set((rule.weekdays ?? []).map(Number)))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      startMinutes: Math.min(1439, Math.max(0, Math.floor(Number(rule.startMinutes) || 0))),
      endMinutes: Math.min(1439, Math.max(0, Math.floor(Number(rule.endMinutes) || 0))),
      allDay: Boolean(rule.allDay),
      allowWhitelistedPaths: Boolean(rule.allowWhitelistedPaths),
    };
  }

  function getStateStorageKey(config: DomainData): string {
    return `${STATE_STORAGE_PREFIX}:${config.id}`;
  }

  function domainMatches(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function pathMatches(pathname: string, pathPrefix: string): boolean {
    return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
  }

  function getOriginPatterns(config: DomainData): string[] {
    return [
      `http://${config.url}/*`,
      `http://*.${config.url}/*`,
      `https://${config.url}/*`,
      `https://*.${config.url}/*`,
    ];
  }

  async function requestHostPermissions(
    domain: DomainData,
  ): Promise<boolean> {
    const origins = getOriginPatterns(domain);
    if (origins.length === 0) {
      return false;
    }

    const hasPermissions = await chrome.permissions.contains({ origins });
    if (hasPermissions) {
      return true;
    }

    return chrome.permissions.request({ origins });
  }

  async function hasHostPermissions(
    config: DomainData,
  ): Promise<boolean> {
    return chrome.permissions.contains({ origins: getOriginPatterns(config) });
  }

  async function removeHostPermissions(domain: DomainData): Promise<void> {
    const origins = getOriginPatterns(domain);
    if (origins.length === 0) {
      return;
    }

    await chrome.permissions.remove({ origins });
  }

  function getBlockedDomainForUrl(
    domains: DomainData[],
    url: string,
  ): DomainData | null {
    try {
      const parsedUrl = new URL(url);
      return (
        domains.find((config) =>
          domainMatches(parsedUrl.hostname.toLowerCase(), config.url),
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  function isWhitelistedUrl(
    config: DomainData,
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

  return {
    getDomains,
    getContentMatches,
    getBlockedDomainForUrl,
    addDomain,
    removeDomain,
    updateDomain,
    isWhitelistedUrl,
    normalizeUrl,
    normalizePath,
    validateUrl,
    hasHostPermissions,
    getOriginPatterns,
  }
}
