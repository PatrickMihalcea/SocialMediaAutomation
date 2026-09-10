import { describe, expect, it } from 'vitest';
import {
  buildAuditWhere,
  formatAuditTimestamp,
  humanizeAuditEvent,
  parseHistoryFilters,
} from './audit-view';

describe('audit history read model', () => {
  it('always scopes the database filter to one workspace', () => {
    const filters = parseHistoryFilters({ type: 'post', post: 'post-123' }, 'America/New_York');
    const where = buildAuditWhere('workspace-a', filters, ['platform-123'], ['approval-123']);

    expect(where.workspaceId).toBe('workspace-a');
    expect(where.entityType).toEqual({ in: ['post', 'post_platform'] });
    expect(where.OR).toContainEqual({ entityType: 'post', entityId: 'post-123' });
  });

  it('rejects hostile filters without passing them to the query', () => {
    const filters = parseHistoryFilters({
      type: 'post; DROP TABLE audit_logs',
      from: 'yesterday',
      post: '../../../admin',
      page: '-900',
    }, 'America/New_York');

    expect(filters.type).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.postId).toBeUndefined();
    expect(filters.page).toBe(1);
    expect(filters.error).toBeTruthy();
  });

  it('converts date boundaries in the workspace timezone', () => {
    const filters = parseHistoryFilters({
      from: '2026-09-10',
      to: '2026-09-10',
    }, 'America/New_York');

    expect(filters.from?.toISOString()).toBe('2026-09-10T04:00:00.000Z');
    expect(filters.to?.toISOString()).toBe('2026-09-11T03:59:59.999Z');
    expect(formatAuditTimestamp(new Date('2026-09-10T21:00:00Z'), 'America/New_York')).toContain('5:00 PM');
  });

  it('maps machine actions, platforms and errors to plain sentences', () => {
    expect(humanizeAuditEvent({
      action: 'post.publish_failed',
      actor: 'Bridge88',
      entity: 'the post “Launch”',
      metadata: { platform: 'LINKEDIN', code: 'TOKEN_EXPIRED' },
    })).toBe(
      'Bridge88 could not publish the post “Launch” to LinkedIn. The social account needs to be reconnected.',
    );

    expect(humanizeAuditEvent({
      action: 'approval.changes_requested',
      actor: 'Alex Morgan',
      entity: 'the post “Launch”',
    })).toBe('Alex Morgan requested changes to the post “Launch”.');
  });

  it('never exposes an unknown action key', () => {
    const sentence = humanizeAuditEvent({
      action: 'future.machine_event',
      actor: 'Bridge88',
      entity: 'the workspace “Northwind”',
    });
    expect(sentence).toBe('Bridge88 updated the workspace “Northwind”.');
    expect(sentence).not.toContain('future.machine_event');
  });
});
