#!/usr/bin/env node
/**
 * Closed-loop check of the image generation path, driven through the real UI.
 *
 * It signs in to a running deployment with a headless browser, types a brief
 * into the AI studio, presses "Generate image", downloads the bytes the page
 * shows, and then confirms the same asset is listed in the Media Library. The
 * loop is only closed when that last step passes: a generation that returns an
 * image but never lands in the library is exactly the regression this exists to
 * catch, and a unit test cannot see it because it never leaves the process.
 *
 * The target is your own deployment — the Vercel URL, a preview, or localhost.
 * It drives Bridge88's own pages and no third-party service.
 *
 * Usage:
 *   E2E_BASE_URL="https://your-app.vercel.app" \
 *   E2E_EMAIL="qa@example.com" E2E_PASSWORD="..." \
 *   npm run test:e2e:image
 *
 * Exits 0 when the image completes the loop, 1 otherwise. Every run writes a
 * report, the downloaded image, and screenshots to E2E_OUT_DIR.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

/**
 * playwright-core ships no browser binaries, which keeps the install small but
 * means the caller has to say which Chrome to drive. These are the usual homes
 * on a developer machine and on the Linux images CI tends to use.
 */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  const configured = process.env.E2E_CHROME;
  if (configured) return configured;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? '';
}

function config() {
  const baseUrl = (process.env.E2E_BASE_URL || '').replace(/\/+$/, '');
  const email = process.env.E2E_EMAIL || '';
  const password = process.env.E2E_PASSWORD || '';
  const chrome = findChrome();

  const missing = [];
  if (!baseUrl) missing.push('E2E_BASE_URL (your deployment, e.g. https://your-app.vercel.app)');
  if (!email) missing.push('E2E_EMAIL');
  if (!password) missing.push('E2E_PASSWORD');
  if (!chrome) missing.push('E2E_CHROME (path to a Chrome or Chromium binary)');
  if (missing.length) {
    throw new Error(`Missing configuration:\n  - ${missing.join('\n  - ')}`);
  }

  return {
    baseUrl,
    email,
    password,
    chrome,
    workspace: process.env.E2E_WORKSPACE || '',
    prompt: process.env.E2E_PROMPT
      || 'A quiet treehouse cafe at golden hour, warm light through the leaves, photographic',
    /** Matches a label in IMAGE_SIZE_PRESETS; blank leaves the page default. */
    shape: process.env.E2E_IMAGE_SHAPE || '',
    headless: process.env.E2E_HEADLESS !== 'false',
    /** Generation is slower than a page load and varies by provider. */
    timeout: Number(process.env.E2E_TIMEOUT_MS || 240_000),
    outDir: path.resolve(process.env.E2E_OUT_DIR || 'e2e-artifacts'),
  };
}

/**
 * The text of the first error banner.
 *
 * Read with a short poll rather than once: the summary mounts and is then
 * focused by an effect, and a read that lands between the two comes back empty
 * — which turns a perfectly clear "Email or password is incorrect" into a
 * failure with no reason attached.
 */
async function alertText(page, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  do {
    const text = await page.locator('[role="alert"]').first().textContent().catch(() => null);
    if (text?.trim()) return text.trim();
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return '';
}

/** Step timings make a slow run diagnosable without re-running it verbosely. */
const steps = [];
async function step(name, work) {
  const startedAt = Date.now();
  process.stdout.write(`→ ${name}\n`);
  try {
    const result = await work();
    const ms = Date.now() - startedAt;
    steps.push({ name, ok: true, ms });
    process.stdout.write(`  ✓ ${name} (${(ms / 1000).toFixed(1)}s)\n`);
    return result;
  } catch (error) {
    const ms = Date.now() - startedAt;
    steps.push({ name, ok: false, ms, error: error instanceof Error ? error.message : String(error) });
    process.stdout.write(`  ✗ ${name} (${(ms / 1000).toFixed(1)}s)\n`);
    throw error;
  }
}

/**
 * Wrong credentials do not navigate — the form action re-renders /login in
 * place with an error — so waiting only for the redirect turns the commonest
 * setup mistake into a full-timeout hang with nothing to read. Racing the
 * redirect against the error banner reports it in about a second instead.
 */
async function signIn(page, cfg) {
  await page.goto(`${cfg.baseUrl}/login?next=/w`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', cfg.email);
  await page.fill('input[name="password"]', cfg.password);

  const landed = page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: cfg.timeout })
    .then(() => 'signed-in');
  // Scoped to the sign-in form on purpose. Bridge88 renders every error
  // StatusMessage as role="alert", and the pages this redirects to have alerts
  // of their own — an unscoped wait races the navigation and reports a
  // successful sign-in as a rejection.
  const rejected = page.locator('form [role="alert"]').first()
    .waitFor({ state: 'visible', timeout: cfg.timeout })
    .then(() => 'rejected');

  await page.click('button[type="submit"]');
  const outcome = await Promise.race([landed, rejected]);

  // Even scoped, the banner can win the race against a redirect that is already
  // in flight, so the URL is the tiebreaker: still on /login means rejected.
  if (outcome === 'rejected') {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 5_000 }).catch(() => {});
    if (new URL(page.url()).pathname.startsWith('/login')) {
      const detail = await alertText(page);
      throw new Error(`Sign-in was rejected.${detail ? ` Page said: ${detail}` : ''}`);
    }
  }
}

/**
 * Whichever workspace the account lands in, unless the caller named one. Tests
 * that hard-code a slug break the first time someone runs them on a fresh
 * database, so discovery is the default and E2E_WORKSPACE is the override.
 */
async function resolveWorkspace(page, cfg) {
  if (cfg.workspace) return cfg.workspace;

  await page.goto(`${cfg.baseUrl}/w`, { waitUntil: 'domcontentloaded' });
  const fromUrl = new URL(page.url()).pathname.match(/^\/w\/([^/]+)/);
  if (fromUrl) return fromUrl[1];

  const href = await page.locator('a[href^="/w/"]').first().getAttribute('href').catch(() => null);
  const fromLink = href?.match(/^\/w\/([^/?#]+)/);
  if (fromLink) return fromLink[1];

  throw new Error('This account has no workspace to generate into. Create one, or set E2E_WORKSPACE.');
}

async function chooseShape(page, label) {
  const dropdown = page.locator('.b88-dropdown', { hasText: 'Image shape' }).first();
  const trigger = dropdown.locator('button[aria-haspopup="listbox"]').first();
  await trigger.click();
  // Options are a custom listbox rather than a <select>, so the choice is a
  // click on the option row, matched on the label the page actually shows.
  await page.locator('[role="option"]', { hasText: label }).first().click();
  await page.locator('[role="listbox"]').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/**
 * The prompt, the click, and the wait for a genuinely new card.
 *
 * Waiting for "a card that was not there before" rather than "a card" is what
 * makes the check meaningful on a workspace that already holds generated
 * assets — the studio lists the previous 25 on load, so any weaker assertion
 * passes without generating anything at all.
 */
async function generate(page, cfg) {
  const cards = page.locator('[data-asset-id]');
  const before = new Set(await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.assetId)));

  await page.fill('#studio-prompt', cfg.prompt);
  if (cfg.shape) await chooseShape(page, cfg.shape);

  // A rejected generation surfaces an error StatusMessage (role="alert") and no
  // new card, so both outcomes are awaited together — otherwise a provider that
  // refuses instantly still costs the full timeout to report.
  const appeared = page.waitForFunction(
    (known) => {
      const found = [...document.querySelectorAll('[data-asset-id]')]
        .map((node) => node.dataset.assetId)
        .find((id) => id && !known.includes(id));
      return found ?? null;
    },
    [...before],
    { timeout: cfg.timeout, polling: 500 },
  ).then((handle) => handle.jsonValue());

  // Counted rather than merely waited for: the studio can already be showing an
  // alert when the run starts, and treating that one as this generation's
  // failure would fail the run before the click had any effect.
  const alertsBefore = await page.locator('[role="alert"]').count();
  const failed = page.waitForFunction(
    (seen) => document.querySelectorAll('[role="alert"]').length > seen,
    alertsBefore,
    { timeout: cfg.timeout, polling: 500 },
  ).then(() => null);

  await page.getByRole('button', { name: /Generate image|Generating image/ }).first().click();
  const newId = await Promise.race([appeared, failed]);

  if (!newId) {
    throw new Error(`The studio reported an error: ${await alertText(page) || 'no detail shown'}`);
  }
  return newId;
}

/**
 * Bytes for the card's image.
 *
 * Fetching inside the page carries the session and handles a blob: or data: src
 * that means nothing outside the tab. The context request is the fallback for a
 * signed storage URL whose CORS policy refuses an in-page read.
 */
async function downloadImage(page, context, assetId) {
  const image = page.locator(`[data-asset-id="${assetId}"] img`).first();
  await image.waitFor({ state: 'visible', timeout: 60_000 });
  // The deadline is inside the page function: Playwright's `timeout` option
  // covers resolving the locator, not the promise the function returns, so an
  // image that fires neither load nor error would hang the run indefinitely.
  await image.evaluate(
    (el, ms) => new Promise((resolve, reject) => {
      if (el.complete && el.naturalWidth > 0) return resolve();
      const timer = setTimeout(() => reject(new Error('the generated image did not finish loading in time')), ms);
      const settle = (finish) => () => { clearTimeout(timer); finish(); };
      el.addEventListener('load', settle(resolve), { once: true });
      el.addEventListener('error', settle(() => reject(new Error('the generated image failed to load'))), { once: true });
    }),
    60_000,
    { timeout: 65_000 },
  );

  const src = await image.getAttribute('src');
  if (!src) throw new Error('The generated card has an image with no src.');

  const inPage = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('could not read the image blob'));
      reader.readAsDataURL(blob);
    });
  }, src).catch(() => null);

  if (inPage) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(inPage);
    if (match) {
      const [, mimeType, base64, payload] = match;
      return {
        buffer: base64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
        mimeType: mimeType || 'image/png',
      };
    }
  }

  const response = await context.request.get(new URL(src, page.url()).toString());
  if (!response.ok()) throw new Error(`Could not download the generated image (HTTP ${response.status()}).`);
  return {
    buffer: Buffer.from(await response.body()),
    mimeType: response.headers()['content-type']?.split(';')[0] || 'image/png',
  };
}

/**
 * The half of the loop that a generation test usually skips: the asset is only
 * real once the Media Library lists it. Uploads and derivatives land as
 * PROCESSING and are finished by the worker, so a status that is not yet READY
 * is polled rather than failed.
 */
async function confirmInLibrary(page, cfg, slug, assetId) {
  const deadline = Date.now() + cfg.timeout;
  const card = page.locator(`[data-asset-id="${assetId}"]`);

  for (let attempt = 1; ; attempt += 1) {
    await page.goto(`${cfg.baseUrl}/w/${slug}/media`, { waitUntil: 'domcontentloaded' });
    const present = await card.first().waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false);

    if (present) {
      const status = await card.first().getAttribute('data-asset-status');
      if (status === 'READY') return { status, attempts: attempt };
      if (status === 'FAILED') throw new Error('The asset reached the Media Library but its status is FAILED.');
      process.stdout.write(`    library status ${status}; waiting\n`);
    } else {
      process.stdout.write('    not listed yet; waiting\n');
    }

    if (Date.now() > deadline) {
      throw new Error(
        present
          ? 'The asset never became READY in the Media Library before the timeout.'
          : 'The generated asset never appeared in the Media Library. The generation succeeded but the loop is open.',
      );
    }
    await page.waitForTimeout(5_000);
  }
}

async function main() {
  const cfg = config();
  await mkdir(cfg.outDir, { recursive: true });

  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  process.stdout.write(`\nClosed-loop image generation check\n  target ${cfg.baseUrl}\n  output ${cfg.outDir}\n\n`);

  const browser = await chromium.launch({ executablePath: cfg.chrome, headless: cfg.headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(cfg.timeout);
  const page = await context.newPage();

  const report = { startedAt: startedAt.toISOString(), baseUrl: cfg.baseUrl, prompt: cfg.prompt };

  try {
    await step('Sign in', () => signIn(page, cfg));

    const slug = await step('Resolve workspace', () => resolveWorkspace(page, cfg));
    report.workspace = slug;

    await step('Open the AI studio', async () => {
      await page.goto(`${cfg.baseUrl}/w/${slug}/studio`, { waitUntil: 'domcontentloaded' });
      await page.locator('#studio-prompt').waitFor({ state: 'visible' });
      // Worth recording: in demo mode the image is a local fixture, so a pass
      // proves the plumbing rather than the model.
      report.demoMode = await page.getByText('Demo mode is active').count() > 0;
      if (report.demoMode) {
        process.stdout.write('    note: the deployment is in demo mode — results are fixtures, not model output\n');
      }
    });

    const assetId = await step('Generate the image', () => generate(page, cfg));
    report.assetId = assetId;

    const file = await step('Save the image', async () => {
      const { buffer, mimeType } = await downloadImage(page, context, assetId);
      const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
      const target = path.join(cfg.outDir, `${stamp}-${assetId}.${extension}`);
      await writeFile(target, buffer);
      process.stdout.write(`    ${buffer.length} bytes → ${target}\n`);
      return { path: target, bytes: buffer.length, mimeType };
    });
    report.image = file;

    await step('Screenshot the studio', () =>
      page.screenshot({ path: path.join(cfg.outDir, `${stamp}-studio.png`), fullPage: true }));

    const library = await step('Confirm it in the Media Library', () => confirmInLibrary(page, cfg, slug, assetId));
    report.library = library;

    await step('Screenshot the library', () =>
      page.screenshot({ path: path.join(cfg.outDir, `${stamp}-library.png`), fullPage: true }));

    report.ok = true;
    process.stdout.write(`\nPASS — asset ${assetId} generated and listed in the Media Library.\n`);
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
    // The page at the moment of failure is the most useful thing a CI log can
    // hand back, so both are captured before the browser closes.
    await page.screenshot({ path: path.join(cfg.outDir, `${stamp}-failure.png`), fullPage: true }).catch(() => {});
    await writeFile(path.join(cfg.outDir, `${stamp}-failure.html`), await page.content().catch(() => '')).catch(() => {});
    process.stderr.write(`\nFAIL — ${report.error}\n`);
  } finally {
    report.steps = steps;
    report.durationMs = Date.now() - startedAt.getTime();
    await writeFile(path.join(cfg.outDir, `${stamp}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Report: ${path.join(cfg.outDir, `${stamp}-report.json`)}\n`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
