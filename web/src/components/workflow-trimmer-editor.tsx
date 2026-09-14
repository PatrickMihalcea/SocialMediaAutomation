'use client';

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Button, Checkbox, Dropdown, Field, StatusMessage, VideoPlayer } from '@/bridge88/components';
import { getWorkflowTrimPreviewAction, type WorkflowTrimPreview } from '@/app/actions/workflows';
import { humanizeMachineValue } from '@/bridge88/humanize';

type TrimConfig = {
  mode: 'range' | 'bars';
  startSeconds: number | null;
  endSeconds: number | null;
  bars: number;
  snapToDownbeat: boolean;
};

export function WorkflowTrimmerEditor({
  slug,
  nodeId,
  value,
  disabled,
  onChange,
}: {
  slug: string;
  nodeId: string;
  value: TrimConfig;
  disabled: boolean;
  onChange: (value: TrimConfig) => void;
}) {
  const [preview, setPreview] = useState<WorkflowTrimPreview | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  const duration = preview?.state === 'ready' ? preview.asset.duration : 0;
  const start = Math.min(value.startSeconds ?? 0, duration || Infinity);
  const end = Math.min(value.endSeconds ?? duration, duration || Infinity);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  useEffect(() => {
    let active = true;
    void getWorkflowTrimPreviewAction(slug, nodeId)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) {
          setPreview({
            state: 'unavailable',
            reason: error instanceof Error ? error.message : 'Preview could not load.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [slug, nodeId]);

  useEffect(() => {
    if (preview?.state !== 'ready' || preview.asset.type !== 'AUDIO' || !waveformRef.current) return;
    const regions = RegionsPlugin.create();
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      url: preview.asset.url,
      height: 72,
      waveColor: '#b8b8b3',
      progressColor: '#000000',
      cursorColor: '#ff3d8b',
      plugins: [regions],
    });
    waveRef.current = wave;
    const unReady = wave.on('ready', () => {
      const region = regions.addRegion({
        start,
        end: end || preview.asset.duration,
        color: 'rgba(0, 0, 0, 0.12)',
        drag: true,
        resize: true,
        minLength: 0.1,
      });
      regionRef.current = region;
    });
    const unTime = wave.on('timeupdate', setCurrentTime);
    const unRegion = regions.on('region-updated', (region) => {
      onChangeRef.current({
        ...valueRef.current,
        startSeconds: roundTime(region.start),
        endSeconds: roundTime(region.end),
      });
    });
    return () => {
      unReady();
      unTime();
      unRegion();
      wave.destroy();
      waveRef.current = null;
      regionRef.current = null;
    };
    // Config changes update the existing region below; rebuilding the waveform
    // on every drag would interrupt playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.state === 'ready' ? preview.asset.id : null]);

  useEffect(() => {
    regionRef.current?.setOptions({ start, end: end || duration });
  }, [start, end, duration]);

  function setRange(nextStart: number, nextEnd: number) {
    if (!duration) return;
    const safeStart = Math.max(0, Math.min(nextStart, duration - 0.1));
    const safeEnd = Math.max(safeStart + 0.1, Math.min(nextEnd, duration));
    onChange({
      ...value,
      startSeconds: roundTime(safeStart),
      endSeconds: roundTime(safeEnd),
    });
  }

  function previewSelection() {
    if (preview?.state !== 'ready') return;
    if (preview.asset.type === 'AUDIO') {
      regionRef.current?.play(true);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = start;
    void video.play();
  }

  return (
    <section className="space-y-4 border-t border-hairline-soft pt-4">
      <Dropdown
        label="Trim mode"
        value={value.mode}
        disabled={disabled}
        options={[
          { value: 'range', label: 'Time range' },
          { value: 'bars', label: 'Musical bars' },
        ]}
        onChange={(mode) => onChange({ ...value, mode: mode as TrimConfig['mode'] })}
      />

      {preview == null ? (
        <p className="b88-caption">Loading preview</p>
      ) : preview.state === 'unavailable' ? (
        <StatusMessage tone="neutral">{preview.reason}</StatusMessage>
      ) : (
        <div>
          <p className="b88-caption">{humanizeMachineValue(preview.asset.filename)}</p>
          {preview.asset.type === 'VIDEO' ? (
            <VideoPlayer
              src={preview.asset.url}
              poster={preview.asset.posterUrl ?? undefined}
              ratio="16:9"
              videoRef={videoRef}
              videoProps={{
                onTimeUpdate: (event) => {
                  const time = event.currentTarget.currentTime;
                  setCurrentTime(time);
                  if (time >= end) event.currentTarget.currentTime = start;
                },
              }}
            />
          ) : (
            <div
              ref={waveformRef}
              className="mt-2 overflow-hidden rounded-md border border-hairline p-2"
              aria-label="Audio waveform"
            />
          )}
        </div>
      )}

      {value.mode === 'range' ? (
        <div className="space-y-4">
          {duration > 0 && (
            <div className="rounded-md bg-surface-soft p-3">
              <label className="b88-caption block" htmlFor={`${nodeId}-trim-start`}>
                Start · {formatTime(start)}
              </label>
              <input
                id={`${nodeId}-trim-start`}
                className="mt-2 w-full accent-black"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={start}
                disabled={disabled}
                onChange={(event) => setRange(Number(event.target.value), end)}
              />
              <label className="b88-caption mt-3 block" htmlFor={`${nodeId}-trim-end`}>
                End · {formatTime(end)}
              </label>
              <input
                id={`${nodeId}-trim-end`}
                className="mt-2 w-full accent-black"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={end}
                disabled={disabled}
                onChange={(event) => setRange(start, Number(event.target.value))}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Start"
              type="number"
              min={0}
              max={duration || undefined}
              step={0.01}
              value={value.startSeconds ?? 0}
              disabled={disabled}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (duration) setRange(next, end);
                else onChange({ ...value, startSeconds: next });
              }}
            />
            <Field
              label="End"
              type="number"
              min={0}
              max={duration || undefined}
              step={0.01}
              value={value.endSeconds ?? (duration || '')}
              placeholder="End of media"
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value === '' ? null : Number(event.target.value);
                if (duration && next != null) setRange(start, next);
                else onChange({ ...value, endSeconds: next });
              }}
            />
          </div>
          {duration > 0 && (
            <>
              <p className="b88-caption">
                Selection {formatTime(end - start)} · Playhead {formatTime(currentTime)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={previewSelection}>Preview selection</Button>
                <Button variant="tertiary" disabled={disabled} onClick={() => setRange(currentTime, end)}>
                  Set in
                </Button>
                <Button variant="tertiary" disabled={disabled} onClick={() => setRange(start, currentTime)}>
                  Set out
                </Button>
                <Button variant="tertiary" disabled={disabled} onClick={() => setRange(0, duration)}>
                  Reset
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Field
            label="Start time"
            type="number"
            min={0}
            max={duration || undefined}
            step={0.01}
            value={value.startSeconds ?? ''}
            placeholder="First downbeat"
            disabled={disabled || (preview?.state === 'ready' && preview.asset.type !== 'AUDIO')}
            onChange={(event) => onChange({
              ...value,
              startSeconds: event.target.value === '' ? null : Number(event.target.value),
            })}
          />
          <Field
            label="Length in bars"
            type="number"
            min={1}
            max={64}
            value={value.bars}
            disabled={disabled || (preview?.state === 'ready' && preview.asset.type !== 'AUDIO')}
            onChange={(event) => onChange({ ...value, bars: Number(event.target.value) })}
          />
          <Checkbox
            label="Start on a downbeat"
            checked={value.snapToDownbeat}
            disabled={disabled || (preview?.state === 'ready' && preview.asset.type !== 'AUDIO')}
            onChange={(event) => onChange({ ...value, snapToDownbeat: event.target.checked })}
          />
          {duration > 0 && preview?.state === 'ready' && preview.asset.type === 'AUDIO' && (
            <Button
              variant="tertiary"
              disabled={disabled}
              onClick={() => onChange({ ...value, startSeconds: roundTime(currentTime) })}
            >
              Use playhead as start
            </Button>
          )}
          {preview?.state === 'ready' && preview.asset.type === 'VIDEO' && (
            <StatusMessage tone="error">Musical bars are available for audio only.</StatusMessage>
          )}
        </div>
      )}
    </section>
  );
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return '0:00.000';
  const minutes = Math.floor(value / 60);
  const seconds = (value % 60).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}
