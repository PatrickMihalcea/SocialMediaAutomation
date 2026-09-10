import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unplug } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { describePlatforms, PLATFORM_LABELS } from '@/lib/social/registry';
import { relativeLabel } from '@/lib/scheduling/time';
import { disconnectChannelAction, reconnectDemoChannelAction } from '@/app/actions/channels';
import { ConfirmationButton } from '@/components/action-ui';
import { PlatformGlyph } from '@/components/visuals';
import { DemoChannelConnectForm } from './channel-connect-form';

function sentenceCase(value: string) {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const OAUTH_NOTICES: Record<string, { tone: string; kind: 'success' | 'warning'; message: string }> = {
  connected: { tone: 'var(--block-mint)', kind: 'success', message: 'Channel connected. It is ready for publishing.' },
  reconnected: { tone: 'var(--block-mint)', kind: 'success', message: 'Channel authorization was renewed.' },
  cancelled: { tone: 'var(--block-cream)', kind: 'warning', message: 'Connection cancelled. No channel or token was stored.' },
  unavailable: { tone: 'var(--block-cream)', kind: 'warning', message: 'OAuth credentials are not configured for that platform. Use its explicit demo connection below.' },
  rate_limited: { tone: 'var(--block-pink)', kind: 'warning', message: 'Too many connection attempts. Wait a few minutes, then try again.' },
  missing_code: { tone: 'var(--block-pink)', kind: 'warning', message: 'The platform returned no authorization code. Start the connection again.' },
  provider_error: { tone: 'var(--block-pink)', kind: 'warning', message: 'The platform could not authorize this connection. Check the app configuration and try again.' },
  platform_error: { tone: 'var(--block-pink)', kind: 'warning', message: 'No publishable account was returned. Check account permissions and platform eligibility, then try again.' },
  failed: { tone: 'var(--block-pink)', kind: 'warning', message: 'The connection could not be completed. Start again; no token was exposed.' },
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
      ...(query.account
        ? { OR: [{ status: { not: 'DISCONNECTED' } }, { id: query.account }] }
        : { status: { not: 'DISCONNECTED' } }),
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
        <p className="mt-4 max-w-2xl">Tokens are encrypted at rest. Demo accounts exercise the same scheduling and publishing paths without third-party credentials.</p>
      </div>
      {notice && (
        <p role="status" className="mt-6 flex items-center gap-3 rounded-md p-4 text-sm" style={{ background: notice.tone }}>
          {notice.kind === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {notice.message}
        </p>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => {
          const metadata = account.metadata as { mock?: boolean; accountType?: string; pageType?: string };
          const demo = metadata?.mock;
          const accountType = metadata.accountType ?? metadata.pageType;
          const scheduledTargets = account._count.postPlatforms;
          const tone = account.status === 'ACTIVE' ? 'mint' : account.status === 'EXPIRED' ? 'coral' : 'cream';
          return (
            <article
              id={account.id}
              key={account.id}
              className="b88-card scroll-mt-20"
              style={query.account === account.id ? { borderColor: 'var(--ink)' } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={account.accountName} src={account.avatarUrl} size={44} />
                  <div>
                    <p className="font-[540]">{account.accountName}</p>
                    <p className="b88-caption mt-1 flex items-center gap-1.5"><PlatformGlyph platform={account.platform} size={16} />{PLATFORM_LABELS[account.platform]}{demo ? ' · demo' : ''}</p>
                    {account.accountHandle && <p className="mt-1 text-sm">{account.accountHandle}</p>}
                  </div>
                </div>
                <Badge tone={tone}>{sentenceCase(account.status)}</Badge>
              </div>
              {account.statusMessage && <p className="mt-4 rounded-md bg-[var(--block-pink)] p-3 text-sm">{account.statusMessage}</p>}
              {scheduledTargets > 0 && (
                <p className="mt-4 rounded-md bg-[var(--block-cream)] p-3 text-sm">
                  {scheduledTargets} future post{scheduledTargets === 1 ? '' : 's'} currently target{scheduledTargets === 1 ? 's' : ''} this account. Disconnecting will cancel this channel on those posts without removing published history.
                </p>
              )}
              <dl className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <dt className="b88-caption">Account type</dt>
                  <dd className="mt-1 text-sm">{accountType ? sentenceCase(accountType) : demo ? 'Demo business account' : 'Not reported'}</dd>
                </div>
                <div>
                  <dt className="b88-caption">Last synchronized</dt>
                  <dd className="mt-1 text-sm">{account.lastSyncedAt ? relativeLabel(account.lastSyncedAt, ctx.workspace.timezone) : 'Not yet synchronized'}</dd>
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                {demo ? (
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
                )}
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
            action={<Button href="#connect-account">Connect account</Button>}
          >
            Pick a demo account below to exercise the complete publishing flow locally.
          </EmptyState>
        </div>
      )}

      {ctx.can('channel:connect') && (
        <section id="connect-account" className="mt-12 scroll-mt-20 rounded-lg bg-[var(--block-cream)] p-6">
          <p className="b88-caption">Connect account</p>
          <h2 className="b88-heading mt-2">Choose a platform</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {platforms.map((platform) => (
              <div key={platform.platform} className="rounded-md bg-canvas p-4">
                <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 font-[540]"><PlatformGlyph platform={platform.platform} size={16} />{platform.label}</p><Badge tone={platform.configured ? 'mint' : 'outline'}>{platform.configured ? 'API ready' : 'Demo mode'}</Badge></div>
                <p className="mt-2 min-h-12 text-sm">{platform.configured ? 'Connect through the platform authorization screen.' : 'Creates a clearly labelled local account with real validation and queue behavior.'}</p>
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
