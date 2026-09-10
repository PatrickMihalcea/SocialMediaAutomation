import React from 'react';

export function Footer({ brand = 'Bridge88', columns = [], note, style, ...rest }) {
  const footerStyle = {
    background: 'var(--canvas)', color: 'var(--ink)',
    padding: 'var(--space-section) var(--space-xl)',
    display: 'grid', gap: 'var(--space-xl)', ...style
  };
  return (
    <footer style={footerStyle} {...rest}>
      <span style={{ fontSize: 'var(--display-lg-size)', fontWeight: 'var(--display-lg-weight)', letterSpacing: 'var(--display-lg-tracking)', lineHeight: 1 }}>{brand}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 'var(--space-xl)' }}>
        {columns.map((col) => (
          <div key={col.heading} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', borderTop: '1px solid var(--hairline-soft)', paddingTop: 'var(--space-md)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase' }}>{col.heading}</span>
            {col.links.map((l) => (
              <a key={l} href="#" style={{ fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)', color: 'var(--ink)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        ))}
      </div>
      {note && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--caption-size)', letterSpacing: 'var(--caption-tracking)', textTransform: 'uppercase', opacity: 0.6 }}>{note}</span>}
    </footer>
  );
}
