import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/guard';
import { readOAuthSelection } from '@/lib/social/oauth';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { completeOAuthSelectionAction } from '@/app/actions/channels';
import { SelectionForm } from './selection-form';

export default async function ChannelSelectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ selection?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireWorkspace(slug, 'channel:connect');
  if (!query.selection) notFound();
  const pending = await readOAuthSelection(query.selection, ctx.user.id);
  if (!pending || pending.workspaceId !== ctx.workspace.id) notFound();

  return (
    <div className="max-w-2xl">
      <p className="b88-eyebrow">Channel selection</p>
      <h1 className="b88-page-title mt-3">Choose {PLATFORM_LABELS[pending.platform]} accounts</h1>
      <p className="mt-3">Only selected accounts will be stored. Authorization tokens remain encrypted on the server.</p>
      <SelectionForm
        action={completeOAuthSelectionAction.bind(null, slug, query.selection)}
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
