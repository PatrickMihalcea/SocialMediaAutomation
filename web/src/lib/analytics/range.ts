export type AnalyticsPreset = 'today' | '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsRange {
  from: Date;
  to: Date;
  preset: AnalyticsPreset;
  error?: string;
}

const PRESETS = new Set<AnalyticsPreset>(['today', '7d', '30d', '90d', 'custom']);

export function resolveAnalyticsRange(
  input: { range?: string; from?: string; to?: string },
  now = new Date(),
): AnalyticsRange {
  const preset = PRESETS.has(input.range as AnalyticsPreset) ? input.range as AnalyticsPreset : '30d';
  const to = endOfUtcDay(now);

  if (preset === 'custom') {
    const from = parseDate(input.from);
    const customTo = parseDate(input.to, true);
    if (!from || !customTo) {
      return { preset, from: startOfUtcDay(now), to, error: 'Choose both a start and end date.' };
    }
    if (from > customTo) {
      return { preset, from, to: customTo, error: 'The start date must be before the end date.' };
    }
    return { preset, from, to: customTo };
  }

  const days = preset === 'today' ? 1 : Number.parseInt(preset, 10);
  const from = startOfUtcDay(now);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { preset, from, to };
}

export function previousRange(range: Pick<AnalyticsRange, 'from' | 'to'>) {
  const duration = range.to.getTime() - range.from.getTime() + 1;
  return {
    from: new Date(range.from.getTime() - duration),
    to: new Date(range.from.getTime() - 1),
  };
}

export function percentageChange(current: number | null, previous: number | null): string | undefined {
  if (current === null || previous === null || previous === 0) return undefined;
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
}

function parseDate(value?: string, end = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function endOfUtcDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
}
