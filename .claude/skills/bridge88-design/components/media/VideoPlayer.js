import React from 'react';
import { IconButton } from '../buttons/IconButton.js';
import { Icon } from '../icon/Icon.js';

const B88_RATIOS = { '1:1': '1 / 1', '4:5': '4 / 5', '9:16': '9 / 16', '16:9': '16 / 9', '1.91:1': '1.91 / 1' };

export function VideoPlayer({ src, poster, ratio = '16:9', duration = '0:32', caption, tone = 'cream', style, ...rest }) {
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0.28);
  const ref = React.useRef(null);
  const toggle = () => {
    const el = ref.current;
    setPlaying((p) => !p);
    if (el) { if (el.paused) el.play().catch(() => {}); else el.pause(); }
  };
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 'var(--space-sm)', ...style }} {...rest}>
      <div style={{
        position: 'relative', width: '100%', aspectRatio: B88_RATIOS[ratio] || ratio,
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
        background: src ? 'var(--canvas-inverse)' : 'var(--block-' + (tone === 'soft' ? 'cream' : tone) + ')',
        display: 'grid', placeItems: 'center'
      }}>
        {src && <video ref={ref} src={src} poster={poster} playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        {!src && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.7 }}>Video placeholder · {ratio}</span>}
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <IconButton tone="inverse" size={56} label={playing ? 'Pause' : 'Play'} onClick={toggle}
            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </IconButton>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <div onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setProgress(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
          }} style={{ flex: 1, height: 4, borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
            <div style={{ width: (progress * 100) + '%', height: '100%', borderRadius: 'var(--radius-full)', background: '#fff' }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', color: '#fff' }}>{duration}</span>
        </div>
      </div>
      {caption && <figcaption style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{caption}</figcaption>}
    </figure>
  );
}
