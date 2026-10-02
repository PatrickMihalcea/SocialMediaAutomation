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

const tasks = { 'inspect-workflow': inspectWorkflow };

const run = tasks[task];
if (!run) {
  console.error(`unknown task ${JSON.stringify(task)}; known: ${Object.keys(tasks).join(', ')}`);
  process.exitCode = 1;
} else {
  await run();
}
await db.$disconnect();
