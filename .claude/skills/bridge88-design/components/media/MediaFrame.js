import React from 'react';

const B88_RATIOS = { '1:1': '1 / 1', '4:5': '4 / 5', '9:16': '9 / 16', '16:9': '16 / 9', '1.91:1': '1.91 / 1' };
const B88_PLACEHOLDER_TONES = {
  mint: 'var(--block-mint)', cream: 'var(--block-cream)', lime: 'var(--block-lime)',
  lilac: 'var(--block-lilac)', coral: 'var(--block-coral)', pink: 'var(--block-pink)',
  soft: 'var(--surface-soft)'
};

export function MediaFrame({
  src, type = 'image', ratio = '4:5', alt, poster, duration, label,
  tone = 'soft', showAltWarning = false, overlay, style, ...rest
}) {
  const frameStyle = {
    position: 'relative', width: '100%', aspectRatio: B88_RATIOS[ratio] || ratio,
    borderRadius: 'var(--radius-md)', overflow: 'hidden',
    background: B88_PLACEHOLDER_TONES[tone] || B88_PLACEHOLDER_TONES.soft,
    color: 'var(--block-ink)', display: 'grid', placeItems: 'center', ...style
  };
  const chip = {
    position: 'absolute', fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)',
    letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase',
    background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)',
    borderRadius: 'var(--radius-sm)', padding: '3px 8px'
  };
  return (
    <div style={frameStyle} {...rest}>
      {src ? (
        type === 'video'
          ? <video src={src} poster={poster} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={src} alt={alt || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)',
          letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.7, textAlign: 'center', padding: 'var(--space-sm)'
        }}>{label || (type === 'video' ? 'Video placeholder' : 'Image placeholder')} · {ratio}</span>
      )}
      {duration && <span style={{ ...chip, bottom: 8, right: 8 }}>{duration}</span>}
      {showAltWarning && !alt && <span style={{ ...chip, top: 8, left: 8 }}>Alt missing</span>}
      {overlay}
    </div>
  );
}
