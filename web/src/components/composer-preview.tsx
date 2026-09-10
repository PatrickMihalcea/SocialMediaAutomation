'use client';

import type { ReactNode } from 'react';
import type { Platform } from '@prisma/client';
import { Avatar, MediaFrame } from '@/bridge88/components';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import type { ComposerAccount, ComposerAsset, PlatformVersionState } from '@/lib/posts/composer';

type PreviewProps = {
  account: ComposerAccount;
  version: PlatformVersionState;
  assets: ComposerAsset[];
};

function mediaForVersion(version: PlatformVersionState, assets: ComposerAsset[]) {
  return version.media
    .map((item) => assets.find((asset) => asset.id === item.mediaAssetId))
    .filter((asset): asset is ComposerAsset => Boolean(asset));
}

function captionText(version: PlatformVersionState) {
  const tags = version.hashtags
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
  return [version.text.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
}

function assetFrameType(asset: ComposerAsset) {
  return asset.type === 'VIDEO' ? 'video' : 'image';
}

export function ComposerPreview({ account, version, assets }: PreviewProps) {
  const media = mediaForVersion(version, assets);
  const caption = captionText(version);
  const label = account.accountHandle ?? account.accountName;

  switch (account.platform) {
    case 'INSTAGRAM':
      return <InstagramPreview name={label} caption={caption} media={media} />;
    case 'X':
      return <XPreview name={label} caption={caption} media={media} link={version.link} />;
    case 'LINKEDIN':
      return <LinkedInPreview name={account.accountName} caption={caption} media={media} link={version.link} />;
    case 'FACEBOOK':
      return <FacebookPreview name={account.accountName} caption={caption} media={media} link={version.link} />;
    case 'TIKTOK':
      return <TikTokPreview name={label} caption={caption} media={media} />;
    case 'YOUTUBE':
      return <YouTubePreview name={account.accountName} caption={caption} media={media} />;
    default:
      return <GenericPreview platform={account.platform} name={label} caption={caption} media={media} />;
  }
}

function PreviewShell({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  return (
    <section className="b88-card">
      <p className="b88-caption">{PLATFORM_LABELS[platform]} preview</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InstagramPreview({
  name,
  caption,
  media,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
}) {
  const primary = media[0];
  return (
    <PreviewShell platform="INSTAGRAM">
      <div className="flex items-center gap-2 border-b border-hairline-soft pb-4">
        <Avatar name={name} size={32} />
        <p className="text-sm font-[540]">{name}</p>
      </div>
      <div className="mt-4">
        <MediaFrame
          ratio="1:1"
          type={primary ? assetFrameType(primary) : 'image'}
          src={primary?.thumbnailUrl}
          tone="lilac"
          label="Add a photo or video"
        />
      </div>
      {media.length > 1 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {media.slice(1, 4).map((item) => (
            <MediaFrame
              key={item.id}
              ratio="1:1"
              type={assetFrameType(item)}
              src={item.thumbnailUrl}
              tone="lilac"
            />
          ))}
        </div>
      )}
      <p className="mt-4 whitespace-pre-wrap text-sm">{caption || 'Caption appears here.'}</p>
      {CAPABILITIES.INSTAGRAM.supportsFirstComment && (
        <p className="b88-caption mt-2">First comment preview is hidden in the feed card.</p>
      )}
    </PreviewShell>
  );
}

function XPreview({
  name,
  caption,
  media,
  link,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
  link: string;
}) {
  const remaining = CAPABILITIES.X.maxTextLength - caption.length;
  return (
    <PreviewShell platform="X">
      <div className="flex gap-3">
        <Avatar name={name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-[540]">{name}</p>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{caption || 'Post text'}</p>
          {link && (
            <p className="mt-2 truncate text-sm text-[var(--accent-magenta)]">{link}</p>
          )}
          {media.length > 0 && (
            <div className={`mt-4 grid gap-2 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {media.slice(0, 4).map((item) => (
                <MediaFrame
                  key={item.id}
                  ratio="1:1"
                  type={assetFrameType(item)}
                  src={item.thumbnailUrl}
                  tone="soft"
                />
              ))}
            </div>
          )}
          <p className={`mt-3 font-[480] ${remaining < 0 ? 'text-sm text-[var(--accent-magenta)]' : 'b88-caption'}`}>
            {remaining} characters left
          </p>
        </div>
      </div>
    </PreviewShell>
  );
}

function LinkedInPreview({
  name,
  caption,
  media,
  link,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
  link: string;
}) {
  return (
    <PreviewShell platform="LINKEDIN">
      <div className="flex gap-3">
        <Avatar name={name} size={44} />
        <div>
          <p className="text-sm font-[540]">{name}</p>
          <p className="b88-caption">Just now</p>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">{caption || 'Professional update'}</p>
      {media[0] && (
        <div className="mt-4">
          <MediaFrame
            ratio="4:5"
            type={assetFrameType(media[0])}
            src={media[0].thumbnailUrl}
            tone="soft"
          />
        </div>
      )}
      {link && <p className="mt-2 truncate text-sm">{link}</p>}
    </PreviewShell>
  );
}

function FacebookPreview({
  name,
  caption,
  media,
  link,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
  link: string;
}) {
  return (
    <PreviewShell platform="FACEBOOK">
      <div className="flex items-center gap-3">
        <Avatar name={name} size={40} />
        <div>
          <p className="text-sm font-[540]">{name}</p>
          <p className="b88-caption">Just now</p>
        </div>
      </div>
      <p className="mt-4 whitespace-pre-wrap">{caption || 'What is on your mind?'}</p>
      {media[0] && (
        <div className="mt-4">
          <MediaFrame
            ratio="4:5"
            type={assetFrameType(media[0])}
            src={media[0].thumbnailUrl}
            tone="soft"
          />
        </div>
      )}
      {link && <p className="mt-2 text-sm text-[var(--accent-magenta)]">{link}</p>}
    </PreviewShell>
  );
}

function TikTokPreview({
  name,
  caption,
  media,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
}) {
  const primary = media[0];
  return (
    <PreviewShell platform="TIKTOK">
      <div className="mx-auto max-w-[220px]">
        <MediaFrame
          ratio="9:16"
          type={primary ? assetFrameType(primary) : 'video'}
          src={primary?.thumbnailUrl}
          tone="coral"
          label="Vertical video preview"
        />
        <p className="mt-4 text-sm font-[540]">{name}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{caption || 'Caption and hashtags'}</p>
      </div>
    </PreviewShell>
  );
}

function YouTubePreview({
  name,
  caption,
  media,
}: {
  name: string;
  caption: string;
  media: ComposerAsset[];
}) {
  const primary = media[0];
  return (
    <PreviewShell platform="YOUTUBE">
      <MediaFrame
        ratio="16:9"
        type={primary ? assetFrameType(primary) : 'video'}
        src={primary?.thumbnailUrl}
        tone="mint"
        label="Video thumbnail"
      />
      <p className="mt-4 text-base font-[540]">{caption.split('\n')[0] || 'Video title from first line'}</p>
      <p className="b88-caption mt-2">{name}</p>
      <p className="mt-3 whitespace-pre-wrap text-sm">{caption || 'Description'}</p>
    </PreviewShell>
  );
}

function GenericPreview({
  platform,
  name,
  caption,
  media,
}: {
  platform: Platform;
  name: string;
  caption: string;
  media: ComposerAsset[];
}) {
  return (
    <PreviewShell platform={platform}>
      <p className="text-sm font-[540]">{name}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{caption || 'Post preview'}</p>
      {media[0] && (
        <div className="mt-4">
          <MediaFrame
            ratio="4:5"
            type={assetFrameType(media[0])}
            src={media[0].thumbnailUrl}
            tone="soft"
          />
        </div>
      )}
    </PreviewShell>
  );
}
