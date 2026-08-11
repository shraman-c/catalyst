import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const logs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 180)}`); });

// 1) First visit — register + install + activate the SW
await p.goto('https://catalyst-jet.vercel.app/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(3000);
const swState1 = await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return regs.map(r => ({
    scope: r.scope,
    active: !!r.active,
    installing: !!r.installing,
    waiting: !!r.waiting,
    controller: !!navigator.serviceWorker.controller,
    swUrl: r.active ? r.active.scriptURL : (r.installing ? r.installing.scriptURL : null),
  }));
});
console.log('SW registrations after first visit:', JSON.stringify(swState1));

// 2) Hard reload — is the page served by the SW controller, and WHAT html?
await p.reload({ waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2000);
const result = await p.evaluate(async () => {
  const title = document.title;
  const isOffline = document.body && document.body.innerHTML.includes('YOU') && document.body.innerText.includes('OFFLINE');
  const hasController = !!navigator.serviceWorker.controller;
  // What did the SW actually serve? check for app markers
  const htmlSnippet = document.documentElement.outerHTML.slice(0, 300);
  return { title, isOffline, hasController, htmlSnippet };
});
console.log('After reload:', JSON.stringify(result, null, 2));

// 3) Navigate to /dashboard (client nav) and to a deep route (full page nav)
await p.goto('https://catalyst-jet.vercel.app/dashboard', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(2500);
const dash = await p.evaluate(() => {
  const t = document.title;
  const bodyText = document.body ? document.body.innerText.slice(0, 120) : '';
  return { t, bodyText, isOffline: bodyText.toUpperCase().includes('OFFLINE') };
});
console.log('After /dashboard nav:', JSON.stringify(dash));

console.log('Console errors/warnings:', JSON.stringify(logs, null, 2));
await b.close();
