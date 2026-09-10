'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, Button, EmptyState, Field, IconButton, Select, StatusMessage } from '@/bridge88/components';
import {
  addPostToQueueAction,
  createSlotRuleAction,
  deleteSlotRuleAction,
  pauseQueueAction,
  removePostFromQueueAction,
  reorderQueueAction,
  updateSlotRuleAction,
} from '@/app/actions/queue';
import {
  createRecurrenceAction,
  deleteRecurrenceAction,
  setRecurrenceStatusAction,
  updateRecurrenceAction,
} from '@/app/actions/recurrence';

type Rule = { id: string; weekday: number; hour: number; minute: number; enabled: boolean };
type QueuePost = { id: string; title: string; slotAt: string };
type Recurrence = {
  id: string; name: string; title: string; text: string; socialAccountId: string; campaignId: string;
  weekdays: number[]; hour: number; minute: number; startDate: string; endDate: string; status: string;
};
type Option = { value: string; label: string };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Slot rules put fields on the same row as 40px pill buttons. b88-filter-control
// pins the control to 40px with pill radius; min-h-10 is still needed to clear
// the 48px floor .b88-input sets, which min-height would otherwise win.
const compactInput = 'b88-filter-control min-h-10';
// Native checkboxes render a 13px glyph, so the label carries the 44px touch target.
const checkboxLabel = 'inline-flex min-h-11 items-center gap-2';

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The action could not be completed.';
}

export function QueueManager({
  slug, timezone, paused, rules, queuePosts, drafts, nextSlot, recurrences, accounts, campaigns, canManage,
}: {
  slug: string; timezone: string; paused: boolean; rules: Rule[]; queuePosts: QueuePost[];
  drafts: { id: string; title: string }[]; nextSlot: string | null; recurrences: Recurrence[];
  accounts: Option[]; campaigns: Option[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const run = (work: () => Promise<unknown>) => startTransition(async () => {
    try {
      await work();
      setMessage('');
      router.refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  });
  const orderedIds = queuePosts.map((post) => post.id);
  const move = (index: number, offset: number) => {
    const next = [...orderedIds];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    run(() => reorderQueueAction(slug, next));
  };

  return (
    <>
      {message && <StatusMessage tone="error" className="mt-6">{message}</StatusMessage>}
      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="b88-card">
          <p className="b88-caption">Queue state</p>
          <h2 className="b88-heading mt-3">{paused ? 'Publishing is paused' : 'Queue is running'}</h2>
          <p className="mt-2 text-sm">Scheduled times remain assigned while the queue is paused.</p>
          {canManage && <Button type="button" className="mt-6" disabled={pending} onClick={() => run(() => pauseQueueAction(slug, !paused))}>{paused ? <Play size={16} strokeWidth={1.75} /> : <Pause size={16} strokeWidth={1.75} />}{paused ? 'Resume queue' : 'Pause queue'}</Button>}
        </div>
        <div className="b88-card">
          <p className="b88-caption">Next open slot</p>
          <p className="mt-3 text-2xl font-[340]">{nextSlot ? DateTime.fromISO(nextSlot).setZone(timezone).toFormat('ccc d LLL, HH:mm') : 'No open slot'}</p>
          <p className="b88-caption mt-3">{timezone}</p>
        </div>
        <div className="b88-card">
          <p className="b88-caption">Queued posts</p>
          <p className="mt-3 text-[38px] font-[340] leading-none">{queuePosts.length}</p>
        </div>
      </section>

      <section className="b88-card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="b88-eyebrow">Posting times</p><h2 className="b88-heading mt-2">Weekly slot rules</h2></div></div>
        {rules.length ? <div className="mt-6 space-y-3">{rules.map((rule) => (
          <form key={rule.id} action={updateSlotRuleAction.bind(null, slug, rule.id)} className="grid grid-cols-1 items-end gap-3 rounded-md bg-surface-soft p-4 md:grid-cols-[minmax(0,1fr)_110px_110px_auto_auto]">
            <Select name="weekday" label="Day" className={compactInput} defaultValue={rule.weekday}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select>
            <Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={rule.hour} className={compactInput} />
            <Field label="Minute" name="minute" type="number" min={0} max={59} step={5} defaultValue={rule.minute} className={compactInput} />
            <label className={checkboxLabel}><input name="enabled" type="checkbox" defaultChecked={rule.enabled} className="size-5 accent-[var(--ink)]" />Enabled</label>
            <div className="flex flex-wrap gap-1">
              <IconButton type="submit" icon={Check} label={`Save ${weekdays[rule.weekday]} slot`} />
              <IconButton type="button" icon={Trash2} label={`Delete ${weekdays[rule.weekday]} slot`} onClick={() => run(() => deleteSlotRuleAction(slug, rule.id))} />
            </div>
          </form>
        ))}</div> : <div className="mt-6"><EmptyState eyebrow="No posting times" title="Add your first slot">Queue posts need at least one weekly publishing time.</EmptyState></div>}
        {canManage && <form action={createSlotRuleAction.bind(null, slug)} className="mt-6 grid grid-cols-1 items-end gap-3 border-t border-hairline pt-6 md:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
          <Select name="weekday" label="Day" className={compactInput}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select>
          <Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={9} className={compactInput} />
          <Field label="Minute" name="minute" type="number" min={0} max={59} step={5} defaultValue={0} className={compactInput} />
          <Button type="submit">Add slot</Button>
        </form>}
      </section>

      <section className="b88-card mt-6">
        <p className="b88-eyebrow">Smart queue</p><h2 className="b88-heading mt-2">Publishing order</h2>
        {queuePosts.length ? <ol className="mt-6 space-y-2">{queuePosts.map((post, index) => (
          <li key={post.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-soft p-4">
            <span className="b88-caption w-6">{index + 1}</span><span className="min-w-48 flex-1 font-[480]">{post.title}</span>
            <Badge tone="lime">{DateTime.fromISO(post.slotAt).setZone(timezone).toFormat('ccc d LLL, HH:mm')}</Badge>
            {canManage && <div className="flex flex-wrap gap-1">
              <IconButton type="button" icon={ChevronUp} label={`Move ${post.title} up`} disabled={pending || index === 0} onClick={() => move(index, -1)} />
              <IconButton type="button" icon={ChevronDown} label={`Move ${post.title} down`} disabled={pending || index === queuePosts.length - 1} onClick={() => move(index, 1)} />
              <IconButton type="button" icon={X} label={`Remove ${post.title} from queue`} disabled={pending} onClick={() => run(() => removePostFromQueueAction(slug, post.id))} />
            </div>}
          </li>
        ))}</ol> : <div className="mt-6"><EmptyState eyebrow="Queue clear" title="No posts are queued">Add a draft below to assign its next open slot.</EmptyState></div>}
        {canManage && <div className="mt-6 flex flex-wrap gap-2 border-t border-hairline pt-6">{drafts.map((post) => <Button type="button" key={post.id} variant="secondary" className="h-10 max-w-full" title={`Add ${post.title}`} disabled={pending || paused} onClick={() => run(() => addPostToQueueAction(slug, post.id))}><span className="min-w-0 truncate">Add {post.title}</span></Button>)}</div>}
      </section>

      <section className="b88-card mt-6">
        <p className="b88-eyebrow">Recurring schedules</p><h2 className="b88-heading mt-2">Repeating content</h2>
        <div className="mt-6 space-y-4">{recurrences.map((recurrence) => editing === recurrence.id ? (
          <RecurrenceForm key={recurrence.id} slug={slug} recurrence={recurrence} accounts={accounts} campaigns={campaigns} onCancel={() => setEditing(null)} />
        ) : (
          <article key={recurrence.id} className="rounded-md bg-surface-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-[480]">{recurrence.name}</h3><p className="b88-caption mt-1">{recurrence.weekdays.map((day) => weekdays[day].slice(0, 3)).join(', ')} · {String(recurrence.hour).padStart(2, '0')}:{String(recurrence.minute).padStart(2, '0')} · {timezone}</p></div><Badge tone={recurrence.status === 'ACTIVE' ? 'lilac' : 'outline'}>{recurrence.status}</Badge></div>
            {canManage && <div className="mt-3 flex flex-wrap gap-1">
              <Button type="button" variant="tertiary" onClick={() => setEditing(recurrence.id)}><Pencil size={16} strokeWidth={1.75} /> Edit</Button>
              <Button type="button" variant="tertiary" onClick={() => run(() => setRecurrenceStatusAction(slug, recurrence.id, recurrence.status === 'ACTIVE'))}>{recurrence.status === 'ACTIVE' ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}{recurrence.status === 'ACTIVE' ? 'Pause' : 'Resume'}</Button>
              <Button type="button" variant="tertiary" onClick={() => confirm('Delete this recurring schedule?') && run(() => deleteRecurrenceAction(slug, recurrence.id))}><Trash2 size={16} strokeWidth={1.75} /> Delete</Button>
            </div>}
          </article>
        ))}</div>
        {canManage && editing === null && <div className="mt-6 border-t border-hairline pt-6"><RecurrenceForm slug={slug} accounts={accounts} campaigns={campaigns} /></div>}
      </section>
    </>
  );
}

function RecurrenceForm({ slug, recurrence, accounts, campaigns, onCancel }: { slug: string; recurrence?: Recurrence; accounts: Option[]; campaigns: Option[]; onCancel?: () => void }) {
  const action = recurrence ? updateRecurrenceAction.bind(null, slug, recurrence.id) : createRecurrenceAction.bind(null, slug);
  return <form action={action} className="grid gap-4 rounded-md bg-surface-soft p-4 md:grid-cols-2">
    <Field label="Schedule name" name="name" required defaultValue={recurrence?.name} />
    <Field label="Post title" name="title" defaultValue={recurrence?.title} />
    <label><span className="b88-label">Account</span><select required name="socialAccountId" className="b88-input" defaultValue={recurrence?.socialAccountId}><option value="">Choose account</option>{accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <label><span className="b88-label">Campaign</span><select name="campaignId" className="b88-input" defaultValue={recurrence?.campaignId}><option value="">No campaign</option>{campaigns.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <label className="md:col-span-2"><span className="b88-label">Post copy</span><textarea required name="text" className="b88-input min-h-28" defaultValue={recurrence?.text} /></label>
    <fieldset className="md:col-span-2"><legend className="b88-label">Publishing days</legend><div className="mt-2 flex flex-wrap gap-3">{weekdays.map((day, index) => <label key={day} className={`${checkboxLabel} min-w-11 justify-center text-sm`}><input name="weekdays" value={index} type="checkbox" defaultChecked={recurrence?.weekdays.includes(index)} className="size-5 accent-[var(--ink)]" />{day.slice(0, 3)}</label>)}</div></fieldset>
    <div className="grid grid-cols-2 gap-3"><Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={recurrence?.hour ?? 9} /><Field label="Minute" name="minute" type="number" min={0} max={59} defaultValue={recurrence?.minute ?? 0} /></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Starts" name="startDate" type="date" required defaultValue={recurrence?.startDate ?? DateTime.now().toISODate()!} /><Field label="Ends (optional)" name="endDate" type="date" defaultValue={recurrence?.endDate} /></div>
    <div className="flex gap-2 md:col-span-2"><Button type="submit">{recurrence ? 'Save schedule' : 'Create recurring schedule'}</Button>{onCancel && <Button type="button" variant="tertiary" onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}
