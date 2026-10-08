// TINY PLATFORMER HAS TO ACTUALLY JUMP, COLLECT, AND STOMP.
//
// The original is a keyboard demo that XHR-loads a Tiled map and paints the
// entire cave at once. This port has to (a) run without XHR, (b) move the
// yellow square, (c) take gold, (d) stomp a grey block, (e) keep a best run.
// A suite that only greps for "JUMP" would green while the player was frozen.
//
// The sim is deterministic given the inputs, so it runs headless in a vm at
// a fixed 1/60 step — no browser. The phone pad and Back hook are one-liners
// a vm cannot click; those are pinned by source scan.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function fakeCanvas() {
  return {
    width: 640,
    height: 480,
    style: {},
    getContext: () => ({
      setTransform() {},
      clearRect() {},
      fillRect() {},
      fillStyle: '',
      globalAlpha: 1,
    }),
  };
}

function load() {
  const canvas = fakeCanvas();
  const els = {};
  const makeEl = (id) => {
    if (els[id]) return els[id];
    els[id] = {
      id,
      textContent: '',
      hidden: id === 'touch' || id === 'banner',
      classList: { add() {}, remove() {}, contains: () => false },
      style: {},
      querySelectorAll: () => [],
      addEventListener() {},
      setAttribute() {},
      getAttribute: () => null,
    };
    return els[id];
  };
  makeEl('canvas');
  els.canvas = canvas;
  const sandbox = {
    console,
    Math,
    Object, Array, JSON, Date, String, Number, Boolean,
    parseInt, parseFloat, isNaN, Infinity,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    navigator: { maxTouchPoints: 0, userAgent: 'node' },
    matchMedia: () => ({ matches: false }),
    Tiny: { headless: true },
    gifos: null,
  };
  const document = {
    readyState: 'complete',
    body: { classList: { add() {}, contains: () => false }, style: {} },
    getElementById: (id) => makeEl(id),
    addEventListener() {},
    querySelectorAll: () => [],
  };
  sandbox.document = document;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.innerWidth = 390;
  sandbox.innerHeight = 844;
  vm.createContext(sandbox);
  for (const f of ['boot.js', 'vendor/level.js', 'vendor/platformer.js', 'touch.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const sandbox = load();
const Tiny = sandbox.Tiny;

check('the sim loads and exposes Tiny.step', !!(Tiny && Tiny.step && Tiny.player));
check('the Tiled cave is aboard (no XHR)', !!sandbox.TINY_LEVEL && Array.isArray(sandbox.TINY_LEVEL.layers));
check('eight gold and eight grey blocks', (() => {
  const tot = Tiny.totals();
  return tot.coins === 8 && tot.stomps === 8;
})(), Tiny.totals && Tiny.totals());

{
  const p = Tiny.player();
  check('the player spawns in the cave', !!(p && p.player && p.x === 96 && p.y === 480), p && { x: p.x, y: p.y });
}

{
  const p = Tiny.player();
  const x0 = p.x;
  p.right = true;
  Tiny.step(45);
  p.right = false;
  Tiny.step(5);
  check('holding right MOVES the yellow square', p.x > x0 + 16, { from: x0, to: p.x });
}

{
  Tiny.restart();
  const p = Tiny.player();
  const y0 = p.y;
  p.jump = true;
  Tiny.step(8);
  p.jump = false;
  check('a jump leaves the ground (y decreases)', p.y < y0 - 8 && p.jumping, { from: y0, to: p.y, jumping: p.jumping });
  Tiny.step(80);
  check('…and lands again', !p.jumping && p.y >= y0 - 1, { y: p.y, jumping: p.jumping, falling: p.falling });
}

{
  Tiny.restart();
  const p = Tiny.player();
  const gold = Tiny.treasure()[0];
  p.x = gold.x;
  p.y = gold.y;
  Tiny.step(2);
  check('walking onto gold COLLECTS it', p.collected === 1 && gold.collected, { collected: p.collected });
}

{
  Tiny.restart();
  const p = Tiny.player();
  const m = Tiny.monsters()[0];
  p.x = m.x;
  p.y = m.y - 24;
  p.dy = 12;
  Tiny.step(1);
  check('landing on a grey block STOMPS it', m.dead && p.killed === 1, { dead: m.dead, killed: p.killed, y: p.y });
}

{
  Tiny.restart();
  const p = Tiny.player();
  const m = Tiny.monsters()[0];
  const startX = p.start.x, startY = p.start.y;
  p.x = m.x;
  p.y = m.y;
  p.dy = 0;
  Tiny.step(1);
  check('walking into a grey block sends you back to the start', p.x === startX && p.y === startY, { x: p.x, y: p.y });
}

{
  Tiny.restart();
  const p = Tiny.player();
  Tiny.treasure().forEach((t) => { t.collected = true; p.collected++; });
  Tiny.monsters().forEach((m) => { m.dead = true; p.killed++; });
  check('taking all gold and stomps CLEARS the cave', Tiny.cleared() === true);
  Tiny.restart();
  check('R / restart puts the gold and grey blocks back', Tiny.cleared() === false && p.collected === 0 && Tiny.treasure().every((t) => !t.collected));
}

// ---- the GifOS shell, run for real -------------------------------------------
// boot.js + level + platformer + touch.js run against a fake DOM built from
// index.html itself (every element with an id, every [data-key] button with
// its attributes), a fake gifos (db + onBack) and fake pointer/key events.
// Checks press the controls and read the player and the saved record.
function shell(opts) {
  opts = opts || {};
  const html = src('index.html');
  const els = {}; const keyBtns = [];
  function El(tag, attrs) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs || {}; this.id = this.attrs.id || '';
    this.hidden = 'hidden' in this.attrs; this.textContent = ''; this.style = {}; this.listeners = {};
    const cls = new Set((this.attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) };
  }
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.fire = function (t, ev) { for (const fn of this.listeners[t] || []) fn(Object.assign({ preventDefault() {}, pointerId: 1 }, ev || {})); };
  El.prototype.setPointerCapture = function () {};
  El.prototype.querySelectorAll = function (sel) { return sel === '[data-key]' && this.id === 'touch' ? keyBtns : []; };
  html.replace(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g, (m, tag, a) => {
    const attrs = {}; a.replace(/([\w-]+)(?:="([^"]*)")?/g, (mm, k, v) => { attrs[k] = v === undefined ? '' : v; return mm; });
    if (!attrs.id && !attrs['data-key']) return m;
    const el = new El(tag, attrs);
    if (attrs.id) els[attrs.id] = el;
    if (attrs['data-key']) keyBtns.push(el);
    return m;
  });
  const canvas = els.canvas; Object.assign(canvas, fakeCanvas(), { style: {} });
  const bodyCls = new Set();
  const docListeners = {}; const winListeners = {};
  const document = {
    readyState: 'complete',
    body: { classList: { add: (c) => bodyCls.add(c), remove: (c) => bodyCls.delete(c), contains: (c) => bodyCls.has(c) }, style: {} },
    getElementById: (id) => els[id] || null,
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
    querySelectorAll: () => [],
  };
  const puts = []; let back = null; let xhr = 0;
  const gifos = opts.noGifos ? null : {
    db: () => ({ put: (r) => { puts.push(r); return Promise.resolve(); }, get: () => Promise.resolve(opts.best || null) }),
    onBack: (fn) => { back = fn; },
  };
  let rafFn = null;
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, parseInt, parseFloat, isNaN, Infinity,
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { rafFn = fn; return 1; },
    navigator: { maxTouchPoints: opts.touchPoints || 0, userAgent: 'node' },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' && !!opts.coarse }),
    XMLHttpRequest: function () { xhr++; this.open = () => {}; this.send = () => {}; },
    Tiny: { headless: !opts.live }, gifos, document,
    innerWidth: opts.w || 390, innerHeight: opts.h || 844,
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['boot.js', 'vendor/level.js', 'vendor/platformer.js', 'touch.js']) {
    vm.runInContext(src(f), sandbox, { filename: f });
  }
  const key = (code, down) => (docListeners[down ? 'keydown' : 'keyup'] || []).forEach((fn) => fn({ keyCode: code, preventDefault() {} }));
  return { sandbox, Tiny: sandbox.Tiny, els, keyBtns, document, bodyCls, puts, back: () => back && back(), hasBack: () => !!back, xhr: () => xhr, raf: () => rafFn, key, winListeners };
}

(async () => {
  const flush = () => new Promise((r) => setImmediate(r));
  // Best run: taking gold writes { id: 'best', coins, stomps } to gifos.db.
  {
    const S = shell();
    await flush();
    const T = S.Tiny; const p = T.player(); const gold = T.treasure()[0];
    p.x = gold.x; p.y = gold.y; T.step(2);
    await flush();
    const rec = S.puts[S.puts.length - 1];
    check('taking gold saves the best run to gifos.db as id best', !!rec && rec.id === 'best' && rec.coins === 1 && rec.stomps === 0, S.puts);
    const n = S.puts.length; T.step(5); await flush();
    check('no new save while nothing improved', S.puts.length === n, S.puts.length);
  }
  {
    // A stored best is read back and a run below it does not overwrite it.
    const S = shell({ best: { id: 'best', coins: 5, stomps: 2 } });
    await flush();
    const T = S.Tiny; const p = T.player(); const gold = T.treasure()[0];
    p.x = gold.x; p.y = gold.y; T.step(2); await flush();
    check('a run below the stored best does not overwrite it', S.puts.length === 0, S.puts);
  }
  {
    // Opened outside GifOS: no gifos at all. The cave still boots and plays.
    let S = null, err = null;
    try { S = shell({ noGifos: true }); } catch (e) { err = e; }
    let moved = false;
    if (S) { const p = S.Tiny.player(); const x0 = p.x; p.right = true; S.Tiny.step(30); moved = p.x > x0; }
    check('a missing db still boots and plays (opened outside GifOS)', !err && moved, String(err));
  }
  {
    // The phone pad: on a narrow phone it shows without waiting for a finger,
    // and each thumb button drives the same player flags the keyboard does.
    const S = shell({ w: 390, h: 844 });
    const T = S.Tiny; const p = T.player();
    check('on a narrow phone the pad shows at once', S.els.touch.hidden === false && S.bodyCls.has('touch'));
    const btn = (k) => S.keyBtns.find((b) => b.getAttribute('data-key') === k);
    for (const k of ['left', 'right', 'jump']) {
      const b = btn(k);
      if (!b) { check('the pad has a ' + k + ' button', false); continue; }
      b.fire('pointerdown');
      const on = p[k] === true;
      b.fire('pointerup');
      check('holding the ' + k + ' thumb button sets player.' + k + ', releasing clears it', on && p[k] === false);
      check('the ' + k + ' button has an accessible name', !!b.getAttribute('aria-label') && b.tagName === 'BUTTON');
    }
    const r = btn('right'); const x0 = p.x;
    r.fire('pointerdown'); T.step(45); r.fire('pointercancel'); T.step(5);
    check('the right thumb button walks the player', p.x > x0 + 16 && p.right === false, { from: x0, to: p.x });
    T.restart();
    const j = btn('jump'); const y0 = p.y;
    j.fire('pointerdown'); T.step(8); j.fire('pointerup');
    check('the jump thumb button jumps', p.y < y0 - 8, { from: y0, to: p.y });
    T.step(80);
    p.x = p.start.x + 40;
    btn('restart').fire('pointerdown');
    check('RESTART puts the player back at the start', p.x === p.start.x && p.y === p.start.y);
    // Canvas fit: the canvas plus the pad strip fit the screen.
    const pad = parseFloat(S.document.body.style.paddingBottom) || 0;
    const ch = parseFloat(S.els.canvas.style.height) || 0;
    check('canvas fit leaves a bottom strip for the pad', pad > 0 && ch > 0 && ch + pad <= 844, { pad, ch });
  }
  {
    // A desktop: the pad stays hidden until a finger touches the screen.
    const S = shell({ w: 1280, h: 800 });
    check('on a desktop the pad stays hidden', S.els.touch.hidden === true && !S.bodyCls.has('touch'));
    check('the canvas takes the whole height with no pad', !(parseFloat(S.document.body.style.paddingBottom) > 0));
    (S.winListeners.touchstart || []).forEach((fn) => fn({}));
    check('a first touch reveals the pad', S.els.touch.hidden === false && S.bodyCls.has('touch'));
  }
  {
    // Thumb targets: resolve the stylesheet for the left/right/jump buttons.
    const css = src('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    (function scan(text) {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const head = text.slice(i, open).trim(); let depth = 1, k = open + 1;
        while (k < text.length && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
        const inner = text.slice(open + 1, k - 1);
        if (head.startsWith('@media')) scan(inner); else rules.push({ sels: head.split(',').map((x) => x.trim()), body: inner });
        i = k;
      }
    })(css);
    const S = shell();
    const px = (v) => { const m = /^([\d.]+)(rem|px)$/.exec(String(v).trim()); return m ? parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN; };
    const sizeOf = (el) => {
      const cls = (el.getAttribute('class') || '').split(/\s+/);
      const out = {};
      for (const r of rules) for (const sel of r.sels) {
        const parts = sel.split('.').filter(Boolean);
        if (sel[0] !== '.' || !parts.every((c) => cls.indexOf(c) >= 0)) continue;
        r.body.replace(/(?:^|;)\s*(width|height)\s*:\s*([^;]+)/g, (m, k, v) => { out[k] = px(v); return m; });
      }
      return out;
    };
    for (const k of ['left', 'right', 'jump']) {
      const b = S.keyBtns.find((x) => x.getAttribute('data-key') === k);
      const sz = b ? sizeOf(b) : {};
      check('the ' + k + ' button is at least 44px square', sz.width >= 44 && sz.height >= 44, sz);
    }
  }
  {
    // The keyboard: WASD and the arrows/space drive the same flags.
    const S = shell({ w: 1280 });
    const T = S.Tiny; const p = T.player(); const K = T.KEY;
    const held = (code, flag) => { S.key(code, true); const on = p[flag] === true; S.key(code, false); return on && p[flag] === false; };
    check('A and Left walk left', held(65, 'left') && held(37, 'left'));
    check('D and Right walk right', held(68, 'right') && held(39, 'right'));
    check('W, Up and Space jump', held(87, 'jump') && held(38, 'jump') && held(32, 'jump'));
    p.x = p.start.x + 64; S.key(82, true); S.key(82, false);
    check('R restarts the cave', p.x === p.start.x, K && K.R);
    check('the level is aboard: no XHR at all', S.xhr() === 0);
  }
  {
    // The camera follows the player: run a live frame before and after a walk.
    const S = shell({ w: 1280, live: true });
    const T = S.Tiny; const cams = [];
    T.onFrame = (pl, cam) => cams.push(cam ? { x: cam.x, y: cam.y } : null);
    const raf = S.raf();
    if (raf) raf();
    const p = T.player();
    p.x += 30 * T.TILE;
    const raf2 = S.raf(); if (raf2) raf2();
    const a = cams[0], b = cams[cams.length - 1];
    check('the camera follows the player across the cave', !!a && !!b && b.x > a.x, cams);
  }
  {
    // Back restarts the cave and tells the OS it handled the press.
    const S = shell();
    const p = S.Tiny.player();
    p.x = p.start.x + 50; p.collected = 3;
    const r = S.back();
    check('Back restarts the cave and reports it handled the press', S.hasBack() && r === true && p.x === p.start.x && p.collected === 0, { r, x: p.x });
  }
  finish();
})();

function finish() {
{
  const man = JSON.parse(src('manifest.json'));
  const listing = JSON.parse(src('listing.json'));
  check('no multiplayer claim on a solo cave', man.capabilities.db === true && !man.capabilities.multiplayer);
  check('minBuild stays 947', man.minBuild === 947);
  check('listing names Jake Gordon, not GifOS', listing.author.name === 'Jake Gordon' && listing.basedOn.blessed === false);
  check('tagline fits a card', listing.tagline.length <= 90);
  check('help.md is a real how-to', src('help.md').trim().length >= 400);
}

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nAll ' + (process.stdout._ok || '') + 'tiny-platformer checks passed');
}
