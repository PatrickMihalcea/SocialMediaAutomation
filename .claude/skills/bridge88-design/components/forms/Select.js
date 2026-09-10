import React from 'react';

export function Select({ label, hint, options = [], value, defaultValue, onChange, disabled = false, id, style, ...rest }) {
  const selectId = id || React.useId();
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-xs)', ...style }}>
      {label && <label htmlFor={selectId} style={{ fontSize: 'var(--body-lg-size)', fontWeight: 'var(--body-lg-weight)', letterSpacing: 'var(--body-lg-tracking)' }}>{label}</label>}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <select id={selectId} value={value} defaultValue={defaultValue} disabled={disabled}
          onChange={onChange} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{
            width: '100%', appearance: 'none', background: 'var(--canvas)', color: 'var(--ink)',
            fontFamily: 'var(--font-sans)', fontSize: 'var(--body-size)', fontWeight: 'var(--body-weight)',
            letterSpacing: 'var(--body-tracking)', borderRadius: 'var(--radius-md)',
            padding: '12px 40px 12px 14px', border: '1px solid var(--hairline)', minHeight: 48,
            outline: focused ? '2px solid var(--focus-ring)' : 'none', outlineOffset: 1,
            opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer'
          }} {...rest}>
          {options.map((opt) => {
            const v = opt.value ?? opt;
            return <option key={v} value={v}>{opt.label ?? opt}</option>;
          })}
        </select>
        <span aria-hidden="true" style={{ position: 'absolute', right: 14, pointerEvents: 'none', fontSize: 12 }}>▾</span>
      </div>
      {hint && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{hint}</span>}
    </div>
  );
}
