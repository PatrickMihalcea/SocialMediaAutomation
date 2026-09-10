import React from 'react';

export function CheckGlyph({ size = 16, style, ...rest }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 'var(--radius-full)',
      background: 'var(--canvas)', color: 'var(--success)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size, lineHeight: 1, ...style
    }} {...rest}>✓</span>
  );
}
