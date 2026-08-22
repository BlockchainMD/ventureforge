import { chromium } from 'playwright';
const PID = '5cc07b00-0aa6-49e6-950f-9dcd2374b974';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1400 } });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await p.fill('input[type=email]', 'analyst@landalpha.local');
await p.fill('input[type=password]', 'landalpha-dev');
await p.click('button[type=submit]');
await p.waitForURL(/dashboard/, { timeout: 30000 }).catch(()=>{});

await p.goto(`http://localhost:3000/opportunities/${PID}`, { waitUntil: 'networkidle' });
const t = await p.locator('body').innerText();
// print the max bid region
const i = t.indexOf('Approve maximum bid');
console.log('=== max bid region ===');
console.log(t.slice(Math.max(0,i-900), i+600));
const inp = p.locator('input[type=number]').filter({ hasNot: p.locator('x') });
// find the max bid input by label
const mb = p.locator('label:has-text("Approve maximum bid") input');
console.log('input value:', await mb.inputValue());
await mb.fill('9000');
await p.getByRole('button', { name: 'Record approval' }).click();
await p.waitForTimeout(4000);
const t2 = await p.locator('body').innerText();
const j = t2.indexOf('Approve maximum bid');
console.log('=== after approval ===');
console.log(t2.slice(Math.max(0,j-300), j+700));
await b.close();
