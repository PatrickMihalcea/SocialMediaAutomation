import { describe, expect, it } from 'vitest';
import { assistantReplySchema } from '@/lib/ai/schemas';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';

const validActions = [
  {
    kind: 'create_drafts',
    summary: 'Create a draft',
    posts: [{ title: 'Launch', text: 'Launch copy', hashtags: ['#launch'] }],
  },
  {
    kind: 'schedule_posts',
    summary: 'Schedule Launch',
    posts: [{ postId: POST_ID, postTitle: 'Launch' }],
    weekdays: [1, 3],
    hour: 9,
    minute: 30,
  },
  {
    kind: 'assign_campaign',
    summary: 'Assign campaign',
    postId: POST_ID,
    postTitle: 'Launch',
    campaignId: CAMPAIGN_ID,
    campaignName: 'Spring',
  },
  {
    kind: 'attach_media',
    summary: 'Attach media',
    postId: POST_ID,
    postTitle: 'Launch',
    media: [{ mediaAssetId: ASSET_ID, filename: 'launch.png', altText: 'Launch graphic' }],
  },
  {
    kind: 'update_post_content',
    summary: 'Update Launch',
    postId: POST_ID,
    postTitle: 'Launch',
    title: 'Launch revised',
    text: 'Revised copy',
    hashtags: ['#launch'],
  },
  {
    kind: 'repurpose_content',
    summary: 'Repurpose Launch',
    sourcePostId: POST_ID,
    sourcePostTitle: 'Launch',
    newTitle: 'Launch recap',
    text: 'Recap copy',
    hashtags: ['#recap'],
  },
] as const;

describe('assistant action contract', () => {
  it.each(validActions)('accepts a valid $kind action', (action) => {
    expect(assistantReplySchema.safeParse({ reply: 'Review this proposal.', action }).success).toBe(true);
  });

  it.each(validActions)('rejects forged fields on $kind before execution', (action) => {
    expect(assistantReplySchema.safeParse({
      reply: 'Forged proposal',
      action: { ...action, workspaceId: 'another-workspace', status: 'PUBLISHED' },
    }).success).toBe(false);
  });

  it.each([
    { ...validActions[0], posts: [] },
    { ...validActions[1], posts: [{ postId: 'not-a-uuid', postTitle: 'Launch' }] },
    { ...validActions[2], campaignId: 'not-a-uuid' },
    { ...validActions[3], media: [] },
    { ...validActions[4], text: '' },
    { ...validActions[5], newTitle: '' },
  ])('rejects malformed $kind payloads', (action) => {
    expect(assistantReplySchema.safeParse({ reply: 'Malformed proposal', action }).success).toBe(false);
  });
});
