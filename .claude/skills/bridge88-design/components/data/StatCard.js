import React from 'react';

export function StatCard({ label, value, delta, trend = 'up', footnote, style, ...rest }) {
  const deltaColor = trend === 'flat' ? 'var(--ink)' : 'var(--success)';
  return (
    <div style={{
      border: '1px solid var(--hairline)', borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-lg)', background: 'var(--surface-card)', color: 'var(--ink)',
      display: 'grid', gap: 'var(--space-xs)', ...style
    }} {...rest}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{label}</span>
      <span style={{ fontSize: 'var(--display-lg-size)', fontWeight: 'var(--display-lg-weight)', letterSpacing: 'var(--display-lg-tracking)', lineHeight: 1 }}>{value}</span>
      {delta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', color: deltaColor }}>{delta}</span>}
      {footnote && <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', opacity: 0.7 }}>{footnote}</span>}
    </div>
  );
}
