// Captures full-page screenshots of every route for visual review.
// Usage: node scripts/shots.mjs <out-dir>
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@bridge88.local';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password';
const SLUG = process.env.DEMO_SLUG ?? 'northwind-studio';
const outDir = process.argv[2] ?? '/tmp/b88-shots';

const PUBLIC_ROUTES = ['/', '/pricing', '/login', '/signup', '/forgot-password'];
const APP_ROUTES = [
  '/w',
  '/w/new',
  `/w/${SLUG}`,
  `/w/${SLUG}/calendar`,
  `/w/${SLUG}/queue`,
  `/w/${SLUG}/compose`,
  `/w/${SLUG}/assistant`,
  `/w/${SLUG}/studio`,
  `/w/${SLUG}/media`,
  `/w/${SLUG}/analytics`,
  `/w/${SLUG}/campaigns`,
  `/w/${SLUG}/channels`,
  `/w/${SLUG}/channels/select`,
  `/w/${SLUG}/team`,
  `/w/${SLUG}/settings`,
  `/w/${SLUG}/settings/billing`,
  `/w/${SLUG}/search`,
  `/w/${SLUG}/notifications`,
  '/account',
  '/admin',
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
];

const problems = [];

function slugify(route) {
  return route.replace(new RegExp(SLUG, 'g'), 'ws').replace(/^\//, '').replace(/\//g, '_') || 'home';
}

async function audit(page, route, viewport) {
  // Flags layout defects that are hard to eyeball: unstyled controls, inline
  // labels that swallow vertical margin, and content wider than the viewport.
  return page.evaluate((ctx) => {
    const found = [];
    for (const el of document.querySelectorAll('input,textarea,select')) {
      const type = el.getAttribute('type');
      if (type === 'checkbox' || type === 'radio' || type === 'hidden') continue;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      // A rendered native file input shows the browser's own "Choose File" button,
      // which never matches the styled uploader. Wearing a b88 class does not make
      // it consistent, so this runs before the size filters. Inputs hidden behind a
      // styled dropzone are sr-only (clipped to 1px) and are the correct pattern.
      if (type === 'file' && rect.width > 24 && rect.height > 12 && style.visibility !== 'hidden') {
        found.push(`native file input name=${el.getAttribute('name')} — use the MediaUploader dropzone`);
      }

      if (!rect.width && !rect.height) continue;
      if (style.borderBottomStyle === 'none' && !el.className.includes('b88')) {
        found.push(`unstyled control <${el.tagName.toLowerCase()} name=${el.getAttribute('name')}>`);
      }
      if (rect.width > 0 && rect.width < 200 && el.tagName === 'TEXTAREA') {
        found.push(`narrow textarea name=${el.getAttribute('name')} width=${Math.round(rect.width)}`);
      }
    }
    for (const label of document.querySelectorAll('label')) {
      if (!label.querySelector(':scope > .b88-label')) continue;
      if (getComputedStyle(label).display === 'inline') {
        found.push(`inline <label> eats margin: "${label.textContent.trim().slice(0, 32)}"`);
      }
    }
    const docWidth = document.documentElement.scrollWidth;
    if (docWidth > ctx.width + 1) found.push(`horizontal overflow: ${docWidth}px > ${ctx.width}px`);
    return found;
  }, { width: viewport.width });
}

async function shoot(page, route, viewport) {
  const url = `${BASE}${route}`;
  const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch((error) => {
    problems.push({ route, viewport: viewport.name, issues: [`navigation failed: ${error.message}`] });
    return null;
  });
  if (!response) return;
  const status = response.status();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const file = `${outDir}/${viewport.name}__${slugify(route)}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const issues = await audit(page, route, viewport);
  if (status >= 400) issues.unshift(`HTTP ${status}`);
  if (issues.length) problems.push({ route, viewport: viewport.name, issues });
  console.log(`${viewport.name} ${route} ${status}${issues.length ? ` :: ${issues.join(' | ')}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
});

await mkdir(outDir, { recursive: true });

for (const viewport of VIEWPORTS) {
  // A fresh context per viewport keeps the signed-out routes actually signed out.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: viewport.isMobile, hasTouch: viewport.isMobile });

  for (const route of PUBLIC_ROUTES) await shoot(page, route, viewport);

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="email"]', EMAIL);
  await page.type('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (page.url().includes('/login')) {
    problems.push({ route: '/login', viewport: viewport.name, issues: ['login did not redirect'] });
  }

  for (const route of APP_ROUTES) await shoot(page, route, viewport);
  await page.close();
  await context.close();
}

await browser.close();
await writeFile(`${outDir}/report.json`, JSON.stringify(problems, null, 2));
console.log(`\n${problems.length} route/viewport combos with issues`);
for (const problem of problems) console.log(`- ${problem.viewport} ${problem.route}: ${problem.issues.join(' | ')}`);
