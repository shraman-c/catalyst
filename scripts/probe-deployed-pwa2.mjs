import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
await p.goto('https://catalyst-jet.vercel.app/', { waitUntil: 'networkidle', timeout: 60000 });
// wait for SW to be fully active & controlling
await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2000);

// Hard reload / while SW is FULLY active
await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(1500);
let r = await p.evaluate(() => ({ title: document.title, offline: document.body.innerText.toUpperCase().includes('OFFLINE') }));
console.log('RELOAD / (SW fully active):', JSON.stringify(r));

// Full navigation to /dashboard
await p.goto('https://catalyst-jet.vercel.app/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(1500);
r = await p.evaluate(() => ({ title: document.title, offline: document.body.innerText.toUpperCase().includes('OFFLINE') }));
console.log('GOTO /dashboard (SW fully active):', JSON.stringify(r));

// Now OFFLINE — what happens?
await ctx.setOffline(true);
await p.goto('https://catalyst-jet.vercel.app/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('offline goto err:', e.message.slice(0, 80)));
await p.waitForTimeout(1500);
r = await p.evaluate(() => ({ title: document.title, offline: document.body.innerText.toUpperCase().includes('OFFLINE') })).catch(e => ({ err: e.message.slice(0,80) }));
console.log('OFFLINE goto /dashboard:', JSON.stringify(r));
await ctx.setOffline(false);
await b.close();
