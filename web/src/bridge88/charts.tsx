import type { ReactNode } from 'react';

/**
 * Bridge88 data visualisation: chart cards, coloured metric tiles and plain
 * SVG charts, rendered without a charting library.
 *
 * Colour comes from the pastel block tokens and every mark is outlined in
 * --ink, so charts read in both themes: in dark mode the blocks deepen and
 * the outline turns white. Every value a chart labels is one it draws.
 * Props take a colour as any CSS value; pass a block token such as
 * 'var(--block-lilac)'.
 */

/** The pastel grounds charts and tiles cycle through, in order. */
export const CHART_COLOURS = [
  'var(--block-lilac)',
  'var(--block-mint)',
  'var(--block-coral)',
  'var(--block-lime)',
  'var(--block-pink)',
  'var(--block-cream)',
] as const;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
/** 1.2K, 3.4M: for axis ticks and tight labels. */
export const short = (value: number) => compact.format(value);

/** A rounded-up axis maximum with readable ticks: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= value) ?? 10;
  return step * power;
}

/** A stroked card holding one chart: mono eyebrow, title, optional aside. */
export function ChartCard({
  eyebrow,
  title,
  aside,
  children,
  className = '',
}: {
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`b88-card min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="b88-caption">{eyebrow}</p>
          <h2 className="b88-heading mt-2">{title}</h2>
        </div>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * One headline number on a pastel ground. Null renders "Not reported" at body
 * size, because a missing metric is never shown as zero.
 */
export function MetricTile({
  label,
  value,
  detail,
  colour,
}: {
  label: string;
  value: number | string | null;
  detail?: string;
  colour: string;
}) {
  const missing = value === null;
  return (
    <section className="min-w-0 rounded-lg p-5" style={{ background: colour }}>
      <p className="b88-caption">{label}</p>
      <p className={missing ? 'mt-4 text-[15px] font-[330]' : 'mt-3 text-[34px] font-[340] leading-none tabular-nums'}>
        {missing ? 'Not reported' : typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {detail && <p className="b88-caption mt-3">{detail}</p>}
    </section>
  );
}

/** Daily values as an outlined area, with the first and last day labelled. */
export function TrendChart({
  points,
  colour,
  label,
}: {
  points: { label: string; value: number }[];
  colour: string;
  label: string;
}) {
  const width = 640;
  const height = 200;
  const left = 44;
  const bottom = 24;
  const top = 8;
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  // Followers move by a sliver of their total, so the axis starts near the
  // lowest value rather than at zero, or the line would be flat.
  const floor = Math.max(0, low - (high - low || high * 0.05 || 1) * 0.25);
  const ceiling = high + (high - floor) * 0.1 || 1;
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - 8);
  const y = (value: number) => top + (1 - (value - floor) / (ceiling - floor)) * (height - top - bottom);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${height - bottom} ${line} ${x(points.length - 1).toFixed(1)},${height - bottom}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${label} from ${short(points[0].value)} to ${short(points.at(-1)!.value)}`}>
      {[floor, (floor + ceiling) / 2, ceiling].map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width - 8} y1={y(tick)} y2={y(tick)} stroke="var(--hairline)" />
          <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--ink)" className="font-mono">{short(tick)}</text>
        </g>
      ))}
      <polygon points={area} fill={colour} />
      <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points.at(-1)!.value)} r="4" fill="var(--ink)" />
      <text x={left} y={height - 6} fontSize="11" fill="var(--ink)" className="font-mono">{points[0].label}</text>
      <text x={width - 8} y={height - 6} fontSize="11" textAnchor="end" fill="var(--ink)" className="font-mono">{points.at(-1)!.label}</text>
    </svg>
  );
}

/** Vertical bars on a zero baseline, labelled under every few bars. */
export function BarChart({
  bars,
  colour,
  label,
  every = 1,
}: {
  bars: { label: string; value: number }[];
  colour: string;
  label: string;
  every?: number;
}) {
  const width = 640;
  const height = 200;
  const left = 44;
  const bottom = 24;
  const top = 8;
  const max = niceMax(Math.max(...bars.map((bar) => bar.value), 0));
  const slot = (width - left - 8) / bars.length;
  const barWidth = Math.max(2, slot * 0.68);
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={label}>
      {[0, max / 2, max].map((tick) => (
        <g key={tick}>
          <line x1={left} x2={width - 8} y1={y(tick)} y2={y(tick)} stroke="var(--hairline)" />
          <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--ink)" className="font-mono">{short(tick)}</text>
        </g>
      ))}
      {bars.map((bar, index) => {
        const barX = left + index * slot + (slot - barWidth) / 2;
        const barHeight = y(0) - y(bar.value);
        return (
          <g key={`${bar.label}-${index}`}>
            {bar.value > 0 && (
              <rect x={barX} y={y(bar.value)} width={barWidth} height={barHeight} rx={Math.min(4, barWidth / 2)} fill={colour} stroke="var(--ink)" strokeWidth="1">
                <title>{`${bar.label}: ${bar.value.toLocaleString()}`}</title>
              </rect>
            )}
            {index % every === 0 && (
              <text x={barX + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--ink)" className="font-mono">{bar.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Share of a whole, as a ring with a legend that carries the numbers. */
export function DonutChart({
  slices,
  centre,
  caption,
}: {
  slices: { label: string; value: number; colour: string }[];
  centre: string;
  caption: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
      <svg viewBox="0 0 180 180" className="mx-auto h-44 w-44" role="img" aria-label={`${caption}: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(', ')}`}>
        <circle cx="90" cy="90" r={radius} fill="none" stroke="var(--surface-soft)" strokeWidth="28" />
        {total > 0 && slices.map((slice) => {
          const length = (slice.value / total) * circumference;
          const dash = (
            <circle
              key={slice.label}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={slice.colour}
              strokeWidth="28"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            />
          );
          offset += length;
          return dash;
        })}
        <circle cx="90" cy="90" r={radius + 14} fill="none" stroke="var(--ink)" strokeWidth="1" />
        <circle cx="90" cy="90" r={radius - 14} fill="none" stroke="var(--ink)" strokeWidth="1" />
        <text x="90" y="90" textAnchor="middle" fontSize="26" fontWeight="340" fill="var(--ink)">{centre}</text>
        <text x="90" y="110" textAnchor="middle" fontSize="10" fill="var(--ink)" className="font-mono uppercase">{caption}</text>
      </svg>
      <ul className="grid gap-2">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-3">
            <span className="h-4 w-4 shrink-0 rounded-[4px] border border-[var(--ink)]" style={{ background: slice.colour }} aria-hidden />
            <span className="min-w-0 flex-1">{slice.label}</span>
            <span className="font-[480] tabular-nums">{slice.value.toLocaleString()}</span>
            <span className="b88-caption w-12 text-right tabular-nums">{total ? `${Math.round((slice.value / total) * 100)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Labelled horizontal bars, each scaled against the largest. */
export function RankBars({
  rows,
}: {
  rows: { key: string; label: string; value: number; detail?: string; colour: string }[];
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="grid gap-4">
      {rows.map((row) => (
        <li key={row.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-[480]">{row.label}</span>
            <span className="tabular-nums">{row.value.toLocaleString()}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface-soft">
            <div className="h-full rounded-full border border-[var(--ink)]" style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: row.colour }} />
          </div>
          {row.detail && <span className="b88-caption">{row.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
