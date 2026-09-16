import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  GITHUB_DISPATCH_TOKEN: '',
  GITHUB_DISPATCH_REPO: '',
  GITHUB_DISPATCH_WORKFLOW: 'worker.yml',
  GITHUB_DISPATCH_REF: 'main',
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: envMock }));

describe('wakeRemoteWorker', () => {
  beforeEach(() => {
    vi.resetModules();
    envMock.GITHUB_DISPATCH_TOKEN = '';
    envMock.GITHUB_DISPATCH_REPO = '';
    envMock.GITHUB_DISPATCH_WORKFLOW = 'worker.yml';
    envMock.GITHUB_DISPATCH_REF = 'main';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  // Most deployments — local dev, anything running its own persistent
  // worker — never set these. The schedule alone must still be correct.
  it('does nothing when unconfigured, and never touches fetch', async () => {
    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await wakeRemoteWorker();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dispatches the configured workflow on the configured ref', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'acme/bridge88';
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await wakeRemoteWorker();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/bridge88/actions/workflows/worker.yml/dispatches');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer token-123' });
    expect(JSON.parse(init?.body as string)).toEqual({ ref: 'main' });
  });

  // A workflow fanning out several nodes at once calls enqueue() several
  // times in a row; this is what stops that from becoming several dispatches.
  it('debounces a burst of calls into one dispatch', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'acme/bridge88';
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await Promise.all([wakeRemoteWorker(), wakeRemoteWorker(), wakeRemoteWorker()]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // The whole point: something someone is waiting on must complete even if
  // GitHub is unreachable, rejects the token, or the repo is misconfigured.
  it('never throws when the request fails', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'acme/bridge88';
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await expect(wakeRemoteWorker()).resolves.toBeUndefined();
  });

  it('never throws and never calls fetch when the repo is malformed', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'not-a-valid-repo-slug';

    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await expect(wakeRemoteWorker()).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('logs rather than throws on a non-2xx response', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'acme/bridge88';
    vi.mocked(fetch).mockResolvedValue(new Response('bad token', { status: 401 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { wakeRemoteWorker } = await import('@/lib/queue/wake-remote-worker');
    await expect(wakeRemoteWorker()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
