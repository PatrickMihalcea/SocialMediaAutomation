import { describe, expect, it } from 'vitest';
import { campaignAuditPayload, type CampaignAuditKind } from './audit';

describe('campaign audit payloads', () => {
  it.each([
    ['created', 'campaign.created'],
    ['updated', 'campaign.updated'],
    ['statusChanged', 'campaign.status_changed'],
    ['archived', 'campaign.archived'],
    ['deleted', 'campaign.deleted'],
    ['duplicated', 'campaign.created'],
    ['postsAssigned', 'campaign.updated'],
    ['postsRemoved', 'campaign.updated'],
    ['postsMoved', 'campaign.updated'],
  ] satisfies [CampaignAuditKind, string][])('%s uses the mapped %s action', (kind, action) => {
    expect(campaignAuditPayload({
      kind,
      campaignId: 'campaign-123',
      metadata: { summary: 'Plain-language detail.' },
    })).toEqual({
      action,
      entityType: 'campaign',
      entityId: 'campaign-123',
      metadata: { summary: 'Plain-language detail.' },
    });
  });

  it('keeps deletion disposition and destination details', () => {
    const payload = campaignAuditPayload({
      kind: 'deleted',
      campaignId: 'campaign-123',
      metadata: {
        campaignName: 'Autumn launch',
        disposition: 'Moved posts to “Evergreen”.',
        destinationCampaignName: 'Evergreen',
        postCount: 5,
      },
    });

    expect(payload.metadata).toMatchObject({
      campaignName: 'Autumn launch',
      disposition: 'Moved posts to “Evergreen”.',
      destinationCampaignName: 'Evergreen',
      postCount: 5,
    });
  });
});
