import { describe, expect, it } from 'vitest';
import { assistantReplySchema, imagePromptsSchema } from '@/lib/ai/schemas';

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
  {
    kind: 'create_workflow',
    summary: 'Create coastal reel',
    name: 'coastal reel',
    description: 'Weekly reel',
    scheduleEnabled: true,
    scheduleWeekdays: [1],
    scheduleHour: 9,
    scheduleMinute: 0,
    nodes: [{ key: 'idea', type: 'IDEA_GENERATOR', config: { theme: 'coastal' } }],
    edges: [],
  },
  {
    kind: 'update_workflow',
    summary: 'Update coastal reel',
    workflowId: POST_ID,
    workflowName: 'coastal reel',
    scheduleEnabled: true,
    scheduleWeekdays: [1],
    scheduleHour: 10,
    scheduleMinute: 0,
    nodeUpdates: [],
    graphEdits: [{
      operation: 'add_node',
      key: 'trim_audio',
      type: 'AUDIO_TRIMMER',
      name: 'Trim intro',
      config: { bars: 8 },
    }],
  },
  {
    kind: 'run_workflow',
    summary: 'Run coastal reel',
    workflowId: POST_ID,
    workflowName: 'coastal reel',
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
    { ...validActions[6], name: 'x' },
    { ...validActions[7], workflowId: 'not-a-uuid' },
    { ...validActions[7], graphEdits: [{ operation: 'add_node', key: 'Bad key', type: 'NOPE' }] },
    { ...validActions[8], workflowName: '' },
  ])('rejects malformed $kind payloads', (action) => {
    expect(assistantReplySchema.safeParse({ reply: 'Malformed proposal', action }).success).toBe(false);
  });
});

/**
 * The cap that produced "the AI returned something Bridge88 could not use".
 *
 * A named output asked to carry a description of a cast ran well past two
 * hundred characters every time, and one oversized value fails the whole
 * reply — so a step that was working apart from one long field looked
 * completely broken, with nothing naming the field.
 */
describe('named extra outputs', () => {
  const reply = (subject: string) => imagePromptsSchema.safeParse({
    postTitle: 'A trio on the road',
    caption: '',
    hashtags: [],
    additionalOutputs: { subject },
    prompts: [{ title: 'One', prompt: 'a wizard reads by candlelight' }],
  });

  it('takes a description long enough to be worth asking for', () => {
    expect(reply('A'.repeat(1_500)).success).toBe(true);
  });

  it('still refuses one that has clearly run away', () => {
    expect(reply('A'.repeat(2_001)).success).toBe(false);
  });

  it('used to refuse anything past a sentence', () => {
    // The old ceiling. A cast of three never fitted inside it.
    expect(reply('A'.repeat(201)).success).toBe(true);
  });
});
