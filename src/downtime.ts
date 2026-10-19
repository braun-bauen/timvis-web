import type { DomainData, DowntimeRule, DowntimeSchedule } from "./types";

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
  return (
    (rule.weekdays.includes(day) && minutes >= rule.startMinutes) ||
    (rule.weekdays.includes(previousDay) && minutes < rule.endMinutes)
  );
}

export function evaluateDowntime(rules: DowntimeRule[], date = new Date()): DowntimeStatus {
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
  const downtimeBlocked = downtime.active && !(whitelisted && downtime.allowsWhitelistedPaths);

  return {
    downtimeBlocked,
    accessibleByWhitelist: whitelisted && !downtimeBlocked,
    shouldTrackUsage: !whitelisted && !downtimeBlocked,
  };
}

export function isValidDowntimeRule(rule: DowntimeRule): boolean {
  return (
    rule.weekdays.length > 0 &&
    rule.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    Number.isFinite(rule.startMinutes) &&
    Number.isFinite(rule.endMinutes) &&
    Number.isInteger(rule.startMinutes) &&
    Number.isInteger(rule.endMinutes) &&
    rule.startMinutes >= 0 &&
    rule.startMinutes < 1440 &&
    rule.endMinutes >= 0 &&
    rule.endMinutes < 1440 &&
    (rule.allDay || rule.startMinutes !== rule.endMinutes)
  );
}

/** Translate the single weekly schedule into the existing enforcement intervals. */
export function getDowntimeRules(domain: DomainData): DowntimeRule[] {
  const schedule = domain.downtimeSchedule;
  if (!schedule) return domain.downtimeRules;
  if (!schedule.enabled) return [];
  return schedule.days
    .filter((day) => day.enabled)
    .map((day) => ({
      id: `day-${day.weekday}`,
      weekdays: [day.weekday],
      startMinutes: day.startMinutes,
      endMinutes: day.endMinutes,
      allDay: day.startMinutes === day.endMinutes,
      allowWhitelistedPaths: schedule.allowWhitelistedPaths,
    }));
}

export function createDowntimeSchedule(rules: DowntimeRule[]): {
  schedule: DowntimeSchedule;
  hasConflicts: boolean;
} {
  let hasConflicts = new Set(rules.map((rule) => rule.allowWhitelistedPaths)).size > 1;
  const days = Array.from({ length: 7 }, (_, weekday) => {
    const matching = rules.filter((rule) => rule.weekdays.includes(weekday));
    const first = matching[0];
    if (
      matching.some(
        (rule) =>
          rule.allDay !== first.allDay ||
          rule.startMinutes !== first.startMinutes ||
          rule.endMinutes !== first.endMinutes,
      )
    )
      hasConflicts = true;
    return {
      weekday,
      enabled: matching.length > 0,
      startMinutes: first ? (first.allDay ? 0 : first.startMinutes) : 21 * 60,
      endMinutes: first ? (first.allDay ? 0 : first.endMinutes) : 7 * 60,
    };
  });
  return {
    schedule: {
      enabled: rules.length > 0,
      allowWhitelistedPaths: rules.every((rule) => rule.allowWhitelistedPaths),
      days,
    },
    hasConflicts,
  };
}

export function isValidDowntimeSchedule(schedule: DowntimeSchedule): boolean {
  return (
    schedule.days.length === 7 &&
    new Set(schedule.days.map((day) => day.weekday)).size === 7 &&
    schedule.days.every(
      (day) =>
        Number.isInteger(day.weekday) &&
        day.weekday >= 0 &&
        day.weekday <= 6 &&
        Number.isInteger(day.startMinutes) &&
        day.startMinutes >= 0 &&
        day.startMinutes < 1440 &&
        Number.isInteger(day.endMinutes) &&
        day.endMinutes >= 0 &&
        day.endMinutes < 1440,
    )
  );
}
