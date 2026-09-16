import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { postsForRun } from '@/lib/workflows/run-posts';

/**
 * Live status for one run.
 *
 * Deliberately narrow: status and timings only, never node `output`, which can
 * hold a long prompt list and would be re-sent every second.
 *
 * The client polls this rather than calling router.refresh() on an interval —
 * refreshing re-renders the whole RSC tree and would fight the canvas's own
 * node positions, selection and viewport.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; workflowId: string; runId: string }> },
) {
  const { slug, workflowId, runId } = await params;
  try {
    const ctx = await requireWorkspace(slug, 'workflow:view');

    const run = await db.workflowRun.findFirst({
      where: { id: runId, workflowId, workspaceId: ctx.workspace.id },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        error: true,
        nodeRuns: {
          select: {
            id: true,
            nodeId: true,
            nodeName: true,
            nodeType: true,
            status: true,
            attempt: true,
            maxAttempts: true,
            startedAt: true,
            finishedAt: true,
            durationMs: true,
            error: true,
            updatedAt: true,
            // Read but never returned: output can hold a long prompt list, so
            // only the one id derived from it goes over the wire.
            output: true,
            producedAssets: {
              orderBy: [{ port: 'asc' }, { position: 'asc' }],
              select: { mediaAsset: { select: { id: true, filename: true, type: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) return NextResponse.json({ error: 'That run no longer exists.' }, { status: 404 });

    const posts = await postsForRun(ctx.workspace.id, run.nodeRuns);

    // An unchanged poll costs a 304 rather than a payload. Post state is folded
    // in deliberately: approving a post changes nothing on the node run, so
    // without it the client would keep getting a 304 and keep showing
    // "Waiting for you" after the wait was over.
    const etag = `"${createHash('sha1')
      .update(run.nodeRuns.map((n) => `${n.id}:${n.status}:${n.updatedAt.getTime()}`).join('|'))
      .update([...posts].map(([node, post]) => `${node}:${post.awaitingApproval}`).join('|'))
      .update(run.status)
      .digest('hex')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { etag } });
    }

    return NextResponse.json(
      {
        // Sent so elapsed timers can correct for clock skew. A server-computed
        // elapsed value would make every badge stutter at the poll interval.
        serverNow: Date.now(),
        run: {
          id: run.id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.durationMs,
          error: run.error,
        },
        // The links a finished step should offer, so they appear as the run
        // progresses rather than only after a manual reload.
        nodes: run.nodeRuns.map(({ updatedAt: _updatedAt, output: _output, producedAssets, ...node }) => ({
          ...node,
          produced: producedAssets.map((link) => link.mediaAsset),
          post: posts.get(node.id) ?? null,
        })),
      },
      { headers: { etag, 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError.detail) console.error('[api] workflow run status', appError.detail);
    return NextResponse.json({ error: appError.message }, { status: appError.status });
  }
}
