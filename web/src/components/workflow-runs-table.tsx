import Link from 'next/link';
import type { WorkflowRunStatus } from '@prisma/client';
import { Badge } from '@/bridge88/components';
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, formatElapsed } from '@/lib/workflows/labels';

export interface RunRow {
  id: string;
  status: WorkflowRunStatus;
  startedAt: Date | null;
  durationMs: number | null;
  trigger: string;
  error: string | null;
  stepsTotal: number;
  stepsDone: number;
}

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manually',
  SCHEDULE: 'Schedule',
  API: 'API',
};

/**
 * The run log under the chart. Columns answer the questions in the order they
 * get asked: when, how it was started, how long it took, how far it got, and
 * what stopped it.
 */
export function WorkflowRunsTable({
  slug,
  workflowId,
  runs,
  timezone,
}: {
  slug: string;
  workflowId: string;
  runs: RunRow[];
  timezone: string;
}) {
  return (
    <section className="b88-card mt-6">
      <p className="b88-eyebrow">Run history</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left">
              {['Start time', 'Run', 'Launched', 'Duration', 'Steps', 'Status', 'Error'].map(
                (heading) => (
                  <th key={heading} className="b88-caption py-3 pr-4 font-normal">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-hairline-soft align-top">
                <td className="py-3 pr-4 whitespace-nowrap">
                  <Link href={`/w/${slug}/workflows/${workflowId}/runs/${run.id}`}>
                    {run.startedAt
                      ? run.startedAt.toLocaleString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: timezone,
                        })
                      : 'Not started'}
                  </Link>
                </td>
                <td className="py-3 pr-4 font-mono text-xs">{run.id.slice(0, 8)}</td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {TRIGGER_LABEL[run.trigger] ?? run.trigger}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {run.durationMs ? formatElapsed(run.durationMs) : '—'}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {run.stepsDone}/{run.stepsTotal}
                </td>
                <td className="py-3 pr-4">
                  <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
                </td>
                <td className="max-w-xs py-3 pr-4">
                  {run.error ? <span className="b88-body-sm">{run.error}</span> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
