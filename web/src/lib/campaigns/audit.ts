export type CampaignAuditKind =
  | 'created'
  | 'updated'
  | 'statusChanged'
  | 'archived'
  | 'deleted'
  | 'duplicated'
  | 'postsAssigned'
  | 'postsRemoved'
  | 'postsMoved';

const ACTIONS: Record<CampaignAuditKind, string> = {
  created: 'campaign.created',
  updated: 'campaign.updated',
  statusChanged: 'campaign.status_changed',
  archived: 'campaign.archived',
  deleted: 'campaign.deleted',
  duplicated: 'campaign.created',
  postsAssigned: 'campaign.updated',
  postsRemoved: 'campaign.updated',
  postsMoved: 'campaign.updated',
};

export function campaignAuditPayload(input: {
  kind: CampaignAuditKind;
  campaignId: string;
  metadata: Record<string, unknown>;
}) {
  return {
    action: ACTIONS[input.kind],
    entityType: 'campaign',
    entityId: input.campaignId,
    metadata: input.metadata,
  } as const;
}
