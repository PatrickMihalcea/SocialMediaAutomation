import { describe, expect, it } from 'vitest';
import { uploadAssetId } from '@/lib/media/upload-idempotency';

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
