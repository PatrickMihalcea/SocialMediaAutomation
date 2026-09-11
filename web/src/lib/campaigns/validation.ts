import { invalid } from '@/lib/errors';

export const CAMPAIGN_COLORS = ['lime', 'lilac', 'cream', 'mint', 'coral'] as const;
export const CAMPAIGN_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignColor = (typeof CAMPAIGN_COLORS)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  PLANNED: 'Draft',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export const CAMPAIGN_COLOR_LABELS: Record<CampaignColor, string> = {
  lime: 'Lime',
  lilac: 'Lilac',
  cream: 'Cream',
  mint: 'Mint',
  coral: 'Coral',
};

export function parseCampaignDate(value: FormDataEntryValue | null) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw invalid('Enter a valid campaign date.');
  return date;
}

export function validateCampaignDates(startDate: Date | null, endDate: Date | null) {
  if (startDate && endDate && endDate < startDate) {
    throw invalid('End date must be on or after the start date.');
  }
}

export function campaignStatus(value: FormDataEntryValue | null): CampaignStatus {
  const status = String(value || 'PLANNED');
  if (!CAMPAIGN_STATUSES.includes(status as CampaignStatus)) {
    throw invalid('Choose a valid campaign status.');
  }
  return status as CampaignStatus;
}

export function campaignColor(value: FormDataEntryValue | null) {
  const color = String(value || 'lime');
  if (!CAMPAIGN_COLORS.includes(color as (typeof CAMPAIGN_COLORS)[number])) {
    throw invalid('Choose a valid campaign color.');
  }
  return color;
}
