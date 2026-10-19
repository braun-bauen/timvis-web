import "@esri/calcite-components/components/calcite-input-number";
import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-dropdown";
import "@esri/calcite-components/components/calcite-dropdown-group";
import "@esri/calcite-components/components/calcite-dropdown-item";
import "@esri/calcite-components/components/calcite-list";
import "@esri/calcite-components/components/calcite-list-item";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-checkbox";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-action";
import "@esri/calcite-components/components/calcite-input";
import "@esri/calcite-components/components/calcite-icon";
import "@esri/calcite-components/components/calcite-text-area";
import "@esri/calcite-components/components/calcite-notice";
import "@esri/calcite-components/components/calcite-alert";
import "@esri/calcite-components/components/calcite-button";
import "@esri/calcite-components/components/calcite-dialog";
import "@esri/calcite-components/components/calcite-input-time-picker";
import "@esri/calcite-components/components/calcite-inline-editable";
import "@esri/calcite-components/components/calcite-switch";

import "@esri/calcite-components/components/calcite-shell-panel";
import type { Action, DomainData, DowntimeSchedule, StatusMessage } from "./types";
import Options from "./options";
import { createDowntimeSchedule } from "./downtime";
import { isThemePreference, setThemePreference, setupTheme, type ThemePreference } from "./theme";
import "./popup.css";

const options = Options();
/** Select an element from the DOM */
const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const numberInput = (selector: string) => el<HTMLCalciteInputNumberElement>(selector);
const input = (selector: string) => el<HTMLCalciteInputElement>(selector);
let domains: DomainData[] = [];
let editing: DomainData | undefined;
let isNew = false;
let schedule: DowntimeSchedule;
let downtimeChanged = false;
let savedEditorValues = "";
let siteUrl: string | undefined;
let siteHostname = "";
let status: StatusMessage | undefined;
let saving = false;
let refreshing = false;
const domainStatuses = new Map<string, StatusMessage>();

type AlertOptions = {
  title: string;
  message?: string;
  kind?: HTMLCalciteAlertElement["kind"];
  mountEl?: HTMLCalciteDialogElement;
};

function emitAlert({ title, message, kind = "brand", mountEl }: AlertOptions): void {
  const template = el<HTMLTemplateElement>("#alert-template");
  const alert = template.content
    .querySelector("calcite-alert")!
    .cloneNode(true) as HTMLCalciteAlertElement;
  alert.kind = kind;
  alert.autoClose = kind !== "danger";
  alert.autoCloseDuration = "fast";
  alert.queue = mountEl || kind === "danger" ? "immediate" : "last";
  alert.querySelector('[slot="title"]')!.textContent = title;
  if (message) {
    const content = document.createElement("div");
    content.slot = "message";
    content.textContent = message;
    alert.append(content);
  }
  if (kind === "danger") {
    document
      .querySelectorAll(
        'calcite-alert[kind="success"], calcite-alert[kind="brand"], calcite-alert[kind="info"]',
      )
      .forEach((existing) => existing.remove());
  }
  alert.addEventListener("calciteAlertClose", () => {
    if (!alert.open) alert.remove();
  });
  (mountEl ?? el("calcite-shell")).append(alert);
  alert.open = true;
}

function hideDomainHeader(): void {
  const header = el<HTMLCalciteInlineEditableElement>("#new-domain");
  header.hidden = true;
  header.removeAttribute("slot");
  header.editingEnabled = false;
  input("#domain-name").disabled = true;
}

async function validateNewDomain(): Promise<string | undefined> {
  const draft = editing;
  const domainInput = input("#domain-name");
  const value = domainInput.value;
  const { url, error } = await options.validateUrl(value);
  if (editing !== draft || !isNew) return;
  if (error) {
    emitAlert({
      title:
        error === "duplicate"
          ? "This domain is already limited, please enter a different domain."
          : value.trim()
            ? "Please enter a valid domain"
            : "Please enter a domain",
      kind: "warning",
    });
    el<HTMLCalciteInlineEditableElement>("#new-domain").editingEnabled = true;
    domainInput.status = "invalid";
    await domainInput.setFocus();
    await domainInput.selectText();
    return;
  }
  domainInput.status = "idle";
  domainInput.value = url;
  if (editing) editing.url = url;
  return url;
}

function updateDirectorySelection(): void {
  el("#directory")
    .querySelectorAll<HTMLCalciteListItemElement>("calcite-list-item")
    .forEach((item) => {
      item.selected = item.value === editing?.id;
    });
}

function createDirectory(): void {
  el("#directory")
    .querySelectorAll("calcite-list-item")
    .forEach((item) => item.remove());
  for (const domain of domains) {
    const item = document.createElement("calcite-list-item");
    item.label = domain.url;
    item.value = domain.id;
    item.selected = editing?.id === domain.id;
    item.addEventListener("calciteListItemSelect", () => {
      if (item.selected) openEditor(domain);
    });
    el("#directory").append(item);
  }
  updateDirectorySelection();
}

function updateThemeSelection(preference: ThemePreference): void {
  document.querySelectorAll<HTMLCalciteDropdownItemElement>("[data-theme]").forEach((action) => {
    action.selected = action.dataset.theme === preference;
  });
}

async function loadDomains(): Promise<void> {
  domains = await options.getDomains();
  createDirectory();
}

function showSuggestion(): void {
  el("#summary").hidden = false;
  el("#domain-settings").hidden = el("#save").hidden = el("#cancel").hidden = true;
  el("#delete-domain").hidden = true;
  hideDomainHeader();
  el<HTMLCalcitePanelElement>("#main").heading = siteHostname || "Timvis";
  updateDirectorySelection();
  el("#setup-site").hidden = !siteHostname || !status || Boolean(status.domainConfigId);
  el("#summary-title").textContent = !siteHostname
    ? "Tracking unavailable"
    : !status
      ? "Status unavailable"
      : "This site isn't tracked";
}

function cancel(): void {
  if (saving) return;
  const saved = domains.find((domain) => domain.id === editing?.id);
  if (saved) {
    openEditor(saved);
    return;
  }
  editing = undefined;
  void refreshStatus(true);
}

function usageText(value: StatusMessage): string {
  return `${Math.floor((value.usedMs ?? 0) / 60_000)} of ${Math.floor((value.allowanceMs ?? 0) / 60_000)} minutes used`;
}

function renderUsage(): void {
  el("#directory")
    .querySelectorAll<HTMLCalciteListItemElement>("calcite-list-item")
    .forEach((item) => {
      const value = domainStatuses.get(item.value);
      item.description = value?.domainConfigId ? usageText(value) : "";
    });

  if (!editing || isNew) return;

  const value = domainStatuses.get(editing.id);

  el("#debug-actions").hidden = !value?.debug;
  if (!value?.domainConfigId) {
    return;
  }

  el<HTMLCalciteNoticeElement>("#summary calcite-notice").kind = value.blocked
    ? "danger"
    : "success";
  const resetText = value.resetAt
    ? `. Resets ${new Date(value.resetAt).toLocaleTimeString([], { hour: "numeric", hour12: true })}.`
    : "";
  el("#summary-title").textContent = value.downtime
    ? `Blocked by a schedule${resetText}`
    : `${usageText(value)}${resetText}`;
}

async function refreshStatus(selectCurrent = false): Promise<void> {
  if (refreshing && !selectCurrent) return;
  refreshing = true;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    siteUrl = tab?.url;
    siteHostname = "";
    if (siteUrl) {
      const url = new URL(siteUrl);
      if (["http:", "https:"].includes(url.protocol)) siteHostname = url.hostname;
    }
    status = await chrome.runtime.sendMessage({
      type: "getPopupStatus",
      url: siteUrl,
    });
    const values = await Promise.all(
      domains.map(async (domain) => {
        const value: StatusMessage | undefined =
          domain.id === status?.domainConfigId
            ? status
            : await chrome.runtime.sendMessage({
                type: "getPopupStatus",
                domainConfigId: domain.id,
              });
        return { id: domain.id, value };
      }),
    );
    domainStatuses.clear();
    values.forEach(({ id, value }) => {
      if (value) domainStatuses.set(id, value);
    });
    if (selectCurrent && !editing) {
      const current = domains.find((domain) => domain.id === status?.domainConfigId);
      if (current) openEditor(current);
    }
    if (!editing) showSuggestion();
    renderUsage();
  } catch {
    status = undefined;
    if (!editing) showSuggestion();
  } finally {
    refreshing = false;
  }
}

function openEditor(domain?: DomainData, hostname = ""): void {
  if (saving) return;
  isNew = !domain;
  editing = structuredClone(
    domain ?? {
      id: crypto.randomUUID(),
      url: hostname,
      limitMs: 5 * 60_000,
      whitelistedPaths: [],
      downtimeRules: [],
    },
  );
  const legacySchedule = createDowntimeSchedule(editing.downtimeRules);
  schedule = structuredClone(editing.downtimeSchedule ?? legacySchedule.schedule);
  downtimeChanged = false;
  el("#editor").hidden = el("#save").hidden = el("#cancel").hidden = false;

  el("#domain-settings").hidden = false;
  el("#summary").hidden = isNew;
  const cancelAction = el<HTMLCalciteActionElement>("#cancel");
  cancelAction.text = isNew ? "Cancel" : "Cancel changes";
  cancelAction.icon = isNew ? "x" : "reset";
  cancelAction.textEnabled = isNew;
  const header = el<HTMLCalciteInlineEditableElement>("#new-domain");
  const domainInput = input("#domain-name");
  domainInput.value = editing.url;
  domainInput.status = "idle";
  domainInput.disabled = !isNew;
  header.hidden = !isNew;
  if (isNew) {
    el<HTMLCalcitePanelElement>("#main").heading = "Set up domain";
    header.slot = "heading";
    header.editingEnabled = !hostname;
    if (!hostname) void domainInput.setFocus();
  } else {
    hideDomainHeader();
    el<HTMLCalcitePanelElement>("#main").heading = editing.url;
  }

  numberInput("#limit").value = String(editing.limitMs / 60_000);
  numberInput("#reset-hours").value = String(editing.resetHours ?? 1);
  updateAllowanceLabels();
  el<HTMLCalciteTextAreaElement>("#paths").value = editing.whitelistedPaths.join("\n");
  el("#delete-domain").hidden = isNew;
  renderDowntime();
  savedEditorValues = editorValues();
  updateUnsavedIndicator();
  if (!editing.downtimeSchedule && legacySchedule.hasConflicts)
    emitAlert({
      title: "Downtime needs review",
      message:
        "This site's existing schedules have multiple periods per day or different allowed-path settings. They are preserved until you edit downtime. Saving a downtime change replaces them with the single weekly schedule shown here.",
      kind: "warning",
    });
  updateDirectorySelection();
  renderUsage();
}

function editorValues(): string {
  return JSON.stringify({
    domain: input("#domain-name").value,
    minutes: numberInput("#limit").value,
    hours: numberInput("#reset-hours").value,
    paths: el<HTMLCalciteTextAreaElement>("#paths").value,
    schedule,
  });
}

function updateUnsavedIndicator(): void {
  el<HTMLCalciteActionElement>("#cancel").indicator =
    !!editing && !isNew && editorValues() !== savedEditorValues;
}

function renderDowntime(): void {
  el<HTMLCalciteSwitchElement>("#downtime-enabled").checked = schedule.enabled;
  el("#downtime-settings").hidden = !schedule.enabled;
  el<HTMLCalciteSwitchElement>("#downtime-block-paths").checked = !schedule.allowWhitelistedPaths;
  el("#downtime-days").replaceChildren();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const parse = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const day = schedule.days.find((item) => item.weekday === weekday)!;
    const row = el<HTMLTemplateElement>(
      "#downtime-day-template",
    ).content.firstElementChild!.cloneNode(true) as HTMLElement;
    const checkbox = row.querySelector<HTMLCalciteCheckboxElement>("calcite-checkbox")!;
    row.querySelector("[data-day-name]")!.textContent = names[weekday];
    const start = row.querySelector<HTMLCalciteInputTimePickerElement>("[data-time=start]")!;
    const end = row.querySelector<HTMLCalciteInputTimePickerElement>("[data-time=end]")!;
    start.label = `${names[weekday]} From`;
    end.label = `${names[weekday]} To`;
    checkbox.checked = day.enabled;
    start.value = time(day.startMinutes);
    end.value = time(day.endMinutes);
    start.disabled = end.disabled = !day.enabled;
    checkbox.addEventListener("calciteCheckboxChange", () => {
      day.enabled = checkbox.checked;
      start.disabled = end.disabled = !day.enabled;
      downtimeChanged = true;
    });
    start.addEventListener("calciteInputTimePickerChange", () => {
      day.startMinutes = parse(start.value);
      downtimeChanged = true;
    });
    end.addEventListener("calciteInputTimePickerChange", () => {
      day.endMinutes = parse(end.value);
      downtimeChanged = true;
    });
    el("#downtime-days").append(row);
  }
}

async function save(): Promise<void> {
  if (!editing || saving) return;
  saving = true;
  el<HTMLCalciteActionElement>("#save").loading = true;
  try {
    const url = isNew ? await validateNewDomain() : editing.url;
    if (!url) return;
    const domain: DomainData = {
      ...editing,
      url,
      limitMs: Math.floor(Number(numberInput("#limit").value) * 60_000),
      resetHours: Number(numberInput("#reset-hours").value),
      whitelistedPaths: el<HTMLCalciteTextAreaElement>("#paths")
        .value.split(/\n|,/)
        .map(options.normalizePath)
        .filter(Boolean),
      downtimeRules: downtimeChanged ? [] : editing.downtimeRules,
      ...(downtimeChanged ? { downtimeSchedule: structuredClone(schedule) } : {}),
    };
    const result = await (isNew ? options.addDomain(domain) : options.updateDomain(domain));
    if (result.error) {
      emitAlert({
        title: "Unable to save changes",
        message: result.error,
        kind: "warning",
      });
      return;
    }
    await loadDomains();
    saving = false;
    const saved = domains.find((item) => item.id === domain.id);
    if (saved) openEditor(saved);
    await refreshStatus();
    emitAlert({
      title: "Changes saved",
      message: "Open tabs have been updated.",
      kind: "success",
    });
  } catch (error) {
    emitAlert({
      title: "Unable to save changes",
      message: error instanceof Error ? error.message : "Unable to save settings.",
      kind: "danger",
    });
  } finally {
    saving = false;
    el<HTMLCalciteActionElement>("#save").loading = false;
  }
}

const domainHeader = el<HTMLCalciteInlineEditableElement>("#new-domain");
domainHeader.messageOverrides = {
  confirmChanges: "Confirm domain",
  cancelEditing: "Cancel domain edit",
};
domainHeader.afterConfirm = async () => {
  const url = await validateNewDomain();
  if (!url) throw new Error("Domain validation failed");
};
domainHeader.addEventListener("calciteInlineEditableEditCancel", () => {
  if (isNew && editing) {
    input("#domain-name").value = editing.url;
    input("#domain-name").status = "idle";
    updateUnsavedIndicator();
  }
});
input("#domain-name").addEventListener("calciteInputInput", () => {
  input("#domain-name").status = "idle";
});

el<HTMLCalciteListElement>("#directory").filterProps = ["label"];
el("#setup-site").addEventListener("click", () => openEditor(undefined, siteHostname));
el("#add-domain").addEventListener("click", () => openEditor());
el("#cancel").addEventListener("click", cancel);
el("#save").addEventListener("click", () => void save());
el("#editor").addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});
el<HTMLCalciteSwitchElement>("#downtime-enabled").addEventListener("calciteSwitchChange", () => {
  schedule.enabled = el<HTMLCalciteSwitchElement>("#downtime-enabled").checked;
  el("#downtime-settings").hidden = !schedule.enabled;
  downtimeChanged = true;
});
el<HTMLCalciteSwitchElement>("#downtime-block-paths").addEventListener(
  "calciteSwitchChange",
  () => {
    schedule.allowWhitelistedPaths = !el<HTMLCalciteSwitchElement>("#downtime-block-paths").checked;
    downtimeChanged = true;
  },
);
el("#delete-domain").addEventListener("click", () => {
  if (!editing) return;
  const deleteDialog = el<HTMLCalciteDialogElement>("#delete-dialog");
  deleteDialog.heading = `Delete ${editing.url}?`;
  deleteDialog.open = true;
});
el("#delete-cancel").addEventListener("click", () => {
  el<HTMLCalciteDialogElement>("#delete-dialog").open = false;
});
el("#delete-confirm").addEventListener("click", async () => {
  if (!editing || saving) return;
  saving = true;
  el<HTMLCalciteButtonElement>("#delete-confirm").loading = true;
  try {
    await options.removeDomain(editing);
    el<HTMLCalciteDialogElement>("#delete-dialog").open = false;
    await loadDomains();
    saving = false;
    editing = undefined;
    await refreshStatus(true);
  } catch {
    emitAlert({
      title: "Unable to delete domain",
      kind: "danger",
      mountEl: el<HTMLCalciteDialogElement>("#delete-dialog"),
    });
  } finally {
    saving = false;
    el<HTMLCalciteButtonElement>("#delete-confirm").loading = false;
  }
});
document.querySelectorAll<HTMLCalciteDropdownItemElement>("[data-theme]").forEach((action) => {
  action.addEventListener("calciteDropdownItemSelect", () => {
    const preference = action.dataset.theme;
    if (!isThemePreference(preference)) return;
    updateThemeSelection(preference);
    void setThemePreference(preference);
  });
});
document.querySelectorAll<HTMLElement>("#debug-actions [data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    void chrome.runtime.sendMessage({
      type: "debug",
      action: button.dataset.action as Action,
    });
  });
});
el<HTMLCalciteDropdownElement>("#settings-menu").referenceElement = el("#settings-menu-trigger");
void setupTheme(updateThemeSelection);
async function initialize(): Promise<void> {
  await loadDomains();
  await refreshStatus(true);
  window.setInterval(() => {
    void refreshStatus();
  }, 1000);
}
void initialize().catch(() => emitAlert({ title: "Unable to load domains", kind: "danger" }));

function updateAllowanceLabels(): void {
  el("#minutes-label").textContent =
    Number(numberInput("#limit").value) === 1 ? "minute" : "minutes";
  el("#hours-label").textContent =
    Number(numberInput("#reset-hours").value) === 1 ? "hour" : "hours";
}
for (const selector of ["#limit", "#reset-hours"]) {
  numberInput(selector).addEventListener("calciteInputNumberInput", updateAllowanceLabels);
}

for (const eventName of [
  "calciteInputInput",
  "calciteInputNumberInput",
  "calciteTextAreaInput",
  "calciteSwitchChange",
  "calciteCheckboxChange",
  "calciteInputTimePickerChange",
]) {
  el("#editor").addEventListener(eventName, updateUnsavedIndicator);
}
