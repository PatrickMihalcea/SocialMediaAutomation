import type { CSSProperties, ReactNode } from 'react';

/** Grey gradient sweep used in place of content that has not arrived yet. */
export function Shimmer({
  className = '',
  style,
  radius,
}: {
  className?: string;
  style?: CSSProperties;
  radius?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`b88-shimmer ${className}`}
      style={radius ? { ...style, borderRadius: radius } : style}
    />
  );
}

export function PagePreview({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );
}
