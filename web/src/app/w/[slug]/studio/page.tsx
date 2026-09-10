import { AiStudio } from '@/components/ai-studio';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';

export default async function StudioPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireWorkspace(slug, 'ai:use');
  const [assets, jobs] = await Promise.all([
    db.mediaAsset.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        status: 'READY',
        OR: [{ aiGenerationId: { not: null } }, { derivationPreset: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    db.aiMediaJob.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, status: true, error: true },
    }),
  ]);
  const withUrls = await Promise.all(assets.map(async (asset) => ({
    id: asset.id,
    filename: asset.filename,
    type: asset.type,
    url: await storage().signedUrl(asset.storageKey),
  })));
  return (
    <>
      <div className="mb-8">
        <p className="b88-eyebrow">AI studio</p>
        <h1 className="b88-page-title mt-3">Generate media</h1>
        <p className="mt-3 max-w-2xl">Create attach-ready images, or queue video and audio work for the generation worker.</p>
      </div>
      <AiStudio slug={slug} initialAssets={withUrls} initialJobs={jobs} />
    </>
  );
}
