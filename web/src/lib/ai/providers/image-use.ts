import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@/lib/env';
import { AiCredentialError, AiError, type AiImageReference, type AiImageResult, type AiMessage, type AiObjectResult, type AiProvider, type AiTextResult } from '@/lib/ai/types';
import type { ImageSize } from '@/lib/ai/image-sizes';

/**
 * Image generation by running the `image-use` CLI, which renders against the
 * operator's own ChatGPT or Gemini subscription rather than a metered API key.
 *
 * The CLI owns everything hard about that: which backend to use, driving a
 * logged-in Chrome, OAuth refresh, the cross-process concurrency lock, stall
 * detection. This file is the seam — it hands over a prompt and a destination
 * path and reads back the bytes, so a new CLI release changes nothing here.
 *
 * Two consequences worth knowing before switching a deployment to it:
 *
 * - It needs a real machine. The binary, a Python interpreter and (on the
 *   default `web` backend) a signed-in Chrome all have to exist beside the
 *   process that calls this. A serverless build has none of them, so this
 *   belongs on a self-hosted worker, not on the web tier.
 * - The subscription is the operator's own. That is what it is licensed for;
 *   generating on behalf of end users is not, and no code here can make it so.
 */

/** Maps `--format` onto what the stored asset will claim to be. */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Keep the tail of a stream for error messages without holding a whole run of progress lines. */
const STREAM_KEEP_BYTES = 8_000;

function config() {
  if (!env.IMAGE_USE_BIN) {
    throw new AiError(
      'The image-use provider is not configured. Set IMAGE_USE_BIN to the path of the image-use CLI.',
    );
  }
  // Running it through an explicit interpreter is the escape hatch for a
  // machine whose `python3` is older than the 3.10 the CLI needs — the shebang
  // would otherwise pick the wrong one and fail somewhere deep in the script.
  const command = env.IMAGE_USE_PYTHON || env.IMAGE_USE_BIN;
  const leading = env.IMAGE_USE_PYTHON ? [env.IMAGE_USE_BIN] : [];
  return { command, leading, timeoutMs: env.IMAGE_USE_TIMEOUT_MS };
}

export class ImageUseProvider implements AiProvider {
  readonly name = 'image-use';
  readonly textModel = 'image-use';
  readonly imageModel = 'image-use';

  isConfigured(): boolean {
    return Boolean(env.IMAGE_USE_BIN);
  }

  /**
   * Text stays on AI_PROVIDER. The CLI only returns images, and a provider that
   * answered `complete` with a caption scraped out of a chat would hand the
   * application free prose where completeObject promises a schema.
   */
  async complete(_input: { messages: AiMessage[] }): Promise<AiTextResult> {
    throw new AiError('The image-use provider generates images only; set AI_PROVIDER for text.');
  }

  async completeObject<T>(_input: { messages: AiMessage[] }): Promise<AiObjectResult<T>> {
    throw new AiError('The image-use provider generates images only; set AI_PROVIDER for text.');
  }

  async generateImage(input: {
    onStage?: (stage: string) => void;
    prompt: string;
    size?: ImageSize;
    references?: AiImageReference[];
  }): Promise<AiImageResult> {
    const { command, leading, timeoutMs } = config();
    const format = env.IMAGE_USE_FORMAT;

    // A directory of our own, so the CLI's "don't overwrite" auto-numbering
    // never has anything to collide with and cleanup is a single remove.
    const directory = await mkdtemp(join(tmpdir(), 'image-use-'));
    const requested = join(directory, `image.${format}`);

    // Written into the same directory, so the one cleanup below covers them.
    // Numbered because two references can share a type, and the CLI reads the
    // format from the extension.
    const referencePaths: Array<{ role: AiImageReference['role']; path: string }> = [];
    for (const [index, reference] of (input.references ?? []).entries()) {
      const path = join(directory, `reference-${index}.${extensionFor(reference.mimeType)}`);
      await writeFile(path, reference.data);
      referencePaths.push({ role: reference.role, path });
    }

    try {
      const result = await run(
        command,
        [...leading, ...cliArgs({
          out: requested,
          format,
          size: input.size,
          timeoutMs,
          prompt: input.prompt,
          references: referencePaths,
        })],
        // The CLI's own --timeout starts only once it holds a concurrency slot,
        // so this outer deadline has to cover the queue wait in front of it as
        // well. It is a backstop against the CLI itself wedging, not the budget.
        timeoutMs + env.IMAGE_USE_QUEUE_WAIT_MS,
        {
          ...process.env,
          // A config directory of this run's own.
          //
          // The CLI keeps a style library under XDG_CONFIG_HOME and writes it
          // through a temp file with a fixed name. On a machine that has none
          // yet it writes an empty one on first read — so several generations
          // starting together all create `styles.json.tmp`, the first rename
          // takes it, and the rest die on a file that is no longer there:
          //
          //   FileNotFoundError: styles.json.tmp -> styles.json
          //
          // The worker runs four jobs at once and a CI runner starts fresh
          // every time, which is exactly that race. Nothing here uses the
          // style library or the asset library beside it, so the cheapest fix
          // is to stop sharing the directory they live in. The path is the
          // per-call temp directory that is removed below.
          XDG_CONFIG_HOME: directory,
        },
        input.onStage,
      );

      if (result.timedOut) {
        throw new AiError(
          `image-use did not finish within ${Math.round((timeoutMs + env.IMAGE_USE_QUEUE_WAIT_MS) / 1000)}s and was killed.`,
          { retryable: true },
        );
      }
      if (result.code !== 0) {
        const credential = credentialFailure(result.stderr);
        if (credential) throw credential;
        const exhausted = usageLimitFailure(result.stderr);
        if (exhausted) throw exhausted;
        throw new AiError(`image-use exited with ${result.code ?? result.signal}: ${lastLines(result.stderr)}`, {
          retryable: isRetryable(result.stderr),
        });
      }

      // --quiet makes stdout exactly the saved path; the path we asked for is
      // the fallback for a future version that prints something alongside it.
      const saved = result.stdout.trim().split('\n').pop()?.trim() || requested;
      const data = await readFile(saved).catch(async (error) => {
        if (saved === requested) throw error;
        return readFile(requested);
      });
      if (data.length === 0) {
        throw new AiError('image-use saved an empty file.', { retryable: true });
      }

      return {
        data,
        mimeType: MIME_TYPES[extensionOf(saved)] ?? MIME_TYPES[format],
        // The progress timeline names the model the backend actually rendered
        // with, which is not always the one that was asked for.
        model: reportedModel(result.stderr) ?? this.imageModel,
        usage: reportedUsage(result.stderr),
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new AiError(`image-use was not found at ${env.IMAGE_USE_PYTHON || env.IMAGE_USE_BIN}. Check IMAGE_USE_BIN.`);
      }
      throw new AiError(`image-use failed: ${message}`, { cause: error });
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * The flags come first and the prompt last, behind `--`.
 *
 * Not style: the CLI dispatches on its first argument, so a brief that happens
 * to begin with the word "doctor", "update" or "animate" would run that
 * subcommand instead of generating anything.
 */
const ROLE_FLAG: Record<AiImageReference['role'], string> = {
  composition: '--composition-ref',
  style: '--style-ref',
  subject: '--ref',
};

function cliArgs(input: {
  out: string;
  format: string;
  size?: ImageSize;
  timeoutMs: number;
  prompt: string;
  references?: Array<{ role: AiImageReference['role']; path: string }>;
}): string[] {
  const args = [
    '--quiet',
    '--backend',
    env.IMAGE_USE_BACKEND,
    '--format',
    input.format,
    '--out',
    input.out,
    '--timeout',
    String(Math.max(1, Math.round(input.timeoutMs / 1000))),
  ];
  // Unlike a UI, the CLI takes the shape as an argument — so the prompt stays
  // the brief and nothing has to ask for a ratio in words.
  if (input.size) args.push('--size', input.size);
  // One flag per role, because the role is most of the meaning. The same
  // photograph passed as a composition means "borrow this framing, render
  // something else", as a subject means "keep these faces", and as a style
  // means "match this palette and finish, copy none of the content" — and the
  // CLI has a flag for each. Sending every reference as a composition, which
  // is what this did, made the other two settings prompt text and nothing
  // more: the generator was told one thing in words and another in flags.
  for (const { role, path } of input.references ?? []) {
    args.push(ROLE_FLAG[role], path);
  }
  for (const style of env.IMAGE_USE_STYLE.split(',').map((name) => name.trim()).filter(Boolean)) {
    args.push('--style', style);
  }
  args.push('--', input.prompt);
  return args;
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(
  command: string,
  args: string[],
  killAfterMs: number,
  env?: NodeJS.ProcessEnv,
  onStage?: (stage: string) => void,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // No stdin: the CLI never prompts, and an inherited one would let a
    // misconfigured run block a worker forever waiting on a terminal.
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = keepTail(stdout + chunk); });
    child.stderr.on('data', (chunk: string) => {
      stderr = keepTail(stderr + chunk);
      // The CLI narrates itself on stderr — "[  1.1s] queued", then
      // "[  7.6s] generating". Reading it back is the only account anyone has
      // of what a five-minute call is doing, and it was being thrown away.
      if (!onStage) return;
      for (const line of chunk.split('\n')) {
        const stage = PROGRESS_LINE.exec(line)?.[1]?.trim();
        if (stage) onStage(stage);
      }
    });

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // SIGTERM lets it release its concurrency slot and close its Chrome tab;
      // SIGKILL is for the case where it cannot.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, killAfterMs);

    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function keepTail(text: string): string {
  return text.length > STREAM_KEEP_BYTES ? text.slice(-STREAM_KEEP_BYTES) : text;
}

function lastLines(stderr: string, count = 4): string {
  const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.slice(-count).join(' | ') || 'no output';
}

/**
 * The CLI's own credential errors, restated for whoever has to fix them.
 *
 * Its advice — install the codex CLI and run `codex login` — is right for a
 * laptop and useless on a runner that is rebuilt every five minutes, where the
 * credential comes from a secret. Deliberately says that nothing was billed
 * elsewhere: the alternative to this provider costs money, and a person reading
 * a failure needs to know it did not quietly happen.
 */
export function credentialFailure(stderr: string): AiCredentialError | null {
  const expired = /refresh_token is no longer valid|HTTP 401|HTTP 403|invalid_grant/i.test(stderr);
  const missing = /auth\.json not found|no ChatGPT OAuth access_token|CODEX_AUTH/i.test(stderr);
  if (!expired && !missing) return null;
  return new AiCredentialError(
    `${expired ? 'The ChatGPT credential has expired or been revoked' : 'There is no ChatGPT credential on this machine'}, so no image was generated and nothing was charged to the OpenAI API. ` +
      'To restore it: run `codex login`, then update the CODEX_AUTH_JSON repository secret with the new contents of ~/.codex/auth.json (docs/deploying.md step 5). ' +
      'To generate on the paid API instead, set this step or the studio to generate with API.',
  );
}

/**
 * The subscription's quota is spent until it resets.
 *
 * Arrives as HTTP 429, the same status as a momentary throttle, so the body is
 * what separates them — and the difference matters: a throttle clears in
 * seconds and is worth retrying, while this one does not change for weeks. Left
 * as retryable it burned the node's whole attempt budget and reported the
 * failure three attempts later than it was known.
 */
export function usageLimitFailure(stderr: string): AiError | null {
  if (!/usage_limit_reached|usage limit has been reached/i.test(stderr)) return null;

  const seconds = Number(/"resets_at"\s*:\s*(\d+)/.exec(stderr)?.[1]);
  // Stamped UTC because this string is written on the server and read wherever
  // the reader happens to be: the same instant is the 15th in New York and the
  // 16th in UTC, and an unlabelled date off by one is worse than a labelled one.
  const resetsAt = Number.isFinite(seconds) && seconds > 0
    ? `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(seconds * 1000)} UTC`
    : null;

  return new AiError(
    `The ChatGPT subscription's image quota is used up${resetsAt ? `, and resets on ${resetsAt}` : ''}. `
      + 'No image was generated and nothing was charged to the OpenAI API. '
      + 'To keep generating now, set this step or the studio to generate with API.',
    { retryable: false },
  );
}

/**
 * Worth another attempt: a slow render, a wedged backend, a momentary rate
 * limit — anything where the same prompt sent again would plausibly work.
 *
 * The default for an AiError is *not* retryable, so anything missing from this
 * list ends the step outright. Two of the CLI's most common failures were
 * missing, and both are as transient as failures get:
 *
 *   no image returned. events seen: response.completed, …
 *   stream exceeded total timeout budget; aborting
 *
 * The first is the model streaming a reply that carried no picture. The second
 * is the CLI's own wall-clock cap — and it was missed only because the pattern
 * read "timed out" while the message says "timeout". Both were treated as
 * permanent, so a batch of eight images stopped on the first flaky one, and
 * the step's own resume logic never got a second attempt to run.
 */
function isRetryable(stderr: string): boolean {
  // Checked first: an exhausted quota is a 429 that no retry can help, and a
  // credential problem is not fixed by asking again either.
  if (usageLimitFailure(stderr)) return false;
  if (credentialFailure(stderr)) return false;
  return RETRYABLE_FAILURES.test(stderr);
}

const RETRYABLE_FAILURES = new RegExp([
  // Slow or wedged: the CLI's own budget, the stall detector, a killed process.
  // Deliberately not a bare 'aborting' — the message this covers is "stream
  // exceeded total timeout budget; aborting", which 'timeout' already matches,
  // and the word alone would hand a retry to any failure that used it.
  'timed ?out',
  'timeout',
  'stalled',
  // The backend answered without a picture in it.
  'no image returned',
  'invalid base64',
  // Asked too quickly, or the service is having a moment.
  'HTTP 429',
  'HTTP 5\\d\\d',
  'too many requests',
  'rate.?limit',
  'temporarily',
  // The browser backend losing its session mid-run.
  'connection (?:reset|closed|refused)',
  'ECONNRESET',
].join('|'), 'i');

function reportedModel(stderr: string): string | null {
  return /\bmodel=(\S+)/.exec(stderr)?.[1] ?? null;
}

/**
 * Only the codex backend reports tokens; the browser-driven ones have no
 * accounting to report, and an invented number would end up in the cost column.
 */
function reportedUsage(stderr: string): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const match = /\btokens=(\d+) \(in (\d+|\?) \/ out (\d+|\?)\)/.exec(stderr);
  if (!match) return {};
  const number = (value: string) => (value === '?' ? undefined : Number(value));
  return {
    totalTokens: Number(match[1]),
    promptTokens: number(match[2]),
    completionTokens: number(match[3]),
  };
}

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

/** The CLI reads the format from the extension, so a reference needs a real one. */
function extensionFor(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

/**
 * A progress line from the CLI: an elapsed stamp, then what it is doing.
 *
 * Only the word, not the stamp — the stamp is this run's own clock and the
 * step already knows how long it has been waiting. Anchored so a prompt that
 * happens to contain brackets cannot be read as progress.
 */
const PROGRESS_LINE = /^\s*\[\s*[\d.]+s\]\s*([A-Za-z][A-Za-z \-]{0,40})/;
