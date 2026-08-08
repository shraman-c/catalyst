// Count exact-match pixels of the 5 category colors + fg ring color inside the
// graph canvas region (left 2/3 of the 2fr:1fr grid, below the header).
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

const targets = {
  amber: [244, 180, 0],
  green: [46, 125, 91],
  red: [214, 69, 69],
  white: [255, 255, 255],
  beige: [231, 227, 216],
  fg: [242, 240, 233],   // ring/label color
  bg: [17, 17, 17],      // canvas bg
};

const counts = Object.fromEntries(Object.keys(targets).map(k => [k, 0]));
const nearCounts = Object.fromEntries(Object.keys(targets).map(k => [k, 0]));
let totalInCanvas = 0;
let inCanvasNonBg = 0;

// Canvas region: x in [0, 933], y in [250, 850] (below header, inside 2fr column)
for (let y = 250; y < 850; y++) {
  for (let x = 0; x < 933; x++) {
    const i = (y * w + x) * ch;
    const r = px[i], g = px[i + 1], bl = px[i + 2];
    totalInCanvas++;
    if (r < 30 && g < 30 && bl < 30) continue;
    inCanvasNonBg++;
    for (const [name, [tr, tg, tb]] of Object.entries(targets)) {
      if (r === tr && g === tg && bl === tb) counts[name]++;
      if (Math.abs(r - tr) <= 12 && Math.abs(g - tg) <= 12 && Math.abs(bl - tb) <= 12) nearCounts[name]++;
    }
  }
}

console.log(file);
console.log('canvas pixels: ' + totalInCanvas + ', non-bg: ' + inCanvasNonBg);
console.log('exact:', JSON.stringify(counts));
console.log('near(±12):', JSON.stringify(nearCounts));
