// COIL HAS TO ACTUALLY WRAP ORBS.
//
// The shipped game is Hakim's canvas port plus CoilCore: trail, loop, enclose,
// energy, score. Enclosure used to be getImageData of a cyan fill every other
// frame — untestable, and a miss on a dirty rect was a silent no-score. The
// suite PLAYS CoilCore in a vm: draw a circle around orbs, they die; wrap a
// bomb, energy drops; let an orb burst, the run can end. The page itself is
// booted over a small DOM from index.html and played: pointer, Back, save.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function load() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'core.js'), 'utf8'), sandbox, { filename: 'core.js' });
  return sandbox;
}

const S = load();
const CC = S.CoilCore;
check('core.js attaches CoilCore', !!(CC && CC.create && CC.tick && CC.pointInPoly));

{
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
  check('a point inside a square is enclosed', CC.pointInPoly(square, 5, 5));
  check('a point outside a square is not', !CC.pointInPoly(square, 20, 5));
  check('a crossing pair of segments reports an intersection',
    !!CC.findLineIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }));
  check('parallel segments do not',
    !CC.findLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }));
}

function noSpawn() { return 0; }

function driveSquare(g, cx, cy, side, n) {
  const h = side / 2;
  function go(x, y, k) {
    const x0 = g.pointer.x, y0 = g.pointer.y;
    for (let i = 1; i <= k; i++) {
      CC.setPointer(g, x0 + (x - x0) * i / k, y0 + (y - y0) * i / k);
      CC.tick(g, 16);
    }
  }
  CC.setPointer(g, cx - h, cy - h);
  for (let i = 0; i < 12; i++) CC.tick(g, 16);
  go(cx + h, cy - h, n);
  go(cx + h, cy + h, n);
  go(cx - h, cy + h, n);
  go(cx - h, cy - h - 24, n);
}

{
  const g = CC.create({ w: 400, h: 400, rng: noSpawn });
  CC.start(g);
  g.enemies = [];
  CC.addEnemy(g, 200, 200, CC.ENEMY_NORMAL);
  CC.addEnemy(g, 206, 204, CC.ENEMY_NORMAL);
  CC.addEnemy(g, 194, 206, CC.ENEMY_NORMAL);
  const n0 = g.enemies.length;
  const s0 = g.score;
  const e0 = g.energy;
  driveSquare(g, 200, 200, 60, 8);
  check('the run is still playing after a loop', g.playing && !g.over, { playing: g.playing, over: g.over, energy: g.energy });
  check('wrapping three orbs KILLS them', g.enemies.length === 0, { left: g.enemies.length, started: n0, events: g.events });
  check('…and the score goes UP', g.score > s0 + 50, { from: s0, to: g.score });
  check('…and energy did not collapse', g.energy >= e0, { from: e0, to: g.energy });
  check('a multi-catch ticks the multiplier up', g.multiplier.minor > 0 || g.multiplier.major > 1, g.multiplier);
}

{
  const g = CC.create({ w: 400, h: 400, rng: noSpawn });
  CC.start(g);
  g.enemies = [];
  CC.addEnemy(g, 200, 200, CC.ENEMY_BOMB);
  const e0 = g.energy;
  driveSquare(g, 200, 200, 60, 8);
  check('wrapping a bomb does not score a catch', g.events.filter((e) => e.kind === 'catch').length === 0, g.events);
  check('wrapping a bomb HURTS energy', g.energy < e0, { from: e0, to: g.energy, events: g.events });
  check('…and resets the multiplier', g.multiplier.major === 1, g.multiplier);
}

{
  const g = CC.create({ w: 400, h: 400, rng: () => 1 });
  CC.start(g);
  g.enemies = [];
  const orb = CC.addEnemy(g, 80, 80, CC.ENEMY_NORMAL);
  orb.time = 0;
  const e0 = g.energy;
  for (let i = 0; i < 600 && g.enemies.length; i++) CC.tick(g, 16);
  check('an unwrapped orb eventually BURSTS', g.events.some((e) => e.kind === 'burst'), g.events);
  check('…and that burst costs energy', g.energy < e0, { from: e0, to: g.energy });
}

{
  const g = CC.create({ w: 400, h: 400, rng: () => 1 });
  CC.start(g);
  g.enemies = [];
  g.energy = 30;
  const orb = CC.addEnemy(g, 80, 80, CC.ENEMY_NORMAL);
  orb.time = 99;
  for (let i = 0; i < 20; i++) CC.tick(g, 16);
  check('energy hitting zero ENDs the run', g.over === true && g.playing === false,
    { over: g.over, playing: g.playing, energy: g.energy });
}

{
  const g = CC.create({ w: 400, h: 400, rng: seeded(9) });
  CC.start(g);
  const x0 = g.player.x, y0 = g.player.y;
  CC.setPointer(g, 350, 40);
  for (let i = 0; i < 20; i++) CC.tick(g, 16);
  check('the head FOLLOWS the pointer', g.player.x > x0 + 20 && g.player.y < y0 - 10,
    { from: [x0, y0], to: [g.player.x, g.player.y] });
  check('the trail has length', g.trail.length === CC.TRAIL_LENGTH, g.trail.length);
}

// ---- the page, booted -------------------------------------------------------
// index.html over a small DOM, the page's own scripts in order (jQuery is a
// chainable stub that records the menu's css(); WebGL is absent, so the 2D
// path runs), a seeded Math and a frame-driven clock so two runs are frame-
// for-frame comparable. The #world canvas's 2D context records every call.
// ---- a small DOM, built from the app's own index.html -----------------------
// Elements carry ids, classes, data-*, hidden, value/checked, listeners and a
// no-op 2D context; scripts named by <script src> run in one vm context in
// page order. Enough to boot an app and click it; nothing is painted.
function fakeDom(htmlText, opts) {
  opts = opts || {};
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const byId = new Map();
  const noopCtx = () => new Proxy({ measureText: () => ({ width: 0 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const all = (n) => { const out = []; const w = (x) => { for (const k of x.children) { out.push(k); w(k); } }; w(n); return out; };
  const matches = (x, sel) => {
    if (sel.indexOf(',') >= 0) return sel.split(',').some((s1) => matches(x, s1));
    sel = sel.trim();
    if (sel === '*') return true;
    if (sel[0] === '#') return x.id === sel.slice(1);
    const m = /^([\w-]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel);
    if (!m || (!m[1] && !m[2] && !m[3])) return false;
    return (!m[1] || x.tagName === m[1].toUpperCase()) && (!m[2] || x.classList.contains(m[2])) &&
      (!m[3] || (m[3] in x.attrs && (m[4] === undefined || x.attrs[m[3]] === m[4]) && !(m[3] === 'type' && m[4] !== undefined && x.type !== m[4])));
  };
  const query = (root, sel) => { const parts = sel.split(/\s+/); let set = [root]; for (const p of parts) { const next = []; for (const s of set) for (const d of all(s)) if (matches(d, p) && !next.includes(d)) next.push(d); set = next; } return set; };
  const mk = (tag, attrs, parent) => {
    const dataset = {};
    for (const k in attrs) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = attrs[k];
    let html = '';
    const e = {
      tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs, parent, parentNode: parent, children: [], childNodes: null, listeners: {}, dataset,
      id: attrs.id || '', hidden: 'hidden' in attrs, disabled: 'disabled' in attrs, value: attrs.value || '', checked: 'checked' in attrs, type: attrs.type || '',
      textContent: '', title: attrs.title || '', className: attrs.class || '', style: {}, width: +(attrs.width || 300), height: +(attrs.height || 150),
      captured: [], rect: opts.rect ? Object.assign({}, opts.rect) : { left: 0, top: 0, width: 100, height: 100 },
      classList: { set: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), add(...c) { c.forEach((x) => this.set.add(x)); }, remove(...c) { c.forEach((x) => this.set.delete(x)); }, contains(c) { return this.set.has(c); }, toggle(c, on) { const want = on === undefined ? !this.set.has(c) : !!on; if (want) this.set.add(c); else this.set.delete(c); return want; } },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((f) => f !== fn); },
      dispatch(type, init) { const ev = Object.assign({ type, target: this, currentTarget: this, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, pointerId: 1, clientX: 0, clientY: 0, button: 0 }, init || {}); for (const fn of (this.listeners[type] || []).slice()) fn.call(this, ev); const on = this['on' + type]; if (typeof on === 'function') on.call(this, ev); return ev; },
      click() { return this.dispatch('click'); },
      focus() {}, blur() {}, select() {},
      setPointerCapture(id) { this.captured.push(id); }, releasePointerCapture() {}, hasPointerCapture() { return true; },
      getBoundingClientRect() { const r = this.rect; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; },
      getContext: () => e._ctx || (e._ctx = noopCtx()),
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = v; byId.set(v, this); } },
      removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return k in this.attrs; },
      querySelector(sel) { return query(this, sel)[0] || null; },
      querySelectorAll(sel) { return query(this, sel); },
      getElementsByClassName(c) { return all(this).filter((x) => x.classList.contains(c)); },
      appendChild(c) { this.children.push(c); c.parent = c.parentNode = this; return c; },
      append(...cs) { cs.forEach((c) => (typeof c === 'object' ? this.appendChild(c) : null)); },
      insertBefore(c) { return this.appendChild(c); },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      remove() { if (this.parent) this.parent.removeChild(this); },
      replaceChildren(...cs) { this.children = []; this.append(...cs); },
      closest(sel) { let n = this; while (n && n.tagName) { if (matches(n, sel)) return n; n = n.parent; } return null; },
      contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parent; } return false; },
      scrollIntoView() {},
      get firstChild() { return this.children[0] || null; },
      get innerHTML() { return html; }, set innerHTML(v) { html = String(v); this.children = []; },
      get offsetWidth() { return this.rect.width; }, get offsetHeight() { return this.rect.height; },
      get clientWidth() { return this.rect.width; }, get clientHeight() { return this.rect.height; },
    };
    if (e.id) byId.set(e.id, e);
    return e;
  };
  const docEl = mk('html', {}, null);
  let body = null, head = null;
  const scripts = [];
  function parseInto(root, htmlText) {
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(htmlText))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { let n = cur; while (n && n.tagName !== tag.toUpperCase()) n = n.parent; if (n && n.parent) cur = n.parent; continue; }
    if (tag === 'html') continue;
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g)) attrs[a[1].toLowerCase()] = a[3] != null ? a[3] : a[4] != null ? a[4] : (a[2] || '');
    const node = mk(tag, attrs, cur);
    cur.children.push(node);
    if (tag === 'body') body = node;
    if (tag === 'head') head = node;
    if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title') {
      const end = htmlText.indexOf('</' + tag, re.lastIndex);
      const inner = htmlText.slice(re.lastIndex, end < 0 ? htmlText.length : end);
      if (tag === 'script') scripts.push(attrs.src ? { src: attrs.src } : { inline: inner });
      else node.textContent = inner;
      re.lastIndex = end < 0 ? htmlText.length : end;
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = node;
    else continue;
    // simple text content for leaf-ish elements
    const close = htmlText.indexOf('<', re.lastIndex);
    const txt = htmlText.slice(re.lastIndex, close < 0 ? htmlText.length : close).trim();
    if (txt) node.textContent = txt;
  }
  }
  parseInto(docEl, htmlText);
  body = body || mk('body', {}, docEl);
  head = head || mk('head', {}, docEl);
  const docListeners = {}, winListeners = {};
  const rafs = [];
  const store = new Map();
  const document = {
    documentElement: docEl, body, head, hidden: false, visibilityState: 'visible', readyState: 'complete',
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => query(docEl, sel)[0] || null,
    querySelectorAll: (sel) => query(docEl, sel),
    getElementsByTagName: (t) => query(docEl, t),
    createElement: (tag) => mk(tag, {}, null),
    createElementNS: (ns, tag) => mk(tag, {}, null),
    createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: () => mk('fragment', {}, null),
    addEventListener: (ev, fn, o) => { (docListeners[ev] = docListeners[ev] || []).push({ fn, capture: o === true || !!(o && o.capture) }); },
    removeEventListener: (ev, fn) => { docListeners[ev] = (docListeners[ev] || []).filter((l) => l.fn !== fn); },
    // capture listeners first; stopPropagation() in one keeps the event from the bubble listeners
    dispatch(type, init) {
      let stopped = false;
      const ev = Object.assign({ type, target: body, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } }, init || {});
      const ls = (docListeners[type] || []).slice();
      for (const l of ls.filter((x) => x.capture)) l.fn(ev);
      if (!stopped) for (const l of ls.filter((x) => !x.capture)) { l.fn(ev); if (stopped) break; }
      return ev;
    },
    getElementsByClassName: (c) => all(docEl).filter((x) => x.classList.contains(c)),
  };
  const win = {
    document, console, Math, JSON, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Map, Set, WeakMap, Symbol, Uint8Array, Uint8ClampedArray, Int16Array, Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, ArrayBuffer, DataView, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, TextEncoder, TextDecoder, Infinity, NaN,
    setTimeout: opts.setTimeout || setTimeout, clearTimeout: opts.clearTimeout || clearTimeout, setInterval: opts.setInterval || (() => 0), clearInterval: () => {},
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    matchMedia: (q) => ({ matches: !!(opts.media && opts.media[q]), addEventListener() {}, addListener() {} }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { userAgent: 'node', maxTouchPoints: 0, vibrate() {} },
    location: { href: 'about:blank', hash: '', search: '' },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => { winListeners[ev] = (winListeners[ev] || []).filter((f) => f !== fn); },
    dispatch(type, init) { const ev = Object.assign({ type, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, init || {}); for (const fn of (winListeners[type] || []).slice()) fn(ev); return ev; },
    Image: function () { return mk('img', {}, null); },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  Object.assign(win, opts.globals || {});
  win.window = win; win.self = win; win.globalThis = win;
  const vmc = require('vm').createContext(win);
  return {
    win, document, scripts, rafs, vmc,
    // fragment(html): rendered markup as elements (to click what a page painted)
    fragment(html) { const box = mk('div', {}, null); parseInto(box, String(html)); return box; },
    frame(ts) { const fns = rafs.splice(0); for (const fn of fns) fn(ts); return fns.length; },
    run(code, filename) { return require('vm').runInContext(code, vmc, { filename: filename || 'inline.js' }); },
  };
}

function recCtx() {
  const log = []; let t = { x: 0, y: 0 }; const stack = [];
  const api = {
    save() { stack.push(Object.assign({}, t)); }, restore() { t = stack.pop() || { x: 0, y: 0 }; },
    translate(x, y) { t.x += x; t.y += y; }, setTransform() { t = { x: 0, y: 0 }; },
    measureText: (s) => ({ width: String(s).length * 7 }),
    getImageData: () => { log.push(['getImageData']); return { data: new Uint8ClampedArray(4) }; },
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx = new Proxy(api, {
    get: (o, k) => (k in o ? o[k] : (...a) => { log.push([k, t.x, t.y, ...a.map((v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))]); }),
    set: (o, k, v) => { o[k] = v; if (k === 'fillStyle') log.push(['fillStyle', v]); return true; },
  });
  return { ctx, log };
}
function bootCoil(opts) {
  opts = opts || {};
  const clock = { t: 1e6 };
  class PageDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  const menuCss = [];
  const jq = () => {
    const mk = (sel) => { const o = new Proxy({}, { get: (t, k) => {
      if (k === 'width') return () => 830; if (k === 'height') return () => 440; if (k === 'text') return () => ''; if (k === 'length') return 1;
      if (k === 'css') return (v) => { if (sel === '#menu') menuCss.push(v); return o; };
      return (...a) => { const cb = a.find((x) => typeof x === 'function'); if (cb) { try { cb.call({}); } catch (e) {} } return o; };
    } }); return o; };
    const $ = (s) => mk(s); $.proxy = (f, c) => f.bind(c); return $;
  };
  const puts = []; let back = null;
  const gifos = opts.noDb ? undefined : {
    db: () => { if (opts.dbThrows) throw new Error('invented storage failure'); return { get: () => Promise.resolve(null), put: (r) => { puts.push(r); return Promise.resolve(); } }; },
    onBack: (fn) => { back = fn; },
  };
  const globals = { $: jq(), jQuery: jq(), Math: seededMath(opts.seed || 7), Date: PageDate, gifos, innerWidth: opts.w || 1280, innerHeight: opts.h || 800,
    performance: { now: () => clock.t }, alert: () => {} };
  if (opts.touch) globals.ontouchstart = null;
  const dom = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), { globals });
  const world = dom.document.getElementById('world');
  const rec = recCtx();
  world.getContext = (k) => (k === '2d' ? rec.ctx : null);
  if (opts.rect) world.rect = opts.rect;
  const fx = dom.document.getElementById('effects');
  if (fx) fx.getContext = () => null;
  let error = null;
  try { for (const s of dom.scripts) if (s.src && s.src !== 'vendor/jquery.min.js') dom.run(fs.readFileSync(path.join(APP, s.src), 'utf8'), s.src); } catch (e) { error = e; }
  const step = (n) => { for (let i = 0; i < (n || 1); i++) { clock.t += 16; dom.frame(clock.t); } };
  return { dom, rec, step, error, puts, menuCss, back: () => back, win: dom.win, $: (id) => dom.document.getElementById(id) };
}
function seededMath(seed) {
  let a = seed >>> 0;
  const m = Object.create(Math);
  m.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return m;
}
const lastFrame = (b) => { const L = b.rec.log; b.rec.log.length = 0; b.step(1); return JSON.stringify(L); };
const started = (opts) => { const b = bootCoil(opts); b.step(2); b.$('start-button').click(); b.step(2); return b; };
{
  const b = bootCoil();
  check('the page boots (core.js and the game load in page order)', !b.error && !!b.win.CoilCore && !!b.win.CoilAPI, b.error && String(b.error));
  const btn = b.$('start-button');
  check('Start Game is a button, not href=#', !!btn && btn.tagName === 'BUTTON' && !('href' in btn.attrs));
  b.step(2);
  b.rec.log.length = 0; b.step(3);
  const hudBg = (log) => log.some((c) => c[0] === 'fillRect' && c[3] === 0 && c[4] === 0 && c[6] === 30);
  check('…no HUD on the welcome screen', !hudBg(b.rec.log));
  btn.click();
  check('…and clicking it starts a run', b.win.CoilAPI.isPlaying() === true);
  b.rec.log.length = 0; b.step(1);
  check('the HUD is drawn from the first playing frame, not after the first point', b.win.CoilAPI.score() === 0 && hudBg(b.rec.log));
  // the live game encloses with CoilCore.pointInPoly
  let polys = 0; const pip = b.win.CoilCore.pointInPoly; b.win.CoilCore.pointInPoly = function () { polys++; return pip.apply(this, arguments); };
  b.rec.log.length = 0;
  for (let i = 0; i < 240; i++) { const a = (i * 2 * Math.PI) / 24; b.win.CoilAPI.setPointer(450 + Math.cos(a) * 70, 255 + Math.sin(a) * 70); b.step(1); }
  check('the live game encloses with CoilCore.pointInPoly, not getImageData', polys > 0 && !b.rec.log.some((c) => c[0] === 'getImageData'), { polys });
  // stop reports the score to the shell
  const stops = []; b.win.CoilOnStop = (s) => stops.push(s);
  b.win.CoilAPI.stop();
  check('a run that stops hands its score to the shell (CoilOnStop)', stops.length === 1 && typeof stops[0] === 'number');
}
{
  // a finger maps through the canvas's own rect: a canvas shown at half size
  // still puts its centre at the world's centre
  const rect = { left: 20, top: 10, width: 450, height: 255 };
  const A = started({ rect, seed: 11 }); A.dom.document.dispatch('pointermove', { clientX: 20 + 225, clientY: 10 + 127.5, pointerType: 'mouse' });
  const B = started({ rect, seed: 11 }); B.win.CoilAPI.setPointer(450, 255);
  const C = started({ rect, seed: 11 }); C.win.CoilAPI.setPointer(225, 127.5);
  for (let i = 0; i < 30; i++) { A.step(1); B.step(1); C.step(1); }
  const fa = lastFrame(A), fb = lastFrame(B), fc = lastFrame(C);
  check('a finger maps through pointerToWorld (canvas rect, not assumed 900×510)', fa === fb && fa !== fc);
  // a thumb: pointermove with pointerType touch steers the trail
  const T = started({ rect, seed: 11 });
  const N = started({ rect, seed: 11 });
  for (let i = 0; i < 20; i++) { T.dom.document.dispatch('pointermove', { clientX: 60 + i * 8, clientY: 60 + i * 4, pointerType: 'touch' }); T.step(1); N.step(1); }
  check('pointermove is bound so a thumb steers the trail', lastFrame(T) !== lastFrame(N));
}
{
  // the shell: best score through gifos.db, Back, a db failure shown
  const b = bootCoil();
  b.win.CoilOnStop(420);
  check('the high score is written through gifos.db', b.puts.some((r) => r.id === 'best' && r.score === 420), b.puts);
  b.step(2); b.$('start-button').click();
  check('Back from a live run returns to the menu', typeof b.back() === 'function' && b.back()() === true && b.win.CoilAPI.isPlaying() === false);
  check('…and Back on the menu lets the OS go back', b.back()() === false);
  const bad = bootCoil({ dbThrows: true });
  bad.win.CoilOnStop(10);
  check('a db failure is shown, not swallowed into a blank menu', bad.$('db-err').hidden === false && !!bad.$('db-err').textContent.trim());
  check('…and a healthy save shows no error', b.$('db-err').hidden === true);
}
{
  // a phone: the menu fits the field, and the HUD fits the width
  const p = bootCoil({ touch: true, w: 390, h: 760 });
  const last = p.menuCss[p.menuCss.length - 1] || {};
  check('the phone menu is not locked at 830px (it fits the field)', last.width > 0 && last.width <= 390 - 16, last);
  p.step(2); p.$('start-button').click(); p.rec.log.length = 0; p.step(2);
  const texts = p.rec.log.filter((c) => c[0] === 'fillText').map((c) => c[1] + c[4] + String(c[3]).length * 7);
  check('the HUD compacts on a phone so SCORE is not clipped (every HUD text ends inside 390px)', texts.length > 0 && Math.max(...texts) <= 390, texts);
  // TEXT-CHECK: the menu's phone layout is a CSS media query and the canvas's
  // gesture setting is CSS; only a browser applies them.
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  check('…with the phone stylesheet (max-width 640px) and touch-action none', /@media\s*\(max-width:\s*640px\)/.test(css) && /touch-action:\s*none/.test(css));
}
{
  const doc = bootCoil().dom.document;
  const els = doc.querySelectorAll('*');
  check('no share widgets, no remote at load',
    !els.some((e) => /facebook|twitter/i.test(e.id + ' ' + e.className)) &&
    els.every((e) => !/^(https?:)?\/\//i.test(e.attrs.src || '') && !/^(https?:)?\/\//i.test(e.attrs.href || '')));
}
{
  const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  check('listing author is Hakim, not GifOS', listing.author && listing.author.name !== 'GifOS' && listing.basedOn && listing.porter);
  check('db is declared and multiplayer is not', manifest.capabilities && manifest.capabilities.db === true && !manifest.capabilities.multiplayer);
}

if (failures) {
  console.log('\n' + failures + ' FAIL');
  process.exit(1);
}
console.log('\nAll PASS');
