import { describe, expect, it } from 'vitest';
import { limitReached } from '@/lib/errors';
import { billingLimitRedirect } from './limit-redirect';

describe('OAuth limit redirects', () => {
  it('preserves the centralized limit reason on the Billing redirect', () => {
    const message = 'You are using 3 of 3 connected social accounts on the Free plan. This capacity does not reset automatically. Disconnect an account or change plans in Billing.';
    const destination = billingLimitRedirect(
      limitReached(message),
      'http://localhost:3000/api/oauth/linkedin/callback',
      'northwind-studio',
    );

    expect(destination?.pathname).toBe('/w/northwind-studio/settings/billing');
    expect(destination?.searchParams.get('billing')).toBe('limit-reached');
    expect(destination?.searchParams.get('reason')).toBe(message);
  });

  it('leaves non-limit failures on the normal OAuth error path', () => {
    expect(
      billingLimitRedirect(
        new Error('Provider failed'),
        'http://localhost:3000/api/oauth/linkedin/callback',
        'northwind-studio',
      ),
    ).toBeNull();
  });
});
