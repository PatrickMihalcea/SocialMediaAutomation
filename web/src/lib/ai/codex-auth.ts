import 'server-only';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { AiCredentialError } from '@/lib/ai/types';

/**
 * Keeps the image-use codex credential alive across throwaway machines.
 *
 * The CLI reads `~/.codex/auth.json` — written once by `codex login` — and
 * rewrites it whenever it refreshes the OAuth token, which it does on a 401.
 * On a persistent host that is the whole story and none of this runs. On a
 * scheduled CI runner the home directory is new every five minutes and is
 * destroyed afterwards, so without this a refreshed token is lost: if the
 * provider rotates refresh tokens, the bootstrap secret goes stale and image
 * generation stops at some unpredictable point weeks later.
 *
 * So the file is restored before work and written back after, encrypted with
 * the same AES-256-GCM key the app already uses for social OAuth tokens. The
 * ciphertext is what lands in object storage, which matters because a media
 * bucket may well be world-readable: what is stored there is unreadable
 * without TOKEN_ENCRYPTION_KEY, which lives only in the environment.
 *
 * Nothing here logs, returns or throws the credential itself.
 */

const AUTH_PATH = join(homedir(), '.codex', 'auth.json');

/** What the file held when it was restored, so a rewrite is detectable. */
let restoredDigest: string | null = null;

const digest = (contents: string) => createHash('sha256').update(contents).digest('hex');

function enabled(): boolean {
  return Boolean(env.CODEX_AUTH_STORE_KEY);
}

/** Which bootstrap secret the stored copy grew out of, or null if unknown. */
const bootstrapDigest = () =>
  env.CODEX_AUTH_BOOTSTRAP ? digest(env.CODEX_AUTH_BOOTSTRAP) : null;

/**
 * The stored copy travels with a note of the secret it came from.
 *
 * Without that note the store would always win, and updating the secret after
 * a credential died would do nothing — the dead copy would be restored over it
 * on every run, and the only way out would be deleting an object from a bucket
 * by hand. The note makes "the secret changed" mean "a person intervened".
 */
interface Envelope {
  auth: string;
  seededFrom: string | null;
}

function parseEnvelope(text: string): Envelope {
  try {
    const parsed = JSON.parse(text) as Partial<Envelope>;
    if (typeof parsed?.auth === 'string') {
      return { auth: parsed.auth, seededFrom: parsed.seededFrom ?? null };
    }
  } catch {
    // Falls through: a copy written before the envelope existed is the
    // credential itself.
  }
  return { auth: text, seededFrom: null };
}

/** Rejects a secret that was pasted wrong, before it becomes a 401 an hour later. */
function assertUsable(contents: string, source: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new AiCredentialError(
      `${source} is not valid JSON, so image generation is paused and nothing has been charged to the OpenAI API. ` +
        'Copy ~/.codex/auth.json verbatim into the CODEX_AUTH_JSON repository secret — the whole file, including the outer braces.',
    );
  }
  const tokens = (parsed as { tokens?: { access_token?: unknown } } | null)?.tokens;
  if (!tokens || typeof tokens.access_token !== 'string') {
    throw new AiCredentialError(
      `${source} has no tokens.access_token, so image generation is paused and nothing has been charged to the OpenAI API. ` +
        'Run `codex login` and copy the file it writes to ~/.codex/auth.json into the CODEX_AUTH_JSON repository secret.',
    );
  }
}

async function write(contents: string): Promise<void> {
  await mkdir(join(homedir(), '.codex'), { recursive: true });
  await writeFile(AUTH_PATH, contents, 'utf8');
  // The runner is single-tenant, but a world-readable OAuth token is worth one
  // syscall to avoid wherever the mode is honoured.
  await chmod(AUTH_PATH, 0o600).catch(() => {});
  restoredDigest = digest(contents);
}

/**
 * Materialises `~/.codex/auth.json` for this run.
 *
 * Object storage wins over the bootstrap secret because it is the one that has
 * been refreshed; the secret is only ever the first run's seed.
 */
export async function restoreCodexAuth(): Promise<'stored' | 'bootstrap' | 'disabled'> {
  if (!enabled()) return 'disabled';

  const raw = await storage()
    .get(env.CODEX_AUTH_STORE_KEY)
    .then((bytes) => decryptToken(bytes.toString('utf8')))
    .catch(() => null);
  const stored = raw === null ? null : parseEnvelope(raw);

  // A secret that no longer matches what the store grew from is someone
  // rotating a dead credential by hand; it wins over whatever is stored.
  const replaced =
    stored !== null && bootstrapDigest() !== null && stored.seededFrom !== bootstrapDigest();

  if (stored && !replaced) {
    assertUsable(stored.auth, 'The stored ChatGPT credential');
    await write(stored.auth);
    return 'stored';
  }

  if (!env.CODEX_AUTH_BOOTSTRAP) {
    throw new AiCredentialError(
      `There is no ChatGPT credential at ${env.CODEX_AUTH_STORE_KEY} and CODEX_AUTH_BOOTSTRAP is empty, so image generation is paused and nothing has been charged to the OpenAI API. ` +
        'To start it: run `codex login`, then set the CODEX_AUTH_JSON repository secret to the contents of ~/.codex/auth.json (docs/deploying.md step 5).',
    );
  }
  assertUsable(env.CODEX_AUTH_BOOTSTRAP, 'CODEX_AUTH_BOOTSTRAP');
  await write(env.CODEX_AUTH_BOOTSTRAP);
  // Stored immediately rather than at the end of the run: a pass that crashed
  // would otherwise lose the seed and start over.
  await save(env.CODEX_AUTH_BOOTSTRAP);
  return 'bootstrap';
}

/**
 * Writes the file back if the CLI refreshed it during this run.
 *
 * Safe to call when nothing happened: an unchanged file costs one read.
 */
export async function persistCodexAuth(): Promise<'saved' | 'unchanged' | 'disabled'> {
  if (!enabled() || restoredDigest === null) return 'disabled';
  const contents = await readFile(AUTH_PATH, 'utf8').catch(() => null);
  if (contents === null || digest(contents) === restoredDigest) return 'unchanged';
  await save(contents);
  restoredDigest = digest(contents);
  return 'saved';
}

async function save(contents: string): Promise<void> {
  // The seed note travels with every write, including the ones that follow a
  // token refresh — losing it there would make the next run mistake an
  // unchanged secret for a new one and restore the stale bootstrap over it.
  const envelope: Envelope = { auth: contents, seededFrom: bootstrapDigest() };
  const ciphertext = Buffer.from(encryptToken(JSON.stringify(envelope)), 'utf8');
  await storage().put(env.CODEX_AUTH_STORE_KEY, ciphertext, 'application/octet-stream');
}

/** Test seam: forget what the last restore saw. */
export function resetCodexAuthState(): void {
  restoredDigest = null;
}
