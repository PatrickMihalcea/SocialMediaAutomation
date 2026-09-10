import React from 'react';
import { Button } from '../buttons/Button.js';
import { Icon } from '../icon/Icon.js';

export function MediaUploader({ accept = 'Images and video', hint, onFiles, compact = false, style, ...rest }) {
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef(null);
  const handle = (list) => { if (onFiles && list) onFiles(Array.from(list)); };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      onClick={() => inputRef.current && inputRef.current.click()}
      style={{
        border: '1px dashed ' + (over ? 'var(--ink)' : 'var(--hairline)'),
        background: over ? 'var(--surface-soft)' : 'transparent',
        borderRadius: 'var(--radius-lg)', padding: compact ? 'var(--space-lg)' : 'var(--space-xxl)',
        display: 'grid', gap: 'var(--space-sm)', justifyItems: 'center', textAlign: 'center', cursor: 'pointer',
        transition: 'background var(--duration-fast) var(--ease-standard)', ...style
      }} {...rest}>
      <input ref={inputRef} type="file" multiple accept="image/*,video/*" onChange={(e) => handle(e.target.files)} style={{ display: 'none' }} />
      <Icon name="image-plus" size={compact ? 22 : 28} />
      <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--weight-medium)' }}>Drop media here</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{hint || accept}</span>
      {!compact && <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); inputRef.current && inputRef.current.click(); }}>Browse files</Button>}
    </div>
  );
}
