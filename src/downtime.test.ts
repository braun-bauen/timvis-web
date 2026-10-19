import { describe, expect, it } from "vite-plus/test";
import {
  evaluateDowntime,
  evaluateDowntimeAccess,
  isValidDowntimeRule,
  createDowntimeSchedule,
  getDowntimeRules,
  isValidDowntimeSchedule,
} from "./downtime";
import type { DomainData, DowntimeRule } from "./types";

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
    expect(isValidDowntimeRule(rule({ startMinutes: 540, endMinutes: 540 }))).toBe(false);
    expect(isValidDowntimeRule(rule({ allDay: true, startMinutes: 540, endMinutes: 540 }))).toBe(
      true,
    );
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
    expect(evaluateDowntime([rule({ allDay: true })], local(1, 0)).active).toBe(true);
    expect(evaluateDowntime([rule({ allDay: true })], local(2, 12)).active).toBe(false);
  });

  it("lets the strictest overlapping rule decide whitelist access", () => {
    const status = evaluateDowntime(
      [rule(), rule({ id: "strict", allowWhitelistedPaths: false })],
      local(1, 12),
    );
    expect(status).toEqual({ active: true, allowsWhitelistedPaths: false });
  });
});

describe("weekly downtime schedule", () => {
  function configured(rules: DowntimeRule[]): DomainData {
    return {
      id: "site",
      url: "example.com",
      limitMs: 300000,
      whitelistedPaths: [],
      downtimeRules: rules,
      downtimeSchedule: createDowntimeSchedule(rules).schedule,
    };
  }

  it("supports separate times per day and overnight periods", () => {
    const domain = configured([
      rule(),
      rule({ id: "night", weekdays: [2], startMinutes: 21 * 60, endMinutes: 7 * 60 }),
    ]);
    const rules = getDowntimeRules(domain);
    expect(evaluateDowntime(rules, local(1, 12)).active).toBe(true);
    expect(evaluateDowntime(rules, local(2, 12)).active).toBe(false);
    expect(evaluateDowntime(rules, local(2, 22)).active).toBe(true);
    expect(evaluateDowntime(rules, local(3, 6)).active).toBe(true);
    expect(evaluateDowntime(rules, local(3, 7)).active).toBe(false);
  });

  it("disables downtime globally without losing the schedule", () => {
    const domain = configured([rule()]);
    const schedule = domain.downtimeSchedule!;
    const days = structuredClone(schedule.days);
    schedule.enabled = false;
    expect(evaluateDowntimeAccess(getDowntimeRules(domain), false, local(1, 12))).toMatchObject({
      downtimeBlocked: false,
      shouldTrackUsage: true,
    });
    expect(schedule.days).toEqual(days);
    schedule.enabled = true;
    expect(evaluateDowntime(getDowntimeRules(domain), local(1, 12)).active).toBe(true);
  });

  it("disables individual days without clearing their times", () => {
    const domain = configured([rule()]);
    const monday = domain.downtimeSchedule!.days.find((day) => day.weekday === 1)!;
    monday.enabled = false;
    expect(evaluateDowntime(getDowntimeRules(domain), local(1, 12)).active).toBe(false);
    expect(monday).toMatchObject({ startMinutes: 540, endMinutes: 1020 });
    monday.enabled = true;
    expect(evaluateDowntime(getDowntimeRules(domain), local(1, 12)).active).toBe(true);
  });

  it("retains full-day downtime and allowed-path behavior", () => {
    const domain = configured([rule({ allDay: true, allowWhitelistedPaths: false })]);
    expect(evaluateDowntime(getDowntimeRules(domain), local(1, 23, 59)).active).toBe(true);
    expect(
      evaluateDowntimeAccess(getDowntimeRules(domain), true, local(1, 12)).downtimeBlocked,
    ).toBe(true);
    domain.downtimeSchedule!.allowWhitelistedPaths = true;
    expect(
      evaluateDowntimeAccess(getDowntimeRules(domain), true, local(1, 12)).accessibleByWhitelist,
    ).toBe(true);
  });

  it("reports legacy schedules that cannot fit one period per day", () => {
    expect(createDowntimeSchedule([rule()]).hasConflicts).toBe(false);
    expect(
      createDowntimeSchedule([rule(), rule({ startMinutes: 21 * 60, endMinutes: 7 * 60 })])
        .hasConflicts,
    ).toBe(true);
  });

  it("validates all seven days and rejects incomplete or invalid times", () => {
    const schedule = createDowntimeSchedule([]).schedule;
    expect(isValidDowntimeSchedule(schedule)).toBe(true);
    schedule.days[0].startMinutes = Number.NaN;
    expect(isValidDowntimeSchedule(schedule)).toBe(false);
    schedule.days[0].startMinutes = 0;
    schedule.days[0].endMinutes = 1440;
    expect(isValidDowntimeSchedule(schedule)).toBe(false);
    schedule.days.pop();
    expect(isValidDowntimeSchedule(schedule)).toBe(false);
  });
});
