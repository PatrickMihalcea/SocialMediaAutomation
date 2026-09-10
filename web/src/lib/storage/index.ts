import 'server-only';
import { randomUUID } from 'node:crypto';
import { env } from '@/lib/env';
import { LocalStorage } from '@/lib/storage/local';
import { S3Storage } from '@/lib/storage/s3';
import type { StorageDriver } from '@/lib/storage/types';

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!cached) cached = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return cached;
}

/**
 * Object keys are workspace-prefixed so a bucket listing is already partitioned
 * by tenant, and randomised so an uploaded filename can never collide with or
 * overwrite another workspace's object.
 */
export function mediaKey(workspaceId: string, filename: string, kind: 'original' | 'thumb' | 'derived' = 'original'): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  return `workspaces/${workspaceId}/${kind}/${randomUUID()}.${ext}`;
}

export type { StorageDriver } from '@/lib/storage/types';
