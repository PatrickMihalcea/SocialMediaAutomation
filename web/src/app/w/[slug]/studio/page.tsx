import { AiStudio } from '@/components/ai-studio';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { env } from '@/lib/env';

export const metadata = { title: 'AI studio' };

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
  // Generated assets do not depend on the jobs query, so both reads can start
  // together. Legacy output ids without generation metadata are filled below.
  const [jobs, generatedAssets] = await Promise.all([db.aiMediaJob.findMany({
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
        // Both drive the progress tracker: startedAt is the only evidence a
        // worker actually picked the job up, and provider is what tells a
        // person a result is a demo fixture rather than model output.
        startedAt: true,
        provider: true,
      },
    }),
    db.mediaAsset.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        status: 'READY',
        OR: [
          { aiGenerationId: { not: null } },
          { derivationPreset: { in: ['IMAGE_GENERATE', 'IMAGE_EDIT', 'IMAGE_VARIATION', 'VIDEO_GENERATE', 'VIDEO_ANIMATE', 'AUDIO_TTS'] } },
          ...(source ? [{ id: source }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ]);
  const outputIds = jobs.flatMap((job) => job.outputAssetId ? [job.outputAssetId] : []);
  const loadedIds = new Set(generatedAssets.map((asset) => asset.id));
  const missingIds = [...new Set([...outputIds, ...(source ? [source] : [])])]
    .filter((id) => !loadedIds.has(id));
  const missingAssets = missingIds.length
    ? await db.mediaAsset.findMany({
        where: { workspaceId: ctx.workspace.id, status: 'READY', id: { in: missingIds } },
      })
    : [];
  const assets = [...missingAssets, ...generatedAssets];
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
      </div>
      <AiStudio
        slug={slug}
        initialAssets={withUrls}
        initialJobs={jobs.map((job) => ({
          ...job,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
        }))}
        initialSourceAssetId={validatedSource}
        simulated={env.AI_PROVIDER !== 'openai'}
      />
    </>
  );
}
