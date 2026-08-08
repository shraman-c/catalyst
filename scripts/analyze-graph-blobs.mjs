// Measure node-circle blobs within the dark canvas region of a graph screenshot.
// Goal: confirm ~100+ small circular nodes are spread across the canvas (fitted),
// not crammed into a corner or tiny at the center.
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

// Canvas region: left 2/3 of the 2fr:1fr grid, below the header.
// Use conservative bounds: x in [0, 920], y in [220, 780].
const isNodePx = (x, y) => {
  const i = (y * w + x) * ch;
  const r = px[i], g = px[i + 1], bl = px[i + 2];
  if (r < 30 && g < 30 && bl < 30) return false;   // dark bg
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
  if (mx - mn < 25) return false;                   // gray text/edges
  return mx >= 90;                                  // saturated bright color
};

// Flood fill to find connected blobs (4-connectivity, thresholded by saturation).
const seen = new Uint8Array(w * h);
const blobs = [];
for (let y = 220; y < 780; y++) {
  for (let x = 0; x < 920; x++) {
    const idx = y * w + x;
    if (seen[idx] || !isNodePx(x, y)) continue;
    // BFS
    const stack = [[x, y]];
    seen[idx] = 1;
    let count = 0, minX = x, maxX = x, minY = y, maxY = y;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      count++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= 920 || ny < 220 || ny >= 780) continue;
        const nidx = ny * w + nx;
        if (seen[nidx] || !isNodePx(nx, ny)) continue;
        seen[nidx] = 1;
        stack.push([nx, ny]);
      }
    }
    if (count >= 4) blobs.push({ count, minX, maxX, minY, maxY });
  }
}

// Merge blobs within 6px (a single node may be split by antialiasing) — actually
// just report raw stats; label text pixels are gray so they're already excluded.
const diameters = blobs.map(b => Math.max(b.maxX - b.minX, b.maxY - b.minY)).sort((a, b) => b - a);
const large = diameters.filter(d => d >= 18);
console.log(file);
console.log('  blobs found: ' + blobs.length);
console.log('  blob diameter top10: ' + diameters.slice(0, 10).join(','));
console.log('  blobs with diameter>=18 (hub/large nodes): ' + large.length);

// Spread: bounding box of blob centers
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
for (const b of blobs) {
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
  if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
}
console.log('  spread: x[' + Math.round(minX) + ',' + Math.round(maxX) + '] y[' + Math.round(minY) + ',' + Math.round(maxY) + ']');
console.log('  (canvas ~920x560 → fitted graph should span most of it)');
