// Locate every non-background pixel in the graph area and bucket by color.
// Helps see whether nodes render as small circles of category colors or not.
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

// Vertical histogram: for each y band (20px), count non-bg pixels per x-third.
const bands = [];
for (let y = 0; y < h; y += 20) {
  let left = 0, mid = 0, right = 0, white = 0;
  for (let yy = y; yy < Math.min(y + 20, h); yy++) {
    for (let x = 0; x < 933; x++) {
      const i = (yy * w + x) * ch;
      const r = px[i], g = px[i + 1], bl = px[i + 2];
      if (r < 30 && g < 30 && bl < 30) continue;
      if (x < 311) left++;
      else if (x < 622) mid++;
      else right++;
      if (r === 255 && g === 255 && bl === 255) white++;
    }
  }
  bands.push({ y, left, mid, right, white });
}
console.log('y-band | left(x0-311) mid(x311-622) right(x622-933) | white-px');
for (const b of bands) {
  if (b.left + b.mid + b.right === 0) continue;
  console.log(String(b.y).padStart(4) + '   | ' + String(b.left).padStart(6) + ' ' + String(b.mid).padStart(6) + ' ' + String(b.right).padStart(6) + ' | ' + b.white);
}

// Also: exact color histogram over the whole image (top 20)
const colors = new Map();
for (let i = 0; i < px.length; i += ch) {
  const r = px[i], g = px[i + 1], bl = px[i + 2];
  const key = r + ',' + g + ',' + bl;
  colors.set(key, (colors.get(key) || 0) + 1);
}
const top = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('\nexact-color top20:');
for (const [k, v] of top) console.log('  rgb(' + k + ') x' + v);
