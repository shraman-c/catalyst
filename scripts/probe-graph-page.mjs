// Probe the live graph page to see exactly what's rendered:
// DOM structure, canvas elements, and actual canvas pixel content.
import './load-env.mjs';
import { chromium } from 'playwright';
import postgres from 'postgres';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const sql = postgres(process.env.DATABASE_URL);

const subjects = await sql`SELECT id, name FROM subjects ORDER BY created_at DESC LIMIT 1`;
const subjectId = subjects[0].id;
console.log('Subject:', subjects[0].name);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 200)); });

await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(async () => {
  await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', email: 'student@example.com', password: 'password123' }),
  });
});

await page.goto(`${BASE_URL}/dashboard/subjects/${subjectId}/graph`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('canvas')].map(c => ({
    w: c.width, h: c.height,
    styleW: c.style.width, styleH: c.style.height,
  }));
  // Sample the first canvas's actual pixel content via its own 2d context
  let canvasInfo = null;
  const c = document.querySelector('canvas');
  if (c) {
    const ctx = c.getContext('2d');
    if (ctx) {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0, light = 0, colored = 0;
      const colors = new Map();
      for (let i = 0; i < d.length; i += 16) { // sample every 4th pixel
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a < 200) continue;
        if (r < 40 && g < 40 && b < 40) { dark++; continue; }
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn >= 25 && mx >= 90) colored++;
        else light++;
        const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
        colors.set(key, (colors.get(key) || 0) + 1);
      }
      const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      canvasInfo = {
        dark, light, colored,
        topColors: top.map(([k, v]) => k + '(' + v + ')').join(' '),
        backgroundColor: getComputedStyle(c.parentElement).backgroundColor,
      };
    }
  }
  return { canvases, canvasInfo, bodyBg: getComputedStyle(document.body).backgroundColor };
});

console.log(JSON.stringify(info, null, 2));

// Also check the graph-container computed background
const bg = await page.evaluate(() => {
  const el = document.querySelector('.graph-container');
  return el ? { bg: getComputedStyle(el).backgroundColor, h: el.clientHeight, w: el.clientWidth } : null;
});
console.log('graph-container:', JSON.stringify(bg));

await browser.close();
await sql.end();
