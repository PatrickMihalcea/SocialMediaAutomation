import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireWorkspace: vi.fn(),
  preferencesUpsert: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({
  requireWorkspace: mocks.requireWorkspace,
  requireUser: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    workspacePreferences: { upsert: mocks.preferencesUpsert },
    workspace: {},
    workspaceMember: {},
    brandSettings: {},
    post: {},
    socialAccount: {},
  },
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/ai/service', () => ({ inferBrandVoice: vi.fn() }));
vi.mock('@/lib/storage', () => ({ mediaKey: vi.fn(), storage: vi.fn() }));
vi.mock('@/lib/social/accounts', () => ({ createDemoAccount: vi.fn() }));
vi.mock('@/lib/workspaces/lifecycle', () => ({
  availableWorkspaceSlug: vi.fn(),
  deleteWorkspaceWithStorage: vi.fn(),
  slugifyWorkspace: vi.fn(),
  timezoneChangeNotice: vi.fn(),
}));

import { updateWorkspacePreferencesAction } from '@/app/actions/workspace';
import { forbidden } from '@/lib/errors';

function preferencesForm() {
  const formData = new FormData();
  formData.set('defaultPostDestination', 'QUEUE');
  formData.set('defaultPublishHour', '11');
  formData.set('defaultPublishMinute', '30');
  formData.set('defaultHashtags', '#launch, northwind');
  formData.set('defaultCta', 'See what is new.');
  formData.set('aiCreativity', 'CREATIVE');
  formData.set('requireApprovalByDefault', 'on');
  return formData;
}

describe('workspace posting and AI defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspace.mockResolvedValue({
      workspace: { id: 'workspace-1' },
      user: { id: 'owner-1' },
    });
    mocks.preferencesUpsert.mockResolvedValue({});
  });

  it('stores normalized defaults for a member who can change settings', async () => {
    const result = await updateWorkspacePreferencesAction('northwind-studio', {}, preferencesForm());

    expect(result.status).toBe('success');
    expect(mocks.requireWorkspace).toHaveBeenCalledWith('northwind-studio', 'workspace:update');
    expect(mocks.preferencesUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        defaultPostDestination: 'QUEUE',
        defaultPublishHour: 11,
        defaultPublishMinute: 30,
        defaultHashtags: ['launch', 'northwind'],
        defaultCta: 'See what is new.',
        aiCreativity: 'CREATIVE',
        requireApprovalByDefault: true,
        aiUseBrandVoice: false,
      }),
    }));
  });

  it('refuses a direct Viewer call before writing preferences', async () => {
    mocks.requireWorkspace.mockRejectedValueOnce(
      forbidden('Your role (viewer) cannot change workspace settings.'),
    );

    const result = await updateWorkspacePreferencesAction('northwind-studio', {}, preferencesForm());

    expect(result.status).toBe('error');
    expect(result.error).toContain('viewer');
    expect(mocks.preferencesUpsert).not.toHaveBeenCalled();
  });
});
