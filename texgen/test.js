// TEXGEN HAS TO DRAW, AND THE FILE HAS TO HOLD THE RECIPE.
//
// The store copy is a live editor around mrdoob's generators — not a
// library demo. This suite PLAYS the core loop in a vm: XOR pixels, the
// classic sample stack, preset load, old-save round-trip, empty stack. The
// editor itself is BOOTED from its own index.html in a fake browser and
// driven: layers selected and deleted, sliders moved, PNG pressed, Back,
// the file closed and reopened. The phone CSS is read as parsed rules.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function load() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    Float32Array, Uint8Array, Int32Array,
    document: {
      readyState: 'complete',
      getElementById: () => null,
      createElement: () => ({ getContext: () => null, style: {} }),
      addEventListener: () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/texgen.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const S = load();
const TG = S.TG;
const A = S.TexgenApp;
check('texgen.js and editor load', !!(TG && A && A.SAMPLE && A.SAMPLE.length >= 3));

{
  const t = new TG.Texture(8, 8).add(new TG.XOR());
  const a = t.buffer.array;
  check('XOR(0,0) is 0', Math.abs(a[0] - 0) < 1e-9, a[0]);
  check('XOR(1,0) is 1/8', Math.abs(a[4] - 0.125) < 1e-9, a[4]);
  const u = new TG.Texture(8, 8).add(new TG.XOR().tint(1, 0.5, 0));
  check('tint multiplies the green channel', Math.abs(u.buffer.array[5] - 0.125 * 0.5) < 1e-9);
  const n = new TG.Texture(8, 8).add(new TG.Noise().seed(7));
  check('noise is in 0–1', n.buffer.array[0] > 0 && n.buffer.array[0] <= 1, n.buffer.array[0]);
}

{
  const buf = A.renderBuffer(A.SAMPLE, 16);
  check('classic XOR sample renders a buffer', !!(buf && buf.length === 16 * 16 * 4));
  let sum = 0, i;
  for (i = 0; i < buf.length; i += 4) sum += buf[i] + buf[i + 1] + buf[i + 2];
  check('classic sample is not a black frame', sum > 10, sum);
  const c = A.cloneLayer(A.SAMPLE[0]);
  c.tint[0] = 0;
  check('cloneLayer is a copy, not an alias', A.SAMPLE[0].tint[0] === 1 && c.tint[0] === 0);
}

{
  A.loadState({ layers: A.SAMPLE, at: 1 });
  const rec = A.serializeState();
  check('old save {layers} still round-trips as id:state', rec.id === 'state' && rec.layers.length === 4);
  A.loadState({ layers: [], name: 'Empty', size: 128 });
  check('an empty stack is a real state, not a reset to the sample',
    A.getState().layers.length === 0 && A.getState().size === 128, A.getState());
  A.loadState({
    layers: [{ type: 'XOR', op: 'add', tint: [1, 1, 1], params: {} }],
    name: 'Just XOR', size: 256
  });
  check('a one-layer save loads', A.getState().layers.length === 1 && A.getState().name === 'Just XOR');
}

{
  const twirl = A.PRESETS.filter((p) => p.id === 'twirl')[0];
  check('twirl preset is aboard', !!(twirl && twirl.layers.length >= 2));
  A.applyPreset(twirl, false);
  check('applyPreset(twirl) replaces the stack', A.getState().name === 'Twirl' && A.getState().layers[1].type === 'Twirl', A.getState());
  const buf = A.renderBuffer(A.getState().layers, 32);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum += buf[i] + buf[i + 1] + buf[i + 2];
  check('twirl actually paints', sum > 1, sum);
  A.applyLaunch({ preset: 'classic' });
  check('launch preset=classic restores the XOR sample',
    A.getState().name === 'Classic XOR' && A.getState().layers[0].type === 'XOR', A.getState());
}

{
  const layer = A.cloneLayer({
    type: 'Circle', op: 'add', tint: [1, 1, 1],
    params: { position: [128, 128], radius: 64, delta: 8 }
  });
  A.scaleParams(layer, 256, 512);
  check('spatial params scale with size',
    layer.params.radius === 128 && layer.params.position[0] === 256, layer.params);
}

{
  const ids = A.PRESETS.map((p) => p.id);
  check('presets cover XOR, checkers, twirl, circle — the original examples',
    ids.indexOf('classic') >= 0 && ids.indexOf('checkers') >= 0 &&
    ids.indexOf('twirl') >= 0 && ids.indexOf('circle') >= 0, ids);
  const ops = A.OPS.map((o) => o.id);
  check('every combine op from texgen.js is on the editor',
    ['add', 'set', 'sub', 'mul', 'xor', 'min', 'max'].every((o) => ops.indexOf(o) >= 0), ops);
}

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));

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
async function shell() {
  const W = bootApp(APP);
  await flushAsync();
  const rows = () => W.$('layers').children;
  check('first run paints the sample stack (no empty state)', rows().length === A.SAMPLE.length && W.$('empty').hidden === true, rows().length);
  // A layer whose params are pairs (CheckerBoard size): the labels are words.
  W.$('name').value = 'Board'; W.$('name').dispatch('input');
  const checkers = A.PRESETS.filter((p) => p.id === 'checkers')[0];
  const chips = W.$('presets').querySelectorAll('button');
  const chip = chips[A.PRESETS.indexOf(checkers)];
  if (chip) chip.click();
  await flushAsync();
  const ci = W.$('layers').children.findIndex((r) => r.querySelector('b') && / CheckerBoard$/.test(r.querySelector('b').textContent));
  if (ci >= 0) W.$('layers').children[ci].click();
  const inputs = (W.$('layers').children[ci] || { querySelectorAll: () => [] }).querySelectorAll('input');
  // Tint is 3 sliders; CheckerBoard's own params (size, offset) add more.
  check('params are sliders, not a wall of number boxes', inputs.length > 3 && inputs.every((x) => x.type === 'range'), inputs.map((x) => x.type));
  const labels = inputs.map((x) => x.getAttribute('aria-label'));
  check('param labels are words, not size[0] / size 0', ci >= 0 && labels.length >= 2 && labels.every((l) => l && !/\[\d\]|\s\d$|^size$/.test(l)), labels);
  // Moving a slider repaints and the recipe is saved with the file.
  const slider = (W.$('layers').children[ci] || { querySelectorAll: () => [] }).querySelectorAll('input').filter((x) => x.type === 'range').pop();
  if (slider) { slider.value = String(+slider.value + 1); slider.dispatch('input'); }
  await wait(350);
  const saved = W.puts.filter((p) => p.db === 'save' && p.row.id === 'state').pop();
  check('gifos.db save is the file: the recipe and its name are written to it',
    !!saved && saved.row.layers.length === checkers.layers.length && saved.row.name === 'Checkers', saved && { name: saved.row.name, n: saved.row.layers.length });
  // The delete button on a row is an icon button that removes that layer.
  const before = W.$('layers').children.length;
  const del = W.$('layers').children[0].querySelector('.row-del');
  check('row-del is an icon (an svg glyph), labelled for screen readers', !!del && /^<svg\b/.test(del.innerHTML) && !!del.getAttribute('aria-label'));
  if (del) del.click();
  check('…and pressing it deletes that layer', W.$('layers').children.length === before - 1);
  // Back collapses the open layer first, then lets the OS close.
  W.$('layers').children[0].click();
  const openBefore = W.$('layers').children.some((r) => /\bon\b/.test(r.className));
  const b1 = W.back();
  const openAfter = W.$('layers').children.some((r) => /\bon\b/.test(r.className));
  check('gifos.onBack collapses the open layer (and is consumed)', openBefore && b1 === true && !openAfter);
  check('…then Back lets the OS close', W.back() === false);
  // PNG: a real button that downloads the canvas.
  W.dom.created.length = 0;
  W.$('saveBtn').click();
  const a = W.dom.created.find((e) => e.tagName === 'A');
  check('PNG is a button the thumb can hit: it downloads the canvas as a .png', !!a && a.clicks === 1 && /\.png$/.test(a.download || '') && a.href === W.$('tex').toDataURL('image/png'), a && a.download);
  // An empty stack shows the empty state.
  while (W.$('layers').children.length) W.$('layers').children[0].querySelector('.row-del').click();
  check('empty state is a real element, shown when the stack is empty', W.$('empty').hidden === false && W.$('layers').children.length === 0);
  W.dom.created.length = 0;
  W.$('saveBtn').click();
  check('…and PNG on an empty stack exports nothing', !W.dom.created.some((e) => e.tagName === 'A'));
  await wait(350);
  // Reopen: the file holds the recipe (an empty stack stays empty).
  const R = bootApp(APP, { dbs: W.dbs });
  await flushAsync();
  check('reopening the file restores the saved recipe (here: the empty stack, not the sample)', R.$('layers').children.length === 0 && R.$('empty').hidden === false && R.$('name').value === 'Checkers');
  const L = bootApp(APP, { launch: { preset: 'twirl' } });
  await flushAsync();
  check('launch-to-a-preset opens on that preset', L.$('name').value === 'Twirl' && L.$('layers').children.length === A.PRESETS.filter((p) => p.id === 'twirl')[0].layers.length);
  const all = [W, R, L].map((x) => x.traps);
  check('no eval / Function / fetch / getUserMedia / XHR / WebSocket, the whole session long',
    all.every((t) => t.fetch === 0 && t.xhr === 0 && t.ws === 0 && t.eval === 0 && t.fn === 0 && t.gum === 0), all);
}

{
  const tags = Array.from(html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link|img|iframe|source|meta)\b([^>]*)>/gi), (m) => ({ tag: m[1].toLowerCase(), a: parseAttrs(m[2]) }));
  const vp = tags.find((t) => t.tag === 'meta' && t.a.name === 'viewport');
  check('viewport-fit for a phone', !!vp && /(^|,)\s*viewport-fit=cover/.test(vp.a.content || ''));
  check('no CDN / remote at load', tags.every((t) => !/^(https?:)?\/\//i.test(t.a.src || t.a.href || '')));
  check('classic scripts, no type=module', tags.filter((t) => t.tag === 'script').every((t) => !t.a.type || t.a.type === 'text/javascript'));
  // TEXT-CHECK: the OS owns Invite; an in-app copy is a label with no behaviour to run.
  check('no Invite button', !/<button\b[^>]*>\s*Invite\s*</i.test(html));
}
{
  const R = cssRules(css);
  check('buttons are 44px tall', cssValue(R, /^button$/, 'min-height') === '44px');
  check('canvas stays on screen while you edit', cssValue(R, /^\.stage$/, 'position') === 'sticky');
  check('no webfont import', !/@import/i.test(css) && !R.some((r) => Object.values(r.decl).some((v) => /url\(\s*['"]?(https?:)?\/\//i.test(v))));
}
// The listing's wording (the recipe travels with the GIF; no internals) is
// copy; the recipe-travels promise is the reopen BEHAVIOUR above.
check('help.md is a real page (a title and some sections)', /^# \S/.test(help.trim()) && (help.match(/^## /gm) || []).length >= 1 && help.trim().length >= 400);
check('manifest is solo + private save + launch-to-a-preset',
  manifest.capabilities.db === true &&
  !manifest.capabilities.multiplayer &&
  manifest.data.save.visibility === 'private' &&
  !!(manifest.launch && manifest.launch.preset) &&
  manifest.minBuild === 947);

shell().catch((e) => { failures++; console.log('FAIL — shell crashed: ' + (e && e.stack || e)); }).then(() => {
if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nAll PASS — texgen core loop holds.');
  process.exit(0);
});
