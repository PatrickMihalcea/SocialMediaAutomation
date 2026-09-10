import { DateTime } from 'luxon';

/**
 * Every instant in the database is UTC. A wall-clock time only means something
 * next to an IANA zone, so both travel together from the composer to the queue.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock in a zone → the UTC instant it names. */
export function toUtc(wall: WallClock, timezone: string): Date {
  const dt = DateTime.fromObject(wall, { zone: timezone });
  if (!dt.isValid) throw new Error(`Invalid time for zone ${timezone}: ${dt.invalidExplanation}`);
  if (
    dt.year !== wall.year ||
    dt.month !== wall.month ||
    dt.day !== wall.day ||
    dt.hour !== wall.hour ||
    dt.minute !== wall.minute
  ) {
    throw new Error(
      `${formatWallClock(wall)} does not exist in ${timezone} because the clock changes for daylight saving time.`,
    );
  }
  return dt.toUTC().toJSDate();
}

/** "2026-09-15T09:00" plus a zone → the UTC instant. */
export function localInputToUtc(value: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error(`"${value}" is not a complete local date and time.`);
  }
  const dt = DateTime.fromISO(value, { zone: timezone });
  if (!dt.isValid) throw new Error(`Invalid date-time "${value}" for zone ${timezone}`);
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value) {
    throw new Error(
      `${value.replace('T', ' ')} does not exist in ${timezone} because the clock changes for daylight saving time.`,
    );
  }
  return dt.toUTC().toJSDate();
}

function formatWallClock(wall: WallClock): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** UTC instant → the value a <input type="datetime-local"> expects in that zone. */
export function utcToLocalInput(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).toFormat("yyyy-MM-dd'T'HH:mm");
}

export function formatInZone(date: Date, timezone: string, format = 'ccc d LLL, HH:mm'): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).toFormat(format);
}

/** 0 = Sunday … 6 = Saturday, matching SchedulingRule.weekday. */
export function weekdayInZone(date: Date, timezone: string): number {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).weekday % 7;
}

/**
 * The next instant at which `weekday hour:minute` occurs in `timezone`, at or
 * after `from`.
 *
 * Luxon resolves DST for us: on a spring-forward day a 02:30 slot lands on the
 * following valid instant rather than throwing, and on a fall-back day it takes
 * the first of the two 01:30s.
 */
export function nextOccurrence(
  from: Date,
  timezone: string,
  weekday: number,
  hour: number,
  minute: number,
): Date {
  const start = DateTime.fromJSDate(from, { zone: 'utc' }).setZone(timezone);
  // Luxon weekdays run 1 (Monday) … 7 (Sunday); ours run 0 (Sunday) … 6.
  const luxonWeekday = weekday === 0 ? 7 : weekday;

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = start.plus({ days: offset }).set({ hour, minute, second: 0, millisecond: 0 });
    if (candidate.weekday !== luxonWeekday) continue;
    if (candidate.toMillis() <= start.toMillis()) continue;
    return candidate.toUTC().toJSDate();
  }
  // Unreachable for a valid weekday, but a defined fallback beats a crash.
  return start.plus({ weeks: 1 }).toUTC().toJSDate();
}

export function startOfDayInZone(date: Date, timezone: string): Date {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).startOf('day').toUTC().toJSDate();
}

export function endOfDayInZone(date: Date, timezone: string): Date {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).endOf('day').toUTC().toJSDate();
}

export function startOfWeekInZone(date: Date, timezone: string): Date {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).startOf('week').toUTC().toJSDate();
}

export function startOfMonthInZone(date: Date, timezone: string): Date {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).startOf('month').toUTC().toJSDate();
}

export function relativeLabel(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).toRelative() ?? '';
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Zones offered in workspace settings — a full IANA list is unusable in a select. */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Bucharest',
  'Europe/Istanbul',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];
