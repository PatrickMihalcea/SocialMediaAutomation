'use client';

import { Button } from '@/bridge88/components';
import { findPort } from '@/lib/workflows/definitions';
import type { ConnectionDescription } from '@/lib/workflows/connection-label';
import type { CanvasEdge } from '@/components/workflow-canvas';

/**
 * Settings for the selected connection — source/target labels and removal.
 *
 * Mirrors the step settings rail so keyboard and touch users have a visible
 * delete affordance that does not depend on right-click or Backspace alone.
 */
export function ConnectionConfigPanel({
  edge,
  description,
  canEdit,
  pending,
  onDelete,
}: {
  edge: CanvasEdge;
  description: ConnectionDescription;
  canEdit: boolean;
  pending: boolean;
  onDelete: () => void;
}) {
  const sourcePort =
    findPort(description.source.nodeType, description.source.portId, 'outputs')?.label ??
    description.source.portId;
  const targetPort =
    findPort(description.target.nodeType, description.target.portId, 'inputs')?.label ??
    description.target.portId;

  return (
    <div className="space-y-4 rounded-lg border border-hairline p-6">
      <div>
        <p className="b88-eyebrow">Connection</p>
        <p className="b88-body-sm mt-2">{description.title}</p>
      </div>

      <dl className="space-y-3 text-sm">
        <ConnectionDetail label="From" step={description.source.nodeName} port={sourcePort} />
        <ConnectionDetail label="To" step={description.target.nodeName} port={targetPort} />
        <div className="flex items-baseline justify-between gap-4 border-b border-hairline-soft pb-3">
          <dt className="b88-caption">ID</dt>
          <dd className="font-mono text-xs">{edge.id.slice(0, 8)}</dd>
        </div>
      </dl>

      {canEdit && (
        <Button variant="secondary" onClick={onDelete} disabled={pending}>
          {pending ? 'Removing' : 'Remove connection'}
        </Button>
      )}
    </div>
  );
}

function ConnectionDetail({
  label,
  step,
  port,
}: {
  label: string;
  step: string;
  port: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline-soft pb-3">
      <dt className="b88-caption">{label}</dt>
      <dd className="text-right">
        <span className="font-medium">{step}</span>
        <span className="b88-caption block">{port}</span>
      </dd>
    </div>
  );
}
