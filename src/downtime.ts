import type { DowntimeRule } from "./types";

export type DowntimeStatus = {
  active: boolean;
  allowsWhitelistedPaths: boolean;
};

export type DowntimeAccess = {
  downtimeBlocked: boolean;
  accessibleByWhitelist: boolean;
  shouldTrackUsage: boolean;
};

function matchesRule(rule: DowntimeRule, day: number, minutes: number): boolean {
  if (rule.allDay) {
    return rule.weekdays.includes(day);
  }
  if (rule.startMinutes < rule.endMinutes) {
    return rule.weekdays.includes(day) && minutes >= rule.startMinutes && minutes < rule.endMinutes;
  }
  const previousDay = (day + 6) % 7;
  return (rule.weekdays.includes(day) && minutes >= rule.startMinutes) ||
    (rule.weekdays.includes(previousDay) && minutes < rule.endMinutes);
}

export function evaluateDowntime(
  rules: DowntimeRule[],
  date = new Date(),
): DowntimeStatus {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const matching = rules.filter((rule) => matchesRule(rule, date.getDay(), minutes));
  return {
    active: matching.length > 0,
    allowsWhitelistedPaths:
      matching.length > 0 && matching.every((rule) => rule.allowWhitelistedPaths),
  };
}

export function evaluateDowntimeAccess(
  rules: DowntimeRule[],
  whitelisted: boolean,
  date = new Date(),
): DowntimeAccess {
  const downtime = evaluateDowntime(rules, date);
  const downtimeBlocked =
    downtime.active && !(whitelisted && downtime.allowsWhitelistedPaths);

  return {
    downtimeBlocked,
    accessibleByWhitelist: whitelisted && !downtimeBlocked,
    shouldTrackUsage: !whitelisted && !downtimeBlocked,
  };
}

export function isValidDowntimeRule(rule: DowntimeRule): boolean {
  return (
    rule.weekdays.length > 0 &&
    Number.isFinite(rule.startMinutes) &&
    Number.isFinite(rule.endMinutes) &&
    (rule.allDay || rule.startMinutes !== rule.endMinutes)
  );
}
