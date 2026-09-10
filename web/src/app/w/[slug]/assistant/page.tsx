import { AiAssistant } from '@/components/ai-assistant';
import { requireWorkspace } from '@/lib/auth/guard';
import { listConversations } from '@/lib/ai/conversations';

export default async function AssistantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'ai:use');
  const conversations = await listConversations(ctx.workspace.id, ctx.user.id);
  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">AI workspace</p>
        <h1 className="b88-page-title mt-3">Content assistant</h1>
        <p className="mt-3 max-w-2xl">Ideas and copy use the workspace’s brand voice. Destructive and publishing actions are never executed from model prose.</p>
      </div>
      <AiAssistant
        slug={slug}
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
