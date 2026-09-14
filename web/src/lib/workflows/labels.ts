import type { WorkflowNodeRunStatus, WorkflowRunStatus } from '@prisma/client';

/**
 * Status wording and tones, in one place so the list, the canvas and the run
 * view cannot drift. Tones follow the design system's state mapping: lime for
 * done, cream for in progress, outline for not started.
 */
type Tone = 'neutral' | 'ink' | 'lime' | 'lilac' | 'cream' | 'mint' | 'coral' | 'outline';

export const RUN_STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const RUN_STATUS_TONE: Record<WorkflowRunStatus, Tone> = {
  QUEUED: 'outline',
  RUNNING: 'cream',
  SUCCEEDED: 'lime',
  FAILED: 'coral',
  CANCELLED: 'neutral',
};

export const NODE_STATUS_LABEL: Record<WorkflowNodeRunStatus, string> = {
  PENDING: 'Waiting',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
};

export const NODE_STATUS_TONE: Record<WorkflowNodeRunStatus, Tone> = {
  PENDING: 'outline',
  QUEUED: 'outline',
  RUNNING: 'cream',
  SUCCEEDED: 'lime',
  FAILED: 'coral',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
};

const TERMINAL: WorkflowNodeRunStatus[] = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'];
export const isNodeTerminal = (status: WorkflowNodeRunStatus) => TERMINAL.includes(status);
export const isRunTerminal = (status: WorkflowRunStatus) =>
  status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';

/** "1m 42s" — the shape a Databricks-style timer column wants. */
export function formatElapsed(ms: number): string {
  if (ms < 0) return '0s';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
