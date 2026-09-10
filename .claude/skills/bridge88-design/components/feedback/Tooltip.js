import React from 'react';

export function Tooltip({ content, side = 'top', children, style, ...rest }) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: { bottom: '100%', left: '50%', transform: 'translate(-50%,-8px)' },
    bottom: { top: '100%', left: '50%', transform: 'translate(-50%,8px)' },
    left: { right: '100%', top: '50%', transform: 'translate(-8px,-50%)' },
    right: { left: '100%', top: '50%', transform: 'translate(8px,-50%)' }
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)} onBlur={() => setShow(false)} {...rest}>
      {children}
      {show && (
        <span role="tooltip" style={{
          position: 'absolute', ...pos[side], zIndex: 40, whiteSpace: 'nowrap',
          background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)',
          borderRadius: 'var(--radius-sm)', padding: '6px 10px',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)',
          letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase'
        }}>{content}</span>
      )}
    </span>
  );
}
