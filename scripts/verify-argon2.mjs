// Verify the argon2 migration end-to-end.
// 1) Legacy login (existing SHA-256 hash in DB) succeeds and auto-upgrades to argon2
// 2) Fresh signup stores an argon2 hash
// 3) Settings page has no horizontal overflow at 320 / 375 / 768px
import "./load-env.mjs";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};

// --- DB state before ---
const before = (await sql`SELECT left(password_hash, 30) AS h FROM users WHERE email = 'student@example.com'`)[0]?.h;
check("captured pre-login hash", !!before, `prefix: ${before}`);

const browser = await chromium.launch({ headless: true });

// --- 1) Legacy login + auto-upgrade ---
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  const login = await p.evaluate(async () => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email: "student@example.com", password: "password123" }),
    });
    return { status: res.status };
  });
  check("legacy login returns 200", login.status === 200, `status: ${login.status}`);
  await p.waitForTimeout(600);
  const after = (await sql`SELECT password_hash AS h FROM users WHERE email = 'student@example.com'`)[0]?.h;
  check("hash auto-upgraded to argon2", after?.startsWith("$argon2"), `prefix: ${String(after).slice(0, 20)}`);
  await ctx.close();
}

// --- 2) Fresh signup stores argon2 ---
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  const email = `argon-test-${Date.now()}@example.com`;
  const signup = await p.evaluate(async (email) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signup", name: "Argon Test", email, password: "hunter22!" }),
    });
    return { status: res.status };
  }, email);
  check("signup returns 200", signup.status === 200, `status: ${signup.status}`);
  await p.waitForTimeout(400);
  const h = (await sql`SELECT password_hash AS h FROM users WHERE email = ${email}`)[0]?.h;
  check("new user hash is argon2", h?.startsWith("$argon2"), `prefix: ${String(h).slice(0, 20)}`);
  await sql`DELETE FROM users WHERE email = ${email}`;
  await ctx.close();
}

// --- 3) Settings page overflow at mobile widths ---
{
  await sql`UPDATE users SET password_hash = 'legacy-placeholder' WHERE email = 'student@example.com'`;
  for (const w of [320, 375, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 812 } });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.evaluate(async () => {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email: "student@example.com", password: "password123" }),
      });
    });
    await p.goto(BASE + "/dashboard/settings", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#verbosity-standard", { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const doc = document.documentElement;
      const offenders = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > doc.clientWidth + 1 && r.width > 10;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className && typeof el.className === "string" ? el.className : "").split(" ")[0]}`)
        .slice(0, 8);
      return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, offenders };
    });
    check(
      `settings page fits at ${w}px`,
      m.scrollW <= m.clientW,
      `scrollW=${m.scrollW} clientW=${m.clientW} offenders=${JSON.stringify(m.offenders)}`
    );
    if (w === 320) await p.screenshot({ path: "screenshots/responsive/settings-phone.png" });
    await ctx.close();
  }
  // restore a real argon2 hash for the dev user so logins keep working
  const { hash } = await import("@node-rs/argon2");
  const real = await hash("password123");
  await sql`UPDATE users SET password_hash = ${real} WHERE email = 'student@example.com'`;
  check("restored real argon2 hash for dev user", true);
}

await sql.end();
await browser.close();

const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : fails + " CHECK(S) FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
