import type { Action, DialogOptions, StatusMessage } from "./types";

const TICK_INTERVAL_MS = 1000;
const SVG_NS = "http://www.w3.org/2000/svg";
const LIMIT_TICKS = 60;
const DAY_TICKS = 96;
const DAY_MINUTES = 24 * 60;
const MOON_PATH = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z";
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M3.97998 11.3032L7.28098 8.00023L3.97998 4.69723L4.68698 3.99023L7.98998 7.29323L7.99998 7.28323L8.00998 7.29323L11.314 3.99023L12.021 4.69723L8.71798 8.00023L12.021 11.3032L11.314 12.0102L8.00998 8.70723L7.99998 8.71723L7.98998 8.70723L4.68598 12.0102L3.97998 11.3032Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentcolor"/></svg> `;

let lastTick = Date.now();
let ticking = false;
let warningShown = false;
let blocked = false;
let limitReached = false;
let inDowntime = false;
let whitelisted = false;
let blockedDomain = "this site";
let domainConfigId: string | undefined;
let resetAt: number | undefined;
let lastUrl = window.location.href;
let lastStatusMinute = "";
let status: StatusMessage | undefined;
let blockRenderedMinute = "";

function getMinuteKey(date = new Date()): string {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ].join(":");
}

function createDialog({ type, message }: DialogOptions): HTMLDivElement | HTMLDialogElement {
  const dialog = document.createElement(type === "warn" ? "div" : "dialog");
  dialog.id = "tt-dialog";
  dialog.setAttribute("data-type", type);

  const title = document.createElement("p");
  title.id = "tt-dialog-title";
  title.textContent = message;
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.appendChild(title);

  document.documentElement.appendChild(dialog);

  if (type === "warn") {
    dialog.popover = "manual";
    dialog.setAttribute("role", "status");
    const closeButton = document.createElement("button");
    closeButton.innerHTML = CLOSE_ICON;
    closeButton.setAttribute("aria-label", "Dismiss Timvis warning");
    closeButton.addEventListener("click", () => dismissDialog(dialog));
    dialog.appendChild(closeButton);
  } else {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
    });
  }
  return dialog;
}

function dismissDialog(dialog: HTMLDivElement | HTMLDialogElement): void {
  if (dialog.popover) {
    dialog.hidePopover();
  } else if ("close" in dialog) {
    dialog.close();
  }
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
    message: `Hey there! One minute left 👀`,
  });
  dialog.showPopover();
  warningShown = true;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(tag: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

/** Point on the ring for a fraction of a full turn, starting at 12 o'clock. */
function ringPoint(fraction: number, radius: number): [number, number] {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return [84 + Math.cos(angle) * radius, 84 + Math.sin(angle) * radius];
}

function ringTick(fraction: number, inner: number, outer: number, className: string): SVGElement {
  const [x1, y1] = ringPoint(fraction, inner);
  const [x2, y2] = ringPoint(fraction, outer);
  return svgElement("line", { x1, y1, x2, y2, class: className });
}

function isInSegments(minute: number, segments: StatusMessage["downtimeSegments"] = []): boolean {
  return segments.some((segment) => minute >= segment.startMinutes && minute < segment.endMinutes);
}

function createRing(now: Date): HTMLDivElement {
  const ring = element("div", "tt-ring");
  ring.setAttribute("aria-hidden", "true");
  const svg = svgElement("svg", { viewBox: "-14 -14 196 196", class: "tt-ring-ticks" });
  const center = element("div", "tt-ring-center");

  if (inDowntime) {
    for (let index = 0; index < DAY_TICKS; index++) {
      const minute = (index * DAY_MINUTES) / DAY_TICKS;
      const active = isInSegments(minute, status?.downtimeSegments);
      svg.appendChild(
        ringTick(index / DAY_TICKS, 70, 80, active ? "tt-tick tt-tick-downtime" : "tt-tick"),
      );
    }
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    svg.appendChild(ringTick(nowMinutes / DAY_MINUTES, 64, 86, "tt-tick tt-tick-now"));
    for (const hour of [0, 6, 12, 18]) {
      const [x, y] = ringPoint(hour / 24, 92);
      const label = svgElement("text", { x, y, class: "tt-ring-hour" });
      label.textContent = String(hour).padStart(2, "0");
      svg.appendChild(label);
    }
    const icon = svgElement("svg", { viewBox: "3.5 3.5 17 17", class: "tt-ring-icon" });
    icon.appendChild(svgElement("path", { d: MOON_PATH }));
    center.append(icon, element("span", "tt-ring-label", "Downtime"));
  } else {
    const usedMs = status?.usedMs ?? status?.allowanceMs ?? 0;
    const windowMs = status?.windowMs ?? 60 * 60_000;
    const usedTicks = Math.min(LIMIT_TICKS, Math.round((usedMs / windowMs) * LIMIT_TICKS));
    for (let index = 0; index < LIMIT_TICKS; index++) {
      svg.appendChild(
        ringTick(
          index / LIMIT_TICKS,
          70,
          80,
          index < usedTicks ? "tt-tick tt-tick-used" : "tt-tick",
        ),
      );
    }
    center.append(
      element("span", "tt-ring-value", String(Math.round(usedMs / 60_000))),
      element("span", "tt-ring-label", "min used"),
    );
  }

  ring.append(svg, center);
  return ring;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

function formatClockTime(timestamp: number, now: Date): string {
  const nextDay = timestamp - now.getTime() > 24 * 60 * 60_000;
  return new Intl.DateTimeFormat(undefined, {
    weekday: nextDay ? "short" : undefined,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function createClockIcon(): SVGElement {
  const icon = svgElement("svg", { viewBox: "0 0 16 16", class: "tt-chip-icon" });
  icon.append(
    svgElement("circle", { cx: 8, cy: 8, r: 6.2 }),
    svgElement("path", { d: "M8 4.8V8l2.2 1.4" }),
  );
  return icon;
}

function renderBlock(dialog: HTMLDialogElement): void {
  const now = new Date();
  blockRenderedMinute = getMinuteKey(now);
  const unlocksAt = inDowntime ? status?.downtimeEndsAt : status?.resetAt;
  const reason = inDowntime ? "scheduled downtime" : "its time limit";

  const title = element(
    "p",
    "tt-headline",
    unlocksAt
      ? `Unlocks in ${formatDuration(unlocksAt - now.getTime())}`
      : inDowntime
        ? "Downtime is on"
        : "Time limit reached",
  );
  title.id = "tt-dialog-title";

  const description = element(
    "p",
    "tt-visually-hidden",
    `${blockedDomain} is blocked by ${reason}${unlocksAt ? ` until ${formatClockTime(unlocksAt, now)}` : ""}.`,
  );
  description.id = "tt-dialog-description";

  const children: Node[] = [createRing(now), title];
  if (unlocksAt) {
    const chip = element("p", "tt-chip");
    const time = element("time", "", formatClockTime(unlocksAt, now));
    time.dateTime = new Date(unlocksAt).toISOString();
    chip.append(createClockIcon(), time);
    chip.setAttribute("aria-hidden", "true");
    children.push(chip);
  }
  children.push(description);
  dialog.replaceChildren(...children);
}

function createBlockDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.id = "tt-dialog";
  dialog.setAttribute("data-type", "block");
  dialog.setAttribute("aria-labelledby", "tt-dialog-title");
  dialog.setAttribute("aria-describedby", "tt-dialog-description");
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
  });
  renderBlock(dialog);
  document.documentElement.appendChild(dialog);
  return dialog;
}

function updateBlock(force = false): void {
  if (!blocked || (!force && blockRenderedMinute === getMinuteKey())) {
    return;
  }
  const dialog = document.querySelector("#tt-dialog[data-type='block']");
  if (dialog) {
    renderBlock(dialog as HTMLDialogElement);
  }
}

function showBlock(): void {
  if (whitelisted || blocked) {
    return;
  }

  const existing = document.querySelector("#tt-dialog");
  if (existing) {
    dismissDialog(existing as HTMLDialogElement);
  }

  createBlockDialog().showModal();
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

  if (whitelisted) {
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

    updateBlock();

    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      handleBlock();
      refreshStatus();
    }

    if (document.hidden || !document.hasFocus()) {
      return;
    }

    chrome.runtime.sendMessage(
      { type: "tick", elapsedMs: elapsed, url: window.location.href },
      () => {
        void chrome.runtime.lastError;
        if (getMinuteKey() !== lastStatusMinute) {
          refreshStatus();
        }
      },
    );
  }, TICK_INTERVAL_MS);
}

function refreshStatus(): void {
  lastStatusMinute = getMinuteKey();
  chrome.runtime.sendMessage(
    { type: "getStatus", url: window.location.href },
    (nextStatus: StatusMessage | undefined) => {
      if (!nextStatus) {
        return;
      }
      status = nextStatus;
      if (status.debug) {
        limitReached = false;
        inDowntime = false;
        whitelisted = false;
        removeBlock();
        return;
      }
      if (domainConfigId !== status.domainConfigId || resetAt !== status.resetAt) {
        warningShown = false;
        setWarningOpen(false);
        removeBlock();
      }
      domainConfigId = status.domainConfigId;
      resetAt = status.resetAt;
      blockedDomain = status.domain ?? "this site";
      whitelisted = status.whitelisted;
      if (status.showWarning) {
        setWarningOpen(true);
      }

      const reasonChanged = inDowntime !== status.downtime;
      limitReached = status.blocked;
      inDowntime = status.downtime;
      if (reasonChanged) {
        removeBlock();
      }
      handleBlock();
      updateBlock(true);
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
  if (actionMessage === "refresh") {
    refreshStatus();
  }
});

startTicking();
refreshStatus();

function resetTickClock(): void {
  // Background timers can be delayed. Never charge that gap after focus returns.
  lastTick = Date.now();
}

window.addEventListener("blur", resetTickClock);
window.addEventListener("focus", resetTickClock);

document.addEventListener("visibilitychange", () => {
  resetTickClock();
  if (!document.hidden) {
    refreshStatus();
  }
});
