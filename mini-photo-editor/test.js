// MINI PHOTO EDITOR HAS TO CROP, ROTATE AND FILTER — NOT DRAW, NOT COMPRESS.
//
// The filter pipeline is pixel arithmetic (xdadda's MTX looks plus lights).
// Crop handles and rotate must preserve the box. Take-photo, drop, save,
// Back and the meeting view are driven through the real app.js + mp.js in a
// small fake DOM built from index.html.
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
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
    Uint8Array, Uint8ClampedArray,
    document: { createElement() { return { getContext() { return null; } }; } },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.this = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'mini-photo.js'), 'utf8'), sandbox, { filename: 'mini-photo.js' });
  return sandbox;
}

const S = load();
const MP = S.MiniPhoto;
check('engine loads', !!(MP && MP.MTX && MP.applyPixels && MP.setFilter));
check('MTX looks aboard', !!(MP.MTX.polaroid && MP.MTX.kodak && MP.MTX.vintage && MP.MTX.browni && MP.MTX.grayscale));

const zeroAdj = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 };

function px(r, g, b) { return new Uint8Array([r, g, b, 255]); }

{
  const red = px(255, 0, 0);
  MP.applyPixels(red, 1, 1, zeroAdj, 'grayscale');
  check('grey of red is ~luma 54', Math.abs(red[0] - 54) <= 1 && Math.abs(red[0] - red[1]) <= 1 && Math.abs(red[1] - red[2]) <= 1, Array.from(red));
}

{
  const p = px(128, 128, 128);
  MP.applyPixels(p, 1, 1, { brightness: 0.5, contrast: 0, saturation: 0, warmth: 0, vignette: 0 }, 'none');
  check('brightness +0.5 lifts mid grey', p[0] > 160, Array.from(p));
}

{
  const p = px(200, 80, 80);
  MP.applyPixels(p, 1, 1, { brightness: 0, contrast: 0, saturation: 0, warmth: 1, vignette: 0 }, 'none');
  check('warmth pushes red up and blue down', p[0] > 200 && p[2] < 80, Array.from(p));
}

{
  const a = px(180, 90, 40);
  const b = px(180, 90, 40);
  MP.applyPixels(a, 1, 1, zeroAdj, 'none');
  MP.applyPixels(b, 1, 1, zeroAdj, 'vintage');
  check('vintage look actually changes the pixel', a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2], { a: Array.from(a), b: Array.from(b) });
}

{
  const kodak = px(100, 120, 140);
  const none = px(100, 120, 140);
  MP.applyPixels(none, 1, 1, zeroAdj, 'none');
  MP.applyPixels(kodak, 1, 1, zeroAdj, 'kodak');
  check('kodak look actually changes the pixel', none[0] !== kodak[0] || none[1] !== kodak[1] || none[2] !== kodak[2]);
}

{
  // 4x1: x=0 is farther from centre (2) than x=2, so vignette 1 darkens the edge more
  const data = new Uint8Array([
    200, 200, 200, 255,
    200, 200, 200, 255,
    200, 200, 200, 255,
    200, 200, 200, 255
  ]);
  MP.applyPixels(data, 4, 1, { brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 1 }, 'none');
  check('vignette darkens the edge more than the centre', data[0] < data[8], Array.from(data));
}

{
  MP.setFilter('vintage');
  check('setFilter vintage', MP.getFilter() === 'vintage');
  MP.setFilter('nope');
  check('unknown filter is ignored', MP.getFilter() === 'vintage');
  MP.setFilter('none');
}

{
  MP.setSource({ width: 100, height: 80 });
  check('source size', MP.sourceSize().w === 100 && MP.sourceSize().h === 80);
  check('rotated size starts as source', MP.rotatedSize().w === 100 && MP.rotatedSize().h === 80);
  MP.setCrop({ x: 10, y: 10, w: 50, h: 40 });
  let c = MP.getCrop();
  check('crop sticks', c.x === 10 && c.y === 10 && c.w === 50 && c.h === 40, c);
  MP.setCrop({ x: -20, y: 90, w: 400, h: 400 });
  c = MP.getCrop();
  check('crop clamps to the picture', c.x === 0 && c.y <= 79 && c.x + c.w <= 100 && c.y + c.h <= 80, c);
}

{
  MP.setSource({ width: 100, height: 80 });
  MP.setCrop({ x: 10, y: 10, w: 50, h: 40 });
  MP.rotate(1);
  const d = MP.rotatedSize();
  const c = MP.getCrop();
  check('90° CW swaps dims', d.w === 80 && d.h === 100, d);
  check('90° CW maps the crop', c.x === 30 && c.y === 10 && c.w === 40 && c.h === 50, c);
  MP.rotate(-1);
  const back = MP.getCrop();
  check('90° CCW restores crop', back.x === 10 && back.y === 10 && back.w === 50 && back.h === 40, back);
}

{
  MP.setSource({ width: 100, height: 80 });
  MP.setCrop({ x: 10, y: 20, w: 30, h: 20 });
  MP.flip('h');
  const c = MP.getCrop();
  check('flip H mirrors crop.x', c.x === 100 - 10 - 30 && c.y === 20 && c.w === 30, c);
}

{
  MP.setSource({ width: 200, height: 100 });
  MP.cropToAspect(1);
  const c = MP.getCrop();
  check('1:1 aspect is a centred square', c.w === c.h && c.w === 100 && c.x === 50 && c.y === 0, c);
  MP.cropToAspect(0);
  const f = MP.getCrop();
  check('Free aspect is the whole picture', f.x === 0 && f.y === 0 && f.w === 200 && f.h === 100, f);
}

{
  MP.setSource({ width: 100, height: 80 });
  MP.setCrop({ x: 10, y: 10, w: 40, h: 40 });
  check('corner hit is nw', MP.hitHandle(10, 10) === 'nw');
  check('inside is move', MP.hitHandle(30, 30) === 'move');
  check('outside is null', MP.hitHandle(90, 70) === null);
  MP.resizeCrop('se', 60, 50, 0);
  const c = MP.getCrop();
  check('resize se grows the box', c.w === 50 && c.h === 40, c);
  MP.moveCrop(5, 0);
  const m = MP.getCrop();
  check('move shifts x', m.x === 15, m);
}

{
  MP.setSource({ width: 80, height: 60 });
  MP.setFilter('kodak');
  MP.adj.brightness = 0.2;
  MP.adj.vignette = 0.4;
  MP.setCrop({ x: 4, y: 4, w: 40, h: 30 });
  const st = MP.getState();
  MP.resetAdj();
  check('reset clears look', MP.getFilter() === 'none' && MP.adj.brightness === 0);
  MP.setState(st);
  check('state roundtrip restores filter', MP.getFilter() === 'kodak');
  check('state roundtrip restores adj', Math.abs(MP.adj.brightness - 0.2) < 1e-9 && Math.abs(MP.adj.vignette - 0.4) < 1e-9);
  const c = MP.getCrop();
  check('state roundtrip restores crop', c.x === 4 && c.w === 40, c);
}

{
  MP.setSource({ width: 40, height: 40 });
  check('full crop is full', MP.isFullCrop() === true);
  MP.setCrop({ x: 2, y: 2, w: 10, h: 10 });
  check('shrunk crop is not full', MP.isFullCrop() === false);
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

// ---- boot the real app chrome (app.js + mp.js) in the fake DOM -------------
// A fake gifos: db() collections that record put(), a takePhoto that hands
// back a still, an onBack that keeps the handler, me()/info() for mp.js.
function bootApp(opts) {
  opts = opts || {};
  const doc = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  const timers = [];
  const rows = {};           // collection -> id -> row
  const puts = [];           // [collection, row]
  const subs = {};
  const db = (name) => {
    rows[name] = rows[name] || {};
    return {
      get: (id) => Promise.resolve(rows[name][id] || null),
      put: (row) => { rows[name][row.id] = row; puts.push([name, row]); (subs[name] || []).forEach((f) => f(Object.values(rows[name]))); return Promise.resolve(); },
      subscribe: (fn) => { (subs[name] = subs[name] || []).push(fn); fn(Object.values(rows[name])); return () => {}; },
    };
  };
  const gifos = {
    photos: 0, back: null,
    db,
    takePhoto(o) { gifos.photos++; gifos.lastFacing = o && o.facing; return opts.photoFails ? Promise.reject(new Error('Photo cancelled')) : Promise.resolve({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' }); },
    onBack(fn) { gifos.back = fn; },
    me: () => Promise.resolve({ id: opts.meId || 'host-1', name: 'Tester' }),
    info: () => Promise.resolve({ owner: opts.owner !== false }),
  };
  if (opts.seed) for (const [c, r] of opts.seed) { rows[c] = rows[c] || {}; rows[c][r.id] = r; }
  class FakeImage {
    constructor() { this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
    set src(v) {
      this._src = v;
      // A blob URL made from a non-picture, or the literal 'bad' payload, fails to decode.
      const bad = /^blob:bad/.test(v) || /base64,BAD/.test(v);
      timers.push(() => { if (bad) { this.onerror && this.onerror(); return; } this.width = this.naturalWidth = 64; this.height = this.naturalHeight = 48; this.onload && this.onload(); });
    }
    get src() { return this._src; }
  }
  let blobs = 0;
  const win = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, RegExp, parseFloat, parseInt, isNaN,
    Uint8Array, Uint8ClampedArray, Float32Array,
    document: doc, Image: FakeImage,
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = (o && o.type) || ''; this.size = 3; } },
    URL: { createObjectURL: (b) => (b && b.decodeFails ? 'blob:bad' : 'blob:ok') + (++blobs), revokeObjectURL() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { timers.push(fn); return 1; },
    gifos: opts.noGifos ? undefined : gifos,
  };
  win.window = win; win.self = win; win.globalThis = win;
  vm.createContext(win);
  for (const f of ['vendor/mini-photo.js', 'app.js', 'mp.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), win, { filename: f });
  }
  async function settle() {
    for (let round = 0; round < 50; round++) {
      await new Promise((r) => setImmediate(r));
      if (!timers.length) { await new Promise((r) => setImmediate(r)); if (!timers.length) return; }
      const t = timers.splice(0); t.forEach((fn) => { try { fn(); } catch (e) { console.log('timer threw', e.message); } });
    }
  }
  const $ = (id) => doc.getElementById(id);
  const status = () => ({ text: $('status').textContent, err: $('status').className === 'err' });
  return { win, doc, gifos, rows, puts, settle, $, status, MP: win.MiniPhoto };
}

const tests = [];
const test = (fn) => tests.push(fn);

// Take photo: the button asks GifOS for a still, and the still becomes the
// picture on screen, kept in the private pic collection, with the recipe
// kept in save as id 'edit'.
test(async () => {
  const A = bootApp();
  await A.settle();
  check('a fresh app shows the empty state (no picture yet)', !A.doc.body.classList.contains('has-pic') && !A.MP.hasImage());
  A.$('photoBtn').click();
  await A.settle();
  check('Take photo asks GifOS for one still', A.gifos.photos === 1, A.gifos.photos);
  check('the still becomes the picture on screen', A.MP.hasImage() && A.doc.body.classList.contains('has-pic'));
  const pic = A.puts.filter(([c]) => c === 'pic').map(([, r]) => r);
  check('the picture is kept in the pic collection as id pic', pic.length >= 1 && pic[pic.length - 1].id === 'pic' && /^data:image\/jpeg/.test(pic[pic.length - 1].jpg), pic);
  const save = A.puts.filter(([c]) => c === 'save').map(([, r]) => r);
  check('the recipe is kept in the save collection as id edit', save.length >= 1 && save[save.length - 1].id === 'edit' && 'filter' in save[save.length - 1], save);
  check('nothing private is written to the shared room except the recipe', A.puts.filter(([c]) => c === 'room').every(([, r]) => !('jpg' in r) && !JSON.stringify(r).includes('data:image')));
});

// A recipe saved last time comes back on boot.
test(async () => {
  const A0 = bootApp();
  A0.MP.setSource({ width: 10, height: 10 }); A0.MP.setFilter('kodak'); A0.MP.adj.warmth = 0.5;
  const st = A0.MP.getState(); st.id = 'edit';
  const A = bootApp({ seed: [['save', st], ['pic', { id: 'pic', jpg: 'data:image/jpeg;base64,AAAA' }]] });
  await A.settle();
  check('the saved recipe is restored on boot', A.MP.getFilter() === 'kodak' && Math.abs(A.MP.adj.warmth - 0.5) < 1e-9, A.MP.getState());
  check('the saved picture is restored on boot', A.MP.hasImage() && A.doc.body.classList.contains('has-pic'));
  check('restored sliders show the restored values', parseFloat(A.$('warmth').value) === 0.5);
});

// The empty state opens the file picker; drop and the file picker load a
// picture; a non-picture is refused with a visible error.
test(async () => {
  const A = bootApp();
  await A.settle();
  A.$('empty').click();
  check('tapping the empty state opens the file picker', A.$('open').clicks === 1, A.$('open').clicks);
  const notPic = new A.win.Blob(['x'], { type: 'text/plain' });
  A.$('stage').dispatchEvent({ type: 'drop', dataTransfer: { files: [notPic] } });
  await A.settle();
  check('dropping a non-picture shows an error and loads nothing', A.status().err && A.status().text.length > 0 && !A.MP.hasImage(), A.status());
  A.$('status').textContent = ''; A.$('status').className = '';
  const broken = new A.win.Blob(['x'], { type: 'image/jpeg' }); broken.decodeFails = true;
  A.$('stage').dispatchEvent({ type: 'drop', dataTransfer: { files: [broken] } });
  await A.settle();
  check('a picture that will not decode shows an error and loads nothing', A.status().err && !A.MP.hasImage(), A.status());
  const ok = new A.win.Blob(['x'], { type: 'image/png' });
  A.$('stage').dispatchEvent({ type: 'drop', dataTransfer: { files: [ok] } });
  await A.settle();
  check('dropping a picture on the window loads it', A.MP.hasImage() && !A.status().err, A.status());
  const B = bootApp();
  await B.settle();
  const inp = B.$('open');
  inp.files = [new B.win.Blob(['x'], { type: 'image/jpeg' })];
  inp.dispatchEvent({ type: 'change' });
  await B.settle();
  check('choosing a file in the picker loads it', B.MP.hasImage());
});

// Aspect chips crop to their ratio; rotate / reset / onBack do their jobs.
test(async () => {
  const A = bootApp();
  await A.settle();
  A.$('photoBtn').click();
  await A.settle();
  const chips = A.$('aspects').querySelectorAll('button');
  check('there are aspect chips', chips.length >= 2, chips.length);
  const square = chips.find((b) => parseFloat(b.getAttribute('data-a')) === 1);
  check('one aspect chip is 1:1', !!square);
  square.click();
  let c = A.MP.getCrop();
  check('the 1:1 chip crops the picture to a square', c.w === c.h && c.w > 0, c);
  check('the chosen chip is marked on', square.classList.contains('on') && chips.filter((b) => b.classList.contains('on')).length === 1);
  check('Back with a crop puts the whole picture back and is handled', typeof A.gifos.back === 'function' && A.gifos.back() === true && A.MP.isFullCrop());
  check('Back with nothing to undo is left to GifOS', A.gifos.back() === false);
  const w0 = A.MP.rotatedSize();
  A.$('rotR').click();
  const w1 = A.MP.rotatedSize();
  check('Rotate → turns the picture a quarter', w1.w === w0.h && w1.h === w0.w, { w0, w1 });
  A.$('filters').querySelectorAll('button').find((b) => b.getAttribute('data-id') === 'vintage').click();
  check('a look chip sets the look', A.MP.getFilter() === 'vintage');
  A.$('brightness').value = '0.3';
  A.$('brightness').dispatchEvent({ type: 'input' });
  check('a slider sets its adjustment', Math.abs(A.MP.adj.brightness - 0.3) < 1e-9);
  A.$('resetBtn').click();
  check('Reset clears the look and the sliders', A.MP.getFilter() === 'none' && A.MP.adj.brightness === 0 && parseFloat(A.$('brightness').value) === 0);
});

// Outside GifOS there is no camera: Take photo says so, visibly.
test(async () => {
  const A = bootApp({ noGifos: true });
  await A.settle();
  A.$('photoBtn').click();
  await A.settle();
  check('Take photo outside GifOS shows an error instead of nothing', A.status().err && A.status().text.length > 0, A.status());
});

// The meeting half: the host is told how to share; a guest sees the host's
// look, read-only, and nothing a guest does is written over it.
test(async () => {
  const H = bootApp({ owner: true });
  await H.settle();
  check('the host gets a sharing hint and no guest bar', H.$('friend-status').textContent.length > 0 && H.$('friend-bar').hidden === true);
  const host = H.MP.getState(); host.filter = 'polaroid';
  const G = bootApp({ owner: false, meId: 'guest-1', seed: [['room', { id: 'shared', hostId: 'host-1', st: host }]] });
  await G.settle();
  check('a guest sees the host\'s look, read-only', G.MP.getFilter() === 'polaroid' && G.$('friend-bar').hidden === false && G.doc.body.classList.contains('guest'));
  G.$('filters').querySelectorAll('button').find((b) => b.getAttribute('data-id') === 'kodak').click();
  G.$('warmth').value = '0.4'; G.$('warmth').dispatchEvent({ type: 'input' });
  G.win.MPMp.publish();
  await G.settle();
  check('a guest never writes the room or the recipe, even after touching the controls', !G.puts.some(([c]) => c === 'room' || c === 'save'), G.puts.map(([c]) => c));
});

// ---- static scans of shipped files (policy, not wording) -------------------
{
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  const doc = fakeDom(html);
  // TEXT-CHECK: tap-target size and safe-area insets are layout; node has no
  // layout engine, so the stylesheet rule is the only thing to read here.
  check('44px tap targets', /min-height:\s*44px/.test(css));
  check('safe-area insets', /safe-area-inset/.test(css));
  // TEXT-CHECK: Invite is OS chrome (owner rule). There is no behaviour to
  // drive for a button that must not exist, so the parsed DOM is searched.
  check('no in-app Invite or Play together button',
    !doc.querySelectorAll('button').some((b) => /invite|play together/i.test(b.textContent) || /invite/i.test(b.id)));
  // TEXT-CHECK: offline / classic-script policy over the shipped page.
  check('no CDN / http in html', !/https?:\/\//i.test(html.replace(/<!--[\s\S]*?-->/g, '')));
  check('classic scripts', !/type=["']module["']/.test(html));
  check('camera capability', manifest.capabilities.camera === true);
  check('minBuild stays 947', manifest.minBuild === 947);
  check('pic is private', manifest.data.pic.visibility === 'private');
  check('room is read-only', manifest.data.room.visibility === 'read-only');
}

(async () => {
  for (const t of tests) await t();
  if (failures) {
    console.log('\n' + failures + ' failed');
    process.exit(1);
  }
  console.log('\nAll PASS');
})().catch((e) => { console.log('FAIL — threw', e && e.stack); process.exit(1); });
