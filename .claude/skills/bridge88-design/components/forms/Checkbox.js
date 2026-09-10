import React from 'react';

export function Checkbox({ label, description, checked, defaultChecked, disabled = false, onChange, id, style, ...rest }) {
  const inputId = id || React.useId();
  const [inner, setInner] = React.useState(!!defaultChecked);
  const isOn = checked !== undefined ? checked : inner;
  const boxStyle = {
    width: 20, height: 20, flex: '0 0 20px', borderRadius: 'var(--radius-sm)',
    border: '1px solid ' + (isOn ? 'var(--ink)' : 'var(--hairline)'),
    background: isOn ? 'var(--primary)' : 'var(--canvas)', color: 'var(--on-primary)',
    display: 'grid', placeItems: 'center', fontSize: 13, lineHeight: 1,
    transition: 'background var(--duration-fast) var(--ease-standard)'
  };
  return (
    <label htmlFor={inputId} style={{
      display: 'flex', gap: 'var(--space-sm)', alignItems: description ? 'flex-start' : 'center',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, minHeight: 'var(--touch-min)', ...style
    }}>
      <input id={inputId} type="checkbox" checked={isOn} disabled={disabled}
        onChange={(e) => { if (checked === undefined) setInner(e.target.checked); onChange && onChange(e); }}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
      <span aria-hidden="true" style={boxStyle}>{isOn ? '✓' : ''}</span>
      <span style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', letterSpacing: 'var(--body-sm-tracking)' }}>{label}</span>
        {description && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{description}</span>}
      </span>
    </label>
  );
}
