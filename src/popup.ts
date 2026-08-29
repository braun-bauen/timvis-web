import "./popup.css";
import type { Action, RuntimeMessage, StatusMessage } from "./types";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element`);
  }
  return element as T;
}

function setupDebugButtons(): void {
  document.querySelectorAll("button[data-action]").forEach((button) => {
    const action = button.getAttribute("data-action") as Action | null;
    if (!action) {
      return;
    }

    button.addEventListener("click", () => {
      triggerDebugAction(action);
    });
  });
}

function updateStatus(status: StatusMessage | undefined): void {
  const statusEl = requireElement<HTMLElement>("status");
  const actionsEl = requireElement<HTMLElement>("actions");

  if (!status) {
    statusEl.textContent = "Status unavailable.";
    actionsEl.hidden = true;
    return;
  }

  statusEl.classList.remove("debug", "block");
  statusEl.textContent = "Active";
  actionsEl.hidden = !status.debug;

  if (status.debug) {
    statusEl.textContent = "Debug mode enabled";
    statusEl.classList.add("debug");
    return;
  }

  if (status.blocked) {
    statusEl.textContent = status.downtime ? "In downtime." : "Blocked for this hour";
    statusEl.classList.add("block");
    return;
  }
}

function refreshStatus(): void {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.runtime.sendMessage(
      { type: "getStatus", url: tab?.url },
      (status: StatusMessage) => {
        updateStatus(status);
      },
    );
  });
}

function triggerDebugAction(action: Action): void {
  const message: RuntimeMessage = { type: "debug", action };

  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

setupDebugButtons();
refreshStatus();
