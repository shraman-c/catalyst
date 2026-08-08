import './load-env.mjs';
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import postgres from 'postgres';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = 'screenshots/graph-redesign';

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  // Grab the newest test subject (Biology 102 large graph)
  const subjects = await sql`SELECT id, name FROM subjects ORDER BY created_at DESC LIMIT 1`;
  const subjectId = subjects[0]?.id;
  if (!subjectId) {
    console.error('No subject found. Run: node scripts/seed-large-graph.mjs');
    process.exit(1);
  }
  console.log(`Subject: ${subjects[0].name} (${subjectId})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console.error]', msg.text()); });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  // Navigate to the app first so relative fetch works
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Log in via the API from the page context
  const loginResult = await page.evaluate(async () => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: 'student@example.com', password: 'password123' }),
    });
    return { status: res.status, data: await res.json() };
  });
  console.log(`Login: ${loginResult.status}`);
  if (loginResult.status !== 200) {
    console.log('Login failed:', JSON.stringify(loginResult.data));
    process.exit(1);
  }

  const graphUrl = `${BASE_URL}/dashboard/subjects/${subjectId}/graph`;
  console.log(`Opening graph: ${graphUrl}`);

  // Turn OFF auto-clustering so the shots show the full constellation of dots
  // (the acceptance criterion: sparse dots + hub labels at default zoom).
  await page.goto(graphUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  const groupBtn = page.locator('button:has-text("SHOWING GROUPS")');
  if (await groupBtn.count()) {
    await groupBtn.click();
    console.log('Disabled clustering for full constellation view');
  }
  await page.waitForTimeout(2000);

  // 1) DEFAULT — wait for the sim to settle so hub labels appear
  await page.waitForTimeout(5000); // let warmup + cooldown run
  await page.screenshot({ path: `${OUTPUT_DIR}/01-default.png` });
  console.log('✅ 01-default.png');

  // 2) ZOOM IN — scroll up over the canvas center to reveal more labels
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUTPUT_DIR}/02-zoomed.png` });
    console.log('✅ 02-zoomed.png');
  } else {
    console.log('❌ canvas not found for zoom shot');
  }

  // 3) SEARCH HIGHLIGHT — matches ring + labeled, everything else dims
  const searchInput = page.locator('input[placeholder*="HIGHLIGHT"]').first();
  await searchInput.fill('atp');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUTPUT_DIR}/03-search-atp.png` });
  console.log('✅ 03-search-atp.png');
  await searchInput.fill('');

  // 4) HOVER — mouse over the canvas center; neighborhood brightens, rest dims
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUTPUT_DIR}/04-hover.png` });
  console.log('✅ 04-hover.png');
  // Nudge the mouse away to clear hover
  await page.mouse.move(5, 5);

  // 5) RELOAD and capture the settled default again (fresh state for reference)
  await page.goto(graphUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUTPUT_DIR}/05-default-full.png`, fullPage: true });
  console.log('✅ 05-default-full.png');

  await browser.close();
  await sql.end();
  console.log(`\nDone! Screenshots in ./${OUTPUT_DIR}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
