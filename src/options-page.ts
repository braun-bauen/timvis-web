import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import {
  getOptions,
  normalizeDomain,
  normalizePath,
  saveOptions,
} from "./options";
import "./options.css";

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

setupOptionsUi();
