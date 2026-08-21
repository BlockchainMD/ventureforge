/*
 * Responsive audit.
 *
 * Walks every route at a phone viewport and fails on anything that spills past
 * it without being reachable. Content inside a horizontal scroller is fine — a
 * dense comparison table should scroll rather than reflow — and so is
 * `overflow: hidden`, which is how `truncate` ellipses a long value. What this
 * catches is the third case: a control clipped by the viewport with no way to
 * reach it, which is how "Start due diligence" became unreachable on a phone.
 *
 *   pnpm audit:responsive         (needs `pnpm dev` running)
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'analyst@landalpha.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'landalpha-dev';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 120)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard');

// Detail routes need a real id, so take the first one each list offers.
const detailHref = async (listPath) => {
  await page.goto(`${BASE}${listPath}`, { waitUntil: 'networkidle' });
  return page
    .locator('tbody a')
    .first()
    .getAttribute('href')
    .catch(() => null);
};

const routes = [
  '/dashboard',
  '/opportunities',
  '/map',
  '/watchlists',
  '/deals',
  '/portfolio',
  '/leads',
  '/sources',
  '/ingestion',
  '/settings',
  '/admin/scoring',
  '/admin/calibration',
  '/allocate',
  '/properties',
  await detailHref('/opportunities'),
  await detailHref('/sources'),
].filter(Boolean);

let failures = 0;
for (const path of routes) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= doc.clientWidth + 1) continue;
      let parent = el.parentElement;
      let contained = false;
      while (parent) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
          contained = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!contained) clipped.push(`${el.tagName}.${String(el.className).slice(0, 50)}`);
    }
    return { pageScrolls: doc.scrollWidth > doc.clientWidth + 1, clipped: clipped.slice(0, 3) };
  });

  const ok = !result.pageScrolls && result.clipped.length === 0;
  if (!ok) failures += 1;
  const detail = [
    result.pageScrolls ? 'page scrolls horizontally' : '',
    result.clipped.length ? `clipped: ${result.clipped.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path}${detail ? ` — ${detail}` : ''}`);
}

console.log(`\n${routes.length - failures}/${routes.length} routes clean at 390px.`);
if (pageErrors.length > 0) console.log('page errors:', pageErrors);

await browser.close();
process.exit(failures === 0 && pageErrors.length === 0 ? 0 : 1);
