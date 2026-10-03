const relativeTime = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const dateWithoutYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateWithYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatActivityTime(timestamp: string, now = new Date()): string {
  const occurredAt = new Date(timestamp);
  if (Number.isNaN(occurredAt.getTime())) return "Time unavailable";

  const calendarDays = Math.round((startOfLocalDay(now) - startOfLocalDay(occurredAt)) / 86_400_000);
  const elapsedMs = now.getTime() - occurredAt.getTime();

  if (calendarDays === 0) {
    const elapsedMinutes = Math.max(0, Math.round(elapsedMs / 60_000));
    if (elapsedMinutes < 1) return relativeTime.format(0, "second");
    if (elapsedMinutes < 60) return relativeTime.format(-elapsedMinutes, "minute");
    return relativeTime.format(-Math.round(elapsedMinutes / 60), "hour");
  }

  if (calendarDays > 0 && calendarDays < 7) return relativeTime.format(-calendarDays, "day");
  if (calendarDays < 0 && calendarDays > -7) return relativeTime.format(-calendarDays, "day");

  return occurredAt.getFullYear() === now.getFullYear()
    ? dateWithoutYear.format(occurredAt)
    : dateWithYear.format(occurredAt);
}
