// HEXAHEDRAL HAS TO ACTUALLY SLIDE, AND A LEVEL HAS TO BE WINNABLE.
//
// The 1.0 port was a square-swipe on an isometric field (the cube jumped
// the wrong way on a phone), saved only the level number (no bests), and
// wrapped the last jam level back to Easy. This suite PLAYS the shipped
// engine: one slide, a real win of level 1, isometric drag mapping, a 1.0
// save still loading, and a campaign that ends. DOM wiring a vm cannot run
// is source-scanned.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function load() {
  const sandbox = { console, Math, Object, Array, JSON, Date, String, Number, Boolean };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('levels.js'), sandbox, { filename: 'levels.js' });
  vm.runInContext(read('game.js'), sandbox, { filename: 'game.js' });
  return sandbox;
}

const S = load();
const HEX = S.HEX;
check('levels.js and game.js load and attach HEX', !!(HEX && HEX.create && HEX.moveTo && HEX.isoDir));
check('all 30 jam levels are aboard', HEX.count === 30 && (S.HEX_LEVELS || []).length === 30, HEX.count);

{
  const L = HEX.first;
  check('level 1 is a 2×2 with 3 moves', L && L.tiles.length === 2 && L.tiles[0].length === 2 && L.maxMoves === 3);
  check('the player starts on a down tile', L.tiles[L.playerPosition.row][L.playerPosition.column] === '_');
}

// ---- a slide has to put the cube on a neighbour ---------------------------
{
  const s = HEX.create();
  HEX.loadLevel(s, 0);
  const p0 = { row: s.player.row, column: s.player.column };
  const res = HEX.move(s, 0, -1);
  check('a legal slide is accepted', res.ok === true, res);
  check('the cube MOVES onto the neighbour', s.player.row === p0.row && s.player.column === p0.column - 1,
    { from: p0, to: s.player });
  check('the tile it stepped on toggles', s.tiles[0][0] === '_');
  check('a broken tile refuses the cube', HEX.moveTo(HEX.loadLevel(HEX.create(), 1), 1, 1).ok === false);
  check('a jump of two tiles is refused', HEX.moveTo(HEX.loadLevel(HEX.create(), 0), 1, 0).ok === false);
}

// ---- PLAY: clear level 1 with the same moveTo the GIF runs ----------------
{
  const s = HEX.create();
  HEX.loadLevel(s, 0);
  check('a fresh board is not a win', HEX.remaining(s) === 3);
  const path = [[0, 0], [1, 0], [1, 1]];
  let last = null;
  for (const [r, c] of path) last = HEX.moveTo(s, r, c);
  check('level 1 is won in three slides', last && last.ok && last.won && !last.lost, last);
  check('no pinks remain', HEX.remaining(s) === 0);
  check('the best for level 1 is 3', s.bests[0] === 3, s.bests[0]);
  check('a win on level 1 is not the campaign', last.cleared === false);
}

// ---- isometric drag maps to the cube faces, not the screen axes -----------
{
  const se = HEX.isoDir(40, 40);
  const sw = HEX.isoDir(-40, 40);
  const nw = HEX.isoDir(-40, -40);
  const ne = HEX.isoDir(40, -40);
  check('swipe down-right is +column', se && se.dRow === 0 && se.dCol === 1, se);
  check('swipe down-left is +row', sw && sw.dRow === 1 && sw.dCol === 0, sw);
  check('swipe up-left is −column', nw && nw.dRow === 0 && nw.dCol === -1, nw);
  check('swipe up-right is −row', ne && ne.dRow === -1 && ne.dCol === 0, ne);
  check('a tap is not a swipe', HEX.isoDir(4, 3) == null);
  const drag = HEX.isoDrag(80, 80, 48);
  check('a drag along a face slides the cube partway', drag && drag.dCol > 0.4 && drag.dRow === 0, drag);
}

{
  const s = HEX.create();
  HEX.loadLevel(s, 0);
  HEX.moveTo(s, 0, 0);
  HEX.moveTo(s, 1, 0);
  check('undo takes the cube back a step', HEX.undo(s) && s.player.row === 0 && s.player.column === 0 && s.moves === 1);
  HEX.undo(s);
  check('undo back to the start', s.player.column === 1 && s.moves === 0 && s.status === 'playing');
}

{
  const s = HEX.create();
  HEX.applySave(s, { id: 'progress', level: 4, maxReached: 4 });
  check('a 1.0 save (no bests) still loads the level', s.view === 'play' && s.level === 4 && s.maxReached === 4);
  check('…and does not invent bests', s.bests[4] == null);
  const rec = HEX.toSave(s);
  check('a new save writes bests and the view', Array.isArray(rec.bests) && rec.bests.length === 30 && rec.view === 'play' && rec.id === 'progress');
  const s2 = HEX.create();
  HEX.applySave(s2, { id: 'progress', level: 7, maxReached: 11, bests: [3, 4], view: 'menu' });
  check('bests + menu view round-trip', s2.view === 'menu' && s2.bests[0] === 3 && s2.maxReached === 11 && s2.level === 7);
}

{
  const s = HEX.create();
  HEX.loadLevel(s, 29);
  check('the last jam level loads', s.level === 29 && s.view === 'play');
  const end = HEX.loadLevel(s, 30);
  check('past the last level is a cleared campaign, not a wrap to Easy', end.view === 'cleared' && end.status === 'cleared' && end.level === 29, end.view);
  const win = HEX.create();
  HEX.loadLevel(win, 0);
  HEX.moveTo(win, 0, 0);
  HEX.moveTo(win, 1, 0);
  const last = HEX.moveTo(win, 1, 1);
  check('winning a mid level is not cleared', last.cleared === false);
}

{
  const s = HEX.create();
  HEX.loadLevel(s, 0);
  s.status = 'won';
  check('a won board refuses another slide', HEX.move(s, 1, 0).ok === false);
  HEX.loadLevel(s, 0);
  s.status = 'lost';
  check('a lost board refuses another slide', HEX.move(s, 0, -1).ok === false);
}

// ---- a small fake browser, built from the app's OWN index.html -------------
// Every element with an id in the page exists (tag, attributes, hidden), so
// the app's real boot() finds what it would find in a browser; listeners are
// recorded and dispatch() fires them. Canvas contexts are inert recorders and
// toDataURL names the canvas it came from, so a test can tell which picture
// was saved. Network/camera/eval globals are TRAPS that count calls.
function parseAttrs(s) {
  const a = {};
  for (const m of String(s || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
  return a;
}
function miniDom(html) {
  const byId = new Map();
  const imgSrcs = [];
  const created = [];
  let serial = 0;
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr', 'track', 'param']);
  function classes(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }
  function matches(el, sel) {
    return String(sel).split(',').some((one) => {
      one = one.trim();
      if (one === '*') return true;
      const m = /^([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(one.split(/\s+/).pop());
      if (!m) return false;
      if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
      for (const part of (m[2].match(/[#.][\w-]+/g) || [])) {
        if (part[0] === '#' && el.id !== part.slice(1)) return false;
        if (part[0] === '.' && classes(el).indexOf(part.slice(1)) < 0) return false;
      }
      for (const at of (m[3].match(/\[[^\]]+\]/g) || [])) {
        const [k, v] = at.slice(1, -1).split('=');
        const val = k === 'type' ? el.type : el.getAttribute(k);
        if (val == null) return false;
        if (v != null && String(val) !== v.replace(/^["']|["']$/g, '')) return false;
      }
      return true;
    });
  }
  function camel(k) { return k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase()); }
  function descendants(el) { const out = []; for (const c of el.children || []) { if (c.nodeType !== 1) continue; out.push(c); out.push(...descendants(c)); } return out; }
  function ctx2d(canvas) {
    const calls = [];
    const rec = (name) => function () { calls.push(name); };
    return new Proxy({ canvas, calls,
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
      measureText: (t) => ({ width: String(t).length * 6 }),
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? rec(k) : undefined)), set: (t, k, v) => { t[k] = v; return true; } });
  }
  function make(tag, attrs) {
    attrs = attrs || {};
    const el = {
      tagName: String(tag).toUpperCase(), nodeType: 1, attrs: {}, children: [], parentNode: null, serial: ++serial,
      style: { setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } },
      dataset: {}, _l: {}, _text: '', value: attrs.value || '', type: attrs.type || '',
      hidden: 'hidden' in attrs, disabled: 'disabled' in attrs, checked: 'checked' in attrs,
      width: +attrs.width || 300, height: +attrs.height || 150, className: attrs.class || '', files: null,
      clientWidth: 360, clientHeight: 640, offsetWidth: 360, offsetHeight: 640, scrollTop: 0,
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((g) => g !== f); },
      dispatch(t, ev) {
        // Bubbles like a browser event: this element, its ancestors, then the
        // document's listeners — unless stopPropagation() or bubbles: false.
        const e = Object.assign({ type: t, target: this, currentTarget: this, bubbles: true, cancelable: true, _stop: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; },
          pointerId: 1, button: 0, clientX: 0, clientY: 0 }, ev || {});
        let node = this;
        while (node) {
          e.currentTarget = node;
          (node._l[t] || []).slice().forEach((f) => f.call(node, e));
          if (typeof node['on' + t] === 'function') node['on' + t](e);
          if (e._stop || e.bubbles === false) return e;
          node = node.parentNode;
        }
        (docL[t] || []).slice().forEach((f) => f(e));
        return e;
      },
      click() { this.clicks = (this.clicks || 0) + 1; return this.dispatch('click'); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach((c) => (typeof c === 'object' ? this.appendChild(c) : null)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      replaceChildren(...cs) { this.children = []; this.append(...cs); },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId.set(String(v), this); if (k === 'class') this.className = String(v); if (k.indexOf('data-') === 0) this.dataset[camel(k)] = String(v); },
      getAttribute(k) {
        if (k === 'class') return this.className;
        if (k.indexOf('data-') === 0 && this.dataset[camel(k)] != null) return String(this.dataset[camel(k)]);
        return k in this.attrs ? this.attrs[k] : null;
      },
      hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
      toggleAttribute(k, on) { if (on === undefined ? !(k in this.attrs) : on) this.attrs[k] = ''; else delete this.attrs[k]; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { return descendants(this).filter((e) => matches(e, sel)); },
      closest(sel) { let e = this; while (e) { if (e.nodeType === 1 && matches(e, sel)) return e; e = e.parentNode; } return null; },
      contains(o) { let e = o; while (e) { if (e === this) return true; e = e.parentNode; } return false; },
      focus() { doc.activeElement = this; }, blur() {}, select() {},
      setPointerCapture(id) { this.captured = id; }, releasePointerCapture() { this.captured = null; }, hasPointerCapture() { return this.captured != null; },
      getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; },
      scrollIntoView() {},
      getElementsByClassName(c) { return descendants(this).filter((e) => classes(e).indexOf(c) >= 0); },
      cloneNode() { const c = make(this.tagName.toLowerCase(), Object.assign({}, this.attrs)); if ('src' in this) c.src = this.src; return c; },
      animate() {
        // Web Animations stand-in: play() finishes on the next tick.
        const a = { playState: 'idle', onfinish: null, cancel() { a.playState = 'idle'; }, finish() { a.playState = 'finished'; },
          play() { a.playState = 'running'; setTimeout(() => { a.playState = 'finished'; if (a.onfinish) a.onfinish(); }, 0); } };
        return a;
      },
      getContext(kind) { if (kind && kind !== '2d') return null; return this._ctx || (this._ctx = ctx2d(this)); },
      toDataURL(type) { return 'data:' + (type || 'image/png') + ';base64,' + Buffer.from('canvas#' + this.serial).toString('base64'); },
      toBlob(cb, type) { cb({ type: type || 'image/png', size: 4, canvasSerial: this.serial }); },
    };
    el.classList = {
      add: (...c) => { const s = classes(el); c.forEach((x) => { if (s.indexOf(x) < 0) s.push(x); }); el.className = s.join(' '); },
      remove: (...c) => { el.className = classes(el).filter((x) => c.indexOf(x) < 0).join(' '); },
      toggle: (c, on) => { const has = classes(el).indexOf(c) >= 0; const want = on === undefined ? !has : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
      contains: (c) => classes(el).indexOf(c) >= 0,
    };
    Object.defineProperty(el, 'innerHTML', { get() { return this._html || ''; }, set(v) { this._html = String(v); this.children = []; parseInto(this, this._html, 0); }, configurable: true });
    // textContent: setting it replaces the children (as in a browser);
    // reading it gives the element's own text, else its children's.
    Object.defineProperty(el, 'textContent', {
      get() { return this._text !== '' ? this._text : this.children.map((c) => c.textContent || '').join(''); },
      set(v) { this._text = v == null ? '' : String(v); this.children = []; }, configurable: true,
    });
    Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
    Object.defineProperty(el, 'lastChild', { get() { return this.children[this.children.length - 1] || null; } });
    Object.defineProperty(el, 'id', { get() { return this.attrs.id || ''; }, set(v) { this.setAttribute('id', v); }, configurable: true });
    if (el.tagName === 'IMG') {
      // An <img> in the page loads like new Image(): setting src fires onload.
      let src = attrs.src || '';
      Object.assign(el, { naturalWidth: 64, naturalHeight: 48, width: 64, height: 48, complete: false });
      Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = String(v); imgSrcs.push(src); setTimeout(() => { el.complete = true; el.dispatch('load'); }, 0); }, configurable: true });
    }
    for (const k of Object.keys(attrs)) {
      if (k === 'class') continue;
      el.attrs[k] = attrs[k];
      if (k.indexOf('data-') === 0) el.dataset[camel(k)] = attrs[k];
    }
    if (attrs.id) byId.set(attrs.id, el);
    return el;
  }
  // Parse markup into elements (tags, attributes, nesting; text lands in the
  // nearest element's textContent). Used for the page AND for innerHTML.
  function parseInto(parent, src, from) {
    const stack = [parent];
    const tagRe = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    tagRe.lastIndex = from || 0;
    let m;
    while ((m = tagRe.exec(src))) {
      if (m[5] != null) { const t = m[5].replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '); if (t.trim()) { const top = stack[stack.length - 1]; if (top !== parent || parent.tagName !== 'BODY') top._text = (top._text ? top._text + ' ' : '') + t.trim(); } continue; }
      if (!m[2]) continue;
      const name = m[2].toLowerCase();
      if (name === 'body' || name === 'html' || name === 'head') { if (name === 'body' && !m[1]) Object.assign(body.attrs, parseAttrs(m[3])); continue; }
      if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === name.toUpperCase()) { stack.length = i; break; } continue; }
      const el = make(name, parseAttrs(m[3]));
      stack[stack.length - 1].appendChild(el);
      if (name === 'script' || name === 'style') { const end = src.indexOf('</' + name, tagRe.lastIndex); if (end > 0) tagRe.lastIndex = end; }
      if (!VOID.has(name) && !m[4] && name !== 'script' && name !== 'style') stack.push(el);
    }
  }
  const body = make('body', {});
  const head = make('head', {});
  const root = make('html', {});
  root.appendChild(head); root.appendChild(body);
  const bodyAt = html.search(/<body\b/i);
  parseInto(body, html, bodyAt < 0 ? 0 : bodyAt);
  const docL = {};
  const doc = {
    nodeType: 9, readyState: 'complete', body, head, documentElement: root, activeElement: body, hidden: false, visibilityState: 'visible',
    getElementById: (id) => byId.get(id) || null,
    querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
    getElementsByTagName: (t) => root.querySelectorAll(t), getElementsByClassName: (c) => root.querySelectorAll('.' + c),
    createElement: (t) => { const e = make(t, {}); created.push(e); return e; }, createElementNS: (ns, t) => make(t, {}),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }), createDocumentFragment: () => make('fragment', {}),
    addEventListener: (t, f) => (docL[t] = docL[t] || []).push(f), removeEventListener: (t, f) => { docL[t] = (docL[t] || []).filter((g) => g !== f); },
    dispatch: (t, ev) => { const e = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {}); (docL[t] || []).slice().forEach((f) => f(e)); return e; },
  };
  return { document: doc, make, byId, matches, imgSrcs, created };
}
// The window an app runs in: the fake document, a fake gifos (db rows kept
// in memory so a second boot can read what the first one saved), and traps.
function fakeWindow(html, o) {
  o = o || {};
  const dom = miniDom(html);
  const traps = { fetch: 0, xhr: 0, ws: 0, eval: 0, fn: 0, gum: 0, worker: 0 };
  const dbs = o.dbs || {};
  const puts = [];
  // gifos.db: rows live in a Map that two windows may SHARE (o.dbs), and
  // subscribe() hears every put from either window — a two-device room.
  const db = (name) => {
    const rows = (dbs[name] = dbs[name] || new Map());
    const subs = rows.subs || (rows.subs = []);
    const list = () => [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)));
    const tell = () => subs.slice().forEach((f) => setTimeout(() => f(list()), 0));
    return {
      get: async (id) => (rows.has(id) ? JSON.parse(JSON.stringify(rows.get(id))) : null),
      put: async (row) => {
        const r = JSON.parse(JSON.stringify(row));
        if (r.id == null) r.id = name + '-' + (rows.size + 1);
        puts.push({ db: name, row: r }); rows.set(r.id, JSON.parse(JSON.stringify(r))); tell(); return JSON.parse(JSON.stringify(r));
      },
      delete: async (id) => { rows.delete(id); tell(); }, del: async (id) => { rows.delete(id); tell(); },
      all: async () => list(), list: async () => list(), query: async () => list(), getAll: async () => list(),
      subscribe: (f) => { subs.push(f); setTimeout(() => f(list()), 0); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
      on: () => () => {}, watch: () => () => {},
    };
  };
  let backHandler = null;
  const winL = {};
  const timers = [];
  const images = dom.imgSrcs;
  const gifos = Object.assign({
    db, onBack: (f) => { backHandler = f; }, info: async () => ({ owner: o.owner !== false }), me: async () => (o.me || { id: 'me', name: 'Tester' }),
    takePhoto: async () => { traps.photo = (traps.photo || 0) + 1; return { bytes: new Uint8Array([255, 216, 255]), mime: 'image/jpeg' }; },
    launch: () => Promise.resolve(o.launch || null), ready: () => {}, setTitle: () => {}, haptic: () => {}, vibrate: () => {},
  }, o.gifos || {});
  const w = {
    document: dom.document, gifos, console: o.quiet ? { log() {}, warn() {}, error() {}, info() {} } : console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Promise, Symbol, Map, Set, WeakMap, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, isFinite,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Buffer,
    encodeURIComponent, decodeURIComponent, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, o.maxTimer == null ? 50 : o.maxTimer)), clearTimeout, setInterval: (f, ms) => { const t = setInterval(f, Math.max(ms || 0, 10)); timers.push(t); return t; }, clearInterval,
    requestAnimationFrame: (f) => (o.raf ? o.raf(f) : 0), cancelAnimationFrame: () => {},
    innerWidth: 360, innerHeight: 640, devicePixelRatio: 1, matchMedia: () => ({ matches: !!o.touch, addEventListener() {}, addListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'about:blank', hash: '', search: '', reload() {} },
    navigator: { userAgent: 'test', maxTouchPoints: o.touch ? 5 : 0, vibrate: () => true, onLine: true,
      mediaDevices: { getUserMedia: () => { traps.gum++; return Promise.reject(new Error('trap')); } } },
    addEventListener: (t, f) => (winL[t] = winL[t] || []).push(f), removeEventListener: (t, f) => { winL[t] = (winL[t] || []).filter((g) => g !== f); },
    dispatch: (t, ev) => { const e = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {}); (winL[t] || []).slice().forEach((f) => f(e)); return e; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: () => { traps.fetch++; return new Promise(() => {}); },
    XMLHttpRequest: function () { traps.xhr++; throw new Error('trap: no network'); },
    WebSocket: function () { traps.ws++; throw new Error('trap: no network'); },
    Worker: function () { traps.worker++; throw new Error('trap: no worker'); },
    eval: () => { traps.eval++; throw new Error('trap: no eval'); },
    Image: function () { return dom.make('img', {}); }, // a real fake <img>: setting src fires load
    Blob: function (parts, opt) { this.parts = parts; this.type = (opt && opt.type) || ''; this.size = 4; },
    URL: { createObjectURL: () => 'blob:fake/' + Math.random().toString(36).slice(2), revokeObjectURL() {} },
    FileReader: function () { const r = this; r.readAsDataURL = () => setTimeout(() => { r.result = 'data:image/png;base64,AAAA'; if (r.onload) r.onload({ target: r }); }, 0); r.readAsArrayBuffer = () => setTimeout(() => { r.result = new ArrayBuffer(4); if (r.onload) r.onload({ target: r }); }, 0); },
    performance: { now: () => Date.now() },
    AudioContext: undefined, webkitAudioContext: undefined,
  };
  w.window = w; w.self = w; w.globalThis = w; w.top = w; w.parent = w;
  w.Function = new Proxy(Function, { construct: () => { traps.fn++; throw new Error('trap: no Function'); }, apply: () => { traps.fn++; throw new Error('trap: no Function'); } });
  Object.assign(w, o.extra || {});
  const ctx = vm.createContext(w);
  return {
    w, ctx, dom, traps, dbs, puts, images, $: (id) => dom.document.getElementById(id), back: () => (backHandler ? backHandler() : undefined), hasBack: () => !!backHandler,
    run: (file, code) => vm.runInContext(code, ctx, { filename: file }),
    stop: () => timers.forEach(clearInterval),
  };
}
const flushAsync = async (n) => { for (let i = 0; i < (n || 30); i++) await new Promise((r) => setTimeout(r, 0)); };
// ---- CSS as rules: selector -> declarations (structure, not substrings) -----
// Rules inside an @media block carry that block's prelude in `media`.
function cssRules(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const pre = stack.pop();
      if (pre != null && pre[0] !== '@') {
        const decl = {};
        for (const d of buf.split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
        const media = stack.filter((x) => x[0] === '@').join(' ');
        for (const sel of pre.split(',')) out.push({ sel: sel.trim().replace(/\s+/g, ' '), decl, media });
      }
      buf = '';
    } else buf += ch;
  }
  return out;
}
// The value a property gets on a selector outside any @media (last rule
// wins), or inside the @media whose prelude matches `media`; null if unset.
function cssValue(rules, selTest, prop, media) {
  let v = null;
  for (const r of rules) {
    if (media ? !media.test(r.media) : r.media) continue;
    if ((typeof selTest === 'string' ? r.sel === selTest : selTest.test(r.sel)) && prop in r.decl) v = r.decl[prop];
  }
  return v;
}
// Boot an app the way its page does: every classic <script src> in index.html,
// in order, inside one fake window.
function bootApp(appDir, o) {
  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  const W = fakeWindow(html, o);
  const srcs = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), (m) => m[1]);
  for (const s of srcs) W.run(s, fs.readFileSync(path.join(appDir, s), 'utf8'));
  return W;
}

// ---- the shell, BOOTED from index.html and played -------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const where = (W) => {
  const pl = W.dom.document.querySelector('#level .player');
  const m = pl && /calc\((-?\d+) \*/.exec(pl.style.top || ''), n = pl && /calc\((-?\d+) \*/.exec(pl.style.left || '');
  return m && n ? { row: +m[1], column: +n[1] } : null;
};
// A drag across the stage, in screen pixels, from (100,100).
function drag(W, dx, dy, id) {
  const st = W.$('stage');
  st.dispatch('pointerdown', { pointerId: id || 4, pointerType: 'mouse', clientX: 100, clientY: 100, target: st });
  st.dispatch('pointermove', { pointerId: id || 4, clientX: 100 + dx / 2, clientY: 100 + dy / 2, cancelable: true });
  st.dispatch('pointerup', { pointerId: id || 4, clientX: 100 + dx, clientY: 100 + dy });
  return st;
}
async function shell() {
  const W = bootApp(APP);
  await flushAsync();
  check('first open is the menu', W.$('menu').hidden === false && W.$('level').hidden === true);
  W.dom.document.querySelector('button[data-diff="0"]').click();
  check('Easy opens level 1 on the field', W.$('menu').hidden === true && W.$('level').hidden === false);
  // Level 1: start (0,1); up-left (−column) then down-left (+row) then down-right (+column).
  const st = drag(W, -500, -290);
  check('the field captures a pointer so a drag actually slides (up-left → −column)', st.captured === 4 && JSON.stringify(where(W)) === '{"row":0,"column":0}', where(W));
  check('the field does not yield the gesture to the page', cssValue(cssRules(read('style.css')), 'main#stage', 'touch-action') === 'none');
  const padBefore = W.$('pad').hidden;
  W.w.dispatch('touchstart');
  check('a diamond pad is there for a thumb after the first touch (not before)', padBefore === true && W.$('pad').hidden === false);
  const sw = W.dom.document.querySelector('#pad button[data-dr="1"]');
  W.$('pad').dispatch('pointerdown', { target: sw });
  check('…and its buttons slide the cube (↙ = +row)', JSON.stringify(where(W)) === '{"row":1,"column":0}', where(W));
  W.dom.document.dispatch('keydown', { keyCode: 39 });
  W.dom.document.dispatch('keyup', { keyCode: 39 });
  const ov = W.$('overlay');
  check('the arrow keys move too, and a win is a real overlay with a way on', ov.hidden === false && !!ov.querySelector('button[data-act="next"]'));
  await flushAsync();
  const prog = W.puts.filter((p) => p.db === 'save' && p.row.id === 'progress').pop();
  check('the save writes bests through gifos.db(\'save\')', !!prog && Array.isArray(prog.row.bests) && prog.row.bests[0] === 3, prog && prog.row.bests && prog.row.bests.slice(0, 2));
  ov.dispatch('click', { target: ov.querySelector('button[data-act="next"]') });
  check('…Next goes to level 2', W.$('overlay').hidden === true && W.dom.document.querySelector('#nav button.now').textContent === '2');
  // Lose level 2: burn the moves going back and forth.
  let guard = 0;
  while (W.$('overlay').hidden && guard++ < 40) {
    for (const k of [37, 38, 39, 40]) { W.dom.document.dispatch('keydown', { keyCode: k }); W.dom.document.dispatch('keyup', { keyCode: k }); if (!W.$('overlay').hidden) break; }
  }
  const lostCard = W.$('overlay').querySelector('button[data-act="retry"]');
  check('running out of moves is a real overlay (retry), not a silent wrap', W.$('overlay').hidden === false && !!lostCard && /\blost\b|\bwon\b/.test(W.dom.document.body.className));
  check('Back leaves the field for the menu (consumed)', W.back() === true && W.$('menu').hidden === false && W.$('level').hidden === true);
  check('…and at the menu Back lets the OS close', W.back() === false);
  await flushAsync();
  // Reopen: the level reached and the bests come back with the file.
  const R = bootApp(APP, { dbs: W.dbs });
  await flushAsync();
  check('reopening offers Resume (the level reached is in the file)', R.$('resume').hidden === false);
  R.$('resume').dispatch('click', { target: R.$('resume') });
  R.$('menu').dispatch('click', { target: R.$('resume') });
  check('…and Resume opens it', R.$('level').hidden === false && R.dom.document.querySelector('#nav button.now').textContent === '2');
  const all = [W, R].map((x) => x.traps);
  check('no network / eval in play', all.every((t) => t.fetch + t.xhr + t.ws + t.eval + t.fn === 0), all);
}

{
  const html = read('index.html');
  const C = cssRules(read('style.css'));
  check('a [hidden] menu button stays hidden (display:block must not leak Resume)', cssValue(C, '.difficulty-buttons button[hidden]', 'display') === 'none');
  const D = miniDom(html);
  check('no in-app Invite control', ![...D.byId.keys()].some((x) => /invite/i.test(x)));
  // TEXT-CHECK: an Invite label is copy with no behaviour to run.
  check('no button labelled Invite', !/>\s*Invite\s*</.test(html));
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>/gi), (m) => parseAttrs(m[1]));
  check('game.js is a classic script in the GIF (it ran above in a vm as one)', scripts.some((a) => a.src === 'game.js' && !a.type));
  // help.md / listing wording is copy and is not pinned.
  check('help.md is a real page', /^# \S/.test(read('help.md').trim()) && read('help.md').trim().length >= 200);
}

shell().catch((e) => { failures++; console.log('FAIL — shell crashed: ' + (e && e.stack || e)); }).then(() => {
if (failures) {
  console.log(failures + ' failure(s)');
  process.exit(1);
}
console.log('ok');
  process.exit(0);
});
