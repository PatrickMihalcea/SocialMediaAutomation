import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unplug } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { describePlatforms, PLATFORM_LABELS } from '@/lib/social/registry';
import { relativeLabel } from '@/lib/scheduling/time';
import { disconnectChannelAction, reconnectDemoChannelAction } from '@/app/actions/channels';
import { YoutubePrivacyField } from '@/components/youtube-privacy-field';
import { isYoutubePrivacy } from '@/lib/social/adapters/youtube';
import { env } from '@/lib/env';
import { ConfirmationButton } from '@/components/action-ui';
import { PlatformGlyph } from '@/components/visuals';
import { DemoChannelConnectForm } from './channel-connect-form';

export const metadata = { title: 'Social accounts' };

const STATUS_PRESENTATION = {
  ACTIVE: {
    label: 'Connected',
    tone: 'mint',
    guidance: null,
  },
  EXPIRED: {
    label: 'Authorization expired',
    tone: 'coral',
    guidance: 'Reconnect this account to resume publishing.',
  },
  REVOKED: {
    label: 'Access revoked',
    tone: 'coral',
    guidance: 'Reconnect this account to restore publishing access.',
  },
  ERROR: {
    label: 'Connection issue',
    tone: 'cream',
    guidance: 'Reconnect this account. If the issue continues, contact support.',
  },
  DISCONNECTED: {
    label: 'Disconnected',
    tone: 'outline',
    guidance: 'Connect this account again to use it for future posts.',
  },
} as const;

function accountTypeLabel(value?: string) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replaceAll('_', ' ');
  const labels: Record<string, string> = {
    business: 'Business account',
    'business account': 'Business account',
    creator: 'Creator account',
    'creator account': 'Creator account',
    personal: 'Personal account',
    'personal account': 'Personal account',
    page: 'Organization page',
    organization: 'Organization page',
    company: 'Organization page',
  };
  return labels[normalized] ?? 'Account type unavailable';
}

const OAUTH_NOTICES: Record<string, { tone: string; kind: 'success' | 'warning'; message: string }> = {
  connected: { tone: 'var(--block-mint)', kind: 'success', message: 'Channel connected. It is ready for publishing.' },
  reconnected: { tone: 'var(--block-mint)', kind: 'success', message: 'Channel access was renewed. Publishing can continue.' },
  cancelled: { tone: 'var(--block-cream)', kind: 'warning', message: 'Connection cancelled. No account was added.' },
  unavailable: { tone: 'var(--block-cream)', kind: 'warning', message: 'Live connection is not available for this platform in this workspace. You can connect a demo account below.' },
  rate_limited: { tone: 'var(--block-pink)', kind: 'warning', message: 'Too many connection attempts. Wait a few minutes, then try again.' },
  missing_code: { tone: 'var(--block-pink)', kind: 'warning', message: 'The authorization session ended before the platform returned a result. Start the connection again.' },
  provider_error: { tone: 'var(--block-pink)', kind: 'warning', message: 'The platform did not approve this connection. Try again. If it continues, ask your workspace administrator to check the integration.' },
  platform_error: { tone: 'var(--block-pink)', kind: 'warning', message: 'No eligible publishing account was available. Check that the account can publish and that you approved the requested access, then try again.' },
  failed: { tone: 'var(--block-pink)', kind: 'warning', message: 'Bridge88 could not complete the connection. Try again. No account was added.' },
};

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ oauth?: string; account?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireWorkspace(slug, 'channel:view');
  const accounts = await db.socialAccount.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: { not: 'DISCONNECTED' },
    },
    include: {
      _count: {
        select: {
          postPlatforms: {
            where: {
              status: 'PENDING',
              post: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const platforms = describePlatforms();
  const notice = query.oauth ? OAUTH_NOTICES[query.oauth] : undefined;

  return (
    <>
      <div>
        <p className="b88-eyebrow">Channels</p>
        <h1 className="b88-page-title mt-3">Social accounts</h1>
      </div>
      {notice && (
        <p role="status" className="mt-6 flex items-center gap-3 rounded-md p-4 text-sm" style={{ background: notice.tone }}>
          {notice.kind === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {notice.message}
        </p>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const metadata = account.metadata as {
            mock?: boolean; accountType?: string; pageType?: string; privacyStatus?: unknown;
          };
          const demo = metadata?.mock;
          const accountType = accountTypeLabel(metadata.accountType ?? metadata.pageType);
          const scheduledTargets = account._count.postPlatforms;
          const status = STATUS_PRESENTATION[account.status];
          return (
            <article
              id={account.id}
              key={account.id}
              className="b88-card flex h-full min-w-0 scroll-mt-20 flex-col"
              style={query.account === account.id ? { borderColor: 'var(--ink)' } : undefined}
            >
              <div className="flex min-h-6 items-start justify-between gap-3">
                <p className="b88-caption flex min-w-0 items-center gap-1.5 truncate">
                  <PlatformGlyph platform={account.platform} size={16} />
                  <span className="truncate">{PLATFORM_LABELS[account.platform]}{demo ? ' · demo account' : ''}</span>
                </p>
                <span className="shrink-0"><Badge tone={status.tone}>{status.label}</Badge></span>
              </div>
              <div className="mt-4 grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-start gap-3">
                <Avatar name={account.accountName} src={account.avatarUrl} size={44} />
                <div className="min-w-0">
                  <p
                    className="line-clamp-2 min-h-12 break-normal font-[540] [overflow-wrap:normal]"
                    title={account.accountName}
                  >
                    {account.accountName}
                  </p>
                  <p
                    className="mt-1 truncate whitespace-nowrap text-sm"
                    title={account.accountHandle ?? undefined}
                  >
                    {account.accountHandle ?? 'No public handle reported'}
                  </p>
                </div>
              </div>
              {status.guidance && (
                <p className="mt-4 rounded-md bg-[var(--block-pink)] p-3 text-sm">
                  {ctx.can('channel:connect')
                    ? status.guidance
                    : 'Ask a workspace administrator to reconnect this account.'}
                </p>
              )}
              {scheduledTargets > 0 && (
                <p className="mt-4 rounded-md bg-[var(--block-cream)] p-3 text-sm">
                  Disconnecting will cancel this channel on {scheduledTargets} future post{scheduledTargets === 1 ? '' : 's'}.
                </p>
              )}
              <dl className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <dt className="b88-caption min-h-8">Account type</dt>
                  <dd className="mt-1 text-sm">{accountType ?? (demo ? 'Demo business account' : 'Unavailable from platform')}</dd>
                </div>
                <div>
                  <dt className="b88-caption min-h-8">Last synchronized</dt>
                  <dd className="mt-1 text-sm">{account.lastSyncedAt ? relativeLabel(account.lastSyncedAt, ctx.workspace.timezone) : 'Awaiting first sync'}</dd>
                </div>
              </dl>
              {/* YouTube alone publishes at a visibility of its own, and it is
                  a property of the channel rather than of a post — a test
                  channel must never go public whatever is scheduled onto it. */}
              {account.platform === 'YOUTUBE' && !demo && (
                <div className="mt-5">
                  <YoutubePrivacyField
                    slug={slug}
                    accountId={account.id}
                    value={isYoutubePrivacy(metadata.privacyStatus)
                      ? metadata.privacyStatus
                      : env.YOUTUBE_PRIVACY_STATUS}
                    disabled={!ctx.can('channel:connect')}
                  />
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                {ctx.can('channel:connect') && account.status !== 'ACTIVE' && (demo ? (
                  <form action={reconnectDemoChannelAction.bind(null, slug, account.id)} className="shrink-0">
                    <Button type="submit" variant="secondary"><RefreshCw size={16}/> Reconnect</Button>
                  </form>
                ) : (
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    href={`/api/oauth/${account.platform.toLowerCase()}/start?workspace=${encodeURIComponent(slug)}&account=${encodeURIComponent(account.id)}`}
                  >
                    <RefreshCw size={16}/> Reconnect
                  </Button>
                ))}
                {ctx.can('channel:disconnect') && (
                  <form action={disconnectChannelAction.bind(null, slug, account.id)} className="shrink-0">
                    <ConfirmationButton
                      type="submit"
                      variant="tertiary"
                      confirmMessage={`Disconnect ${account.accountName}? ${scheduledTargets ? `${scheduledTargets} future channel target${scheduledTargets === 1 ? '' : 's'} will be cancelled. ` : ''}Published history will remain.`}
                      pendingLabel="Disconnecting"
                    >
                      <Unplug size={16}/> Disconnect
                    </ConfirmationButton>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!accounts.length && (
        <div className="mt-8">
          <EmptyState
            eyebrow="No accounts"
            title="Connect the first channel"
            action={ctx.can('channel:connect') ? <Button href="#connect-account">Connect account</Button> : undefined}
          >
            {ctx.can('channel:connect')
              ? 'Choose a live or demo account below to start publishing.'
              : 'Ask a workspace administrator to connect an account.'}
          </EmptyState>
        </div>
      )}

      {ctx.can('channel:connect') && (
        <section id="connect-account" className="mt-12 scroll-mt-20 rounded-lg bg-[var(--block-cream)] p-6">
          <p className="b88-caption">Connect account</p>
          <h2 className="b88-heading mt-2">Choose a platform</h2>
          <p className="mt-2 text-sm">Demo accounts simulate publishing; no social post is created.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {platforms.map((platform) => (
              <div key={platform.platform} className="rounded-md bg-canvas p-4">
                <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 font-[540]"><PlatformGlyph platform={platform.platform} size={16} />{platform.label}</p><Badge tone={platform.configured ? 'mint' : 'outline'}>{platform.configured ? 'Live connection' : 'Demo available'}</Badge></div>
                {platform.configured ? (
                  <Button
                    href={`/api/oauth/${platform.platform.toLowerCase()}/start?workspace=${encodeURIComponent(slug)}`}
                    variant="secondary"
                    fullWidth
                    className="mt-4"
                  >
                    <Link2 size={16} /> Connect {platform.label}
                  </Button>
                ) : (
                  <DemoChannelConnectForm
                    slug={slug}
                    platform={platform.platform}
                    label={platform.label}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
