'use client';

import { useState, useTransition } from 'react';
import { Button, Checkbox, Field, Select, StatusMessage } from '@/bridge88/components';
import { updateWorkflowAction } from '@/app/actions/workflows';
import { COMMON_TIMEZONES, WEEKDAY_SHORT } from '@/lib/scheduling/time';

/**
 * Weekly schedule, in the same weekday-plus-wall-clock shape the posting queue
 * already uses. A scheduled run needs nobody signed in — it is attributed to
 * whoever created the workflow.
 */
export function WorkflowSchedule({
  slug,
  workflow,
}: {
  slug: string;
  workflow: {
    id: string;
    scheduleEnabled: boolean;
    scheduleWeekdays: number[];
    scheduleHour: number;
    scheduleMinute: number;
    timezone: string;
  };
}) {
  const [enabled, setEnabled] = useState(workflow.scheduleEnabled);
  const [weekdays, setWeekdays] = useState<number[]>(workflow.scheduleWeekdays);
  const [hour, setHour] = useState(workflow.scheduleHour);
  const [minute, setMinute] = useState(workflow.scheduleMinute);
  const [timezone, setTimezone] = useState(workflow.timezone);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function toggleDay(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  function save() {
    setError('');
    setMessage('');
    startTransition(async () => {
      try {
        const updated = await updateWorkflowAction(slug, workflow.id, {
          scheduleEnabled: enabled,
          scheduleWeekdays: weekdays,
          scheduleHour: hour,
          scheduleMinute: minute,
          timezone,
        });
        setMessage(
          updated.nextRunAt
            ? `Saved. Next run ${new Date(updated.nextRunAt).toLocaleString()}.`
            : 'Saved. This workflow runs manually only.',
        );
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

      <div className="flex flex-wrap gap-2">
        {WEEKDAY_SHORT.map((label, day) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleDay(day)}
            disabled={!enabled}
            aria-pressed={weekdays.includes(day)}
            className="rounded-pill border border-hairline px-4 py-2 text-sm transition-opacity hover:opacity-80 disabled:opacity-35"
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

      <div className="flex flex-wrap gap-4">
        <Field
          label="Hour"
          type="number"
          min={0}
          max={23}
          value={hour}
          disabled={!enabled}
          onChange={(event) => setHour(Number(event.target.value))}
          containerClassName="w-28"
        />
        <Field
          label="Minute"
          type="number"
          min={0}
          max={59}
          value={minute}
          disabled={!enabled}
          onChange={(event) => setMinute(Number(event.target.value))}
          containerClassName="w-28"
        />
        <Select
          label="Timezone"
          value={timezone}
          disabled={!enabled}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {COMMON_TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </div>

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {message && <StatusMessage tone="success">{message}</StatusMessage>}

      <Button onClick={save} disabled={pending}>
        {pending ? 'Saving' : 'Save schedule'}
      </Button>
    </div>
  );
}
