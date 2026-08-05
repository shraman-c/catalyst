import './load-env.mjs';
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = 'screenshots';

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  // Get the subject ID from the database
  const subjects = await sql`SELECT id FROM subjects LIMIT 1`;
  const subjectId = subjects[0]?.id;
  if (!subjectId) {
    console.error('No subject found in database. Run seed script or create a subject first.');
    process.exit(1);
  }

  // Get a note ID for the note detail page
  const notes = await sql`SELECT id FROM note_files LIMIT 1`;
  const noteId = notes[0]?.id;

  console.log(`Subject ID: ${subjectId}`);
  console.log(`Note ID: ${noteId}\n`);

  const routes = [
    { path: '/', name: '01-landing' },
    { path: '/dashboard', name: '02-dashboard' },
    { path: `/dashboard/subjects/${subjectId}`, name: '03-subject' },
    { path: `/dashboard/subjects/${subjectId}/graph`, name: '04-graph' },
    { path: `/dashboard/subjects/${subjectId}/notes`, name: '05-notes' },
    ...(noteId ? [{ path: `/dashboard/subjects/${subjectId}/notes/${noteId}`, name: '06-note-detail' }] : []),
    { path: `/dashboard/subjects/${subjectId}/review`, name: '07-review' },
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Step 1: Navigate to the app first so fetch can resolve relative URLs
  console.log('Navigating to app...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Step 2: Log in via the API from the page context
  console.log('Logging in...');
  const loginResult = await page.evaluate(async () => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: 'student@example.com', password: 'password123' }),
    });
    return { status: res.status, data: await res.json() };
  });

  console.log(`Login status: ${loginResult.status}`);
  console.log(`Login response: ${JSON.stringify(loginResult.data)}\n`);

  // Step 3: Take screenshots of all pages
  console.log('Taking screenshots...\n');

  for (const route of routes) {
    const url = `${BASE_URL}${route.path}`;
    const filepath = `${OUTPUT_DIR}/${route.name}.png`;

    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });

      // Wait for client-side rendering
      await page.waitForTimeout(800);

      const status = response?.status() ?? 'unknown';
      await page.screenshot({ path: filepath, fullPage: true });

      console.log(`✅ ${route.name.padEnd(20)} ${route.path.substring(0, 60).padEnd(62)} → (${status})`);
    } catch (err) {
      console.error(`❌ ${route.name.padEnd(20)} ${route.path.substring(0, 60).padEnd(62)} → ERROR: ${err.message}`);
    }
  }

  await browser.close();
  await sql.end();
  console.log(`\nDone! Screenshots saved to ./${OUTPUT_DIR}/`);
}

main();
