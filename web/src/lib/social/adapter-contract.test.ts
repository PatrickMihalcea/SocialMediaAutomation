import { describe, expect, it } from 'vitest';
import { PLATFORMS, getAdapter } from '@/lib/social/registry';

describe('social OAuth adapter contract', () => {
  it.each(PLATFORMS)('%s exposes the complete connection lifecycle', (platform) => {
    const adapter = getAdapter(platform);
    expect(adapter.platform).toBe(platform);
    expect(adapter.label).toBeTruthy();
    expect(typeof adapter.isConfigured).toBe('function');
    expect(typeof adapter.getAuthorizationUrl).toBe('function');
    expect(typeof adapter.exchangeCode).toBe('function');
    expect(typeof adapter.refreshToken).toBe('function');
    expect(typeof adapter.validateAccount).toBe('function');
    expect(typeof adapter.disconnect).toBe('function');
  });
});
