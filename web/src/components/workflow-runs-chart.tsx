'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';
import { Badge } from '@/bridge88/components';
import {
  NODE_STATUS_LABEL,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  formatElapsed,
} from '@/lib/workflows/labels';

export interface RunNodeCell {
  nodeId: string;
  status: WorkflowNodeRunStatus;
  durationMs: number | null;
}

export interface RunBar {
  id: string;
  status: WorkflowRunStatus;
  startedAt: string | null;
  durationMs: number | null;
  trigger: string;
  error: string | null;
  nodes: RunNodeCell[];
}

export interface LaneNode {
  id: string;
  name: string;
}

/**
 * Run history: a duration chart sitting on step swimlanes.
 *
 * The shape is borrowed from a CI console — bar height is how long the run took,
 * the lanes underneath say which step stopped it — because that is the pair of
 * questions someone opening this page is actually asking. The palette is the
 * design system's own: flat block colours, no hatching or gradient, and a
 * selected column takes the primary ink surface rather than a colour tint.
 *
 * Chart and lanes are laid out as the same flexible columns, so a run's bar and
 * its step squares stay in one vertical line at any width without either side
 * having to know the other's measurements.
 */

const CHART_HEIGHT = 160;
/** Height of the date rail between the bars and the lanes. */
const RAIL = 26;
const LANE_HEIGHT = 18;
const LANE_GAP = 4;
/** Even a sub-second run must be visible, or the column reads as a gap. */
const MIN_BAR = 4;

/** Columns stretch to fill, then scroll once there are too many to read. */
const COLUMN = 'min-w-[18px] max-w-[42px] flex-1 shrink-0';

/**
 * Columns a date label needs to itself.
 *
 * A label reads about 55px and a column is at most 42px, so a label printed on
 * every column overlaps its neighbour — which is exactly what four runs on
 * consecutive days produced: "15 SEPT15 SEPT15 SEPT16 SEPT". Three columns
 * clears the widest label even at the narrowest column width.
 */
const LABEL_COLUMNS = 3;

const RUN_FILL: Record<WorkflowRunStatus, string> = {
  SUCCEEDED: 'var(--block-lime)',
  FAILED: 'var(--block-coral)',
  RUNNING: 'var(--block-cream)',
  CANCELLED: 'var(--surface-soft)',
  QUEUED: 'transparent',
};

const NODE_FILL: Record<WorkflowNodeRunStatus, string> = {
  SUCCEEDED: 'var(--block-lime)',
  FAILED: 'var(--block-coral)',
  RUNNING: 'var(--block-cream)',
  SKIPPED: 'var(--surface-soft)',
  CANCELLED: 'var(--surface-soft)',
  QUEUED: 'transparent',
  PENDING: 'transparent',
};

export function WorkflowRunsChart({
  slug,
  workflowId,
  runs,
  lanes,
  timezone,
}: {
  slug: string;
  workflowId: string;
  /** Oldest first, so the chart reads left to right like a timeline. */
  runs: RunBar[];
  lanes: LaneNode[];
  timezone: string;
}) {
  const [selected, setSelected] = useState<string | null>(runs[runs.length - 1]?.id ?? null);

  const { max, ticks } = useMemo(() => scaleFor(runs.map((r) => r.durationMs ?? 0)), [runs]);

  /*
    Which columns get a date under them.

    Two rules, because a fixed stride satisfied neither. A date is only worth
    printing where the day actually changes — a stride of one on four runs from
    two days printed "15 SEPT" three times — and two labels still need room not
    to collide, which stride alone never checked.

    Chosen newest-first so the most recent run, the one the page opens on, is
    always the labelled one; dropping a label for spacing then costs an older
    date rather than today's.
  */
  const labelledColumns = useMemo(() => {
    const dayChanges: number[] = [];
    let previousDay: string | null = null;
    runs.forEach((run, index) => {
      if (!run.startedAt) return;
      const day = dayLabel(run.startedAt, timezone);
      if (day !== previousDay) dayChanges.push(index);
      previousDay = day;
    });

    const kept = new Set<number>();
    let lastKept = Number.POSITIVE_INFINITY;
    for (let i = dayChanges.length - 1; i >= 0; i -= 1) {
      if (lastKept - dayChanges[i] < LABEL_COLUMNS) continue;
      kept.add(dayChanges[i]);
      lastKept = dayChanges[i];
    }
    return kept;
  }, [runs, timezone]);

  const active = runs.find((run) => run.id === selected) ?? null;
  const lanesHeight = lanes.length * LANE_HEIGHT + Math.max(0, lanes.length - 1) * LANE_GAP;

  return (
    <section className="b88-card">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <p className="b88-eyebrow">Runs</p>
        <p className="b88-caption">
          {runs.length} {runs.length === 1 ? 'RUN' : 'RUNS'} · NEWEST RIGHT
        </p>
      </div>

      <div className="mt-6 flex gap-5">
        {/* Gutter. Every block here mirrors a block in the scroll area, so the
            two columns stay row-aligned without measuring each other. */}
        {/* Step names run long — "Generate five treehouse options" is normal —
            so the gutter is wide enough for a real one and grows with the
            viewport. At the old w-40 most names lost their first few letters. */}
        <div className="w-36 shrink-0 sm:w-48 lg:w-60">
          <div className="relative" style={{ height: CHART_HEIGHT }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="b88-caption absolute right-0 translate-y-1/2 whitespace-nowrap"
                style={{ bottom: (tick / max) * CHART_HEIGHT }}
              >
                {formatElapsed(tick)}
              </span>
            ))}
            <span className="b88-caption absolute bottom-0 right-0 translate-y-1/2">0S</span>
          </div>

          <div style={{ height: RAIL }} aria-hidden />

          <div style={{ height: lanesHeight }} className="flex flex-col" aria-hidden>
            {lanes.map((lane, index) => (
              <div
                key={lane.id}
                className="flex items-center justify-end text-xs"
                style={{ height: LANE_HEIGHT, marginTop: index === 0 ? 0 : LANE_GAP }}
                title={lane.name}
              >
                {/*
                  Truncated on the inner span, not the row. Right-aligned text
                  that overflows is clipped at its start and shows no ellipsis,
                  so a long step name silently lost its opening letters and read
                  as a different step — "Generate five treehouse options" became
                  "nerate five treehouse options". Letting the span shrink means
                  the ellipsis lands at the end, where it is legible as one.
                */}
                <span className="min-w-0 truncate">{lane.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="min-w-fit">
            {/* Bars */}
            <div className="relative" style={{ height: CHART_HEIGHT }}>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute left-0 right-0 border-t border-hairline-soft"
                  style={{ bottom: (tick / max) * CHART_HEIGHT }}
                  aria-hidden
                />
              ))}
              <span
                className="absolute bottom-0 left-0 right-0 border-t border-hairline"
                aria-hidden
              />

              <div className="absolute inset-0 flex items-end">
                {runs.map((run) => {
                  const height = run.durationMs
                    ? Math.max((run.durationMs / max) * CHART_HEIGHT, MIN_BAR)
                    : MIN_BAR;
                  const isSelected = run.id === selected;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelected(run.id)}
                      aria-pressed={isSelected}
                      title={runTitle(run, timezone)}
                      className={`${COLUMN} flex h-full items-end justify-center px-[3px] transition-opacity hover:opacity-80`}
                    >
                      <span
                        className="block w-full max-w-[16px] rounded-t-[2px]"
                        style={{
                          height,
                          // Selected is the primary surface, never a colour tint.
                          background: isSelected ? 'var(--primary)' : RUN_FILL[run.status],
                          border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--hairline)'}`,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date rail. Labels are absolutely placed so a long one is not
                clipped to its own column's width. */}
            <div className="relative flex" style={{ height: RAIL }}>
              {runs.map((run, index) => (
                <span key={run.id} className={`${COLUMN} relative`}>
                  {labelledColumns.has(index) && run.startedAt && (
                    /*
                      Anchored right once there is no room to its right, so the
                      last label grows back into the chart instead of off the
                      end of the scroll area. The newest run is always labelled
                      and is always the rightmost column, so without this the
                      most important date on the axis is the one that gets
                      clipped — "14 SEPT" rendered as "14 SE".
                    */
                    <span
                      className={`b88-caption absolute top-2 whitespace-nowrap ${
                        runs.length - index < LABEL_COLUMNS ? 'right-0' : 'left-0'
                      }`}
                    >
                      {dayLabel(run.startedAt, timezone)}
                    </span>
                  )}
                </span>
              ))}
            </div>

            {/* Step swimlanes, aligned to the bars by sharing the column rule. */}
            <div className="flex flex-col">
              {lanes.map((lane, laneIndex) => (
                <div
                  key={lane.id}
                  className="flex"
                  style={{ height: LANE_HEIGHT, marginTop: laneIndex === 0 ? 0 : LANE_GAP }}
                >
                  {runs.map((run) => {
                    const cell = run.nodes.find((node) => node.nodeId === lane.id);
                    const isSelected = run.id === selected;
                    return (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelected(run.id)}
                        title={cellTitle(lane.name, cell)}
                        className={`${COLUMN} flex items-center justify-center px-[3px] transition-opacity hover:opacity-80`}
                      >
                        <span
                          className="block rounded-[2px]"
                          style={{
                            width: LANE_HEIGHT - 4,
                            height: LANE_HEIGHT - 4,
                            background: cell ? NODE_FILL[cell.status] : 'transparent',
                            border: isSelected
                              ? '1px solid var(--ink)'
                              : `1px ${cell ? 'solid' : 'dashed'} var(--hairline)`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="b88-caption mt-3 text-right">STEPS, IN EXECUTION ORDER</p>

      {active && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-hairline-soft pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={RUN_STATUS_TONE[active.status]}>{RUN_STATUS_LABEL[active.status]}</Badge>
            <span className="b88-caption">
              {active.startedAt ? fullLabel(active.startedAt, timezone) : 'NOT STARTED'}
              {active.durationMs ? ` · ${formatElapsed(active.durationMs)}` : ''}
              {` · ${active.nodes.filter((n) => n.status === 'SUCCEEDED').length}/${active.nodes.length} STEPS`}
            </span>
          </div>
          <Link href={`/w/${slug}/workflows/${workflowId}/runs/${active.id}`} className="text-sm">
            Open this run
          </Link>
        </div>
      )}

      {active?.error && (
        <p className="b88-body-sm mt-3" role="status">
          {active.error}
        </p>
      )}
    </section>
  );
}

/**
 * An axis that ends just above the longest run, with gridlines on steps a person
 * would actually write — 15s, 1m, 5m, 30m.
 *
 * The ceiling is the data plus a little headroom, not the next round number
 * above it: rounding 6m up to 10m would push every bar into the bottom half of
 * the chart and throw away the differences the chart exists to show.
 */
function scaleFor(durations: number[]): { max: number; ticks: number[] } {
  const longest = Math.max(...durations, 1);
  const steps = [
    1_000, 5_000, 15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000,
    15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000,
  ];
  // Aim for two to four gridlines: enough to read a height off, few enough to
  // stay quiet behind the bars.
  const step =
    steps.find((candidate) => longest / candidate <= 4 && longest / candidate >= 1.5) ??
    steps.find((candidate) => longest / candidate <= 4) ??
    steps[steps.length - 1];

  const max = longest * 1.08;
  const ticks: number[] = [];
  for (let value = step; value <= max; value += step) ticks.push(value);
  return { max, ticks };
}

function runTitle(run: RunBar, timezone: string): string {
  const when = run.startedAt ? fullLabel(run.startedAt, timezone) : 'not started';
  const took = run.durationMs ? formatElapsed(run.durationMs) : 'no duration';
  return `${RUN_STATUS_LABEL[run.status]} · ${when} · ${took}`;
}

function cellTitle(laneName: string, cell: RunNodeCell | undefined): string {
  if (!cell) return `${laneName} · not part of this run`;
  const took = cell.durationMs ? ` · ${formatElapsed(cell.durationMs)}` : '';
  return `${laneName} · ${NODE_STATUS_LABEL[cell.status]}${took}`;
}

function dayLabel(iso: string, timezone: string): string {
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: timezone })
    .toUpperCase();
}

function fullLabel(iso: string, timezone: string): string {
  return new Date(iso)
    .toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    })
    .toUpperCase();
}
