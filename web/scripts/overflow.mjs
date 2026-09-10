// Reports the elements responsible for horizontal overflow on a route.
// Usage: node scripts/overflow.mjs <route> [width]
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const route = process.argv[2] ?? '/';
const width = Number(process.argv[3] ?? 390);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });

if (route.startsWith('/w') || route.startsWith('/account') || route.startsWith('/admin')) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="email"]', 'demo@bridge88.local');
  await page.type('input[name="password"]', 'demo-password');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
}

await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2' });
const offenders = await page.evaluate((viewportWidth) => {
  const results = [];
  for (const el of document.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.right <= viewportWidth + 1) continue;
    if (!rect.width) continue;
    // Only report the innermost offenders; a wide child inflates its parents.
    const childOverflows = Array.from(el.children).some((child) => child.getBoundingClientRect().right > viewportWidth + 1);
    if (childOverflows) continue;
    results.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 110),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50),
    });
  }
  return results;
}, width);

console.log(`${route} @${width}px — ${offenders.length} innermost offenders`);
for (const o of offenders) console.log(`  <${o.tag} class="${o.cls}"> right=${o.right} w=${o.width} :: ${o.text}`);

await browser.close();
