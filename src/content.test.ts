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
