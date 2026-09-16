import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { publicEnv } from '@/lib/env';
import { requireWorkspace } from '@/lib/auth/guard';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { getAdapter } from '@/lib/social/registry';
import {
  createOAuthAttempt,
  issueOpaqueSecret,
  oauthRedirectUri,
  parseOAuthPlatform,
} from '@/lib/social/oauth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: rawPlatform } = await params;
  const platform = parseOAuthPlatform(rawPlatform);
  const slug = request.nextUrl.searchParams.get('workspace') ?? '';
  if (!platform || !slug) return NextResponse.json({ error: 'Invalid OAuth request.' }, { status: 400 });

  const ctx = await requireWorkspace(slug, 'channel:connect');
  const limited = await rateLimit(`oauth:start:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) return NextResponse.json({ error: 'Too many connection attempts. Try again shortly.' }, { status: 429 });

  const reconnectAccountId = request.nextUrl.searchParams.get('account') ?? undefined;
  if (reconnectAccountId) {
    const account = await db.socialAccount.findFirst({
      where: { id: reconnectAccountId, workspaceId: ctx.workspace.id, platform },
      select: { id: true },
    });
    if (!account) return NextResponse.json({ error: 'That channel cannot be reconnected.' }, { status: 404 });
  }

  const adapter = getAdapter(platform);
  if (!adapter.isConfigured()) {
    // publicEnv.appUrl, not request.url: behind a reverse proxy or tunnel,
    // request.url reflects whatever the server's own local connection looks
    // like (here, plain http://localhost:3000), not the address the browser
    // actually used — a redirect built from it sends the browser somewhere
    // it can't reach at all, rather than back to the app it just came from.
    return NextResponse.redirect(new URL(`/w/${ctx.workspace.slug}/channels?oauth=unavailable`, publicEnv.appUrl));
  }

  const state = issueOpaqueSecret();
  const redirectUri = oauthRedirectUri(platform);
  const authorization = await adapter.getAuthorizationUrl({ redirectUri, state });
  await createOAuthAttempt({
    state,
    userId: ctx.user.id,
    workspaceId: ctx.workspace.id,
    platform,
    redirectUri,
    codeVerifier: authorization.codeVerifier,
    reconnectAccountId,
  });
  return NextResponse.redirect(authorization.url);
}
