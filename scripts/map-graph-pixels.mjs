// Coarse ASCII map of a screenshot: '.'=dark bg, '#'=light/white, '*'=saturated color, '='=mid.
// Helps locate where the graph nodes actually are.
import { readFileSync } from 'fs';
import zlib from 'zlib';

function decode(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
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

const COLS = 96, ROWS = 44;
const cellW = w / COLS, cellH = h / ROWS;
let map = '';
for (let ry = 0; ry < ROWS; ry++) {
  let line = '';
  for (let rx = 0; rx < COLS; rx++) {
    let sat = 0, light = 0, dark = 0, total = 0;
    const x0 = Math.floor(rx * cellW), x1 = Math.floor((rx + 1) * cellW);
    const y0 = Math.floor(ry * cellH), y1 = Math.floor((ry + 1) * cellH);
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * w + x) * ch;
        const r = px[i], g = px[i + 1], bl = px[i + 2];
        total++;
        if (r < 30 && g < 30 && bl < 30) { dark++; continue; }
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if (mx - mn >= 25 && mx >= 90) { sat++; continue; }
        if (mx >= 200) light++;
      }
    }
    const s = total ? (sat / total) : 0;
    const l = total ? (light / total) : 0;
    if (s > 0.04) line += '*';
    else if (s > 0.005) line += '+';
    else if (l > 0.35) line += '#';
    else if (l > 0.08) line += ':';
    else line += '.';
  }
  map += line + '\n';
}
console.log(map);
