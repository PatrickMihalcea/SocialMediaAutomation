import React from 'react';

export function FeatureTile({ eyebrow, title, children, media, style, ...rest }) {
  const featureTileStyle = {
    background: 'var(--surface-tile)', color: 'var(--ink)',
    borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', ...style
  };
  return (
    <div style={featureTileStyle} {...rest}>
      {eyebrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--eyebrow-size)', letterSpacing: 'var(--eyebrow-tracking)', textTransform: 'uppercase' }}>{eyebrow}</span>}
      {title && <h3 style={{ fontSize: 'var(--headline-size)', fontWeight: 'var(--headline-weight)', lineHeight: 'var(--headline-leading)', letterSpacing: 'var(--headline-tracking)' }}>{title}</h3>}
      {children && <div style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)' }}>{children}</div>}
      {media && <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--canvas)' }}>{media}</div>}
    </div>
  );
}
