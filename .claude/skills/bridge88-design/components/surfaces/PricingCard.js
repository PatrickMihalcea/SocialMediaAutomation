import React from 'react';

export function PricingCard({ tier, price, cadence, blurb, features = [], cta, highlighted = false, style, ...rest }) {
  const cardStyle = {
    background: 'var(--surface-card)', color: 'var(--ink)',
    border: highlighted ? '1px solid var(--ink)' : '1px solid var(--hairline)',
    borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', ...style
  };
  return (
    <div style={cardStyle} {...rest}>
      <span style={{ fontSize: 'var(--card-title-size)', fontWeight: 'var(--card-title-weight)', lineHeight: 'var(--card-title-leading)' }}>{tier}</span>
      {price && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-xs)' }}>
          <span style={{ fontSize: 'var(--display-lg-size)', fontWeight: 'var(--display-lg-weight)', lineHeight: 1, letterSpacing: 'var(--display-lg-tracking)' }}>{price}</span>
          {cadence && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase' }}>{cadence}</span>}
        </div>
      )}
      {blurb && <p style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)' }}>{blurb}</p>}
      {features.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          {features.map((feat) => (
            <li key={feat} style={{ display: 'flex', gap: 'var(--space-xs)', fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)' }}>
              <span aria-hidden="true" style={{ color: 'var(--success)' }}>✓</span>{feat}
            </li>
          ))}
        </ul>
      )}
      {cta && <div style={{ marginTop: 'auto', paddingTop: 'var(--space-xs)' }}>{cta}</div>}
    </div>
  );
}
