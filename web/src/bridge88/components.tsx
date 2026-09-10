'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, VideoHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'promo';
  href?: string;
  fullWidth?: boolean;
};

export function Button({
  children,
  variant = 'primary',
  href,
  fullWidth,
  className = '',
  ...props
}: ButtonProps) {
  const styles = {
    primary: { background: 'var(--primary)', color: 'var(--on-primary)', border: '1px solid var(--primary)' },
    secondary: { background: 'var(--canvas)', color: 'var(--ink)', border: '1px solid var(--hairline)' },
    tertiary: { background: 'transparent', color: 'var(--ink)', border: '1px solid transparent' },
    promo: { background: 'var(--accent-magenta)', color: '#fff', border: '1px solid var(--accent-magenta)' },
  }[variant];
  const cn = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-pill px-4 text-[15px] font-[480] transition-opacity hover:opacity-80 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 ${fullWidth ? 'w-full' : ''} ${className}`;
  if (href) {
    return <Link href={href} className={cn} style={styles}>{children}</Link>;
  }
  // type defaults to "button" so a Button dropped into a form cannot submit it by
  // accident; callers that mean to submit pass type="submit" and win the spread.
  return <button type="button" className={cn} style={styles} {...props}>{children}</button>;
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`b88-icon-button inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-soft transition-opacity hover:opacity-80 active:scale-[.97] ${className ?? ''}`}
      {...props}
    >
      <Icon size={18} strokeWidth={1.75} />
    </button>
  );
}

const tones = {
  neutral: 'var(--surface-soft)', ink: 'var(--primary)', lime: 'var(--block-lime)',
  lilac: 'var(--block-lilac)', cream: 'var(--block-cream)', mint: 'var(--block-mint)',
  coral: 'var(--block-coral)', outline: 'transparent',
};

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  const inverse = tone === 'ink';
  return (
    <span
      className="b88-caption inline-flex items-center rounded-sm px-2.5 py-1"
      style={{
        background: tones[tone],
        color: inverse ? 'var(--on-primary)' : 'var(--ink)',
        border: tone === 'outline' ? '1px solid var(--hairline)' : undefined,
      }}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--block-mint)] font-mono text-[11px]"
      style={{ width: size, height: size }}
      title={name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials}
    </span>
  );
}

// Control classes merge with b88-input rather than letting a caller's className
// replace it, which would strip the field's width, padding, and height.
function inputClass(className?: string) {
  return className ? `b88-input ${className}` : 'b88-input';
}

function selectClass(variant: 'field' | 'pill' | 'filter', className?: string) {
  const base = variant === 'pill' ? 'b88-pill-select' : variant === 'filter' ? 'b88-filter-control' : 'b88-input';
  return className ? `${base} ${className}` : base;
}

export function Field({
  label,
  hint,
  error,
  variant = 'field',
  id,
  className,
  containerClassName,
  'aria-describedby': describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
  variant?: 'field' | 'filter';
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={containerClassName ? `block ${containerClassName}` : 'block'}>
      <label className="b88-label" htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={variant === 'filter' ? selectClass('filter', className) : inputClass(className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error || hint ? messageId : null].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {(error || hint) && (
        <span id={messageId} className="mt-1.5 block text-sm" role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function Select({
  label,
  hint,
  error,
  variant = 'field',
  id,
  className,
  containerClassName,
  children,
  'aria-describedby': describedBy,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
  variant?: 'field' | 'pill' | 'filter';
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={containerClassName ? `block ${containerClassName}` : 'block'}>
      <label className="b88-label" htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        className={selectClass(variant, className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error || hint ? messageId : null].filter(Boolean).join(' ') || undefined}
        {...props}
      >
        {children}
      </select>
      {(error || hint) && (
        <span id={messageId} className="mt-1.5 block text-sm" role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

const HUMAN_MACHINE_VALUES: Record<string, string> = {
  'ai-image-variation': 'AI image variation',
  'ai-video-generate': 'Generated video',
  'ai-audio-tts': 'AI voiceover',
  'ai-image-variation-edit': 'Edited AI image',
  'text-to-video': 'Video from text',
  'text-to-speech': 'Spoken audio',
  'image-variation': 'AI image variation',
  'video-generate': 'Generated video',
  'audio-tts': 'AI voiceover',
};

/**
 * Converts provider tokens and generated filenames into user-facing labels.
 * A sequence can distinguish repeated generated-video fixtures.
 */
export function humanizeMachineValue(value: string, options: { sequence?: number } = {}) {
  const normalized = value.trim().toLowerCase().replaceAll('_', '-');
  if (/^ai-image-\d+\.(png|jpe?g|webp)$/i.test(normalized)) return 'Generated image';
  if (normalized === 'ai-video-generate.webm') {
    return options.sequence ? `Generated video ${options.sequence}` : 'Generated video';
  }
  const withoutExtension = normalized.replace(/\.[a-z0-9]{2,5}$/i, '');
  const mapped = HUMAN_MACHINE_VALUES[withoutExtension];
  if (mapped) return mapped;
  const readable = withoutExtension
    .replace(/\b\d{10,}\b/g, '')
    .replace(/-+/g, ' ')
    .trim();
  if (!readable) return 'Generated asset';
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function TextArea({
  label,
  hint,
  error,
  id,
  className,
  containerClassName,
  'aria-describedby': describedBy,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; containerClassName?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={containerClassName ? `block ${containerClassName}` : 'block'}>
      <label className="b88-label" htmlFor={inputId}>{label}</label>
      <textarea
        id={inputId}
        className={inputClass(className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedBy, error || hint ? messageId : null].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {(error || hint) && (
        <span id={messageId} className="mt-1.5 block text-sm" role={error ? 'alert' : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export function StatusMessage({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'error';
  className?: string;
}) {
  const background =
    tone === 'success'
      ? 'var(--block-mint)'
      : tone === 'error'
        ? 'var(--block-pink)'
        : 'var(--surface-soft)';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`rounded-md p-3 text-sm ${className}`}
      style={{ background }}
    >
      {children}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="b88-card flex items-center gap-3" role="status" aria-live="polite">
      <span className="b88-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Toast({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'error';
}) {
  return (
    <div className="b88-toast" role={tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {tone === 'success' && <span className="text-success" aria-hidden="true">✓</span>}
      {children}
    </div>
  );
}

export function StatCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <section className="b88-card">
      <p className="b88-caption">{label}</p>
      <p className="mt-3 text-[38px] font-[340] leading-none">{value}</p>
      {delta && <p className="b88-caption mt-3 text-success">{delta}</p>}
    </section>
  );
}

export function EmptyState({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dashed border-hairline p-10 text-center">
      <p className="b88-caption">{eyebrow}</p>
      <h2 className="b88-heading mt-3">{title}</h2>
      <div className="mx-auto mt-2 max-w-lg text-[15px]">{children}</div>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

const MEDIA_RATIOS: Record<string, string> = {
  '1:1': '1 / 1',
  '4:5': '4 / 5',
  '9:16': '9 / 16',
  '16:9': '16 / 9',
  '1.91:1': '1.91 / 1',
};
const PLACEHOLDER_TONES: Record<string, string> = {
  mint: 'var(--block-mint)',
  cream: 'var(--block-cream)',
  lime: 'var(--block-lime)',
  lilac: 'var(--block-lilac)',
  coral: 'var(--block-coral)',
  pink: 'var(--block-pink)',
  soft: 'var(--surface-soft)',
};

export function MediaFrame({
  src,
  type = 'image',
  ratio = '4:5',
  alt,
  poster,
  duration,
  label,
  tone = 'soft',
  showAltWarning = false,
  overlay,
  style,
}: {
  src?: string | null;
  type?: 'image' | 'video';
  ratio?: keyof typeof MEDIA_RATIOS | string;
  alt?: string;
  poster?: string;
  duration?: string;
  label?: string;
  tone?: keyof typeof PLACEHOLDER_TONES;
  showAltWarning?: boolean;
  overlay?: ReactNode;
  style?: CSSProperties;
}) {
  const chip: CSSProperties = {
    position: 'absolute',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--caption-size)',
    letterSpacing: 'var(--caption-tracking)',
    textTransform: 'uppercase',
    background: 'var(--canvas-inverse)',
    color: 'var(--ink-inverse)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
  };
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: MEDIA_RATIOS[ratio] ?? ratio,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        background: PLACEHOLDER_TONES[tone] ?? PLACEHOLDER_TONES.soft,
        display: 'grid',
        placeItems: 'center',
        ...style,
      }}
    >
      {src ? (
        type === 'video' ? (
          // Absolute inset keeps the video out of grid track sizing, where its
          // intrinsic 150px height would otherwise win over height: 100%.
          <video
            src={src}
            poster={poster}
            playsInline
            muted
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', minHeight: 0, objectFit: 'contain' }}
          />
        ) : (
          <img src={src} alt={alt || ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        )
      ) : (
        <span className="b88-caption" style={{ opacity: 0.7, textAlign: 'center', padding: 'var(--space-sm)' }}>
          {label || (type === 'video' ? 'Video placeholder' : 'Image placeholder')} · {ratio}
        </span>
      )}
      {duration && <span style={{ ...chip, bottom: 8, right: 8 }}>{duration}</span>}
      {showAltWarning && !alt && <span style={{ ...chip, top: 8, left: 8 }}>Alt missing</span>}
      {overlay}
    </div>
  );
}

export function VideoPlayer({
  src,
  poster,
  ratio = '16:9',
  duration,
  caption,
  tone = 'soft',
  className = '',
  style,
  videoProps,
  unavailableMessage = 'Video unavailable',
  errorMessage = 'This video could not be played.',
}: {
  src?: string | null;
  poster?: string;
  ratio?: keyof typeof MEDIA_RATIOS | string;
  duration?: string;
  caption?: string;
  tone?: keyof typeof PLACEHOLDER_TONES;
  className?: string;
  style?: CSSProperties;
  videoProps?: Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'poster' | 'controls' | 'className' | 'style'> & {
    className?: string;
    style?: CSSProperties;
  };
  unavailableMessage?: string;
  errorMessage?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = Boolean(src && failedSource === src);
  const frameStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: MEDIA_RATIOS[ratio] ?? ratio,
    overflow: 'hidden',
    borderRadius: 'var(--radius-md)',
    background: PLACEHOLDER_TONES[tone] ?? PLACEHOLDER_TONES.soft,
    display: 'grid',
    placeItems: 'center',
  };
  const { onError, onLoadedData, className: videoClassName = '', style: videoStyle, ...nativeVideoProps } = videoProps ?? {};

  return (
    <figure className={`m-0 min-w-0 ${className}`} style={style}>
      <div style={frameStyle}>
        {src && !failed ? (
          <video
            {...nativeVideoProps}
            src={src}
            poster={poster}
            controls
            playsInline={nativeVideoProps.playsInline ?? true}
            preload={nativeVideoProps.preload ?? 'metadata'}
            className={`absolute inset-0 h-full w-full object-contain ${videoClassName}`}
            style={videoStyle}
            onError={(event) => {
              setFailedSource(src);
              onError?.(event);
            }}
            onLoadedData={(event) => {
              setFailedSource(null);
              onLoadedData?.(event);
            }}
          />
        ) : (
          <div
            className="grid max-w-sm gap-1 p-4 text-center"
            role={failed ? 'alert' : 'status'}
          >
            <span className="text-sm font-[480]">{failed ? errorMessage : unavailableMessage}</span>
            <span className="b88-caption">{failed ? 'Check the file or try again.' : 'Add a video source to preview it.'}</span>
          </div>
        )}
        {duration && (
          <span
            className="b88-caption absolute right-2 top-2 rounded-sm bg-[var(--canvas-inverse)] px-2 py-[3px] text-[var(--ink-inverse)]"
          >
            {duration}
          </span>
        )}
      </div>
      {caption && <figcaption className="b88-caption mt-2">{caption}</figcaption>}
    </figure>
  );
}

export function AssetTile({
  title,
  meta,
  type = 'image',
  src,
  tone = 'soft',
  duration,
  selected = false,
  usedIn,
  onClick,
  className = '',
}: {
  title: string;
  meta?: string;
  type?: 'image' | 'video';
  ratio?: string;
  src?: string | null;
  tone?: keyof typeof PLACEHOLDER_TONES;
  duration?: string;
  selected?: boolean;
  usedIn?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 'var(--space-xs)',
        textAlign: 'left',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        padding: 'var(--space-xs)',
        borderRadius: 'var(--radius-md)',
        background: selected ? 'var(--surface-soft)' : 'transparent',
        outline: selected ? '1px solid var(--ink)' : '1px solid transparent',
        border: 'none',
      }}
    >
      <MediaFrame
        type={type}
        ratio="1:1"
        src={src}
        tone={tone}
        duration={duration}
        label={title}
        style={{ width: '100%', minWidth: 0 }}
        overlay={
          <span style={{ position: 'absolute', top: 8, left: 8 }}>
            <Badge tone={type === 'video' ? 'ink' : 'neutral'}>{type}</Badge>
          </span>
        }
      />
      <span
        style={{
          fontSize: 'var(--body-sm-size)',
          fontWeight: 480,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {meta && <span className="b88-caption">{meta}</span>}
      {usedIn && <span className="b88-caption">Used in {usedIn}</span>}
    </button>
  );
}

export function MediaUploader({
  accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav',
  hint,
  name = 'files',
  compact = false,
  multiple = true,
  title = 'Drop media here',
  required = false,
}: {
  accept?: string;
  hint?: string;
  name?: string;
  compact?: boolean;
  multiple?: boolean;
  title?: string;
  required?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className="b88-uploader"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
      style={{
        border: `1px dashed ${over ? 'var(--ink)' : 'var(--hairline)'}`,
        background: over ? 'var(--surface-soft)' : 'transparent',
        borderRadius: 'var(--radius-lg)',
        padding: compact ? 'var(--space-lg)' : 'var(--space-xxl)',
        display: 'grid',
        gap: 'var(--space-sm)',
        justifyItems: 'center',
        textAlign: 'center',
        cursor: 'pointer',
      }}
    >
      <input name={name} type="file" multiple={multiple} accept={accept} required={required} className="sr-only" />
      <span style={{ fontSize: 'var(--body-sm-size)', fontWeight: 480 }}>{title}</span>
      <span className="b88-caption">{hint || 'Images, video and audio'}</span>
    </label>
  );
}

export function SegmentedTabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  const active = value ?? items[0];
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const moveFocus = (index: number) => {
    if (!items.length) return;
    tabsRef.current[(index + items.length) % items.length]?.focus();
  };
  return (
    <div role="tablist" className="flex flex-wrap gap-1">
      {items.map((item, index) => (
        <button
          key={item}
          ref={(node) => { tabsRef.current[index] = node; }}
          type="button"
          role="tab"
          aria-selected={item === active}
          tabIndex={item === active ? 0 : -1}
          onClick={() => onChange?.(item)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              const next = (index + 1) % items.length;
              onChange?.(items[next]);
              moveFocus(next);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              const next = (index - 1 + items.length) % items.length;
              onChange?.(items[next]);
              moveFocus(next);
            } else if (event.key === 'Home') {
              event.preventDefault();
              onChange?.(items[0]);
              moveFocus(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              const last = items.length - 1;
              onChange?.(items[last]);
              moveFocus(last);
            }
          }}
          className="rounded-pill px-4 py-2 text-[15px] font-[480]"
          style={{
            background: item === active ? 'var(--primary)' : 'transparent',
            color: item === active ? 'var(--on-primary)' : 'var(--ink)',
            minHeight: 40,
          }}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function Dialog({
  open = false,
  title,
  eyebrow,
  children,
  actions,
  onClose,
  width = 520,
}: {
  open?: boolean;
  title?: string;
  eyebrow?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  width?: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!controls.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-modal)',
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-lg)',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : eyebrow ?? 'Dialog'}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          background: 'var(--canvas)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-lg)',
          boxShadow: 'var(--elevation-3)',
          display: 'grid',
          gap: 'var(--space-md)',
        }}
      >
        {eyebrow && <p className="b88-caption">{eyebrow}</p>}
        {title && <h2 id={titleId} className="b88-heading">{title}</h2>}
        {children}
        {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// Chrome paints a native checkbox at 13x13 and gives a text-sized label a 20-40px
// box, both under the 44px --touch-min. Geometry therefore lives in inline style
// and is written after the caller's props and style, so neither a className nor a
// style prop can shrink the glyph or the hit area; everything else (checked,
// defaultChecked, name, value, onChange, required, aria-*) comes through the
// spread untouched. type stays "checkbox" because the 20px box and the label
// association are this component's contract, not a caller default.
export function Checkbox({
  label,
  description,
  id,
  className,
  containerClassName,
  style,
  disabled,
  'aria-describedby': describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string; containerClassName?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const describedByIds = [describedBy, description ? descriptionId : null].filter(Boolean).join(' ');
  return (
    <label
      htmlFor={inputId}
      className={containerClassName ? `flex gap-3 ${containerClassName}` : 'flex gap-3'}
      style={{
        minHeight: 'var(--touch-min)',
        // A single-line row centres in the 44px target; with a description the
        // 20px glyph aligns to the 20px first line instead of floating mid-block.
        alignItems: description ? 'flex-start' : 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : undefined,
      }}
    >
      <input
        {...props}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={describedByIds || undefined}
        className={`b88-checkbox ${className ?? ''}`}
        style={{
          ...style,
          width: 'var(--space-20)',
          height: 'var(--space-20)',
          // The label is a flex container, so without this the glyph is the item
          // that gets compressed when the text runs out of room.
          flex: '0 0 auto',
          margin: 0,
        }}
      />
      <span>
        <span className="block text-sm font-[480] leading-5">{label}</span>
        {description && <span id={descriptionId} className="b88-caption mt-1 block">{description}</span>}
      </span>
    </label>
  );
}

export function PricingCard({
  tier,
  price,
  cadence,
  blurb,
  features = [],
  cta,
  highlighted = false,
}: {
  tier: string;
  price?: string;
  cadence?: string;
  blurb?: string;
  features?: string[];
  cta?: ReactNode;
  highlighted?: boolean;
}) {
  return (
    <article
      className="b88-card flex flex-col gap-4"
      style={{ border: highlighted ? '1px solid var(--ink)' : undefined }}
    >
      <h2 className="b88-heading">{tier}</h2>
      {price && (
        <p>
          <span className="text-4xl font-[340]">{price}</span>
          {cadence && <span className="b88-caption ml-2">{cadence}</span>}
        </p>
      )}
      {blurb && <p>{blurb}</p>}
      {!!features.length && (
        <ul className="space-y-2 text-sm">
          {features.map((feature) => (
            <li key={feature}>✓ {feature}</li>
          ))}
        </ul>
      )}
      {cta && <div className="mt-auto pt-2">{cta}</div>}
    </article>
  );
}
