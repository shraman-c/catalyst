// Verify the Obsidian-style graph renders correctly by analyzing screenshots.
// Decodes PNG with built-in zlib (no deps) and reports the bounding box of
// saturated "node color" pixels within the dark canvas region.
import { readFileSync } from 'fs';
import zlib from 'zlib';

function decode(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png: ' + path);
  let off = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const bytes = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  let row = 0;
  for (let y = 0; y < h; y++) {
    const f = bytes[row]; row++;
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const raw = bytes[row + i];
      let v = raw;
      if (f === 1) v = (raw + (i >= ch ? cur[i - ch] : 0)) & 255;
      else if (f === 2) v = (raw + (prev ? prev[i] : 0)) & 255;
      else if (f === 3) v = (raw + (((i >= ch ? cur[i - ch] : 0) + (prev ? prev[i] : 0)) >> 1)) & 255;
      else if (f === 4) {
        const a = i >= ch ? cur[i - ch] : 0;
        const bb = prev ? prev[i] : 0;
        const c = (i >= ch && prev) ? prev[i - ch] : 0;
        const p = a + bb - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
        v = (raw + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255;
      }
      cur[i] = v;
    }
    row += stride;
  }
  return { w, h, ch, px };
}

const file = process.argv[2];
const { w, h, ch, px } = decode(file);

// Overall color census (quantized to 4 bits) for a quick sanity check.
const colors = new Map();
const pts = [];
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    const r = px[i], g = px[i + 1], bl = px[i + 2];
    const a = ch === 4 ? px[i + 3] : 255;
    if (a < 200) continue;
    const key = (r >> 4) + ',' + (g >> 4) + ',' + (bl >> 4);
    colors.set(key, (colors.get(key) || 0) + 1);
    // Saturated (non-gray, non-dark) pixels = node fill colors / rings.
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    const saturated = (mx - mn) >= 20 && !(r < 60 && g < 60 && bl < 60) && mx >= 90;
    if (saturated) pts.push({ x, y });
  }
}
const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(file + ': ' + w + 'x' + h);
console.log('  top colors:', top.map(([k, v]) => k + '(' + v + ')').join(' '));

if (pts.length > 0) {
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sumX = 0, sumY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    sumX += p.x; sumY += p.y;
  }
  console.log('  node-color px: ' + pts.length);
  console.log('  bbox x[' + minX + ',' + maxX + '] y[' + minY + ',' + maxY + ']');
  console.log('  centroid: ' + Math.round(sumX / pts.length) + ',' + Math.round(sumY / pts.length));
}
