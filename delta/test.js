// Delta has to actually fly, fire, and remember the best.
//
// vendor/delta.js is Jake Gordon's engine (DOM-bound). Player motion, fire
// cooldown and scoring are deterministic given the inputs, so we load the
// shipped Game.Math + a mocked document just far enough to construct the
// engine, then HOLD a direction and assert the ship moved (at the C64
// speeds). The phone pad (touch.js) and the shell (boot.js: Back, best in the
// file, mute) are RUN in a fake browser built from index.html and driven with
// pointer events and a fake gifos db. The phone CSS is read as parsed rules.
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
  return m;
}

function el(id) {
  const cls = { zero: 0, one: 0, two: 0, three: 0 };
  const node = {
    id: id || '',
    style: { display: '' },
    className: '',
    textContent: '',
    innerHTML: '',
    src: '',
    width: 1024,
    height: 768,
    nodeType: 1,
    childNodes: [],
    parentNode: null,
    _extended: false,
    classList: {
      add: (c) => { cls[c] = 1; node.className = Object.keys(cls).filter((k) => cls[k]).join(' '); },
      remove: (c) => { cls[c] = 0; node.className = Object.keys(cls).filter((k) => cls[k]).join(' '); },
      contains: (c) => !!cls[c],
      toggle: (c, on) => { if (on == null) on = !cls[c]; cls[c] = on ? 1 : 0; },
    },
    getContext: () => ({
      fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
      beginPath() {}, closePath() {}, fill() {}, stroke() {}, fillText() {},
      strokeText() {}, arc() {}, translate() {}, rotate() {}, moveTo() {}, lineTo() {},
      rect() {}, clip() {}, setTransform() {}, measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      putImageData() {}, getImageData: () => ({ data: [] }),
      set fillStyle(v) {}, set strokeStyle(v) {}, set globalAlpha(v) {},
      set font(v) {}, set lineWidth(v) {}, set textAlign(v) {},
      set textBaseline(v) {}, set globalCompositeOperation(v) {},
    }),
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { node.childNodes.push(c); if (c) c.parentNode = node; return c; },
    removeChild(c) { node.childNodes = node.childNodes.filter((x) => x !== c); return c; },
    setAttribute() {}, getAttribute() { return ''; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 156, height: 156 }),
    querySelector() { return el('x'); },
    querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    children: [],
  };
  return node;
}

function loadEngine() {
  const byId = {};
  ['delta', 'canvas', 'booting', 'title', 'start', 'prepare', 'sound', 'scoreboard', 'best', 'instructions'].forEach((id) => { byId[id] = el(id); });
  const lives = el('lives');
  lives.className = 'lives three';
  lives.toggleClassName = function (n, on) { this.classList.toggle(n, on); };
  const scoreVal = el('value');
  const scoreboard = byId.scoreboard;
  function qs(sel) {
    if (String(sel).indexOf('lives') >= 0) return lives;
    if (String(sel).indexOf('value') >= 0) return scoreVal;
    if (sel && sel[0] === '#') return byId[sel.slice(1)] || null;
    return null;
  }
  scoreboard.querySelector = qs;
  scoreboard.querySelectorAll = (sel) => {
    const n = qs(sel);
    return n ? [n] : [];
  };

  const document = {
    body: el('body'),
    documentElement: el('html'),
    nodeType: 9,
    getElementById: (id) => byId[id] || null,
    querySelector: qs,
    querySelectorAll: (sel) => { const n = qs(sel); return n ? [n] : []; },
    getElementsByTagName: (tag) => tag === 'html' ? [document.documentElement] : [],
    createElement: (tag) => {
      const n = el(tag);
      n.tagName = String(tag).toUpperCase();
      Object.defineProperty(n, 'src', {
        set: function () { if (n._onload) n._onload(); },
        get: function () { return ''; },
      });
      n.addEventListener = function (type, fn) { if (type === 'load') n._onload = fn; };
      return n;
    },
    createTextNode: (t) => ({ nodeType: 3, text: t }),
    addEventListener() {},
  };

  function Sizzle(sel, context) {
    const s = String(sel || '');
    if (s.charAt(0) === '#' && s.indexOf(' ') < 0 && s.indexOf('.') < 0) {
      const n = (context && context.getElementById) ? context.getElementById(s.slice(1)) : document.getElementById(s.slice(1));
      return n ? [n] : [];
    }
    const n = document.querySelector(s);
    return n ? [n] : [];
  }
  Sizzle.matches = function () { return []; };

  const sandbox = {
    console, Math: seededMath(0xDE17A), Object, Array, JSON, Date, String, Number, Boolean,
    parseInt, parseFloat, isNaN, undefined,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    navigator: { userAgent: 'Mozilla/5.0 test', maxTouchPoints: 0 },
    document, HTMLElement: function HTMLElement() {}, Event: function Event() {},
    performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { sandbox._raf = fn; return 1; },
    AudioFX: { mute: false },
    localStorage: {},
    innerWidth: 1024, innerHeight: 768,
    addEventListener() {},
    DELTA_ASSETS: {},
    gifos: null,
    Sizzle,
    StateMachine: {
      create: function (cfg, fsm) {
        fsm.current = 'none';
        fsm.is = function (state) {
          return (state instanceof Array) ? state.indexOf(this.current) >= 0 : this.current === state;
        };
        fsm.can = function () { return true; };
        fsm.cannot = function () { return false; };
        (cfg.events || []).forEach(function (e) {
          fsm[e.name] = function () {
            const from = fsm.current;
            const to = e.to;
            fsm.current = to;
            if (fsm.onenterstate) fsm.onenterstate(e.name, from, to);
            const hook = fsm['on' + e.name] || fsm['onenter' + to];
            if (fsm['onleave' + from]) fsm['onleave' + from]();
            if (fsm['onenter' + to]) fsm['onenter' + to]();
            if (fsm['on' + e.name]) fsm['on' + e.name]();
          };
        });
        return fsm;
      }
    },
    PubSub: { enable: function () {} },
    FPSMeter: function () { return { tickStart: function () {}, tick: function () {} }; },
    Animator: { apply: function () { return { play: function () {}, stop: function () {} }; } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('vendor/game.js'), sandbox, { filename: 'game.js' });
  vm.runInContext(read('vendor/delta.js'), sandbox, { filename: 'delta.js' });
  vm.runInContext('Delta();', sandbox, { filename: 'Delta()' });
  return sandbox;
}

const html = read('index.html');
const css = read('style.css');
const help = read('help.md');

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
// touch.js alone, in the page's own DOM, with a stand-in player and engine.
function padRig(o) {
  o = o || {};
  const W = fakeWindow(html, { touch: !!o.phone, quiet: true });
  W.w.player = {};
  let starts = 0;
  W.w.engine = { isTitle: () => !!o.title, start: () => { starts++; } };
  W.run('touch.js', read('touch.js'));
  const pad = W.$('dpad');
  pad.clientWidth = 156; pad.clientHeight = 156;
  return { W, pad, fire: W.$('t-fire'), p: W.w.player, starts: () => starts };
}
async function shell() {
  {
    const t = padRig({ phone: true });
    check('on a phone the pad is shown at once', t.W.$('touch').hidden === false && t.W.dom.document.body.classList.contains('touch'));
    t.pad.dispatch('pointerdown', { pointerId: 7, clientX: 156, clientY: 78 });
    check('touch.js drives the pad from pointer events, and captures the pointer', t.p.movingRight === true && t.p.movingLeft === false && t.pad.captured === 7);
    t.pad.dispatch('pointermove', { pointerId: 7, clientX: 0, clientY: 78 });
    check('touch.js writes player.movingLeft/Right from the pointer', t.p.movingLeft === true && t.p.movingRight === false);
    t.pad.dispatch('pointermove', { pointerId: 7, clientX: 150, clientY: 0 });
    check('diagonals: pad sets two axes from one pointer', t.p.movingRight === true && t.p.movingUp === true && t.p.movingDown === false);
    t.pad.dispatch('pointermove', { pointerId: 9, clientX: 78, clientY: 156 });
    check('…a second finger does not steer the captured pad', t.p.movingUp === true);
    t.pad.dispatch('pointermove', { pointerId: 7, clientX: 80, clientY: 80 });
    check('…the dead zone in the middle holds still', !t.p.movingLeft && !t.p.movingRight && !t.p.movingUp && !t.p.movingDown);
    t.pad.dispatch('pointermove', { pointerId: 7, clientX: 78, clientY: 156 });
    t.pad.dispatch('pointerup', { pointerId: 7 });
    check('…and letting go stops the ship', !t.p.movingDown && !t.p.movingUp);
    t.fire.dispatch('pointerdown', { pointerId: 3 });
    check('FIRE held sets player.firing', t.p.firing === true && t.fire.classList.contains('on'));
    t.fire.dispatch('pointerup', { pointerId: 3 });
    check('…and releasing it stops', t.p.firing === false && !t.fire.classList.contains('on'));
  }
  {
    const t = padRig({ phone: false, title: true });
    check('on a desktop the pad stays hidden until a touch', t.W.$('touch').hidden === true);
    t.W.w.dispatch('touchstart');
    check('…a first touch reveals it', t.W.$('touch').hidden === false);
    t.fire.dispatch('pointerdown', { pointerId: 1 });
    check('FIRE on the title screen starts a game', t.starts() === 1);
  }
  // boot.js: Back, the best score in the file, and mute — with a stand-in engine.
  function shellRig(row) {
    const dbs = { prefs: new Map(row ? [['save', row]] : []) };
    const W = fakeWindow(html, { dbs, quiet: true });
    const state = { quit: 0, playing: false };
    W.w.Game = {};
    W.w.AudioFX = { mute: false };
    W.w.Delta = function () {
      W.w.engine = { storage: W.w.Game.storage(), isPlaying: () => state.playing, isPreparing: () => false, isTitle: () => !state.playing, quit: () => { state.quit++; state.playing = false; }, start() {} };
      W.w.player = { score: 0 };
    };
    W.run('boot.js', read('boot.js'));
    return { W, state, dbs };
  }
  {
    const t = shellRig(null);
    await flushAsync();
    t.state.playing = true;
    check('Back during a game quits to the title (consumed)', t.W.back() === true && t.state.quit === 1);
    check('…Back at the title lets the OS close', t.W.back() === false && t.state.quit === 1);
    t.W.w.player.score = 4321;
    await wait(500);
    const row = t.dbs.prefs.get('save');
    check('best score is written to gifos.db prefs', !!row && row.best === 4321, row);
    const r = shellRig(row);
    await flushAsync();
    check('…and the next open shows it', /4321/.test(r.W.$('best').textContent), r.W.$('best').textContent);
    const legacy = shellRig({ id: 'save', data: { best: 555 } });
    await flushAsync();
    check('saved best still loads from an older save (data.best)', /555/.test(legacy.W.$('best').textContent), legacy.W.$('best').textContent);
    const muted = shellRig({ id: 'save', data: { mute: true } });
    await flushAsync();
    const loud = shellRig({ id: 'save', data: { mute: false } });
    await flushAsync();
    check('mute comes from the file, both ways (never forced on boot)', muted.W.w.AudioFX.mute === true && muted.W.w.engine.storage.mute === true && loud.W.w.AudioFX.mute === false);
    [t, r, legacy, muted, loud].forEach((x) => x.W.stop());
  }
}

{
  const C = cssRules(css);
  check('d-pad is a 156px disc with four arrows (Eagle Defense sized)',
    cssValue(C, '#dpad', 'width') === '156px' && cssValue(C, '#dpad', 'border-radius') === '50%'
    && ['up', 'down', 'left', 'right'].every((d) => C.some((r) => r.sel === '.d-' + d && ['left', 'right', 'top', 'bottom'].filter((k) => k in r.decl).length === 2)));
  check('FIRE is a 92px circle', cssValue(C, '#t-fire', 'width') === '92px' && cssValue(C, '#t-fire', 'border-radius') === '50%');
  check('phone layout reserves pad space so the field is not covered', /188px/.test(cssValue(C, 'body.touch #delta', 'margin-bottom') || '') && /188px/.test(cssValue(C, 'body.touch #delta', 'height') || ''));
  // TEXT-CHECK: the OS owns Invite; an in-app copy is a label with no behaviour to run.
  check('no in-app Invite/Share button', !/<button[^>]*>\s*Invite/i.test(html));
  check('help.md is a real page (a title and some sections)', /^# \S/.test(help.trim()) && help.trim().length >= 200);
}

let engineOk = false;
try {
  const sb = loadEngine();
  check('Game.Math loads', !!(sb.Game && sb.Game.Math && sb.Game.Math.overlap && sb.Game.Math.bound));
  if (sb.Game && sb.Game.Math) {
    check('overlap is true for nested boxes', sb.Game.Math.overlap(0, 0, 10, 10, 5, 5, 2, 2));
    check('overlap is false for separated boxes', !sb.Game.Math.overlap(0, 0, 10, 10, 20, 20, 2, 2));
    check('bound clamps', sb.Game.Math.bound(-5, 0, 10) === 0 && sb.Game.Math.bound(15, 0, 10) === 10);
  }
  check('Delta() exported engine + player', !!(sb.engine && sb.player));
  if (sb.engine && sb.player) {
    engineOk = true;
    const p = sb.player;
    p.reset(true);
    if (sb.bullets && sb.bullets.reset) sb.bullets.reset();
    const x0 = p.x, y0 = p.y, s0 = p.score;
    p.movingRight = true;
    p.movingDown = true;
    p.firing = true;
    p.dead = false;
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    check('holding right MOVES the ship', p.x > x0 + 8, { from: x0, to: p.x });
    check('holding down MOVES the ship', p.y > y0 + 8, { from: y0, to: p.y });
    check('holding fire spends the cooldown (a shot was attempted)', p.cooldown > 0 || (sb.bullets && sb.bullets.pool), p.cooldown);
    p.increaseScore(250);
    check('increaseScore raises the run score', p.score === s0 + 250, { score: p.score });
    p.setLives(2);
    check('setLives keeps a whole number of lives', p.lives === 2, p.lives);
    p.x = 0; p.movingLeft = true; p.movingRight = false;
    for (let i = 0; i < 20; i++) p.update(1 / 60);
    check('the ship cannot leave the left bound', p.x >= p.minx, { x: p.x, minx: p.minx });
    // The C64 numbers, MEASURED: half a second at full stick is 100 px
    // across (200 px/s) and 150 px down (300 px/s), from x = 50.
    p.reset(true);
    const sx = p.x, sy = p.y;
    p.movingLeft = false; p.movingUp = false; p.movingRight = true; p.movingDown = true; p.firing = false;
    for (let i = 0; i < 30; i++) p.update(1 / 60);
    check('vendor still flies at the C64 numbers (200/300 px/s from x=50)', sx === 50 && Math.abs(p.x - sx - 100) < 1.5 && Math.abs(p.y - sy - 150) < 1.5, { sx, dx: p.x - sx, dy: p.y - sy });
    // Sounds: shoot/explode go to DeltaSfx; mute is read from storage.
    const heard = [];
    sb.DeltaSfx = { shoot: () => heard.push('shoot'), explode: () => heard.push('explode') };
    sb.engine.storage.mute = false;
    sb.sounds.reset();
    sb.sounds.play(sb.sounds.sounds.shoot); sb.sounds.play(sb.sounds.sounds.explode);
    sb.sounds.play(sb.sounds.sounds.title); sb.sounds.play(sb.sounds.sounds.game);
    check('shoot/explode hook DeltaSfx; title/game music are silent (no SID path)', heard.join(',') === 'shoot,explode', heard);
    check('an unmuted file boots unmuted', sb.AudioFX.mute === false);
    sb.engine.storage.mute = true;
    sb.sounds.reset();
    check('a muted file boots muted (isMute from storage, not forced)', sb.AudioFX.mute === true);
  }
} catch (e) {
  check('engine loads in a vm (player can be driven)', false, String(e && e.stack || e).slice(0, 400));
}

if (!engineOk) {
  check('holding right MOVES the ship', false);
}

shell().catch((e) => { failures++; console.log('FAIL — shell crashed: ' + (e && e.stack || e)); }).then(() => {
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll PASS — delta core loop holds.');
  process.exit(0);
});
