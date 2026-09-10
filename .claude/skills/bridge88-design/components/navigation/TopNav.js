import React from 'react';

export function TopNav({ brand = 'Bridge88', links = [], actions, signInLabel = 'Log in', onSignIn, sticky = true, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const navStyle = {
    background: 'var(--canvas)', color: 'var(--ink)', height: 'var(--nav-height)',
    display: 'flex', alignItems: 'center', gap: 'var(--space-lg)',
    padding: '0 var(--space-xl)', position: sticky ? 'sticky' : 'static', top: 0, zIndex: 20,
    borderBottom: '1px solid var(--hairline-soft)', ...style
  };
  const linkStyle = {
    fontSize: 'var(--body-sm-size)', fontWeight: 'var(--body-sm-weight)',
    letterSpacing: 'var(--body-sm-tracking)', color: 'var(--ink)', textDecoration: 'none',
    padding: 'var(--space-xs) var(--space-sm)', borderRadius: 'var(--radius-full)'
  };
  return (
    <header style={navStyle} {...rest}>
      <a href="#" style={{
        fontSize: '22px', fontWeight: 'var(--weight-semi)', letterSpacing: '-0.5px',
        color: 'var(--ink)', textDecoration: 'none', marginRight: 'var(--space-md)'
      }}>{brand}</a>
      <nav style={{ display: 'flex', gap: 'var(--space-xxs)', flexWrap: 'wrap' }}>
        {links.map((l) => (
          <a key={l.label} href={l.href || '#'} style={linkStyle}
            onClick={(e) => { if (l.onClick) { e.preventDefault(); l.onClick(); } }}>{l.label}</a>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onSignIn && onSignIn(); }} style={linkStyle}>{signInLabel}</a>
        {actions}
        <button aria-label="Menu" onClick={() => setOpen(!open)} style={{
          display: 'none', background: 'none', border: 'none', cursor: 'pointer'
        }}>≡</button>
      </div>
    </header>
  );
}
