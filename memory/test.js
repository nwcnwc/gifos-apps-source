// MEMORY HAS TO PLAY THE SEQUENCE.
//
// Mnimi's rules (4 pads, extra at 7 and 14, speed 2500→550) shipped as a
// DOM toy with no suite. A guest Invite Start rolled a private seed, so the
// "same sequence" race was a lie, and a tap was a click — late on a phone.
// This suite PLAYS the exported engine: start, demo → play, tap the sequence,
// miss the wrong pad, keep best, keep a seed identical across two devices.
// Then the real page is BOOTED in a fake browser and played with pointer
// events: two windows share the match db to race one sequence, Back stops a
// round, the best survives a reopen. The phone CSS is read as parsed rules.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function el() {
  return {
    addEventListener() {},
    setAttribute() {},
    textContent: '',
    hidden: true,
    innerHTML: '',
    className: '',
    disabled: false,
    children: [],
    appendChild() {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    getAttribute() { return '0'; },
  };
}

function load() {
  const nodes = {};
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    parseInt, setTimeout() { return 0; }, clearTimeout() {},
    document: {
      getElementById: (id) => (nodes[id] || (nodes[id] = el())),
      createElement: () => el(),
      addEventListener() {},
    },
    gifos: undefined,
    AudioContext: function () { throw new Error('no audio'); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = load();
const R = sandbox.MemoryRules;
check('app.js loads MemoryRules', !!(R && R.padsFor && R.sequenceOf && R.tap && R.begin));

check('four pads until level 7', R.padsFor(1) === 4 && R.padsFor(7) === 4);
check('six pads after level 7', R.padsFor(8) === 6 && R.padsFor(14) === 6);
check('eight pads after level 14', R.padsFor(15) === 8);
check('speed starts at 2500 and floors at 550', R.speedFor(1) === 2500 && R.speedFor(99) === 550);

{
  const a = R.sequenceOf(1, 8), b = R.sequenceOf(1, 8), c = R.sequenceOf(2, 8);
  check('a seed is deterministic', a.join() === b.join());
  check('a different seed is a different sequence', a.join() !== c.join());
  check('early steps stay on the first four pads', a.slice(0, 7).every((n) => n <= 3), a.slice(0, 7));
}

// ---- play the loop ----------------------------------------------------------
{
  const G = R.create();
  R.begin(G, 42);
  check('Start puts you in demo on a 4-pad level-1 sequence',
    G.phase === 'demo' && G.level === 1 && G.seq.length === 1 && G.pads === 4,
    { phase: G.phase, n: G.seq.length });
  const rIdle = R.tap(G, G.seq[0]);
  check('a tap during the demo is ignored', rIdle.reason === 'not-play' && G.phase === 'demo');

  R.ready(G);
  check('after the demo it is your turn', G.phase === 'play');

  const wrong = G.seq[0] === 0 ? 1 : 0;
  const miss = R.tap(G, wrong);
  check('a wrong pad is a miss and ends the round',
    miss.reason === 'miss' && G.phase === 'over' && miss.expected === G.seq[0],
    miss);

  R.begin(G, 42);
  R.ready(G);
  const ok = R.tap(G, G.seq[0]);
  check('the right pad clears the round and raises the level',
    ok.reason === 'level' && G.level === 2 && G.score === 1 && G.best === 1,
    ok);
  check('level 2 is a 2-step sequence on the same seed',
    G.seq.length === 2 && G.seq[0] === R.sequenceOf(42, 2)[0] && G.phase === 'demo');

  R.ready(G);
  R.tap(G, G.seq[0]);
  const mid = R.tap(G, G.seq[1]);
  check('playing the whole sequence again scores 2',
    mid.reason === 'level' && G.score === 2 && G.best === 2, mid);
}

// Two devices, one seed — the invite race.
{
  const host = R.create(), guest = R.create();
  const seed = 99;
  R.begin(host, seed); R.ready(host);
  R.begin(guest, seed); R.ready(guest);
  check('host and guest are dealt the same sequence',
    host.seq.join() === guest.seq.join());
  R.tap(host, host.seq[0]);
  check('a host tap does not move the guest', guest.step === 0 && guest.score === 0);
  R.tap(guest, guest.seq[0]);
  check('both can clear the same round on their own boards',
    host.score === 1 && guest.score === 1);
}

// Best score is sticky across a new round (the file is the save).
{
  const G = R.create();
  G.best = 12;
  R.begin(G, 7);
  check('Start does not wipe a saved best', G.best === 12 && G.score === 0);
  R.ready(G);
  R.tap(G, G.seq[0]);
  check('a short round does not lower best', G.best === 12 && G.score === 1);
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (el) => +((String(el.textContent).match(/\d+/) || ['NaN'])[0]);
// Math.random → a fixed value, so the seed Start rolls is known to the test.
function fixedMath(v) { const m = Object.create(Math); m.random = () => v; return m; }
const SEED = ((0.25 * 0x7fffffff) | 1);
async function shell() {
  const W = bootApp(APP, { extra: { Math: fixedMath(0.25) } });
  await flushAsync();
  const pads = () => W.$('board').children;
  check('the board starts with four pads', pads().length === 4);
  W.$('start').click();
  await wait(450);
  const seq1 = R.sequenceOf(SEED, 1);
  pads()[seq1[0]].click();
  check('a click is not a tap (it would land late on a phone)', num(W.$('score')) === 0);
  pads()[seq1[0]].dispatch('pointerdown');
  check('a pad tap is pointerdown: the right pad scores', num(W.$('score')) === 1, W.$('score').textContent);
  await wait(900);
  const seq2 = R.sequenceOf(SEED, 2);
  pads()[seq2[0]].dispatch('pointerdown');
  const wrong = seq2[1] === 0 ? 1 : 0;
  pads()[wrong].dispatch('pointerdown');
  const exp = pads()[seq2[1]];
  check('a miss marks the pad you should have hit, and the status names it',
    exp.classList.contains('hint') && pads()[wrong].classList.contains('bad') && W.$('status').textContent.indexOf(exp.getAttribute('aria-label')) !== -1, W.$('status').textContent);
  check('…and Start is offered again', W.$('start').disabled === false);
  await wait(50);
  const best = W.puts.filter((p) => p.db === 'save' && p.row.id === 'best').pop();
  check('best score is written to gifos.db', !!best && best.row.score === 1, best && best.row);
  const R2 = bootApp(APP, { dbs: { save: W.dbs.save } });
  await flushAsync();
  check('…and a reopened file shows it', num(R2.$('best')) === 1, R2.$('best').textContent);

  // Back stops a round, then lets the OS close.
  const B = bootApp(APP, { extra: { Math: fixedMath(0.25) } });
  await flushAsync();
  B.$('start').click();
  await wait(450);
  check('Back during a round stops it (consumed) and offers Start', B.back() === true && B.$('start').disabled === false);
  B.$('board').children[seq1[0]].dispatch('pointerdown');
  check('…a stopped round takes no more taps', num(B.$('score')) === 0);
  check('…and Back again lets the OS close', B.back() === false);

  // Invite: two devices share the match + players dbs. The GUEST presses
  // Start; the seed it publishes starts the HOST on the same sequence.
  const shared = { match: new Map(), players: new Map() };
  const host = bootApp(APP, { dbs: Object.assign({}, shared), me: { id: 'host', name: 'Avery' }, extra: { Math: fixedMath(0.75) } });
  const guest = bootApp(APP, { dbs: Object.assign({}, shared), me: { id: 'guest', name: 'Blake' }, extra: { Math: fixedMath(0.25) } });
  await flushAsync(40);
  check('two players in the room see the versus row', host.$('versus').hidden === false && guest.$('versus').hidden === false);
  guest.$('start').click();
  await flushAsync(10);
  const round = shared.match.get('round');
  check('Invite: whoever Starts publishes the seed (here the guest)', !!round && round.seed === SEED, round);
  await wait(450);
  host.$('board').children[seq1[0]].dispatch('pointerdown');
  guest.$('board').children[seq1[0]].dispatch('pointerdown');
  check('…and both boards race the SAME sequence (the host clears it with the guest\'s seed)', num(host.$('score')) === 1 && num(guest.$('score')) === 1, [host.$('score').textContent, guest.$('score').textContent]);
  check('Invite is OS chrome: the page has no invite control', host.$('invite') === null && !host.dom.document.querySelector('[id*=invite]'));
  const all = [W, R2, B, host, guest].map((x) => x.traps);
  check('no network / eval in play', all.every((t) => t.fetch + t.xhr + t.ws + t.eval + t.fn === 0), all);
  [W, R2, B, host, guest].forEach((x) => x.stop());
}

{
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
  const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
  const C = cssRules(css);
  check('pads have a thumb-sized min-height', cssValue(C, /^\.pad$/, 'min-height') === '72px');
  check('pads and the board use touch-action manipulation', cssValue(C, /^\.pad$/, 'touch-action') === 'manipulation' && cssValue(C, /^#board$/, 'touch-action') === 'manipulation');
  check('6-pad and 8-pad boards are not stuck on two columns',
    cssValue(C, '#board.n6', 'grid-template-columns') === '1fr 1fr 1fr' && cssValue(C, '#board.n8', 'grid-template-columns') === '1fr 1fr 1fr 1fr');
  // TEXT-CHECK: Help is OS chrome; a second in-app How-to-play is a label a
  // user would see, with no behaviour to run.
  check('no second How-to-play button', !/how to play/i.test(html));
  check('unofficial Mnimi, author is Sepand',
    listing.basedOn.name === 'Mnimi' && listing.basedOn.blessed === false &&
    listing.author.name === 'Sepand Haghighi' && listing.porter.name === 'GifOS');
  check('help.md is a real page (a title and some sections)', /^# \S/.test(help.trim()) && (help.match(/^## /gm) || []).length >= 1 && help.trim().length >= 300);
}

shell().catch((e) => { failures++; console.log('FAIL — shell crashed: ' + (e && e.stack || e)); }).then(() => {
  console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
});
