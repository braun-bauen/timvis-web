import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import { storageGet, storageSet } from "./utils";
import "./options.css";

const OPTIONS_STORAGE_KEY = "timvis_options";

const DEFAULT_OPTIONS: ExtensionOptions = {
  blockedDomains: [],
};

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
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
  chrome.runtime.sendMessage({ type: "optionsChanged" });
}

export { DEFAULT_OPTIONS, OPTIONS_STORAGE_KEY };

type DomainFormElements = {
  card: HTMLElement;
  domainInput: HTMLInputElement;
  limitInput: HTMLInputElement;
  unitInput: HTMLSelectElement;
  pathsInput: HTMLTextAreaElement;
};

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element`);
  }
  return element as T;
}

function getDomainFormElements(card: HTMLElement): DomainFormElements {
  const domainInput = card.querySelector<HTMLInputElement>(".domain-input");
  const limitInput = card.querySelector<HTMLInputElement>(".limit-input");
  const unitInput = card.querySelector<HTMLSelectElement>(".unit-input");
  const pathsInput = card.querySelector<HTMLTextAreaElement>(".paths-input");

  if (!domainInput || !limitInput || !unitInput || !pathsInput) {
    throw new Error("Domain form is missing fields.");
  }

  return { card, domainInput, limitInput, unitInput, pathsInput };
}

function setStatus(message: string, type: "error" | "success" | "" = ""): void {
  const status = requireElement<HTMLElement>("status");
  status.textContent = message;
  status.className = type;
}

function splitWhitelistedPaths(value: string): string[] {
  return value
    .split(/\n|,/)
    .map(normalizePath)
    .filter((path) => path.length > 0);
}

function renderDomain(config?: BlockedDomainConfig): void {
  const domains = requireElement<HTMLElement>("domains");
  const template = requireElement<HTMLTemplateElement>("domain-template");
  const fragment = template.content.cloneNode(true);
  const card = (fragment as DocumentFragment).querySelector<HTMLElement>(
    ".domain-card",
  );
  if (!card) {
    throw new Error("Missing domain template card.");
  }

  const { domainInput, limitInput, unitInput, pathsInput } =
    getDomainFormElements(card);
  const limitSeconds = Math.max(
    1,
    Math.round((config?.limitMs ?? 5 * 60_000) / 1000),
  );
  const useMinutes = limitSeconds % 60 === 0;
  domainInput.value = config?.domain ?? "";
  limitInput.value = String(useMinutes ? limitSeconds / 60 : limitSeconds);
  unitInput.value = useMinutes ? "minutes" : "seconds";
  pathsInput.value = config?.whitelistedPaths.join("\n") ?? "";

  card.querySelector(".remove-domain")?.addEventListener("click", () => {
    card.remove();
    setStatus("");
  });

  domains.append(card);
}

function readOptionsFromForm(): ExtensionOptions {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(".domain-card"),
  );
  const blockedDomains = cards.map((card) => {
    const { domainInput, limitInput, unitInput, pathsInput } =
      getDomainFormElements(card);
    const domain = normalizeDomain(domainInput.value);
    const multiplier = unitInput.value === "seconds" ? 1000 : 60_000;
    const limitMs = Math.floor(Number(limitInput.value) * multiplier);

    return {
      id: domain,
      domain,
      limitMs,
      whitelistedPaths: splitWhitelistedPaths(pathsInput.value),
    };
  });

  const emptyDomains = blockedDomains.filter((config) => !config.domain).length;
  if (emptyDomains > 0) {
    throw new Error("Each domain needs a value.");
  }

  const invalidLimits = blockedDomains.filter(
    (config) => config.limitMs <= 0,
  ).length;
  if (invalidLimits > 0) {
    throw new Error("Each domain needs a time limit greater than zero.");
  }

  return { blockedDomains };
}

async function loadOptionsUi(): Promise<void> {
  const options = await getOptions();
  requireElement<HTMLElement>("domains").textContent = "";
  options.blockedDomains.forEach((config) => renderDomain(config));
}

function setupOptionsUi(): void {
  requireElement<HTMLButtonElement>("add-domain").addEventListener(
    "click",
    () => {
      renderDomain();
      setStatus("");
    },
  );

  requireElement<HTMLButtonElement>("save").addEventListener(
    "click",
    async () => {
      const saveButton = requireElement<HTMLButtonElement>("save");
      saveButton.disabled = true;
      setStatus("Saving...");

      try {
        await saveOptions(readOptionsFromForm());
        await loadOptionsUi();
        setStatus("Options saved.", "success");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save options.";
        setStatus(message, "error");
      } finally {
        saveButton.disabled = false;
      }
    },
  );

  loadOptionsUi().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unable to load options.";
    setStatus(message, "error");
  });
}

if (typeof document !== "undefined") {
  setupOptionsUi();
}
