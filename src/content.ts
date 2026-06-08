const DEV_MODE = false;
const TICK_INTERVAL_MS = 1000;
const WHITELIST_PATH_PREFIXES = ["/messages"];
let lastTick = Date.now();
let ticking = false;
let warningShown = false;
let blocked = false;
let limitReached = false;
let lastUrl = window.location.href;

function isWhitelistedPath(pathname = window.location.pathname) {
  return WHITELIST_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * @param {{ type: "warning" | "block", message: string }} options
 * @returns {HTMLDialogElement}
 */
function createDialog({ type, message }) {
  const dialog = document.createElement("dialog");
  dialog.id = "tt-dialog";
  dialog.setAttribute("data-type", type);

  const title = document.createElement("p");
  title.textContent = message;
  dialog.appendChild(title);

  document.documentElement.appendChild(dialog);

  if (type === "warning") {
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

/**
 * @param {HTMLDialogElement} dialog
 */
function dismissDialog(dialog) {
  if (!dialog) {
    return;
  }
  dialog.close();
  dialog.remove();
}

function showWarning() {
  if (!DEV_MODE && warningShown) {
    return;
  }
  warningShown = true;
  const existing = document.querySelector("#tt-dialog");
  if (existing) {
    return;
  }

  const dialog = createDialog({
    type: "warning",
    message: "One minute left until Twitter is blocked.",
  });
  dialog.showModal();
}

function showBlock() {
  if (isWhitelistedPath()) {
    return;
  }
  if (blocked) {
    return;
  }
  blocked = true;
  const existing = document.querySelector("#tt-dialog");
  if (existing) {
    dismissDialog(existing);
  }
  const dialog = createDialog({
    type: "block",
    message: "Twitter is blocked for the rest of this hour.",
  });
  dialog.showModal();
}

function removeBlock() {
  blocked = false;
  warningShown = false;
  const dialog = document.querySelector("#tt-dialog");
  if (dialog) {
    dismissDialog(dialog);
  }
}

function applyBlockState() {
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

function startTicking() {
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
      applyBlockState();
      refreshStatus();
    }

    if (DEV_MODE || !document.hasFocus()) {
      return;
    }

    chrome.runtime.sendMessage({ type: "tick", elapsedMs: elapsed }, () => {
      void chrome.runtime.lastError;
    });
  }, TICK_INTERVAL_MS);
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
    if (!status) {
      return;
    }
    if (status.devMode) {
      limitReached = false;
      removeBlock();
      return;
    }
    if (status.showWarning) {
      showWarning(status.limitMs - status.usedMs);
    }

    limitReached = Boolean(status.blocked);
    applyBlockState();
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return;
  }
  if (message.type === "warn" || message.type === "debugWarning") {
    showWarning(message.remainingMs ?? 0);
  }
  if (message.type === "block" || message.type === "debugBlock") {
    limitReached = true;
    applyBlockState();
  }
});

startTicking();
refreshStatus();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshStatus();
  }
});
