import React from 'react';

export function MarqueeStrip({ items = [], speed, style, ...rest }) {
  const loop = [...items, ...items];
  const stripStyle = {
    background: 'var(--canvas-inverse)', color: 'var(--ink-inverse)',
    height: 'var(--marquee-height)', display: 'flex', alignItems: 'center',
    overflow: 'hidden', ...style
  };
  const trackStyle = {
    display: 'flex', gap: 'var(--space-xxl)', whiteSpace: 'nowrap',
    animation: `b88-marquee ${speed || 'var(--marquee-duration)'} linear infinite`
  };
  return (
    <div style={stripStyle} {...rest}>
      <style>{'@keyframes b88-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
      <div style={trackStyle}>
        {loop.map((item, i) => (
          <span key={i} style={{
            fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)',
            letterSpacing: 'var(--body-sm-tracking)'
          }}>{item}</span>
        ))}
      </div>
    </div>
  );
}
