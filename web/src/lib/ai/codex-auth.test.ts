import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted: the module under test resolves its path from homedir() at import
// time, so the mock has to exist before the import — and vi.mock factories run
// above every plain const in this file.
// Just a path — the module creates the directory itself on first write.
const home = vi.hoisted(
  () => `${process.env.TMPDIR?.replace(/\/$/, '') ?? '/tmp'}/codex-home-${process.pid}`,
);
const objects = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('server-only', () => ({}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home,
}));
vi.mock('@/lib/env', () => ({
  env: { CODEX_AUTH_STORE_KEY: 'system/codex-auth.enc', CODEX_AUTH_BOOTSTRAP: '' },
}));
vi.mock('@/lib/storage', () => ({
  storage: () => ({
    async get(key: string) {
      const value = objects.get(key);
      if (!value) throw new Error('not found');
      return value;
    },
    async put(key: string, body: Buffer) {
      objects.set(key, body);
    },
  }),
}));
// Reversible stand-in for AES-GCM: the real cipher is covered by its own tests,
// and this keeps the assertions about *what* was stored, not how.
vi.mock('@/lib/crypto/tokens', () => ({
  encryptToken: (plain: string) => `enc:${plain}`,
  decryptToken: (cipher: string) => {
    if (!cipher.startsWith('enc:')) throw new Error('bad ciphertext');
    return cipher.slice(4);
  },
}));

import { persistCodexAuth, resetCodexAuthState, restoreCodexAuth } from '@/lib/ai/codex-auth';
import { env } from '@/lib/env';

const AUTH = join(home, '.codex', 'auth.json');
const credential = (token: string) =>
  JSON.stringify({ tokens: { access_token: token, refresh_token: `r-${token}` } });

const { createHash } = await import('node:crypto');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** What the module writes: the credential plus the secret it grew from. */
const envelope = (auth: string, seededFrom: string | null) =>
  Buffer.from(`enc:${JSON.stringify({ auth, seededFrom })}`);

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('codex credential lifecycle', () => {
  beforeEach(() => {
    objects.clear();
    resetCodexAuthState();
    rmSync(join(home, '.codex'), { recursive: true, force: true });
    env.CODEX_AUTH_STORE_KEY = 'system/codex-auth.enc';
    env.CODEX_AUTH_BOOTSTRAP = '';
  });

  it('does nothing at all when no store key is configured', async () => {
    env.CODEX_AUTH_STORE_KEY = '';

    expect(await restoreCodexAuth()).toBe('disabled');
    expect(await persistCodexAuth()).toBe('disabled');
  });

  it('seeds the store from the bootstrap secret on the first run', async () => {
    env.CODEX_AUTH_BOOTSTRAP = credential('first');

    expect(await restoreCodexAuth()).toBe('bootstrap');
    expect(readFileSync(AUTH, 'utf8')).toBe(credential('first'));
    // Stored immediately rather than at the end of the run: a pass that
    // crashed would otherwise leave the store empty and repeat the seed.
    expect(objects.get('system/codex-auth.enc')).toEqual(
      envelope(credential('first'), sha(credential('first'))),
    );
  });

  /** The whole point: the stored copy is the refreshed one, the secret is stale. */
  it('prefers the stored credential over the bootstrap secret', async () => {
    const seed = credential('seed');
    objects.set('system/codex-auth.enc', envelope(credential('refreshed'), sha(seed)));
    env.CODEX_AUTH_BOOTSTRAP = seed;

    expect(await restoreCodexAuth()).toBe('stored');
    expect(readFileSync(AUTH, 'utf8')).toBe(credential('refreshed'));
  });

  /**
   * The trap this closes: a credential dies, the operator pastes a fresh one
   * into the secret, and nothing changes — because the dead copy in the bucket
   * kept winning. A secret that no longer matches what the store grew from is
   * a deliberate intervention, so it takes over.
   */
  it('lets an updated secret override a stale stored copy', async () => {
    objects.set('system/codex-auth.enc', envelope(credential('revoked'), sha(credential('old'))));
    env.CODEX_AUTH_BOOTSTRAP = credential('rotated-by-hand');

    expect(await restoreCodexAuth()).toBe('bootstrap');
    expect(readFileSync(AUTH, 'utf8')).toBe(credential('rotated-by-hand'));
    // And the store now tracks the new secret, so the next run stays on it.
    expect(objects.get('system/codex-auth.enc')).toEqual(
      envelope(credential('rotated-by-hand'), sha(credential('rotated-by-hand'))),
    );
  });

  /** A refresh must not look like a changed secret on the following run. */
  it('keeps following the same secret after the CLI refreshes the token', async () => {
    const seed = credential('seed');
    env.CODEX_AUTH_BOOTSTRAP = seed;
    await restoreCodexAuth();

    const { writeFileSync } = await import('node:fs');
    writeFileSync(AUTH, credential('refreshed-by-cli'));
    expect(await persistCodexAuth()).toBe('saved');

    resetCodexAuthState();
    expect(await restoreCodexAuth()).toBe('stored');
    expect(readFileSync(AUTH, 'utf8')).toBe(credential('refreshed-by-cli'));
  });

  it('stores the file again only when the CLI rewrote it', async () => {
    env.CODEX_AUTH_BOOTSTRAP = credential('first');
    await restoreCodexAuth();

    expect(await persistCodexAuth()).toBe('unchanged');

    // What a token refresh looks like from out here.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(AUTH, credential('rotated'));

    expect(await persistCodexAuth()).toBe('saved');
    expect(objects.get('system/codex-auth.enc')).toEqual(
      envelope(credential('rotated'), sha(credential('first'))),
    );
  });

  it('refuses a secret that is not a codex credential, before any job runs', async () => {
    env.CODEX_AUTH_BOOTSTRAP = '{"api_key":"sk-something"}';
    await expect(restoreCodexAuth()).rejects.toThrow(/access_token/);

    env.CODEX_AUTH_BOOTSTRAP = 'not json at all';
    await expect(restoreCodexAuth()).rejects.toThrow(/valid JSON/);
  });

  it('says what to do when neither the store nor the secret has anything', async () => {
    await expect(restoreCodexAuth()).rejects.toThrow(/codex login/);
  });
});
