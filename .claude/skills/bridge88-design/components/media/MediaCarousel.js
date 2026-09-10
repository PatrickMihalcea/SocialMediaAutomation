import React from 'react';
import { IconButton } from '../buttons/IconButton.js';
import { Icon } from '../icon/Icon.js';
import { MediaFrame } from './MediaFrame.js';

export function MediaCarousel({ items = [], ratio = '1:1', showCounter = true, style, ...rest }) {
  const [index, setIndex] = React.useState(0);
  const count = items.length || 1;
  const go = (d) => setIndex((i) => (i + d + count) % count);
  const item = items[index] || {};
  return (
    <div style={{ display: 'grid', gap: 'var(--space-sm)', ...style }} {...rest}>
      <div style={{ position: 'relative' }}>
        <MediaFrame {...item} ratio={item.ratio || ratio} />
        {count > 1 && (
          <>
            <div style={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)' }}>
              <IconButton tone="inverse" label="Previous asset" onClick={() => go(-1)} style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><Icon name="arrow-left" size={18} /></IconButton>
            </div>
            <div style={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)' }}>
              <IconButton tone="inverse" label="Next asset" onClick={() => go(1)} style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}><Icon name="arrow-right" size={18} /></IconButton>
            </div>
            {showCounter && (
              <span style={{
                position: 'absolute', top: 8, right: 8, fontFamily: 'var(--font-mono)',
                fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)',
                background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)',
                borderRadius: 'var(--radius-sm)', padding: '3px 8px'
              }}>{index + 1} / {count}</span>
            )}
          </>
        )}
      </div>
      {count > 1 && (
        <div style={{ display: 'flex', gap: 'var(--space-xxs)', justifyContent: 'center' }}>
          {items.map((_, i) => (
            <button key={i} aria-label={'Asset ' + (i + 1)} onClick={() => setIndex(i)} style={{
              width: i === index ? 18 : 6, height: 6, borderRadius: 'var(--radius-full)', border: 'none',
              background: i === index ? 'var(--ink)' : 'var(--hairline)', cursor: 'pointer', padding: 0,
              transition: 'width var(--duration-fast) var(--ease-standard)'
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
