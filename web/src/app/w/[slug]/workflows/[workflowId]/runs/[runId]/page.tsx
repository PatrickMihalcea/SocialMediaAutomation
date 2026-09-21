import { Suspense } from 'react';
import Link from 'next/link';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { readSnapshot, toGraph } from '@/lib/workflows/snapshot';
import { descendantsOf, indegrees, successorsOf } from '@/lib/workflows/graph';
import { WorkflowRunView } from '@/components/workflow-run-view';
import { postsForRun } from '@/lib/workflows/run-posts';
import { storage } from '@/lib/storage';
import { hasReviewableOutput } from '@/lib/workflows/node-output';

export const metadata = { title: 'Workflow run' };

export default function RunPage({
  params,
}: {
  params: Promise<{ slug: string; workflowId: string; runId: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-[480px]" />}>
      <RunDetail params={params} />
    </Suspense>
  );
}

async function RunDetail({
  params,
}: {
  params: Promise<{ slug: string; workflowId: string; runId: string }>;
}) {
  const { slug, workflowId, runId } = await params;
  const ctx = await requireWorkspace(slug, 'workflow:view');

  const run = await db.workflowRun.findFirst({
    where: { id: runId, workflowId, workspaceId: ctx.workspace.id },
    include: {
      workflow: { select: { name: true } },
      nodeRuns: {
        orderBy: { createdAt: 'asc' },
        // What each step produced, so the run view can link to the thing
        // rather than just reporting that it succeeded. Ordered so the first
        // asset is the one the step's primary output port emitted.
        include: {
          producedAssets: {
            orderBy: [{ port: 'asc' }, { position: 'asc' }],
            include: {
              mediaAsset: {
                // Dimensions and a key to sign: a run that generated pictures
                // should show the pictures, not a list of filenames.
                select: {
                  id: true,
                  filename: true,
                  type: true,
                  width: true,
                  height: true,
                  thumbnailKey: true,
                  storageKey: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!run) throw notFound('That run no longer exists.');

  const graph = toGraph(readSnapshot(run.graph));
  const posts = await postsForRun(ctx.workspace.id, run.nodeRuns);
  const previews = await previewUrls(run.nodeRuns);

  return (
    <>
      <div>
        <p className="b88-eyebrow">
          <Link href={`/w/${slug}/workflows/${workflowId}`}>{run.workflow.name}</Link>
        </p>
        <h1 className="b88-page-title mt-3">Run</h1>
      </div>

      <WorkflowRunView
        slug={slug}
        workflowId={workflowId}
        canRun={ctx.can('workflow:run')}
        levels={levelsOf(graph)}
        replay={replayPlan(graph)}
        initial={{
          serverNow: Date.now(),
          run: {
            id: run.id,
            status: run.status,
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            durationMs: run.durationMs,
            error: run.error,
          },
          nodes: run.nodeRuns.map((node) => ({
            id: node.id,
            nodeId: node.nodeId,
            nodeName: node.nodeName,
            nodeType: node.nodeType,
            status: node.status,
            attempt: node.attempt,
            maxAttempts: node.maxAttempts,
            startedAt: node.startedAt?.toISOString() ?? null,
            finishedAt: node.finishedAt?.toISOString() ?? null,
            durationMs: node.durationMs,
            error: node.error,
            hasOutput: hasReviewableOutput(node.output),
            produced: node.producedAssets.map((link) => ({
              id: link.mediaAsset.id,
              filename: link.mediaAsset.filename,
              type: link.mediaAsset.type,
              width: link.mediaAsset.width,
              height: link.mediaAsset.height,
              url: previews.get(link.mediaAsset.id) ?? null,
            })),
            // Read from the posts table, not from this node's frozen output:
            // approving a post has to stop this row saying "Waiting for you".
            post: posts.get(node.id) ?? null,
          })),
        }}
      />
    </>
  );
}

/**
 * What playing from each step would actually re-run.
 *
 * Computed here because the graph is here: the run view has only a flat list of
 * steps, and "this also re-runs the four steps after it" is the part someone
 * needs before clicking, not after. The ids, not just a count, because the
 * view marks exactly those steps as waiting the moment the button is pressed.
 * `publishes` is called out separately —
 * everything else a replay touches can be done again, and a post cannot.
 */
function replayPlan(graph: ReturnType<typeof toGraph>): Record<string, { nodes: string[]; publishes: boolean }> {
  const typeOf = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const plan: Record<string, { nodes: string[]; publishes: boolean }> = {};
  for (const node of graph.nodes) {
    const affected = [node.id, ...descendantsOf(graph, node.id)];
    plan[node.id] = {
      nodes: affected,
      publishes: affected.some((id) => typeOf.get(id) === 'PUBLISH'),
    };
  }
  return plan;
}

/**
 * Groups nodes into dependency levels. Everything in one level is independent of
 * everything else in it, so the run view's rows show exactly what executes at
 * the same time rather than implying a false sequence.
 */
function levelsOf(graph: ReturnType<typeof toGraph>): string[][] {
  const remaining = indegrees(graph);
  const levels: string[][] = [];
  let current = graph.nodes.filter((n) => (remaining.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();

  while (current.length > 0) {
    levels.push(current);
    current.forEach((id) => seen.add(id));

    const next: string[] = [];
    for (const id of levels[levels.length - 1]) {
      for (const successor of successorsOf(graph, id)) {
        const left = (remaining.get(successor) ?? 0) - 1;
        remaining.set(successor, left);
        if (left === 0 && !seen.has(successor)) next.push(successor);
      }
    }
    current = [...new Set(next)];
  }

  // A cycle should be impossible by now, but an orphan must still be shown.
  const orphans = graph.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (orphans.length) levels.push(orphans);
  return levels;
}

/**
 * One signed URL per produced asset, thumbnail where there is one.
 *
 * Signed in a batch here rather than per row in the client: these expire, so
 * they cannot be cached in the run snapshot, and a picture is the fastest way
 * to see whether a generation step did what you asked.
 */
async function previewUrls(
  nodeRuns: { producedAssets: { mediaAsset: { id: string; thumbnailKey: string | null; storageKey: string; type: string } }[] }[],
): Promise<Map<string, string>> {
  const assets = new Map<string, { key: string }>();
  for (const node of nodeRuns) {
    for (const link of node.producedAssets) {
      const asset = link.mediaAsset;
      // Audio has no still worth showing, and a signed URL for one is wasted work.
      if (asset.type === 'AUDIO') continue;
      assets.set(asset.id, { key: asset.thumbnailKey ?? asset.storageKey });
    }
  }
  const signed = await Promise.all(
    [...assets].map(async ([id, { key }]) => [id, await storage().signedUrl(key)] as const),
  );
  return new Map(signed);
}
