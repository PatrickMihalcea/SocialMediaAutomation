import React from 'react';

export function PromoBanner({ tone = 'lilac', eyebrow, children, action, style, ...rest }) {
  const banners = { lilac: 'var(--block-lilac)', lime: 'var(--block-lime)', cream: 'var(--block-cream)' };
  const bannerStyle = {
    background: banners[tone] || banners.lilac, color: 'var(--block-ink)',
    borderRadius: 'var(--radius-md)', padding: 'var(--space-md) var(--space-lg)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 'var(--space-lg)', flexWrap: 'wrap', ...style
  };
  return (
    <div style={bannerStyle} {...rest}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        {eyebrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase' }}>{eyebrow}</span>}
        <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)' }}>{children}</span>
      </div>
      {action}
    </div>
  );
}
