import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Encryption at rest for note content (audit 6.6 / fix 3.3).
 *
 * AES-256-GCM with a key derived from the NOTE_ENCRYPTION_KEY env var
 * (any length — sha256-derived to a fixed 32-byte key). Stored format:
 *
 *   enc:v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>
 *
 * - New writes are encrypted before reaching note_versions.content.
 * - decryptNote() passes legacy plaintext rows through untouched, so rows
 *   written before this feature keep working until the backfill script
 *   (scripts/encrypt-existing-notes.mjs) rewrites them.
 * - Key missing behavior:
 *     * production  -> FAIL CLOSED (throw): notes are never silently stored
 *                      in plaintext on a production deploy.
 *     * development -> warn and store plaintext so local dev keeps working.
 * - GCM also authenticates the ciphertext: a tampered row or wrong key throws
 *   on decrypt instead of returning garbage.
 */

const PREFIX = 'enc:v1:';

function keyBytes(): Buffer | null {
  const raw = process.env.NOTE_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

export function encryptNote(plaintext: string): string {
  const key = keyBytes();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NOTE_ENCRYPTION_KEY is required in production — refusing to store note content in plaintext.');
    }
    console.warn('[encryption] NOTE_ENCRYPTION_KEY is not set — storing note content in plaintext (development only).');
    return plaintext;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptNote(payload: string): string {
  if (!payload.startsWith(PREFIX)) return payload; // legacy plaintext row
  const key = keyBytes();
  if (!key) {
    throw new Error('NOTE_ENCRYPTION_KEY is required to decrypt note content stored with encryption at rest.');
  }
  const [ivB64, tagB64, dataB64] = payload.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
