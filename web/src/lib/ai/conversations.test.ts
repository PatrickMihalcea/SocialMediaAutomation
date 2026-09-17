import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  aiMessage: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  socialAccount: { findMany: vi.fn() },
  post: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  campaign: { findFirst: vi.fn(), findMany: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  workflow: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  workflowNode: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  workflowEdge: { create: vi.fn() },
  workspace: { findFirst: vi.fn() },
  aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  mediaFolder: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
const serviceMock = vi.hoisted(() => ({
  savePost: vi.fn(),
  assertPostNotLive: vi.fn((post: { status: string }) => {
    if (post.status === 'PUBLISHED') throw new Error('This post has already been published');
    if (post.status === 'PUBLISHING') throw new Error('This post is publishing right now');
  }),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/ai', () => ({ generateObject: vi.fn() }));
vi.mock('@/lib/ai/brand-voice', () => ({ buildSystemPrompt: vi.fn() }));
vi.mock('@/lib/posts/service', () => serviceMock);

import { assistantCapabilityReply, confirmProposal, executeProposal, sendAssistantMessage } from '@/lib/ai/conversations';
import { generateObject } from '@/lib/ai';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import type { AssistantReply } from '@/lib/ai/schemas';
import { weeklyReelTemplate } from '@/lib/workflows/assistant-graph';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const actions = {
  create_drafts: {
    kind: 'create_drafts',
    summary: 'Create a draft',
    posts: [{ title: 'Launch draft', text: 'Draft copy', hashtags: ['#launch'] }],
  },
  schedule_posts: {
    kind: 'schedule_posts',
    summary: 'Schedule Launch',
    posts: [{ postId: POST_ID, postTitle: 'Launch' }],
    weekdays: [1],
    hour: 9,
    minute: 0,
  },
  assign_campaign: {
    kind: 'assign_campaign',
    summary: 'Assign Spring',
    postId: POST_ID,
    postTitle: 'Launch',
    campaignId: CAMPAIGN_ID,
    campaignName: 'Spring',
  },
  attach_media: {
    kind: 'attach_media',
    summary: 'Attach launch.png',
    postId: POST_ID,
    postTitle: 'Launch',
    media: [{ mediaAssetId: ASSET_ID, filename: 'launch.png', altText: 'Launch graphic' }],
  },
  update_post_content: {
    kind: 'update_post_content',
    summary: 'Update Launch',
    postId: POST_ID,
    postTitle: 'Launch',
    title: 'Launch revised',
    text: 'Revised copy',
    hashtags: ['#revised'],
  },
  repurpose_content: {
    kind: 'repurpose_content',
    summary: 'Repurpose Launch',
    sourcePostId: POST_ID,
    sourcePostTitle: 'Launch',
    newTitle: 'Launch recap',
    text: 'Recap copy',
    hashtags: ['#recap'],
  },
} satisfies Record<string, NonNullable<AssistantReply['action']>>;

function loadedPost(status = 'DRAFT') {
  return {
    id: POST_ID,
    status,
    updatedAt: new Date(),
    title: 'Launch',
    campaignId: null,
    scheduledAt: null,
    timezone: 'UTC',
    platforms: [{
      socialAccountId: '44444444-4444-4444-8444-444444444444',
      platform: 'LINKEDIN',
      text: 'Original copy',
      firstComment: null,
      hashtags: ['#original'],
      mentions: [],
      link: null,
      media: [],
    }],
  };
}

describe('assistant capability disclosure', () => {
  it.each([
    ['Publish this post now', 'cannot publish'],
    ['Create a five-post campaign', 'Campaign creation'],
    ['Find the summer campaign images', 'Media search'],
    ['Generate 12 posts from this idea', 'at most 10'],
    ['Tell me about the existing draft', 'cannot inspect'],
  ])('returns an honest gap for %s', (prompt, expected) => {
    expect(assistantCapabilityReply(prompt)).toContain(expected);
  });

  /**
   * Refusing outright read as "this product cannot publish", when a Publish
   * step in a workflow is exactly how it does — the assistant just cannot fire
   * one off itself. The refusal has to name the route that does work.
   */
  it('points a publish request at both the one-off and the automated route', () => {
    const reply = assistantCapabilityReply('Publish this post now') ?? '';

    expect(reply).toContain('Composer');
    expect(reply).toMatch(/Publish step/i);
    expect(reply).toMatch(/workflow/i);
  });

  it('leaves supported ideas and action requests to the provider', () => {
    expect(assistantCapabilityReply('Give me 20 LinkedIn ideas about AI agents')).toBeNull();
    expect(assistantCapabilityReply('Create one draft about AI agents')).toBeNull();
    expect(assistantCapabilityReply('Create a weekly reel workflow about coastal rooms')).toBeNull();
    expect(assistantCapabilityReply('Create a video workflow for product shots')).toBeNull();
    expect(assistantCapabilityReply('Run the Bedroom picker workflow')).toBeNull();
    expect(assistantCapabilityReply('Make the Launch post more technical')).toBeNull();
    expect(assistantCapabilityReply('Schedule Launch post tomorrow at 9')).toBeNull();
    expect(assistantCapabilityReply('Move tomorrow’s LinkedIn post to Friday')).toBeNull();
    expect(assistantCapabilityReply('Generate five posts from this idea')).toBeNull();
  });
});

describe('assistant proposal confirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idempotent after a proposal has completed', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      proposalStatus: 'COMPLETED',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'COMPLETED' });
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });

  it('does not execute when another request already claimed it', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });
    dbMock.aiMessage.updateMany.mockResolvedValue({ count: 0 });
    dbMock.aiMessage.findUnique.mockResolvedValue({ proposalStatus: 'EXECUTING' });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'EXECUTING' });
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });

  it('rejects an expired proposal before claiming it', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'create_drafts',
        summary: 'Create one draft',
        posts: [{ text: 'A durable draft', hashtags: [] }],
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).rejects.toThrow('This proposal expired');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
  });

  it('enforces current permissions before claiming a proposal', async () => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'schedule_posts',
        summary: 'Schedule one post',
        posts: [{ postId: POST_ID, postTitle: 'Launch' }],
        weekdays: [5],
        hour: 10,
        minute: 0,
      },
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'VIEWER',
      messageId: 'message-1',
    })).rejects.toThrow('Your current role cannot confirm this proposal');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });

  it.each(['PUBLISHED', 'PUBLISHING'] as const)('never re-dates a %s post', async (status) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal: {
        kind: 'schedule_posts',
        summary: 'Move one post',
        posts: [{ postId: POST_ID, postTitle: 'Launch' }],
        weekdays: [5],
        hour: 10,
        minute: 0,
      },
    });
    dbMock.aiMessage.updateMany.mockResolvedValue({ count: 1 });
    dbMock.post.findFirst.mockResolvedValue({
      id: POST_ID,
      status,
      updatedAt: new Date(),
      title: 'Launch',
      campaignId: null,
      scheduledAt: null,
      timezone: 'UTC',
      platforms: [],
    });

    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      messageId: 'message-1',
    })).rejects.toThrow(status === 'PUBLISHED' ? 'already been published' : 'publishing right now');
    expect(serviceMock.savePost).not.toHaveBeenCalled();
    expect(dbMock.aiMessage.update).toHaveBeenCalledWith({
      where: { id: 'message-1' },
      data: { proposalStatus: 'PENDING' },
    });
  });
});

describe('assistant action executors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.post.findFirst.mockResolvedValue(loadedPost());
    dbMock.socialAccount.findMany.mockResolvedValue([{
      id: '44444444-4444-4444-8444-444444444444',
      platform: 'LINKEDIN',
    }]);
    dbMock.campaign.findFirst.mockResolvedValue({ id: CAMPAIGN_ID });
    dbMock.mediaAsset.findMany.mockResolvedValue([{ id: ASSET_ID }]);
    serviceMock.savePost.mockResolvedValue({ id: POST_ID, status: 'DRAFT' });
  });

  it.each(Object.entries(actions))('executes %s through the post service', async (_kind, action) => {
    await executeProposal('workspace-1', 'user-1', action);
    expect(serviceMock.savePost).toHaveBeenCalled();
  });

  it.each([
    actions.schedule_posts,
    actions.assign_campaign,
    actions.attach_media,
    actions.update_post_content,
    actions.repurpose_content,
  ])('refuses $kind for published and publishing targets before writing', async (action) => {
    for (const status of ['PUBLISHED', 'PUBLISHING']) {
      vi.clearAllMocks();
      dbMock.post.findFirst.mockResolvedValue(loadedPost(status));
      await expect(executeProposal('workspace-1', 'user-1', action)).rejects.toThrow(
        status === 'PUBLISHED' ? 'already been published' : 'publishing right now',
      );
      expect(serviceMock.savePost).not.toHaveBeenCalled();
    }
  });

  it.each(Object.entries(actions))('rejects a Viewer before claiming %s', async (_kind, proposal) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal,
    });
    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'VIEWER',
      messageId: 'message-1',
    })).rejects.toThrow('Your current role cannot confirm this proposal');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
  });

  it.each(Object.entries(actions))('rejects an expired %s before claiming', async (_kind, proposal) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
      proposalStatus: 'PENDING',
      proposal,
    });
    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).rejects.toThrow('This proposal expired');
    expect(dbMock.aiMessage.updateMany).not.toHaveBeenCalled();
  });

  it.each(Object.entries(actions))('returns completed idempotently for %s', async (_kind, proposal) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      proposalStatus: 'COMPLETED',
      proposal,
    });
    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'COMPLETED' });
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });

  it.each(Object.entries(actions))('does not duplicate %s when a concurrent confirmation claimed it', async (_kind, proposal) => {
    dbMock.aiMessage.findFirst.mockResolvedValue({
      id: 'message-1',
      createdAt: new Date(),
      proposalStatus: 'PENDING',
      proposal,
    });
    dbMock.aiMessage.updateMany.mockResolvedValue({ count: 0 });
    dbMock.aiMessage.findUnique.mockResolvedValue({ proposalStatus: 'EXECUTING' });
    await expect(confirmProposal({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'OWNER',
      messageId: 'message-1',
    })).resolves.toEqual({ status: 'EXECUTING' });
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });
});

describe('assistant workflow proposals', () => {
  it('creates a weekly reel graph without touching posts', async () => {
    const { weeklyReelTemplate } = await import('@/lib/workflows/assistant-graph');
    const graph = weeklyReelTemplate('coastal rooms');
    dbMock.workspace.findFirst.mockResolvedValue({ timezone: 'UTC' });
    dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) => {
      let n = 0;
      const tx = {
        workflow: {
          create: vi.fn().mockResolvedValue({ id: POST_ID, name: graph.name }),
          update: vi.fn(),
        },
        workflowNode: {
          create: vi.fn().mockImplementation(async () => {
            n += 1;
            return { id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}` };
          }),
        },
        workflowEdge: { create: vi.fn() },
      };
      return fn(tx as never);
    });

    await expect(executeProposal('workspace-1', 'user-1', {
      kind: 'create_workflow',
      summary: 'Create coastal rooms reel',
      name: graph.name,
      description: graph.description,
      scheduleEnabled: true,
      scheduleWeekdays: [1],
      scheduleHour: 9,
      scheduleMinute: 0,
      nodes: graph.nodes,
      edges: graph.edges,
    })).resolves.toEqual({ workflowId: POST_ID });
    expect(serviceMock.savePost).not.toHaveBeenCalled();
  });
});

describe('sendAssistantMessage conversation history', () => {
  const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
  // One message per minute, so "most recent" is unambiguous under either sort.
  const stored = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `msg-${index}`,
    proposal: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }));

  function sentMessages() {
    return vi.mocked(generateObject).mock.calls[0][0].messages;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSystemPrompt).mockResolvedValue('SYSTEM');
    dbMock.aiConversation.findFirst.mockResolvedValue({ id: CONVERSATION_ID });
    dbMock.aiConversation.update.mockResolvedValue({});
    // Models the database rather than returning a fixed slice, so a regression
    // back to ascending order fails here instead of passing silently.
    dbMock.aiMessage.findMany.mockImplementation(async (args: {
      orderBy: Array<{ createdAt?: 'asc' | 'desc' }>;
      take: number;
    }) => {
      const direction = args.orderBy.some((clause) => clause.createdAt === 'desc') ? -1 : 1;
      return [...stored]
        .sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()))
        .slice(0, args.take);
    });
    dbMock.aiMessage.create.mockReturnValue({});
    dbMock.$transaction.mockResolvedValue([{}, { id: 'reply' }, {}]);
    for (const model of [dbMock.post, dbMock.campaign, dbMock.mediaAsset, dbMock.mediaFolder, dbMock.workflow, dbMock.socialAccount]) {
      model.findMany.mockResolvedValue([]);
    }
    vi.mocked(generateObject).mockResolvedValue({
      object: { reply: 'Sure.', action: null },
      model: 'test',
      usage: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it('carries the most recent turns, not the oldest ones', async () => {
    await sendAssistantMessage({
      workspaceId: 'ws', userId: 'user', conversationId: CONVERSATION_ID, content: 'And the one before that?',
    });
    const contents = sentMessages().map((message) => message.content);
    expect(contents).toContain('msg-39');
    expect(contents).toContain('msg-10');
    expect(contents).not.toContain('msg-0');
    expect(contents.at(-1)).toBe('And the one before that?');
  });

  it('orders a question and its answer by role when both carry the same instant', async () => {
    await sendAssistantMessage({
      workspaceId: 'ws', userId: 'user', conversationId: CONVERSATION_ID, content: 'Continue',
    });
    // Reversed back to chronological, so the query has to ask for the reverse.
    expect(dbMock.aiMessage.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: 'desc' },
      { role: 'desc' },
    ]);
  });

  it('keeps history in chronological order after the system prompt', async () => {
    await sendAssistantMessage({
      workspaceId: 'ws', userId: 'user', conversationId: CONVERSATION_ID, content: 'Continue',
    });
    const sent = sentMessages();
    expect(sent[0].role).toBe('system');
    const history = sent.slice(1, -1);
    expect(history.map((message) => message.content)).toEqual(
      stored.slice(10).map((message) => message.content),
    );
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
  });

  it('gives the ideas path the same history', async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: { ideas: [{ title: 'One', angle: 'Angle', hook: 'Hook' }] },
      model: 'test',
      usage: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await sendAssistantMessage({
      workspaceId: 'ws', userId: 'user', conversationId: CONVERSATION_ID, content: 'Give me three more ideas like that',
    });
    const contents = sentMessages().map((message) => message.content);
    expect(contents).toContain('msg-39');
    expect(contents.at(-1)).toBe('Give me three more ideas like that');
  });
});

describe('a proposal Bridge88 refuses', () => {
  const CONVERSATION_ID = '66666666-6666-4666-8666-666666666666';
  const graph = weeklyReelTemplate('architecture', ['Interior design', 'Luxury homes']);
  const createAction = (edges: typeof graph.edges) => ({
    kind: 'create_workflow',
    summary: 'Create an architecture reel',
    name: graph.name,
    description: graph.description,
    scheduleEnabled: false,
    scheduleWeekdays: [],
    scheduleHour: 9,
    scheduleMinute: 0,
    nodes: graph.nodes,
    edges,
  });
  /** The same graph with one connection pointing at a port that does not exist. */
  const broken = createAction([
    ...graph.edges.slice(1),
    { sourceKey: 'idea', sourcePort: 'inventedPort', targetKey: 'images', targetPort: 'prompts' },
  ]);
  const valid = createAction(graph.edges);
  const reply = (action: unknown) => ({
    object: { reply: 'Here is the workflow.', action },
    model: 'test',
    usage: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSystemPrompt).mockResolvedValue('SYSTEM');
    dbMock.aiConversation.findFirst.mockResolvedValue({ id: CONVERSATION_ID });
    dbMock.aiConversation.update.mockResolvedValue({});
    dbMock.aiMessage.findMany.mockResolvedValue([]);
    dbMock.aiMessage.create.mockReturnValue({});
    dbMock.$transaction.mockResolvedValue([{}, { id: 'reply' }, {}]);
    for (const model of [dbMock.post, dbMock.campaign, dbMock.mediaAsset, dbMock.mediaFolder, dbMock.workflow, dbMock.socialAccount]) {
      model.findMany.mockResolvedValue([]);
    }
  });

  const send = () => sendAssistantMessage({
    workspaceId: 'ws',
    userId: 'user',
    conversationId: CONVERSATION_ID,
    content: 'Copy my reel workflow but make the theme random',
  });

  const storedAssistantMessage = () =>
    dbMock.aiMessage.create.mock.calls.map((call) => call[0].data).find((data) => data.role === 'ASSISTANT');

  it('hands the model the reason and keeps the workflow it fixes', async () => {
    vi.mocked(generateObject)
      .mockResolvedValueOnce(reply(broken))
      .mockResolvedValueOnce(reply(valid));

    await send();

    expect(generateObject).toHaveBeenCalledTimes(2);
    const repairPrompt = vi.mocked(generateObject).mock.calls[1][0].messages.at(-1);
    expect(repairPrompt?.role).toBe('system');
    expect(repairPrompt?.content).toContain('Bridge88 checked that action and refused it');
    expect(repairPrompt?.content).toContain('port');
    const stored = storedAssistantMessage();
    expect(stored?.proposalStatus).toBe('PENDING');
    expect(stored?.content).toBe('Here is the workflow.');
  });

  it('still answers, saying what it could not do, once the repairs run out', async () => {
    vi.mocked(generateObject).mockResolvedValue(reply(broken));

    await send();

    expect(generateObject).toHaveBeenCalledTimes(3);
    const stored = storedAssistantMessage();
    expect(stored?.proposal).toBeUndefined();
    expect(stored?.proposalStatus).toBeNull();
    expect(stored?.content).toContain('Here is the workflow.');
    expect(stored?.content).toContain('nothing was proposed');
  });
});

describe('requests that name automation rather than a one-off action', () => {
  it('does not refuse a video pipeline just because it says video', () => {
    expect(assistantCapabilityReply('Build me a workflow that makes videos for an architecture page')).toBeNull();
    expect(assistantCapabilityReply('Automate the media production for my page')).toBeNull();
  });

  it('still refuses the one-off actions it cannot take', () => {
    expect(assistantCapabilityReply('Generate an image of a kitchen')).toContain('AI studio');
    expect(assistantCapabilityReply('Publish the launch post now')).toContain('Composer');
  });
});
