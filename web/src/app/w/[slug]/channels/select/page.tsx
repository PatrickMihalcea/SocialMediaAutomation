import { notFound } from 'next/navigation';
import { Avatar, Button } from '@/bridge88/components';
import { requireWorkspace } from '@/lib/auth/guard';
import { readOAuthSelection } from '@/lib/social/oauth';
import { PLATFORM_LABELS } from '@/lib/social/registry';
import { completeOAuthSelectionAction } from '@/app/actions/channels';

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
      <form action={completeOAuthSelectionAction.bind(null, slug, query.selection)} className="mt-8 space-y-3">
        {pending.results.map((result) => (
          <label key={result.externalAccountId} className="b88-card flex cursor-pointer items-center gap-4">
            <input
              type="checkbox"
              name="account"
              value={result.externalAccountId}
              defaultChecked={pending.results.length === 1}
              className="h-4 w-4 accent-black"
            />
            <Avatar name={result.accountName} src={result.avatarUrl} size={40} />
            <span>
              <span className="block font-[540]">{result.accountName}</span>
              {result.accountHandle && <span className="b88-caption mt-1 block">{result.accountHandle}</span>}
            </span>
          </label>
        ))}
        <Button type="submit" className="mt-5">Connect selected accounts</Button>
      </form>
    </div>
  );
}
