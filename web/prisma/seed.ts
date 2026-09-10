import { PrismaClient, Platform, PostStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const db = new PrismaClient();

async function main() {
  const email = 'demo@bridge88.local';
  const old = await db.user.findUnique({ where: { email } });
  if (old) await db.user.delete({ where: { id: old.id } });

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

  console.log(`Seeded ${workspace.name}`);
  console.log(`Login: ${email} / demo-password`);
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
