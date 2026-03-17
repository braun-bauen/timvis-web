const TICK_INTERVAL_MS = 1000;
const DEBUG_FORCE_OVERLAY = false;
const DEBUG_FORCE_WARNING = false;
const WHITELIST_PATH_PREFIXES = ["/messages"];
let lastTick = Date.now();
let ticking = false;
let warningShown = false;
let blocked = false;
let limitReached = false;
let lastUrl = window.location.href;

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isWhitelistedPath(pathname = window.location.pathname) {
  return WHITELIST_PATH_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  ));
}

function createOverlay(message, subMessage, isWarning) {
  const overlay = document.createElement("dialog");
  overlay.id = "tt-overlay";
  overlay.setAttribute("role", isWarning ? "status" : "alertdialog");
  overlay.setAttribute("aria-live", isWarning ? "polite" : "assertive");
  overlay.style.minWidth = "100vw";
  overlay.style.minHeight = "100vh";
  overlay.style.background = "linear-gradient(145deg, rgba(24,24,24,1), rgba(9,9,9,1))";
  overlay.style.alignContent = "center";
  overlay.style.textAlign = "center";

  const title = document.createElement("h1");
  title.textContent = message;
  title.style.fontSize = "24px";
  title.style.letterSpacing = "0.2px";

  const detail = document.createElement("p");
  detail.textContent = subMessage;
  detail.style.color = "rgba(245, 245, 245, 0.75)";

  if (isWarning) {
    overlay.style.minWidth = "auto";
    overlay.style.minHeight = "auto";
    overlay.style.background = "rgba(10, 10, 10, 0.35)";
    overlay.style.padding = "24px";
    overlay.style.borderRadius = "12px";
    title.style.color = "#ffcc4d";
  }

  overlay.appendChild(title);
  overlay.appendChild(detail);

  if (isWarning) {
    overlay.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismissDialog(overlay);
    });

    overlay.addEventListener("click", (event) => {
      if (event.target !== overlay) {
        return;
      }
      const rect = overlay.getBoundingClientRect();
      const clickedInside = (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
      if (!clickedInside) {
        dismissDialog(overlay);
      }
    });
  } else {
    overlay.addEventListener("cancel", (event) => {
      event.preventDefault();
    });
  }
  return overlay;
}

function openDialog(dialog, isWarning) {
  document.documentElement.appendChild(dialog);
  if (!isWarning) {
    lockScroll();
  }
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch (error) {
      void error;
    }
  }
  if (typeof dialog.show === "function") {
    try {
      dialog.show();
      return;
    } catch (error) {
      void error;
    }
  }
  dialog.setAttribute("open", "");
}

function dismissDialog(dialog) {
  if (!dialog) {
    return;
  }
  unlockScroll();
  if (typeof dialog.close === "function") {
    try {
      dialog.close();
    } catch (error) {
      void error;
    }
  }
  dialog.remove();
}

function lockScroll() {
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
}

function unlockScroll() {
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.documentElement.style.height = "";
  document.body.style.height = "";
}

function showWarning(remainingMs) {
  if (warningShown) {
    return;
  }
  warningShown = true;
  const existing = document.getElementById("tt-warning");
  if (existing) {
    return;
  }

  const overlay = createOverlay(
    "One minute left",
    `Twitter will be blocked in ${formatTime(remainingMs)}. Wrap up what you are doing.`,
    true
  );
  overlay.id = "tt-warning";
  openDialog(overlay, true);

  setTimeout(() => {
    dismissDialog(overlay);
  }, 5500);
}

function showBlock() {
  if (isWhitelistedPath()) {
    return;
  }
  if (blocked) {
    return;
  }
  blocked = true;
  const existing = document.getElementById("tt-overlay");
  if (existing) {
    dismissDialog(existing);
  }
  const overlay = createOverlay(
    "Time is up",
    "Twitter is blocked for the rest of this hour. Come back later.",
    false
  );
  overlay.id = "tt-overlay";
  openDialog(overlay, false);
}

function removeBlock() {
  blocked = false;
  warningShown = false;
  const overlay = document.getElementById("tt-overlay");
  if (overlay) {
    dismissDialog(overlay);
  }
}

function applyBlockState() {
  if (DEBUG_FORCE_OVERLAY) {
    showBlock();
    return;
  }
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

    if (!document.hasFocus() || DEBUG_FORCE_OVERLAY) {
      return;
    }

    chrome.runtime.sendMessage({ type: "tick", elapsedMs: elapsed }, () => {
      void chrome.runtime.lastError;
    });
  }, TICK_INTERVAL_MS);
}

function refreshStatus() {
  if (DEBUG_FORCE_WARNING) {
    showWarning(60 * 1000);
    return;
  }
  chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
    if (!status) {
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
  if (message.type === "warn") {
    showWarning(message.remainingMs ?? 0);
  }
  if (message.type === "block") {
    limitReached = true;
    applyBlockState();
  }
});

startTicking();
refreshStatus();

if (DEBUG_FORCE_OVERLAY) {
  limitReached = true;
  applyBlockState();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshStatus();
  }
});
