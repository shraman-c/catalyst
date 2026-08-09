// ============================================================
// Catalyst — PWA icon generator (no external dependencies)
//
// Draws the neo-brutalist "C" mark (design.md §1, §5) as flat
// solid-color rects and encodes it as RGBA PNGs using only
// Node built-ins (zlib). Generates:
//   public/icons/icon-192x192.png        (manifest "any")
//   public/icons/icon-512x512.png        (manifest "any")
//   public/icons/icon-maskable-512x512.png (manifest "maskable")
//   public/icons/apple-touch-icon.png    (iOS, 180x180)
//
// Usage: node scripts/generate-pwa-icons.mjs
// ============================================================

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

// --- Palette (design.md §1) ----------------------------------
const BASE = [242, 240, 233]; // #F2F0E9 — app background
const INK = [17, 17, 17]; // #111111 — borders / glyph
const SIGNAL = [244, 180, 0]; // #F4B400 — "pay attention" yellow

// --- Minimal PNG encoder -------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- Drawing helpers (normalized 0..1 coordinates) ------------
function createCanvas(size) {
  return new Uint8Array(size * size * 4); // transparent
}

function fillRect(rgba, size, nx0, ny0, nx1, ny1, [r, g, b]) {
  const x0 = Math.max(0, Math.round(nx0 * size));
  const y0 = Math.max(0, Math.round(ny0 * size));
  const x1 = Math.min(size, Math.round(nx1 * size));
  const y1 = Math.min(size, Math.round(ny1 * size));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
}

// --- The "C" mark --------------------------------------------
// A thick ink "C" (top + left + bottom bars) with a signal
// accent square carrying the signature hard ink offset shadow
// (design.md §3.1). All coordinates are normalized 0..1 so the
// mark scales cleanly to any size.
function drawCMark(rgba, size, { scale = 1, cx = 0.5, cy = 0.5, shadow = true } = {}) {
  // Center the glyph around (cx, cy); scale shrinks it (maskable safe zone).
  const s = (v) => cy + (v - 0.5) * scale;
  const t = (v) => cx + (v - 0.5) * scale;

  const T = 0.12 * scale; // bar thickness

  // Bars (ink)
  const top0 = s(0.22), top1 = s(0.22 + T);
  const bottom0 = s(0.66), bottom1 = s(0.66 + T);
  const left0 = t(0.16), left1 = t(0.16 + T);
  const rightEdge = t(0.84);

  fillRect(rgba, size, left0, top0, rightEdge, top1, INK); // top bar
  fillRect(rgba, size, left0, top0, left1, bottom1, INK); // left bar
  fillRect(rgba, size, left0, bottom0, rightEdge, bottom1, INK); // bottom bar

  if (shadow) {
    // Accent square with hard offset shadow, sitting inside the C's mouth.
    const shX0 = t(0.56), shY0 = s(0.40);
    const shX1 = t(0.74), shY1 = s(0.58);
    const acX0 = t(0.60), acY0 = s(0.44);
    const acX1 = t(0.78), acY1 = s(0.62);
    fillRect(rgba, size, shX0, shY0, shX1, shY1, INK); // shadow (offset down-right)
    fillRect(rgba, size, acX0, acY0, acX1, acY1, SIGNAL); // accent on top
  }
}

// --- Icon variants -------------------------------------------
// Regular: base background, ink C + signal accent (light theme).
function regularIcon(size) {
  const rgba = createCanvas(size);
  fillRect(rgba, size, 0, 0, 1, 1, BASE);
  drawCMark(rgba, size);
  return encodePNG(size, rgba);
}

// Maskable: full-bleed signal background (no cropping edges),
// ink C centered inside the 80% safe zone.
function maskableIcon(size) {
  const rgba = createCanvas(size);
  fillRect(rgba, size, 0, 0, 1, 1, SIGNAL);
  drawCMark(rgba, size, { scale: 0.72 });
  return encodePNG(size, rgba);
}

// --- Write files ---------------------------------------------
const targets = [
  { file: 'icon-192x192.png', buf: regularIcon(192) },
  { file: 'icon-512x512.png', buf: regularIcon(512) },
  { file: 'icon-maskable-512x512.png', buf: maskableIcon(512) },
  { file: 'apple-touch-icon.png', buf: regularIcon(180) },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const { file, buf } of targets) {
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  console.log(`✓ ${file} (${buf.length} bytes)`);
}
console.log(`\nWrote ${targets.length} icons to ${path.relative(ROOT, OUT_DIR)}/`);
