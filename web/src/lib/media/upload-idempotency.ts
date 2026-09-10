import { createHash } from 'node:crypto';
import type { Plan } from '@prisma/client';
import { PLAN_LIMITS, limitMessage } from '@/lib/billing/limits';
import { limitReached } from '@/lib/errors';

type UploadIdentity = {
  name: string;
  size: number;
  type: string;
};

/**
 * A stable UUID for one file in one client upload request. MediaAsset.id is
 * already unique, so this gives retries a database-enforced idempotency key
 * without requiring a schema migration.
 */
export function uploadAssetId(
  workspaceId: string,
  requestId: string,
  index: number,
  file: UploadIdentity,
): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify([workspaceId, requestId, index, file.name, file.size, file.type]))
    .digest()
    .subarray(0, 16);
  // Mark the digest as an RFC 4122 variant, version-5-shaped UUID so Postgres
  // accepts it in the existing uuid primary-key column.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newUploadBytes(
  files: Array<{ id: string; size: number }>,
  existingIds: ReadonlySet<string>,
): number {
  return files.reduce((sum, file) => sum + (existingIds.has(file.id) ? 0 : file.size), 0);
}

export function assertStorageUploadWithinPlan(
  plan: Plan,
  usedBytes: number,
  addedBytes: number,
): void {
  const limit = PLAN_LIMITS[plan].storageBytes;
  if (usedBytes + addedBytes > limit) {
    throw limitReached(limitMessage({
      plan,
      feature: 'storageBytes',
      used: usedBytes,
      limit,
    }));
  }
}
