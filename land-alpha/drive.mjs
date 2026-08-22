import { chromium } from 'playwright';
const PID = '5cc07b00-0aa6-49e6-950f-9dcd2374b974';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 } });
const p = await ctx.newPage();
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERR:', m.text().slice(0,200)); });

await p.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await p.fill('input[type=email]', 'analyst@landalpha.local');
await p.fill('input[type=password]', 'landalpha-dev');
await p.click('button[type=submit]');
await p.waitForURL(/dashboard|opportunities/, { timeout: 30000 }).catch(()=>{});
console.log('LOGGED IN ->', p.url());

await p.goto(`http://localhost:3000/opportunities/${PID}`, { waitUntil: 'networkidle' });
const btn = p.getByRole('button', { name: /Start due diligence|In due diligence/ });
console.log('DD button text:', await btn.first().innerText());
await btn.first().click();
await p.waitForTimeout(4000);
console.log('after click:', (await p.locator('body').innerText()).match(/Deal room[^\n]*/)?.[0]);

await p.goto('http://localhost:3000/deals', { waitUntil: 'networkidle' });
const dealsTxt = await p.locator('body').innerText();
console.log('=== /deals ===');
console.log(dealsTxt.slice(dealsTxt.indexOf('Deal rooms')));
await p.screenshot({ path: '/tmp/shot-deals.png', fullPage: true });
await b.close();
