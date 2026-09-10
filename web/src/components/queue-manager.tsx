'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import {
  CalendarX,
  Check,
  ChevronDown,
  ChevronUp,
  Pause,
  Pencil,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Select, StatusMessage } from '@/bridge88/components';
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
  deleteRecurrenceOccurrenceAction,
  deleteRecurrenceAction,
  setRecurrenceStatusAction,
  skipRecurrenceOccurrenceAction,
  updateRecurrenceAction,
} from '@/app/actions/recurrence';

type Rule = { id: string; weekday: number; hour: number; minute: number; enabled: boolean };
type QueuePost = { id: string; title: string; slotAt: string };
type Recurrence = {
  id: string; name: string; title: string; text: string; socialAccountId: string; campaignId: string;
  frequency: 'weekly' | 'weekdays' | 'monthly'; weekdays: number[]; hour: number; minute: number;
  startDate: string; endDate: string; status: string;
  occurrences: { id: string; title: string; scheduledAt: string; status: string }[];
};
type Option = { value: string; label: string };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Slot rules put fields on the same row as 40px pill buttons. b88-filter-control
// pins the control to 40px with pill radius; min-h-10 is still needed to clear
// the 48px floor .b88-input sets, which min-height would otherwise win.
const compactInput = 'b88-filter-control min-h-10';
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
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const run = (work: () => Promise<unknown>, success?: string) => startTransition(async () => {
    try {
      await work();
      setMessage(success ? { text: success, tone: 'success' } : null);
      router.refresh();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'error' });
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
      {message && <StatusMessage tone={message.tone} className="mt-6">{message.text}</StatusMessage>}
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
        <p className="b88-eyebrow">Smart queue</p><h2 className="b88-heading mt-2">Publishing order</h2>
        <p className="mt-2 text-sm">Reordering reassigns queue times. Editing posting times does not change any post already in this list.</p>
        {queuePosts.length ? <ol className="mt-6 space-y-2">{queuePosts.map((post, index) => (
          <li key={post.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface-soft p-4">
            <span className="b88-caption w-6">{index + 1}</span>
            <Button href={`/w/${slug}/calendar?post=${post.id}`} variant="tertiary" className="min-w-0 flex-1 justify-start px-0 text-left">
              <span className="truncate">{post.title}</span>
            </Button>
            <Badge tone="lime">{DateTime.fromISO(post.slotAt).setZone(timezone).toFormat('ccc d LLL, HH:mm')}</Badge>
            {canManage && <div className="flex flex-wrap gap-1">
              <IconButton type="button" icon={ChevronUp} label={`Move ${post.title} up`} disabled={pending || index === 0} onClick={() => move(index, -1)} />
              <IconButton type="button" icon={ChevronDown} label={`Move ${post.title} down`} disabled={pending || index === queuePosts.length - 1} onClick={() => move(index, 1)} />
              <IconButton type="button" icon={X} label={`Remove ${post.title} from queue`} disabled={pending} onClick={() => confirm(`Remove “${post.title}” from the queue and return it to drafts?`) && run(() => removePostFromQueueAction(slug, post.id), 'Post returned to drafts.')} />
            </div>}
          </li>
        ))}</ol> : <div className="mt-6"><EmptyState eyebrow="Queue clear" title="No posts are queued" action={<Button href={`/w/${slug}/compose`}>Create a draft</Button>}>Create a post, save it as a draft, then return here to assign the next open slot.</EmptyState></div>}
        {canManage && <div className="mt-6 border-t border-hairline pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="b88-label">Posts ready to queue</p><p className="mt-1 text-sm">{paused ? 'Resume the queue before assigning new slots.' : 'Select drafts or scheduled posts. They will receive sequential open slots in this order.'}</p></div>
            {!drafts.length && <Button href={`/w/${slug}/compose`} variant="secondary">Create a draft</Button>}
          </div>
          {drafts.length > 0 && <div className="mt-3 grid gap-1 sm:grid-cols-2">
            {drafts.map((post) => <Checkbox
              key={post.id}
              label={post.title}
              value={post.id}
              checked={selectedDrafts.includes(post.id)}
              disabled={paused || pending}
              onChange={(event) => setSelectedDrafts((current) => event.target.checked ? [...current, post.id] : current.filter((id) => id !== post.id))}
              containerClassName="rounded-md px-3 hover:bg-surface-soft"
            />)}
          </div>}
        </div>}
        {selectedDrafts.length > 0 && <div className="b88-selection-bar" role="region" aria-label={`Queue ${selectedDrafts.length} selected posts`} style={{ flexWrap: 'nowrap', justifyContent: 'flex-start', overflowX: 'auto' }}>
          <span className="px-2 text-sm font-[480]">{selectedDrafts.length} selected</span>
          <Button type="button" variant="secondary" disabled={pending || paused} onClick={() => run(async () => {
            for (const id of selectedDrafts) await addPostToQueueAction(slug, id);
            setSelectedDrafts([]);
          }, `${selectedDrafts.length} ${selectedDrafts.length === 1 ? 'post' : 'posts'} added to the queue.`)}>Add sequentially</Button>
          <Button type="button" variant="tertiary" disabled={pending} onClick={() => setSelectedDrafts([])}>Cancel</Button>
        </div>}
      </section>

      <section className="b88-card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="b88-eyebrow">Posting times</p><h2 className="b88-heading mt-2">Weekly slot rules</h2></div></div>
        <StatusMessage className="mt-4">Changes apply only to future queue assignments. Posts already queued keep their current publishing times.</StatusMessage>
        {rules.length ? <div className="mt-6 space-y-3">{rules.map((rule) => (
          <details key={rule.id} className="rounded-md bg-surface-soft">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2">
              <span className="font-[480]">{weekdays[rule.weekday]} at {String(rule.hour).padStart(2, '0')}:{String(rule.minute).padStart(2, '0')}</span>
              <Badge tone={rule.enabled ? 'mint' : 'outline'}>{rule.enabled ? 'Enabled' : 'Disabled'} · Edit</Badge>
            </summary>
          <form onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            run(() => updateSlotRuleAction(slug, rule.id, formData), 'Posting time saved. Existing queued posts were not changed.');
          }} className="grid grid-cols-1 items-end gap-3 border-t border-hairline p-4 md:grid-cols-[minmax(0,1fr)_110px_110px_auto_auto]">
            <Select name="weekday" label="Day" className={compactInput} defaultValue={rule.weekday}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select>
            <Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={rule.hour} className={compactInput} />
            <Field label="Minute" name="minute" type="number" min={0} max={59} step={5} defaultValue={rule.minute} className={compactInput} />
            <Checkbox name="enabled" label="Enabled" defaultChecked={rule.enabled} />
            <div className="flex flex-wrap gap-1">
              <IconButton type="submit" icon={Check} label={`Save ${weekdays[rule.weekday]} slot`} disabled={pending} />
              <IconButton type="button" icon={Trash2} label={`Delete ${weekdays[rule.weekday]} slot`} disabled={pending} onClick={() => confirm(`Delete the ${weekdays[rule.weekday]} ${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')} posting time? Existing queued posts will keep their times.`) && run(() => deleteSlotRuleAction(slug, rule.id), 'Posting time deleted. Existing queued posts were not changed.')} />
            </div>
          </form>
          </details>
        ))}</div> : <div className="mt-6"><EmptyState eyebrow="No posting times" title="Add your first slot">Queue posts need at least one weekly publishing time.</EmptyState></div>}
        {canManage && <form onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          run(() => createSlotRuleAction(slug, formData), 'Posting time added.');
        }} className="mt-6 grid grid-cols-1 items-end gap-3 border-t border-hairline pt-6 md:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
          <Select name="weekday" label="Day" className={compactInput}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select>
          <Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={9} className={compactInput} />
          <Field label="Minute" name="minute" type="number" min={0} max={59} step={5} defaultValue={0} className={compactInput} />
          <Button type="submit" disabled={pending}>Add slot</Button>
        </form>}
      </section>

      <section className="b88-card mt-6">
        <p className="b88-eyebrow">Recurring schedules</p><h2 className="b88-heading mt-2">Repeating content</h2>
        <p className="mt-2 text-sm">Edit an occurrence from its post detail without changing the series. Editing the series replaces all future, unpublished occurrences.</p>
        <div className="mt-6 space-y-4">{recurrences.map((recurrence) => editing === recurrence.id ? (
          <RecurrenceForm key={recurrence.id} slug={slug} recurrence={recurrence} accounts={accounts} campaigns={campaigns} pending={pending} run={run} onCancel={() => setEditing(null)} />
        ) : (
          <article key={recurrence.id} className="rounded-md bg-surface-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-[480]">{recurrence.name}</h3><p className="b88-caption mt-1">{recurrenceFrequencyLabel(recurrence)} · {String(recurrence.hour).padStart(2, '0')}:{String(recurrence.minute).padStart(2, '0')} · {timezone}</p></div><Badge tone={recurrence.status === 'ACTIVE' ? 'lilac' : 'outline'}>{recurrence.status === 'ACTIVE' ? 'Active' : recurrence.status === 'PAUSED' ? 'Paused' : 'Ended'}</Badge></div>
            {canManage && <div className="mt-3 flex flex-wrap gap-1">
              <Button type="button" variant="tertiary" disabled={pending} onClick={() => setEditing(recurrence.id)}><Pencil size={16} strokeWidth={1.75} /> Edit series</Button>
              <Button type="button" variant="tertiary" disabled={pending} onClick={() => run(() => setRecurrenceStatusAction(slug, recurrence.id, recurrence.status === 'ACTIVE'), recurrence.status === 'ACTIVE' ? 'Series paused. Upcoming occurrences will not publish.' : 'Series resumed. Upcoming occurrences are scheduled again.')}>{recurrence.status === 'ACTIVE' ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}{recurrence.status === 'ACTIVE' ? 'Pause' : 'Resume'}</Button>
              <Button type="button" variant="tertiary" disabled={pending} onClick={() => confirm('Delete this series and all future unpublished occurrences? Published history will be kept.') && run(() => deleteRecurrenceAction(slug, recurrence.id), 'Series and future occurrences deleted.')}><Trash2 size={16} strokeWidth={1.75} /> Delete series</Button>
            </div>}
            <div className="mt-4 border-t border-hairline pt-4">
              <p className="b88-label">Upcoming occurrences</p>
              {recurrence.occurrences.length ? <ul className="mt-2 space-y-2">{recurrence.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="flex flex-wrap items-center gap-2 rounded-md bg-canvas p-3">
                  <span className="min-w-0 flex-1 text-sm"><span className="font-[480]">{DateTime.fromISO(occurrence.scheduledAt).setZone(timezone).toFormat('ccc d LLL, HH:mm')}</span><span className="b88-caption ml-2">{postStatusLabel(occurrence.status)}</span></span>
                  <Button href={`/w/${slug}/calendar?post=${occurrence.id}`} variant="tertiary">Open & edit</Button>
                  {canManage && !['PUBLISHED', 'PUBLISHING', 'CANCELLED'].includes(occurrence.status) && <>
                    <Button type="button" variant="tertiary" disabled={pending} onClick={() => confirm('Skip this occurrence? The rest of the series will stay unchanged.') && run(() => skipRecurrenceOccurrenceAction(slug, recurrence.id, occurrence.id), 'Occurrence skipped. The series was not changed.')}><CalendarX size={16} strokeWidth={1.75} /> Skip</Button>
                    <Button type="button" variant="tertiary" disabled={pending} onClick={() => confirm('Permanently delete this occurrence? The rest of the series will stay unchanged.') && run(() => deleteRecurrenceOccurrenceAction(slug, recurrence.id, occurrence.id), 'Occurrence deleted. The series was not changed.')}><Trash2 size={16} strokeWidth={1.75} /> Delete</Button>
                  </>}
                </li>
              ))}</ul> : <p className="mt-2 text-sm">{recurrence.status === 'PAUSED' ? 'This series is paused. Resume it to schedule upcoming occurrences.' : 'No upcoming occurrences are generated yet.'}</p>}
            </div>
          </article>
        ))}</div>
        {!recurrences.length && <EmptyState eyebrow="No recurring content" title="Create your first series">Choose a pattern, publishing time, start date, and optional end date below.</EmptyState>}
        {canManage && editing === null && <details className="mt-6 border-t border-hairline pt-4" open={!recurrences.length}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-[480]">Create a recurring series</summary>
          <div className="mt-3"><RecurrenceForm slug={slug} accounts={accounts} campaigns={campaigns} pending={pending} run={run} /></div>
        </details>}
      </section>
    </>
  );
}

function RecurrenceForm({
  slug, recurrence, accounts, campaigns, pending, run, onCancel,
}: {
  slug: string;
  recurrence?: Recurrence;
  accounts: Option[];
  campaigns: Option[];
  pending: boolean;
  run: (work: () => Promise<unknown>, success?: string) => void;
  onCancel?: () => void;
}) {
  const action = recurrence ? updateRecurrenceAction.bind(null, slug, recurrence.id) : createRecurrenceAction.bind(null, slug);
  const [frequency, setFrequency] = useState(recurrence?.frequency ?? 'weekly');
  return <form onSubmit={(event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(async () => {
      await action(formData);
      onCancel?.();
    }, recurrence ? 'Series updated. Future unpublished occurrences were replaced.' : 'Recurring series created.');
  }} className="grid gap-4 rounded-md bg-surface-soft p-4 md:grid-cols-2">
    <Field label="Schedule name" name="name" required defaultValue={recurrence?.name} />
    <Field label="Post title" name="title" defaultValue={recurrence?.title} />
    <Select label="Account" required name="socialAccountId" defaultValue={recurrence?.socialAccountId}><option value="">Choose account</option>{accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
    <Select label="Campaign" name="campaignId" defaultValue={recurrence?.campaignId}><option value="">No campaign</option>{campaigns.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
    <label className="block md:col-span-2"><span className="b88-label">Post copy</span><textarea required name="text" className="b88-input mt-2 min-h-28" defaultValue={recurrence?.text} /></label>
    <Select label="Repeats" name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Recurrence['frequency'])}>
      <option value="weekly">On selected weekdays</option>
      <option value="weekdays">Every weekday</option>
      <option value="monthly">Every month on the start date’s day</option>
    </Select>
    <div className="self-end pb-3 text-sm">
      {frequency === 'weekdays' ? 'Monday through Friday.' : frequency === 'monthly' ? 'For shorter months, dates such as the 31st are skipped.' : 'Choose one or more days below.'}
    </div>
    {frequency === 'weekly' && <fieldset className="md:col-span-2"><legend className="b88-label">Publishing days</legend><div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4 md:grid-cols-7">{weekdays.map((day, index) => <Checkbox key={day} name="weekdays" value={index} label={day.slice(0, 3)} defaultChecked={recurrence?.weekdays.includes(index)} containerClassName="rounded-md px-2 hover:bg-canvas" />)}</div></fieldset>}
    <div className="grid grid-cols-2 gap-3"><Field label="Hour" name="hour" type="number" min={0} max={23} defaultValue={recurrence?.hour ?? 9} /><Field label="Minute" name="minute" type="number" min={0} max={59} defaultValue={recurrence?.minute ?? 0} /></div>
    <div className="grid grid-cols-2 gap-3"><Field label="Starts" name="startDate" type="date" required defaultValue={recurrence?.startDate ?? DateTime.now().toISODate()!} /><Field label="Ends (optional)" name="endDate" type="date" defaultValue={recurrence?.endDate} /></div>
    <div className="flex flex-wrap gap-2 md:col-span-2"><Button type="submit" disabled={pending}>{recurrence ? 'Save series' : 'Create recurring series'}</Button>{onCancel && <Button type="button" variant="tertiary" disabled={pending} onClick={onCancel}>Cancel</Button>}</div>
  </form>;
}

function recurrenceFrequencyLabel(recurrence: Recurrence) {
  if (recurrence.frequency === 'weekdays') return 'Every weekday';
  if (recurrence.frequency === 'monthly') return `Monthly on day ${Number(recurrence.startDate.slice(-2))}`;
  return recurrence.weekdays.map((day) => weekdays[day].slice(0, 3)).join(', ');
}

function postStatusLabel(status: string) {
  return {
    DRAFT: 'Paused',
    SCHEDULED: 'Scheduled',
    CANCELLED: 'Skipped',
    PUBLISHING: 'Publishing',
    PUBLISHED: 'Published',
    FAILED: 'Failed',
  }[status] ?? 'Pending';
}
