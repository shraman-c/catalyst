#!/usr/bin/env node
/**
 * One-time backfill for encryption at rest (audit 6.6 / fix 3.3).
 *
 * Encrypts plaintext rows in note_versions.content so pre-existing notes get
 * the same protection as new uploads. Idempotent: rows already prefixed with
 * enc:v1: are skipped. Pass --dry-run to preview without writing.
 *
 * The crypto here must stay in sync with src/lib/encryption.ts (same key
 * derivation, same AES-256-GCM + enc:v1: format).
 *
 * Dev-only seed scripts (seed-database.mjs, seed-large-graph.mjs,
 * seed-supabase.mjs/cjs) still write plaintext note rows by design (they are
 * never run against production). Run this backfill after any seeding to
 * encrypt those rows too.
 *
 * Usage:
 *   node --env-file=.env.local scripts/encrypt-existing-notes.mjs --dry-run
 *   node --env-file=.env.local scripts/encrypt-existing-notes.mjs
 */
import postgres from 'postgres';
import { createCipheriv, createHash, randomBytes } from 'crypto';

const dryRun = process.argv.includes('--dry-run');
const PREFIX = 'enc:v1:';

if (!process.env.NOTE_ENCRYPTION_KEY) {
  console.error('NOTE_ENCRYPTION_KEY is not set. Add it to .env.local first.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// Same derivation as src/lib/encryption.ts.
const key = createHash('sha256').update(process.env.NOTE_ENCRYPTION_KEY).digest();

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

try {
  const rows = await sql`SELECT id, content FROM note_versions WHERE content IS NOT NULL AND content NOT LIKE ${`${PREFIX}%`}`;
  console.log(`Found ${rows.length} plaintext row(s).`);

  if (dryRun) {
    console.log('Dry run — no writes. Re-run without --dry-run to encrypt.');
    process.exit(0);
  }

  let updated = 0;
  for (const row of rows) {
    await sql`UPDATE note_versions SET content = ${encrypt(row.content)} WHERE id = ${row.id}`;
    updated++;
  }
  console.log(`Encrypted ${updated} row(s).`);
} finally {
  await sql.end();
}
