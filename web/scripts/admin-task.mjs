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
    const runs = await db.workflowRun.findMany({
      where: { workflowId: w.id, startedAt: { gte: since } },
      select: { startedAt: true, trigger: true, status: true },
      orderBy: { startedAt: 'desc' },
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
    for (const r of scheduled.slice(0, 8)) console.log(`     ${r.startedAt.toISOString().slice(5, 16)}  ${r.status}`);
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

const tasks = { 'run-report': runReport, 'schedule-report': scheduleReport, 'inspect-workflow': inspectWorkflow, 'create-story-workflow': createStoryWorkflow, 'model-report': modelReport };

const run = tasks[task];
if (!run) {
  console.error(`unknown task ${JSON.stringify(task)}; known: ${Object.keys(tasks).join(', ')}`);
  process.exitCode = 1;
} else {
  await run();
}
await db.$disconnect();
