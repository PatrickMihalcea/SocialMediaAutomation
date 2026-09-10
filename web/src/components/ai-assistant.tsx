'use client';

import { useState, useTransition } from 'react';
import { Bot, Plus, Send } from 'lucide-react';
import { Button, Badge, StatusMessage } from '@/bridge88/components';
import { confirmAiProposalAction, sendAssistantMessageAction } from '@/app/actions/ai';

type Message = {
  id: string;
  role: string;
  content: string;
  proposal: unknown;
  proposalStatus: string | null;
};
type Conversation = { id: string; title: string; messages: Message[] };

export function AiAssistant({ slug, initialConversations }: { slug: string; initialConversations: Conversation[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | undefined>(initialConversations[0]?.id);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const active = conversations.find((item) => item.id === activeId);

  function send() {
    if (!content.trim()) return;
    setError('');
    const sent = content;
    setContent('');
    startTransition(async () => {
      try {
        const result = await sendAssistantMessageAction(slug, activeId, sent);
        const user: Message = { id: `local-${Date.now()}`, role: 'USER', content: sent, proposal: null, proposalStatus: null };
        setConversations((current) => {
          const exists = current.find((item) => item.id === result.conversationId);
          if (!exists) return [{ id: result.conversationId, title: sent.slice(0, 72), messages: [user, result.message as Message] }, ...current];
          return current.map((item) => item.id === result.conversationId
            ? { ...item, messages: [...item.messages, user, result.message as Message] }
            : item);
        });
        setActiveId(result.conversationId);
      } catch (cause) {
        setContent(sent);
        setError(cause instanceof Error ? cause.message : 'The assistant request failed.');
      }
    });
  }

  function confirm(messageId: string) {
    setError('');
    startTransition(async () => {
      try {
        const result = await confirmAiProposalAction(slug, messageId);
        setConversations((current) => current.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === messageId
            ? { ...message, proposalStatus: result.status }
            : message),
        })));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The proposal could not be confirmed.');
      }
    });
  }

  return (
    <div className="grid min-h-0 grid-cols-1 items-stretch gap-6 md:min-h-[620px] xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="b88-card">
        <Button type="button" fullWidth onClick={() => { setActiveId(undefined); setContent(''); }}>
          <Plus size={16} /> New conversation
        </Button>
        <div className="mt-6 space-y-1">
          {conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              onClick={() => setActiveId(conversation.id)}
              className="w-full rounded-pill px-4 py-2 text-left text-sm transition-opacity hover:opacity-80"
              style={activeId === conversation.id ? { background: 'var(--primary)', color: 'var(--on-primary)' } : undefined}
            >
              {conversation.title}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-col rounded-[24px] bg-[var(--block-cream)] p-6">
        <div className="flex items-center gap-3 border-b border-[var(--hairline-soft)] pb-6">
          <span className="flex size-11 items-center justify-center rounded-full bg-canvas"><Bot size={20} /></span>
          <div><h2 className="font-[540]">Workspace assistant</h2><p className="b88-caption mt-1">Persisted · confirmation required</p></div>
        </div>
        <div className="flex-1 space-y-4 py-6">
          {!active?.messages.length && <p className="mx-auto max-w-md py-12 text-center">Ask for drafts or a content schedule. Bridge88 stores proposed actions separately and waits for confirmation.</p>}
          {active?.messages.map((message) => (
            <article key={message.id} className={`max-w-[80%] rounded-lg p-4 ${message.role === 'USER' ? 'ml-auto bg-[var(--primary)] text-[var(--on-primary)]' : 'bg-canvas'}`}>
              <p className="b88-caption mb-2">{message.role === 'USER' ? 'You' : 'Assistant'}</p>
              <p className="whitespace-pre-wrap">{message.content}</p>
              {Boolean(message.proposal) && (
                <div className="mt-4 border-t border-[var(--hairline-soft)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={message.proposalStatus === 'COMPLETED' ? 'lime' : 'lilac'}>
                      {message.proposalStatus === 'COMPLETED' ? 'Completed' : 'Proposed action'}
                    </Badge>
                    {message.proposalStatus === 'PENDING' && (
                      <Button type="button" onClick={() => confirm(message.id)} disabled={pending}>Confirm</Button>
                    )}
                  </div>
                  <p className="mt-3 text-sm">{proposalSummary(message.proposal)}</p>
                </div>
              )}
            </article>
          ))}
        </div>
        {error && <StatusMessage tone="error" className="mb-4">{error}</StatusMessage>}
        <div className="flex flex-wrap items-center gap-3">
          {/* A textarea keeps Shift+Enter inserting a newline, but it has to be pinned to
              --control-size and pill radius to match the Send button sharing this row:
              .b88-input is a 48px, 8px-radius field and a textarea grows past it by rows. */}
          <textarea
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
            className="b88-input flex-1 basis-40 overflow-y-auto"
            style={{ height: 'var(--control-size)', minHeight: 'var(--control-size)', borderRadius: 'var(--radius-pill)', padding: '8px 16px', lineHeight: '22px', resize: 'none' }}
            placeholder="Ask for content or a schedule"
            aria-label="Assistant message"
          />
          <Button type="button" className="shrink-0" onClick={send} disabled={pending || !content.trim()}><Send size={16} /> Send</Button>
        </div>
      </section>
    </div>
  );
}

function proposalSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Structured action';
  const proposal = value as { summary?: unknown };
  return typeof proposal.summary === 'string' ? proposal.summary : 'Structured action';
}
