import { describe, expect, it } from "vitest";
import {
  evaluateDowntime,
  evaluateDowntimeAccess,
  isValidDowntimeRule,
} from "./downtime";
import type { DowntimeRule } from "./types";

const rule = (overrides: Partial<DowntimeRule> = {}): DowntimeRule => ({
  id: "rule",
  weekdays: [1],
  startMinutes: 9 * 60,
  endMinutes: 17 * 60,
  allDay: false,
  allowWhitelistedPaths: true,
  ...overrides,
});

const local = (day: number, hours: number, minutes = 0) => {
  const date = new Date(2026, 7, 23 + day, hours, minutes);
  return date;
};

describe("evaluateDowntimeAccess", () => {
  it("applies strict downtime consistently to whitelist access and usage", () => {
    const access = evaluateDowntimeAccess(
      [rule({ allowWhitelistedPaths: false })],
      true,
      local(1, 12),
    );
    expect(access).toEqual({
      downtimeBlocked: true,
      accessibleByWhitelist: false,
      shouldTrackUsage: false,
    });
  });
});

describe("isValidDowntimeRule", () => {
  it("rejects non-finite and equal non-all-day times", () => {
    expect(isValidDowntimeRule(rule({ startMinutes: Number.NaN }))).toBe(false);
    expect(
      isValidDowntimeRule(rule({ startMinutes: 540, endMinutes: 540 })),
    ).toBe(false);
    expect(
      isValidDowntimeRule(
        rule({ allDay: true, startMinutes: 540, endMinutes: 540 }),
      ),
    ).toBe(true);
  });
});
describe("evaluateDowntime", () => {
  it("uses inclusive starts and exclusive ends", () => {
    expect(evaluateDowntime([rule()], local(1, 9)).active).toBe(true);
    expect(evaluateDowntime([rule()], local(1, 17)).active).toBe(false);
  });

  it("matches overnight rules on their start and following days", () => {
    const overnight = rule({ startMinutes: 21 * 60, endMinutes: 7 * 60 });
    expect(evaluateDowntime([overnight], local(1, 22)).active).toBe(true);
    expect(evaluateDowntime([overnight], local(2, 6, 59)).active).toBe(true);
    expect(evaluateDowntime([overnight], local(2, 7)).active).toBe(false);
  });

  it("wraps overnight rules across the week boundary", () => {
    const sunday = rule({
      weekdays: [0],
      startMinutes: 21 * 60,
      endMinutes: 7 * 60,
    });
    expect(evaluateDowntime([sunday], local(1, 6)).active).toBe(true);
  });

  it("matches an all-day rule only on selected days", () => {
    expect(evaluateDowntime([rule({ allDay: true })], local(1, 0)).active).toBe(
      true,
    );
    expect(
      evaluateDowntime([rule({ allDay: true })], local(2, 12)).active,
    ).toBe(false);
  });

  it("lets the strictest overlapping rule decide whitelist access", () => {
    const status = evaluateDowntime(
      [rule(), rule({ id: "strict", allowWhitelistedPaths: false })],
      local(1, 12),
    );
    expect(status).toEqual({ active: true, allowsWhitelistedPaths: false });
  });
});
