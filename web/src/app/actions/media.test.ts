import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Plan } from '@prisma/client';
import { PLAN_LIMITS } from '@/lib/billing/limits';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  put: vi.fn(),
  enqueue: vi.fn(),
  audit: vi.fn(),
  subscription: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: vi.fn().mockResolvedValue({
    workspace: { id: '11111111-1111-4111-8111-111111111111' },
    user: { id: '22222222-2222-4222-8222-222222222222' },
  }),
}));
vi.mock('@/lib/storage', () => ({
  mediaKey: vi.fn((_workspaceId: string, filename: string) => `test/${filename}`),
  storage: () => ({ put: mocks.put }),
}));
vi.mock('@/lib/db', () => ({
  db: {
    subscription: { findUnique: mocks.subscription },
    mediaAsset: { updateMany: mocks.updateMany },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      mediaAsset: {
        aggregate: mocks.aggregate,
        findMany: mocks.findMany,
        upsert: mocks.upsert,
      },
    }),
  },
}));
vi.mock('@/lib/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import { uploadMediaAction } from '@/app/actions/media';

const limit = PLAN_LIMITS[Plan.FREE].storageBytes;

function uploadForm(sizes: number[]) {
  const form = new FormData();
  form.set('uploadRequestId', 'storage-limit-test');
  sizes.forEach((size, index) => {
    form.append('files', new File([new Uint8Array(size)], `asset-${index}.png`, { type: 'image/png' }));
  });
  return form;
}

describe('uploadMediaAction storage ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscription.mockResolvedValue({ plan: Plan.FREE, status: 'ACTIVE' });
    mocks.findMany.mockResolvedValue([]);
    mocks.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('writes every file when the batch fits below the ceiling', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: limit - 12 } });

    const result = await uploadMediaAction('northwind-studio', uploadForm([4, 6]));

    expect(result.error).toBeUndefined();
    expect(mocks.put).toHaveBeenCalledTimes(2);
  });

  it('allows a batch that exactly reaches the ceiling', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: limit - 10 } });

    const result = await uploadMediaAction('northwind-studio', uploadForm([4, 6]));

    expect(result.error).toBeUndefined();
    expect(mocks.put).toHaveBeenCalledTimes(2);
  });

  it('rejects the complete batch before writing when one file exceeds the ceiling', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: limit - 10 } });

    const result = await uploadMediaAction('northwind-studio', uploadForm([4, 6, 1]));

    expect(result.error).toMatch(/You are using 1,024 MB of 1 GB of media storage.*Delete media.*Billing/i);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('does not charge replayed ids as new storage', async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: limit } });
    mocks.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id })));
    mocks.upsert.mockResolvedValue({ status: 'READY' });

    const result = await uploadMediaAction('northwind-studio', uploadForm([4, 6]));

    expect(result.error).toBeUndefined();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
