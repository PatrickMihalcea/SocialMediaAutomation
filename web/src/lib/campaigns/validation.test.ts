import { describe, expect, it } from 'vitest';
import {
  campaignColor,
  campaignStatus,
  parseCampaignDate,
  validateCampaignDates,
} from './validation';

describe('campaign validation', () => {
  it('rejects a campaign that ends before it starts', () => {
    expect(() => validateCampaignDates(new Date('2026-09-12'), new Date('2026-09-11')))
      .toThrow('End date must be on or after the start date.');
  });

  it('accepts equal and open-ended date ranges', () => {
    expect(() => validateCampaignDates(new Date('2026-09-12'), new Date('2026-09-12'))).not.toThrow();
    expect(() => validateCampaignDates(null, new Date('2026-09-12'))).not.toThrow();
  });

  it('rejects invalid dates, colors, and statuses', () => {
    expect(() => parseCampaignDate('not-a-date')).toThrow('Enter a valid campaign date.');
    expect(() => campaignColor('chartreuse')).toThrow('Choose a valid campaign color.');
    expect(() => campaignStatus('DELETED')).toThrow('Choose a valid campaign status.');
  });
});
