/**
 * Capture every authenticated UI surface: rendered text, a full-page
 * screenshot, and any console errors.
 *
 * The point is auditing what the operator actually sees. Reading the page
 * components tells you what the UI is supposed to render; this tells you what
 * it rendered against the data currently in the database, which is where the
 * disagreements show up.
 *
 *   pnpm capture:ui              # writes to /tmp/audit
 *   OUT=/somewhere pnpm capture:ui
 *
 * Requires the app running at BASE (default http://localhost:3000) and the
 * seeded analyst account.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? '/tmp/audit';
const BASE = process.env.BASE ?? 'http://localhost:3000';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['/dashboard', 'dashboard'],
  ['/opportunities', 'opportunities'],
  ['/blocked', 'blocked'],
  ['/map', 'map'],
  ['/allocate', 'allocate'],
  ['/deals', 'deals'],
  ['/portfolio', 'portfolio'],
  ['/leads', 'leads'],
  ['/sources', 'sources'],
  ['/ingestion', 'ingestion'],
  ['/ingestion/import', 'ingestion-import'],
  ['/watchlists', 'watchlists'],
  ['/settings', 'settings'],
  ['/admin/scoring', 'admin-scoring'],
  ['/admin/calibration', 'admin-calibration'],
  ['/properties', 'properties'],
];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
const p = await ctx.newPage();
const consoleErrors = [];
p.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await p.goto(BASE + '/login', { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'analyst@landalpha.local');
await p.fill('input[type="password"]', 'landalpha-dev');
await p.click('button[type="submit"]');
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });

const index = [];
for (const [route, name] of ROUTES) {
  const before = consoleErrors.length;
  const resp = await p
    .goto(BASE + route, { waitUntil: 'networkidle' })
    .catch((e) => ({ status: () => 'ERR:' + e.message }));
  await p.waitForTimeout(400);
  const text = await p
    .locator('body')
    .innerText()
    .catch(() => '');
  writeFileSync(`${OUT}/${name}.txt`, text);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
  index.push({
    route,
    name,
    status: resp.status ? resp.status() : '?',
    chars: text.length,
    newConsoleErrors: consoleErrors.slice(before),
  });
  console.log(
    `${route.padEnd(24)} ${String(resp.status ? resp.status() : '?').padEnd(5)} ${text.length}b`,
  );
}

// A parcel detail page — the densest surface in the product.
const first = await p
  .goto(BASE + '/opportunities', { waitUntil: 'networkidle' })
  .then(() => p.locator('table tbody tr a').first().getAttribute('href'))
  .catch(() => null);
if (first) {
  await p.goto(BASE + first, { waitUntil: 'networkidle' });
  const text = await p.locator('body').innerText();
  writeFileSync(`${OUT}/parcel-detail.txt`, text);
  await p.screenshot({ path: `${OUT}/parcel-detail.png`, fullPage: true });
  index.push({
    route: first,
    name: 'parcel-detail',
    status: 200,
    chars: text.length,
    newConsoleErrors: [],
  });
  console.log('parcel detail:', first);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
console.log('console errors total:', consoleErrors.length);
await b.close();
