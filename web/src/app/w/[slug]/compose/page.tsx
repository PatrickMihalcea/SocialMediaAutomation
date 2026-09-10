import Link from 'next/link';
import { ComposerForm } from '@/components/composer-form';
import { requireWorkspace } from '@/lib/auth/guard';
import { loadComposerContext } from '@/lib/posts/load';
import { createPostAction } from '@/app/actions/posts';

export default async function ComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ asset?: string }>;
}) {
  const { slug } = await params;
  const { asset } = await searchParams;
  const ctx = await requireWorkspace(slug, 'post:create');
  const data = await loadComposerContext(ctx.workspace.id, slug);
  const attachAssetId =
    asset && data.assets.some((entry) => entry.id === asset) ? asset : undefined;
  const action = createPostAction.bind(null, slug);

  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">Composer</p>
        <h1 className="b88-page-title mt-3">Create a post</h1>
      </div>
      {data.accounts.length ? (
        <ComposerForm
          slug={slug}
          action={action}
          accounts={data.accounts}
          assets={data.assets}
          campaigns={data.campaigns}
          timezone={data.timezone}
          attachAssetId={attachAssetId}
          canSchedule={ctx.can('post:schedule')}
          canPublish={ctx.can('post:publish')}
          canSubmitForApproval={ctx.can('post:submit_for_approval')}
        />
      ) : (
        <section className="rounded-lg bg-[var(--block-cream)] p-8">
          <p className="b88-eyebrow">No channel selected</p>
          <h2 className="b88-heading mt-3">Connect an account before composing.</h2>
          <Link href={`/w/${slug}/channels`} className="mt-4 inline-block underline underline-offset-4">Open social accounts</Link>
        </section>
      )}
    </>
  );
}
