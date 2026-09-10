import React from 'react';

const B88_BLOCKS = {
  lime: { background: 'var(--block-lime)', color: 'var(--block-ink)' },
  lilac: { background: 'var(--block-lilac)', color: 'var(--block-ink)' },
  cream: { background: 'var(--block-cream)', color: 'var(--block-ink)' },
  pink: { background: 'var(--block-pink)', color: 'var(--block-ink)' },
  mint: { background: 'var(--block-mint)', color: 'var(--block-ink)' },
  coral: { background: 'var(--block-coral)', color: 'var(--block-ink)' },
  navy: { background: 'var(--block-navy)', color: 'var(--block-ink-navy)' }
};

export function ColorBlockSection({ tone = 'lime', eyebrow, title, children, media, fullBleed = false, style, ...rest }) {
  const blockStyle = {
    ...(B88_BLOCKS[tone] || B88_BLOCKS.lime),
    borderRadius: fullBleed ? 0 : 'var(--radius-lg)',
    padding: 'var(--space-xxl)', boxShadow: 'none',
    display: 'grid', gap: 'var(--space-xl)',
    gridTemplateColumns: media ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)',
    alignItems: 'center', ...style
  };
  return (
    <section style={blockStyle} {...rest}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: media ? 'none' : '62%' }}>
        {eyebrow && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 'var(--eyebrow-size)', fontWeight: 'var(--eyebrow-weight)',
            letterSpacing: 'var(--eyebrow-tracking)', textTransform: 'uppercase'
          }}>{eyebrow}</span>
        )}
        {title && (
          <h2 style={{
            fontSize: 'var(--display-lg-size)', fontWeight: 'var(--display-lg-weight)',
            lineHeight: 'var(--display-lg-leading)', letterSpacing: 'var(--display-lg-tracking)'
          }}>{title}</h2>
        )}
        {children && (
          <div style={{
            fontSize: 'var(--subhead-size)', fontWeight: 'var(--subhead-weight)',
            lineHeight: 'var(--subhead-leading)', letterSpacing: 'var(--subhead-tracking)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', alignItems: 'flex-start'
          }}>{children}</div>
        )}
      </div>
      {media}
    </section>
  );
}
