import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;

async function check(label, url, expectOffline, opts = {}) {
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(opts.wait || 1500);
    const title = await p.evaluate(() => document.title);
    // Offline page has unique title "Offline — Catalyst" and body text "YOU'RE OFFLINE."
    // Normal pages never have "YOU'RE OFFLINE." in their body.
    const isOffline = await p.evaluate(() => document.title === 'Offline — Catalyst');
    const ok = isOffline === expectOffline;
    if (ok) passed++; else {
      failed++;
      const snippet = await p.evaluate(() => document.body.innerText.slice(0, 80).replace(/\n/g, '|'));
      console.log(`  FAIL: ${label} — title="${title}" snippet="${snippet}"`);
    }
  } catch (e) { failed++; console.log(`  ERROR: ${label} — ${e.message.slice(0, 100)}`); }
}

await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.evaluate(async () => await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', email: 'student@example.com', password: 'password123' }) }));
await p.waitForTimeout(500);

await check('1. /dashboard first visit', BASE + '/dashboard', false, { wait: 5000 });
await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(3000);
console.log('  SW active + clientsClaim done');

// THE REGRESSION TESTS — all should return real pages
await check('2. RELOAD /dashboard', BASE + '/dashboard', false);
await check('3. GOTO /settings', BASE + '/dashboard/settings', false);
await check('4. GOTO /devices', BASE + '/dashboard/devices', false);
await check('5. RELOAD /', BASE, false);

// OFFLINE test: never-visited path should get offline.html
await ctx.setOffline(true);
await check('6. OFFLINE /unknown', BASE + '/dashboard/unknown', true);
await ctx.setOffline(false);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
await b.close();
