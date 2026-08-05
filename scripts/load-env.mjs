// Helper: loads .env.local into process.env (works on Windows with \r\n)
import { readFileSync } from 'fs';

const lines = readFileSync('.env.local', 'utf8').split(/\r?\n/);
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  const key = trimmed.substring(0, idx).trim();
  const val = trimmed.substring(idx + 1).trim();
  process.env[key] = val;
}
