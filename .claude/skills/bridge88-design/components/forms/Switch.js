import React from 'react';

export function Switch({ label, description, checked, defaultChecked, disabled = false, onChange, style, ...rest }) {
  const [inner, setInner] = React.useState(!!defaultChecked);
  const isOn = checked !== undefined ? checked : inner;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInner(!isOn);
    onChange && onChange(!isOn);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', opacity: disabled ? 0.4 : 1, minHeight: 'var(--touch-min)', ...style }}>
      <button role="switch" aria-checked={isOn} aria-label={label} onClick={toggle} disabled={disabled} style={{
        width: 44, height: 26, flex: '0 0 44px', borderRadius: 'var(--radius-full)', padding: 3,
        border: '1px solid ' + (isOn ? 'var(--ink)' : 'var(--hairline)'),
        background: isOn ? 'var(--primary)' : 'var(--surface-soft)',
        cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex',
        justifyContent: isOn ? 'flex-end' : 'flex-start', alignItems: 'center',
        transition: 'background var(--duration-fast) var(--ease-standard)'
      }} {...rest}>
        <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-full)', background: isOn ? 'var(--on-primary)' : 'var(--canvas)', border: isOn ? 'none' : '1px solid var(--hairline)' }} />
      </button>
      <span style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)' }}>{label}</span>
        {description && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{description}</span>}
      </span>
    </div>
  );
}
