// PAC-MAN HAS TO ACTUALLY MOVE, EAT, AND BE HUNTED.
//
// mumuy's engine is a canvas Game() with 12 mazes and four ghosts on a
// finder. The GIF shipped a pad that stayed hidden until the first
// touch, a Back-on-title that STARTED a run (it sent Space), and a
// high-score save that forgot the furthest maze. This suite boots the
// shipped engine in a vm with a fake 2d context, presses Start, and
// asserts the yellow one leaves its tile and the score goes up — the
// loop a thumb is asked to play. The shell (pad, hold, swipe, Back, save,
// roster) is boot.js run in a small fake DOM built from index.html, driven
// against a recording stand-in for the engine.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function seededMath(seed) {
  let a = seed >>> 0;
  const m = Object.create(Math);
  m.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  m.floor = Math.floor; m.abs = Math.abs; m.max = Math.max; m.min = Math.min;
  m.sin = Math.sin; m.cos = Math.cos; m.PI = Math.PI; m.sqrt = Math.sqrt;
  return m;
}

function load() {
  let now = 10000;
  let raf = null;
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new FakeDate(...args);
    if (args.length) return new Date(...args);
    return new Date(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = Date.parse;
  FakeDate.UTC = Date.UTC;

  const ctx2d = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
    textAlign: 'left', textBaseline: 'alphabetic',
    fillRect: function () {}, clearRect: function () {},
    beginPath: function () {}, closePath: function () {},
    arc: function () {}, fill: function () {}, stroke: function () {},
    moveTo: function () {}, lineTo: function () {}, quadraticCurveTo: function () {},
    save: function () {}, restore: function () {},
    fillText: function () {},
    measureText: function (t) { return { width: String(t).length * 8 }; },
    getImageData: function (x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(4, (w * h * 4) | 0)), width: w, height: h };
    },
    putImageData: function () {},
  };
  const canvas = {
    width: 960, height: 640, style: {},
    getContext: function (t) { return t === '2d' ? ctx2d : null; },
    addEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 960, height: 640 }; },
  };
  const listeners = {};
  const sandbox = {
    console, Math: seededMath(0x0A60), Object, Array, JSON,
    Date: FakeDate, String, Number, Boolean,
    parseInt, parseFloat, isNaN, Infinity, NaN,
    setTimeout: function (fn) { fn(); return 0; },
    clearTimeout: function () {},
    requestAnimationFrame: function (cb) { raf = cb; return 1; },
    cancelAnimationFrame: function () { raf = null; },
    navigator: { userAgent: 'node' },
    KeyboardEvent: function KeyboardEvent(type, init) {
      this.type = type;
      this.keyCode = (init && init.keyCode) || 0;
      this.bubbles = true;
      this.cancelable = true;
      this.preventDefault = function () {};
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    getElementById: function (id) { return id === 'canvas' ? canvas : null; },
    addEventListener: function (t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
  };
  sandbox.window.addEventListener = sandbox.document.addEventListener;
  sandbox.window.dispatchEvent = function (e) {
    (listeners[e.type] || []).forEach(function (fn) { fn(e); });
    return true;
  };
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'index.js'), 'utf8'), sandbox, { filename: 'index.js' });
  sandbox.__pump = function (n) {
    for (let i = 0; i < n; i++) {
      now += 20;
      if (raf) raf(now);
    }
  };
  sandbox.__now = function (t) { if (t != null) now = t; return now; };
  return sandbox;
}

const sandbox = load();
const Pacman = sandbox.Pacman;
check('engine loads and exposes Pacman', !!(Pacman && Pacman.score && Pacman.steer && Pacman.phase));
check('title + 12 mazes + game-over = 14 stages', Pacman.game.getStages().length === 14,
  Pacman.game.getStages().length);
check('boots on the title, five lives, score 0',
  Pacman.phase() === 'title' && Pacman.life() === 5 && Pacman.score() === 0,
  { phase: Pacman.phase(), life: Pacman.life(), score: Pacman.score() });

function start() {
  Pacman._key = 32;
  sandbox.window.dispatchEvent(new sandbox.KeyboardEvent('keydown', { keyCode: 32 }));
  Pacman._key = 0;
  sandbox.__pump(8);
}

{
  start();
  check('Space on the title starts maze 1', Pacman.phase() === 'play' && Pacman.stageIndex() === 1,
    { phase: Pacman.phase(), stage: Pacman.stageIndex() });
  const p = Pacman.player();
  check('the yellow one spawns', !!(p && p.x && p.y), p && { x: p.x, y: p.y });
  const x0 = p.x, y0 = p.y, s0 = Pacman.score();
  Pacman.steer(2); // left — the spawn corridor
  sandbox.__pump(160);
  const p2 = Pacman.player();
  check('the yellow one MOVES when steered', p2 && (Math.abs(p2.x - x0) > 40 || Math.abs(p2.y - y0) > 40),
    p2 && { from: [x0, y0], to: [p2.x, p2.y] });
  check('eating pellets raises the score', Pacman.score() > s0,
    { from: s0, to: Pacman.score() });
}

{
  const stage = Pacman.game.getStages()[Pacman.stageIndex()];
  const ghosts = stage.getItemsByType(2);
  check('four ghosts are in the maze', ghosts.length === 4, ghosts.length);
  const moved = ghosts.filter((g) => Math.abs(g.x - 320) > 8 || Math.abs(g.y - 290) > 8);
  check('the ghosts leave the house and hunt', moved.length >= 2,
    ghosts.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y), path: (g.path || []).length })));
  const hunting = ghosts.filter((g) => g.path && g.path.length > 0);
  check('ghost AI has a path to the player', hunting.length >= 1, hunting.length);
}

{
  const stages = Pacman.game.getStages();
  const mazes = stages.slice(1, -1).filter((st) => st.maps && st.maps.length > 0);
  check('twelve playable mazes sit between the title and game-over', mazes.length === 12, mazes.length);
}

// Finder on a tiny open grid — the same Map.finder the ghosts call.
{
  const stage = Pacman.game.getStages()[1];
  const map = stage.maps[0];
  const path = map.finder({
    map: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
    start: { x: 0, y: 0 },
    end: { x: 2, y: 2 },
  });
  check('finder returns a walkable path', Array.isArray(path) && path.length > 0, path);
}

// Pause is Space during play; Space on title already consumed.
{
  check('still in play before pause', Pacman.phase() === 'play', Pacman.phase());
  Pacman._key = 32;
  sandbox.window.dispatchEvent(new sandbox.KeyboardEvent('keydown', { keyCode: 32 }));
  Pacman._key = 0;
  sandbox.__pump(4);
  check('Space during play pauses', Pacman.phase() === 'pause', Pacman.phase());
}

// ---- a tiny fake DOM, built from the app's own index.html ---------------------
// Enough of the DOM for an app's chrome to boot and be driven in node: the
// element tree with ids/classes/attributes, events, click(), simple
// selectors, and a canvas whose 2d context records nothing.
function fakeDom(html) {
  const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
  const ctx2d = (cv) => new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) });
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'canvas') return cv;
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  class El {
    constructor(tag, attrs) {
      this.tagName = String(tag).toUpperCase();
      this.attrs = Object.assign({}, attrs || {});
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.style = {};
      this.dataset = {};
      this._text = '';
      this.value = this.attrs.value !== undefined ? this.attrs.value : '';
      this.hidden = 'hidden' in this.attrs;
      this.disabled = 'disabled' in this.attrs;
      this.checked = 'checked' in this.attrs;
      this.width = +this.attrs.width || 300; this.height = +this.attrs.height || 150;
      for (const k of Object.keys(this.attrs)) if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = this.attrs[k];
      const self = this;
      this.classList = {
        _s() { return new Set((self.attrs.class || '').split(/\s+/).filter(Boolean)); },
        _w(s) { self.attrs.class = [...s].join(' '); },
        add(...c) { const s = this._s(); c.forEach((x) => s.add(x)); this._w(s); },
        remove(...c) { const s = this._s(); c.forEach((x) => s.delete(x)); this._w(s); },
        contains(c) { return this._s().has(c); },
        toggle(c, on) { const s = this._s(); const want = on === undefined ? !s.has(c) : !!on; if (want) s.add(c); else s.delete(c); this._w(s); return want; },
      };
      this.clicks = 0;
    }
    get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
    get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
    get type() { return this.attrs.type || ''; } set type(v) { this.attrs.type = v; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._html = undefined; this._text = String(v); }
    get innerHTML() { return this._html !== undefined ? this._html : this.textContent; }
    set innerHTML(v) { this.children = []; this._html = String(v); this._text = String(v).replace(/<[^>]*>/g, ''); }
    get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
    get firstChild() { return this.children[0] || null; }
    get ownerDocument() { return doc; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
    hasAttribute(k) { return k in this.attrs; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    append(...cs) { cs.forEach((c) => (typeof c === 'string' ? (this._text += c) : this.appendChild(c))); }
    prepend(c) { c.parentNode = this; this.children.unshift(c); }
    insertBefore(c, ref) { const i = this.children.indexOf(ref); c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    replaceChildren(...cs) { this.children = []; this._text = ''; cs.forEach((c) => this.appendChild(c)); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { const l = this.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
    dispatchEvent(e) {
      e.target = e.target || this; e.currentTarget = this;
      if (!e.preventDefault) e.preventDefault = () => { e.defaultPrevented = true; };
      if (!e.stopPropagation) e.stopPropagation = () => { e.stopped = true; };
      for (const fn of (this.listeners[e.type] || []).slice()) fn.call(this, e);
      const on = this['on' + e.type]; if (typeof on === 'function') on.call(this, e);
      if (e.bubbles && !e.stopped && this.parentNode) this.parentNode.dispatchEvent(Object.assign(e, { currentTarget: null }));
      return !e.defaultPrevented;
    }
    click() { this.clicks++; this.dispatchEvent({ type: 'click', bubbles: true, isTrusted: true }); }
    focus() {} blur() {} select() {} scrollIntoView() {}
    setPointerCapture() {} releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }; }
    get clientWidth() { return this.width; } get clientHeight() { return this.height; }
    get offsetWidth() { return this.width; } get offsetHeight() { return this.height; }
    getContext() { return (this._ctx = this._ctx || ctx2d(this)); }
    toDataURL(mime) { return 'data:' + (mime || 'image/png') + ';base64,AAAA'; }
    toBlob(cb, mime) { cb({ size: 4, type: mime || 'image/png' }); }
    matches(sel) { return sel.split(',').some((s) => matchOne(this, s.trim())); }
    closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
    querySelectorAll(sel) {
      const out = [];
      const parts = sel.split(',').map((s) => s.trim().split(/\s+/));
      (function walk(n) { for (const c of n.children) { if (parts.some((p) => matchChain(c, p))) out.push(c); walk(c); } })(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementsByTagName(t) { return this.querySelectorAll(t); }
    getElementsByClassName(c) { return this.querySelectorAll('.' + c); }
  }
  function matchOne(el, s) {
    if (!el || !el.tagName) return false;
    const m = s.match(/^([a-zA-Z0-9*-]*)((?:[#.][\w-]+|\[[^\]]+\])*)$/);
    if (!m) return false;
    if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
    const rest = m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || [];
    return rest.every((r) => {
      if (r[0] === '#') return el.id === r.slice(1);
      if (r[0] === '.') return el.classList.contains(r.slice(1));
      const a = r.slice(1, -1).match(/^([\w-]+)(?:([~^$*]?=)["']?([^"']*)["']?)?$/);
      if (!a) return false;
      const v = el.getAttribute(a[1]);
      if (!a[2]) return v !== null;
      if (a[2] === '=') return v === a[3];
      if (a[2] === '^=') return v !== null && v.startsWith(a[3]);
      return v !== null && v.includes(a[3]);
    });
  }
  function matchChain(el, chain) {
    if (!matchOne(el, chain[chain.length - 1])) return false;
    let i = chain.length - 2, n = el.parentNode;
    while (i >= 0 && n) { if (matchOne(n, chain[i])) i--; n = n.parentNode; }
    return i < 0;
  }
  const doc = new El('#document');
  const root = new El('html');
  doc.appendChild(root);
  // parse
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  let cur = root, m;
  while ((m = re.exec(body))) {
    if (m[3] !== undefined) { if (cur !== root) cur._text += m[3].replace(/\s+/g, ' '); continue; }
    const tag = m[1].toLowerCase();
    if (tag === 'html' || tag === '!doctype') continue;
    if (m[0][1] === '/') { let n = cur; while (n && n.tagName !== tag.toUpperCase()) n = n.parentNode; if (n && n.parentNode) cur = n.parentNode; continue; }
    const attrs = {};
    const ar = /([^\s=>\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
    while ((a = ar.exec(m[2] || ''))) attrs[a[1].toLowerCase()] = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '';
    const el = new El(tag, attrs);
    cur.appendChild(el);
    if (!VOID.has(tag) && !/\/>$/.test(m[0])) cur = el;
  }
  doc.documentElement = root;
  doc.body = root.querySelector('body') || root.appendChild(new El('body'));
  doc.head = root.querySelector('head') || root.appendChild(new El('head'));
  doc.getElementById = (id) => root.querySelector('#' + id);
  doc.createElement = (t) => new El(t);
  doc.createElementNS = (ns, t) => new El(t);
  doc.createTextNode = (t) => { const e = new El('#text'); e._text = String(t); return e; };
  doc.createDocumentFragment = () => new El('#fragment');
  doc.querySelector = (s) => root.querySelector(s);
  doc.querySelectorAll = (s) => root.querySelectorAll(s);
  doc.visibilityState = 'visible';
  doc.hidden = false;
  doc.El = El;
  return doc;
}

// ---- shell: pad, hold, swipe, Back, save, roster ---------------------------
// boot.js runs against a stand-in engine that records every keydown and
// steer(), with a phase/score the test sets.
function bootShell(opts) {
  opts = opts || {};
  const doc = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  const timers = [];
  let raf = null;
  const rows = {}; const puts = []; const subs = {};
  const db = (name) => { rows[name] = rows[name] || {}; return {
    get: (id) => (opts.loadFails ? Promise.reject(new Error('x')) : Promise.resolve(rows[name][id] || null)),
    put: (row) => { rows[name][row.id] = row; puts.push([name, JSON.parse(JSON.stringify(row))]); (subs[name] || []).forEach((f) => f(Object.values(rows[name]))); return Promise.resolve(); },
    subscribe: (fn) => { (subs[name] = subs[name] || []).push(fn); fn(Object.values(rows[name])); return () => {}; },
  }; };
  if (opts.seed) for (const [c, r] of opts.seed) { rows[c] = rows[c] || {}; rows[c][r.id] = r; }
  const gifos = { back: null, db, onBack(fn) { gifos.back = fn; }, me: () => Promise.resolve({ id: opts.meId || 'local', name: 'Tester' }) };
  const engine = {
    keys: [], steers: [], ph: opts.phase || 'title', sc: 0, lives: 5, stage: 1,
    phase() { return engine.ph; }, score() { return engine.sc; }, life() { return engine.lives; },
    stageIndex() { return engine.stage; }, game: { getStages: () => new Array(14) },
    steer(o) { engine.steers.push(o); }, _key: 0,
  };
  const winL = {};
  const win = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, parseInt, parseFloat,
    document: doc, Pacman: engine, gifos,
    innerWidth: opts.width || 1280, innerHeight: opts.height || 800,
    KeyboardEvent: function (type, init) { this.type = type; this.keyCode = init.keyCode; },
    addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); },
    dispatchEvent(e) { if (e.type === 'keydown') engine.keys.push(e.keyCode); (winL[e.type] || []).forEach((f) => f(e)); return true; },
    getComputedStyle: () => ({ display: 'none' }),
    matchMedia: (q) => ({ matches: (!!opts.coarse && /coarse/.test(q)) || ((opts.width || 1280) <= 720 && /max-width/.test(q)) }),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    requestAnimationFrame: (fn) => { raf = fn; return 1; },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(APP, 'boot.js'), 'utf8'), win, { filename: 'boot.js' });
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setImmediate(r)); timers.splice(0).forEach((f) => f()); } };
  const frame = (n) => { for (let i = 0; i < (n || 1); i++) { const f = raf; raf = null; if (f) f(); } };
  const $ = (id) => doc.getElementById(id);
  const ptr = (el, type, x, y, kind) => el.dispatchEvent({ type, clientX: x || 0, clientY: y || 0, pointerType: kind || 'touch', pointerId: 1 });
  return { doc, win, gifos, engine, rows, puts, settle, frame, $, ptr };
}

const shellTests = [];
const shell = (fn) => shellTests.push(fn);

shell(async () => {
  const S = bootShell({ width: 1280, phase: 'play' });
  await S.settle();
  check('a wide mouse screen keeps the pad away', S.doc.body.classList.contains('mouse') && !S.doc.body.classList.contains('touch'));
  check('a wide screen shows the whole cabinet, uncropped', S.$('canvas').style.marginLeft === '0' && S.$('stage').style.width === '');
  S.doc.dispatchEvent({ type: 'touchstart' });
  check('the first touch reveals the pad', S.doc.body.classList.contains('touch') && S.$('touch').hidden === false);
});

shell(async () => {
  const P = bootShell({ width: 400, height: 800, phase: 'play' });
  await P.settle();
  check('a narrow screen shows the pad at load, before any touch', P.doc.body.classList.contains('touch') && P.$('touch').hidden === false);
  const C = bootShell({ width: 1280, coarse: true });
  await C.settle();
  check('a coarse pointer shows the pad at load, before any touch', C.doc.body.classList.contains('touch'));
  const stageW = parseFloat(P.$('stage').style.width), canvasW = parseFloat(P.$('canvas').style.width);
  check('a narrow cabinet crops to the maze: the stage is narrower than the canvas, which shifts left',
    stageW > 0 && stageW < canvasW && parseFloat(P.$('canvas').style.marginLeft) < 0, { stageW, canvasW, ml: P.$('canvas').style.marginLeft });
  check('the cropped maze fits the screen width', stageW <= 400, stageW);
});

shell(async () => {
  const S = bootShell({ width: 400, phase: 'play' });
  await S.settle();
  const btns = S.$('touch').querySelectorAll('[data-key]');
  const codes = btns.map((b) => +b.getAttribute('data-key')).sort((a, b) => a - b);
  check('the pad has four directions and pause', JSON.stringify(codes) === JSON.stringify([32, 37, 38, 39, 40]), codes);
  for (const b of btns) {
    const code = +b.getAttribute('data-key');
    S.engine.keys.length = 0;
    S.ptr(b, 'pointerdown'); S.ptr(b, 'pointerup');
    check('pad ' + code + ' sends key ' + code + ' to the engine', S.engine.keys.includes(code), S.engine.keys);
  }
  const left = btns.find((b) => b.getAttribute('data-key') === '37');
  S.engine.steers.length = 0;
  S.ptr(left, 'pointerdown');
  const afterPress = S.engine.steers.length;
  S.frame(5);
  check('holding a direction re-steers every frame', S.engine.steers.length - afterPress >= 5 && S.engine.steers.every((o) => o === 2), S.engine.steers);
  S.ptr(left, 'pointerup');
  const n = S.engine.steers.length;
  S.frame(5);
  check('letting go stops the steering', S.engine.steers.length === n, S.engine.steers.length - n);
});

shell(async () => {
  const S = bootShell({ width: 400, phase: 'play' });
  await S.settle();
  const stage = S.$('stage');
  const swipe = (dx, dy) => { S.engine.keys.length = 0; S.engine.steers.length = 0; S.ptr(stage, 'pointerdown', 100, 100); S.ptr(stage, 'pointerup', 100 + dx, 100 + dy); };
  swipe(80, 5);  check('swipe right turns right', S.engine.keys.includes(39) && S.engine.steers[0] === 0, S.engine.keys);
  swipe(-80, 5); check('swipe left turns left', S.engine.keys.includes(37) && S.engine.steers[0] === 2, S.engine.keys);
  swipe(5, 80);  check('swipe down turns down', S.engine.keys.includes(40) && S.engine.steers[0] === 1, S.engine.keys);
  swipe(5, -80); check('swipe up turns up', S.engine.keys.includes(38) && S.engine.steers[0] === 3, S.engine.keys);
  swipe(3, 3);   check('a tap on the maze during play does not turn', S.engine.keys.length === 0, S.engine.keys);
  S.engine.ph = 'title';
  swipe(3, 3);   check('a tap on the maze on the title starts a run', S.engine.keys.includes(32), S.engine.keys);
  S.engine.ph = 'play';
  S.engine.keys.length = 0;
  S.ptr(stage, 'pointerdown', 100, 100, 'mouse'); S.ptr(stage, 'pointerup', 200, 100, 'mouse');
  check('a mouse drag is not a swipe', S.engine.keys.length === 0, S.engine.keys);
});

shell(async () => {
  const S = bootShell({ phase: 'play' });
  await S.settle();
  check('Back is handled by the shell', typeof S.gifos.back === 'function');
  S.engine.keys.length = 0;
  check('Back during play is handled', S.gifos.back() === true);
  check('Back during play pauses (sends Space)', JSON.stringify(S.engine.keys) === '[32]', S.engine.keys);
  S.engine.ph = 'title'; S.engine.keys.length = 0;
  check('Back on the title is left to GifOS', S.gifos.back() === false);
  check('Back on the title does NOT start a run', S.engine.keys.length === 0, S.engine.keys);
});

shell(async () => {
  const S = bootShell({ phase: 'play', seed: [['save', { id: 'hi', score: 500 }]] });
  await S.settle();
  S.frame(1);
  check('an old {id:hi, score} save still loads', S.$('hi').textContent.includes('500'), S.$('hi').textContent);
  S.engine.sc = 300; S.frame(1);
  check('a lower score does not overwrite the best', !S.puts.some(([c, r]) => c === 'save' && r.score < 500), S.puts);
  S.engine.sc = 800; S.engine.stage = 4; S.frame(1);
  const last = S.puts.filter(([c]) => c === 'save').pop();
  check('a new best score AND the furthest maze are saved as id hi', !!last && last[1].id === 'hi' && last[1].score === 800 && last[1].bestLevel === 4, last);
  S.engine.sc = 100; S.engine.stage = 6; S.frame(1);
  const l2 = S.puts.filter(([c]) => c === 'save').pop();
  check('a further maze with a lower score still saves, keeping the best score', l2[1].bestLevel === 6 && l2[1].score === 800, l2);
});

shell(async () => {
  const S = bootShell({ phase: 'play', meId: 'p-me', seed: [['players', { id: 'p-other', name: 'Other', score: 12, life: 3, maze: 2 }]] });
  await S.settle();
  S.engine.sc = 40; S.frame(1);
  const mine = S.puts.filter(([c, r]) => c === 'players' && r.id === 'p-me').pop();
  check('my cabinet row is published to the players roster', !!mine && mine[1].score >= 0 && mine[1].maze >= 1, S.puts);
  check('the roster shows when another player is on the cabinet', S.$('roster').hidden === false && (S.$('roster').innerHTML.match(/class="row/g) || S.$('roster').textContent).length > 0);
  const L = bootShell({ phase: 'play' });
  await L.settle();
  L.engine.sc = 40; L.frame(1);
  check('alone and offline, nothing is published and no roster shows', !L.puts.some(([c]) => c === 'players') && L.$('roster').hidden === true);
});

// ---- static scans of shipped files (policy, not wording) -------------------
{
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const boot = fs.readFileSync(path.join(APP, 'boot.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(APP, 'vendor', 'index.js'), 'utf8');
  const gameJs = fs.readFileSync(path.join(APP, 'vendor', 'game.js'), 'utf8');
  // TEXT-CHECK: the media query shows the pad before boot.js runs; node has
  // no layout engine to apply it, so the stylesheet rule is read.
  check('CSS shows the pad on a coarse pointer / narrow screen without waiting for touch',
    /pointer:\s*coarse/.test(css) && /max-width:\s*720px/.test(css));
  // TEXT-CHECK: Invite is OS chrome; a control that must not exist has no
  // behaviour to drive, so the parsed DOM is searched for it.
  const dom = fakeDom(html);
  check('no in-app Invite button', !dom.querySelectorAll('button').some((b) => /invite/i.test(b.textContent + ' ' + b.id)));
  // TEXT-CHECK: trademark and offline policy over the shipped code.
  check('no Namco / Bandai in the running product',
    !/Namco|NAMCO|Bandai/.test(gameJs + indexJs + boot + html));
  check('no CDN font / remote fetch in the engine',
    !/FontFace|PressStart2P|https?:/.test(indexJs.replace(/https:\/\/(passer-by\.com|github\.com)[^\s"']*/g, '')));
}

(async () => {
  for (const t of shellTests) await t();
if (failures) {
  console.log('\n' + failures + ' FAIL');
  process.exit(1);
}
console.log('\nAll PASS');
process.exit(0);
})().catch((e) => { console.log('FAIL — threw', e && e.stack); process.exit(1); });
