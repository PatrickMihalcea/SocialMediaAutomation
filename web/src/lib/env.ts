import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment access. Importing this module from a client component
 * is a build error (`server-only`), which is the guard that keeps secrets out of
 * the browser bundle. Anything the browser legitimately needs lives on
 * `publicEnv` below and is read from a NEXT_PUBLIC_* variable.
 */

const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  TOKEN_ENCRYPTION_KEY: z.string().min(1, 'TOKEN_ENCRYPTION_KEY is required'),
  CRON_SECRET: z.string().default(''),
  /**
   * The origin this deployment answers on.
   *
   * Separate from NEXT_PUBLIC_APP_URL, which Next inlines into every bundle at
   * build time — including the server ones. Pointing that at a tunnel and
   * restarting changes nothing: the OAuth callback and every signed media URL
   * keep saying localhost, and the failure surfaces as a rejected redirect or a
   * media error with nothing to debug. This one is read at runtime, so a
   * restart is enough. Leave it empty to keep the built-in value.
   */
  APP_URL: z.string().default(''),

  /**
   * Wakes the scheduled worker (see .github/workflows/worker.yml) the moment
   * there is real work for it, instead of leaving it to notice on its own
   * 5-minute timer. Every field must be set for this to activate; any one
   * missing and it stays a silent no-op — a deployment without it just falls
   * back to the schedule, which is correct rather than broken.
   *
   * Deliberately not the same credential the workflow file itself uses. Those
   * are secrets GitHub injects into a run it already started; this is a
   * token the *app* holds so it can ask GitHub to start one, and needs only
   * the narrowest scope that allows: a fine-grained PAT with just the
   * repository's Workflows: write permission, nothing else.
   */
  GITHUB_DISPATCH_TOKEN: z.string().default(''),
  /** "owner/repo" */
  GITHUB_DISPATCH_REPO: z.string().default(''),
  GITHUB_DISPATCH_WORKFLOW: z.string().default('worker.yml'),
  GITHUB_DISPATCH_REF: z.string().default('main'),

  MOCK_MODE: boolish(true),
  QUEUE_DRIVER: z.enum(['in-process', 'bullmq']).default('in-process'),
  /**
   * Lets the web server process jobs itself, for deployments with nowhere to
   * run a worker. Off by default: two queue consumers race for the same job,
   * and the web server is the one more likely to be serving stale code.
   */
  QUEUE_IN_WEB_SERVER: boolish(false),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  // Allows workflow QA to keep real text reasoning while replacing the slow,
  // paid image call with deterministic local placeholders. "inherit" preserves
  // the old one-provider behavior.
  AI_IMAGE_PROVIDER: z.enum(['inherit', 'mock', 'openai', 'image-use']).default('inherit'),

  /**
   * Image generation by running the `image-use` CLI, which renders against the
   * operator's own ChatGPT or Gemini subscription instead of a metered API key.
   *
   * Empty by default, and the provider reports itself unconfigured until the
   * binary is named, so a checkout that never opts in cannot spawn anything.
   * Every other IMAGE_USE_* knob the CLI documents (IMAGE_USE_PROJECT,
   * IMAGE_USE_MODEL, IMAGE_USE_IMAGE_MODEL …) is passed through to the child
   * process untouched — only the ones the app itself decides are listed here.
   */
  IMAGE_USE_BIN: z.string().default(''),
  /**
   * An interpreter to run the CLI with, for a machine whose `python3` predates
   * the 3.10 it needs. Empty means execute the script directly.
   */
  IMAGE_USE_PYTHON: z.string().default(''),
  IMAGE_USE_BACKEND: z.enum(['auto', 'web', 'codex', 'gemini', 'agy']).default('auto'),
  IMAGE_USE_FORMAT: z.enum(['png', 'jpeg', 'webp']).default('png'),
  /** Comma-separated saved style/character names to stack onto every prompt. */
  IMAGE_USE_STYLE: z.string().default(''),
  /** The CLI's own budget for one generation. Large images really do take minutes. */
  IMAGE_USE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /**
   * How long a run may sit in the CLI's cross-process queue before the budget
   * above even starts. The web backend allows one generation at a time machine
   * wide, so a second job waits out the first; this is what stops the wrapper
   * killing a run that is merely waiting its turn.
   */
  IMAGE_USE_QUEUE_WAIT_MS: z.coerce.number().int().nonnegative().default(120_000),

  /**
   * Where the refreshed codex credential is kept between runs, as an object
   * storage key. Empty — the default — means the machine's own ~/.codex is
   * authoritative, which is right for a laptop or a long-lived worker and
   * wrong only for a runner that is destroyed after every pass.
   *
   * The object is AES-256-GCM ciphertext under TOKEN_ENCRYPTION_KEY, so a
   * publicly readable media bucket does not expose it. Pick a key nothing else
   * writes to, e.g. "system/codex-auth.enc".
   */
  CODEX_AUTH_STORE_KEY: z.string().default(''),
  /**
   * First-run seed: the literal contents of ~/.codex/auth.json. Read only when
   * the store above is empty, and copied into it immediately. Holds a live
   * OAuth refresh token — it belongs in a secret store, never in a file.
   */
  CODEX_AUTH_BOOTSTRAP: z.string().default(''),

  // --- rendering and audio analysis ---
  // Both default to off, so a fresh checkout with neither ffmpeg nor Python
  // installed still boots and behaves — the same stance MOCK_MODE takes.
  RENDER_DRIVER: z.enum(['ffmpeg', 'none']).default('none'),
  RENDER_FONT_DIR: z.string().default(''),
  /** Trades encode throughput for byte-reproducible output. */
  RENDER_DETERMINISTIC: boolish(false),
  RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  AUDIO_ANALYZER: z.enum(['librosa', 'constant-bpm']).default('constant-bpm'),
  PYTHON_BIN: z.string().default('python3'),
  AUDIO_ANALYZER_SCRIPT: z.string().default(''),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default(''),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_TEXT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),

  AUTH_GOOGLE_ID: z.string().default(''),
  AUTH_GOOGLE_SECRET: z.string().default(''),

  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),
  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  /**
   * Visibility of an uploaded video. Defaults to public, which is what a
   * finished product should do — but a first run against a real channel is a
   * hard thing to take back, so it is a setting rather than a constant.
   */
  YOUTUBE_PRIVACY_STATUS: z.enum(['public', 'unlisted', 'private']).default('public'),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),
  STRIPE_PRICE_BUSINESS: z.string().default(''),

  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Bridge88 <no-reply@example.com>'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

export const env = load();

/**
 * The app's own origin, for links and callbacks it hands to someone else.
 *
 * APP_URL wins because it is the only one that can change without a rebuild;
 * NEXT_PUBLIC_APP_URL is the build-time default and what the browser sees.
 */
export const publicEnv = {
  appUrl: env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
};

/** True when every external call should be served by an in-repo mock. */
export const isMockMode = env.MOCK_MODE;
