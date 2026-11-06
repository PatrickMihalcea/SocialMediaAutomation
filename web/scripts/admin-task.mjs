/**
 * One-off administrative tasks against the live database.
 *
 * Run from .github/workflows/admin.yml, never from a laptop: the connection
 * string is a repository secret and GitHub is the only place it exists in a
 * usable form — Vercel marks it Sensitive, which means it can be written and
 * never read back. So the work goes to the credential rather than the other
 * way round.
 *
 * Every task is explicit and named. Nothing here runs on a schedule.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const task = process.env.ADMIN_TASK ?? '';
const name = process.env.WORKFLOW_NAME ?? '';

/** Prints a workflow's graph, so it can be read without database access. */
async function inspectWorkflow() {
  const wf = await db.workflow.findFirst({
    where: { name: { contains: name, mode: 'insensitive' }, archivedAt: null },
    include: { nodes: { orderBy: { positionX: 'asc' } }, edges: true },
  });
  if (!wf) {
    console.log(`no workflow matching "${name}"`);
    const all = await db.workflow.findMany({ where: { archivedAt: null }, select: { name: true } });
    console.log('available:', all.map((w) => w.name).join(' | '));
    return;
  }

  console.log(`workflow: ${wf.name}  (${wf.id})`);
  console.log(`enabled=${wf.enabled} scheduleEnabled=${wf.scheduleEnabled} weekdays=${JSON.stringify(wf.scheduleWeekdays)} times=${JSON.stringify(wf.scheduleTimes)}`);
  console.log('\nNODES');
  for (const n of wf.nodes) {
    console.log(`  ${n.id}`);
    console.log(`    type=${n.type}  name=${JSON.stringify(n.name)}  pos=(${n.positionX},${n.positionY})`);
    console.log(`    config=${JSON.stringify(n.config)}`);
  }
  const byId = new Map(wf.nodes.map((n) => [n.id, n.name]));
  console.log('\nEDGES');
  for (const e of wf.edges) {
    console.log(`  ${byId.get(e.sourceNodeId)}.${e.sourcePort}  ->  ${byId.get(e.targetNodeId)}.${e.targetPort}`);
  }
}

/**
 * Builds a story workflow from an existing one.
 *
 * The shape the reference input exists for: invent a cast once, draw it once,
 * then render every scene against that one picture. A description cannot hold
 * a cast together — the same three characters written seven times come back as
 * seven different trios — so the picture is what carries them.
 *
 * Everything downstream of the images is copied from the source unchanged:
 * the track, the slideshow, the overlay and the publish step are already how
 * this account wants them.
 */
async function createStoryWorkflow() {
  const source = await db.workflow.findFirst({
    where: { name: { contains: name, mode: 'insensitive' }, archivedAt: null },
    include: { nodes: true, edges: true },
  });
  if (!source) return console.log(`no workflow matching "${name}"`);

  const target = process.env.NEW_WORKFLOW_NAME || `${source.name} — story`;
  const clash = await db.workflow.findFirst({ where: { workspaceId: source.workspaceId, name: target } });
  if (clash) return console.log(`"${target}" already exists (${clash.id}); nothing done`);

  const from = (type) => source.nodes.find((n) => n.type === type);
  const ideas = from('IDEA_GENERATOR');
  const images = from('IMAGE_GENERATOR');
  if (!ideas || !images) return console.log('the source has no idea or image step to copy settings from');

  // Their own look and their own subject pool, carried over rather than retyped.
  const style = images.config.style ?? '';
  const size = images.config.size ?? '1024x1820';
  const provider = images.config.provider ?? 'image-use';
  const pool = ideas.config.themePool ?? [];
  const count = ideas.config.count ?? 7;

  const CAST_GUIDANCE = [
    'Write exactly one entry. It describes the recurring cast this whole set features — the characters, creatures or objects that appear in every image.',
    'Name them, and describe only what is visible: build, face, hair, clothing, armour, colours, and the one detail that makes each recognisable at a glance.',
    'Do not describe a scene, a setting or an action. This is the sheet every later image is drawn against, nothing more.',
    ideas.config.promptGuidance ?? '',
  ].join(' ');

  const SCENE_GUIDANCE = [
    'Each entry is one moment from a story featuring the cast named in the theme.',
    'Do not describe what the characters look like — a reference image carries their appearance, and describing them again is what makes a set drift apart.',
    'Describe the setting, what is happening, the composition and the light. Change the location and the time of day between entries so the set reads as a journey rather than one scene repeated.',
    ideas.config.promptGuidance ?? '',
  ].join(' ');

  const created = await db.workflow.create({
    data: {
      workspaceId: source.workspaceId,
      createdById: source.createdById,
      name: target,
      description: 'Invents a cast, draws it once, then renders every scene against that picture.',
      // Off, and on no schedule: this is reviewed by hand before it posts.
      enabled: false,
      scheduleEnabled: false,
      scheduleWeekdays: [],
      scheduleTimes: [],
      timezone: source.timezone,
    },
    select: { id: true },
  });

  const spec = [
    ['cast',    'IDEA_GENERATOR',  'Invent the cast',   -820, 190, { ...ideas.config, count: 1, promptGuidance: CAST_GUIDANCE, additionalOutputs: [{ id: 'subject', label: 'The subject' }] }],
    ['draw',    'IMAGE_GENERATOR', 'Draw the cast',     -470,  40, { size, style, provider, maxImages: 1, referenceUse: 'layout', useMockGeneration: false }],
    ['scenes',  'IDEA_GENERATOR',  'Write the scenes',  -470, 340, { ...ideas.config, count, themeMode: 'fixed', theme: '', promptGuidance: SCENE_GUIDANCE, additionalOutputs: [] }],
    ['story',   'IMAGE_GENERATOR', 'Render the story',   -60, 190, { size, style, provider, maxImages: count, referenceUse: 'subject', useMockGeneration: false }],
  ];
  // Everything from the pictures onward is the source's, unchanged.
  for (const n of source.nodes) {
    if (n.type === 'IDEA_GENERATOR' || n.type === 'IMAGE_GENERATOR') continue;
    spec.push([n.id, n.type, n.name, n.positionX, n.positionY, n.config]);
  }

  const id = {};
  for (const [key, type, nodeName, x, y, config] of spec) {
    const node = await db.workflowNode.create({
      data: { workspaceId: source.workspaceId, workflowId: created.id, type, name: nodeName, config, positionX: x, positionY: y },
      select: { id: true },
    });
    id[key] = node.id;
  }

  const sourceKey = (nodeId) => {
    const n = source.nodes.find((x) => x.id === nodeId);
    if (!n) return null;
    if (n.type === 'IDEA_GENERATOR') return 'scenes';   // post copy comes from the scenes
    if (n.type === 'IMAGE_GENERATOR') return 'story';
    return n.id;
  };

  const wires = [
    [id.cast,   'prompts', id.draw,  'prompts'],
    [id.cast,   'subject', id.scenes, 'theme'],
    [id.scenes, 'prompts', id.story, 'prompts'],
    [id.draw,   'images',  id.story, 'reference'],
  ];
  // The source's own wiring, with its idea and image steps re-pointed.
  for (const e of source.edges) {
    const s = sourceKey(e.sourceNodeId);
    const t = sourceKey(e.targetNodeId);
    if (!s || !t) continue;
    if (s === 'scenes' && t === 'story') continue;      // replaced by the pair above
    wires.push([id[s], e.sourcePort, id[t], e.targetPort]);
  }

  for (const [sourceNodeId, sourcePort, targetNodeId, targetPort] of wires) {
    await db.workflowEdge.create({
      data: { workspaceId: source.workspaceId, workflowId: created.id, sourceNodeId, sourcePort, targetNodeId, targetPort },
    });
  }

  const byId = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, spec.find((s) => s[0] === k)[2]]));
  console.log(`created "${target}"  (${created.id})  — disabled, no schedule`);
  console.log(`steps: ${spec.length}, connections: ${wires.length}`);
  for (const [s, sp, t, tp] of wires) console.log(`  ${byId[s]}.${sp}  ->  ${byId[t]}.${tp}`);
}

/**
 * Why a schedule did not fire as often as it asks to.
 *
 * Six slots a day against the runs that actually happened, plus where the next
 * one is booked. Nothing in the app watches a clock: slots are noticed only
 * when a worker pass happens to run, and a pass that arrives late fires the
 * slot it finds and books the next future one — so every slot that went by
 * without a pass is not late, it is gone.
 */
async function scheduleReport() {
  const now = new Date();
  const wfs = await db.workflow.findMany({
    where: { scheduleEnabled: true, archivedAt: null },
    select: {
      id: true, name: true, enabled: true, timezone: true,
      scheduleWeekdays: true, scheduleTimes: true, scheduleHour: true, scheduleMinute: true,
      nextRunAt: true, lastRunAt: true,
    },
  });
  console.log(`now (UTC): ${now.toISOString()}\n`);

  for (const w of wfs) {
    const times = (w.scheduleTimes?.length ? w.scheduleTimes : [w.scheduleHour * 60 + w.scheduleMinute])
      .map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const slotsPerDay = times.length * (w.scheduleWeekdays?.length ?? 0) / 7;

    const since = new Date(now.getTime() - 24 * 3600_000);
    // By creation, not start: a run booked by the scheduler and still waiting
    // for a worker has no start time yet, and filtering on one hid exactly the
    // runs this report exists to find.
    const runs = await db.workflowRun.findMany({
      where: { workflowId: w.id, createdAt: { gte: since } },
      select: { createdAt: true, startedAt: true, trigger: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    const scheduled = runs.filter((r) => r.trigger === 'SCHEDULE');

    console.log(`${w.name}  (${w.id})`);
    console.log(`  enabled=${w.enabled}  zone=${w.timezone}`);
    console.log(`  slots: ${times.join(', ')}  on ${w.scheduleWeekdays?.length ?? 0} day(s)  = ${slotsPerDay.toFixed(0)} a day`);
    console.log(`  nextRunAt: ${w.nextRunAt ? w.nextRunAt.toISOString() : 'NULL — the scan can never see it'}`);
    if (w.nextRunAt) {
      const mins = Math.round((now - w.nextRunAt) / 60000);
      console.log(`             ${mins > 0 ? `OVERDUE by ${mins} min` : `due in ${-mins} min`}`);
    }
    console.log(`  lastRunAt: ${w.lastRunAt ? w.lastRunAt.toISOString() : 'never'}`);
    console.log(`  in the last 24h: ${scheduled.length} scheduled run(s) against ${slotsPerDay.toFixed(0)} slots`);
    for (const r of runs.slice(0, 10)) {
      console.log(`     created ${r.createdAt.toISOString().slice(5, 16)}  started ${r.startedAt ? r.startedAt.toISOString().slice(11, 16) : '—    '}  ${r.trigger.padEnd(8)} ${r.status}`);
    }
    console.log('');
  }
}

/**
 * Which model production has actually been calling.
 *
 * The model is a Sensitive environment variable, so it cannot be read back
 * from Vercel — but every call records the model the API answered with, which
 * is the better answer anyway: it is what ran, not what was configured.
 */
async function modelReport() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const rows = await db.aiGeneration.groupBy({
    by: ['operation', 'model'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true, estimatedCost: true },
  });
  rows.sort((a, b) => a.operation.localeCompare(b.operation) || b._count._all - a._count._all);

  console.log('last 30 days\n');
  for (const r of rows) {
    const cost = r._sum.estimatedCost ? `$${Number(r._sum.estimatedCost).toFixed(2)}` : '—';
    console.log(
      `${r.operation.padEnd(12)} ${r.model.padEnd(28)} ${String(r._count._all).padStart(5)} calls  ` +
      `in ${r._sum.promptTokens ?? 0}  out ${r._sum.completionTokens ?? 0}  ${cost}`,
    );
  }
}

/**
 * The latest run of a named workflow, step by step.
 *
 * Reads what actually happened rather than what the canvas says would: which
 * steps ran, what each one produced, where one stopped and what it said. The
 * run page shows this too, but only to someone signed in — this is the same
 * answer from the side the database is on.
 */
async function runReport() {
  const wf = await db.workflow.findFirst({
    where: { name: { contains: name, mode: 'insensitive' }, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!wf) {
    const all = await db.workflow.findMany({ where: { archivedAt: null }, select: { name: true } });
    console.log(`no workflow matching "${name}"`);
    console.log('available:', all.map((w) => w.name).join(' | '));
    return;
  }

  const run = await db.workflowRun.findFirst({
    where: { workflowId: wf.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, trigger: true, startedAt: true, finishedAt: true, error: true, createdAt: true },
  });
  if (!run) {
    console.log(`${wf.name}: no runs`);
    return;
  }

  const mins = (a, b) => (a && b ? `${Math.round((b - a) / 60000)} min` : '');
  console.log(`${wf.name}`);
  console.log(`run ${run.id.slice(0, 8)}  ${run.status}  trigger=${run.trigger}`);
  console.log(`started ${run.startedAt?.toISOString() ?? '—'}  ${run.finishedAt ? `finished ${run.finishedAt.toISOString()} (${mins(run.startedAt, run.finishedAt)})` : `still going (${mins(run.startedAt, new Date())})`}`);
  if (run.error) console.log(`run error: ${run.error}`);

  const steps = await db.workflowNodeRun.findMany({
    where: { runId: run.id },
    orderBy: [{ startedAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      nodeName: true, nodeType: true, status: true, attempt: true, maxAttempts: true,
      error: true, startedAt: true, finishedAt: true, heartbeatAt: true, output: true, config: true,
    },
  });

  console.log('\nSTEPS');
  for (const s of steps) {
    const out = s.output ?? {};
    const shape = Object.entries(out)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v)?.slice(0, 60)}`)
      .join('  ');
    console.log(`  ${s.status.padEnd(9)} ${s.nodeName}  (${s.nodeType})  attempt ${s.attempt}/${s.maxAttempts}  ${mins(s.startedAt, s.finishedAt ?? new Date())}`);
    const cfg = s.config ?? {};
    const interesting = ['count', 'maxImages', 'referenceUse', 'temperature', 'mode'].filter((k) => cfg[k] !== undefined);
    if (interesting.length) console.log(`            config: ${interesting.map((k) => `${k}=${JSON.stringify(cfg[k])}`).join('  ')}`);
    if (shape) console.log(`            output: ${shape}`);
    if (s.error) console.log(`            error: ${s.error}`);
    if (s.status === 'RUNNING') {
      const stale = s.heartbeatAt ? Math.round((Date.now() - s.heartbeatAt) / 60000) : null;
      console.log(`            heartbeat: ${stale === null ? 'never' : `${stale} min ago`}`);
      const p = (s.output ?? {})._progress;
      if (p) console.log(`            progress: ${p.done ?? '?'} / ${p.total ?? '?'}  ${p.stage ?? ''}`);
    }
  }
}

/**
 * Every video already published to Facebook, and whether it went out as a
 * Reel. Read-only: answers "how many would need reposting" before anyone
 * decides to repost them.
 */
async function facebookVideos() {
  const rows = await db.postPlatform.findMany({
    where: { platform: 'FACEBOOK', status: 'PUBLISHED' },
    orderBy: { publishedAt: 'asc' },
    select: {
      publishedAt: true,
      platformPostId: true,
      platformUrl: true,
      socialAccount: { select: { accountName: true } },
      media: { select: { mediaAsset: { select: { type: true, width: true, height: true, duration: true } } } },
    },
  });
  const videos = rows.filter((r) => r.media.some((m) => m.mediaAsset?.type === 'VIDEO'));
  const reels = videos.filter((r) => (r.platformUrl ?? '').includes('/reel/'));
  console.log(`published to Facebook: ${rows.length}   with a video: ${videos.length}   already Reels: ${reels.length}\n`);
  const byPage = {};
  for (const r of videos) {
    const page = r.socialAccount?.accountName ?? '?';
    byPage[page] = (byPage[page] ?? 0) + 1;
  }
  for (const [page, n] of Object.entries(byPage)) console.log(`  ${page}: ${n}`);
  console.log('');
  for (const r of videos) {
    const v = r.media.find((m) => m.mediaAsset?.type === 'VIDEO')?.mediaAsset;
    const shape = v ? `${v.width ?? '?'}x${v.height ?? '?'} ${v.duration != null ? `${Math.round(v.duration)}s` : '?s'}` : '';
    console.log(`  ${r.publishedAt?.toISOString().slice(0, 16) ?? '—'}  ${(r.platformUrl ?? '').includes('/reel/') ? 'REEL ' : 'VIDEO'}  ${shape.padEnd(16)} ${r.socialAccount?.accountName ?? ''}`);
  }
}

/** The UTC instant of a wall-clock time in a zone. */
function zonedToUtc(year, month, day, hour, minute, timeZone) {
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return asUtc - Math.floor(instant.getTime() / 60000) * 60000;
  };
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first));
}

/**
 * Reposts every plain Facebook video as a Reel, a few a day.
 *
 * Facebook cannot turn an existing video into a Reel, so each is posted again
 * — same video, same copy — through the ordinary scheduled queue, where it
 * shows on the calendar and can be cancelled like any other post. The old row
 * is marked as replaced; the publishing engine deletes the old video only
 * once its Reel is live.
 *
 * Plans by default and writes nothing. Booking needs REPOST_MODE=schedule,
 * and a video already booked is never booked twice.
 */
async function repostFacebookReels() {
  const mode = process.env.REPOST_MODE === 'schedule' ? 'schedule' : 'plan';
  const perPagePerDay = Math.max(1, Math.min(25, Number(process.env.REPOST_PER_DAY) || 5));

  const rows = await db.postPlatform.findMany({
    where: { platform: 'FACEBOOK', status: 'PUBLISHED' },
    orderBy: { publishedAt: 'asc' },
    include: {
      post: { select: { title: true, authorId: true, workspaceId: true, workspace: { select: { timezone: true } } } },
      socialAccount: { select: { accountName: true } },
      media: true,
    },
  });
  const assets = new Map((await db.mediaAsset.findMany({
    where: { id: { in: rows.flatMap((r) => r.media.map((m) => m.mediaAssetId)) } },
    select: { id: true, type: true, width: true, height: true, duration: true, status: true },
  })).map((a) => [a.id, a]));

  const reelable = (a) => a && a.type === 'VIDEO' && a.status === 'READY'
    && !(a.duration != null && (a.duration < 3 || a.duration > 90))
    && !(a.width != null && a.height != null && (a.width >= a.height || a.width < 540 || a.height < 960));

  const candidates = rows.filter((r) => {
    const meta = r.responseMeta ?? {};
    if (meta.replacedBy || meta.retiredAt) return false;
    if ((r.platformUrl ?? '').includes('/reel/')) return false;
    return r.media.some((m) => reelable(assets.get(m.mediaAssetId)));
  });
  const skipped = rows.length - candidates.length;

  // Alternate between Pages so neither gets a day of nothing but reposts.
  const byPage = new Map();
  for (const r of candidates) {
    if (!byPage.has(r.socialAccountId)) byPage.set(r.socialAccountId, []);
    byPage.get(r.socialAccountId).push(r);
  }
  const queues = [...byPage.values()].map((list) => [...list]);
  const order = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) order.push(q.shift());

  const zones = new Set(order.map((r) => r.post.workspace.timezone));
  if (zones.size > 1) throw new Error(`these posts span more than one workspace zone: ${[...zones].join(', ')}`);
  const zone = [...zones][0] ?? 'UTC';

  // Even slots between 09:20 and 21:20 local, starting tomorrow. Off the hour
  // so they do not land on top of the workflows, which fire on the hour.
  const perDay = perPagePerDay * Math.max(1, byPage.size);
  const gap = (12 * 60) / perDay;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date()).split('-').map(Number);
  // A fixed gap from now, round the clock, when one is asked for: the day
  // slots below exist for a rollout spread over weeks, not one over days.
  const intervalMin = Number(process.env.REPOST_INTERVAL_MIN) || 0;
  const startAt = Date.now() + 2 * 60 * 1000;
  const slotFor = (index) => {
    if (intervalMin > 0) return new Date(startAt + index * intervalMin * 60 * 1000);
    const day = Math.floor(index / perDay) + 1;
    const minutes = 9 * 60 + 20 + Math.round((index % perDay) * gap);
    const date = new Date(Date.UTC(today[0], today[1] - 1, today[2] + day));
    return zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Math.floor(minutes / 60), minutes % 60, zone);
  };

  const fmt = (d) => new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  console.log(`mode: ${mode.toUpperCase()}${mode === 'plan' ? ' (nothing is written)' : ''}`);
  console.log(`zone: ${zone}`);
  console.log(`to repost: ${order.length}   left alone: ${skipped} (already Reels, already booked, or not Reel-shaped)`);
  for (const [, list] of byPage) console.log(`  ${list[0]?.socialAccount?.accountName ?? '?'}: ${list.length}`);
  console.log(intervalMin > 0
    ? `pace: one every ${intervalMin} min, round the clock`
    : `pace: ${perPagePerDay} per Page per day = ${perDay} a day across ${byPage.size} Page(s)`);
  if (order.length) {
    const days = intervalMin > 0
      ? ((order.length - 1) * intervalMin / 1440).toFixed(1)
      : String(Math.ceil(order.length / perDay));
    console.log(`first: ${fmt(slotFor(0))}   last: ${fmt(slotFor(order.length - 1))}   (${days} days)`);
    console.log('\nfirst few:');
    for (let i = 0; i < Math.min(intervalMin > 0 ? 6 : perDay, order.length); i++) {
      console.log(`  ${fmt(slotFor(i)).padEnd(18)} ${order[i].socialAccount?.accountName ?? ''}   (originally ${order[i].publishedAt?.toISOString().slice(0, 10)})`);
    }
  }
  if (mode !== 'schedule') return;

  let booked = 0;
  for (const [i, old] of order.entries()) {
    const scheduledAt = slotFor(i);
    await db.$transaction(async (tx) => {
      // Re-read inside the transaction: a run that overlaps this one must not
      // book the same video twice.
      const fresh = await tx.postPlatform.findUnique({ where: { id: old.id }, select: { responseMeta: true } });
      if (fresh?.responseMeta?.replacedBy) return;

      const post = await tx.post.create({
        data: {
          workspaceId: old.workspaceId,
          authorId: old.post.authorId,
          title: old.post.title,
          status: 'SCHEDULED',
          scheduledAt,
          timezone: zone,
        },
      });
      const platform = await tx.postPlatform.create({
        data: {
          postId: post.id,
          workspaceId: old.workspaceId,
          socialAccountId: old.socialAccountId,
          platform: 'FACEBOOK',
          text: old.text,
          firstComment: old.firstComment,
          hashtags: old.hashtags,
          mentions: old.mentions,
          link: old.link,
          idempotencyKey: randomUUID(),
          media: {
            create: old.media.map((m) => ({
              mediaAssetId: m.mediaAssetId,
              position: m.position,
              altText: m.altText,
              thumbnailOffset: m.thumbnailOffset,
              audioAssetId: m.audioAssetId,
              audioStart: m.audioStart,
            })),
          },
        },
      });
      await tx.postPlatform.update({
        where: { id: old.id },
        data: { responseMeta: { ...(old.responseMeta ?? {}), replacedBy: platform.id } },
      });
      booked += 1;
    });
  }
  console.log(`\nbooked ${booked} Reel(s). Each shows on the calendar and can be cancelled there.`);
}

/** The booked Reel reposts and the old rows they replace, for one Page or all. */
async function bookedReposts(pageFilter) {
  // Filtered here rather than with a JSON path query: "the key is present"
  // is easy to get subtly wrong in Prisma's JSON filters, and this is a few
  // hundred rows at most.
  const olds = (await db.postPlatform.findMany({
    where: {
      platform: 'FACEBOOK',
      ...(pageFilter ? { socialAccount: { accountName: { contains: pageFilter, mode: 'insensitive' } } } : {}),
    },
    select: { id: true, responseMeta: true, platformUrl: true, socialAccount: { select: { accountName: true } } },
  })).filter((row) => typeof row.responseMeta?.replacedBy === 'string');
  const reels = new Map((await db.postPlatform.findMany({
    where: { id: { in: olds.map((o) => o.responseMeta.replacedBy) } },
    select: { id: true, status: true, platformUrl: true, errorMessage: true, post: { select: { id: true, status: true, scheduledAt: true } } },
  })).map((r) => [r.id, r]));
  return olds.map((old) => ({ old, reel: reels.get(old.responseMeta.replacedBy) }));
}

/**
 * Moves the next few booked Reels for one Page to now, for a test run. The
 * minute clock picks them up from there like any other due post.
 */
async function repostNow() {
  const count = Math.max(1, Math.min(10, Number(process.env.REPOST_COUNT) || 5));
  if (!name.trim()) throw new Error('name a Page to pull reposts forward for');
  const pending = (await bookedReposts(name))
    .filter(({ reel }) => reel?.post?.status === 'SCHEDULED')
    .sort((a, b) => a.reel.post.scheduledAt - b.reel.post.scheduledAt)
    .slice(0, count);
  const now = new Date();
  for (const { reel } of pending) {
    await db.post.update({ where: { id: reel.post.id }, data: { scheduledAt: now } });
  }
  console.log(`moved ${pending.length} Reel(s) for "${name}" to ${now.toISOString()}; the clock publishes them within a minute or two`);
}

/** Where the Reel reposts have got to, Page by Page. */
async function repostStatus() {
  const rows = await bookedReposts(name.trim() && name !== 'dark fantasy' ? name : '');
  const pages = {};
  for (const { old, reel } of rows) {
    const page = old.socialAccount?.accountName ?? '?';
    const p = (pages[page] ??= { booked: 0, published: 0, failed: 0, waiting: 0, oldDeleted: 0, deleteErrors: [] , failures: [], live: [] });
    p.booked += 1;
    if (reel?.status === 'PUBLISHED') {
      p.published += 1;
      p.live.push(reel.platformUrl);
    } else if (reel?.status === 'FAILED') {
      p.failed += 1;
      p.failures.push(reel.errorMessage);
    } else p.waiting += 1;
    if (old.responseMeta.retiredAt) p.oldDeleted += 1;
    if (old.responseMeta.retireError) p.deleteErrors.push(old.responseMeta.retireError);
  }
  for (const [page, p] of Object.entries(pages)) {
    console.log(`${page}: booked ${p.booked}  published ${p.published}  failed ${p.failed}  waiting ${p.waiting}  old videos deleted ${p.oldDeleted}`);
    for (const url of p.live.slice(-5)) console.log(`   live: ${url}`);
    for (const e of p.failures.slice(0, 5)) console.log(`   FAILED: ${e}`);
    for (const e of p.deleteErrors.slice(0, 5)) console.log(`   DELETE ERROR: ${e}`);
  }
}

/**
 * Calls off every Reel repost that has not gone out yet.
 *
 * Cancels the booked post, and unlinks the old video it was going to replace,
 * so a cancelled booking can never cause an old video to be deleted later.
 * Reels already published are left exactly as they are.
 */
async function cancelReposts() {
  const pending = (await bookedReposts(name.trim() && name !== 'dark fantasy' ? name : ''))
    .filter(({ reel }) => reel?.post && reel.status !== 'PUBLISHED' && reel.post.status !== 'PUBLISHED');
  let cancelled = 0;
  for (const { old, reel } of pending) {
    await db.$transaction(async (tx) => {
      await tx.post.update({ where: { id: reel.post.id }, data: { status: 'CANCELLED', scheduledAt: null } });
      await tx.postPlatform.update({ where: { id: reel.id }, data: { status: 'CANCELLED' } });
      const { replacedBy: _unlinked, ...rest } = old.responseMeta;
      await tx.postPlatform.update({ where: { id: old.id }, data: { responseMeta: rest } });
    });
    cancelled += 1;
  }
  console.log(`cancelled ${cancelled} booked Reel(s); their old videos are unlinked and will not be touched`);
}

/**
 * Every connected Facebook and Instagram account, and for Instagram the
 * Facebook Page it is linked to. Meta only lets an Instagram professional
 * account be reached through the Page it is linked to, so this is the record
 * of which Page owns which Instagram account. Read-only; no tokens printed.
 */
async function accountsReport() {
  const rows = await db.socialAccount.findMany({
    where: { platform: { in: ['FACEBOOK', 'INSTAGRAM'] } },
    orderBy: [{ platform: 'asc' }, { accountName: 'asc' }],
    select: { platform: true, accountName: true, accountHandle: true, externalAccountId: true, status: true, metadata: true, createdAt: true },
  });
  for (const r of rows) {
    const meta = r.metadata ?? {};
    const linked = r.platform === 'INSTAGRAM' ? `   linked to Page: ${meta.pageName ?? '?'} (${meta.pageId ?? '?'})` : `   page id ${r.externalAccountId}`;
    console.log(`${r.platform.padEnd(9)} ${String(r.accountName ?? '').padEnd(22)} ${String(r.accountHandle ?? '').padEnd(22)} ${String(r.status ?? '').padEnd(10)} connected ${r.createdAt.toISOString().slice(0, 10)}${linked}`);
  }
}

const tasks = { 'accounts-report': accountsReport, 'cancel-reposts': cancelReposts, 'repost-now': repostNow, 'repost-status': repostStatus, 'repost-facebook-reels': repostFacebookReels, 'facebook-videos': facebookVideos, 'run-report': runReport, 'schedule-report': scheduleReport, 'inspect-workflow': inspectWorkflow, 'create-story-workflow': createStoryWorkflow, 'model-report': modelReport };

const run = tasks[task];
if (!run) {
  console.error(`unknown task ${JSON.stringify(task)}; known: ${Object.keys(tasks).join(', ')}`);
  process.exitCode = 1;
} else {
  await run();
}
await db.$disconnect();
