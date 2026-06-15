import type { Action, DialogOptions, StatusMessage } from "./types";

const TICK_INTERVAL_MS = 1000;
const WHITELIST_PATH_PREFIXES = ["/messages"];

let lastTick = Date.now();
let ticking = false;
let warningShown = false;
let blocked = false;
let limitReached = false;
let lastUrl = window.location.href;

function isWhitelistedPath(pathname = window.location.pathname): boolean {
  return WHITELIST_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function createDialog({ type, message }: DialogOptions): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.id = "tt-dialog";
  dialog.setAttribute("data-type", type);

  const title = document.createElement("p");
  title.textContent = message;
  dialog.appendChild(title);

  document.documentElement.appendChild(dialog);

  if (type === "warn") {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) {
        return;
      }
      const rect = dialog.getBoundingClientRect();
      const clickedOutside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (clickedOutside) {
        dismissDialog(dialog);
      }
    });
  } else {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
    });
  }
  return dialog;
}

function dismissDialog(dialog: HTMLDialogElement): void {
  dialog.close();
  dialog.remove();
}

function setWarningOpen(open: boolean): void {
  const existing = document.querySelector(
    "#tt-dialog[data-type='warn']",
  ) as HTMLDialogElement | null;

  if (!open) {
    if (existing) {
      dismissDialog(existing);
    }
    return;
  }

  if (existing || warningShown) {
    return;
  }

  const dialog = createDialog({
    type: "warn",
    message: "One minute left until Twitter is blocked.",
  });
  dialog.showModal();
  warningShown = true;
}

function showBlock(): void {
  if (isWhitelistedPath() || blocked) {
    return;
  }

  const existing = document.querySelector("#tt-dialog");
  if (existing) {
    dismissDialog(existing as HTMLDialogElement);
  }

  const dialog = createDialog({
    type: "block",
    message: "Twitter is blocked for the rest of this hour.",
  });

  dialog.showModal();
  blocked = true;
}

function removeBlock(): void {
  blocked = false;
  const dialog = document.querySelector("#tt-dialog[data-type='block']");
  if (dialog) {
    dismissDialog(dialog as HTMLDialogElement);
  }
}

function handleBlock(): void {
  if (!limitReached) {
    removeBlock();
    return;
  }

  if (isWhitelistedPath()) {
    removeBlock();
    return;
  }

  showBlock();
}

function startTicking(): void {
  if (ticking) {
    return;
  }
  ticking = true;
  lastTick = Date.now();

  setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;

    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      handleBlock();
      refreshStatus();
    }

    if (!document.hasFocus()) {
      return;
    }

    chrome.runtime.sendMessage({ type: "tick", elapsedMs: elapsed }, () => {
      void chrome.runtime.lastError;
    });
  }, TICK_INTERVAL_MS);
}

function refreshStatus(): void {
  chrome.runtime.sendMessage(
    { type: "getStatus" },
    (status: StatusMessage | undefined) => {
      if (!status) {
        return;
      }
      if (status.debug) {
        limitReached = false;
        removeBlock();
        return;
      }
      if (status.showWarning) {
        setWarningOpen(true);
      }

      limitReached = status.blocked;
      handleBlock();
    },
  );
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== "string") {
    return;
  }

  const actionMessage = message as Action;

  if (actionMessage === "warn") {
    setWarningOpen(true);
  }
  if (actionMessage === "block") {
    limitReached = true;
    handleBlock();
  }
  if (actionMessage === "unblock") {
    warningShown = false;
    limitReached = false;
    setWarningOpen(false);
    removeBlock();
  }
});

startTicking();
refreshStatus();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshStatus();
  }
});

export { };
