import { PrismaClient, Platform, PostStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const db = new PrismaClient();

async function main() {
  const email = 'demo@bridge88.local';
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });
  // Workspaces are not owned by a user FK, so deleting the demo user leaves its
  // workspace behind and the slug collides on the next run. Clear it by slug so
  // the seed is re-runnable.
  await db.workspace.deleteMany({ where: { slug: 'northwind-studio' } });

  const user = await db.user.create({
    data: {
      email,
      name: 'Alex Morgan',
      passwordHash: await bcrypt.hash('demo-password', 12),
      emailVerified: new Date(),
      isPlatformAdmin: true,
    },
  });
  const workspace = await db.workspace.create({
    data: {
      name: 'Northwind Studio',
      slug: 'northwind-studio',
      description: 'A product studio that builds dependable tools for technical teams.',
      website: 'https://example.com',
      industry: 'Software',
      targetAudience: 'Engineering leaders and product teams',
      timezone: 'America/New_York',
      onboardedAt: new Date(),
      members: { create: { userId: user.id, role: 'OWNER' } },
      brandSettings: {
        create: {
          tone: 'Professional and conversational',
          personality: 'A competent colleague explaining how the work gets done.',
          targetAudience: 'Engineering leaders and product teams',
          writingStyle: 'Short paragraphs, concrete examples and measured claims.',
          wordsToUse: ['ship', 'measure', 'review', 'concrete'],
          wordsToAvoid: ['synergy', 'revolutionary', 'game-changing'],
          emojiPolicy: 'NONE',
          hashtagPolicy: 'MINIMAL',
          ctaStyle: 'One low-pressure, concrete next step.',
          additionalInstructions: 'Keep LinkedIn posts under 1,500 characters.',
        },
      },
      subscription: { create: { plan: 'PRO', status: 'ACTIVE' } },
      schedulingRules: {
        create: [
          { weekday: 1, hour: 9 },
          { weekday: 1, hour: 17 },
          { weekday: 2, hour: 9 },
          { weekday: 3, hour: 12 },
          { weekday: 4, hour: 17 },
          { weekday: 5, hour: 9 },
        ],
      },
    },
  });

  const accounts = await Promise.all([
    createDemoAccount(workspace.id, Platform.LINKEDIN, 'Northwind Studio', '@northwind'),
    createDemoAccount(workspace.id, Platform.INSTAGRAM, 'Northwind Workshop', '@northwindstudio'),
    createDemoAccount(workspace.id, Platform.X, 'Northwind Builds', '@northwindbuilds'),
  ]);

  const campaignData = [
    ['Launch notes', 'Product updates and the decisions behind them.', 'lime'],
    ['Build in public', 'A running record of what the studio is learning.', 'lilac'],
    ['Field guide', 'Practical advice for engineering teams.', 'cream'],
  ] as const;
  const campaigns = [];
  for (const [name, description, color] of campaignData) {
    campaigns.push(await db.campaign.create({
      data: { workspaceId: workspace.id, name, description, color, status: 'ACTIVE' },
    }));
  }

  const media = [];
  const colors = ['c8e6cd', 'f4ecd6', 'c5b0f4', 'dceeb1', 'f3c9b6'];
  for (let index = 0; index < 10; index++) {
    const filename = `northwind-${String(index + 1).padStart(2, '0')}.png`;
    const key = `workspaces/${workspace.id}/original/${randomUUID()}.png`;
    const color = `#${colors[index % colors.length]}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="${color}"/><text x="80" y="880" font-family="monospace" font-size="40">NORTHWIND · ${index + 1}</text><text x="80" y="940" font-family="monospace" font-size="22">PRODUCT FIELD NOTE</text></svg>`;
    const png = await rasterize(svg, color);
    const destination = path.join(process.cwd(), 'storage', key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, png);
    media.push(await db.mediaAsset.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename,
        mimeType: 'image/png',
        type: 'IMAGE',
        size: png.byteLength,
        width: 1080,
        height: 1080,
        storageKey: key,
        status: 'READY',
      },
    }));
  }

  for (let index = 0; index < 20; index++) {
    const account = accounts[index % accounts.length];
    const days = index - 7;
    const scheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const status: PostStatus =
      index < 6 ? PostStatus.PUBLISHED :
      index === 6 ? PostStatus.FAILED :
      index < 9 ? PostStatus.DRAFT :
      index === 9 ? PostStatus.PENDING_APPROVAL :
      PostStatus.SCHEDULED;
    const post = await db.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        campaignId: campaigns[index % campaigns.length].id,
        title: [
          'What reliable automation actually needs',
          'Three notes from the latest release',
          'A smaller system shipped faster',
          'The review step worth keeping',
        ][index % 4],
        status,
        scheduledAt: status === 'DRAFT' || status === 'PENDING_APPROVAL' ? null : scheduledAt,
        publishedAt: status === 'PUBLISHED' ? scheduledAt : null,
        timezone: workspace.timezone,
      },
    });
    const platformPostId = status === 'PUBLISHED' ? `demo_${post.id.slice(0, 12)}` : null;
    const version = await db.postPlatform.create({
      data: {
        postId: post.id,
        workspaceId: workspace.id,
        socialAccountId: account.id,
        platform: account.platform,
        text: `Most teams treat automation as a shortcut.\n\nThe reliable version is less dramatic: define the state transitions, make retries idempotent, and write down why a permanent failure stopped.\n\nThat is the work.`,
        hashtags: ['#engineering', '#automation'],
        status: status === 'PUBLISHED' ? 'PUBLISHED' : status === 'FAILED' ? 'FAILED' : 'PENDING',
        platformPostId,
        platformUrl: platformPostId ? `https://demo.bridge88.local/p/${platformPostId}` : null,
        publishedAt: status === 'PUBLISHED' ? scheduledAt : null,
        errorMessage: status === 'FAILED' ? 'The demo channel was unavailable. Retry the post when ready.' : null,
        idempotencyKey: idempotencyKey(post.id, account.id),
      },
    });
    if (index % 3 !== 1) {
      await db.postMedia.create({
        data: {
          postPlatformId: version.id,
          mediaAssetId: media[index % media.length].id,
          position: 0,
          altText: 'A Northwind product field note on a pastel background.',
        },
      });
      await db.mediaAsset.update({ where: { id: media[index % media.length].id }, data: { usageCount: { increment: 1 } } });
    }
    if (status === 'PUBLISHED') {
      const impressions = 1400 + index * 780;
      const likes = 45 + index * 13;
      await db.postAnalytics.create({
        data: {
          workspaceId: workspace.id,
          postPlatformId: version.id,
          platform: account.platform,
          impressions,
          reach: Math.round(impressions * 0.72),
          likes,
          comments: Math.round(likes * 0.12),
          shares: Math.round(likes * 0.08),
          saves: account.platform === 'INSTAGRAM' ? Math.round(likes * 0.16) : null,
          clicks: account.platform === 'INSTAGRAM' ? null : Math.round(impressions * 0.018),
          engagementRate: likes / impressions,
          fetchedAt: new Date(),
        },
      });
    }
  }

  for (const [accountIndex, account] of accounts.entries()) {
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
      const capturedOn = new Date();
      capturedOn.setUTCHours(0, 0, 0, 0);
      capturedOn.setUTCDate(capturedOn.getUTCDate() - daysAgo);
      await db.analyticsSnapshot.create({
        data: {
          workspaceId: workspace.id,
          socialAccountId: account.id,
          platform: account.platform,
          capturedOn,
          followers: 4200 + accountIndex * 1800 + (14 - daysAgo) * 24,
          impressions: 2400 + (14 - daysAgo) * 130,
          reach: 1800 + (14 - daysAgo) * 90,
          engagements: 180 + (14 - daysAgo) * 8,
          postsPublished: daysAgo % 3 === 0 ? 1 : 0,
          raw: { mock: true },
        },
      });
    }
  }

  await db.notification.createMany({
    data: [
      { workspaceId: workspace.id, userId: user.id, type: 'POST_PUBLISHED', title: '“Three notes from the latest release” is live', body: 'Published to LinkedIn.' },
      { workspaceId: workspace.id, userId: user.id, type: 'APPROVAL_REQUESTED', title: 'A post is ready for review', body: 'The review step worth keeping.' },
      { workspaceId: workspace.id, userId: user.id, type: 'POST_FAILED', title: 'A post did not publish', body: 'The demo channel was unavailable. Retry when ready.' },
    ],
  });

  await seedMusicLibrary(workspace.id, user.id);
  const bedroomWorkflow = await seedBedroomWorkflow(workspace.id, user.id);
  await seedWorkflowHistory(bedroomWorkflow, user.id);

  console.log(`Seeded ${workspace.name}`);
  console.log(`Login: ${email} / demo-password`);
}

/**
 * Imports the tracks sitting in the repo's Music/ folder.
 *
 * DEVELOPMENT ONLY. Most of these are commercial recordings and must not ship in
 * a production seed; they are here so beat analysis and the slideshow renderer
 * can be exercised against real audio. `import.meta` guards nothing — the guard
 * is that this function is called from the demo seed alone.
 *
 * The hand-measured tempo table the v1 Python pipeline carried is preserved
 * alongside them as a validation set: inverting its secondsPerImage gives a
 * ground-truth tempo to check the detector against.
 */
const MUSIC_FIXTURES: { file: string; measuredSecondsPerImage: number | null }[] = [
  { file: 'Levitate.mp3', measuredSecondsPerImage: 3.15 },
  { file: 'Collide (sped up).mp3', measuredSecondsPerImage: 1.347 },
  { file: 'Richard Carter - Le Monde.mp3', measuredSecondsPerImage: 1.86 },
  { file: 'Aesthetic.mp3', measuredSecondsPerImage: 2.774 },
  { file: 'synthwave goose - blade runner 2049.mp3', measuredSecondsPerImage: 2.075 },
  { file: 'Cushy - Pushing (Royalty Free Music).mp3', measuredSecondsPerImage: 2.392 },
  { file: 'SUICIDAL-IDOL - ecstacy (slowed).mp3', measuredSecondsPerImage: 2.245 },
  { file: 'Amor Na Praia (Super Slowed).mp3', measuredSecondsPerImage: 2.8 },
  { file: 'Pasos De Fuego.mp3', measuredSecondsPerImage: 2.8 },
  { file: 'Hans Zimmer - Mountains (Interstellar Soundtrack).mp3', measuredSecondsPerImage: null },
  { file: 'Empire Of The Sun - Cherry Blossom.mp3', measuredSecondsPerImage: null },
];

async function seedMusicLibrary(workspaceId: string, userId: string) {
  const source = path.join(process.cwd(), '..', 'Music');
  const folder = await db.mediaFolder.create({
    data: { workspaceId, name: 'Music' },
  });

  let imported = 0;
  for (const fixture of MUSIC_FIXTURES) {
    const filePath = path.join(source, fixture.file);
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch {
      continue; // A missing fixture is not an error — the folder is gitignored.
    }

    const key = `workspaces/${workspaceId}/original/${randomUUID()}.mp3`;
    const destination = path.join(process.cwd(), 'storage', key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId,
        folderId: folder.id,
        uploadedById: userId,
        filename: fixture.file,
        mimeType: 'audio/mpeg',
        type: 'AUDIO',
        size: bytes.byteLength,
        storageKey: key,
        // PROCESSING so the media pipeline probes the duration and runs beat
        // analysis, exactly as it would for a real upload.
        status: 'PROCESSING',
        derivationPreset: JSON.stringify({
          kind: 'dev-fixture',
          measuredSecondsPerImage: fixture.measuredSecondsPerImage,
          note: 'Development fixture. Not licensed for distribution.',
        }),
      },
    });

    // The seed writes job rows directly rather than importing the queue, which
    // is server-only. The worker picks them up and runs the same path an upload
    // would: probe the duration, then analyse the beat grid.
    await db.job.create({
      data: {
        workspaceId,
        queue: 'MEDIA_PROCESSING',
        type: 'process-media',
        payload: { mediaAssetId: asset.id },
        dedupeKey: `process-media:${asset.id}`,
      },
    });
    imported += 1;
  }
  console.log(`Seeded ${imported} music fixtures (development only)`);
}

/** The worked example: theme in, numbered beat-cut video out. */
async function seedBedroomWorkflow(workspaceId: string, userId: string) {
  const workflow = await db.workflow.create({
    data: {
      workspaceId,
      createdById: userId,
      name: 'Bedroom picker',
      description:
        'Generates eight rooms from a theme, cuts them to the beat of a track, numbers each cut, and leaves a draft to review.',
      timezone: 'Europe/London',
    },
  });

  const node = (type: string, name: string, x: number, y: number, config: object) =>
    db.workflowNode.create({
      data: { workflowId: workflow.id, workspaceId, type, name, positionX: x, positionY: y, config },
    });

  const idea = await node('IDEA_GENERATOR', 'Room ideas', 40, 40, {
    mode: 'image',
    theme: 'a bedroom you would actually want to live in',
    count: 8,
    styleSuffix: '',
  });
  const images = await node('IMAGE_GENERATOR', 'Render rooms', 340, 40, {
    size: '1024x1536',
    maxImages: 8,
  });
  const library = await node('MEDIA_LIBRARY', 'Media library', 340, 260, {
    folderId: null,
    includeSubfolders: true,
  });
  const track = await node('PICK', 'Select a track', 560, 260, {
    mode: 'random',
    count: 1,
    index: 0,
  });
  const combined = await node('COMBINE_MEDIA', 'Combine room media', 580, 40, {
    sourceOrder: ['media1', 'media2', 'media3', 'media4'],
  });
  const slideshow = await node('BEAT_SLIDESHOW', 'Cut to the beat', 820, 140, {
    beatsPerClip: 8,
    size: '1080x1920',
    fps: 30,
    fit: 'cover',
    kenBurns: true,
    visualLeadMs: 0,
    fadeOutSeconds: 1.2,
  });
  const overlay = await node('TEXT_OVERLAY', 'Number each room', 1100, 140, {
    structure: 'numbered',
    template: '{index}',
    font: 'Archivo-Bold',
    position: 'top',
    fontSize: 0,
  });
  const draft = await node('CREATE_DRAFT', 'Leave a draft', 1420, 140, {
    title: '',
    caption: 'Which bedroom are you choosing?',
    campaignId: null,
    socialAccountIds: [],
  });

  const edge = (from: string, fromPort: string, to: string, toPort: string) =>
    db.workflowEdge.create({
      data: {
        workflowId: workflow.id,
        workspaceId,
        sourceNodeId: from,
        sourcePort: fromPort,
        targetNodeId: to,
        targetPort: toPort,
      },
    });

  await edge(idea.id, 'prompts', images.id, 'prompts');
  await edge(idea.id, 'titles', images.id, 'titles');
  await edge(images.id, 'images', combined.id, 'media1');
  await edge(images.id, 'titles', combined.id, 'titles1');
  await edge(library.id, 'images', combined.id, 'media2');
  await edge(library.id, 'imageTitles', combined.id, 'titles2');
  await edge(combined.id, 'media', slideshow.id, 'images');
  await edge(combined.id, 'titles', slideshow.id, 'titles');
  await edge(library.id, 'audio', track.id, 'items');
  await edge(track.id, 'item', slideshow.id, 'audio');
  await edge(slideshow.id, 'video', overlay.id, 'video');
  await edge(overlay.id, 'video', draft.id, 'video');
  await edge(idea.id, 'postTitle', draft.id, 'title');

  console.log('Seeded the "Bedroom picker" workflow');
  return {
    id: workflow.id,
    workspaceId,
    nodes: [idea, images, library, track, combined, slideshow, overlay, draft],
  };
}

/**
 * Past runs, so the history chart has something to show on a fresh install.
 *
 * Shaped like real history rather than a clean sweep: a couple of failures, one
 * cancellation, and durations that drift, because a chart of twenty identical
 * green bars teaches nobody how to read it.
 */
async function seedWorkflowHistory(
  workflow: { id: string; workspaceId: string; nodes: { id: string; name: string }[] },
  userId: string,
) {
  // index: [run status, index of the step that stopped it or -1, minutes]
  const script: [RunOutcome, number, number][] = [
    ['SUCCEEDED', -1, 2.4], ['SUCCEEDED', -1, 2.1], ['FAILED', 3, 0.6],
    ['SUCCEEDED', -1, 2.8], ['SUCCEEDED', -1, 2.2], ['SUCCEEDED', -1, 3.1],
    ['CANCELLED', 3, 1.4], ['SUCCEEDED', -1, 2.6], ['SUCCEEDED', -1, 2.3],
    ['SUCCEEDED', -1, 4.9], ['FAILED', 1, 0.3], ['SUCCEEDED', -1, 2.5],
    ['SUCCEEDED', -1, 2.7], ['SUCCEEDED', -1, 2.2], ['SUCCEEDED', -1, 6.2],
    ['SUCCEEDED', -1, 2.4], ['SUCCEEDED', -1, 2.9], ['SUCCEEDED', -1, 2.6],
  ];

  const graph = {
    version: 1 as const,
    nodes: workflow.nodes.map((n) => ({
      id: n.id, type: 'SEED', name: n.name, config: {}, version: 1, positionX: 0, positionY: 0,
    })),
    edges: [],
  };

  for (const [index, [outcome, stoppedAt, minutes]] of script.entries()) {
    // One run a day, walking backwards from yesterday.
    const startedAt = new Date(Date.now() - (script.length - index) * 24 * 60 * 60 * 1000);
    const durationMs = Math.round(minutes * 60_000);

    const run = await db.workflowRun.create({
      data: {
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        triggeredById: userId,
        trigger: index % 5 === 0 ? 'SCHEDULE' : 'MANUAL',
        status: outcome,
        graph,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + durationMs),
        durationMs,
        error:
          outcome === 'FAILED'
            ? `"${workflow.nodes[stoppedAt]?.name ?? 'A step'}" stopped this run.`
            : null,
      },
    });

    await db.workflowNodeRun.createMany({
      data: workflow.nodes.map((node, position) => ({
        workspaceId: workflow.workspaceId,
        runId: run.id,
        nodeId: node.id,
        nodeType: 'SEED',
        nodeName: node.name,
        status: nodeOutcome(outcome, stoppedAt, position),
        attempt: 1,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + durationMs / workflow.nodes.length),
        durationMs: Math.round(durationMs / workflow.nodes.length),
      })),
    });
  }
  console.log(`Seeded ${script.length} past workflow runs`);
}

type RunOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Steps before the stopping point ran; the one that stopped it holds the blame. */
function nodeOutcome(outcome: RunOutcome, stoppedAt: number, position: number) {
  if (outcome === 'SUCCEEDED') return 'SUCCEEDED' as const;
  if (position < stoppedAt) return 'SUCCEEDED' as const;
  if (position === stoppedAt) return outcome === 'FAILED' ? ('FAILED' as const) : ('CANCELLED' as const);
  return outcome === 'FAILED' ? ('SKIPPED' as const) : ('CANCELLED' as const);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

async function createDemoAccount(
  workspaceId: string,
  platform: Platform,
  accountName: string,
  handle: string,
) {
  return db.socialAccount.create({
    data: {
      workspaceId,
      platform,
      accountName,
      accountHandle: handle,
      externalAccountId: `demo-${platform.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      scopes: ['read', 'publish', 'analytics'],
      status: 'ACTIVE',
      lastSyncedAt: new Date(),
      metadata: { mock: true, handle },
    },
  });
}

/**
 * Demo assets ship as PNG because every platform rejects SVG uploads, and a
 * seeded library that cannot be published is a misleading demo. The flat ground
 * is the fallback for sharp builds without SVG text support.
 */
async function rasterize(svg: string, background: string): Promise<Buffer> {
  try {
    return await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
  } catch {
    return sharp({ create: { width: 1080, height: 1080, channels: 3, background } }).png().toBuffer();
  }
}

function idempotencyKey(postId: string, socialAccountId: string): string {
  return createHash('sha256').update(`${postId}:${socialAccountId}`).digest('hex').slice(0, 40);
}
