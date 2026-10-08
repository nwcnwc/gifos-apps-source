// DUNGEON PARTY HAS TO DROP EXTRA ADVENTURERS INTO THE SAME ROOM.
//
// The listing claims 2–4 players from one Invite. If that is a lie — guest
// never auto-joins, host never simulates them, guest never sees the others —
// the suite has to fail. The original engine is DOM-bound (Prototype, canvas
// sprites, PNG levels) so the GifOS-specific loop lives in net.js: unique
// classes, host party, guest snapshot, nuke once. The shell and the pad are
// booted over a small DOM and pressed; the vendor's key map is run.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function makeEl(id) {
  return {
    id,
    textContent: '',
    hidden: true,
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    style: {},
    addEventListener() {},
  };
}

function FakePlayer() {
  this.netId = null;
  this.slot = 0;
  this.type = null;
  this.moving = {};
  this.x = 0; this.y = 0; this.dir = 0;
  this.health = 500; this.score = 0; this.keys = 0; this.potions = 2;
  this.frame = 0; this.dead = false;
  this.nukes = 0;
  this.firing = false;
}
FakePlayer.prototype.join = function (t) { this.type = t; };
FakePlayer.prototype.onStartLevel = function () {};
FakePlayer.prototype.moveLeft = function (on) { this.moving.left = on; };
FakePlayer.prototype.moveRight = function (on) { this.moving.right = on; };
FakePlayer.prototype.moveUp = function (on) { this.moving.up = on; };
FakePlayer.prototype.moveDown = function (on) { this.moving.down = on; };
FakePlayer.prototype.fire = function (on) { this.firing = on; };
FakePlayer.prototype.nuke = function () { this.nukes++; };

function loadNet() {
  const els = {};
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
    setTimeout: (fn) => { return 0; },
    setInterval: () => 0,
    clearTimeout() {},
    gifos: null,
    GauntletPlayer: FakePlayer,
    GAUNTLET_TYPES: {
      WARRIOR: { name: 'warrior' },
      VALKYRIE: { name: 'valkyrie' },
      WIZARD: { name: 'wizard' },
      ELF: { name: 'elf' },
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => { els[id] = els[id] || makeEl(id); return els[id]; },
      querySelectorAll: () => [],
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.root = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'net.js'), 'utf8'), sandbox, { filename: 'net.js' });
  return sandbox;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

{
  const s = loadNet();
  const Net = s.GauntletNet;
  check('net.js loads GauntletNet', !!(Net && Net.freeType && Net.ensureParty && Net.applyWorld));

  s.game = { player: null, party: [], current: 'menu', map: { nlevel: 1, entities: [] } };
  Net._setIdentity('host', true);
  check('an empty room offers WARRIOR first', Net.freeType() === 'WARRIOR', Net.freeType());

  Net._setOthers([{ id: 'g1', type: 'WARRIOR', seen: Date.now(), l: 1, r: 0, u: 0, d: 0, f: 0, n: 0 }]);
  s.game.player = { type: { name: 'valkyrie' } };
  check('a taken class is not offered', Net.freeType() === 'WIZARD' || Net.freeType() === 'ELF', Net.freeType());
  check('taken() lists the live classes', Net.taken().indexOf('WARRIOR') >= 0 && Net.taken().indexOf('VALKYRIE') >= 0);
}

{
  const s = loadNet();
  const Net = s.GauntletNet;
  Net._setIdentity('host', true);
  const g = {
    player: { type: { name: 'warrior' }, x: 10, y: 10, dir: 0, health: 500, score: 0, keys: 0, potions: 0, frame: 0, dead: false },
    party: [],
    map: { nlevel: 1, entities: [], occupy() {} },
    allPlayers() { return [this.player].concat(this.party); },
  };
  s.game = g;
  Net._setOthers([{ id: 'p2', type: 'VALKYRIE', seen: Date.now(), l: 1, r: 0, u: 0, d: 0, f: 1, n: 0 }]);
  Net.ensureParty(g);
  check('the host SPAWNS the extra adventurer', g.party.length === 1 && g.party[0].type && g.party[0].type.name === 'valkyrie',
    g.party.length);
  check('…and applies their thumbs (left + fire)',
    g.party[0].moving.left === true && g.party[0].firing === true,
    g.party[0].moving);

  Net._setOthers([{ id: 'p2', type: 'VALKYRIE', seen: Date.now(), l: 1, r: 0, u: 0, d: 0, f: 1, n: 1 }]);
  Net.ensureParty(g);
  Net.ensureParty(g);
  check('a held potion nukes ONCE, not every tick', g.party[0].nukes === 1, g.party[0].nukes);
}

{
  const s = loadNet();
  const Net = s.GauntletNet;
  Net._setIdentity('guest', false);
  const started = [];
  s.game = {
    current: 'menu',
    player: null,
    party: [],
    map: null,
    start: function (type, n) { started.push({ type: type.name, n: n }); this.current = 'playing'; this.player = { type: type }; },
  };
  Net._setWorld({ id: 'world', n: 3, p: [{ id: 'host', t: 'WARRIOR', x: 4, y: 8, d: 2, h: 500, s: 0, k: 0, o: 0, fr: 0, dead: false }], e: [] });
  check('a guest AUTO-JOINS a free class in the host dungeon',
    started.length === 1 && started[0].type === 'valkyrie' && started[0].n === 3,
    started);

  const g = {
    player: { type: { name: 'valkyrie' }, x: 0, y: 0, dir: 0, health: 1, score: 0, keys: 0, potions: 0, frame: 0, dead: false },
    party: [],
    map: { nlevel: 3, entities: [{ active: true, type: { sx: 1, sy: 1 }, x: 9, y: 9, frame: 0 }] },
    viewport: { update() {} },
  };
  s.game = g;
  s.GauntletPlayer = FakePlayer;
  Net.applyWorld(g);
  check('a guest paints the host warrior as a party sprite',
    g.party.length === 1 && g.party[0].netId === 'host' && g.party[0].x === 4 && g.party[0].y === 8,
    g.party.map((p) => ({ id: p.netId, x: p.x, y: p.y })));
  check('a guest replaces local monsters with the host snapshot',
    g.map.entities.length === 0 || (g.map.entities.length === 0),
    g.map.entities.length);
}

{
  const s = loadNet();
  const Net = s.GauntletNet;
  Net._setIdentity('guest', false);
  s.game = { current: 'menu', player: null, start() { throw new Error('should not start'); } };
  Net._setOthers([
    { id: 'a', type: 'WARRIOR', seen: Date.now() },
    { id: 'b', type: 'VALKYRIE', seen: Date.now() },
    { id: 'c', type: 'WIZARD', seen: Date.now() },
    { id: 'd', type: 'ELF', seen: Date.now() },
  ]);
  Net._setWorld({ id: 'world', n: 1, p: [
    { id: 'a', t: 'WARRIOR' }, { id: 'b', t: 'VALKYRIE' },
    { id: 'c', t: 'WIZARD' }, { id: 'd', t: 'ELF' },
  ], e: [] });
  check('a fifth friend does not steal a class', Net.freeType() === null, Net.freeType());
}

// ---- the vendor game's own config, RUN --------------------------------------
// gauntlet.js is a factory: Gauntlet() builds the game and its config. It is
// called with the engine's names stubbed (Game.Key codes, Class.create), and
// the key map and sound set it returns are used, not read.
// ---- lifting real functions out of a source file ---------------------------
// matchBrace(text, open): index of the '}' that closes the '{' at `open`,
// skipping strings, template literals, comments and regex literals.
function matchBrace(text, open) {
  let depth = 0;
  const regexOk = (k) => { let b = k - 1; while (b >= 0 && /\s/.test(text[b])) b--; if (b < 0) return true; if ('(,=:[!&|?{};+-*%<>~^'.indexOf(text[b]) >= 0) return true; const w = text.slice(Math.max(0, b - 9), b + 1); return /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new)$/.test(w); };
  for (let k = open; k < text.length; k++) {
    const c = text[k];
    if (c === '{') { depth++; continue; }
    if (c === '}') { if (--depth === 0) return k; continue; }
    if (c === '"' || c === "'") { for (k++; k < text.length && text[k] !== c; k++) if (text[k] === '\\') k++; continue; }
    if (c === '`') {
      for (k++; k < text.length && text[k] !== '`'; k++) {
        if (text[k] === '\\') { k++; continue; }
        if (text[k] === '$' && text[k + 1] === '{') k = matchBrace(text, k + 1);
      }
      continue;
    }
    if (c === '/' && text[k + 1] === '/') { while (k < text.length && text[k] !== '\n') k++; continue; }
    if (c === '/' && text[k + 1] === '*') { k = text.indexOf('*/', k + 2) + 1; continue; }
    if (c === '/' && regexOk(k)) { let cls = false; for (k++; k < text.length; k++) { const d = text[k]; if (d === '\\') { k++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; } continue; }
  }
  return -1;
}
// lift(text, startKey): the source from startKey through the close of the
// first block it opens (a function declaration, an arrow body, a branch).
function lift(text, startKey) {
  const i = text.indexOf(startKey);
  if (i < 0) return null;
  const open = text.indexOf('{', i + startKey.length - 1);
  const close = open < 0 ? -1 : matchBrace(text, open);
  return close < 0 ? null : text.slice(i, close + 1);
}
// sandbox(srcs, names, env): run lifted sources in one scope. Names in `env`
// are the stubs and state the code reads and writes; any other free name
// that is not a JS global becomes a recording no-op (see .calls), so a test
// states only what it observes. Returns the named functions.
function sandbox(srcs, names, env) {
  const calls = [];
  const auto = (name) => new Proxy(function () { calls.push([name, Array.from(arguments)]); }, {
    get(t, k) { if (typeof k === 'symbol' || k in t) return t[k]; return auto(name + '.' + String(k)); },
  });
  const scope = new Proxy(env, {
    has(t, k) { if (typeof k === 'symbol') return false; return (k in t) || !(k in globalThis); },
    get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; return auto(k); },
    set(t, k, v) { t[k] = v; return true; },
  });
  const out = new Function('__scope', 'with (__scope) {\n' + srcs.join('\n') + '\nreturn { ' + names.join(', ') + ' };\n}')(scope);
  out.calls = calls;
  return out;
}

function vendorGame() {
  const keyNames = 'BACKSPACE TAB RETURN ESC SPACE LEFT UP RIGHT DOWN DELETE HOME END PAGEUP PAGEDOWN INSERT ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE A B C D E F G H I J K L M N O P Q R S T U V W X Y Z TILDA'.split(' ');
  const Key = {}; keyNames.forEach((k, i) => { Key[k] = 1000 + i; });
  const classes = [];
  const env = { Game: { Key, Math: new Proxy({}, { get: () => () => 0 }), qsBool: () => false, qsNumber: (n, d) => d, qsValue: (n, d) => d },
    Class: { create: (o) => { classes.push(o); const F = function () {}; F.prototype = o; return F; } }, window: { GAUNTLET_ASSETS: {} } };
  const chain = new Proxy(function () {}, { get: () => () => chain });
  env.$ = () => chain;   // the engine's element helper: chainable, does nothing
  sandbox([src('vendor/gauntlet.js')], [], env);
  return { game: env.Gauntlet(), Key, classes };
}
{
  const V = vendorGame();
  const moves = {};
  for (const [k, m] of [['A', 'moveLeft'], ['D', 'moveRight'], ['W', 'moveUp'], ['S', 'moveDown']]) {
    const entry = V.game.cfg.keys.find((e) => e.key === V.Key[k] && e.mode === 'down');
    const calls = [];
    if (entry) entry.action.call({ player: { [m]: (on) => calls.push(on) } });
    moves[k] = entry && entry.state === 'playing' && calls.join() === 'true';
  }
  check('WASD moves (the game binds A/D/W/S to the four moves while playing)', Object.values(moves).every(Boolean), moves);
  const S = V.classes.find((c) => c.initialize && c.toggleMute);
  const muted = [];
  V.game.subscribe = () => {};   // the runner adds pub/sub when it runs the game
  if (S) { const self = Object.create(S); self.toggleMute = (on) => muted.push(on); S.initialize.call(self, {}); }
  check('the dungeon is silent (no sound files loaded, and the mixer starts muted)', Array.isArray(V.game.cfg.sounds) && V.game.cfg.sounds.length === 0 && muted[0] === true, { sounds: V.game.cfg.sounds, muted });
}
{
  // the asset pack, run: what is aboard
  const box = { window: {} }; box.globalThis = box.window;
  vm.createContext(box);
  vm.runInContext(src('vendor/assets.js'), box);
  const A = box.window.GAUNTLET_ASSETS || box.GAUNTLET_ASSETS || {};
  const names = Object.keys(A);
  check('Namco splash/logo are not packed in assets', names.length > 5 && !names.some((n) => /splash|logo/i.test(n)), names.filter((n) => /\.jpg$/.test(n)));
}

// ---- the shell and the pad, booted ------------------------------------------
// index.html over a small DOM; boot.js and touch.js run with the engine
// (Game.run) and the game object stubbed. The pad is pressed, keys typed,
// Back taken, the save written.
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

function bootShell(opts) {
  opts = opts || {};
  const calls = [];
  const player = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => calls.push(k + ':' + a.join())) });
  const game = { current: opts.state || 'playing', player, is(s) { return this.current === s; },
    quit() { calls.push('quit'); this.current = 'menu'; }, resume() { calls.push('resume'); this.current = 'playing'; }, start() {} };
  const timers = [];
  const puts = []; let back = null;
  const assets = opts.assets || { 'images/key.png': 'data:key', 'images/potion.png': 'data:potion' };
  const dom = fakeDom(src('index.html'), { media: opts.media || {}, globals: {
    GAUNTLET_ASSETS: assets, GAUNTLET_TYPES: {},
    Game: { run: () => { dom.win.game = game; } }, Gauntlet: {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    innerWidth: opts.w || 1280, innerHeight: opts.h || 800,
    gifos: { db: () => ({ get: () => Promise.resolve(null), put: (r) => { puts.push(r); return Promise.resolve(); } }), onBack: (fn) => { back = fn; } },
  } });
  dom.win.navigator.maxTouchPoints = opts.touchPoints || 0;
  for (const f of ['boot.js', 'touch.js']) dom.run(src(f), f);
  return { dom, game, calls, timers, puts, back: () => back, $: (id) => dom.document.getElementById(id) };
}
const flushJG = () => new Promise((r) => setImmediate(r));
(async () => {
  {
    const offered = { 'images/key.png': 'data:key', 'images/potion.png': 'data:potion', 'images/splash.jpg': 'data:SPLASH', 'images/logo.jpg': 'data:LOGO', 'splash.jpg': 'data:SPLASH', 'logo.jpg': 'data:LOGO' };
    const p = bootShell({ assets: offered });
    await flushJG(); await flushJG();
    const els = p.dom.document.querySelectorAll('*');
    check('the arcade splash and wordmark are not in the page (a title card is)',
      !!p.$('title-card') && !els.some((e) => /splash|logo/i.test(e.attrs.src || '')));
    check('boot.js refuses to wire splash/logo even when the pack offers them',
      !els.some((e) => /SPLASH|LOGO/.test(e.src || '')) && els.some((e) => e.src === 'data:key'));
    // the pad
    const btn = (d) => p.dom.document.querySelectorAll('[data-dir]').find((b) => b.getAttribute('data-dir') === d);
    const press = (d) => { const b = btn(d); if (!b) return false; b.dispatch('pointerdown', { pointerId: 3 }); b.dispatch('pointerup', { pointerId: 3 }); return true; };
    p.calls.length = 0;
    const dirs = { up: 'moveUp:true', down: 'moveDown:true', left: 'moveLeft:true', right: 'moveRight:true' };
    const dpad = Object.keys(dirs).every((d) => { p.calls.length = 0; return press(d) && p.calls.includes(dirs[d]); });
    check('the D-pad has four directions, each moving the player', dpad);
    p.calls.length = 0; press('fire');
    const fired = p.calls.includes('fire:true') && p.calls.includes('fire:false');
    p.calls.length = 0; press('potion');
    check('FIRE and POTION exist as pad buttons: FIRE fires while held, POTION nukes', fired && p.calls.includes('nuke:'), p.calls);
    // WASD through the shell
    p.calls.length = 0;
    p.dom.document.dispatch('keydown', { keyCode: 65 }); p.dom.document.dispatch('keyup', { keyCode: 65 });
    p.dom.document.dispatch('keydown', { keyCode: 87 });
    const typed = p.calls.join();
    p.game.current = 'menu'; p.calls.length = 0; p.dom.document.dispatch('keydown', { keyCode: 68 });
    check('…and the shell turns WASD into moves while playing (and not on the menu)', typed === 'moveLeft:true,moveLeft:false,moveUp:true' && p.calls.length === 0, typed);
    // Back
    p.game.current = 'playing';
    const fn = p.back();
    const inPlay = fn && fn(); const quit = p.calls.includes('quit');
    p.game.current = 'help'; const inHelp = fn && fn();
    p.game.current = 'menu'; const onMenu = fn && fn();
    check('Back quits to the menu (from play), closes help, and lets go on the menu', inPlay === true && quit && inHelp === true && p.calls.includes('resume') && onMenu === false, { inPlay, inHelp, onMenu });
    // the save
    const store = p.dom.win.Game.storage();
    store.hi = 5000;
    p.timers.splice(0).forEach((f) => f());
    check('high score is saved through Game.storage wrap (written to gifos.db as the save row)', p.puts.some((r) => r.id === 'save' && r.data && r.data.hi === 5000), p.puts);
    check('Invite is not an in-app share button',
      !els.some((e) => /invite|share/i.test(e.id) || ((e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*(invite|share)\s*$/i.test(e.textContent))));
  }
  {
    const narrow = bootShell({ w: 390, h: 800 });
    const wide = bootShell({ w: 1280, h: 800 });
    const shownNarrow = narrow.$('touch').hidden === false && narrow.dom.document.body.classList.contains('touch');
    const hiddenWide = wide.$('touch').hidden === true;
    wide.dom.win.dispatch('touchstart');
    check('the pad appears on a narrow phone, not only after a finger (and on a wide screen at the first touch)', shownNarrow && hiddenWide && wide.$('touch').hidden === false, { shownNarrow, hiddenWide });
  }
  {
    // TEXT-CHECK: a hit target's size is CSS; only a browser lays it out.
    const css = src('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const decl = {};
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some((x) => x.trim() === '#t-fire')) for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    check('FIRE is a large hit target (at least 92px square)', parseFloat(decl.width) >= 92 && parseFloat(decl.height) >= 92, decl);
  }
  {
    const listing = JSON.parse(src('listing.json'));
    const man = JSON.parse(src('manifest.json'));
    const help = src('help.md');
    check('db + multiplayer are declared', man.capabilities.db === true && man.capabilities.multiplayer === true);
    check('minBuild stays 947', man.minBuild === 947);
    check('author is Jake Gordon', listing.author.name === 'Jake Gordon' && listing.basedOn.blessed === false);
    // TEXT-CHECK: a trademark disclaimer; the words are the deliverable.
    check('listing does not claim a Namco product as ours',
      /not affiliated with namco/i.test(listing.description) && !/namco/i.test(listing.tagline));
    check('tagline fits a card', listing.tagline.length <= 90);
    check('the facing name is not the arcade wordmark', man.name !== 'Gauntlet');
    check('help.md is a real how-to', help.trim().length >= 400);
  }
  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  console.log('\nAll js-gauntlet checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
