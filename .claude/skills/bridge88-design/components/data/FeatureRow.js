import React from 'react';
import { CheckGlyph } from './CheckGlyph.js';

export function FeatureRow({ label, values = [], style, ...rest }) {
  const rowStyle = {
    display: 'grid', gridTemplateColumns: `minmax(0,2fr) repeat(${values.length},minmax(0,1fr))`,
    alignItems: 'center', gap: 'var(--space-md)',
    padding: 'var(--space-sm) 0', borderBottom: '1px solid var(--hairline-soft)',
    background: 'var(--surface-card)', color: 'var(--ink)',
    fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)', ...style
  };
  return (
    <div style={rowStyle} {...rest}>
      <span>{label}</span>
      {values.map((v, i) => (
        <span key={i} style={{ display: 'flex', justifyContent: 'center' }}>
          {v === true ? <CheckGlyph /> : v === false ? <span aria-hidden="true" style={{ opacity: 0.25 }}>—</span> : v}
        </span>
      ))}
    </div>
  );
}
