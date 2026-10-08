// QR Scan has to actually decode, and the empty state has to be on the page.
//
// Upstream jsQR's demo is a live webcam. The sandbox never grants that. This
// suite plays the still-photo path: classify the payloads a phone actually
// produces, refuse an empty picture, and round-trip a raster jsQR can read.
// The page itself (photo, file, drop, copy, history, Back) is app.js booted
// in a small fake DOM built from index.html, fed rasters qr-code drew.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
const GEN = path.join(__dirname, '..', 'qr-code');

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function mockEl() {
  return {
    innerHTML: '',
    title: '',
    style: {},
    hidden: false,
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    appendChild: function (c) { this.child = c; return c; },
    querySelector: function () { return this.child || null; },
    addEventListener: function () {},
    textContent: ''
  };
}
function mockCanvas() {
  return {
    width: 64,
    height: 64,
    style: {},
    tagName: 'CANVAS',
    hidden: false,
    getContext: function () {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        imageSmoothingEnabled: true,
        fillRect: function () {},
        strokeRect: function () {},
        clearRect: function () {},
        beginPath: function () {},
        moveTo: function () {},
        lineTo: function () {},
        closePath: function () {},
        stroke: function () {},
        drawImage: function () {},
        getImageData: function (x, y, w, h) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        }
      };
    },
    toDataURL: function () { return 'data:image/png;base64,xx'; }
  };
}

function loadScan() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
    Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array,
    parseInt, parseFloat, isNaN, Infinity, Error, TypeError, RegExp,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: function () {},
    navigator: { userAgent: 'node', clipboard: null },
    CanvasRenderingContext2D: function () {},
    Blob: function () {},
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: function () {} },
    Image: function () {},
    FileReader: function () {},
    Promise
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = {
    documentElement: { tagName: 'HTML' },
    body: { classList: { add: function () {}, remove: function () {}, toggle: function () {} } },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function (tag) {
      if (tag === 'canvas') return mockCanvas();
      return mockEl();
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'jsQR.js'), 'utf8'), sandbox, { filename: 'jsQR.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = loadScan();
const App = sandbox.QrScanApp;
check('app.js loads and attaches QrScanApp', !!(App && App.classify && App.decodePixels));
check('jsQR is aboard', typeof sandbox.jsQR === 'function');

// ---- classify the payloads a phone actually produces --------------------------
check('empty is empty', App.classify('').kind === 'empty');
check('plain text is text', App.classify('hello').kind === 'text');
{
  const c = App.classify('https://gifos.app');
  check('https is a link', c.kind === 'url' && c.label === 'Link', c);
}
{
  const c = App.classify('WIFI:T:WPA;S:Cafe;P:secret;;');
  check('WIFI: is wifi', c.kind === 'wifi' && c.ssid === 'Cafe' && c.password === 'secret', c);
}
{
  const c = App.classify('WIFI:T:WPA;S:Cafe\\;Room;P:a\\;b;;');
  check('WIFI: unescapes semicolon in SSID', c.kind === 'wifi' && c.ssid === 'Cafe;Room', c);
}
{
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Quill Fenwick\nTEL:555\nEND:VCARD';
  const c = App.classify(v);
  check('vCard is a contact', c.kind === 'contact' && c.fn === 'Quill Fenwick', c);
}
check('tel: is a phone', App.classify('tel:+1555').kind === 'phone');
check('SMSTO is sms', App.classify('SMSTO:555:hi').kind === 'sms' && App.classify('SMSTO:555:hi').hint === '555');
check('mailto is email', App.classify('mailto:a@b.c?subject=Hi').kind === 'email');
check('geo is a place', App.classify('geo:0,0').kind === 'geo');

// empty image → null, not a guess
{
  const data = new Uint8ClampedArray(16);
  const r = App.decodePixels(data, 2, 2);
  check('an empty picture is null, not a fake code', r === null, r);
}

// ---- PLAY: draw a code with qr-code's engine, read it with jsQR ---------------
function loadGen() {
  const s = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
    Uint8ClampedArray, Uint8Array, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, encodeURI, isNaN, Infinity, Error, TypeError,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: function () {},
    navigator: { userAgent: 'node' },
    CanvasRenderingContext2D: function () {}
  };
  s.globalThis = s;
  s.window = s;
  s.self = s;
  s.document = {
    documentElement: { tagName: 'HTML' },
    getElementById: function () { return null; },
    createElement: function (tag) {
      if (tag === 'canvas') return mockCanvas();
      return mockEl();
    }
  };
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(GEN, 'vendor', 'qrcode.js'), 'utf8'), s, { filename: 'qrcode.js' });
  vm.runInContext(fs.readFileSync(path.join(GEN, 'app.js'), 'utf8'), s, { filename: 'qr-code-app.js' });
  return s;
}

{
  const gen = loadGen();
  const G = gen.QrCodeApp;
  const grid = G.makeGrid('https://gifos.app', 'M');
  check('qr-code produced a grid', !!(grid && grid.n > 10), grid);
  const img = grid && grid.n ? G.rasterGrid(grid, 6, 4) : null;
  const code = img ? App.decodePixels(img.data, img.width, img.height) : null;
  check('jsQR reads the URL qr-code just drew', !!(code && code.data === 'https://gifos.app'), code && code.data);
}
{
  const gen = loadGen();
  const payload = gen.QrCodeApp.encodeKind('phone', { phone: '+15550100' });
  const grid = gen.QrCodeApp.makeGrid(payload, 'M');
  const img = grid && grid.n ? gen.QrCodeApp.rasterGrid(grid, 6, 4) : null;
  const code = img ? App.decodePixels(img.data, img.width, img.height) : null;
  check('jsQR reads a tel: code', !!(code && code.data === 'tel:+15550100'), code && code.data);
  check('…and classify calls it a phone', App.classify(code && code.data || '').kind === 'phone');
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

// ---- the page: boot app.js in the fake DOM, scan pictures through it -------
// A canvas here carries real pixels: drawImage copies the source's pixels
// (same size only — the app reads at scale 1 for these sizes), and
// getImageData hands them back, so jsQR decodes what the app drew.
function bootPage(opts) {
  opts = opts || {};
  const doc = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  doc.El.prototype.getContext = function () {
    const cv = this;
    return this._ctx = this._ctx || new Proxy({}, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'drawImage') return (src) => { if (src && src._pix && src.width === cv.width && src.height === cv.height) cv._pix = src._pix; };
        if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: cv._pix && cv._pix.length === w * h * 4 ? new Uint8ClampedArray(cv._pix) : new Uint8ClampedArray(w * h * 4) });
        return () => {};
      },
      set(t, k, v) { t[k] = v; return true; },
    });
  };
  const blobs = new Map(); let nBlob = 0;
  const rows = {}; const puts = []; const dels = []; let sub = null; let nextId = 1;
  const hist = {
    put: (r) => { const row = Object.assign({ id: 'h' + nextId++ }, r); rows[row.id] = row; puts.push(row); sub && sub(Object.values(rows)); return Promise.resolve(row.id); },
    delete: (id) => { dels.push(id); delete rows[id]; sub && sub(Object.values(rows)); return Promise.resolve(); },
    getAll: () => Promise.resolve(Object.values(rows)),
    subscribe: (fn) => { sub = fn; fn(Object.values(rows)); return () => {}; },
  };
  const spies = { photos: [], copied: [], gum: 0, reads: 0 };
  const gifos = {
    back: null,
    db: (n) => (n === 'history' ? hist : null),
    onBack(fn) { gifos.back = fn; },
    takePhoto(o) { spies.photos.push(o); return opts.shot ? Promise.resolve(opts.shot()) : Promise.reject(new Error('cancelled')); },
  };
  class FakeImage {
    set src(u) {
      const b = blobs.get(u);
      setImmediate(() => {
        if (!b || !b.parts[0] || !b.parts[0].pix) { this.onerror && this.onerror(); return; }
        const r = b.parts[0];
        this.width = this.naturalWidth = r.width; this.height = this.naturalHeight = r.height; this._pix = r.pix;
        this.onload && this.onload();
      });
    }
  }
  const winL = {};
  const win = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, TypeError, RegExp,
    Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, parseInt, parseFloat, isNaN, Infinity,
    document: doc, gifos: opts.noGifos ? undefined : gifos, Image: FakeImage,
    Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; },
    URL: { createObjectURL: (b) => { const u = 'blob:' + (++nBlob); blobs.set(u, b); return u; }, revokeObjectURL() {} },
    FileReader: function () { this.readAsArrayBuffer = (f) => { spies.reads++; setImmediate(() => { this.result = f.bytes; this.onload(); }); }; },
    navigator: { clipboard: { writeText: (t) => { spies.copied.push(t); return Promise.resolve(); } },
      mediaDevices: { getUserMedia: () => { spies.gum++; return Promise.reject(new Error('no')); } } },
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    addEventListener(t, fn) { (winL[t] = winL[t] || []).push(fn); },
    dispatchEvent(e) { e.preventDefault = e.preventDefault || (() => {}); (winL[e.type] || []).forEach((f) => f(e)); return true; },
  };
  win.window = win; win.self = win; win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'jsQR.js'), 'utf8'), win, { filename: 'jsQR.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), win, { filename: 'app.js' });
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
  const $ = (id) => doc.getElementById(id);
  const status = () => ({ text: $('status').textContent, err: $('status').classList.contains('err') });
  const shown = () => ({ preview: !$('preview').hidden, empty: !$('emptyShot').hidden, out: $('out').textContent, outEmpty: $('out').classList.contains('is-empty'), copy: !$('copyBtn').hidden, clear: !$('clearShotBtn').hidden });
  return { doc, win, gifos, rows, puts, dels, spies, settle, $, status, shown };
}

// A picture as the app would receive it: bytes that the fake Image decodes to
// this raster. A raster is what qr-code drew for the payload.
function picture(payload) {
  const G = loadGen().QrCodeApp;
  const grid = G.makeGrid(payload, 'M');
  const img = G.rasterGrid(grid, 6, 4);
  return { width: img.width, height: img.height, pix: img.data };
}
const blank = () => ({ width: 300, height: 300, pix: new Uint8ClampedArray(300 * 300 * 4).fill(255) });

const page = [];
const pageTest = (fn) => page.push(fn);

pageTest(async () => {
  const P = bootPage();
  await P.settle();
  const s = P.shown();
  check('a fresh page shows the empty picture state, not a blank canvas', !s.preview && s.empty, s);
  check('a fresh page shows the empty decoded state and no Copy / Clear', s.outEmpty && !s.copy && !s.clear, s);
  check('a fresh page has no history rows and no Clear history', P.$('hist').children.length === 0 && P.$('clearBtn').hidden === true);
});

pageTest(async () => {
  const P = bootPage({ shot: () => ({ bytes: picture('https://example.org/menu'), mime: 'image/png' }) });
  await P.settle();
  P.$('photoBtn').click();
  await P.settle();
  check('Take a photo asks GifOS for a still from the back camera', P.spies.photos.length === 1 && P.spies.photos[0].facing === 'environment', P.spies.photos);
  check('the code in the photo is decoded onto the page', P.$('out').textContent === 'https://example.org/menu' && !P.status().err, { out: P.$('out').textContent, st: P.status() });
  const s = P.shown();
  check('the picture replaces the empty state, with Copy and Clear picture', s.preview && !s.empty && s.copy && s.clear, s);
  check('the decoded link is tagged as a link', !P.$('kindChip').hidden && P.$('kindChip').textContent.length > 0);
  check('the read is remembered in the private history collection', P.puts.length === 1 && P.puts[0].text === 'https://example.org/menu' && P.puts[0].kind === 'url' && P.puts[0].source === 'photo', P.puts);
  check('the camera stream API is never touched', P.spies.gum === 0, P.spies.gum);
  P.$('copyBtn').click();
  await P.settle();
  check('Copy puts the decoded words on the clipboard', P.spies.copied.length === 1 && P.spies.copied[0] === 'https://example.org/menu', P.spies.copied);
  check('history lists the read', P.$('hist').children.length === 1 && P.$('clearBtn').hidden === false);
  // Back clears the picture.
  check('Back is handled by the app', typeof P.gifos.back === 'function');
  P.gifos.back();
  const b = P.shown();
  check('Back clears the picture and the decoded words', !b.preview && b.empty && b.outEmpty && !b.copy && !b.clear, b);
  // a history row restores; its trash removes exactly that row.
  const li = P.$('hist').children[0];
  li.querySelector('.txt').click();
  check('tapping a history row puts its words back', P.$('out').textContent === 'https://example.org/menu');
  const del = li.querySelector('.row-del');
  check('each history row has a trash icon button (an svg, not a letter)', !!del && /^<svg/.test(del.innerHTML));
  del.click();
  await P.settle();
  check('the trash removes that row from history', P.dels.length === 1 && P.dels[0] === P.puts[0].id && P.$('hist').children.length === 0, P.dels);
});

pageTest(async () => {
  const P = bootPage({ shot: () => ({ bytes: blank(), mime: 'image/png' }) });
  await P.settle();
  P.$('photoBtn').click();
  await P.settle();
  check('a photo with no code shows an error, not a guess', P.status().err && P.status().text.length > 0 && P.shown().outEmpty, P.status());
  check('a photo with no code is not added to history', P.puts.length === 0);
  check('the picture is still shown so you can see why', P.shown().preview);
});

pageTest(async () => {
  const P = bootPage({ shot: () => ({ bytes: { notAPicture: true }, mime: 'image/jpeg' }) });
  await P.settle();
  P.$('photoBtn').click();
  await P.settle();
  check('a photo that will not decode as an image shows an error', P.status().err && P.status().text.length > 0, P.status());
  check('an undecodable photo adds nothing to history', P.puts.length === 0);
  const C = bootPage();
  await C.settle();
  C.$('photoBtn').click();
  await C.settle();
  check('a cancelled photo is not an error', !C.status().err && C.puts.length === 0, C.status());
  const N = bootPage({ noGifos: true });
  await N.settle();
  N.$('photoBtn').click();
  check('outside GifOS, Take a photo explains itself instead of opening a camera', N.status().err && N.status().text.length > 0 && N.spies.gum === 0, N.status());
});

pageTest(async () => {
  const P = bootPage();
  await P.settle();
  P.$('fileBtn').click();
  check('Choose a picture opens the file picker', P.$('file').clicks === 1);
  const input = P.$('file');
  input.files = [{ type: 'text/plain', name: 'notes.txt', bytes: {} }];
  input.dispatchEvent({ type: 'change', target: input });
  await P.settle();
  check('a file that is not a picture is refused with an error, unread', P.status().err && P.puts.length === 0 && P.spies.reads === 0, { st: P.status(), reads: P.spies.reads });
  input.files = [{ type: 'image/png', name: 'wifi.png', bytes: picture('WIFI:T:WPA;S:Lab\\;2;P:pw;;') }];
  input.dispatchEvent({ type: 'change', target: input });
  await P.settle();
  check('a chosen picture is decoded and remembered as from a file', P.puts.length === 1 && P.puts[0].source === 'file' && P.puts[0].kind === 'wifi', P.puts);
  // The raw payload holds the escaped name Lab\;2; only the decoded network
  // details show it unescaped.
  check('a Wi-Fi code shows its unescaped network name', P.$('out').textContent.includes('Lab;2') && !P.$('kindHint').hidden, P.$('out').textContent);
  P.win.dispatchEvent({ type: 'drop', dataTransfer: { files: [{ type: 'image/png', name: 'x.png', bytes: picture('tel:+15550101') }] } });
  await P.settle();
  check('a picture put on the window is decoded', P.puts.length === 2 && P.puts[1].text === 'tel:+15550101', P.puts);
  P.$('clearBtn').click();
  await P.settle();
  check('Clear history deletes every row', P.dels.length === 2 && Object.keys(P.rows).length === 0 && P.$('hist').children.length === 0, P.dels);
});

// ---- static scans of shipped files (policy, not wording) -------------------
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const listing = fs.readFileSync(path.join(APP, 'listing.json'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));

// TEXT-CHECK: [hidden] beating author CSS, and button height, are layout; node
// has no layout engine, so the stylesheet rules are read.
check('author CSS cannot un-hide [hidden] (the empty canvas bug)', /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
check('Take a photo is a 48px button', /height:\s*48px/.test(css) && !!fakeDom(html).getElementById('photoBtn'));
// TEXT-CHECK: "never a live camera / never the network" covers every code
// path, not only the ones driven above, so the shipped code is scanned.
check('never getUserMedia', !/getUserMedia|mediaDevices|webkitGetUserMedia/.test(js + html));
check('no WebRTC / fetch', !/RTCPeerConnection|WebSocket|XMLHttpRequest/.test(js));
check('history is private', manifest.data.history.visibility === 'private');
check('minBuild stays 947', manifest.minBuild === 947);
check('camera capability is declared', manifest.capabilities.camera === true);
check('author is cozmo, not GifOS', JSON.parse(listing).author.name === 'cozmo');
// TEXT-CHECK: Invite is OS chrome; a control that must not exist has no
// behaviour to drive, so the parsed DOM is searched for it.
check('no in-app Invite button', !fakeDom(html).querySelectorAll('button').some((b) => /invite/i.test(b.textContent + ' ' + b.id)));

(async () => {
  for (const t of page) await t();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL — threw', e && e.stack); process.exit(1); });
