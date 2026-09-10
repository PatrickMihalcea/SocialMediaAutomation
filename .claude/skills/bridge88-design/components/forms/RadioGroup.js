import React from 'react';

export function RadioGroup({ label, options = [], value, defaultValue, onChange, name, style, ...rest }) {
  const groupName = name || React.useId();
  const [inner, setInner] = React.useState(defaultValue ?? (options[0] && (options[0].value ?? options[0])));
  const current = value !== undefined ? value : inner;
  const pick = (v) => { if (value === undefined) setInner(v); onChange && onChange(v); };
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-xs)', ...style }} {...rest}>
      {label && <legend style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6, padding: 0, marginBottom: 'var(--space-xxs)' }}>{label}</legend>}
      {options.map((opt) => {
        const v = opt.value ?? opt;
        const text = opt.label ?? opt;
        const on = v === current;
        return (
          <label key={v} style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', cursor: 'pointer', minHeight: 'var(--touch-min)' }}>
            <input type="radio" name={groupName} checked={on} onChange={() => pick(v)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
            <span aria-hidden="true" style={{
              width: 20, height: 20, flex: '0 0 20px', borderRadius: 'var(--radius-full)',
              border: '1px solid ' + (on ? 'var(--ink)' : 'var(--hairline)'),
              background: 'var(--canvas)', display: 'grid', placeItems: 'center', marginTop: 2
            }}><span style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: on ? 'var(--primary)' : 'transparent' }} /></span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)' }}>{text}</span>
              {opt.description && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
