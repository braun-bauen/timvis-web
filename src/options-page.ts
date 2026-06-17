import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-block";
import "@esri/calcite-components/components/calcite-block-group";
import "@esri/calcite-components/components/calcite-alert";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-input";
import "@esri/calcite-components/components/calcite-text-area";
import "@esri/calcite-components/components/calcite-select";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-dialog";

import type { BlockedDomainConfig, ExtensionOptions } from "./types";
import {
  getOptions,
  normalizeDomain,
  normalizePath,
  saveOptions,
} from "./options";
import "./options.css";

type DomainFormElements = {
  unitInput: HTMLCalciteSelectElement;
  limitInput: HTMLCalciteInputElement;
  whitelistInput: HTMLCalciteTextAreaElement;
};

type DialogResult = { action: "save"; value: string } | { action: "cancel" };

function getElement<T extends HTMLElement>(
  query: string,
  root?: Element | DocumentFragment,
): T {
  const queryRoot = root ?? document;
  const element = queryRoot.querySelector(query);
  if (!element) {
    throw new Error(`Missing ${query} element`);
  }
  return element as T;
}

function getDomainFormElements(
  block: HTMLCalciteBlockElement,
): DomainFormElements {
  return {
    unitInput: getElement<HTMLCalciteSelectElement>(
      "[data-field='unit']",
      block,
    ),
    limitInput: getElement<HTMLCalciteInputElement>(
      "[data-field='limit']",
      block,
    ),
    whitelistInput: getElement<HTMLCalciteTextAreaElement>(
      "[data-field='whitelist']",
      block,
    ),
  };
}

type StatusOptions = {
  title: string;
  message?: string;
  kind?: HTMLCalciteAlertElement["kind"];
};

function emitAlert({
  title,
  message = "",
  kind = "brand",
}: StatusOptions): void {
  const panelEl = getElement<HTMLCalcitePanelElement>("calcite-panel");
  const alertTemplate = getElement<HTMLTemplateElement>("#alert-template");
  const alertEl = getElement<HTMLCalciteAlertElement>(
    "calcite-alert",
    alertTemplate.content,
  );
  const alert = alertEl.cloneNode(true) as HTMLCalciteAlertElement;

  alert.kind = kind;
  alert.autoClose = kind !== "danger";
  alert.open = true;
  getElement("[slot='title']", alert).textContent = title;

  if (message) {
    const messageEl = document.createElement("div");
    messageEl.textContent = message;
    messageEl.setAttribute("slot", "message");
    alert.append(messageEl);
  }

  panelEl.append(alert);
}

function splitWhitelistedPaths(value: string): string[] {
  return value
    .split(/\n|,/)
    .map(normalizePath)
    .filter((path) => path.length > 0);
}

function editDomain({
  domain = "",
  create = false,
}: {
  domain?: string;
  create?: boolean;
}): Promise<DialogResult> {
  const dialog = getElement<HTMLCalciteDialogElement>("#edit-dialog");
  const input = getElement<HTMLCalciteInputElement>(
    "#edit-domain-input",
    dialog,
  );
  const saveButton = getElement<HTMLCalciteButtonElement>("#edit-save", dialog);
  const cancelButton = getElement<HTMLCalciteButtonElement>(
    "#edit-cancel",
    dialog,
  );

  dialog.heading = create ? "Add Domain" : "Edit Domain";
  input.value = domain;

  return new Promise((resolve) => {
    let result: DialogResult = { action: "cancel" };

    const cleanup = () => {
      saveButton.removeEventListener("click", handleSave);
      saveButton.addEventListener("keypress", handleKeySave);
      cancelButton.removeEventListener("click", handleCancel);
      dialog.removeEventListener("calciteDialogClose", handleClose);
    };

    const handleKeySave = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      }
    };

    const handleSave = () => {
      result = {
        action: "save",
        value: normalizeDomain(input.value),
      };

      dialog.open = false;
    };

    const handleCancel = () => {
      dialog.open = false;
    };

    const handleClose = () => {
      cleanup();
      resolve(result);
    };

    saveButton.addEventListener("click", handleSave);
    saveButton.addEventListener("keypress", handleKeySave);
    cancelButton.addEventListener("click", handleCancel);
    dialog.addEventListener("calciteDialogClose", handleClose, {
      once: true,
    });

    dialog.open = true;
    input.setFocus();
    input.selectText();
  });
}

function renderDomain({
  config,
  expanded = false,
}: {
  config?: BlockedDomainConfig;
  expanded?: boolean;
}): void {
  const domainGroup = getElement<HTMLCalciteBlockGroupElement>("#domains");
  const template = getElement<HTMLTemplateElement>("#domain-template");
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const block = getElement<HTMLCalciteBlockElement>("calcite-block", fragment);
  const { unitInput, limitInput, whitelistInput } =
    getDomainFormElements(block);

  // Setup values
  const limitSeconds = Math.max(
    1,
    Math.round((config?.limitMs ?? 5 * 60_000) / 1000),
  );
  const useMinutes = limitSeconds % 60 === 0;

  block.heading = config?.domain ?? "";
  block.expanded = expanded;
  limitInput.value = String(useMinutes ? limitSeconds / 60 : limitSeconds);
  unitInput.value = useMinutes ? "minutes" : "seconds";
  whitelistInput.value = config?.whitelistedPaths.join("\n") ?? "";

  // Setup actions
  getElement<HTMLCalciteActionElement>(
    "[data-action='edit-domain']",
    block,
  ).addEventListener("click", async () => {
    const result = await editDomain({ domain: block.heading });

    if (result.action === "save") {
      block.heading = result.value;
    }
  });

  getElement<HTMLCalciteActionElement>(
    "[data-action='delete-domain']",
    block,
  ).addEventListener("click", () => {
    block.remove();
  });

  domainGroup.append(block);
}

function readOptionsFromForm(): ExtensionOptions {
  const blocks = Array.from(
    document.querySelectorAll<HTMLCalciteBlockElement>(
      "#domains calcite-block",
    ),
  );
  const blockedDomains = blocks.map((block) => {
    const { unitInput, limitInput, whitelistInput } =
      getDomainFormElements(block);
    const domain = normalizeDomain(block.heading);
    const multiplier = unitInput.value === "seconds" ? 1000 : 60_000;
    const limitMs = Math.floor(Number(limitInput.value) * multiplier);

    return {
      id: domain,
      domain,
      limitMs,
      whitelistedPaths: splitWhitelistedPaths(whitelistInput.value),
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
  const domainsGroup = getElement<HTMLCalciteBlockGroupElement>("#domains");
  domainsGroup.textContent = "";
  options.blockedDomains.forEach((config) => renderDomain({ config }));
}

function setupOptionsUi(): void {
  getElement<HTMLCalciteActionElement>("#add-domain").addEventListener(
    "click",
    async () => {
      const result = await editDomain({ create: true });
      if (result.action === "cancel") {
        return;
      }

      renderDomain({
        config: {
          id: result.value,
          domain: result.value,
          limitMs: 5 * 60_000,
          whitelistedPaths: [],
        },
        expanded: true,
      });
    },
  );

  const saveAction = getElement<HTMLCalciteActionElement>("#save");
  saveAction.addEventListener("click", async () => {
    saveAction.disabled = true;

    try {
      await saveOptions(readOptionsFromForm());
      await loadOptionsUi();
      emitAlert({
        title: "Changes saved",
        message:
          "If a domain is already open, refresh the tab to load the new changes.",
        kind: "success",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save options.";
      emitAlert({
        title: "Sorry, something went wrong",
        message,
        kind: "danger",
      });
    } finally {
      saveAction.disabled = false;
    }
  });

  loadOptionsUi().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unable to load options.";
    emitAlert({
      title: "Sorry, something went wrong",
      message,
      kind: "danger",
    });
  });
}

setupOptionsUi();
