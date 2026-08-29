import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-block";
import "@esri/calcite-components/components/calcite-block-group";
import "@esri/calcite-components/components/calcite-alert";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-input";
import "@esri/calcite-components/components/calcite-icon";
import "@esri/calcite-components/components/calcite-text-area";
import "@esri/calcite-components/components/calcite-select";
import "@esri/calcite-components/components/calcite-option";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-dialog";
import "@esri/calcite-components/components/calcite-chip";
import "@esri/calcite-components/components/calcite-chip-group";
import "@esri/calcite-components/components/calcite-input-time-picker";
import "@esri/calcite-components/components/calcite-switch";

import type {
  DomainFormElements,
  DialogResult,
  DomainData,
  DowntimeRule,
} from "./types";
import Options from "./options";
import { isValidDowntimeRule } from "./downtime";
import "./options.css";

const options = Options();

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

function getDomainFields(block: HTMLCalciteBlockElement): DomainFormElements {
  return {
    unitInput: getElement<HTMLCalciteSelectElement>("[name='unit']", block),
    limitInput: getElement<HTMLCalciteInputElement>("[name='limit']", block),
    whitelistInput: getElement<HTMLCalciteTextAreaElement>(
      "[name='whitelist']",
      block,
    ),
  };
}

function minutesToTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const remainder = String(minutes % 60).padStart(2, "0");
  return `${hours}:${remainder}`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

type StatusOptions = {
  title: string;
  message?: string;
  kind?: HTMLCalciteAlertElement["kind"];
  mountEl?: HTMLCalciteDialogElement;
};

function emitAlert({
  title,
  message = "",
  kind = "brand",
  mountEl,
}: StatusOptions): void {
  const alertTemplate = getElement<HTMLTemplateElement>("#alert-template");
  const alertEl = getElement<HTMLCalciteAlertElement>(
    "calcite-alert",
    alertTemplate.content,
  );
  const alert = alertEl.cloneNode(true) as HTMLCalciteAlertElement;

  alert.kind = kind;
  alert.autoClose = kind !== "danger";
  alert.autoCloseDuration = "fast";
  alert.open = true;
  alert.queue = mountEl || kind === "danger" ? "immediate" : "last";
  alert.scale = mountEl ? "s" : "m";
  getElement("[slot='title']", alert).textContent = title;

  if (message) {
    const messageEl = document.createElement("div");
    messageEl.textContent = message;
    messageEl.setAttribute("slot", "message");
    alert.append(messageEl);
  }

  if (kind === "danger") {
    document
      .querySelectorAll(
        'calcite-alert[kind="success"], calcite-alert[kind="brand"], calcite-alert[kind="info"]',
      )
      .forEach((existing) => {
        existing.remove();
      });
  }

  const mount = mountEl ?? getElement<HTMLCalcitePanelElement>("calcite-panel");
  mount.append(alert);
}

function splitWhitelistedPaths(value: FormDataEntryValue | null): string[] {
  const paths = value?.toString() ?? "";
  return paths
    .split(/\n|,/)
    .map(options.normalizePath)
    .filter((path) => path.length > 0);
}

function addDialog(): Promise<DialogResult> {
  const dialog = getElement<HTMLCalciteDialogElement>("#edit-dialog");
  const input = getElement<HTMLCalciteInputElement>(
    "#edit-domain-input",
    dialog,
  );
  const formEl = getElement<HTMLFormElement>("#add-domain-form", dialog);
  const cancelButton = getElement<HTMLCalciteButtonElement>(
    "#edit-cancel",
    dialog,
  );

  input.value = "";

  return new Promise((resolve) => {
    let result: DialogResult = { action: "cancel" };

    const cleanup = () => {
      formEl.removeEventListener("submit", handleSave);
      cancelButton.removeEventListener("click", handleCancel);
      dialog.removeEventListener("calciteDialogClose", handleClose);
      dialog
        .querySelectorAll("calcite-alert")
        .forEach((alert) => alert.remove());
    };

    const handleSave = async (e: SubmitEvent) => {
      e.preventDefault();
      const { url, error } = await options.validateUrl(input.value);

      if (error) {
        input.setFocus();
        input.selectText();
        emitAlert({
          title:
            error === "empty"
              ? "Please enter a domain"
              : "This domain is already limited, please enter a different domain.",
          kind: "warning",
          mountEl: dialog,
        });
        return;
      }

      result = {
        action: "save",
        value: url,
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

    formEl.addEventListener("submit", handleSave);
    cancelButton.addEventListener("click", handleCancel);
    dialog.addEventListener("calciteDialogClose", handleClose, {
      once: true,
    });

    dialog.open = true;
    requestAnimationFrame(() => {
      input.setFocus();
    });
  });
}

function renderDomain({
  domain,
  expanded = false,
}: {
  domain: DomainData;
  expanded?: boolean;
}): void {
  const domainGroup = getElement<HTMLCalciteBlockGroupElement>("#domains");
  const template = getElement<HTMLTemplateElement>("#domain-template");
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const block = getElement<HTMLCalciteBlockElement>("calcite-block", fragment);
  const form = getElement<HTMLFormElement>("form", block);
  const saveButton = getElement<HTMLCalciteActionElement>(
    "[data-action='save-changes']",
    block,
  );
  const { unitInput, limitInput, whitelistInput } = getDomainFields(block);
  const rulesContainer = getElement<HTMLElement>(".downtime-rules", block);
  let downtimeRules = domain.downtimeRules.map((rule) => ({
    ...rule,
    weekdays: [...rule.weekdays],
  }));

  const enableSave = () => {
    saveButton.disabled = false;
  };

  const renderRules = () => {
    rulesContainer.textContent = "";
    downtimeRules.forEach((rule) => {
      const template = getElement<HTMLTemplateElement>("#downtime-template");
      const row = template.content.firstElementChild!.cloneNode(
        true,
      ) as HTMLElement;
      const chips =
        row.querySelectorAll<HTMLCalciteChipElement>("calcite-chip");
      chips.forEach((chip) => {
        chip.toggleAttribute(
          "selected",
          rule.weekdays.includes(Number(chip.getAttribute("value"))),
        );
      });
      const start = getElement<HTMLCalciteInputTimePickerElement>(
        "[data-time='start']",
        row,
      );
      const end = getElement<HTMLCalciteInputTimePickerElement>(
        "[data-time='end']",
        row,
      );
      const allDay = getElement<HTMLCalciteSwitchElement>(
        "[data-switch='all-day']",
        row,
      );
      const allow = getElement<HTMLCalciteSwitchElement>(
        "[data-switch='allow-whitelist']",
        row,
      );
      start.value = minutesToTime(rule.startMinutes);
      end.value = minutesToTime(rule.endMinutes);
      allDay.checked = rule.allDay;
      allow.checked = rule.allowWhitelistedPaths;
      start.disabled = end.disabled = rule.allDay;
      getElement<HTMLCalciteChipGroupElement>(
        "calcite-chip-group",
        row,
      ).addEventListener("calciteChipGroupSelect", () => {
        rule.weekdays = Array.from(chips)
          .filter((chip) => chip.selected)
          .map((chip) => Number(chip.getAttribute("value")));
        enableSave();
      });
      start.addEventListener("calciteInputTimePickerChange", () => {
        rule.startMinutes = timeToMinutes(start.value);
        enableSave();
      });
      end.addEventListener("calciteInputTimePickerChange", () => {
        rule.endMinutes = timeToMinutes(end.value);
        enableSave();
      });
      allDay.addEventListener("calciteSwitchChange", () => {
        rule.allDay = allDay.checked;
        start.disabled = end.disabled = rule.allDay;
        enableSave();
      });
      allow.addEventListener("calciteSwitchChange", () => {
        rule.allowWhitelistedPaths = allow.checked;
        enableSave();
      });
      getElement<HTMLCalciteActionElement>(
        "[data-action='delete-downtime']",
        row,
      ).addEventListener("click", () => {
        downtimeRules = downtimeRules.filter((item) => item.id !== rule.id);
        renderRules();
        enableSave();
      });
      rulesContainer.append(row);
    });
  };

  // Setup values
  const limitSeconds = Math.max(
    1,
    Math.round((domain.limitMs ?? 5 * 60_000) / 1000),
  );
  const useMinutes = limitSeconds % 60 === 0;

  block.heading = domain.url ?? "";
  block.expanded = expanded;
  unitInput.value = useMinutes ? "minutes" : "seconds";
  limitInput.value = String(useMinutes ? limitSeconds / 60 : limitSeconds);
  whitelistInput.value = domain.whitelistedPaths.join("\n") ?? "";
  renderRules();
  getElement<HTMLCalciteActionElement>(
    "[data-action='add-downtime']",
    block,
  ).addEventListener("click", () => {
    downtimeRules.push({
      id: crypto.randomUUID(),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startMinutes: 21 * 60,
      endMinutes: 7 * 60,
      allDay: false,
      allowWhitelistedPaths: true,
    });
    renderRules();
    enableSave();
  });

  getElement<HTMLCalciteActionElement>(
    "[data-action='delete-domain']",
    block,
  ).addEventListener("click", async () => {
    block.remove();
    await options.removeDomain(domain);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    saveDomainChanges(formData, domain, downtimeRules)
      .then((saved) => {
        if (!saved) return;
        saveButton.disabled = true;
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unable to save changes.";
        emitAlert({
          title: "Sorry, something went wrong",
          message,
          kind: "danger",
        });
      });
  });

  block.addEventListener("calciteInputInput", enableSave);
  block.addEventListener("calciteSelectChange", enableSave);
  block.addEventListener("calciteTextAreaInput", enableSave);

  domainGroup.append(block);
}

async function saveDomainChanges(
  formData: FormData,
  domain: DomainData,
  downtimeRules: DowntimeRule[],
): Promise<boolean> {
  const multiplier = formData.get("unit") === "seconds" ? 1000 : 60_000;
  const limitMs = Math.floor(Number(formData.get("limit")) * multiplier);

  if (limitMs <= 0) {
    emitAlert({
      title: "Please enter a time limit greater than zero.",
      kind: "warning",
    });
    return false;
  }
  if (downtimeRules.some((rule) => !isValidDowntimeRule(rule))) {
    emitAlert({
      title:
        "Each downtime rule needs at least one day and valid, different start and end times.",
      kind: "warning",
    });
    return false;
  }

  const updatedDomain: DomainData = {
    ...domain,
    limitMs,
    whitelistedPaths: splitWhitelistedPaths(formData.get("whitelist")),
    downtimeRules,
  };

  const { error } = await options.updateDomain(updatedDomain);

  if (error) {
    emitAlert({
      title: "Unable to save changes",
      message: error,
      kind: "danger",
    });
    return false;
  }

  emitAlert({
    title: "Changes saved",
    message: "Open tabs have been updated.",
    kind: "success",
  });
  return true;
}

async function createDomainEntry(): Promise<void> {
  const result = await addDialog();
  if (result.action === "cancel") {
    return;
  }

  const domain = {
    id: crypto.randomUUID(),
    url: result.value,
    limitMs: 5 * 60_000,
    whitelistedPaths: [],
    downtimeRules: [],
  };

  const { error } = await options.addDomain(domain);

  if (error) {
    emitAlert({
      title: "Unable to add domain",
      message: error,
      kind: "danger",
    });
    return;
  }

  renderDomain({
    domain,
    expanded: true,
  });
}

async function renderUi(): Promise<void> {
  const domainsElement = getElement<HTMLCalciteBlockGroupElement>("#domains");
  domainsElement.textContent = "";

  const domains = await options.getDomains();
  domains.forEach((domain) => {
    renderDomain({ domain });
  });
}

function setupOptionsUi(): void {
  getElement<HTMLCalciteActionElement>("#add-domain").addEventListener(
    "click",
    createDomainEntry,
  );

  renderUi().catch((error: unknown) => {
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
