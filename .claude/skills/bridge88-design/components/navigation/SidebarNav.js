import React from 'react';

export function SidebarNav({ brand = 'Bridge88', items = [], value, onChange, footer, width = 248, style, ...rest }) {
  const itemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
    padding: '8px 14px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer',
    background: active ? 'var(--primary)' : 'transparent',
    color: active ? 'var(--on-primary)' : 'var(--ink)',
    fontFamily: 'var(--font-sans)', fontSize: 'var(--body-sm-size)',
    fontWeight: active ? 'var(--weight-medium)' : 'var(--body-sm-weight)',
    letterSpacing: 'var(--body-sm-tracking)', textAlign: 'left', width: '100%', minHeight: 40
  });
  return (
    <aside style={{
      width, flex: '0 0 ' + width + 'px', borderRight: '1px solid var(--hairline)',
      background: 'var(--canvas)', color: 'var(--ink)', padding: 'var(--space-lg) var(--space-md)',
      display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', ...style
    }} {...rest}>
      {brand && <span style={{ fontSize: 22, fontWeight: 'var(--weight-semi)', letterSpacing: '-0.5px', padding: '0 8px' }}>{brand}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item) => {
          const label = item.label ?? item;
          return (
            <button key={label} style={itemStyle(label === value)} onClick={() => onChange && onChange(label)}>
              {item.icon}{label}
            </button>
          );
        })}
      </div>
      {footer && <div style={{ marginTop: 'auto' }}>{footer}</div>}
    </aside>
  );
}
