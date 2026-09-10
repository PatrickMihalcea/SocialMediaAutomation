import React from 'react';

export function Toast({ children, tone = 'neutral', action, onDismiss, style, ...rest }) {
  const tones = {
    neutral: { background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)' },
    success: { background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)' }
  };
  return (
    <div role="status" style={{
      ...(tones[tone] || tones.neutral), borderRadius: 'var(--radius-pill)',
      padding: '12px 12px 12px 20px', display: 'inline-flex', alignItems: 'center',
      gap: 'var(--space-md)', boxShadow: 'var(--elevation-2)',
      fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', ...style
    }} {...rest}>
      {tone === 'success' && <span aria-hidden="true" style={{ color: 'var(--success)' }}>✓</span>}
      <span>{children}</span>
      {action}
      {onDismiss && (
        <button aria-label="Dismiss" onClick={onDismiss} style={{
          background: 'var(--icon-button-inverse-fill)', border: 'none', color: 'inherit',
          width: 28, height: 28, borderRadius: 'var(--radius-full)', cursor: 'pointer', lineHeight: 1
        }}>×</button>
      )}
    </div>
  );
}
