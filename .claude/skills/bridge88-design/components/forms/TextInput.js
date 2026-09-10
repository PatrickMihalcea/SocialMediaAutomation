import React from 'react';

export function TextInput({
  label, hint, value, defaultValue, placeholder, type = 'text', multiline = false,
  rows = 4, disabled = false, onChange, id, style, ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const inputId = id || React.useId();
  const fieldStyle = {
    width: '100%', background: 'var(--canvas)', color: 'var(--ink)',
    fontFamily: 'var(--font-sans)', fontSize: 'var(--body-size)', fontWeight: 'var(--body-weight)',
    lineHeight: 'var(--body-leading)', letterSpacing: 'var(--body-tracking)',
    borderRadius: 'var(--radius-md)', padding: '12px 14px',
    border: '1px solid var(--hairline)', minHeight: multiline ? undefined : '48px',
    outline: focused ? '2px solid var(--focus-ring)' : 'none', outlineOffset: '1px',
    opacity: disabled ? 0.4 : 1, resize: multiline ? 'vertical' : undefined,
    transition: 'outline-color var(--duration-fast) var(--ease-standard)'
  };
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', ...style }}>
      {label && (
        <label htmlFor={inputId} style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--body-lg-size)',
          fontWeight: 'var(--body-lg-weight)', letterSpacing: 'var(--body-lg-tracking)', color: 'var(--ink)'
        }}>{label}</label>
      )}
      <Field
        id={inputId} type={multiline ? undefined : type} rows={multiline ? rows : undefined}
        value={value} defaultValue={defaultValue} placeholder={placeholder} disabled={disabled}
        onChange={onChange} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={fieldStyle} {...rest}
      />
      {hint && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)',
          letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', color: 'var(--ink)', opacity: 0.6
        }}>{hint}</span>
      )}
    </div>
  );
}
