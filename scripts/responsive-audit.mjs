import './load-env.mjs';
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = 'screenshots/responsive';

const sql = postgres(process.env.DATABASE_URL);

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
];

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  const subjects = await sql`SELECT id FROM subjects LIMIT 1`;
  const subjectId = subjects[0]?.id;
  if (!subjectId) {
    console.error('No subject found. Run scripts/seed-large-graph.mjs first.');
    process.exit(1);
  }
  const notes = await sql`SELECT id FROM note_files LIMIT 1`;
  const noteId = notes[0]?.id;

  const routes = [
    { path: '/', name: 'landing' },
    { path: '/dashboard', name: 'dashboard' },
    { path: `/dashboard/subjects/${subjectId}`, name: 'subject' },
    { path: `/dashboard/subjects/${subjectId}/graph`, name: 'graph' },
    { path: `/dashboard/subjects/${subjectId}/notes`, name: 'notes' },
    ...(noteId ? [{ path: `/dashboard/subjects/${subjectId}/notes/${noteId}`, name: 'note-detail' }] : []),
    { path: `/dashboard/subjects/${subjectId}/review`, name: 'review' },
  ];

  const browser = await chromium.launch({ headless: true });

  // Login once in a shared context
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  const login = await page.evaluate(async () => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: 'student@example.com', password: 'password123' }),
    });
    return { status: res.status };
  });
  console.log(`Login: ${login.status}`);
  // Persist the session cookie into per-viewport contexts
  const cookies = await ctx.cookies();
  await ctx.close();

  let failures = 0;

  for (const vp of VIEWPORTS) {
    const vpCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await vpCtx.addCookies(cookies);
    const p = await vpCtx.newPage();

    for (const route of routes) {
      const url = `${BASE_URL}${route.path}`;
      const results = [];
      try {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await p.waitForTimeout(1400);
        const m = await p.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollW = Math.max(doc.scrollWidth, body?.scrollWidth || 0, doc.clientWidth);
          const innerW = window.innerWidth;
          // Elements sticking out past the right edge
          const offenders = [...document.querySelectorAll('body *')]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > innerW + 2 && getComputedStyle(el).position !== 'fixed';
            })
            .slice(0, 5)
            .map((el) => {
              const r = el.getBoundingClientRect();
              const cls = (el.className && typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 2).join('.');
              return `${el.tagName.toLowerCase()}.${cls} right=${Math.round(r.right)} w=${Math.round(r.width)}`;
            });
          return { scrollW, innerW, overflow: scrollW > innerW + 2, offenders };
        });
        const ok = !m.overflow;
        if (!ok) failures++;
        const flag = ok ? '✅' : '❌ OVERFLOW';
        console.log(
          `${flag} [${vp.name.padEnd(6)}] ${route.name.padEnd(12)} scrollW=${m.scrollW} innerW=${m.innerW}` +
            (m.offenders.length ? `  ← ${m.offenders.join(' | ')}` : '')
        );
        results.push(m);
      } catch (err) {
        failures++;
        console.log(`⚠️  [${vp.name.padEnd(6)}] ${route.name.padEnd(12)} ERROR: ${err.message.split('\n')[0]}`);
        results.push(null);
      }

      // Screenshots only at the phone viewport
      if (vp.name === 'phone' && results[0]) {
        const fp = `${OUTPUT_DIR}/${route.name}-phone.png`;
        try {
          await p.screenshot({ path: fp, fullPage: true });
          console.log(`     📸 ${fp}`);
        } catch { /* ignore */ }
      }
    }
    await vpCtx.close();
  }

  await browser.close();
  await sql.end();
  console.log(`\n${failures === 0 ? 'ALL CLEAN — no horizontal overflow anywhere.' : `${failures} overflow/error case(s) found.`}`);
}

main();
