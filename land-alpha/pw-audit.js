const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  await p.goto('http://localhost:3000/login');
  await p.fill('input[type=email]', 'analyst@landalpha.local');
  await p.fill('input[type=password]', 'landalpha-dev');
  await p.click('button[type=submit]');
  await p.waitForLoadState('networkidle');
  await p.goto('http://localhost:3000/dashboard');
  await p.waitForLoadState('networkidle');
  const dash = await p.evaluate(() => {
    const t = document.querySelectorAll('table');
    return Array.from(t).map(tb => tb.innerText.split('\n').slice(0,14).join(' | ')).join('\n---\n');
  });
  console.log('DASHBOARD:\n', dash.slice(0, 3000));
  await p.goto('http://localhost:3000/opportunities?sort=alphaScore&direction=desc');
  await p.waitForLoadState('networkidle');
  const rows = await p.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr')).slice(0,8);
    return trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => {
      const sp = td.querySelector('span');
      const cls = sp ? sp.className : '';
      return td.innerText.trim() + (cls.includes('bad') ? '[RED]' : cls.includes('good') ? '[GREEN]' : cls.includes('alpha') ? '[ALPHA]' : '');
    }).join(' | ')).join('\n');
  });
  console.log('OPPS:\n', rows);
  await b.close();
})();
