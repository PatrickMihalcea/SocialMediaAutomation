'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, X } from 'lucide-react';
import { Button, Checkbox, Field, IconButton, StatusMessage } from '@/bridge88/components';
import { updateWorkflowAction } from '@/app/actions/workflows';
// From the client-safe time module, not from @/lib/workflows/schedule: that
// one is server-only, and importing it here pulled the whole AI and database
// tree into the browser bundle.
import {
  hourMinuteOf,
  MAX_SCHEDULE_TIMES,
  nextOccurrence,
  timezoneLabel,
  WEEKDAY_SHORT,
} from '@/lib/scheduling/time';

/**
 * Weekly schedule, in the same weekday-plus-wall-clock shape the posting queue
 * already uses. A scheduled run needs nobody signed in — it is attributed to
 * whoever created the workflow.
 *
 * Times are a list. One workflow wanting a morning and an evening slot used to
 * mean two copies of the same graph, which then drifted apart.
 *
 * The zone is the workspace's and is shown, not offered: a workflow on its own
 * zone would fire at a time nothing else in the workspace agrees with.
 */
export function WorkflowSchedule({
  slug,
  timezone,
  workflow,
}: {
  slug: string;
  timezone: string;
  workflow: {
    id: string;
    scheduleEnabled: boolean;
    scheduleWeekdays: number[];
    /** Minutes past midnight, already resolved and sorted by the page. */
    scheduleTimes: number[];
  };
}) {
  const [enabled, setEnabled] = useState(workflow.scheduleEnabled);
  const [weekdays, setWeekdays] = useState<number[]>(workflow.scheduleWeekdays);
  const [times, setTimes] = useState<number[]>(
    workflow.scheduleTimes.length > 0 ? workflow.scheduleTimes : [9 * 60],
  );
  const [saved, setSaved] = useState<{ snapshot: string; message: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  /**
   * The confirmation names the next run time, so it becomes wrong the moment a
   * day or a time changes. Derived from a snapshot rather than cleared by each
   * control, so adding one cannot forget to reset it.
   */
  const snapshot = JSON.stringify([enabled, [...weekdays].sort(), [...times].sort((a, b) => a - b)]);
  const message = saved?.snapshot === snapshot ? saved.message : '';

  // Two rows showing the same time would silently become one on save, so it is
  // said here instead.
  const duplicated = new Set(times).size !== times.length;
  // A duplicate blocks the save whether or not automatic running is on: the
  // message says to change one, and a Save that quietly merged them instead
  // would contradict it.
  const blocked = duplicated || (enabled && weekdays.length === 0);

  function toggleDay(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  /** An hour after the latest slot, which is usually near enough to adjust. */
  function addTime() {
    setTimes((current) => {
      const latest = current.length > 0 ? Math.max(...current) : 8 * 60;
      return [...current, Math.min(latest + 60, 23 * 60 + 59)];
    });
  }

  function save() {
    setError('');
    startTransition(async () => {
      try {
        const updated = await updateWorkflowAction(slug, workflow.id, {
          scheduleEnabled: enabled,
          scheduleWeekdays: weekdays,
          scheduleTimes: times,
        });
        setSaved({
          snapshot,
          message: updated.nextRunAt
            ? `Saved. Next run ${new Date(updated.nextRunAt).toLocaleString()}.`
            : 'Saved. This workflow runs manually only.',
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That schedule could not be saved.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="b88-eyebrow">Schedule</p>

      <Checkbox
        label="Run automatically"
        checked={enabled}
        onChange={(event) => setEnabled(event.target.checked)}
      />

      {/* Days and times stay editable whether or not automatic running is on.
          Gating them behind the checkbox left controls that looked live and
          silently ate the click, with nothing on screen saying why. */}
      <div>
        <p className="b88-label">Days</p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_SHORT.map((label, day) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={weekdays.includes(day)}
              className="rounded-pill border border-hairline px-4 py-2 text-sm transition-opacity hover:opacity-80"
              style={
                weekdays.includes(day)
                  ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="b88-label">Times</p>
        {/* One control per slot, each with its own remove. A single field
            holding "09:00, 18:30" would need parsing and would fail on the
            typo rather than on the row. */}
        <ul className="list-none space-y-2 p-0">
          {times.map((minutes, index) => (
            <li key={index} className="flex items-center gap-2">
              {/* One time control, not an hour spinner beside a minute spinner:
                  nobody thinks of half past nine as two numbers, and the pair
                  let 9:7 through. */}
              <Field
                label={`Time ${index + 1}`}
                labelHidden
                type="time"
                value={clock(minutes)}
                onChange={(event) => {
                  const next = minutesOf(event.target.value);
                  if (next === null) return;
                  setTimes((current) => current.map((value, i) => (i === index ? next : value)));
                }}
                containerClassName="w-36"
              />
              {/* Never on the last one: a schedule with no time is not a
                  schedule, and removing it would leave nothing to put back. */}
              {times.length > 1 && (
                <IconButton
                  icon={X}
                  label={`Remove ${clock(minutes)}`}
                  onClick={() => setTimes((current) => current.filter((_, i) => i !== index))}
                />
              )}
            </li>
          ))}
        </ul>
        {times.length < MAX_SCHEDULE_TIMES && (
          <Button variant="secondary" size="sm" onClick={addTime} className="mt-2">
            <Plus size={15} aria-hidden="true" />
            Add a time
          </Button>
        )}
      </div>

      <p className="b88-caption">
        {timezoneLabel(timezone)} ·{' '}
        <Link href={`/w/${slug}/settings`} className="underline underline-offset-4">
          Change in workspace settings
        </Link>
      </p>

      {/* Answers "when does this actually fire" before saving, rather than after. */}
      {enabled && weekdays.length === 0 && (
        <StatusMessage tone="error">Choose at least one day, or this workflow will not run.</StatusMessage>
      )}
      {duplicated && (
        <StatusMessage tone="error">Two of those times are the same. Change or remove one.</StatusMessage>
      )}
      {weekdays.length > 0 && !duplicated && (
        <div>
          <p className="text-sm">
            {enabled
              ? `Next run ${formatNextRun(weekdays, times, timezone)}.`
              : `Turn on Run automatically to use this schedule. It would next run ${formatNextRun(weekdays, times, timezone)}.`}
          </p>
          {/* Each slot starts a run, and a run generates. Worth one quiet line
              before someone picks every day at four times. */}
          <p className="b88-caption mt-1">
            {weekdays.length * times.length} run{weekdays.length * times.length === 1 ? '' : 's'} a week
          </p>
        </div>
      )}

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {message && <StatusMessage tone="success">{message}</StatusMessage>}

      <Button onClick={save} disabled={pending || blocked}>
        {pending ? 'Saving' : 'Save schedule'}
      </Button>
    </div>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Minutes past midnight as the "HH:MM" a time input reads and writes. */
function clock(minutes: number): string {
  const { hour, minute } = hourMinuteOf(minutes);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "HH:MM" back to minutes past midnight, or null when the field is mid-edit. */
function minutesOf(value: string): number | null {
  const [hour, minute] = value.split(':');
  if (hour === undefined || minute === undefined) return null;
  const total = Number(hour) * 60 + Number(minute);
  return Number.isFinite(total) && total >= 0 && total < 1440 ? total : null;
}

/**
 * The soonest slot, using the same nextOccurrence the server schedules with so
 * the preview cannot disagree with what actually gets booked.
 */
function formatNextRun(weekdays: number[], times: number[], timezone: string): string {
  const now = new Date();
  const soonest = weekdays
    .flatMap((weekday) => times.map((minutes) => {
      const { hour, minute } = hourMinuteOf(minutes);
      return nextOccurrence(now, timezone, weekday, hour, minute);
    }))
    .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(soonest);
}
