import "./popup.css";
import { Action, RuntimeMessage, StatusMessage } from "./types";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element`);
  }
  return element as T;
}

function updateStatus(status: StatusMessage): void {
  const statusEl = requireElement<HTMLElement>("status");
  const actionsEl = requireElement<HTMLElement>("debug-actions");

  if (!status) {
    statusEl.textContent = "Status unavailable.";
    actionsEl.hidden = true;
    return;
  }

  statusEl.classList.remove("debug", "warn", "block");
  statusEl.textContent = "Active";
  actionsEl.hidden = !status.debug;

  if (status.debug) {
    statusEl.textContent = "Debug mode enabled";
    statusEl.classList.add("debug");
    return;
  }

  if (status.blocked) {
    statusEl.textContent = "Blocked for this hour";
    statusEl.classList.add("block");
    return;
  }
}

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: "getStatus" }, (status: StatusMessage) => {
    updateStatus(status);
  });
}

function triggerDebugAction(action: Action): void {
  const message: RuntimeMessage = { type: "debug", action };

  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

requireElement<HTMLButtonElement>("show-warning-button").addEventListener("click", () => {
  triggerDebugAction("warn");
});

requireElement<HTMLButtonElement>("show-block-button").addEventListener("click", () => {
  triggerDebugAction("block");
});

refreshStatus();
