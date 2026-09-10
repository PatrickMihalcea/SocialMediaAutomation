import { AiStudio } from '@/components/ai-studio';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { env } from '@/lib/env';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { slug } = await params;
  const { source } = await searchParams;
  const ctx = await requireWorkspace(slug, 'ai:use');
  const jobs = await db.aiMediaJob.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        kind: true,
        status: true,
        error: true,
        prompt: true,
        outputAssetId: true,
        createdAt: true,
      },
    });
  const outputIds = jobs.flatMap((job) => job.outputAssetId ? [job.outputAssetId] : []);
  const assets = await db.mediaAsset.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      status: 'READY',
      OR: [
        { aiGenerationId: { not: null } },
        { id: { in: outputIds } },
        { derivationPreset: { in: ['IMAGE_GENERATE', 'IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS'] } },
        ...(source ? [{ id: source }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  const validatedSource = source && assets.some((asset) => asset.id === source) ? source : undefined;
  const withUrls = await Promise.all(assets.map(async (asset) => ({
    id: asset.id,
    filename: asset.filename,
    type: asset.type,
    url: await storage().signedUrl(asset.storageKey),
    generated: Boolean(
      asset.aiGenerationId
      || outputIds.includes(asset.id)
      || ['IMAGE_GENERATE', 'IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS'].includes(asset.derivationPreset ?? ''),
    ),
  })));
  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">AI studio</p>
        <h1 className="b88-page-title mt-3">Generate media</h1>
        <p className="mt-3 max-w-2xl">Create attach-ready images, or queue video and audio work for the generation worker.</p>
      </div>
      <AiStudio
        slug={slug}
        initialAssets={withUrls}
        initialJobs={jobs.map((job) => ({ ...job, createdAt: job.createdAt.toISOString() }))}
        initialSourceAssetId={validatedSource}
        simulated={env.AI_PROVIDER !== 'openai'}
      />
    </>
  );
}
