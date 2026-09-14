'use client';

import { useState } from 'react';

import type { ReactNode } from 'react';
import type { Platform } from '@prisma/client';
import { Avatar, MediaFrame } from '@/bridge88/components';
import { CAPABILITIES } from '@/lib/social/capabilities';
import { PLATFORM_LABELS } from '@/lib/social/labels';
import type { ComposerAccount, ComposerAsset, PlatformVersionState } from '@/lib/posts/composer';

type PreviewProps = {
  account: ComposerAccount;
  /** Undefined for the instant between selecting a channel and its version existing. */
  version: PlatformVersionState | undefined;
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
  if (!version) return null;
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
          src={primary ? assetSource(primary) : undefined}
            poster={primary?.thumbnailUrl}
            overlay={primary && isVideo(primary) ? <PlayGlyph /> : undefined}
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
              src={assetSource(item)}
            poster={item.thumbnailUrl}
            overlay={isVideo(item) ? <PlayGlyph /> : undefined}
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
                  src={assetSource(item)}
            poster={item.thumbnailUrl}
            overlay={isVideo(item) ? <PlayGlyph /> : undefined}
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
            src={assetSource(media[0])}
            poster={media[0].thumbnailUrl}
            overlay={isVideo(media[0]) ? <PlayGlyph /> : undefined}
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
            src={assetSource(media[0])}
            poster={media[0].thumbnailUrl}
            overlay={isVideo(media[0]) ? <PlayGlyph /> : undefined}
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
          src={primary ? assetSource(primary) : undefined}
            poster={primary?.thumbnailUrl}
            overlay={primary && isVideo(primary) ? <PlayGlyph /> : undefined}
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
        src={primary ? assetSource(primary) : undefined}
            poster={primary?.thumbnailUrl}
            overlay={primary && isVideo(primary) ? <PlayGlyph /> : undefined}
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
            src={assetSource(media[0])}
            poster={media[0].thumbnailUrl}
            overlay={isVideo(media[0]) ? <PlayGlyph /> : undefined}
            tone="soft"
          />
        </div>
      )}
    </PreviewShell>
  );
}

const isVideo = (asset: ComposerAsset) => asset.type === 'VIDEO';

/**
 * What a MediaFrame should actually load.
 *
 * Video needs the file itself — MediaFrame feeds `src` straight into a <video>,
 * and a poster image there renders an empty frame with no controls, which is
 * what made a finished render look like an empty draft. Stills stay on the
 * thumbnail: it is smaller and the frame never shows them larger than this.
 */
const assetSource = (asset: ComposerAsset) => (isVideo(asset) ? asset.url : asset.thumbnailUrl);

/**
 * The circular play control, and it actually plays.
 *
 * It was decorative — aria-hidden, no handler, on a <video> with no controls —
 * so clicking it did nothing at all. It now starts the video in place and gets
 * out of the way, which is what a poster with a play button promises.
 */
function PlayGlyph() {
  const [playing, setPlaying] = useState(false);

  if (playing) return null;
  return (
    <button
      type="button"
      aria-label="Play this video"
      onClick={(event) => {
        // The control sits inside the frame, so the video is its sibling.
        const frame = event.currentTarget.parentElement;
        const video = frame?.querySelector('video');
        if (!video) return;
        video.controls = true;
        void video.play();
        setPlaying(true);
      }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 48,
        height: 48,
        padding: 0,
        border: 'none',
        cursor: 'pointer',
        borderRadius: 'var(--radius-full)',
        background: 'rgba(0,0,0,0.58)',
        display: 'grid',
        placeItems: 'center',
        transition: 'opacity var(--duration-fast) var(--ease-standard)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 0,
          height: 0,
          marginLeft: 3,
          borderTop: '9px solid transparent',
          borderBottom: '9px solid transparent',
          borderLeft: '14px solid #fff',
        }}
      />
    </button>
  );
}
