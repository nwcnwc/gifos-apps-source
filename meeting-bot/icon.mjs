// A small static sticker: a blue square face. The packer turns these indices into the GIF.
export function icon() {
  const W = 32;
  const pal = new Array(16 * 3).fill(0);
  const set = (i, r, g, b) => { pal[i * 3] = r; pal[i * 3 + 1] = g; pal[i * 3 + 2] = b; };
  set(1, 16, 16, 28);
  set(2, 92, 160, 255);
  set(3, 236, 238, 248);
  const idx = new Uint8Array(W * W);
  idx.fill(1);
  for (let y = 6; y < 26; y++) for (let x = 8; x < 24; x++) idx[y * W + x] = 2;
  idx[12 * W + 12] = 3; idx[12 * W + 13] = 3;
  idx[12 * W + 18] = 3; idx[12 * W + 19] = 3;
  for (let x = 12; x < 20; x++) idx[18 * W + x] = 3;
  return {
    width: W, height: W, palette: pal, numColors: 16, minCodeSize: 4,
    frames: [idx], delayCs: 0, transparentIndex: 0
  };
}
