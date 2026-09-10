import 'server-only';
import { headers } from 'next/headers';
import { db } from '@/lib/db';

/**
 * Append-only record of who changed what. Never blocks the caller: an audit
 * write that fails is logged and swallowed rather than failing the mutation it
 * was describing.
 */
export async function audit(entry: {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    let ipAddress: string | null = null;
    try {
      const h = await headers();
      ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    } catch {
      // Outside a request scope (worker, script) — no IP to record.
    }
    await db.auditLog.create({
      data: {
        workspaceId: entry.workspaceId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as never,
        ipAddress,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error);
  }
}
