/**
 * End-to-end smoke test.
 *
 * Drives the real application in a real browser: signs in, walks every MVP
 * route, and fails on any console error, page error, or non-200 navigation.
 * This is what "verify application functionality" means — a typecheck cannot
 * tell you a server component threw on a null.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SMOKE_SHOT_DIR ?? '/tmp/land-alpha-shots';
mkdirSync(SHOTS, { recursive: true });

const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/dashboard',
      '/opportunities',
      '/map',
      '/sources',
      '/ingestion',
      '/watchlists',
      '/deals',
      '/portfolio',
      '/leads',
      '/settings',
      '/admin/scoring',
    ];

const browser = await chromium.launch({ executablePath:
    process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console: ${msg.text().slice(0, 300)}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${String(error).slice(0, 300)}`));

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

console.log('→ signing in');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await shot('00-login');
await page.fill('input[name="email"]', 'analyst@landalpha.local');
await page.fill('input[name="password"]', 'landalpha-dev');
await Promise.all([
  page.waitForURL('**/dashboard', { timeout: 30_000 }),
  page.click('button[type="submit"]'),
]);
console.log('  signed in, landed on', page.url());

let failures = 0;
for (const [index, route] of ROUTES.entries()) {
  const before = problems.length;
  const response = await page.goto(`${BASE}${route}`, {
    waitUntil: 'networkidle',
    timeout: 45_000,
  });
  const status = response?.status() ?? 0;
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const looksBroken =
    status >= 400 ||
    /Application error|Unhandled Runtime Error|This page could not be found/i.test(bodyText);
  const newProblems = problems.slice(before);

  if (looksBroken || newProblems.length > 0) {
    failures += 1;
    console.log(`✗ ${route}  [${status}]`);
    for (const problem of newProblems.slice(0, 3)) console.log(`    ${problem}`);
    if (looksBroken) console.log(`    body: ${bodyText.slice(0, 220).replace(/\s+/g, ' ')}`);
  } else {
    console.log(`✓ ${route}  [${status}]`);
  }
  await shot(`${String(index + 1).padStart(2, '0')}-${route.replace(/\//g, '_') || 'root'}`);
}

// Deep-link into the highest-scoring parcel: the detail page carries most of
// the rendering risk, so it is asserted explicitly rather than by clicking and
// hoping the navigation happened.
await page.goto(`${BASE}/opportunities`, { waitUntil: 'networkidle' });
const hrefs = await page.$$eval('a[href]', (links) =>
  links
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => /^\/opportunities\/[0-9a-f-]{8,}/.test(href)),
);

if (hrefs.length === 0) {
  console.log('✗ parcel detail — no parcel links found on /opportunities');
  failures += 1;
} else {
  const target = hrefs[0];
  const before = problems.length;
  const response = await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle', timeout: 45_000 });
  const status = response?.status() ?? 0;
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const newProblems = problems.slice(before);

  // The detail page must actually render underwriting content, not just 200.
  const rendered =
    /Land Alpha/i.test(bodyText) &&
    /Quick sale value/i.test(bodyText) &&
    /Access/i.test(bodyText);

  if (status !== 200 || newProblems.length > 0 || !rendered) {
    failures += 1;
    console.log(`✗ parcel detail ${target} [${status}] rendered=${rendered}`);
    for (const problem of newProblems.slice(0, 5)) console.log(`    ${problem}`);
    if (!rendered) console.log(`    body: ${bodyText.slice(0, 300).replace(/\s+/g, ' ')}`);
  } else {
    console.log(`✓ parcel detail ${target} [${status}]`);
  }
  await shot('99-parcel-detail');
}

await browser.close();
console.log(failures === 0 ? '\nAll routes healthy.' : `\n${failures} route(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
