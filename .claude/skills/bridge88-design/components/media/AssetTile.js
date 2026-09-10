import React from 'react';
import { MediaFrame } from './MediaFrame.js';
import { Badge } from '../core/Badge.js';

export function AssetTile({ title, meta, type = 'image', ratio = '1:1', src, tone = 'soft', duration, selected = false, usedIn, onClick, style, ...rest }) {
  return (
    <div onClick={onClick} style={{
      display: 'grid', gap: 'var(--space-xs)', cursor: onClick ? 'pointer' : 'default',
      padding: 'var(--space-xs)', borderRadius: 'var(--radius-md)',
      background: selected ? 'var(--surface-soft)' : 'transparent',
      outline: selected ? '1px solid var(--ink)' : '1px solid transparent', ...style
    }} {...rest}>
      <MediaFrame type={type} ratio={ratio} src={src} tone={tone} duration={duration} label={title}
        overlay={<span style={{ position: 'absolute', top: 8, left: 8 }}><Badge tone={type === 'video' ? 'ink' : 'neutral'}>{type}</Badge></span>} />
      <div style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--weight-medium)', lineHeight: 1.3 }}>{title}</span>
        {meta && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{meta}</span>}
        {usedIn && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>Used in {usedIn}</span>}
      </div>
    </div>
  );
}
