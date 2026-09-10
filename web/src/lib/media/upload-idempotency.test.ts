import { describe, expect, it } from 'vitest';
import { Plan } from '@prisma/client';
import { PLAN_LIMITS } from '@/lib/billing/limits';
import {
  assertStorageUploadWithinPlan,
  newUploadBytes,
  uploadAssetId,
} from '@/lib/media/upload-idempotency';

const file = { name: 'launch.png', size: 2048, type: 'image/png' };

describe('uploadAssetId', () => {
  it('converges repeated request files on one valid UUID', () => {
    const first = uploadAssetId('workspace-a', 'request-a', 0, file);
    const replay = uploadAssetId('workspace-a', 'request-a', 0, file);

    expect(replay).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('keeps tenants, requests, and batch files distinct', () => {
    const baseline = uploadAssetId('workspace-a', 'request-a', 0, file);

    expect(uploadAssetId('workspace-b', 'request-a', 0, file)).not.toBe(baseline);
    expect(uploadAssetId('workspace-a', 'request-b', 0, file)).not.toBe(baseline);
    expect(uploadAssetId('workspace-a', 'request-a', 1, file)).not.toBe(baseline);
  });
});

describe('storage upload projection', () => {
  const limit = PLAN_LIMITS[Plan.FREE].storageBytes;
  const batch = [
    { id: 'first', size: 4 },
    { id: 'second', size: 6 },
  ];

  it('accepts a multi-file batch that fits below the ceiling', () => {
    const added = newUploadBytes(batch, new Set());

    expect(() => assertStorageUploadWithinPlan(Plan.FREE, limit - 11, added)).not.toThrow();
  });

  it('accepts a multi-file batch that exactly reaches the ceiling', () => {
    const added = newUploadBytes(batch, new Set());

    expect(() => assertStorageUploadWithinPlan(Plan.FREE, limit - 10, added)).not.toThrow();
  });

  it('rejects the whole batch when one additional file exceeds the ceiling', () => {
    const added = newUploadBytes([...batch, { id: 'one-byte-over', size: 1 }], new Set());

    expect(() => assertStorageUploadWithinPlan(Plan.FREE, limit - 10, added)).toThrow(
      /You are using 1,024 MB of 1 GB of media storage.*does not reset automatically.*Delete media.*Billing/i,
    );
  });

  it('does not double-count a replay or let a new file bypass the check', () => {
    const existingIds = new Set(['first']);
    const replayedBytes = newUploadBytes(batch, existingIds);

    expect(replayedBytes).toBe(6);
    expect(() => assertStorageUploadWithinPlan(Plan.FREE, limit - 6, replayedBytes)).not.toThrow();
    expect(() => assertStorageUploadWithinPlan(Plan.FREE, limit - 6, replayedBytes + 1)).toThrow();
  });
});
