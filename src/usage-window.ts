const HOUR_MS = 60 * 60_000;

/** Fixed windows aligned to local calendar hours, including intervals spanning days. */
export function getUsageWindow(hours = 1, now = new Date()): { key: string; resetAt: number } {
  const calendarHour = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const start = Math.floor(calendarHour / (hours * HOUR_MS)) * hours * HOUR_MS;
  function localDate(timestamp: number): Date {
    const date = new Date(timestamp);
    return new Date(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    );
  }
  const date = new Date(start);
  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCHours()).padStart(2, "0")}`;
  return { key, resetAt: localDate(start + hours * HOUR_MS).getTime() };
}

export function legacyResetAt(key: string): number {
  const [year, month, day, hour] = key.split("-").map(Number);
  return new Date(year, month - 1, day, hour + 1).getTime();
}
