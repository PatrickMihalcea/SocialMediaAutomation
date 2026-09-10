import React from 'react';

export function SegmentedTabs({ items = [], value, onChange, style, ...rest }) {
  const active = value ?? items[0];
  const tabStyle = (isActive) => ({
    fontFamily: 'var(--font-sans)', fontSize: 'var(--button-size)', fontWeight: 'var(--button-weight)',
    lineHeight: 'var(--button-leading)', letterSpacing: 'var(--button-tracking)',
    padding: '8px 18px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
    background: isActive ? 'var(--primary)' : 'transparent',
    color: isActive ? 'var(--on-primary)' : 'var(--ink)',
    whiteSpace: 'nowrap', minHeight: '40px',
    transition: 'background var(--duration-fast) var(--ease-standard)'
  });
  return (
    <div role="tablist" style={{ display: 'flex', gap: 'var(--space-xxs)', flexWrap: 'wrap', ...style }} {...rest}>
      {items.map((item) => (
        <button key={item} role="tab" aria-selected={item === active}
          onClick={() => onChange && onChange(item)} style={tabStyle(item === active)}>{item}</button>
      ))}
    </div>
  );
}
