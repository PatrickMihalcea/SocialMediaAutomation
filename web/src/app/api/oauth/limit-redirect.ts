import { toAppError } from '@/lib/errors';

export function billingLimitRedirect(
  error: unknown,
  requestUrl: string,
  workspaceSlug: string,
): URL | null {
  const appError = toAppError(error);
  if (appError.code !== 'LIMIT_REACHED') return null;

  const destination = new URL(`/w/${workspaceSlug}/settings/billing`, requestUrl);
  destination.searchParams.set('billing', 'limit-reached');
  destination.searchParams.set('reason', appError.message);
  return destination;
}
