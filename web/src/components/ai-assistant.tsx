'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Bot, Copy, Pencil, Plus, Send } from 'lucide-react';
import { Button, Badge, Dialog, humanizeMachineValue, StatusMessage, Toast } from '@/bridge88/components';
import { confirmAiProposalAction, sendAssistantMessageAction } from '@/app/actions/ai';

type Proposal =
  | {
      kind: 'create_drafts';
      summary: string;
      posts: Array<{ title?: string; text: string; hashtags?: string[] }>;
    }
  | {
      kind: 'schedule_posts';
      summary: string;
      posts: Array<{ postId: string; postTitle: string }>;
      weekdays: number[];
      hour: number;
      minute: number;
    }
  | {
      kind: 'assign_campaign';
      summary: string;
      postId: string;
      postTitle: string;
      campaignId: string;
      campaignName: string;
    }
  | {
      kind: 'attach_media';
      summary: string;
      postId: string;
      postTitle: string;
      media: Array<{ mediaAssetId: string; filename: string; altText: string | null }>;
    }
  | {
      kind: 'update_post_content';
      summary: string;
      postId: string;
      postTitle: string;
      title?: string | null;
      text: string;
      hashtags: string[];
    }
  | {
      kind: 'repurpose_content';
      summary: string;
      sourcePostId: string;
      sourcePostTitle: string;
      newTitle: string;
      text: string;
      hashtags: string[];
    }
  | {
      kind: 'create_workflow';
      summary: string;
      name: string;
      description?: string | null;
      scheduleEnabled: boolean;
      scheduleWeekdays: number[];
      scheduleHour: number;
      scheduleMinute: number;
      nodes: Array<{ key: string; type: string; name?: string }>;
      edges: Array<{ sourceKey: string; sourcePort: string; targetKey: string; targetPort: string }>;
      workflowId?: string;
    }
  | {
      kind: 'update_workflow';
      summary: string;
      workflowId: string;
      workflowName: string;
      name?: string;
      description?: string | null;
      scheduleEnabled?: boolean;
      scheduleWeekdays?: number[];
      scheduleHour?: number;
      scheduleMinute?: number;
      nodeUpdates?: Array<{ nodeId: string; name?: string }>;
      graphEdits?: Array<{
        operation: 'add_node' | 'update_node' | 'remove_node' | 'connect' | 'disconnect';
        name?: string;
        type?: string;
      }>;
    }
  | {
      kind: 'run_workflow';
      summary: string;
      workflowId: string;
      workflowName: string;
      runId?: string;
    };

type Message = {
  id: string;
  role: string;
  content: string;
  proposal: Proposal | null;
  proposalStatus: string | null;
};
type Conversation = { id: string; title: string; messages: Message[] };

export function AiAssistant({
  slug,
  timezone,
  initialConversations,
  simulated = false,
}: {
  slug: string;
  timezone: string;
  initialConversations: Conversation[];
  simulated?: boolean;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | undefined>(initialConversations[0]?.id);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [pendingTask, setPendingTask] = useState<'send' | 'confirm' | null>(null);
  const [proposalToConfirm, setProposalToConfirm] = useState<Message | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const active = conversations.find((item) => item.id === activeId);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [active?.messages.length, pendingText]);

  function send() {
    const sent = content.trim();
    if (!sent || pending) return;
    setError('');
    setContent('');
    setPendingText(sent);
    setPendingTask('send');
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
      } finally {
        setPendingText('');
        setPendingTask(null);
      }
    });
  }

  function confirm(message: Message) {
    setError('');
    setProposalToConfirm(null);
    setPendingTask('confirm');
    startTransition(async () => {
      try {
        const result = await confirmAiProposalAction(slug, message.id);
        setConversations((current) => current.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((item) => item.id === message.id
            ? {
              ...item,
              proposalStatus: result.status,
              proposal: result.workflowId && item.proposal && (
                item.proposal.kind === 'create_workflow'
                || item.proposal.kind === 'update_workflow'
                || item.proposal.kind === 'run_workflow'
              )
                ? {
                    ...item.proposal,
                    workflowId: result.workflowId,
                    ...(result.runId ? { runId: result.runId } : {}),
                  }
                : item.proposal,
            }
            : item),
        })));
        setNotice(completionCopy(message.proposal));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The proposal could not be confirmed.');
      } finally {
        setPendingTask(null);
      }
    });
  }

  async function copyMessage(message: Message) {
    try {
      await navigator.clipboard.writeText(outputText(message));
      setNotice('Output copied');
    } catch {
      setError('Copy failed. Select the output and copy it manually.');
    }
  }

  function editMessage(message: Message) {
    setContent(outputText(message));
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: 'nearest' });
  }

  return (
    <>
      <div className="grid min-h-0 grid-cols-1 items-stretch gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="b88-card xl:max-h-[680px] xl:overflow-y-auto">
        <Button type="button" fullWidth onClick={() => { setActiveId(undefined); setContent(''); }}>
          <Plus size={16} /> New conversation
        </Button>
        <div className="mt-4 max-h-40 space-y-1 overflow-y-auto xl:max-h-none">
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

      <section className="flex h-[640px] min-h-0 flex-col rounded-[24px] bg-[var(--block-cream)] p-5 pb-20 md:h-[min(680px,calc(100dvh-96px))] md:p-6">
        <div className="flex items-center gap-3 border-b border-[var(--hairline-soft)] pb-6">
          <span className="flex size-11 items-center justify-center rounded-full bg-canvas"><Bot size={20} /></span>
          <div className="min-w-0">
            <h2 className="font-[540]">Workspace assistant</h2>
            <p className="b88-caption mt-1">{simulated ? 'Simulated output · ' : ''}Confirmation required</p>
          </div>
        </div>
        <div ref={transcriptRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6 pr-1" aria-live="polite">
          {!active?.messages.length && (
            <div className="mx-auto max-w-lg py-8 text-center">
              <div className="flex flex-wrap justify-center gap-2">
                <Button href={`/w/${slug}/compose`} variant="secondary">Create post</Button>
                <Button href={`/w/${slug}/workflows`} variant="secondary">Open workflows</Button>
                <Button href={`/w/${slug}/studio`} variant="secondary">Open AI studio</Button>
              </div>
            </div>
          )}
          {active?.messages.map((message) => (
            <article key={message.id} className={`max-w-[94%] rounded-lg p-4 md:max-w-[82%] ${message.role === 'USER' ? 'ml-auto bg-[var(--primary)] text-[var(--on-primary)]' : 'bg-canvas'}`}>
              <p className="b88-caption mb-2">{message.role === 'USER' ? 'You' : 'Assistant'}</p>
              <p className="whitespace-pre-wrap">{messageContent(message)}</p>
              {Boolean(message.proposal) && (
                <div className="mt-4 border-t border-[var(--hairline-soft)] pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={message.proposalStatus === 'COMPLETED' ? 'lime' : 'lilac'}>
                      {proposalStatusLabel(message.proposalStatus)}
                    </Badge>
                    {message.proposalStatus === 'PENDING' && (
                      <Button type="button" onClick={() => setProposalToConfirm(message)} disabled={pending}>Review and confirm</Button>
                    )}
                  </div>
                  <p className="mt-3 text-sm">{proposalSummary(message.proposal)}</p>
                  {message.proposalStatus === 'COMPLETED' && (
                    <div className="mt-3">
                      <Button
                        href={proposalDestination(slug, message.proposal)}
                        variant="secondary"
                      >
                        {proposalDestinationLabel(message.proposal)}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {message.role === 'ASSISTANT' && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--hairline-soft)] pt-3">
                  <Button type="button" variant="tertiary" onClick={() => copyMessage(message)}>
                    <Copy size={16} /> Copy
                  </Button>
                  <Button type="button" variant="tertiary" onClick={() => editMessage(message)}>
                    <Pencil size={16} /> Edit in prompt
                  </Button>
                  <Button href={`/w/${slug}/compose`} variant="tertiary">Open composer</Button>
                </div>
              )}
            </article>
          ))}
          {pendingText && (
            <>
              <article className="ml-auto max-w-[94%] rounded-lg bg-[var(--primary)] p-4 text-[var(--on-primary)] md:max-w-[82%]">
                <p className="b88-caption mb-2">You</p>
                <p className="whitespace-pre-wrap">{pendingText}</p>
              </article>
              <div className="flex items-center gap-3 rounded-lg bg-canvas p-4" role="status">
                <span className="b88-spinner" aria-hidden="true" />
                <span>{simulated ? 'Preparing simulated output' : 'Preparing assistant output'}</span>
              </div>
            </>
          )}
        </div>
        {error && <StatusMessage tone="error" className="mb-4">{error}</StatusMessage>}
        <div className="flex shrink-0 items-center gap-3 border-t border-[var(--hairline-soft)] pt-4">
          {/* A textarea keeps Shift+Enter inserting a newline, but it has to be pinned to
              --control-size and pill radius to match the Send button sharing this row:
              .b88-input is a 48px, 8px-radius field and a textarea grows past it by rows. */}
          <textarea
            ref={composerRef}
            rows={1}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
            className="b88-input flex-1 basis-40 overflow-y-auto"
            style={{ height: 'var(--control-size)', minHeight: 'var(--control-size)', borderRadius: 'var(--radius-pill)', padding: '8px 16px', lineHeight: '22px', resize: 'none' }}
            placeholder="Ask for content, a schedule, or a workflow"
            aria-label="Assistant message"
          />
          <Button type="button" className="shrink-0" onClick={send} disabled={pending || !content.trim()} aria-busy={pendingTask === 'send'}>
            <Send size={16} /> {pendingTask === 'send' ? 'Sending' : 'Send'}
          </Button>
        </div>
      </section>
    </div>
      <Dialog
        open={Boolean(proposalToConfirm)}
        eyebrow="Confirm workspace change"
        title={proposalDialogTitle(proposalToConfirm?.proposal ?? null)}
        onClose={() => { if (!pending) setProposalToConfirm(null); }}
        actions={(
          <>
            <Button type="button" variant="secondary" onClick={() => setProposalToConfirm(null)} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={() => proposalToConfirm && confirm(proposalToConfirm)} disabled={pending} aria-busy={pendingTask === 'confirm'}>
              {pendingTask === 'confirm' ? 'Confirming' : 'Confirm change'}
            </Button>
          </>
        )}
      >
        {proposalToConfirm?.proposal && (
          <ProposalDetails proposal={proposalToConfirm.proposal} timezone={timezone} />
        )}
      </Dialog>
      {notice && <div onClick={() => setNotice('')}><Toast tone="success">{notice}</Toast></div>}
    </>
  );
}

function ProposalDetails({ proposal, timezone }: { proposal: Proposal; timezone: string }) {
  if (proposal.kind === 'create_drafts') {
    return (
      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
        {proposal.posts.map((post, index) => (
          <div key={`${post.title ?? 'draft'}-${index}`} className="rounded-md bg-surface-soft p-3">
            <p className="font-[540]">{post.title || `Draft ${index + 1}`}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{post.text}</p>
            {Boolean(post.hashtags?.length) && <p className="mt-2 text-sm">{post.hashtags?.join(' ')}</p>}
          </div>
        ))}
      </div>
    );
  }
  if (proposal.kind === 'schedule_posts') {
    return (
      <div className="mt-4 rounded-md bg-surface-soft p-3 text-sm">
        <p className="font-[540]">{proposal.posts.length === 1 ? proposal.posts[0].postTitle : `${proposal.posts.length} posts`}</p>
        {proposal.posts.length > 1 && (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {proposal.posts.map((post) => <li key={post.postId}>{post.postTitle}</li>)}
          </ul>
        )}
        <p className="mt-2">
          Each post will become scheduled at {formatTime(proposal.hour, proposal.minute)} on the next available {formatWeekdays(proposal.weekdays)}.
        </p>
      </div>
    );
  }
  if (proposal.kind === 'assign_campaign') {
    return (
      <div className="mt-4 rounded-md bg-surface-soft p-3 text-sm">
        <p><span className="font-[540]">{proposal.postTitle}</span> will be assigned to the campaign <span className="font-[540]">{proposal.campaignName}</span>.</p>
        <p className="mt-2">Its copy, media, status, and publishing time will stay the same.</p>
      </div>
    );
  }
  if (proposal.kind === 'attach_media') {
    return (
      <div className="mt-4 rounded-md bg-surface-soft p-3 text-sm">
        <p>The following media will be attached to every channel version of <span className="font-[540]">{proposal.postTitle}</span>:</p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          {proposal.media.map((asset) => (
            <li key={asset.mediaAssetId}>
              <span className="font-[540]">{assistantAssetLabel(asset.filename)}</span>
              <span className="block">Alternative text: {asset.altText || 'none'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">Existing media will remain attached.</p>
      </div>
    );
  }
  if (proposal.kind === 'update_post_content') {
    return (
      <div className="mt-4 max-h-72 overflow-y-auto rounded-md bg-surface-soft p-3 text-sm">
        <p>Every channel version of <span className="font-[540]">{proposal.postTitle}</span> will use this copy:</p>
        {proposal.title !== undefined && <p className="mt-3 font-[540]">Title: {proposal.title || 'Untitled'}</p>}
        <p className="mt-3 whitespace-pre-wrap">{proposal.text}</p>
        <p className="mt-3">{proposal.hashtags.length ? proposal.hashtags.join(' ') : 'No hashtags'}</p>
        <p className="mt-3">Media, campaign, status, and publishing time will stay the same.</p>
      </div>
    );
  }
  if (proposal.kind === 'create_workflow') {
    return (
      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-md bg-surface-soft p-3 text-sm">
        <p className="font-[540]">{proposal.name}</p>
        {proposal.description && <p className="mt-2">{proposal.description}</p>}
        <p className="mt-2">
          {proposal.scheduleEnabled
            ? `Scheduled at ${formatTime(proposal.scheduleHour, proposal.scheduleMinute)} on ${formatWeekdays(proposal.scheduleWeekdays)} (${timezone}).`
            : 'Manual runs only. It will not start until you open it and run it.'}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {proposal.nodes.map((node) => (
            <li key={node.key}>{node.name || node.type}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (proposal.kind === 'update_workflow') {
    return (
      <div className="mt-4 rounded-md bg-surface-soft p-3 text-sm">
        <p><span className="font-[540]">{proposal.name || proposal.workflowName}</span> will be updated. Existing runs stay as they are.</p>
        {proposal.scheduleEnabled !== undefined && (
          <p className="mt-2">
            {proposal.scheduleEnabled
              ? `Schedule: ${formatTime(proposal.scheduleHour ?? 9, proposal.scheduleMinute ?? 0)} on ${formatWeekdays(proposal.scheduleWeekdays ?? [])} (${timezone}).`
              : 'The weekly schedule will be turned off.'}
          </p>
        )}
        {Boolean(proposal.graphEdits?.length) && (
          <div className="mt-3">
            <p className="font-[540]">
              {proposal.graphEdits!.length} graph {proposal.graphEdits!.length === 1 ? 'change' : 'changes'}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {proposal.graphEdits!.map((edit, index) => (
                <li key={`${edit.operation}-${index}`}>
                  {edit.operation.replaceAll('_', ' ')}
                  {edit.name ? ` · ${edit.name}` : edit.type ? ` · ${edit.type}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (proposal.kind === 'run_workflow') {
    return (
      <div className="mt-4 rounded-md bg-surface-soft p-3 text-sm">
        <p>
          <span className="font-[540]">{proposal.workflowName}</span> will start after confirmation.
        </p>
        <p className="mt-2">
          Its configured steps may use AI quota, create media, create posts, or publish when the
          workflow contains a Publish step without approval.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 max-h-72 overflow-y-auto rounded-md bg-surface-soft p-3 text-sm">
      <p>A new draft named <span className="font-[540]">{proposal.newTitle}</span> will be created from <span className="font-[540]">{proposal.sourcePostTitle}</span>.</p>
      <p className="mt-3 whitespace-pre-wrap">{proposal.text}</p>
      <p className="mt-3">{proposal.hashtags.length ? proposal.hashtags.join(' ') : 'No hashtags'}</p>
      <p className="mt-3">The source post will remain unchanged. Its channel selection, campaign, and media will be copied to the new draft.</p>
    </div>
  );
}

function proposalSummary(value: Proposal | null): string {
  if (!value) return 'Structured action';
  if (value.kind !== 'attach_media') return value.summary;
  return value.media.reduce(
    (summary, asset) => summary.replaceAll(asset.filename, assistantAssetLabel(asset.filename)),
    value.summary,
  );
}

function messageContent(message: Message): string {
  const hydrated = message.proposal?.kind === 'attach_media'
    ? message.proposal.media.reduce(
    (content, asset) => content.replaceAll(asset.filename, assistantAssetLabel(asset.filename)),
    message.content,
    )
    : message.content;
  return hydrated
    .replace(/\bAI E2E \d+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav)\b/gi, (filename) => assistantAssetLabel(filename))
    .replace(/\b[a-z0-9]+(?:[-_][a-z0-9]+)+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav)\b/gi, (filename) => humanizeMachineValue(filename));
}

function assistantAssetLabel(filename: string): string {
  if (/^AI E2E \d+\.(?:png|jpe?g|webp)$/i.test(filename)) return 'Generated image';
  return humanizeMachineValue(filename);
}

function proposalStatusLabel(status: string | null): string {
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'EXECUTING') return 'Applying';
  return 'Proposed action';
}

function outputText(message: Message): string {
  if (message.proposal?.kind !== 'create_drafts') return message.content;
  return message.proposal.posts
    .map((post) => [post.title, post.text, post.hashtags?.join(' ')].filter(Boolean).join('\n\n'))
    .join('\n\n---\n\n');
}

function formatTime(hour: number, minute: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

function formatWeekdays(weekdays: number[]): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const selected = weekdays.map((day) => names[day]);
  if (selected.length === 0) return 'no weekdays';
  return selected.length === 1 ? selected[0] : `${selected.slice(0, -1).join(', ')} and ${selected.at(-1)}`;
}

function proposalDialogTitle(proposal: Proposal | null): string {
  if (!proposal) return 'Confirm this change?';
  if (proposal.kind === 'create_drafts') return 'Create these drafts?';
  if (proposal.kind === 'schedule_posts') return 'Apply this schedule?';
  if (proposal.kind === 'assign_campaign') return 'Assign this campaign?';
  if (proposal.kind === 'attach_media') return 'Attach this media?';
  if (proposal.kind === 'update_post_content') return 'Replace this post copy?';
  if (proposal.kind === 'create_workflow') return 'Create this workflow?';
  if (proposal.kind === 'update_workflow') return 'Apply these workflow changes?';
  if (proposal.kind === 'run_workflow') return 'Run this workflow?';
  return 'Create this repurposed draft?';
}

function proposalDestination(slug: string, proposal: Proposal | null): string {
  if (!proposal) return `/w/${slug}/assistant`;
  if (proposal.kind === 'schedule_posts') return `/w/${slug}/calendar`;
  if (proposal.kind === 'create_drafts' || proposal.kind === 'repurpose_content') return `/w/${slug}/drafts`;
  if (proposal.kind === 'create_workflow' || proposal.kind === 'update_workflow') {
    return proposal.workflowId ? `/w/${slug}/workflows/${proposal.workflowId}` : `/w/${slug}/workflows`;
  }
  if (proposal.kind === 'run_workflow') {
    return proposal.runId
      ? `/w/${slug}/workflows/${proposal.workflowId}/runs/${proposal.runId}`
      : `/w/${slug}/workflows/${proposal.workflowId}`;
  }
  return `/w/${slug}/compose/${proposal.postId}`;
}

function proposalDestinationLabel(proposal: Proposal | null): string {
  if (proposal?.kind === 'schedule_posts') return 'View calendar';
  if (proposal?.kind === 'create_drafts' || proposal?.kind === 'repurpose_content') return 'View drafts';
  if (proposal?.kind === 'create_workflow' || proposal?.kind === 'update_workflow') return 'Open workflow';
  if (proposal?.kind === 'run_workflow') return 'View run';
  return 'View post';
}

function completionCopy(proposal: Proposal | null): string {
  if (proposal?.kind === 'schedule_posts') return 'Schedule updated';
  if (proposal?.kind === 'assign_campaign') return 'Campaign assigned';
  if (proposal?.kind === 'attach_media') return 'Media attached';
  if (proposal?.kind === 'update_post_content') return 'Post copy updated';
  if (proposal?.kind === 'create_workflow') return 'Workflow created';
  if (proposal?.kind === 'update_workflow') return 'Workflow updated';
  if (proposal?.kind === 'run_workflow') return 'Workflow started';
  return 'Drafts created';
}
