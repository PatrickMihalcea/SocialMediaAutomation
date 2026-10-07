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

/**
 * The hole this closes: the ordinary wake is one fire-and-forget call made at
 * enqueue time. Lose it and the job waits for a schedule GitHub has throttled
 * to over an hour between ticks — which is a stall, not a delay. The clock
 * asks every minute instead, so recovery stops depending on any single call.
 */
describe('wakeWorkerIfIdle', () => {
  beforeEach(() => {
    vi.resetModules();
    envMock.GITHUB_DISPATCH_TOKEN = 'token-123';
    envMock.GITHUB_DISPATCH_REPO = 'acme/bridge88';
    envMock.GITHUB_DISPATCH_WORKFLOW = 'worker.yml';
    envMock.GITHUB_DISPATCH_REF = 'main';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  const runs = (...statuses: string[]) =>
    new Response(JSON.stringify({ workflow_runs: statuses.map((status) => ({ status })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('asks nothing and starts nothing when the queue is empty', async () => {
    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(0)).toBe('no-work');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts a worker when work is waiting and every recent run has finished', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(runs('completed', 'completed'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(3)).toBe('woken');
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe('POST');
  });

  it('leaves a worker that is already up alone', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(runs('in_progress', 'completed'));

    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(3)).toBe('already-up');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /** A run GitHub has accepted but not yet placed on a runner still counts. */
  it('treats a queued run as a worker on its way', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(runs('queued'));

    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(1)).toBe('already-up');
  });

  /**
   * Unknown means start one. A wasted boot costs nothing on a public
   * repository; a missed one costs a run that never finishes.
   */
  it('starts a worker when GitHub cannot say whether one is up', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(1)).toBe('woken');
  });

  /**
   * The debounce exists to collapse a fan-out burst into one dispatch. This
   * path is the recovery path and runs a minute apart, so it must not be
   * swallowed by a debounce an unrelated enqueue just armed.
   */
  it('is not swallowed by the enqueue debounce', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(runs('completed'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const mod = await import('@/lib/queue/wake-remote-worker');
    await mod.wakeRemoteWorker();

    expect(await mod.wakeWorkerIfIdle(1)).toBe('woken');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stays off entirely on a deployment with no dispatch configured', async () => {
    envMock.GITHUB_DISPATCH_TOKEN = '';

    const { wakeWorkerIfIdle } = await import('@/lib/queue/wake-remote-worker');

    expect(await wakeWorkerIfIdle(5)).toBe('off');
    expect(fetch).not.toHaveBeenCalled();
  });
});
