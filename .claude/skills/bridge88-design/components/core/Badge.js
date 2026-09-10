import React from 'react';

const B88_BADGE_TONES = {
  neutral: { background: 'var(--surface-soft)', color: 'var(--ink)' },
  ink: { background: 'var(--primary)', color: 'var(--on-primary)' },
  lime: { background: 'var(--block-lime)', color: 'var(--block-ink)' },
  lilac: { background: 'var(--block-lilac)', color: 'var(--block-ink)' },
  cream: { background: 'var(--block-cream)', color: 'var(--block-ink)' },
  mint: { background: 'var(--block-mint)', color: 'var(--block-ink)' },
  coral: { background: 'var(--block-coral)', color: 'var(--block-ink)' },
  outline: { background: 'transparent', color: 'var(--ink)', border: '1px solid var(--hairline)' }
};

export function Badge({ children, tone = 'neutral', shape = 'chip', style, ...rest }) {
  return (
    <span style={{
      ...(B88_BADGE_TONES[tone] || B88_BADGE_TONES.neutral),
      borderRadius: shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-sm)',
      padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xxs)',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)',
      letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', whiteSpace: 'nowrap', ...style
    }} {...rest}>{children}</span>
  );
}
