import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import Options from "./options";
import type { DomainData, RuntimeMessage, StatusMessage, StoredState } from "./types";

vi.mock("./env", () => ({ env: { debug: false } }));
const domain = (url: string, limitMs = 20 * 60_000): DomainData => ({
  id: url,
  url,
  limitMs,
  whitelistedPaths: [],
  downtimeRules: [],
});

describe("popup settings and enforcement", () => {
  let data: Record<string, unknown>;
  let listener: (
    message: RuntimeMessage,
    sender: { tab?: { id: number; url: string } },
    respond: (result: unknown) => void,
  ) => boolean;
  let contains: ReturnType<typeof vi.fn>;
  let request: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let tabMessage: ReturnType<typeof vi.fn>;
  let hourKey: string;

  function message<T>(value: RuntimeMessage): Promise<T> {
    return new Promise((resolve) =>
      listener(value, { tab: { id: 1, url: value.url ?? "https://example.com/" } }, (result) =>
        resolve(result as T),
      ),
    );
  }
  function state(id: string): StoredState {
    return data[`timvis_state:${id}`] as StoredState;
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const date = new Date(2026, 9, 5, 12, 30);
    vi.setSystemTime(date);
    hourKey = "2026-10-05-12";
    data = {
      timvis_options: { domains: [domain("example.com"), domain("news.example.com", 5 * 60_000)] },
    };
    contains = vi.fn().mockResolvedValue(true);
    request = vi.fn().mockResolvedValue(true);
    remove = vi.fn();
    tabMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: (key: string, callback: (items: Record<string, unknown>) => void) =>
            callback({ [key]: structuredClone(data[key]) }),
          set: (values: Record<string, unknown>, callback: () => void) => {
            Object.assign(data, structuredClone(values));
            callback();
          },
          remove: (keys: string[], callback: () => void) => {
            keys.forEach((key) => delete data[key]);
            callback();
          },
        },
      },
      permissions: { contains, request, remove },
      scripting: {
        unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
        registerContentScripts: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, url: "https://example.com/" },
          { id: 2, url: "https://news.example.com/" },
        ]),
        sendMessage: tabMessage,
      },
      runtime: {
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        sendMessage: (value: RuntimeMessage) => message(value),
      },
    });
    await import("./background");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives exact subdomains independent usage and shares parent usage elsewhere", async () => {
    await message({ type: "tick", url: "https://news.example.com/", elapsedMs: 1000 });
    expect(state("news.example.com").usedMs).toBe(1000);
    expect(state("example.com")).toBeUndefined();
    await message({ type: "tick", url: "https://other.example.com/", elapsedMs: 2000 });
    await message({ type: "tick", url: "https://example.com/", elapsedMs: 1000 });
    expect(state("example.com").usedMs).toBe(3000);
    expect(state("news.example.com").usedMs).toBe(1000);
  });

  it("reads recorded usage and reset time without consuming a webpage warning", async () => {
    data["timvis_state:example.com"] = {
      hourKey,
      usedMs: 19 * 60_000,
      warningShown: false,
      blocked: false,
    };
    const before = structuredClone(data);
    for (let i = 0; i < 2; i++) {
      const status = await message<StatusMessage>({
        type: "getPopupStatus",
        url: "https://example.com/",
      });
      expect(status).toMatchObject({
        usedMs: 19 * 60_000,
        remainingMs: 60_000,
        allowanceMs: 20 * 60_000,
        showWarning: false,
      });
      expect(status.resetAt).toBe(new Date(2026, 9, 5, 13).getTime());
    }
    expect(data).toEqual(before);
    expect(
      (await message<StatusMessage>({ type: "getStatus", url: "https://example.com/" }))
        .showWarning,
    ).toBe(true);
  });

  it("reads each rule's usage by ID without an active matching tab or consuming warnings", async () => {
    data["timvis_state:example.com"] = {
      hourKey,
      usedMs: 19 * 60_000,
      warningShown: false,
      blocked: false,
    };
    data["timvis_state:news.example.com"] = {
      hourKey,
      usedMs: 4 * 60_000,
      warningShown: false,
      blocked: false,
    };
    const before = structuredClone(data);
    const parent = await message<StatusMessage>({
      type: "getPopupStatus",
      domainConfigId: "example.com",
      url: "https://news.example.com/",
    });
    const child = await message<StatusMessage>({
      type: "getPopupStatus",
      domainConfigId: "news.example.com",
    });
    expect(parent).toMatchObject({
      domainConfigId: "example.com",
      usedMs: 19 * 60_000,
      allowanceMs: 20 * 60_000,
      showWarning: false,
    });
    expect(child).toMatchObject({
      domainConfigId: "news.example.com",
      usedMs: 4 * 60_000,
      allowanceMs: 5 * 60_000,
      showWarning: false,
    });
    expect(data).toEqual(before);
    vi.setSystemTime(new Date(2026, 9, 5, 13));
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", domainConfigId: "news.example.com" }))
        .usedMs,
    ).toBe(0);
  });

  it("recomputes blocking on save while preserving usage and warning state", async () => {
    data["timvis_state:example.com"] = {
      hourKey,
      usedMs: 20 * 60_000,
      warningShown: true,
      blocked: true,
    };
    const options = Options();
    await options.updateDomain(domain("example.com", 25 * 60_000));
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }))
        .blocked,
    ).toBe(false);
    expect(state("example.com").usedMs).toBe(20 * 60_000);
    expect(tabMessage).toHaveBeenCalledWith(1, "refresh", expect.any(Function));
    await options.updateDomain(domain("example.com", 15 * 60_000));
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }))
        .blocked,
    ).toBe(true);
    expect(state("example.com").warningShown).toBe(true);
  });

  it("clears only the deleted rule, restores its parent, and reuses permission on re-add", async () => {
    data["timvis_state:news.example.com"] = {
      hourKey,
      usedMs: 1000,
      warningShown: false,
      blocked: false,
    };
    data["timvis_state:example.com"] = {
      hourKey,
      usedMs: 5000,
      warningShown: false,
      blocked: false,
    };
    const options = Options();
    await options.removeDomain(domain("news.example.com"));
    expect(state("news.example.com")).toBeUndefined();
    const status = await message<StatusMessage>({
      type: "getPopupStatus",
      url: "https://news.example.com/",
    });
    expect(status).toMatchObject({ domain: "example.com", usedMs: 5000 });
    expect(remove).not.toHaveBeenCalled();
    await options.addDomain(domain("news.example.com", 5 * 60_000));
    expect(request).not.toHaveBeenCalled();
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://news.example.com/" }))
        .usedMs,
    ).toBe(0);
  });

  it("reports allowed paths and strict downtime consistently", async () => {
    const config = domain("example.com");
    config.whitelistedPaths = ["/inbox"];
    await Options().updateDomain(config);
    await message({ type: "tick", url: "https://example.com/inbox", elapsedMs: 1000 });
    expect(state(config.id)).toBeUndefined();
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/inbox" }))
        .whitelisted,
    ).toBe(true);
    config.downtimeRules = [
      {
        id: "all-day",
        weekdays: [1],
        startMinutes: 0,
        endMinutes: 0,
        allDay: true,
        allowWhitelistedPaths: false,
      },
    ];
    await Options().updateDomain(config);
    expect(
      await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/inbox" }),
    ).toMatchObject({ blocked: true, downtime: true, whitelisted: false });
  });

  it("applies the weekly schedule switch immediately on save and preserves recorded usage", async () => {
    const config = domain("example.com");
    data["timvis_state:example.com"] = {
      hourKey,
      usedMs: 1000,
      warningShown: false,
      blocked: false,
    };
    config.downtimeSchedule = {
      enabled: true,
      allowWhitelistedPaths: true,
      days: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        enabled: weekday === 1,
        startMinutes: 540,
        endMinutes: 1020,
      })),
    };
    await Options().updateDomain(config);
    expect(
      await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }),
    ).toMatchObject({ blocked: true, downtime: true, usedMs: 1000 });
    config.downtimeSchedule.enabled = false;
    await Options().updateDomain(config);
    expect(
      await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }),
    ).toMatchObject({ blocked: false, downtime: false, usedMs: 1000 });
    expect((await Options().getDomains())[0].downtimeSchedule).toEqual(config.downtimeSchedule);
  });

  it("notifies only the controlling rule's tabs after exhausting the parent", async () => {
    await message({ type: "tick", url: "https://example.com/", elapsedMs: 20 * 60_000 });
    expect(tabMessage).toHaveBeenCalledWith(1, "refresh", expect.any(Function));
    expect(tabMessage.mock.calls.some(([id]) => id === 2)).toBe(false);
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }))
        .blocked,
    ).toBe(true);
  });

  it("resets usage on the next hour and never matches unsupported pages", async () => {
    await message({ type: "tick", url: "https://example.com/", elapsedMs: 1000 });
    vi.setSystemTime(new Date(2026, 9, 5, 13));
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "https://example.com/" }))
        .usedMs,
    ).toBe(0);
    expect(
      (await message<StatusMessage>({ type: "getPopupStatus", url: "chrome://settings" }))
        .domainConfigId,
    ).toBeUndefined();
  });

  it("shares usage across a fixed two-hour window and resets exactly at its boundary", async () => {
    const config = { ...domain("example.com"), resetHours: 2 };
    await Options().updateDomain(config);
    await message({ type: "tick", url: "https://example.com/", elapsedMs: config.limitMs });
    vi.setSystemTime(new Date(2026, 9, 5, 13, 59));
    expect(await message<StatusMessage>({ type: "getPopupStatus" })).toMatchObject({
      usedMs: config.limitMs,
      blocked: true,
      resetAt: new Date(2026, 9, 5, 14).getTime(),
    });
    vi.setSystemTime(new Date(2026, 9, 5, 14));
    expect(await message<StatusMessage>({ type: "getPopupStatus" })).toMatchObject({
      usedMs: 0,
      blocked: false,
      resetAt: new Date(2026, 9, 5, 16).getTime(),
    });
  });

  it("preserves usage when changing intervals and uses the new boundary even without ticks", async () => {
    await message({ type: "tick", elapsedMs: 1000 });
    await Options().updateDomain({ ...domain("example.com"), resetHours: 2 });
    expect(await message<StatusMessage>({ type: "getPopupStatus" })).toMatchObject({
      usedMs: 1000,
      resetAt: new Date(2026, 9, 5, 14).getTime(),
    });
    await Options().updateDomain({ ...domain("example.com"), resetHours: 1 });
    expect(await message<StatusMessage>({ type: "getPopupStatus" })).toMatchObject({
      usedMs: 1000,
    });
    vi.setSystemTime(new Date(2026, 9, 5, 13));
    expect(await message<StatusMessage>({ type: "getPopupStatus" })).toMatchObject({ usedMs: 0 });
  });

  it("rejects invalid reset intervals without saving", async () => {
    for (const resetHours of [0, -1, 1.5, NaN, Infinity]) {
      expect(
        (await Options().updateDomain({ ...domain("example.com"), resetHours })).error,
      ).toBeTruthy();
    }
    expect((await Options().getDomains())[0].resetHours).toBe(1);
  });

  it("treats multi-label parent domains and exact subdomains correctly", () => {
    const options = Options();
    const parent = domain("example.co.uk");
    const subdomain = domain("news.example.co.uk");
    expect(options.getBlockedDomainForUrl([parent, subdomain], "https://news.example.co.uk/")).toBe(
      subdomain,
    );
    expect(
      options.getBlockedDomainForUrl([parent, subdomain], "https://deep.news.example.co.uk/"),
    ).toBe(parent);
    expect(
      options.getBlockedDomainForUrl([subdomain], "https://deep.news.example.co.uk/"),
    ).toBeNull();
    expect(options.getOriginPatterns(subdomain)).toEqual([
      "http://news.example.co.uk/*",
      "https://news.example.co.uk/*",
    ]);
  });

  it("requests missing permission and does not activate a domain when denied", async () => {
    contains.mockResolvedValue(false);
    request.mockResolvedValue(false);
    const options = Options();
    expect((await options.addDomain(domain("another.com"))).error).toContain("not granted");
    expect((await options.getDomains()).some((item) => item.url === "another.com")).toBe(false);
  });

  it("rejects invalid complete configurations without changing storage", async () => {
    const before = structuredClone(data);
    expect((await Options().updateDomain(domain("example.com", Number.NaN))).error).toBeDefined();
    expect(data).toEqual(before);
  });
});
