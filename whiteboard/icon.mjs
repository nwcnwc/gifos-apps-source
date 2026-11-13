// Procedural icon for Whiteboard: an indigo card holding a white board with
// three sticky notes (yellow, pink, blue), a hand-drawn squiggle, and a small
// red vote dot that lands on one note across the frames. Same super-sample ->
// box-downsample -> small-palette pipeline as the other app icons;
// deterministic, so builds reproduce.
const OUT = 128, SS = 3, RW = OUT * SS, FRAMES = 12;

const CARD_A = [105, 101, 219];
const CARD_B = [62, 58, 150];
const PAPER = [250, 250, 252];
const YELLOW = [255, 214, 90];
const PINK = [255, 150, 190];
const BLUE = [120, 190, 255];
const INK = [60, 58, 90];
const RED = [226, 48, 48];

function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function buildPalette() {
  const pal = [[0, 0, 0]];
  for (const b of [CARD_A, CARD_B, PAPER, YELLOW, PINK, BLUE, INK, RED]) {
    for (let s = 0; s <= 4; s++) pal.push(mix(b, [255, 255, 255], s * 0.1).map(Math.round));
    pal.push(mix(b, [0, 0, 0], 0.35).map(Math.round));
  }
  return pal;
}
function nearest(pal, r, g, b) {
  let bi = 1, bd = 1e9;
  for (let i = 1; i < pal.length; i++) {
    const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b, d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
function inCard(x, y, m, r) {
  const lo = m, hi = OUT - m;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + r), hi - r), cy = Math.min(Math.max(y, lo + r), hi - r);
  if (x >= lo + r && x <= hi - r) return true;
  if (y >= lo + r && y <= hi - r) return true;
  const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r;
}
function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  if (x >= x0 + r && x <= x0 + w - r) return true;
  if (y >= y0 + r && y <= y0 + h - r) return true;
  const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r;
}
function distToSeg(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
function frameIndices(pal, f) {
  const rgba = new Float32Array(RW * RW * 4);
  const m = 8, rad = 22;
  const p = f / FRAMES;
  // The squiggle draws itself over the first half; the dot lands in the second.
  const drawn = Math.min(1, p * 2.2);
  const dotT = Math.max(0, Math.min(1, (p - 0.45) / 0.2));
  const dotOn = p >= 0.45 && p < 0.95;
  const dotR = 4.2 * (dotT < 1 ? 0.5 + 0.5 * dotT + 0.3 * Math.sin(dotT * Math.PI) : 1);
  for (let py = 0; py < RW; py++) for (let px = 0; px < RW; px++) {
    const x = px / SS, y = py / SS;
    let col = null, a = 0;
    if (inCard(x, y, m, rad)) {
      a = 1;
      col = mix(CARD_A, CARD_B, Math.max(0, Math.min(1, (y - m) / (OUT - 2 * m))));
      if (inRoundRect(x, y, 20, 22, 88, 84, 8)) {
        col = PAPER.slice();
        // three notes, each slightly tilted by a shear of x with y
        if (inRoundRect(x + (y - 40) * 0.04, y, 26, 28, 28, 26, 2)) col = YELLOW.slice();
        if (inRoundRect(x - (y - 40) * 0.04, y, 60, 30, 28, 26, 2)) col = PINK.slice();
        if (inRoundRect(x + (y - 80) * 0.03, y, 30, 64, 26, 24, 2)) col = BLUE.slice();
        // squiggle: a sine wave, drawn left to right
        const sx0 = 62, sx1 = 100;
        if (x >= sx0 && x <= sx0 + (sx1 - sx0) * drawn) {
          const sy = 84 + Math.sin((x - sx0) * 0.55) * 5;
          if (Math.abs(y - sy) < 1.5) col = INK.slice();
        }
        // red vote dot on the blue note
        if (dotOn && Math.hypot(x - 46, y - 70) < dotR) col = RED.slice();
      }
    }
    const o = (py * RW + px) * 4;
    if (a) { rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 1; }
  }
  const idx = new Uint8Array(OUT * OUT);
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = SS * SS;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const o = (((y * SS + sy) * RW) + (x * SS + sx)) * 4;
      r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; a += rgba[o + 3];
    }
    if (a / n < 0.5) { idx[y * OUT + x] = 0; continue; }
    idx[y * OUT + x] = nearest(pal, r / n, g / n, b / n);
  }
  return idx;
}

export function whiteboardIcon() {
  const pal = buildPalette();
  const frames = [];
  for (let f = 0; f < FRAMES; f++) frames.push(frameIndices(pal, f));
  const CT = 64;
  const flat = new Array(CT * 3).fill(0);
  for (let i = 0; i < pal.length && i < CT; i++) {
    flat[i * 3] = pal[i][0] | 0; flat[i * 3 + 1] = pal[i][1] | 0; flat[i * 3 + 2] = pal[i][2] | 0;
  }
  return { width: OUT, height: OUT, palette: flat, numColors: CT, minCodeSize: 6, frames, delayCs: 10, transparentIndex: 0 };
}
