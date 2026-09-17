'use client';

import { useState } from 'react';
import { Badge, Button, humanizeMachineValue, StatusMessage } from '@/bridge88/components';

/**
 * What a step actually produced, in a form a person can read.
 *
 * A node's output is stored as whatever shape the registry declares for its
 * ports, so this renders the shape rather than any one node's fields: strings
 * as text, lists as numbered rows, everything else as JSON. That way an idea
 * step's prompts and titles read well without the component knowing what an
 * idea step is, and a node added later still shows something useful.
 *
 * Raw JSON stays one click away because the readable view is a summary, and the
 * reason someone opens this is usually to check an exact value.
 */
export function WorkflowNodeOutput({ output }: { output: unknown }) {
  const [raw, setRaw] = useState(false);

  if (output == null || (typeof output === 'object' && Object.keys(output).length === 0)) {
    return <StatusMessage tone="neutral">This step recorded no output.</StatusMessage>;
  }

  const json = JSON.stringify(output, null, 2);
  const entries = isPlainObject(output) ? Object.entries(output) : null;

  return (
    <div className="mt-3 rounded-md border border-hairline bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="b88-caption">Step output</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="tertiary" onClick={() => setRaw((value) => !value)}>
            {raw ? 'Readable' : 'Raw JSON'}
          </Button>
          <CopyButton value={json} />
        </div>
      </div>

      {raw || !entries ? (
        <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-surface-soft p-3 text-xs leading-relaxed">
          {json}
        </pre>
      ) : (
        <dl className="mt-3 space-y-4">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="b88-caption">{humanizeMachineValue(key)}</dt>
              <dd className="mt-1"><OutputValue value={value} /></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function OutputValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="b88-caption">Empty</span>;
  }
  if (typeof value === 'boolean') return <Badge tone="cream">{value ? 'Yes' : 'No'}</Badge>;
  if (typeof value === 'number' || typeof value === 'string') {
    // Wrapped rather than truncated: a prompt is the thing being reviewed, and
    // a prompt you cannot read the end of is not reviewable.
    return <p className="whitespace-pre-wrap break-words text-sm">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="b88-caption">None</span>;
    return (
      <ol className="space-y-2">
        {value.map((item, index) => (
          <li key={index} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
            <span className="b88-caption pt-1">{index + 1}</span>
            <OutputValue value={item} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <pre className="overflow-auto rounded-md bg-surface-soft p-2 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="tertiary"
      onClick={() => {
        // Clipboard access can be refused outright (an insecure origin, a
        // permission policy), and a button that silently does nothing reads as
        // broken — so the label only changes once the write resolved.
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'Copied' : 'Copy JSON'}
    </Button>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
