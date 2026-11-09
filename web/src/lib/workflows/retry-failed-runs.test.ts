import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { shouldRetryRun } from '@/lib/workflows/engine';

const workflow = { retryFailedRuns: true, retryLimit: 2, archivedAt: null };

describe('starting a new run after a failure', () => {
  it('starts one for a failed run while under the limit', () => {
    expect(shouldRetryRun('FAILED', workflow, { retryNumber: 0 })).toBe(true);
    expect(shouldRetryRun('FAILED', workflow, { retryNumber: 1 })).toBe(true);
  });

  it('stops at the limit', () => {
    expect(shouldRetryRun('FAILED', workflow, { retryNumber: 2 })).toBe(false);
  });

  it('never restarts a cancelled or successful run, or when the setting is off', () => {
    expect(shouldRetryRun('CANCELLED', workflow, { retryNumber: 0 })).toBe(false);
    expect(shouldRetryRun('SUCCEEDED', workflow, { retryNumber: 0 })).toBe(false);
    expect(shouldRetryRun('FAILED', { ...workflow, retryFailedRuns: false }, { retryNumber: 0 })).toBe(false);
    expect(shouldRetryRun('FAILED', { ...workflow, archivedAt: new Date() }, { retryNumber: 0 })).toBe(false);
  });
});
