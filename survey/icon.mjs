// Procedural icon: a card and three vote bars filling in. Pure Node.
import { deflateSync } from 'node:zlib';

const OUT = 128;
const FRAMES = 8;

// Index 0 is transparent. The rest are the Survey colours.
const PALETTE = [
  [0, 0, 0],
  [10, 10, 15],
  [20, 20, 31],
  [42, 42, 63],
  [64, 156, 214],
  [140, 196, 230],
  [232, 232, 244],
  [154, 154, 184],
  [14, 18, 28],
  [32, 86, 122],
];

function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x >= x0 + r && x <= x1 - r) return true;
  if (y >= y0 + r && y <= y1 - r) return true;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function frameIndices(f) {
  const idx = new Uint8Array(OUT * OUT);
  const t = f / (FRAMES - 1);
  const bars = [
    { y: 38, w: 18 + Math.round(78 * Math.min(1, t * 1.15)) },
    { y: 62, w: 18 + Math.round(56 * Math.min(1, Math.max(0, t - 0.08) / 0.92)) },
    { y: 86, w: 18 + Math.round(36 * Math.min(1, Math.max(0, t - 0.2) / 0.8)) },
  ];
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      let c = 0;
      if (inRound(x, y, 8, 8, 119, 119, 22)) {
        c = 2;
        if (inRound(x, y, 18, 18, 46, 32, 4)) c = 4;
        for (const b of bars) {
          if (inRound(x, y, 18, b.y, 110, b.y + 16, 6)) c = 8;
          if (inRound(x, y, 18, b.y, 18 + b.w, b.y + 16, 6)) c = (y < b.y + 6) ? 5 : 4;
        }
        if (y >= 108 && y <= 112 && x >= 18 && x <= 46) c = 7;
      }
      idx[y * OUT + x] = c;
    }
  }
  return idx;
}

export function surveyIcon() {
  const flat = new Array(64 * 3).fill(0);
  for (let i = 0; i < PALETTE.length; i++) {
    flat[i * 3] = PALETTE[i][0];
    flat[i * 3 + 1] = PALETTE[i][1];
    flat[i * 3 + 2] = PALETTE[i][2];
  }
  const frames = [];
  for (let f = 0; f < FRAMES; f++) frames.push(frameIndices(f));
  return {
    width: OUT,
    height: OUT,
    palette: flat,
    numColors: 64,
    minCodeSize: 6,
    frames,
    delayCs: 12,
    transparentIndex: 0,
  };
}

function crc(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(tag, data) {
  const t = Buffer.from(tag);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

// Fallback cover, used only when a real page shot is not already on disk.
export function screenshotPng() {
  const W = 1200, H = 720;
  const rgba = Buffer.alloc(W * H * 4);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 10, 10, 15);
  for (let y = 0; y < 64; y++) for (let x = 0; x < W; x++) put(x, y, 20, 20, 31);
  const rows = [
    ['FRIDAY', 86, 2],
    ['MONDAY', 28, 0],
    ['TUESDAY', 0, 0],
  ];
  rows.forEach((row, i) => {
    const y0 = 120 + i * 70;
    const w = 40 + row[1] * 6;
    for (let y = y0; y < y0 + 18; y++) for (let x = 80; x < 80 + w; x++) put(x, y, 64, 156, 214);
  });
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
