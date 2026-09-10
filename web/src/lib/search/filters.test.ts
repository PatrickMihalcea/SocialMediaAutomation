import { describe, expect, it } from 'vitest';
import { hasSearchCriteria, parseSearchFilters } from './filters';

describe('parseSearchFilters', () => {
  it('trims terms and rejects unknown enum values', () => {
    const filters = parseSearchFilters({ q: '  launch  ', status: 'BROKEN', platform: 'MYSPACE' });
    expect(filters.q).toBe('launch');
    expect(filters.status).toBeUndefined();
    expect(filters.platform).toBeUndefined();
  });

  it('reports an inverted date range', () => {
    const filters = parseSearchFilters({ from: '2026-09-10', to: '2026-09-01' });
    expect(filters.error).toBe('The start date must be before the end date.');
  });

  it('treats filters without a term as search criteria', () => {
    expect(hasSearchCriteria(parseSearchFilters({ status: 'DRAFT' }))).toBe(true);
    expect(hasSearchCriteria(parseSearchFilters({}))).toBe(false);
  });
});
