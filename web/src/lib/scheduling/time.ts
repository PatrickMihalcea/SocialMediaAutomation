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
  if (!dt.isValid) throw new Error(`That time is not valid in ${timezoneLabel(timezone)}.`);
  if (
    dt.year !== wall.year ||
    dt.month !== wall.month ||
    dt.day !== wall.day ||
    dt.hour !== wall.hour ||
    dt.minute !== wall.minute
  ) {
    throw new Error(
      `${formatWallClock(wall)} does not exist in ${timezoneLabel(timezone)} because the clock changes for daylight saving time.`,
    );
  }
  return dt.toUTC().toJSDate();
}

/** "2026-09-15T09:00" plus a zone → the UTC instant. */
export function localInputToUtc(value: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error('Enter a complete local date and time.');
  }
  const dt = DateTime.fromISO(value, { zone: timezone });
  if (!dt.isValid) throw new Error(`That date and time is not valid in ${timezoneLabel(timezone)}.`);
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== value) {
    throw new Error(
      `${formatLocalInput(value)} does not exist in ${timezoneLabel(timezone)} because the clock changes for daylight saving time.`,
    );
  }
  return dt.toUTC().toJSDate();
}

function formatWallClock(wall: WallClock): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)));
}

function formatLocalInput(value: string): string {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return formatWallClock({ year, month, day, hour, minute });
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

const TIMEZONE_LABELS: Record<string, string> = {
  UTC: 'Coordinated Universal Time',
  'America/Los_Angeles': 'Pacific Time',
  'America/Denver': 'Mountain Time',
  'America/Chicago': 'Central Time',
  'America/New_York': 'Eastern Time',
  'America/Toronto': 'Eastern Time (Toronto)',
  'America/Sao_Paulo': 'Brasília Time',
  'Europe/London': 'United Kingdom Time',
  'Europe/Dublin': 'Ireland Time',
  'Europe/Lisbon': 'Portugal Time',
  'Europe/Madrid': 'Central European Time (Madrid)',
  'Europe/Paris': 'Central European Time (Paris)',
  'Europe/Berlin': 'Central European Time (Berlin)',
  'Europe/Amsterdam': 'Central European Time (Amsterdam)',
  'Europe/Stockholm': 'Central European Time (Stockholm)',
  'Europe/Warsaw': 'Central European Time (Warsaw)',
  'Europe/Bucharest': 'Eastern European Time (Bucharest)',
  'Europe/Istanbul': 'Türkiye Time',
  'Africa/Lagos': 'West Africa Time',
  'Africa/Johannesburg': 'South Africa Time',
  'Asia/Dubai': 'Gulf Time',
  'Asia/Karachi': 'Pakistan Time',
  'Asia/Kolkata': 'India Time',
  'Asia/Bangkok': 'Indochina Time',
  'Asia/Singapore': 'Singapore Time',
  'Asia/Hong_Kong': 'Hong Kong Time',
  'Asia/Shanghai': 'China Time',
  'Asia/Tokyo': 'Japan Time',
  'Asia/Seoul': 'Korea Time',
  'Australia/Perth': 'Western Australia Time',
  'Australia/Sydney': 'Sydney Time',
  'Pacific/Auckland': 'New Zealand Time',
};

export function timezoneLabel(timezone: string): string {
  const curated = TIMEZONE_LABELS[timezone];
  if (curated) return curated;
  // Browser-detected zones are usually outside the curated map, so name the
  // IANA locality rather than a fallback that tells the reader nothing. The
  // original casing is kept: "Asia/Hong_Kong" reads as "Hong Kong Time".
  const locality = timezone.split('/').pop()?.replaceAll('_', ' ').trim();
  return locality ? `${locality} Time` : 'Workspace local time';
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

/**
 * A select whose value matches no option falls back to its first entry, so a
 * detected zone missing from the curated list would silently resave as UTC.
 */
export function timezoneOptions(current: string): string[] {
  return COMMON_TIMEZONES.includes(current) ? COMMON_TIMEZONES : [current, ...COMMON_TIMEZONES];
}

export const MAX_SCHEDULE_TIMES = 12;

/**
 * The times of day a workflow runs, as minutes past midnight, sorted.
 *
 * Falls back to the single hour and minute, which is what every row held
 * before times were a list. That keeps a row written by an older deploy — or
 * by anything still setting only those two — scheduled at the time it says,
 * rather than silently at midnight.
 */
export function scheduleTimesOf(workflow: {
  scheduleTimes?: number[];
  scheduleHour: number;
  scheduleMinute: number;
}): number[] {
  const times = workflow.scheduleTimes ?? [];
  const chosen = times.length > 0 ? times : [workflow.scheduleHour * 60 + workflow.scheduleMinute];
  return [...new Set(chosen.filter((value) => Number.isInteger(value) && value >= 0 && value < 1440))]
    .sort((a, b) => a - b);
}

/** Splits minutes past midnight back into the pair the clock is written in. */
export const hourMinuteOf = (minutes: number) => ({
  hour: Math.floor(minutes / 60),
  minute: minutes % 60,
});
