'use client';

import { useMemo, useState, useTransition } from 'react';
import { z } from 'zod';
import { Button, Checkbox, Field, Select, StatusMessage } from '@/bridge88/components';
import { getDefinition } from '@/lib/workflows/definitions';
import { updateNodeAction } from '@/app/actions/workflows';
import type { CanvasNode } from '@/components/workflow-canvas';

interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'enum';
  options?: string[];
}

/**
 * Settings for the selected step, derived from the node's own Zod schema.
 *
 * Driving the form from the schema means a new node type needs no UI work and
 * cannot drift out of sync with what the server will accept — the same schema
 * validates the submission.
 */
export function NodeConfigPanel({
  slug,
  node,
  canEdit,
  onSaved,
  onDelete,
}: {
  slug: string;
  node: CanvasNode;
  canEdit: boolean;
  onSaved: (node: CanvasNode) => void;
  onDelete: () => void;
}) {
  const definition = getDefinition(node.type);
  const [name, setName] = useState(node.name);
  const [config, setConfig] = useState<Record<string, unknown>>(
    (node.config as Record<string, unknown>) ?? {},
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const fields = useMemo(() => (definition ? describeSchema(definition.configSchema) : []), [definition]);

  if (!definition) {
    return (
      <div className="rounded-lg border border-hairline p-6">
        <p className="b88-eyebrow">Unknown step</p>
        <p className="b88-body-sm mt-3">
          This step type is not available in this version, so it cannot be configured or run.
        </p>
      </div>
    );
  }

  function save() {
    setError('');
    setSaved(false);
    startTransition(async () => {
      try {
        const updated = await updateNodeAction(slug, node.id, { name, config });
        onSaved(updated as unknown as CanvasNode);
        setSaved(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Those settings could not be saved.');
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-hairline p-6">
      <div>
        <p className="b88-eyebrow">Step settings</p>
        <p className="b88-body-sm mt-2">{definition.description}</p>
      </div>

      <Field
        label="Name"
        value={name}
        disabled={!canEdit}
        onChange={(event) => setName(event.target.value)}
      />

      {fields.map((field) => {
        const value = config[field.key];
        if (field.kind === 'boolean') {
          return (
            <Checkbox
              key={field.key}
              label={field.label}
              checked={Boolean(value)}
              disabled={!canEdit}
              onChange={(event) => setConfig((c) => ({ ...c, [field.key]: event.target.checked }))}
            />
          );
        }
        if (field.kind === 'enum') {
          return (
            <Select
              key={field.key}
              label={field.label}
              value={String(value ?? '')}
              disabled={!canEdit}
              onChange={(event) => setConfig((c) => ({ ...c, [field.key]: event.target.value }))}
            >
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          );
        }
        return (
          <Field
            key={field.key}
            label={field.label}
            type={field.kind === 'number' ? 'number' : 'text'}
            value={value == null ? '' : String(value)}
            disabled={!canEdit}
            onChange={(event) =>
              setConfig((c) => ({
                ...c,
                [field.key]:
                  field.kind === 'number'
                    ? event.target.value === ''
                      ? null
                      : Number(event.target.value)
                    : event.target.value,
              }))
            }
          />
        );
      })}

      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {saved && <StatusMessage tone="success">Saved.</StatusMessage>}

      {canEdit && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={onDelete} disabled={pending}>
            Remove step
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Walks a Zod object schema into a flat field list.
 *
 * Only the shapes the node catalogue actually uses are handled — arrays and
 * nested objects are skipped rather than half-rendered, so a field that appears
 * is always one this panel can round-trip correctly.
 */
function describeSchema(schema: z.ZodTypeAny): FieldSpec[] {
  const object = unwrap(schema);
  if (!(object instanceof z.ZodObject)) return [];

  return Object.entries(object.shape as Record<string, z.ZodTypeAny>).flatMap<FieldSpec>(([key, raw]) => {
    const inner = unwrap(raw);
    const label = humanise(key);

    if (inner instanceof z.ZodBoolean) return [{ key, label, kind: 'boolean' }];
    if (inner instanceof z.ZodNumber) return [{ key, label, kind: 'number' }];
    if (inner instanceof z.ZodEnum) {
      return [{ key, label, kind: 'enum', options: inner.options as string[] }];
    }
    if (inner instanceof z.ZodString) return [{ key, label, kind: 'text' }];
    return [];
  });
}

/** Peels defaults, optionals, nullables and refinements off a schema. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let guard = 0; guard < 10; guard++) {
    if (current instanceof z.ZodDefault) current = current._def.innerType;
    else if (current instanceof z.ZodOptional) current = current.unwrap();
    else if (current instanceof z.ZodNullable) current = current.unwrap();
    else if (current instanceof z.ZodEffects) current = current.innerType();
    else break;
  }
  return current;
}

const humanise = (key: string) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/, 'ID')
    .trim();
