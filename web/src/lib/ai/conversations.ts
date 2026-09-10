import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma, type WorkspaceRole } from '@prisma/client';
import { db } from '@/lib/db';
import { generateObject } from '@/lib/ai';
import { buildSystemPrompt } from '@/lib/ai/brand-voice';
import { assistantReplySchema, type AssistantReply } from '@/lib/ai/schemas';
import { can } from '@/lib/auth/rbac';
import { forbidden, invalid, notFound } from '@/lib/errors';

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
  const previous = await db.aiMessage.findMany({
    where: { conversationId: conversation.id, workspaceId: input.workspaceId },
    orderBy: { createdAt: 'asc' },
    take: 30,
  });
  const system = await buildSystemPrompt({
    workspaceId: input.workspaceId,
    extra: 'You are a workspace assistant. Actions must be proposed using the structured action field. Never claim an action has already happened.',
  });
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
        content: message.content,
      })),
      { role: 'user', content },
    ],
  });
  const proposal = result.object.action
    ? (result.object.action as unknown as Prisma.InputJsonValue)
    : undefined;
  const [, message] = await db.$transaction([
    db.aiMessage.create({ data: { conversationId: conversation.id, workspaceId: input.workspaceId, role: 'USER', content } }),
    db.aiMessage.create({
      data: {
        conversationId: conversation.id,
        workspaceId: input.workspaceId,
        role: 'ASSISTANT',
        content: result.object.reply,
        proposal,
        proposalStatus: proposal ? 'PENDING' : null,
      },
    }),
    db.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } }),
  ]);
  return { conversationId: conversation.id, message };
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
  const proposal = assistantReplySchema.shape.action.safeParse(message.proposal);
  if (!proposal.success || !proposal.data) throw invalid('That proposal is no longer valid.');
  const required = proposal.data.kind === 'schedule_posts' ? 'post:schedule' : 'post:create';
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
    await executeProposal(input.workspaceId, input.userId, proposal.data);
    await db.aiMessage.update({ where: { id: message.id }, data: { proposalStatus: 'COMPLETED' } });
    return { status: 'COMPLETED' as const };
  } catch (error) {
    await db.aiMessage.update({ where: { id: message.id }, data: { proposalStatus: 'PENDING' } });
    throw error;
  }
}

async function executeProposal(workspaceId: string, userId: string, proposal: NonNullable<AssistantReply['action']>) {
  if (proposal.kind === 'create_drafts') {
    const accounts = await db.socialAccount.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      select: { id: true, platform: true },
    });
    if (!accounts.length) throw invalid('Connect a social account before creating assistant drafts.');
    await db.$transaction(proposal.posts.map((post) => db.post.create({
      data: {
        workspaceId,
        authorId: userId,
        status: 'DRAFT',
        title: post.title ?? post.text.slice(0, 80),
        platforms: {
          create: accounts.map((account) => ({
            workspaceId,
            socialAccountId: account.id,
            platform: account.platform,
            text: post.text,
            hashtags: post.hashtags,
            idempotencyKey: randomUUID(),
          })),
        },
      },
    })));
    return;
  }
  const posts = await db.post.findMany({ where: { workspaceId, id: { in: proposal.postIds } }, select: { id: true } });
  if (posts.length !== proposal.postIds.length) throw invalid('One or more proposed posts no longer exist.');
  const slots = futureSlots(proposal.weekdays, proposal.hour, proposal.minute, posts.length);
  await db.$transaction(posts.map((post, index) => db.post.update({
    where: { id: post.id },
    data: { status: 'SCHEDULED', scheduledAt: slots[index] },
  })));
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
