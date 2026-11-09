import { describe, expect, it } from 'vitest';
import { describeStepRun, type StepRunFacts } from '@/lib/workflows/step-summary';

const base: StepRunFacts = {
  nodeType: 'IMAGE_GENERATOR', status: 'SUCCEEDED', durationMs: null, error: null,
  attempt: 1, maxAttempts: 3, startedAt: null, queuedAt: null, output: null,
};
const now = Date.parse('2026-11-09T05:00:00Z');

describe('describing a step of a run', () => {
  it('says how far a running step is and for how long', () => {
    const lines = describeStepRun({
      ...base, nodeType: 'ANIMATE_IMAGE', status: 'RUNNING', attempt: 2,
      startedAt: new Date(now - 14 * 60_000),
      output: { _progress: { done: 0, total: 1, since: now - 9 * 60_000, expectedMs: 18 * 60_000 } },
    }, now);
    expect(lines[0]).toMatch(/^50% done · 14m.* so far · attempt 2 of 3$/);
  });

  it('says what a queued step is waiting for', () => {
    expect(describeStepRun({ ...base, nodeType: 'ANIMATE_IMAGE', status: 'QUEUED', queuedAt: new Date(now - 5 * 60_000) }, now)[0])
      .toMatch(/^Waiting for your Mac for 5m/);
  });

  it('says what a finished step made, and how its picture test went', () => {
    const lines = describeStepRun({
      ...base, durationMs: 95_000,
      output: { images: ['a'], checks: [{ pass: false, score: 4 }, { pass: true, score: 9 }] },
    }, now);
    expect(lines).toContain('Made 1 picture');
    expect(lines).toContain('Picture test passed after 2 tries');
  });

  it('gives a failed step its error', () => {
    expect(describeStepRun({ ...base, status: 'FAILED', error: 'ComfyUI did not finish within 45 minutes.' }, now))
      .toContain('ComfyUI did not finish within 45 minutes.');
  });
});
