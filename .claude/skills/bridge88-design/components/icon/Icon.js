import React from 'react';

const LUCIDE_SRC = 'https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js';

function ensureLucide(cb) {
  if (window.lucide) return cb();
  let s = document.querySelector('script[data-lucide-loader]');
  if (!s) {
    s = document.createElement('script');
    s.src = LUCIDE_SRC; s.setAttribute('data-lucide-loader', '');
    document.head.appendChild(s);
  }
  s.addEventListener('load', cb);
}

export function Icon({ name, size = 20, strokeWidth = 1.75, style, ...rest }) {
  const host = React.useRef(null);
  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const paint = () => {
      if (!host.current || !window.lucide) return;
      const data = window.lucide.icons || {};
      const key = name.replace(/(^|-)([a-z])/g, (m, a, b) => b.toUpperCase());
      const def = data[key] || data[name];
      if (!def) { host.current.innerHTML = ''; return; }
      const svg = window.lucide.createElement(def);
      svg.setAttribute('width', size); svg.setAttribute('height', size);
      svg.setAttribute('stroke-width', strokeWidth);
      host.current.innerHTML = '';
      host.current.appendChild(svg);
    };
    ensureLucide(paint); paint();
  }, [name, size, strokeWidth]);
  return <span ref={host} aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size, flex: '0 0 auto', ...style }} {...rest} />;
}
