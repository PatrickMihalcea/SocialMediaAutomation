import React from 'react';

export function Dialog({ open = false, title, eyebrow, children, actions, onClose, width = 520, style, ...rest }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'var(--scrim-modal)', zIndex: 100,
      display: 'grid', placeItems: 'center', padding: 'var(--space-lg)'
    }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: width, background: 'var(--canvas)', color: 'var(--ink)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', boxShadow: 'var(--elevation-3)',
        display: 'grid', gap: 'var(--space-md)', ...style
      }} {...rest}>
        {eyebrow && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{eyebrow}</span>}
        {title && <h2 style={{ fontSize: 'var(--card-title-size)', fontWeight: 'var(--card-title-weight)', lineHeight: 'var(--card-title-leading)' }}>{title}</h2>}
        {children && <div style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', lineHeight: 'var(--body-sm-leading)', display: 'grid', gap: 'var(--space-md)' }}>{children}</div>}
        {actions && <div style={{ display: 'flex', gap: 'var(--space-xs)', justifyContent: 'flex-end', flexWrap: 'wrap', paddingTop: 'var(--space-xs)' }}>{actions}</div>}
      </div>
    </div>
  );
}
