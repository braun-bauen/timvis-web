import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

describe("content usage tracking", () => {
  let focused: boolean;
  let documentTarget: EventTarget & { hidden: boolean };
  let windowTarget: EventTarget;
  let tick: () => void;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    focused = true;
    documentTarget = Object.assign(new EventTarget(), {
      hidden: false,
      hasFocus: () => focused,
    });
    windowTarget = Object.assign(new EventTarget(), {
      location: { href: "https://example.com/" },
    });
    sendMessage = vi.fn();
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("chrome", {
      runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    });
    vi.stubGlobal("setInterval", (callback: () => void) => {
      tick = callback;
      return 1;
    });
    await import("./content");
    sendMessage.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    vi.setSystemTime(Date.now() + ms);
  }

  function elapsedTicks(): number[] {
    return sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "tick")
      .map((message) => message.elapsedMs);
  }

  it("shows an auto popover warning once per usage window", async () => {
    const dialogs: Array<
      EventTarget & {
        id: string;
        tagName: string;
        children: typeof dialogs;
        type: string;
        popover: string;
        showPopover: ReturnType<typeof vi.fn>;
        hidePopover: ReturnType<typeof vi.fn>;
        remove: () => void;
      }
    > = [];
    function createElement(tagName: string) {
      const element = Object.assign(new EventTarget(), {
        id: "",
        tagName: tagName.toUpperCase(),
        type: "",
        popover: "",
        children: [] as typeof dialogs,
        setAttribute(name: string, value: string) {
          if (name === "data-type") this.type = value;
        },
        appendChild(child: (typeof dialogs)[number]) {
          this.children.push(child);
        },
        showPopover: vi.fn(),
        hidePopover: vi.fn(),
        close: vi.fn(),
        remove() {
          dialogs.splice(dialogs.indexOf(element), 1);
        },
      });
      return element;
    }
    Object.assign(documentTarget, {
      createElement,
      documentElement: { appendChild: (dialog: (typeof dialogs)[number]) => dialogs.push(dialog) },
      querySelector: (selector: string) =>
        dialogs.find(
          (dialog) => !selector.includes("data-type") || selector.includes(`'${dialog.type}'`),
        ) ?? null,
    });
    // Re-import to capture the actual runtime message handler with a DOM available.
    vi.resetModules();
    await import("./content");
    const statusCallback = sendMessage.mock.calls.find(
      ([message]) => message.type === "getStatus",
    )![1];
    const status = {
      domainConfigId: "example.com",
      blocked: false,
      downtime: false,
      whitelisted: false,
      debug: false,
      showWarning: false,
      resetAt: Date.now() + 60 * 60_000,
    };
    statusCallback(status);
    const receive = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0];
    receive("warn", {}, () => {});
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].tagName).toBe("DIV");
    expect(dialogs[0].popover).toBe("auto");
    expect(dialogs[0].showPopover).toHaveBeenCalled();
    const warning = dialogs[0];
    dialogs[0].children[1].dispatchEvent(new Event("click"));
    expect(warning.hidePopover).toHaveBeenCalled();
    expect(dialogs).toHaveLength(0);
    receive("warn", {}, () => {});
    expect(dialogs).toHaveLength(0);
    statusCallback({ ...status, showWarning: true });
    expect(dialogs).toHaveLength(0);
    statusCallback({ ...status, resetAt: status.resetAt + 60 * 60_000, showWarning: true });
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].showPopover).toHaveBeenCalled();
  });

  it("counts time while the tab is focused", () => {
    advance(1000);
    tick();
    expect(elapsedTicks()).toEqual([1000]);
  });

  it("does not send ticks while unfocused", () => {
    focused = false;
    windowTarget.dispatchEvent(new Event("blur"));
    advance(60_000);
    tick();
    expect(elapsedTicks()).toEqual([]);
  });

  it("preserves reported usage across blur and resumes counting on focus", () => {
    for (let second = 0; second < 5; second++) {
      advance(1000);
      tick();
    }
    expect(elapsedTicks()).toEqual([1000, 1000, 1000, 1000, 1000]);

    focused = false;
    windowTarget.dispatchEvent(new Event("blur"));
    for (let second = 0; second < 60; second++) {
      advance(1000);
      tick();
    }
    expect(elapsedTicks()).toEqual([1000, 1000, 1000, 1000, 1000]);

    focused = true;
    windowTarget.dispatchEvent(new Event("focus"));
    for (let second = 0; second < 3; second++) {
      advance(1000);
      tick();
    }
    expect(elapsedTicks()).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
    expect(elapsedTicks().reduce((total, elapsed) => total + elapsed, 0)).toBe(8000);
  });

  it("does not charge a paused background interval on refocus", () => {
    advance(1000);
    tick();
    focused = false;
    documentTarget.hidden = true;
    windowTarget.dispatchEvent(new Event("blur"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    // No interval callbacks run while this background tab is suspended.
    advance(60_000);
    documentTarget.hidden = false;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    focused = true;
    windowTarget.dispatchEvent(new Event("focus"));
    advance(1000);
    tick();
    expect(elapsedTicks()).toEqual([1000, 1000]);
  });

  it("does not charge time spent in another window while still visible", () => {
    focused = false;
    windowTarget.dispatchEvent(new Event("blur"));
    advance(60_000);
    focused = true;
    windowTarget.dispatchEvent(new Event("focus"));
    advance(1000);
    tick();
    expect(elapsedTicks()).toEqual([1000]);
  });

  it("does not send ticks from a hidden document", () => {
    documentTarget.hidden = true;
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    advance(1000);
    tick();
    expect(elapsedTicks()).toEqual([]);
  });
});
