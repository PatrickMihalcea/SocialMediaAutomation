'use client';

import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { CircleHelp, X } from 'lucide-react';
import { z } from 'zod';
import {
  Badge,
  Button,
  Checkbox,
  Dropdown,
  Field,
  IconButton,
  StatusMessage,
  TextArea,
  type DropdownOption,
} from '@/bridge88/components';
import {
  PUBLISH_CHANNEL_REQUIRED,
  getDefinition,
  migrateLegacyConfig,
  nodeUsesChannelPicker,
  parseConfig,
  type WorkflowAudioOption,
  type WorkflowChannelOption,
  type WorkflowMediaAssetOption,
  type WorkflowMediaFolderOption,
} from '@/lib/workflows/definitions';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import { DEFAULT_IMAGE_SIZE, IMAGE_SIZE_LABELS, imageSizeFitNote, imageSizesFor, type ImageSize } from '@/lib/ai/image-sizes';
import type { ImageProviderName } from '@/lib/ai/provider-selection';
import {
  DEFAULT_VIDEO_OUTPUT_SIZE,
  VIDEO_OUTPUT_PRESETS,
  isVideoOutputSize,
  matchVideoOutputPreset,
} from '@/lib/workflows/video-output-presets';
import { updateNodeAction } from '@/app/actions/workflows';
import type { CanvasNode } from '@/components/workflow-canvas';
import { TEXT_OVERLAY_PRESETS, WORKFLOW_FIELD_HELP } from '@/lib/workflows/help';
import {
  WorkflowCombineOrder,
  type CombineSourceId,
} from '@/components/workflow-combine-order';
import { WorkflowTrimmerEditor } from '@/components/workflow-trimmer-editor';

const CUSTOM_VIDEO_SIZE = '__custom__';
const CUSTOM_VALUE = '__custom__';

/** What the burnt-in label reads as on the first cut. */
function previewOverlay(template: string): string {
  // {choice} is retired from the picker but still lives in saved configs, and
  // it now means the same number as {index}.
  const filled = template
    .replaceAll('{index}', '1')
    .replaceAll('{choice}', '1')
    .replaceAll('{title}', 'Coastal minimal');
  return filled.trim() || 'nothing';
}

/**
 * A choice control plus its optional explanation.
 *
 * Dropdown rather than the native Select: it positions its own popup against
 * the trigger, where a native one is left to the browser and can land far from
 * the control it belongs to.
 */
function ChoiceField({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: DropdownOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Dropdown
        label={label}
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
      {hint && <p className="mt-1.5 text-sm">{hint}</p>}
    </div>
  );
}

/**
 * A named shortlist of values, with a typed-in fallback.
 *
 * Replaces a row of toggle buttons beside a raw field. The buttons put every
 * option on screen permanently, gave no single place that stated the current
 * choice, and still needed the field next to them — so the same setting was
 * editable two ways at once. A dropdown names the current value and only shows
 * the field when the user picks Custom.
 */
function PresetField({
  label,
  hint,
  presets,
  value,
  kind,
  disabled,
  preview,
  onChange,
}: {
  label: string;
  hint?: string;
  presets: Array<{ label: string; value: string | number }>;
  value: string | number | null;
  kind: 'text' | 'number';
  disabled: boolean;
  preview?: (value: string | number | null) => string;
  onChange: (value: string | number | null) => void;
}) {
  const matches = (candidate: string | number) => candidate === value;
  // Sticky: a custom value can pass through a preset's exact value while it is
  // still being typed, which would otherwise pull the field out from under the
  // cursor.
  const [custom, setCustom] = useState(() => !presets.some((preset) => matches(preset.value)));
  const selected = custom ? null : presets.find((preset) => matches(preset.value));

  return (
    <div className="space-y-3">
      <Dropdown
        label={label}
        disabled={disabled}
        value={selected ? String(selected.value) : CUSTOM_VALUE}
        options={[
          ...presets.map((preset) => ({ value: String(preset.value), label: preset.label })),
          { value: CUSTOM_VALUE, label: kind === 'number' ? 'Custom number' : 'Custom text' },
        ]}
        onChange={(chosen) => {
          if (chosen === CUSTOM_VALUE) {
            setCustom(true);
            return;
          }
          setCustom(false);
          const preset = presets.find((candidate) => String(candidate.value) === chosen);
          if (preset) onChange(preset.value);
        }}
      />
      {!selected && (
        <Field
          label={kind === 'number' ? 'Custom number' : 'Custom text'}
          type={kind === 'number' ? 'number' : 'text'}
          value={value == null ? '' : String(value)}
          disabled={disabled}
          hint={preview?.(value)}
          onChange={(event) => {
            const raw = event.target.value;
            if (kind !== 'number') return onChange(raw);
            onChange(raw === '' ? null : Number(raw));
          }}
        />
      )}
      {hint && <p className="text-sm">{hint}</p>}
    </div>
  );
}

/**
 * A list of short strings, typed one per line.
 *
 * The text being edited is held here rather than derived from the saved list:
 * pressing Enter leaves a blank line, and a control that rebuilt its value from
 * the filtered list would delete that line out from under the cursor.
 */
function LinesField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  disabled: boolean;
  onChange: (lines: string[]) => void;
}) {
  const [text, setText] = useState(() => value.join('\n'));
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <div>
      <TextArea
        label={label}
        hint={hint}
        rows={6}
        value={text}
        disabled={disabled}
        placeholder={'Interior design\nLuxury homes\nBrutalist landmarks'}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.split('\n').map((line) => line.trim()).filter(Boolean));
        }}
      />
      <p className="b88-caption mt-1.5">
        {lines.length === 0
          ? 'One per line'
          : lines.length === 1 ? '1 entry' : `${lines.length} entries`}
      </p>
    </div>
  );
}

function beatSlideshowSizeValue(config: Record<string, unknown>): string {
  if (typeof config.size === 'string' && isVideoOutputSize(config.size)) return config.size;
  if (typeof config.width === 'number' && typeof config.height === 'number') {
    return matchVideoOutputPreset(config.width, config.height) ?? CUSTOM_VIDEO_SIZE;
  }
  return DEFAULT_VIDEO_OUTPUT_SIZE;
}

function beatSlideshowSizeOptions(config: Record<string, unknown>): Array<{ id: string; label: string }> {
  const options = VIDEO_OUTPUT_PRESETS.map((preset) => ({ id: preset.id, label: preset.label }));
  if (beatSlideshowSizeValue(config) !== CUSTOM_VIDEO_SIZE) return options;
  if (typeof config.width !== 'number' || typeof config.height !== 'number') return options;
  return [
    ...options,
    { id: CUSTOM_VIDEO_SIZE, label: `${config.width}×${config.height} (saved size)` },
  ];
}

/** An edge arriving at one of this step's inputs. */
export interface NodeInputConnection {
  /** The input port, which is also the settings key the connection stands in for. */
  portId: string;
  edgeId: string;
  /** Where the value comes from, e.g. "Idea generator · Post title". */
  sourceLabel: string;
}

/**
 * A setting whose value arrives on a connection.
 *
 * The control stays editable: typing is how someone takes the value back, and
 * the frame says what that costs before they save rather than after.
 */
function ConnectedSetting({
  connection,
  overridden,
  ignoredText,
  children,
}: {
  connection: NodeInputConnection;
  overridden: boolean;
  /** Text left in the control that the connection is currently talking over. */
  ignoredText: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-md p-3"
      style={{ border: `1px solid ${overridden ? 'var(--ink)' : 'var(--hairline)'}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={overridden ? 'coral' : 'mint'}>
          {overridden ? 'Replacing connection' : 'Connected'}
        </Badge>
        <span className="b88-caption">{connection.sourceLabel}</span>
      </div>
      <div className="mt-3">{children}</div>
      <p className="b88-body-sm mt-2">
        {overridden
          ? `Saving disconnects ${connection.sourceLabel} and sends what you typed instead.`
          : ignoredText
            ? 'Each run fills this in, so the text above is not used. Edit it to go back to a fixed value.'
            : 'Each run fills this in. Type here to use a fixed value instead.'}
      </p>
    </div>
  );
}

interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'enum' | 'namedOutputs' | 'lines';
  options?: string[];
  optionLabels?: Record<string, string>;
  description?: string;
  presets?: Array<{ label: string; value: string | number }>;
  multiline?: boolean;
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
  accounts,
  audioAssets,
  mediaAssets,
  mediaFolders,
  connections,
  canEdit,
  onSaved,
  onDisconnect,
  onDelete,
}: {
  slug: string;
  node: CanvasNode;
  accounts: WorkflowChannelOption[];
  audioAssets: WorkflowAudioOption[];
  mediaAssets: WorkflowMediaAssetOption[];
  mediaFolders: WorkflowMediaFolderOption[];
  connections: NodeInputConnection[];
  canEdit: boolean;
  onSaved: (node: CanvasNode) => void;
  onDisconnect: (edgeId: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const definition = getDefinition(node.type);
  const [name, setName] = useState(node.name);
  const [config, setConfig] = useState<Record<string, unknown>>(() =>
    normalizeNodeConfig(node.type, node.config),
  );
  /** What the settings held when the panel opened, to spot a deliberate override. */
  const [openedWith] = useState<Record<string, unknown>>(() =>
    normalizeNodeConfig(node.type, node.config),
  );
  const [error, setError] = useState('');
  /** The settings as they were when the save succeeded, or null before one. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  /** What was stored when the panel opened, so an untouched panel saves nothing. */
  const [openedSnapshot] = useState(() => snapshotOf(node.name, normalizeNodeConfig(node.type, node.config)));
  const [showHelp, setShowHelp] = useState(false);
  const [pending, startTransition] = useTransition();

  const fields = useMemo(() => {
    if (!definition) return [];
    const help = WORKFLOW_FIELD_HELP[node.type as keyof typeof WORKFLOW_FIELD_HELP] ?? {};
    const specs = describeSchema(definition.configSchema).map((field) => {
      const metadata = help[field.key as keyof typeof help];
      return metadata
        ? {
            ...field,
            label: metadata.label,
            description: metadata.description,
            multiline: metadata.multiline,
            optionLabels: metadata.optionLabels,
            presets: metadata.presets,
          }
        : field;
    });

    // Both size pickers are dimension enums the user should not have to decode;
    // only the beat slideshow carries the legacy width/height pair.
    if (node.type === 'BEAT_SLIDESHOW') {
      return specs
        .filter((field) => field.key !== 'width' && field.key !== 'height')
        .map((field) =>
          field.key === 'size'
            ? {
                ...field,
                label: help.size?.label ?? 'Video format',
                description: help.size?.description,
                optionLabels: Object.fromEntries(
                  VIDEO_OUTPUT_PRESETS.map((preset) => [preset.id, preset.label]),
                ),
              }
            : field,
        );
    }

    if (node.type === 'IMAGE_GENERATOR') {
      // 9:16 exists only on the subscription backend, so offering it while this
      // step is pinned to the API would save a config the provider then refuses.
      const chosen = (typeof config.provider === 'string' ? config.provider : 'image-use') as ImageProviderName;
      const sizes = imageSizesFor(chosen);
      return specs
        // Replaced by `provider`, and showing both would put two answers to the
        // same question on screen. Still in the schema so old steps keep theirs.
        .filter((field) => field.key !== 'useMockGeneration')
        .map((field): FieldSpec =>
          field.key === 'size'
            ? {
                ...field,
                label: help.size?.label ?? 'Image format',
                description: help.size?.description,
                options: sizes,
                optionLabels: IMAGE_SIZE_LABELS,
              }
            : field,
        );
    }

    return specs;
  }, [definition, node.type, config.provider]);

  /**
   * Saves by itself, shortly after typing stops.
   *
   * A Save button on a settings panel is a trap: the panel closes when another
   * step is clicked, and everything typed into it goes with it. The delay is
   * long enough that a sentence being typed is one request rather than forty,
   * and short enough that clicking away lands after it.
   *
   * Keyed on the snapshot, so it fires once per distinct state and an edit made
   * while a save is in flight is picked up on the next pass instead of racing.
   */
  const currentSnapshot = snapshotOf(name, config);
  useEffect(() => {
    if (!canEdit || pending) return;
    if (savedSnapshot === null ? currentSnapshot === openedSnapshot : currentSnapshot === savedSnapshot) return;
    const timer = window.setTimeout(() => save(), 700);
    return () => window.clearTimeout(timer);
    // save() closes over the current form state by design; re-running it on a
    // later render is exactly what picks up an edit made mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, canEdit, pending, savedSnapshot, openedSnapshot]);

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

  const selectedChannelIds = Array.isArray(config.socialAccountIds)
    ? (config.socialAccountIds as string[])
    : [];
  const additionalOutputs = Array.isArray(config.additionalOutputs)
    ? config.additionalOutputs.filter((field): field is { id: string; label: string } =>
      Boolean(field) && typeof field === 'object' && typeof (field as { id?: unknown }).id === 'string' && typeof (field as { label?: unknown }).label === 'string')
    : [];
  function toggleChannel(accountId: string, checked: boolean) {
    setConfig((current) => {
      const ids = Array.isArray(current.socialAccountIds)
        ? [...(current.socialAccountIds as string[])]
        : [];
      const next = checked ? [...ids, accountId] : ids.filter((id) => id !== accountId);
      return { ...current, socialAccountIds: next };
    });
  }

  /**
   * Connections the user has just typed over.
   *
   * A value already sitting in a connected setting is not an override — it is
   * the text the connection took over from, and dropping the edge for it would
   * undo a wiring nobody touched. Only a change made in this panel counts.
   */
  const overriddenConnections = connections.filter((connection) => {
    const typed = config[connection.portId];
    return typeof typed === 'string' && typed.trim() !== '' && typed !== openedWith[connection.portId];
  });

  function save() {
    setError('');

    const snapshot = snapshotOf(name, config);
    const payload = normalizeNodeConfig(node.type, config);
    const channelIds = Array.isArray(payload.socialAccountIds)
      ? (payload.socialAccountIds as string[])
      : [];
    if (node.type === 'PUBLISH' && channelIds.length === 0) {
      setError(PUBLISH_CHANNEL_REQUIRED);
      return;
    }

    startTransition(async () => {
      try {
        // The connection wins at run time, so a typed value only takes effect
        // once its edge is gone. Dropped first: a save that left both in place
        // would show the typed text in the panel and keep running the wire.
        for (const connection of overriddenConnections) {
          if (!(await onDisconnect(connection.edgeId))) {
            setError(`The connection from ${connection.sourceLabel} could not be removed.`);
            return;
          }
        }
        const updated = await updateNodeAction(slug, node.id, { name, config: payload });
        onSaved(updated as unknown as CanvasNode);
        setSavedSnapshot(snapshot);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Those settings could not be saved.');
      }
    });
  }

  /**
   * Which settings this node is actually showing right now.
   *
   * Two of the nodes swap a control in and out with their own mode, so this
   * depends on the node's current config rather than on its type alone.
   */
  const shownFields = fields.filter((field) => {
    if (node.type === 'AUDIO_TRIMMER') return false;
    if (node.type === 'MUSIC_SELECTOR') {
      if (field.key === 'mediaAssetId') return config.mode === 'specific';
      if (field.key === 'folderId') return config.mode !== 'specific';
    }
    if (node.type === 'MEDIA_LIBRARY') {
      if (field.key === 'assetId') return false;
      if (field.key === 'includeSubfolders') return typeof config.assetId !== 'string';
    }
    if (node.type === 'PICK' && field.key === 'index') return config.mode === 'index';
    // One theme or a pool, never both on screen: showing the unused one invites
    // someone to fill in a setting this step will not read.
    if (node.type === 'IDEA_GENERATOR') {
      if (field.key === 'theme') return config.themeMode !== 'random';
      if (field.key === 'themePool') return config.themeMode === 'random';
    }
    return true;
  });
  /** One settings control, chosen by the field's shape and its node type. */
  function renderField(field: FieldSpec) {
    const value = config[field.key];

    if (node.type === 'MUSIC_SELECTOR' && field.key === 'mediaAssetId') {
      return (
        <ChoiceField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          value={String(value ?? '')}
          disabled={!canEdit}
          options={[
            { value: '', label: 'Choose a track' },
            ...audioAssets.map((asset) => ({
              value: asset.id,
              label: [
                asset.filename,
                asset.bpm ? `${Math.round(asset.bpm)} BPM` : null,
                asset.hasBeatGrid ? 'beats ready' : null,
              ].filter(Boolean).join(' · '),
            })),
          ]}
          onChange={(chosen) =>
            setConfig((current) => ({ ...current, mediaAssetId: chosen || null }))
          }
        />
      );
    }
    if (node.type === 'MUSIC_SELECTOR' && field.key === 'folderId') {
      return (
        <ChoiceField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          value={String(value ?? '')}
          disabled={!canEdit}
          options={[
            { value: '', label: 'Entire music library' },
            ...mediaFolders.map((folder) => ({ value: folder.id, label: folder.name })),
          ]}
          onChange={(chosen) =>
            setConfig((current) => ({ ...current, folderId: chosen || null }))
          }
        />
      );
    }
    if (node.type === 'MEDIA_LIBRARY' && field.key === 'folderId') {
      const selectedAssetId =
        typeof config.assetId === 'string' ? config.assetId : null;
      const selectedFolderId =
        typeof config.folderId === 'string' ? config.folderId : null;
      return (
        <ChoiceField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          value={
            selectedAssetId
              ? `asset:${selectedAssetId}`
              : selectedFolderId
                ? `folder:${selectedFolderId}`
                : ''
          }
          disabled={!canEdit}
          options={[
            { value: '', label: 'Entire media library' },
            ...mediaFolders.map((folder) => ({
              value: `folder:${folder.id}`,
              label: `Folder · ${folder.name}`,
            })),
            ...mediaAssets.map((asset) => ({
              value: `asset:${asset.id}`,
              label: `${mediaTypeLabel(asset.type)} · ${asset.filename}`,
            })),
          ]}
          onChange={(chosen) => setConfig((current) => ({
            ...current,
            folderId: chosen.startsWith('folder:') ? chosen.slice(7) : null,
            assetId: chosen.startsWith('asset:') ? chosen.slice(6) : null,
          }))}
        />
      );
    }
    // A list-valued setting, so it gets a list editor rather than an input.
    // It sits in schema order with the other settings: as its own section
    // under the form it read as an unrelated panel bolted to the bottom.
    if (field.kind === 'namedOutputs') {
      return (
        <div key={field.key}>
          <p className="b88-label">{field.label}</p>
          {showHelp && field.description && (
            <p className="b88-body-sm mt-1.5">{field.description}</p>
          )}
          {additionalOutputs.map((output, index) => (
            <div
              key={`${output.id}-${index}`}
              className="mt-2 flex items-center gap-2"
            >
              <Field
                label={`Extra output ${index + 1} name`}
                labelHidden
                containerClassName="flex-1"
                value={output.label}
                disabled={!canEdit}
                onChange={(event) => setConfig((current) => ({
                  ...current,
                  additionalOutputs: additionalOutputs.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, label: event.target.value } : item),
                }))}
              />
              <IconButton
                icon={X}
                label={`Remove ${output.label || `output ${index + 1}`}`}
                disabled={!canEdit}
                onClick={() => setConfig((current) => ({
                  ...current,
                  additionalOutputs: additionalOutputs.filter((_, i) => i !== index),
                }))}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={!canEdit || additionalOutputs.length >= 10}
            onClick={() => setConfig((current) => ({
              ...current,
              additionalOutputs: [
                ...additionalOutputs,
                { id: nextOutputId(additionalOutputs), label: 'New output' },
              ],
            }))}
          >
            Add an output
          </Button>
        </div>
      );
    }
    if (node.type === 'TEXT_OVERLAY' && field.key === 'template') {
      return (
        <PresetField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          presets={TEXT_OVERLAY_PRESETS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={String(value ?? '')}
          kind="text"
          disabled={!canEdit}
          // The only setting whose effect is not obvious from its value.
          preview={(current) => `Shows ${previewOverlay(String(current ?? ''))}`}
          onChange={(next) => setConfig((current) => ({ ...current, template: next ?? '' }))}
        />
      );
    }
    if (field.kind === 'boolean') {
      return (
        <div key={field.key}>
          <Checkbox
            label={field.label}
            checked={Boolean(value)}
            disabled={!canEdit}
            onChange={(event) => setConfig((c) => ({ ...c, [field.key]: event.target.checked }))}
          />
          {showHelp && field.description && (
            <p className="ml-8 mt-1 text-sm">{field.description}</p>
          )}
        </div>
      );
    }
    if (field.kind === 'enum') {
      const isBeatSize = node.type === 'BEAT_SLIDESHOW' && field.key === 'size';
      const sizeOptions = isBeatSize ? beatSlideshowSizeOptions(config) : null;
      const enumValue = isBeatSize
        ? beatSlideshowSizeValue(config)
        : String(value ?? '');

      const fitNote = showHelp && node.type === 'IMAGE_GENERATOR' && field.key === 'size'
        ? imageSizeFitNote(enumValue)
        : null;

      return (
        <ChoiceField
          key={field.key}
          label={field.label}
          hint={[fitNote, showHelp ? field.description : null].filter(Boolean).join(' ') || undefined}
          value={enumValue}
          disabled={!canEdit}
          options={(sizeOptions ?? (field.options ?? []).map((option) => ({
            id: option,
            label: field.optionLabels?.[option] ?? option,
          }))).map((option) => ({ value: option.id, label: option.label }))}
          onChange={(chosen) =>
            setConfig((c) => {
              const next = { ...c };
              if (isBeatSize) {
                if (chosen === CUSTOM_VIDEO_SIZE) return c;
                next.size = chosen;
                delete next.width;
                delete next.height;
                return next;
              }
              next[field.key] = chosen;
              // An explicit choice retires the flag it replaced; leaving it set
              // would let a step display "API" and quietly render a placeholder.
              if (node.type === 'IMAGE_GENERATOR' && field.key === 'provider') {
                next.useMockGeneration = false;
              }
              // Switching an image step away from Codex takes 9:16 with it.
              // Leaving the stale value would save a shape the chosen provider
              // refuses, and the step would fail at run time instead of here.
              if (node.type === 'IMAGE_GENERATOR' && field.key === 'provider') {
                const allowed = imageSizesFor(chosen as ImageProviderName);
                if (typeof next.size === 'string' && !allowed.includes(next.size as ImageSize)) {
                  next.size = DEFAULT_IMAGE_SIZE;
                }
              }
              return next;
            })
          }
        />
      );
    }
    if (field.presets?.length) {
      return (
        <PresetField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          presets={field.presets}
          value={value as string | number | null}
          kind={field.kind === 'number' ? 'number' : 'text'}
          disabled={!canEdit}
          onChange={(next) => setConfig((c) => ({ ...c, [field.key]: next }))}
        />
      );
    }
    if (field.kind === 'lines') {
      return (
        <LinesField
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          value={Array.isArray(value) ? (value as unknown[]).filter((line): line is string => typeof line === 'string') : []}
          disabled={!canEdit}
          onChange={(lines) => setConfig((c) => ({ ...c, [field.key]: lines }))}
        />
      );
    }
    if (field.multiline) {
      return (
        <TextArea
          key={field.key}
          label={field.label}
          hint={showHelp ? field.description : undefined}
          rows={3}
          value={value == null ? '' : String(value)}
          disabled={!canEdit}
          onChange={(event) => setConfig((c) => ({ ...c, [field.key]: event.target.value }))}
        />
      );
    }
    return (
      <Field
        key={field.key}
        label={field.label}
        hint={showHelp ? field.description : undefined}
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
  }

  return (
    <div className="space-y-4 rounded-lg border border-hairline p-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="b88-eyebrow">Step settings</p>
          {/* One switch for every explanation in the panel. Off by default, so
              the settings read as controls rather than documentation. */}
          <IconButton
            icon={CircleHelp}
            label={showHelp ? 'Hide setting explanations' : 'Explain these settings'}
            aria-pressed={showHelp}
            className={showHelp ? 'shadow-[inset_0_0_0_1px_var(--ink)]' : ''}
            onClick={() => setShowHelp((current) => !current)}
          />
        </div>
        {showHelp && (
          <div className="mt-3 rounded-md bg-[var(--surface-soft)] p-4">
            <p className="b88-body-sm">{definition.description}</p>
            <Link
              className="b88-body-sm mt-2 inline-block"
              href={`/w/${slug}/workflows/guide#${node.type.toLowerCase().replaceAll('_', '-')}`}
            >
              Open the full guide
            </Link>
          </div>
        )}
      </div>

      <Field
        label="Name"
        value={name}
        disabled={!canEdit}
        onChange={(event) => setName(event.target.value)}
      />

      {node.type === 'COMBINE_MEDIA' && (
        <WorkflowCombineOrder
          value={combineSourceOrder(config.sourceOrder)}
          disabled={!canEdit}
          onChange={(sourceOrder) => setConfig((current) => ({ ...current, sourceOrder }))}
        />
      )}

      {node.type === 'AUDIO_TRIMMER' && (
        <WorkflowTrimmerEditor
          slug={slug}
          nodeId={node.id}
          disabled={!canEdit}
          value={{
            mode: config.mode === 'bars' ? 'bars' : 'range',
            startSeconds: typeof config.startSeconds === 'number' ? config.startSeconds : null,
            endSeconds: typeof config.endSeconds === 'number' ? config.endSeconds : null,
            bars: typeof config.bars === 'number' ? config.bars : 8,
            snapToDownbeat: config.snapToDownbeat !== false,
          }}
          onChange={(next) => setConfig((current) => ({ ...current, ...next }))}
        />
      )}

      {shownFields.map((field) => {
        const connection = connections.find((item) => item.portId === field.key);
        const control = renderField(field);
        if (!connection) return <div key={field.key}>{control}</div>;
        return (
          <ConnectedSetting
            key={field.key}
            connection={connection}
            overridden={overriddenConnections.includes(connection)}
            ignoredText={typeof config[field.key] === 'string' && config[field.key] !== ''}
          >
            {control}
          </ConnectedSetting>
        );
      })}


      {nodeUsesChannelPicker(node.type) && (
        <div>
          <p className="b88-label">Publishing channels</p>
          {/* Publish cannot save without one, so that stays visible. What an
              empty Create draft selection means is an explanation. */}
          {node.type === 'CREATE_DRAFT'
            ? showHelp && <p className="b88-caption mt-2">Unchecked uses every channel</p>
            : <p className="b88-caption mt-2">Pick at least one</p>}
          {accounts.length === 0 ? (
            <StatusMessage tone="error" className="mt-3">
              No active channels are connected to this workspace. Connect a channel before
              configuring this step.
            </StatusMessage>
          ) : (
            <div className="mt-3 grid gap-y-0.5">
              {accounts.map((account) => {
                const handle = account.accountHandle ?? account.accountName;
                const platformLabel =
                  PLATFORM_LABELS[account.platform as keyof typeof PLATFORM_LABELS] ?? account.platform;
                return (
                  <Checkbox
                    key={account.id}
                    label={`${platformLabel} · ${handle}`}
                    checked={selectedChannelIds.includes(account.id)}
                    disabled={!canEdit}
                    onChange={(event) => toggleChannel(account.id, event.target.checked)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <StatusMessage tone="error">{error}</StatusMessage>}

      {canEdit && (
        <div className="flex flex-wrap gap-3">
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
    // The one list-valued setting with an editor of its own. It has to come
    // through here rather than be appended by the renderer, or it loses its
    // place among the other settings and reads as a panel bolted to the bottom.
    if (inner instanceof z.ZodArray && key === 'additionalOutputs') {
      return [{ key, label, kind: 'namedOutputs' }];
    }
    // A list of plain strings, edited as one per line. Its own control rather
    // than the named-output editor: these have no id and no label, and a row of
    // single-line fields would make pasting twenty topics a twenty-click job.
    if (inner instanceof z.ZodArray && unwrap(inner.element as z.ZodTypeAny) instanceof z.ZodString) {
      return [{ key, label, kind: 'lines' }];
    }
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

function normalizeNodeConfig(type: string, raw: unknown): Record<string, unknown> {
  if (type === 'BEAT_SLIDESHOW' || type === 'AUDIO_TRIMMER' || nodeUsesChannelPicker(type)) {
    return parseConfig(type, raw) as Record<string, unknown>;
  }
  const config = (migrateLegacyConfig(type, raw) as Record<string, unknown>) ?? {};
  // A step saved before `provider` existed has only the old boolean. Deriving
  // the value here means the panel shows what the step will actually do, rather
  // than an empty dropdown over a step that still mocks.
  if (type === 'IMAGE_GENERATOR' && typeof config.provider !== 'string') {
    return { ...config, provider: config.useMockGeneration === true ? 'mock' : 'image-use' };
  }
  return config;
}

function combineSourceOrder(value: unknown): CombineSourceId[] {
  const valid: CombineSourceId[] = ['media1', 'media2', 'media3', 'media4'];
  if (!Array.isArray(value)) return valid;
  const selected = value.filter(
    (item): item is CombineSourceId =>
      typeof item === 'string' && valid.includes(item as CombineSourceId),
  );
  return selected.length === valid.length && new Set(selected).size === valid.length
    ? selected
    : valid;
}

function mediaTypeLabel(type: WorkflowMediaAssetOption['type']): string {
  if (type === 'IMAGE') return 'Image';
  if (type === 'VIDEO') return 'Video';
  return 'Audio';
}

function nextOutputId(outputs: { id: string }[]): string {
  const used = new Set(outputs.map((output) => output.id));
  for (let number = 1; number <= 10; number++) {
    const candidate = `additionalOutput${number}`;
    if (!used.has(candidate)) return candidate;
  }
  return `additionalOutput${outputs.length + 1}`;
}

/** Key order is not meaningful here, so it must not decide whether a form is dirty. */
function snapshotOf(name: string, config: Record<string, unknown>): string {
  const entries = Object.keys(config).sort().map((key) => [key, config[key]]);
  return JSON.stringify([name, entries]);
}
