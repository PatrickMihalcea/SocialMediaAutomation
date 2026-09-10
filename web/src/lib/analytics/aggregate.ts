export type NullableMetric = number | null;

/** Sum reported values only. Null means no source reported the metric. */
export function sumReported(values: NullableMetric[]): NullableMetric {
  const reported = values.filter((value): value is number => value !== null);
  return reported.length ? reported.reduce((sum, value) => sum + value, 0) : null;
}

export function formatMetric(value: NullableMetric): string {
  return value === null ? 'Not reported' : value.toLocaleString();
}
