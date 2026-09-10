import { AiAssistant } from '@/components/ai-assistant';
import { requireWorkspace } from '@/lib/auth/guard';
import { listConversations } from '@/lib/ai/conversations';
import { env } from '@/lib/env';

export default async function AssistantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'ai:use');
  const conversations = await listConversations(ctx.workspace.id, ctx.user.id);
  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">AI workspace</p>
        <h1 className="b88-page-title mt-3">Content assistant</h1>
        <p className="mt-3 max-w-2xl">
          Ideas and copy use the workspace’s brand voice. Workspace changes are proposed for review and never executed from model prose.
        </p>
        {env.AI_PROVIDER === 'mock' && (
          <p className="mt-3 max-w-2xl rounded-md bg-[var(--surface-soft)] p-3 text-sm">
            This environment uses deterministic simulated output. It does not contact an external AI model.
          </p>
        )}
      </div>
      <AiAssistant
        slug={slug}
        simulated={env.AI_PROVIDER === 'mock'}
        initialConversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          messages: conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            proposal: message.proposal,
            proposalStatus: message.proposalStatus,
          })),
        }))}
      />
    </>
  );
}
