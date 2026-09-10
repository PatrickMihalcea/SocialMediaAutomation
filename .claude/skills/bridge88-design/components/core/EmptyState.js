import React from 'react';

export function EmptyState({ eyebrow, title, children, action, icon, tone = 'dashed', style, ...rest }) {
  const surfaces = {
    dashed: { background: 'transparent', border: '1px dashed var(--hairline)' },
    soft: { background: 'var(--surface-soft)', border: 'none' }
  };
  return (
    <div style={{
      ...(surfaces[tone] || surfaces.dashed), borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-xxl)', display: 'grid', gap: 'var(--space-sm)', justifyItems: 'start', ...style
    }} {...rest}>
      {icon}
      {eyebrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{eyebrow}</span>}
      {title && <h3 style={{ fontSize: 'var(--headline-size)', fontWeight: 'var(--headline-weight)', lineHeight: 'var(--headline-leading)', letterSpacing: 'var(--headline-tracking)' }}>{title}</h3>}
      {children && <p style={{ fontSize: 'var(--body-size)', fontWeight: 'var(--body-weight)', maxWidth: 560 }}>{children}</p>}
      {action && <div style={{ paddingTop: 'var(--space-xs)' }}>{action}</div>}
    </div>
  );
}
