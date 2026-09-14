import 'server-only';
import { PostStatus, Prisma, WorkflowRunTrigger, type WorkspaceRole } from '@prisma/client';
import { db } from '@/lib/db';
import { generateObject } from '@/lib/ai';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import { assistantReplySchema, contentIdeasSchema, type AssistantReply } from '@/lib/ai/schemas';
import { can } from '@/lib/auth/rbac';
import { forbidden, invalid, notFound } from '@/lib/errors';
import { assertPostNotLive, savePost } from '@/lib/posts/service';
import { workflowAssistantSkill, validateProposedGraph } from '@/lib/workflows/assistant-graph';
import { createWorkflowFromProposal, updateWorkflowFromProposal } from '@/lib/workflows/create-from-proposal';
import { startWorkflowRun } from '@/lib/workflows/engine';

const PROPOSAL_TTL_MS = 30 * 60 * 1000;

export async function listConversations(workspaceId: string, userId: string) {
  return db.aiConversation.findMany({
    where: { workspaceId, userId },
    orderBy: { updatedAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function sendAssistantMessage(input: {
  workspaceId: string;
  userId: string;
  conversationId?: string;
  content: string;
}) {
  const content = input.content.trim();
  if (!content) throw invalid('Write a message first.');
  const conversation = input.conversationId
    ? await db.aiConversation.findFirst({ where: { id: input.conversationId, workspaceId: input.workspaceId, userId: input.userId } })
    : await db.aiConversation.create({
        data: { workspaceId: input.workspaceId, userId: input.userId, title: content.slice(0, 72) },
      });
  if (!conversation) throw notFound('That conversation is unavailable.');
  const capabilityReply = assistantCapabilityReply(content);
  if (capabilityReply) {
    const message = await storeReply({
      conversationId: conversation.id,
      workspaceId: input.workspaceId,
      userContent: content,
      assistantContent: capabilityReply,
    });
    return { conversationId: conversation.id, message };
  }
  const previous = await db.aiMessage.findMany({
    where: { conversationId: conversation.id, workspaceId: input.workspaceId },
    orderBy: { createdAt: 'asc' },
    take: 30,
  });
  const system = await buildSystemPrompt({
    workspaceId: input.workspaceId,
    extra: [
      'You are a workspace assistant.',
      'Actions must be proposed using the structured action field. Never claim an action has already happened.',
      'You may propose creating up to ten drafts, scheduling existing posts, assigning a post to an existing campaign, attaching existing ready media, updating existing post copy, repurposing an existing post into a new draft, creating a workflow, editing any part of an existing workflow graph, or running an existing workflow.',
      'Use only entity ids and display names from the workspace context below.',
      'Campaign creation, inline media generation, deletion, and direct publishing are not available here. A confirmed workflow run may execute its configured steps, including a Publish step, so say that clearly in the proposal.',
      'When asked for an unavailable action, say that plainly and direct the user to the relevant workspace page. Never imply an unavailable action will run.',
      workflowAssistantSkill(),
      await assistantWorkspaceContext(input.workspaceId),
    ].join(' '),
  });
  if (/\bideas?\b/i.test(content) && !/\bworkflow\b/i.test(content)) {
    const ideas = await generateObject({
      workspaceId: input.workspaceId,
      userId: input.userId,
      operation: 'IDEAS',
      schema: contentIdeasSchema,
      schemaName: 'content_ideas',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    });
    const requestedCount = requestedIdeaCount(content);
    const assistantContent = [
      ...ideas.object.ideas.map((idea, index) => `${index + 1}. ${idea.title}\n${idea.angle}: ${idea.hook}`),
      requestedCount && requestedCount > ideas.object.ideas.length
        ? `This simulated provider returned ${ideas.object.ideas.length} of the ${requestedCount} requested ideas.`
        : '',
    ].filter(Boolean).join('\n\n');
    const message = await storeReply({
      conversationId: conversation.id,
      workspaceId: input.workspaceId,
      userContent: content,
      assistantContent,
    });
    return { conversationId: conversation.id, message };
  }
  const result = await generateObject({
    workspaceId: input.workspaceId,
    userId: input.userId,
    operation: 'CHAT',
    schema: assistantReplySchema,
    schemaName: 'assistant_reply',
    messages: [
      { role: 'system', content: system },
      ...previous.filter((message) => message.role === 'USER' || message.role === 'ASSISTANT').map((message) => ({
        role: message.role === 'USER' ? 'user' as const : 'assistant' as const,
        content: message.proposal
          ? `${message.content}\n<prior_proposal>${JSON.stringify(message.proposal)}</prior_proposal>`
          : message.content,
      })),
      { role: 'user', content },
    ],
  });
  const assistantReply = assistantReplySchema.parse(result.object);
  const hydratedAction = assistantReply.action
    ? await hydrateProposal(input.workspaceId, assistantReply.action)
    : null;
  const proposal = hydratedAction
    ? (hydratedAction as unknown as Prisma.InputJsonValue)
    : undefined;
  const [, message] = await db.$transaction([
    db.aiMessage.create({ data: { conversationId: conversation.id, workspaceId: input.workspaceId, role: 'USER', content } }),
    db.aiMessage.create({
      data: {
        conversationId: conversation.id,
        workspaceId: input.workspaceId,
        role: 'ASSISTANT',
        content: assistantReply.reply,
        proposal,
        proposalStatus: proposal ? 'PENDING' : null,
      },
    }),
    db.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } }),
  ]);
  return { conversationId: conversation.id, message };
}

async function storeReply(input: {
  conversationId: string;
  workspaceId: string;
  userContent: string;
  assistantContent: string;
}) {
  const [, message] = await db.$transaction([
    db.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        role: 'USER',
        content: input.userContent,
      },
    }),
    db.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        role: 'ASSISTANT',
        content: input.assistantContent,
      },
    }),
    db.aiConversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}

export function assistantCapabilityReply(content: string): string | null {
  if (/\b(publish|delete|remove)\b/i.test(content) && !/\bworkflow\b/i.test(content)) {
    return 'I cannot publish or delete posts from this assistant. Open the post in Composer, where Bridge88 checks your current permission and asks for the required confirmation.';
  }
  if (
    /\b(generate|create|find|search|make)\b.*\b(image|images|media|asset|video|clips?)\b/i.test(content)
    && !/\battach\b/i.test(content)
    && !/\bworkflow\b/i.test(content)
  ) {
    return 'Media search, image generation, and video jobs are not connected to this assistant yet. Open Media to find an existing filename you can ask me to attach, or open AI studio to start a simulated media job. To automate that pipeline, ask me to create a workflow.';
  }
  if (/\b(create|make|start)\b.*\bcampaign\b/i.test(content)) {
    return 'Campaign creation is not connected to this assistant yet. Open Campaigns to create the campaign, then use Composer to add its posts.';
  }
  if (
    /\b(translate|platform-specific|captions?)\b/i.test(content)
    || /\b(?:into|to)\s+(?:an?\s+)?(?:x|instagram|linkedin|tiktok|facebook|youtube)\s+(?:post|caption)\b/i.test(content)
  ) {
    return 'This text transformation is not wired into the assistant conversation yet. Open Composer to rewrite copy, generate hashtags or a call to action, and adapt selected channels.';
  }
  const requestedPosts = requestedPostCount(content);
  if (requestedPosts && requestedPosts > 10) {
    return `This assistant can propose at most 10 drafts at once. You asked for ${requestedPosts}, so no workspace change was proposed. Split the request into smaller sets.`;
  }
  if (/\b(ask|tell|show|read|about)\b.*\b(existing|current)\s+draft\b/i.test(content)) {
    return 'I cannot inspect the copy inside an existing draft from this conversation yet. Open Drafts to review it, or name the post and ask me for a specific proposed change.';
  }
  return null;
}

function requestedIdeaCount(content: string): number | null {
  const match = content.match(/\b(\d{1,2})\s+(?:\w+\s+){0,2}ideas?\b/i);
  return match ? Number(match[1]) : null;
}

function requestedPostCount(content: string): number | null {
  const numeric = content.match(/\b(\d{1,2})[ -]?(?:distinct\s+)?(?:drafts?|posts?)\b/i);
  if (numeric) return Number(numeric[1]);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  };
  const written = content.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]?(?:distinct\s+)?(?:drafts?|posts?)\b/i);
  return written ? words[written[1].toLowerCase()] : null;
}

export async function confirmProposal(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  messageId: string;
}) {
  const message = await db.aiMessage.findFirst({
    where: {
      id: input.messageId,
      workspaceId: input.workspaceId,
      conversation: { userId: input.userId },
    },
  });
  if (!message?.proposal) throw notFound('That proposal is unavailable.');
  if (message.proposalStatus === 'COMPLETED') return { status: 'COMPLETED' as const };
  if (Date.now() - message.createdAt.getTime() > PROPOSAL_TTL_MS) {
    throw invalid('This proposal expired. Ask the assistant to prepare a new one before confirming.');
  }
  const proposal = assistantReplySchema.shape.action.safeParse(message.proposal);
  if (!proposal.success || !proposal.data) throw invalid('That proposal is no longer valid.');
  const required = proposal.data.kind === 'schedule_posts'
    ? 'post:schedule'
    : proposal.data.kind === 'run_workflow'
      ? 'workflow:run'
    : proposal.data.kind === 'create_drafts' || proposal.data.kind === 'repurpose_content'
      ? 'post:create'
      : proposal.data.kind === 'create_workflow' || proposal.data.kind === 'update_workflow'
        ? 'workflow:edit'
        : 'post:update';
  if (!can(input.role, required)) throw forbidden('Your current role cannot confirm this proposal.');

  const claimed = await db.aiMessage.updateMany({
    where: { id: message.id, workspaceId: input.workspaceId, proposalStatus: 'PENDING' },
    data: { proposalStatus: 'EXECUTING' },
  });
  if (!claimed.count) {
    const current = await db.aiMessage.findUnique({ where: { id: message.id }, select: { proposalStatus: true } });
    return { status: current?.proposalStatus ?? 'UNKNOWN' };
  }
  try {
    const executed = await executeProposal(input.workspaceId, input.userId, proposal.data);
    await db.aiMessage.update({
      where: { id: message.id },
      data: {
        proposalStatus: 'COMPLETED',
        proposal: executed?.workflowId
          ? ({
              ...proposal.data,
              workflowId: executed.workflowId,
              ...(executed.runId ? { runId: executed.runId } : {}),
            } as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return {
      status: 'COMPLETED' as const,
      workflowId: executed?.workflowId,
      runId: executed?.runId,
    };
  } catch (error) {
    await db.aiMessage.update({ where: { id: message.id }, data: { proposalStatus: 'PENDING' } });
    throw error;
  }
}

export async function executeProposal(workspaceId: string, userId: string, proposal: NonNullable<AssistantReply['action']>) {
  if (proposal.kind === 'run_workflow') {
    const runId = await startWorkflowRun({
      workflowId: proposal.workflowId,
      workspaceId,
      userId,
      trigger: WorkflowRunTrigger.MANUAL,
    });
    return { workflowId: proposal.workflowId, runId };
  }
  if (proposal.kind === 'create_workflow') {
    const created = await createWorkflowFromProposal({
      workspaceId,
      userId,
      name: proposal.name,
      description: proposal.description,
      scheduleEnabled: proposal.scheduleEnabled,
      scheduleWeekdays: proposal.scheduleWeekdays,
      scheduleHour: proposal.scheduleHour,
      scheduleMinute: proposal.scheduleMinute,
      nodes: proposal.nodes,
      edges: proposal.edges,
    });
    return { workflowId: created.id };
  }
  if (proposal.kind === 'update_workflow') {
    const updated = await updateWorkflowFromProposal({
      workspaceId,
      userId,
      workflowId: proposal.workflowId,
      name: proposal.name,
      description: proposal.description,
      scheduleEnabled: proposal.scheduleEnabled,
      scheduleWeekdays: proposal.scheduleWeekdays,
      scheduleHour: proposal.scheduleHour,
      scheduleMinute: proposal.scheduleMinute,
      nodeUpdates: proposal.nodeUpdates,
      graphEdits: proposal.graphEdits,
    });
    return { workflowId: updated.id };
  }
  if (proposal.kind === 'create_drafts') {
    const accounts = await db.socialAccount.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      select: { id: true, platform: true },
    });
    if (!accounts.length) throw invalid('Connect a social account before creating assistant drafts.');
    for (const post of proposal.posts) {
      await savePost(workspaceId, userId, {
        title: post.title ?? post.text.slice(0, 80),
        status: PostStatus.DRAFT,
        timezone: 'UTC',
        platforms: accounts.map((account) => ({
          socialAccountId: account.id,
          platform: account.platform,
          text: post.text,
          hashtags: post.hashtags,
          mentions: [],
          media: [],
        })),
      }, { validateContent: false });
    }
    return;
  }
  if (proposal.kind === 'schedule_posts') {
    assertUnique(proposal.posts.map((post) => post.postId), 'The proposal contains the same post more than once.');
    const posts = await Promise.all(proposal.posts.map((post) => loadMutablePost(workspaceId, post.postId)));
    const slots = futureSlots(proposal.weekdays, proposal.hour, proposal.minute, posts.length);
    for (const [index, post] of posts.entries()) {
      await saveLoadedPost(workspaceId, userId, post, {
        status: PostStatus.SCHEDULED,
        scheduledAt: slots[index],
      });
    }
    return;
  }
  if (proposal.kind === 'assign_campaign') {
    const [post, campaign] = await Promise.all([
      loadMutablePost(workspaceId, proposal.postId),
      db.campaign.findFirst({ where: { id: proposal.campaignId, workspaceId }, select: { id: true } }),
    ]);
    if (!campaign) throw invalid('That campaign is not available in this workspace.');
    await saveLoadedPost(workspaceId, userId, post, { campaignId: campaign.id });
    return;
  }
  if (proposal.kind === 'attach_media') {
    assertUnique(proposal.media.map((asset) => asset.mediaAssetId), 'The proposal contains the same media file more than once.');
    const [post, assets] = await Promise.all([
      loadMutablePost(workspaceId, proposal.postId),
      db.mediaAsset.findMany({
        where: { workspaceId, id: { in: proposal.media.map((asset) => asset.mediaAssetId) }, status: 'READY' },
        select: { id: true },
      }),
    ]);
    if (assets.length !== proposal.media.length) throw invalid('One or more proposed media files are unavailable or still processing.');
    const additions = proposal.media.map((asset) => ({
      mediaAssetId: asset.mediaAssetId,
      altText: asset.altText,
      thumbnailOffset: null,
    }));
    await saveLoadedPost(workspaceId, userId, post, {
      transformPlatforms: (platform) => ({
        ...platform,
        media: [...platform.media, ...additions.filter((addition) =>
          !platform.media.some((current) => current.mediaAssetId === addition.mediaAssetId),
        )],
      }),
    });
    return;
  }
  if (proposal.kind === 'update_post_content') {
    const post = await loadMutablePost(workspaceId, proposal.postId);
    await saveLoadedPost(workspaceId, userId, post, {
      title: proposal.title,
      transformPlatforms: (platform) => ({
        ...platform,
        text: proposal.text,
        hashtags: proposal.hashtags,
      }),
    });
    return;
  }
  const source = await loadMutablePost(workspaceId, proposal.sourcePostId);
  await savePost(workspaceId, userId, {
    title: proposal.newTitle,
    campaignId: source.campaignId,
    status: PostStatus.DRAFT,
    timezone: source.timezone,
    platforms: source.platforms.map((platform) => ({
      socialAccountId: platform.socialAccountId,
      platform: platform.platform,
      text: proposal.text,
      firstComment: platform.firstComment,
      hashtags: proposal.hashtags,
      mentions: platform.mentions,
      link: platform.link,
      media: platform.media.map((media) => ({
        mediaAssetId: media.mediaAssetId,
        altText: media.altText,
        thumbnailOffset: media.thumbnailOffset,
      })),
    })),
  }, { validateContent: false });
}

type LoadedMutablePost = Awaited<ReturnType<typeof loadMutablePost>>;

async function loadMutablePost(workspaceId: string, postId: string) {
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId },
    include: {
      platforms: {
        include: { media: { orderBy: { position: 'asc' } } },
      },
    },
  });
  if (!post) throw invalid('That post is not available in this workspace.');
  assertPostNotLive(post, 'move');
  if (
    post.status !== PostStatus.DRAFT
    && post.status !== PostStatus.PENDING_APPROVAL
    && post.status !== PostStatus.APPROVED
    && post.status !== PostStatus.SCHEDULED
  ) {
    throw invalid('That post cannot be changed from its current state.');
  }
  return { ...post, status: post.status as MutablePostStatus };
}

type MutablePostStatus =
  | typeof PostStatus.DRAFT
  | typeof PostStatus.PENDING_APPROVAL
  | typeof PostStatus.APPROVED
  | typeof PostStatus.SCHEDULED;

async function saveLoadedPost(
  workspaceId: string,
  userId: string,
  post: LoadedMutablePost,
  changes: {
    title?: string | null;
    campaignId?: string | null;
    status?: MutablePostStatus;
    scheduledAt?: Date | null;
    transformPlatforms?: (platform: LoadedMutablePost['platforms'][number]) => {
      socialAccountId: string;
      platform: LoadedMutablePost['platforms'][number]['platform'];
      text: string;
      firstComment: string | null;
      hashtags: string[];
      mentions: string[];
      link: string | null;
      media: Array<{ mediaAssetId: string; altText: string | null; thumbnailOffset: number | null }>;
    };
  },
) {
  const nextStatus = changes.status ?? post.status;
  return savePost(workspaceId, userId, {
    id: post.id,
    expectedUpdatedAt: post.updatedAt,
    title: changes.title === undefined ? post.title : changes.title,
    campaignId: changes.campaignId === undefined ? post.campaignId : changes.campaignId,
    status: nextStatus,
    scheduledAt: changes.scheduledAt === undefined ? post.scheduledAt : changes.scheduledAt,
    timezone: post.timezone,
    platforms: post.platforms.map((platform) => {
      const transformed = changes.transformPlatforms?.(platform) ?? platform;
      return {
        socialAccountId: transformed.socialAccountId,
        platform: transformed.platform,
        text: transformed.text,
        firstComment: transformed.firstComment,
        hashtags: transformed.hashtags,
        mentions: transformed.mentions,
        link: transformed.link,
        media: transformed.media.map((media) => ({
          mediaAssetId: media.mediaAssetId,
          altText: media.altText,
          thumbnailOffset: media.thumbnailOffset,
        })),
      };
    }),
  }, { validateContent: nextStatus !== PostStatus.DRAFT });
}

function assertUnique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw invalid(message);
}

async function assistantWorkspaceContext(workspaceId: string): Promise<string> {
  const [posts, campaigns, media, folders, workflows, channels] = await Promise.all([
    db.post.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        scheduledAt: true,
        platforms: { select: { platform: true } },
      },
    }),
    db.campaign.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, name: true },
    }),
    db.mediaAsset.findMany({
      where: { workspaceId, status: 'READY' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, filename: true, type: true, folderId: true },
    }),
    db.mediaFolder.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      take: 100,
      select: { id: true, name: true, parentId: true },
    }),
    db.workflow.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        name: true,
        scheduleEnabled: true,
        scheduleWeekdays: true,
        scheduleHour: true,
        scheduleMinute: true,
        nodes: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            name: true,
            config: true,
            positionX: true,
            positionY: true,
          },
        },
        edges: {
          select: {
            id: true,
            sourceNodeId: true,
            sourcePort: true,
            targetNodeId: true,
            targetPort: true,
          },
        },
      },
    }),
    db.socialAccount.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { accountName: 'asc' },
      select: { id: true, platform: true, accountName: true, accountHandle: true },
    }),
  ]);
  return `WORKSPACE_CONTEXT_BEGIN${JSON.stringify({
    posts: posts.map((post) => ({
      id: post.id,
      title: post.title || 'Untitled post',
      status: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      platforms: [...new Set(post.platforms.map((platform) => platform.platform))],
    })),
    campaigns,
    media,
    folders,
    workflows,
    channels,
  })}WORKSPACE_CONTEXT_END`;
}

async function hydrateProposal(
  workspaceId: string,
  proposal: NonNullable<AssistantReply['action']>,
): Promise<NonNullable<AssistantReply['action']>> {
  if (proposal.kind === 'create_drafts') return proposal;
  if (proposal.kind === 'create_workflow') {
    try {
      const graph = validateProposedGraph(proposal.nodes, proposal.edges);
      if (proposal.scheduleEnabled && proposal.scheduleWeekdays.length === 0) {
        throw new Error('Choose at least one weekday before enabling the workflow schedule.');
      }
      const unattendedPublish = graph.nodes.find(
        (node) =>
          node.type === 'PUBLISH'
          && (node.config as { requireApproval?: boolean }).requireApproval === false,
      );
      if (proposal.scheduleEnabled && unattendedPublish) {
        throw new Error(
          `"${unattendedPublish.name}" must require approval before this workflow can run on a schedule.`,
        );
      }
      return { ...proposal, nodes: graph.nodes, edges: graph.edges };
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : 'That workflow graph is not valid.');
    }
  }
  if (proposal.kind === 'update_workflow') {
    const workflow = await db.workflow.findFirst({
      where: { id: proposal.workflowId, workspaceId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!workflow) throw invalid('The assistant selected a workflow that is not available in this workspace.');
    return { ...proposal, workflowName: workflow.name };
  }
  if (proposal.kind === 'run_workflow') {
    const workflow = await db.workflow.findFirst({
      where: { id: proposal.workflowId, workspaceId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!workflow) throw invalid('The assistant selected a workflow that is not available in this workspace.');
    return { ...proposal, workflowName: workflow.name };
  }
  if (proposal.kind === 'schedule_posts') {
    const posts = await Promise.all(proposal.posts.map(async (target) => {
      const post = await db.post.findFirst({
        where: { id: target.postId, workspaceId },
        select: { id: true, title: true },
      });
      if (!post) throw invalid('The assistant selected a post that is not available in this workspace.');
      return { postId: post.id, postTitle: post.title || 'Untitled post' };
    }));
    return { ...proposal, posts };
  }
  if (proposal.kind === 'assign_campaign') {
    const [post, campaign] = await Promise.all([
      db.post.findFirst({ where: { id: proposal.postId, workspaceId }, select: { id: true, title: true } }),
      db.campaign.findFirst({ where: { id: proposal.campaignId, workspaceId }, select: { id: true, name: true } }),
    ]);
    if (!post || !campaign) throw invalid('The assistant selected a post or campaign that is not available in this workspace.');
    return {
      ...proposal,
      postTitle: post.title || 'Untitled post',
      campaignName: campaign.name,
    };
  }
  if (proposal.kind === 'attach_media') {
    const [post, assets] = await Promise.all([
      db.post.findFirst({ where: { id: proposal.postId, workspaceId }, select: { id: true, title: true } }),
      db.mediaAsset.findMany({
        where: { workspaceId, id: { in: proposal.media.map((asset) => asset.mediaAssetId) }, status: 'READY' },
        select: { id: true, filename: true },
      }),
    ]);
    if (!post || assets.length !== proposal.media.length) {
      throw invalid('The assistant selected a post or media file that is not available in this workspace.');
    }
    const filenames = new Map(assets.map((asset) => [asset.id, asset.filename]));
    return {
      ...proposal,
      postTitle: post.title || 'Untitled post',
      media: proposal.media.map((asset) => ({ ...asset, filename: filenames.get(asset.mediaAssetId)! })),
    };
  }
  const postId = proposal.kind === 'update_post_content' ? proposal.postId : proposal.sourcePostId;
  const post = await db.post.findFirst({
    where: { id: postId, workspaceId },
    select: { id: true, title: true },
  });
  if (!post) throw invalid('The assistant selected a post that is not available in this workspace.');
  return proposal.kind === 'update_post_content'
    ? { ...proposal, postTitle: post.title || 'Untitled post' }
    : { ...proposal, sourcePostTitle: post.title || 'Untitled post' };
}

function futureSlots(weekdays: number[], hour: number, minute: number, count: number): Date[] {
  const allowed = new Set(weekdays.length ? weekdays : [1, 3, 5]);
  const slots: Date[] = [];
  const cursor = new Date();
  cursor.setUTCSeconds(0, 0);
  for (let day = 1; slots.length < count && day < 366; day += 1) {
    const candidate = new Date(cursor);
    candidate.setUTCDate(cursor.getUTCDate() + day);
    candidate.setUTCHours(hour, minute, 0, 0);
    if (allowed.has(candidate.getUTCDay())) slots.push(candidate);
  }
  if (slots.length < count) throw invalid('The proposal could not produce enough schedule slots.');
  return slots;
}
