/**
 * Configuration preflight.
 *
 * Every check runs a real call rather than testing whether a variable is
 * non-empty: a present OPENAI_API_KEY that 401s, or a public URL that resolves
 * but does not reach this machine, both look correct in an env file and fail at
 * the point where they cost a paid generation or a half-published post.
 *
 * Run: npm run doctor              — is this machine able to do the work
 *      npm run doctor:production   — would this configuration survive being live
 *
 * The production pass is the same checks with the thresholds that only matter
 * once real people depend on it: no mock providers, no local disk, a worker that
 * can outlive a request, and secrets that were actually set rather than left on
 * a default.
 */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac } from 'node:crypto';

const run = promisify(execFile);

const ok = (name, detail) => ({ level: 'ok', name, detail });
const warn = (name, detail, fix) => ({ level: 'warn', name, detail, fix });
const fail = (name, detail, fix) => ({ level: 'fail', name, detail, fix });

const results = [];
const add = (result) => { results.push(result); return result; };

/** Raises production-only findings from advisory to blocking. */
const PRODUCTION = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
/** A finding that is fine locally and unacceptable live. */
const prod = (name, detail, fix) => (PRODUCTION ? fail(name, detail, fix) : warn(name, detail, fix));

const e = (key, fallback = '') => process.env[key]?.trim() || fallback;
const isTrue = (key, fallback) => {
  const value = e(key);
  return value === '' ? fallback : value === 'true' || value === '1';
};

async function main() {
  // APP_URL first, matching src/lib/env.ts: it is the one the running server
  // actually uses, and the only one a restart can change.
  const appUrl = e('APP_URL') || e('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(appUrl);

  await checkDatabase();
  await checkAppUrl(appUrl, local);
  await checkOpenAi();
  await checkRender();
  await checkAudio();
  await checkYouTube(appUrl);
  await checkInstagram(appUrl, local);
  await checkPublicMedia(appUrl, local);
  checkMockMode();
  await checkProductionShape();

  report();
}

async function checkDatabase() {
  if (!e('DATABASE_URL')) return add(fail('Database', 'DATABASE_URL is not set.', 'Set DATABASE_URL in .env'));
  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    const [{ count }] = await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM workspaces');
    await db.$disconnect();
    add(ok('Database', `reachable, ${count} workspace${count === 1 ? '' : 's'}`));
  } catch (error) {
    add(fail('Database', shorten(error), 'Start Postgres, then: npm run db:migrate && npm run db:seed'));
  }
}

async function checkAppUrl(appUrl, local) {
  try {
    const url = new URL(appUrl);
    if (url.pathname !== '/' || url.search) {
      return add(fail('App URL', `${appUrl} has a path or query.`, 'APP_URL must be a bare origin'));
    }
    const response = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(8000) });
    add(response.ok
      ? ok('App URL', `${appUrl} answering${local ? ' (local only)' : ' (public)'}`)
      : warn('App URL', `${appUrl} answered ${response.status}.`, 'Is the server running on that origin?'));
  } catch (error) {
    add(warn('App URL', `${appUrl} not reachable — ${shorten(error)}`, 'Start the server: npm run serve'));
  }
}

async function checkOpenAi() {
  const provider = e('AI_PROVIDER', 'mock');
  const imageSetting = e('AI_IMAGE_PROVIDER', 'inherit');
  const imageProvider = imageSetting === 'inherit' ? provider : imageSetting;
  const key = e('OPENAI_API_KEY');
  if (provider !== 'openai' && imageProvider !== 'openai') {
    return add(warn('OpenAI', `text=${provider}, images=${imageProvider} — every generation is a fixture.`,
      'Set AI_PROVIDER="openai", or AI_IMAGE_PROVIDER="openai", to generate for real'));
  }
  if (!key) return add(fail('OpenAI', 'An OpenAI provider is selected but OPENAI_API_KEY is empty.', 'Add OPENAI_API_KEY to .env'));

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return add(fail('OpenAI', `the key was rejected (${response.status}).`,
        response.status === 401 ? 'Check the key, and that it has not been revoked' : undefined));
    }
    const body = await response.json();
    const models = new Set((body.data ?? []).map((m) => m.id));
    const text = e('OPENAI_TEXT_MODEL', 'gpt-4o-mini');
    const image = e('OPENAI_IMAGE_MODEL', 'gpt-image-1');
    const selectedModels = [
      ...(provider === 'openai' ? [text] : []),
      ...(imageProvider === 'openai' ? [image] : []),
    ];
    const missing = selectedModels.filter((model) => !models.has(model));
    add(missing.length
      ? warn('OpenAI', `key works, but this account cannot see ${missing.join(' and ')}.`,
        imageProvider === 'openai'
          ? 'Image models need a verified organisation; check platform.openai.com/settings'
          : undefined)
      : ok('OpenAI', `key works · text=${provider === 'openai' ? text : provider} · images=${imageProvider === 'openai' ? image : imageProvider}`));
  } catch (error) {
    add(fail('OpenAI', shorten(error)));
  }
}

async function checkRender() {
  if (e('RENDER_DRIVER', 'none') !== 'ffmpeg') {
    return add(warn('Video render', 'RENDER_DRIVER is not ffmpeg — slideshow and overlay steps will refuse to run.',
      'Set RENDER_DRIVER="ffmpeg"'));
  }
  try {
    const { stdout } = await run('ffmpeg', ['-version']);
    const version = stdout.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
    const { stdout: filters } = await run('ffmpeg', ['-hide_banner', '-filters']);
    // Labels fall back to sharp-drawn PNGs without it, so this is information,
    // not a failure — but it explains the extra compositing pass in a trace.
    const drawtext = / drawtext /.test(filters);
    add(ok('Video render', `ffmpeg ${version}${drawtext ? '' : ' (no drawtext — labels drawn with sharp)'}`));
  } catch {
    add(fail('Video render', 'ffmpeg is not on PATH.', 'brew install ffmpeg'));
  }
}

async function checkAudio() {
  if (e('AUDIO_ANALYZER', 'constant-bpm') !== 'librosa') {
    return add(warn('Beat detection', 'AUDIO_ANALYZER=constant-bpm — cuts use an even tempo guess, not detected beats.',
      'Set AUDIO_ANALYZER="librosa"'));
  }
  const python = e('PYTHON_BIN', 'python3');
  try {
    const { stdout } = await run(python, ['-c', 'import librosa; print(librosa.__version__)']);
    add(ok('Beat detection', `librosa ${stdout.trim()} via ${python}`));
  } catch {
    add(fail('Beat detection', `${python} cannot import librosa.`,
      'python3.12 -m venv .venv-audio && .venv-audio/bin/pip install librosa'));
  }
}

async function checkYouTube(appUrl) {
  if (!e('YOUTUBE_CLIENT_ID') || !e('YOUTUBE_CLIENT_SECRET')) {
    return add(warn('YouTube', 'no OAuth credentials — the channel shows as unavailable in Connect.',
      'Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET'));
  }
  // Uploads push bytes to Google, so unlike Instagram this works from localhost.
  add(ok('YouTube', `configured · redirect ${new URL('/api/oauth/youtube/callback', appUrl)}`));
}

async function checkInstagram(appUrl, local) {
  if (!e('META_APP_ID') || !e('META_APP_SECRET')) {
    return add(warn('Instagram', 'no Meta app credentials — the channel shows as unavailable in Connect.',
      'Add META_APP_ID and META_APP_SECRET'));
  }
  if (local) {
    // Two separate needs, and they fail differently. The media has to be
    // fetchable by Meta forever; the redirect only has to work in a browser for
    // the few seconds of the connect flow.
    const bucket = e('STORAGE_DRIVER', 'local') === 's3';
    return add(bucket
      ? warn('Instagram',
        `media is served from the bucket, so publishing works — but ${appUrl} cannot receive the OAuth redirect.`,
        'Run a tunnel and set APP_URL only while connecting the account')
      : fail('Instagram',
        `the app's origin is ${appUrl} and media is served from local disk. Instagram fetches the video itself and cannot reach localhost.`,
        'Move storage to a bucket (STORAGE_DRIVER=s3), or expose the app with ngrok and set APP_URL'));
  }
  if (!appUrl.startsWith('https://')) {
    return add(fail('Instagram', `${appUrl} is not HTTPS. Meta rejects both the redirect and the media URL.`));
  }
  add(ok('Instagram', `configured · redirect ${new URL('/api/oauth/instagram/callback', appUrl)}`));
}

/**
 * The check that is actually worth running.
 *
 * Signs a storage URL exactly as the publishing path does and fetches it
 * through the public origin. A 200 here is the difference between Instagram
 * pulling the video and returning a media error with nothing to debug.
 */
async function checkPublicMedia(appUrl, local) {
  if (e('STORAGE_DRIVER', 'local') === 's3') return checkBucketMedia();
  if (!e('META_APP_ID') && !e('TIKTOK_CLIENT_KEY')) return;

  let key;
  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    const asset = await db.mediaAsset.findFirst({
      where: { status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { storageKey: true },
    });
    await db.$disconnect();
    key = asset?.storageKey;
  } catch {
    return add(warn('Media reachable', 'could not read an asset to test with.'));
  }
  if (!key) return add(warn('Media reachable', 'no ready media to test with — upload a file first.'));

  const expires = Date.now() + 120_000;
  const token = createHmac('sha256', e('AUTH_SECRET')).update(`${key}:${expires}`).digest('hex');
  const path = `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
  const url = new URL(`${path}?expires=${expires}&token=${token}`, appUrl);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      return add(fail('Media reachable', `signed media URL answered ${response.status}.`));
    }
    add(local
      ? warn('Media reachable', 'signed media URLs work, but only from this machine.',
        'Instagram and TikTok need a public origin; YouTube is fine either way')
      : ok('Media reachable', `${response.headers.get('content-type')} served from ${new URL(appUrl).host}`));
  } catch (error) {
    add(fail('Media reachable', shorten(error), 'Is the tunnel pointing at the running server?'));
  }
}

/**
 * The bucket path, tested the same way: mint the URL the publisher would hand
 * to Instagram and fetch it from here. A presigned S3 URL is reachable from
 * anywhere, which is what lets a locally-running app publish real media without
 * exposing itself.
 */
async function checkBucketMedia() {
  let key;
  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient();
    const asset = await db.mediaAsset.findFirst({
      where: { status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { storageKey: true },
    });
    await db.$disconnect();
    key = asset?.storageKey;
  } catch {
    return add(warn('Media reachable', 'could not read an asset to test with.'));
  }
  if (!key) return add(warn('Media reachable', 'no ready media to test with — upload a file first.'));

  try {
    let url;
    const base = e('S3_PUBLIC_BASE_URL');
    if (base) {
      url = `${base.replace(/\/$/, '')}/${key}`;
    } else {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new S3Client({
        region: e('S3_REGION', 'auto'),
        ...(e('S3_ENDPOINT') ? { endpoint: e('S3_ENDPOINT'), forcePathStyle: true } : {}),
        credentials: {
          accessKeyId: e('S3_ACCESS_KEY_ID'),
          secretAccessKey: e('S3_SECRET_ACCESS_KEY'),
        },
      });
      url = await getSignedUrl(client, new GetObjectCommand({ Bucket: e('S3_BUCKET'), Key: key }), {
        expiresIn: 300,
      });
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    add(response.ok
      ? ok('Media reachable', `${response.headers.get('content-type')} from ${new URL(url).host}${base ? ' (public base)' : ' (presigned)'}`)
      : fail('Media reachable', `the bucket answered ${response.status} for a signed object URL.`,
        'Check S3_BUCKET, the credentials, and that the key exists'));
  } catch (error) {
    add(fail('Media reachable', shorten(error), 'Check S3_ENDPOINT, S3_REGION and the access keys'));
  }
}

function checkMockMode() {
  // The production pass reports this with the right severity; saying it twice
  // in one run just makes the list harder to read.
  if (PRODUCTION) return;
  if (isTrue('MOCK_MODE', true)) {
    add(warn('Mock mode', 'MOCK_MODE=true — new sign-ups skip email verification.',
      'Harmless locally; it does not affect social publishing, which is gated on credentials'));
  }
}

/**
 * The things that are deliberately relaxed for local work and must not stay
 * that way. Each one has been an outage somewhere: a mock provider quietly
 * serving fixtures to paying users, media on a disk that gets recycled, a
 * scheduler nobody ran, a token-encryption key left at its example value.
 */
async function checkProductionShape() {
  if (!PRODUCTION) {
    return add(ok('Production pass', 'not run — use npm run doctor:production'));
  }

  const appUrl = e('APP_URL') || e('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  if (!appUrl.startsWith('https://')) {
    add(fail('Origin', `${appUrl} is not HTTPS.`, 'Set APP_URL to the real domain'));
  } else {
    add(ok('Origin', appUrl));
  }

  if (e('STORAGE_DRIVER', 'local') === 'local') {
    add(prod('Storage', 'STORAGE_DRIVER=local — media lives on one machine\'s disk, unreplicated, and is lost with it.',
      'Use STORAGE_DRIVER="s3" with an R2 or S3 bucket'));
  }
  if (e('AI_PROVIDER', 'mock') === 'mock') {
    add(prod('AI provider', 'AI_PROVIDER=mock — text generations return fixtures.', 'Set AI_PROVIDER="openai"'));
  }
  const imageSetting = e('AI_IMAGE_PROVIDER', 'inherit');
  const imageProvider = imageSetting === 'inherit' ? e('AI_PROVIDER', 'mock') : imageSetting;
  if (imageProvider === 'mock') {
    add(prod('Image provider', 'AI image generation is mocked.', 'Set AI_IMAGE_PROVIDER="openai" or "inherit" with AI_PROVIDER="openai"'));
  }
  if (isTrue('MOCK_MODE', true)) {
    add(prod('Mock mode', 'MOCK_MODE=true — sign-ups skip email verification.', 'Set MOCK_MODE="false"'));
  }

  // Video rendering shells out to ffmpeg for minutes. A serverless request
  // cannot hold that, so something has to run the queue outside one.
  const queue = e('QUEUE_DRIVER', 'in-process');
  if (queue === 'in-process') {
    add(warn('Queue', 'in-process polls Postgres — correct, but it polls, and one slow render occupies a slot.',
      'Move to QUEUE_DRIVER="bullmq" with REDIS_URL once more than one worker runs'));
  } else if (!e('REDIS_URL')) {
    add(fail('Queue', 'QUEUE_DRIVER=bullmq but REDIS_URL is empty.'));
  } else {
    add(ok('Queue', `bullmq via ${safeHost(e('REDIS_URL'))}`));
  }
  if (isTrue('QUEUE_IN_WEB_SERVER', false)) {
    add(prod('Queue placement', 'QUEUE_IN_WEB_SERVER=true — the web server and the worker will race for the same jobs.',
      'Leave it false and run npm run worker:prod as its own process'));
  }

  if (!e('CRON_SECRET')) {
    add(prod('Cron', 'CRON_SECRET is empty — /api/cron/* answers 503 and nothing scheduled ever runs.',
      'Generate one: openssl rand -base64 32'));
  }
  for (const [key, label] of [['AUTH_SECRET', 'Session secret'], ['TOKEN_ENCRYPTION_KEY', 'Token encryption key']]) {
    const value = e(key);
    if (!value || value === 'replace-me' || value.length < 32) {
      add(fail(label, `${key} is missing, too short, or still the example value.`,
        'openssl rand -base64 32 — and note that rotating TOKEN_ENCRYPTION_KEY forces every user to reconnect'));
    } else {
      add(ok(label, 'set'));
    }
  }

  await checkMigrations();
}

async function checkMigrations() {
  try {
    const { stdout } = await run('npx', ['prisma', 'migrate', 'status'], { timeout: 60_000 });
    add(/up to date/i.test(stdout)
      ? ok('Migrations', 'schema up to date')
      : fail('Migrations', 'the database is behind the schema.', 'npx prisma migrate deploy'));
  } catch (error) {
    // migrate status exits non-zero when migrations are pending, which is the
    // finding itself rather than a broken check.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    add(/not yet been applied|pending/i.test(output)
      ? fail('Migrations', 'migrations are pending.', 'npx prisma migrate deploy')
      : fail('Migrations', shorten(error)));
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'configured';
  }
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  const mark = { ok: '  ok  ', warn: ' warn ', fail: ' FAIL ' };
  console.log('');
  for (const result of results) {
    console.log(`${mark[result.level]}${result.name.padEnd(width)}  ${result.detail}`);
    if (result.fix && result.level !== 'ok') console.log(`${' '.repeat(width + 8)}→ ${result.fix}`);
  }
  const failures = results.filter((r) => r.level === 'fail').length;
  const warnings = results.filter((r) => r.level === 'warn').length;
  console.log(`\n${results.length} checks · ${failures} failing · ${warnings} warning\n`);
  process.exit(failures ? 1 : 0);
}

function shorten(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].slice(0, 140);
}

await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => {
  console.error('No .env found. Copy .env.example to .env first.');
  process.exit(1);
});
await main();
