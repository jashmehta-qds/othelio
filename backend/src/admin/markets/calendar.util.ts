export interface CalendarValidationResult {
  valid: boolean;
  timeZone: string;
  localTimeStr: string;
  sessionCloseDeltaMinutes: number;
  note?: string;
  error?: string;
}

/**
 * Computes Western Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 */
function getEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Determines whether a date (in America/New_York) is a US Equity Market Holiday.
 */
export function isUSEquityHoliday(year: number, month: number, day: number, dayOfWeek: number): { isHoliday: boolean; holidayName?: string } {
  // Month is 1-indexed (1 = Jan, 12 = Dec)
  // Day of week: 0 = Sun, 1 = Mon, ..., 6 = Sat

  // 1. New Year's Day (Jan 1, or observed Dec 31 if Sat, or Jan 2 if Sun)
  if (month === 1 && day === 1) return { isHoliday: true, holidayName: "New Year's Day" };
  if (month === 1 && day === 2 && dayOfWeek === 1) return { isHoliday: true, holidayName: "New Year's Day (Observed)" };
  if (month === 12 && day === 31 && dayOfWeek === 5) return { isHoliday: true, holidayName: "New Year's Day (Observed)" };

  // 2. Martin Luther King Jr. Day (3rd Monday in January)
  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) {
    return { isHoliday: true, holidayName: 'Martin Luther King Jr. Day' };
  }

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in February)
  if (month === 2 && dayOfWeek === 1 && day >= 15 && day <= 21) {
    return { isHoliday: true, holidayName: "Washington's Birthday" };
  }

  // 4. Good Friday (2 days before Easter Sunday)
  const easter = getEasterSunday(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
  const goodFridayDate = new Date(easterDate.getTime() - 2 * 24 * 60 * 60 * 1000);
  if (month === goodFridayDate.getUTCMonth() + 1 && day === goodFridayDate.getUTCDate()) {
    return { isHoliday: true, holidayName: 'Good Friday' };
  }

  // 5. Memorial Day (Last Monday in May)
  if (month === 5 && dayOfWeek === 1 && day >= 25 && day <= 31) {
    return { isHoliday: true, holidayName: 'Memorial Day' };
  }

  // 6. Juneteenth (June 19, or observed June 18 if Sat, June 20 if Sun)
  if (month === 6 && day === 19) return { isHoliday: true, holidayName: 'Juneteenth National Independence Day' };
  if (month === 6 && day === 18 && dayOfWeek === 5) return { isHoliday: true, holidayName: 'Juneteenth (Observed)' };
  if (month === 6 && day === 20 && dayOfWeek === 1) return { isHoliday: true, holidayName: 'Juneteenth (Observed)' };

  // 7. Independence Day (July 4, or observed July 3 if Sat, July 5 if Sun)
  if (month === 7 && day === 4) return { isHoliday: true, holidayName: 'Independence Day' };
  if (month === 7 && day === 3 && dayOfWeek === 5) return { isHoliday: true, holidayName: 'Independence Day (Observed)' };
  if (month === 7 && day === 5 && dayOfWeek === 1) return { isHoliday: true, holidayName: 'Independence Day (Observed)' };

  // 8. Labor Day (1st Monday in September)
  if (month === 9 && dayOfWeek === 1 && day >= 1 && day <= 7) {
    return { isHoliday: true, holidayName: 'Labor Day' };
  }

  // 9. Thanksgiving Day (4th Thursday in November)
  if (month === 11 && dayOfWeek === 4 && day >= 22 && day <= 28) {
    return { isHoliday: true, holidayName: 'Thanksgiving Day' };
  }

  // 10. Christmas Day (Dec 25, or observed Dec 24 if Sat, Dec 26 if Sun)
  if (month === 12 && day === 25) return { isHoliday: true, holidayName: 'Christmas Day' };
  if (month === 12 && day === 24 && dayOfWeek === 5) return { isHoliday: true, holidayName: 'Christmas Day (Observed)' };
  if (month === 12 && day === 26 && dayOfWeek === 1) return { isHoliday: true, holidayName: 'Christmas Day (Observed)' };

  return { isHoliday: false };
}

/**
 * Validates an expiry timestamp against the US Equity market calendar in America/New_York.
 * Requires:
 * 1. Expiry in the future.
 * 2. Not on a weekend (Saturday or Sunday).
 * 3. Not on an equity market holiday.
 * 4. Aligned to the 16:00 ET regular market close with a max permitted buffer (e.g. 0 to 15 minutes).
 */
export function validateExpiryCalendar(expiryTimestampSecs: number): CalendarValidationResult {
  const nowSecs = Math.floor(Date.now() / 1000);
  if (expiryTimestampSecs <= nowSecs) {
    return {
      valid: false,
      timeZone: 'America/New_York',
      localTimeStr: '',
      sessionCloseDeltaMinutes: 0,
      error: 'Expiry timestamp must be strictly in the future',
    };
  }

  const date = new Date(expiryTimestampSecs * 1000);

  // Format parts in America/New_York
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = dtf.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = Number(partMap.year);
  const month = Number(partMap.month);
  const day = Number(partMap.day);
  const hour = Number(partMap.hour);
  const minute = Number(partMap.minute);
  const weekdayStr = partMap.weekday; // Mon, Tue, Wed, Thu, Fri, Sat, Sun

  const dayOfWeekMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dayOfWeekMap[weekdayStr] ?? 0;

  const localTimeStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`;

  // 1. Weekend Check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      valid: false,
      timeZone: 'America/New_York',
      localTimeStr,
      sessionCloseDeltaMinutes: 0,
      error: `Expiry falls on a weekend (${weekdayStr}). Equity price feeds do not publish weekend closing rounds.`,
    };
  }

  // 2. Holiday Check
  const holiday = isUSEquityHoliday(year, month, day, dayOfWeek);
  if (holiday.isHoliday) {
    return {
      valid: false,
      timeZone: 'America/New_York',
      localTimeStr,
      sessionCloseDeltaMinutes: 0,
      error: `Expiry falls on a US equity market holiday: ${holiday.holidayName}.`,
    };
  }

  // 3. Market Close Buffer Check: Target is 16:00 ET (4:00 PM). Allow [16:00, 16:15].
  // Delta in minutes relative to 16:00
  const minutesFromMidnight = hour * 60 + minute;
  const targetCloseMinutes = 16 * 60; // 960 minutes
  const deltaMinutes = minutesFromMidnight - targetCloseMinutes;

  if (deltaMinutes < 0 || deltaMinutes > 15) {
    return {
      valid: false,
      timeZone: 'America/New_York',
      localTimeStr,
      sessionCloseDeltaMinutes: deltaMinutes,
      error: `Expiry time (${localTimeStr}) is outside the 16:00 ET market close window. Allowed: 16:00 to 16:15 ET.`,
    };
  }

  return {
    valid: true,
    timeZone: 'America/New_York',
    localTimeStr,
    sessionCloseDeltaMinutes: deltaMinutes,
    note: `Verified valid US Equity market session close at ${localTimeStr} with +${deltaMinutes}m feed buffer.`,
  };
}
