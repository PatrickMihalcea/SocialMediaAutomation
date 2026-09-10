import React from 'react';

export function IconButton({ tone = 'light', size = 40, children, label, onClick, style, ...rest }) {
  const [pressed, setPressed] = React.useState(false);
  const iconButtonStyle = {
    width: size, height: size, minWidth: size,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer', padding: 0,
    background: tone === 'inverse' ? 'var(--icon-button-inverse-fill)' : 'var(--surface-soft)',
    color: tone === 'inverse' ? 'var(--on-primary)' : 'var(--ink)',
    transition: 'transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard)',
    ...(pressed ? { transform: 'scale(var(--press-scale))' } : null),
    ...style
  };
  return (
    <button
      aria-label={label} onClick={onClick} style={iconButtonStyle}
      onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)}
      {...rest}
    >{children}</button>
  );
}
