'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Checkbox, Field, StatusMessage } from '@/bridge88/components';
import { updateWorkflowAction } from '@/app/actions/workflows';
import { nextOccurrence, timezoneLabel, WEEKDAY_SHORT } from '@/lib/scheduling/time';

/**
 * Weekly schedule, in the same weekday-plus-wall-clock shape the posting queue
 * already uses. A scheduled run needs nobody signed in — it is attributed to
 * whoever created the workflow.
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
    scheduleHour: number;
    scheduleMinute: number;
  };
}) {
  const [enabled, setEnabled] = useState(workflow.scheduleEnabled);
  const [weekdays, setWeekdays] = useState<number[]>(workflow.scheduleWeekdays);
  const [hour, setHour] = useState(workflow.scheduleHour);
  const [minute, setMinute] = useState(workflow.scheduleMinute);
  const [saved, setSaved] = useState<{ snapshot: string; message: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  /**
   * The confirmation names the next run time, so it becomes wrong the moment a
   * day or the time changes. Derived from a snapshot rather than cleared by each
   * control, so adding one cannot forget to reset it.
   */
  const snapshot = JSON.stringify([enabled, [...weekdays].sort(), hour, minute]);
  const message = saved?.snapshot === snapshot ? saved.message : '';

  function toggleDay(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  function save() {
    setError('');
    startTransition(async () => {
      try {
        const updated = await updateWorkflowAction(slug, workflow.id, {
          scheduleEnabled: enabled,
          scheduleWeekdays: weekdays,
          scheduleHour: hour,
          scheduleMinute: minute,
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

      {/* Days and time stay editable whether or not automatic running is on.
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

      {/* One time control, not an hour spinner beside a minute spinner: nobody
          thinks of half past nine as two numbers, and the pair let 9:7 through. */}
      <Field
        label="Time"
        type="time"
        value={`${pad(hour)}:${pad(minute)}`}
        onChange={(event) => {
          const [nextHour, nextMinute] = event.target.value.split(':');
          if (nextHour === undefined || nextMinute === undefined) return;
          setHour(Number(nextHour));
          setMinute(Number(nextMinute));
        }}
        containerClassName="w-40"
      />

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
      {weekdays.length > 0 && (
        <p className="text-sm">
          {enabled
            ? `Next run ${formatNextRun(weekdays, hour, minute, timezone)}.`
            : `Turn on Run automatically to use this schedule. It would next run ${formatNextRun(weekdays, hour, minute, timezone)}.`}
        </p>
      )}

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {message && <StatusMessage tone="success">{message}</StatusMessage>}

      <Button onClick={save} disabled={pending || (enabled && weekdays.length === 0)}>
        {pending ? 'Saving' : 'Save schedule'}
      </Button>
    </div>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The soonest slot, using the same nextOccurrence the server schedules with so
 * the preview cannot disagree with what actually gets booked.
 */
function formatNextRun(
  weekdays: number[],
  hour: number,
  minute: number,
  timezone: string,
): string {
  const soonest = weekdays
    .map((weekday) => nextOccurrence(new Date(), timezone, weekday, hour, minute))
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
