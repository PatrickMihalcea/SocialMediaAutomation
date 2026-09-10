import React from 'react';

export function TemplateCard({ title, meta, preview, tilt = 0, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const tileStyle = {
    background: 'var(--surface-tile)', color: 'var(--ink)',
    borderRadius: 'var(--radius-md)', padding: 'var(--space-md)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)',
    cursor: onClick ? 'pointer' : 'default', border: 'none', textAlign: 'left',
    transform: `rotate(${tilt}deg)`,
    boxShadow: hover ? 'var(--elevation-2)' : 'none',
    transition: 'box-shadow var(--duration-base) var(--ease-standard)', ...style
  };
  return (
    <div style={tileStyle} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} {...rest}>
      <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--canvas)', minHeight: 96, display: 'grid', placeItems: 'center' }}>{preview}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--weight-medium)', lineHeight: 'var(--body-sm-leading)' }}>{title}</span>
        {meta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.7 }}>{meta}</span>}
      </div>
    </div>
  );
}
