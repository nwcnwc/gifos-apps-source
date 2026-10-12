// PDF Read Aloud icon: a white page, a copper bar, a line that lights up,
// and sound waves that pulse. Cover is the reader mid-sentence. Pure Node.
import { deflateSync } from 'node:zlib';

const OUT = 128, SS = 3, RW = OUT * SS, FRAMES = 12;

const CARD_A = [36, 22, 16];
const CARD_B = [16, 12, 10];
const PAPER = [250, 248, 242];
const INK = [40, 32, 28];
const COPPER = [196, 92, 42];
const GOLD = [255, 196, 48];
const LINE = [176, 166, 154];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function buildPalette() {
  const pal = [[0, 0, 0]];
  for (const b of [CARD_A, CARD_B, PAPER, INK, COPPER, GOLD, LINE, [255, 255, 255]]) {
    for (let s = 0; s <= 4; s++) pal.push(mix(b, [255, 255, 255], s * 0.1).map(Math.round));
    pal.push(mix(b, [0, 0, 0], 0.35).map(Math.round));
  }
  return pal.slice(0, 64);
}
function nearest(pal, r, g, b) {
  let bi = 1, bd = 1e9;
  for (let i = 1; i < pal.length; i++) {
    const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
function inCard(x, y, m, r) {
  const lo = m, hi = OUT - m;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r);
  const cy = Math.min(Math.max(y, lo + r), hi - r);
  if (x >= lo + r && x <= hi - r) return true;
  if (y >= lo + r && y <= hi - r) return true;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function frameIndices(pal, f) {
  const rgba = new Float32Array(RW * RW * 4);
  const phase = (f % FRAMES) / FRAMES;
  const hlRow = f % 5;
  const pulse = Math.sin(phase * Math.PI * 2);
  for (let py = 0; py < RW; py++) {
    for (let px = 0; px < RW; px++) {
      const x = px / SS, y = py / SS;
      if (!inCard(x, y, 6, 18)) continue;
      let col = mix(CARD_A, CARD_B, Math.max(0, Math.min(1, (y - 6) / (OUT - 12))));
      const px0 = 16, py0 = 16, pw = 66, ph = 96;
      if (x >= px0 && x <= px0 + pw && y >= py0 && y <= py0 + ph) {
        col = PAPER;
        if (y < py0 + 9) col = COPPER;
        else {
          const ly = y - (py0 + 16);
          const row = Math.floor(ly / 10);
          if (ly > 0 && row >= 0 && row < 6 && x > px0 + 7 && x < px0 + pw - 8) {
            const onLine = (ly % 10) < 1.5;
            const onMark = row === hlRow && (ly % 10) < 4;
            if (onMark) col = GOLD;
            else if (onLine) col = LINE;
          }
        }
      }
      const sx = 96, sy = 64;
      const dx = x - sx, dy = y - sy;
      if (dx * dx + dy * dy <= 18) col = COPPER;
      if (x > sx + 2) {
        const d = Math.sqrt(dx * dx + dy * dy);
        for (let ring = 0; ring < 3; ring++) {
          const r = 14 + ring * 8 + pulse * (1 + ring * 0.4);
          if (Math.abs(d - r) < 1.2 && Math.abs(dy) < 20 + ring * 3) {
            col = mix(COPPER, PAPER, 0.08 + ring * 0.18);
          }
        }
      }
      const o = (py * RW + px) * 4;
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 1;
    }
  }
  const idx = new Uint8Array(OUT * OUT);
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = SS * SS;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = (((y * SS + sy) * RW) + (x * SS + sx)) * 4;
          r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3];
        }
      }
      if (a / n < 0.5) { idx[y * OUT + x] = 0; continue; }
      idx[y * OUT + x] = nearest(pal, r / n, g / n, b / n);
    }
  }
  return idx;
}

export function pdfReadAloudIcon() {
  const pal = buildPalette();
  const frames = [];
  for (let f = 0; f < FRAMES; f++) frames.push(frameIndices(pal, f));
  const CT = 64;
  const flat = new Array(CT * 3).fill(0);
  for (let i = 0; i < pal.length && i < CT; i++) {
    flat[i * 3] = pal[i][0] | 0;
    flat[i * 3 + 1] = pal[i][1] | 0;
    flat[i * 3 + 2] = pal[i][2] | 0;
  }
  return {
    width: OUT, height: OUT, palette: flat, numColors: CT,
    minCodeSize: 6, frames, delayCs: 10, transparentIndex: 0
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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, c]);
}

const GLYPHS = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0, 0b00100],
  ',': [0, 0, 0, 0, 0, 0b00100, 0b01000],
  '/': [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b10000],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  3: [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
};

function drawText(put, x, y, str, s, r, g, b) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const gph = GLYPHS[ch];
    if (!gph) { cx += 6 * s; continue; }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (gph[row] & (1 << (4 - col))) {
          for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) put(cx + col * s + dx, y + row * s + dy, r, g, b);
          }
        }
      }
    }
    cx += 6 * s;
  }
}

function fillRect(put, x, y, w, h, r, g, b) {
  for (let yy = y | 0; yy < y + h; yy++) {
    for (let xx = x | 0; xx < x + w; xx++) put(xx, yy, r, g, b);
  }
}

export function screenshotPng() {
  const W = 1200, H = 720;
  const rgba = Buffer.alloc(W * H * 4, 0);
  const put = (x, y, r, g, b, a) => {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a == null ? 255 : a;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 20, 17, 14);

  fillRect(put, 0, 0, W, 64, 28, 24, 20);
  function chip(x, label, copper) {
    fillRect(put, x, 14, 16 + label.length * 18, 36, copper ? 196 : 42, copper ? 92 : 36, copper ? 42 : 31);
    drawText(put, x + 10, 20, label, 3, 243, 239, 232);
  }
  chip(16, 'OPEN', false);
  chip(140, 'PLAY', true);
  chip(268, 'PREV', false);
  chip(396, 'NEXT', false);
  drawText(put, 540, 22, '1 / 2', 3, 183, 174, 164);
  drawText(put, 700, 22, 'SPEED 1', 3, 183, 174, 164);

  const pw = 470, ph = 580;
  const px = Math.round((W - pw) / 2), py = 84;
  fillRect(put, px - 10, py - 10, pw + 20, ph + 20, 12, 10, 8);
  fillRect(put, px, py, pw, ph, 250, 248, 242);
  fillRect(put, px, py, pw, 10, 196, 92, 42);
  drawText(put, px + 36, py + 36, 'A PAGE, READ ALOUD', 3, 40, 32, 28);
  // Scale-2 glyphs are 12 px wide: a line on this page holds 33 characters.
  const body = [
    'A SHEET OF PAPER CAN BE HEARD',
    'AS WELL AS SEEN.',
    'THIS NOTE IS TWO PAGES.',
    'IT LIVES IN THE APP.',
    'NOTHING HERE IS UPLOADED.',
    'PRESS PLAY. THE VOICE READS',
    'ONE SENTENCE, THEN THE NEXT.',
    'THE LINE YOU HEAR IS MARKED.',
  ];
  const MARKED = 4; // "Nothing here is uploaded." is the sentence being read
  for (let i = 0; i < body.length; i++) {
    const y = py + 120 + i * 48;
    if (i === MARKED) fillRect(put, px + 28, y - 10, body[i].length * 12 + 14, 34, 255, 196, 48);
    drawText(put, px + 36, y, body[i], 2, 40, 32, 28);
  }
  drawText(put, px + pw / 2 - 8, py + ph - 36, '1', 2, 120, 110, 100);

  fillRect(put, 0, H - 36, W, 36, 28, 24, 20);
  drawText(put, 20, H - 26, 'PAPER-AND-VOICE.PDF', 2, 217, 208, 198);
  drawText(put, 420, H - 26, 'PAGE 1 OF 2', 2, 183, 174, 164);
  drawText(put, 680, H - 26, 'SENTENCE 4 OF 7', 2, 183, 174, 164);

  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
