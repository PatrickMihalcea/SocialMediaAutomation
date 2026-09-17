import { Suspense } from 'react';
import Link from 'next/link';
import { ComposerForm } from '@/components/composer-form';
import { ComposerPagePreview } from '@/components/page-previews';
import { requireWorkspace } from '@/lib/auth/guard';
import { loadComposerContext } from '@/lib/posts/load';
import { parseComposerContext } from '@/lib/posts/lifecycle';
import { createPostAction } from '@/app/actions/posts';

export const metadata = { title: 'Create post' };

export default async function ComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ asset?: string; campaign?: string; scheduledAt?: string }>;
}) {
  const { slug } = await params;
  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">Composer</p>
        <h1 className="b88-page-title mt-3">Create a post</h1>
      </div>
      <Suspense fallback={<ComposerPagePreview />}>
        <ComposeData slug={slug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ComposeData({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: Promise<{ asset?: string; campaign?: string; scheduledAt?: string }>;
}) {
  const query = await searchParams;
  const ctx = await requireWorkspace(slug, 'post:create');
  const data = await loadComposerContext(ctx.workspace.id, slug, undefined, query.asset);
  const context = parseComposerContext(query, {
    assetIds: data.assets.map((asset) => asset.id),
    campaignIds: data.campaigns.map((campaign) => campaign.id),
  });
  const action = createPostAction.bind(null, slug);

  if (!data.accounts.length) {
    return (
      <section className="rounded-lg bg-[var(--block-cream)] p-8">
        <p className="b88-eyebrow">No channel selected</p>
        <h2 className="b88-heading mt-3">Connect an account before composing.</h2>
        <Link href={`/w/${slug}/channels`} className="mt-4 inline-block underline underline-offset-4">Open social accounts</Link>
      </section>
    );
  }

  return (
    <ComposerForm
      slug={slug}
      action={action}
      accounts={data.accounts}
      assets={data.assets}
      audioTracks={data.audioTracks}
      campaigns={data.campaigns}
      timezone={data.timezone}
      attachAssetId={context.assetId}
      contextDefaults={{
        scheduledAt: context.scheduledAt,
        campaignId: context.campaignId,
        defaultHashtags: data.preferences?.defaultHashtags,
        defaultCta: data.preferences?.defaultCta,
        defaultPostDestination: data.preferences?.defaultPostDestination,
      }}
      canSchedule={ctx.can('post:schedule')}
      canPublish={ctx.can('post:publish')}
      canSubmitForApproval={ctx.can('post:submit_for_approval')}
    />
  );
}
