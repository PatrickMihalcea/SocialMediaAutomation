import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/auth/guard';
import { audit } from '@/lib/audit';
import { getAdapter } from '@/lib/social/registry';
import {
  consumeOAuthAttempt,
  createOAuthSelection,
  parseOAuthPlatform,
  persistConnections,
} from '@/lib/social/oauth';
import { rateLimit, LIMITS } from '@/lib/rate-limit';
import { PlatformError } from '@/lib/social/errors';
import { db } from '@/lib/db';
import { assertWithinLimit } from '@/lib/billing/limits';
import { toAppError } from '@/lib/errors';
import { billingLimitRedirect } from '@/app/api/oauth/limit-redirect';

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: rawPlatform } = await params;
  const platform = parseOAuthPlatform(rawPlatform);
  const state = request.nextUrl.searchParams.get('state');
  if (!platform || !state) return NextResponse.json({ error: 'Invalid OAuth callback.' }, { status: 400 });

  const attempt = await consumeOAuthAttempt(state);
  if (!attempt || attempt.platform !== platform) {
    return NextResponse.json({ error: 'This connection attempt is invalid, expired, or already used.' }, { status: 400 });
  }

  const ctx = await requireWorkspace(attempt.workspaceId, 'channel:connect');
  if (ctx.user.id !== attempt.userId) {
    return NextResponse.json({ error: 'This connection attempt belongs to another user.' }, { status: 403 });
  }
  const channelsUrl = new URL(`/w/${ctx.workspace.slug}/channels`, request.url);
  const limited = await rateLimit(`oauth:callback:${ctx.user.id}`, LIMITS.oauth.limit, LIMITS.oauth.window);
  if (!limited.allowed) {
    channelsUrl.searchParams.set('oauth', 'rate_limited');
    return NextResponse.redirect(channelsUrl);
  }

  const providerError = request.nextUrl.searchParams.get('error');
  if (providerError) {
    await audit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: 'channel.connect_cancelled',
      entityType: 'oauth_attempt',
      entityId: attempt.id,
      metadata: { platform, providerError },
    });
    channelsUrl.searchParams.set('oauth', providerError === 'access_denied' ? 'cancelled' : 'provider_error');
    return NextResponse.redirect(channelsUrl);
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    channelsUrl.searchParams.set('oauth', 'missing_code');
    return NextResponse.redirect(channelsUrl);
  }

  try {
    // Refuse before exchanging the authorization code when this is clearly a
    // new connection at capacity. This avoids storing another provider token
    // and preserves the plan-limit reason even when the provider is unavailable.
    if (!attempt.reconnectAccountId) {
      const connected = await db.socialAccount.count({
        where: { workspaceId: ctx.workspace.id, status: { not: 'DISCONNECTED' } },
      });
      await assertWithinLimit(ctx.workspace.id, 'socialAccounts', connected);
    }
    const results = await getAdapter(platform).exchangeCode({
      code,
      redirectUri: attempt.redirectUri,
      codeVerifier: attempt.codeVerifier ?? undefined,
    });
    if (!results.length) throw new Error('The platform returned no connectable accounts.');

    // A reconnect with one result is deterministic. Any genuinely ambiguous
    // callback is held encrypted until the user selects accounts.
    if (results.length === 1) {
      const [current, existing] = await Promise.all([
        db.socialAccount.count({ where: { workspaceId: ctx.workspace.id, status: { not: 'DISCONNECTED' } } }),
        db.socialAccount.count({
          where: {
            workspaceId: ctx.workspace.id,
            platform,
            externalAccountId: results[0].externalAccountId,
            status: { not: 'DISCONNECTED' },
          },
        }),
      ]);
      if (!existing) await assertWithinLimit(ctx.workspace.id, 'socialAccounts', current);
      const saved = await persistConnections({
        workspaceId: ctx.workspace.id,
        platform,
        results,
        reconnectAccountId: attempt.reconnectAccountId,
      });
      await audit({
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        action: attempt.reconnectAccountId ? 'channel.reconnected' : 'channel.connected',
        entityType: 'social_account',
        entityId: saved[0].id,
        metadata: { platform, externalAccountId: results[0].externalAccountId },
      });
      channelsUrl.searchParams.set('oauth', attempt.reconnectAccountId ? 'reconnected' : 'connected');
      return NextResponse.redirect(channelsUrl);
    }

    const selection = await createOAuthSelection({
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      platform,
      results,
      reconnectAccountId: attempt.reconnectAccountId,
    });
    return NextResponse.redirect(new URL(`/w/${ctx.workspace.slug}/channels/select?selection=${encodeURIComponent(selection)}`, request.url));
  } catch (error) {
    console.error(`[oauth] ${platform} callback failed`, error instanceof Error ? error.message : error);
    const appError = toAppError(error);
    await audit({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      action: 'channel.connect_failed',
      entityType: 'oauth_attempt',
      entityId: attempt.id,
      metadata: {
        platform,
        code: error instanceof PlatformError ? error.code : appError.code,
        error: connectionAuditReason(error, appError.code),
      },
    });
    const billingUrl = billingLimitRedirect(error, request.url, ctx.workspace.slug);
    if (billingUrl) return NextResponse.redirect(billingUrl);
    channelsUrl.searchParams.set('oauth', error instanceof PlatformError ? 'platform_error' : 'failed');
    return NextResponse.redirect(channelsUrl);
  }
}

function connectionAuditReason(error: unknown, code: string): string {
  if (code === 'LIMIT_REACHED') {
    return 'The workspace reached its social account limit. Open Billing or disconnect an account';
  }
  if (error instanceof PlatformError && error.needsReconnect) return 'TOKEN_EXPIRED';
  return 'The social network did not complete the connection';
}
