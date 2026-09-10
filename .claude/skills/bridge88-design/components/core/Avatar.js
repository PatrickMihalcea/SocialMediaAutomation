import React from 'react';

export function Avatar({ name = '', src, size = 32, tone = 'neutral', style, ...rest }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const fills = { neutral: 'var(--surface-soft)', lime: 'var(--block-lime)', lilac: 'var(--block-lilac)', mint: 'var(--block-mint)', coral: 'var(--block-coral)' };
  return (
    <span title={name} style={{
      width: size, height: size, flex: '0 0 ' + size + 'px', borderRadius: 'var(--radius-full)',
      background: fills[tone] || fills.neutral, color: 'var(--block-ink)',
      display: 'grid', placeItems: 'center', overflow: 'hidden',
      fontFamily: 'var(--font-mono)', fontSize: Math.max(9, Math.round(size * 0.34)),
      letterSpacing: '0.4px', ...style
    }} {...rest}>
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </span>
  );
}
