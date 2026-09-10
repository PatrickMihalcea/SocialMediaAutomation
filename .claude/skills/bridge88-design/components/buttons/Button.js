import React from 'react';

const B88_BUTTON_BASE = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--button-size)',
  fontWeight: 'var(--button-weight)',
  lineHeight: 'var(--button-leading)',
  letterSpacing: 'var(--button-tracking)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-xs)',
  border: 'none',
  borderRadius: 'var(--radius-pill)',
  minHeight: 'var(--touch-min)',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  transition: 'transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard)'
};

const B88_BUTTON_VARIANTS = {
  primary: { background: 'var(--primary)', color: 'var(--on-primary)', padding: '10px 20px' },
  secondary: { background: 'var(--canvas)', color: 'var(--ink)', padding: '8px 18px 10px' },
  tertiary: {
    background: 'transparent', color: 'var(--ink)', padding: 'var(--space-xs) var(--space-sm)',
    borderRadius: 'var(--radius-full)', fontWeight: 'var(--link-weight)'
  },
  promo: { background: 'var(--accent-magenta)', color: '#ffffff', padding: '10px 18px' }
};

const B88_BUTTON_SIZES = {
  md: {},
  sm: { fontSize: 'var(--body-sm-size)', padding: '8px 16px', minHeight: '36px' }
};

export function Button({
  variant = 'primary', size = 'md', children, disabled = false,
  href, onClick, iconLeft, iconRight, fullWidth = false, style, ...rest
}) {
  const [pressed, setPressed] = React.useState(false);
  const Tag = href ? 'a' : 'button';
  const composed = {
    ...B88_BUTTON_BASE,
    ...(B88_BUTTON_VARIANTS[variant] || B88_BUTTON_VARIANTS.primary),
    ...(B88_BUTTON_SIZES[size] || null),
    ...(fullWidth ? { width: '100%' } : null),
    ...(disabled ? { opacity: 0.35, cursor: 'not-allowed' } : null),
    ...(pressed && !disabled ? { transform: 'scale(var(--press-scale))' } : null),
    ...style
  };
  return (
    <Tag
      href={href}
      onClick={disabled ? undefined : onClick}
      disabled={Tag === 'button' ? disabled : undefined}
      style={composed}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      {...rest}
    >
      {iconLeft}{children}{iconRight}
    </Tag>
  );
}
