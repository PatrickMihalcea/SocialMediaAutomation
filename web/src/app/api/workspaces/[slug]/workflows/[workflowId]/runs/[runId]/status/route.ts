import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { postsForRun } from '@/lib/workflows/run-posts';
import { storage } from '@/lib/storage';
import { hasReviewableOutput } from '@/lib/workflows/node-output';

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
              select: {
                mediaAsset: {
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
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!run) return NextResponse.json({ error: 'That run no longer exists.' }, { status: 404 });

    const posts = await postsForRun(ctx.workspace.id, run.nodeRuns);
    /**
     * Preview URLs, so a picture appears as its step produces it.
     *
     * They used to come only from the server render, so the first poll — a
     * second or two into a run — replaced every asset with a copy that had no
     * url, and the previews vanished exactly when there was something to watch.
     *
     * Signing is local HMAC on both drivers, no round trip, so this costs
     * nothing per poll beyond the bytes.
     */
    const previews = await signPreviews(run.nodeRuns);

    // An unchanged poll costs a 304 rather than a payload. Post state is folded
    // in deliberately: approving a post changes nothing on the node run, so
    // without it the client would keep getting a 304 and keep showing
    // "Waiting for you" after the wait was over.
    const etag = `"${createHash('sha1')
      .update(run.nodeRuns.map((n) => `${n.id}:${n.status}:${n.updatedAt.getTime()}`).join('|'))
      // Asset ids too: a long-running step emits images one at a time, and the
      // whole point of watching a run is seeing each one arrive.
      .update(run.nodeRuns.flatMap((n) => n.producedAssets.map((a) => a.mediaAsset.id)).join('|'))
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
        nodes: run.nodeRuns.map(({ updatedAt: _updatedAt, output, producedAssets, ...node }) => ({
          ...node,
          // A boolean, not the output: enough to decide whether the control is
          // worth showing, without re-sending a prompt list every poll.
          hasOutput: hasReviewableOutput(output),
          produced: producedAssets.map(({ mediaAsset: asset }) => ({
            id: asset.id,
            filename: asset.filename,
            type: asset.type,
            width: asset.width,
            height: asset.height,
            url: previews.get(asset.id)?.url ?? null,
            fullUrl: previews.get(asset.id)?.fullUrl ?? null,
          })),
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

/**
 * Signed URLs for everything a run has produced so far: the still for the row,
 * and the file itself for the preview. Audio has no still worth showing, and
 * still needs its file — that is what makes a chosen track playable.
 *
 * Both, and on this route as well as the page, because a run being watched
 * receives its assets through here: signing only the still left every clip
 * produced mid-run unplayable until the page was reloaded.
 */
async function signPreviews(
  nodeRuns: {
    producedAssets: { mediaAsset: { id: string; type: string; thumbnailKey: string | null; storageKey: string } }[];
  }[],
): Promise<Map<string, { url: string | null; fullUrl: string }>> {
  const keys = new Map<string, { still: string | null; file: string }>();
  for (const node of nodeRuns) {
    for (const { mediaAsset: asset } of node.producedAssets) {
      keys.set(asset.id, {
        still: asset.type === 'AUDIO' ? null : asset.thumbnailKey ?? asset.storageKey,
        file: asset.storageKey,
      });
    }
  }
  const signed = await Promise.all(
    [...keys].map(async ([id, { still, file }]) => [id, {
      url: still ? await storage().signedUrl(still) : null,
      fullUrl: await storage().signedUrl(file),
    }] as const),
  );
  return new Map(signed);
}
