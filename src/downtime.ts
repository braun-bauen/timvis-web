import type { DowntimeRule } from "./types";

export type DowntimeStatus = {
  active: boolean;
  allowsWhitelistedPaths: boolean;
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
