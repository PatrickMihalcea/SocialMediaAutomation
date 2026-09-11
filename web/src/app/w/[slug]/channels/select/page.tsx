import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/guard';
import { readOAuthSelection } from '@/lib/social/oauth';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { completeOAuthSelectionAction } from '@/app/actions/channels';
import { SelectionForm } from './selection-form';

export const metadata = { title: 'Select social account' };

export default async function ChannelSelectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ selection?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireWorkspace(slug, 'channel:connect');
  if (!query.selection) redirect(`/w/${slug}/channels?oauth=failed`);
  const pending = await readOAuthSelection(query.selection, ctx.user.id);
  if (!pending || pending.workspaceId !== ctx.workspace.id) {
    redirect(`/w/${slug}/channels?oauth=failed`);
  }
  const reconnecting = Boolean(pending.reconnectAccountId);

  return (
    <div className="max-w-2xl">
      <p className="b88-eyebrow">Channel selection</p>
      <h1 className="b88-page-title mt-3">Choose {reconnecting ? 'one ' : ''}{PLATFORM_LABELS[pending.platform]} account{reconnecting ? '' : 's'}</h1>
      {reconnecting && <p className="mt-3">The selected account will replace the current connection.</p>}
      <SelectionForm
        action={completeOAuthSelectionAction.bind(null, slug, query.selection)}
        single={reconnecting}
        accounts={pending.results.map((result) => ({
          externalAccountId: result.externalAccountId,
          accountName: result.accountName,
          accountHandle: result.accountHandle,
          avatarUrl: result.avatarUrl,
        }))}
      />
    </div>
  );
}
