// QR Code has to actually encode, and last-save from 1.0 still loads.
//
// The GIF wraps davidshimjs/qrcodejs. A library demo that only draws whatever
// you type is not a finished tool — encodeKind must produce real URL / tel /
// SMSTO / mailto / vCard payloads, makeGrid must be a QR jsQR can read, and a
// v1.0 {id:'last', payload} row (no kind) must still fill the text box. The
// app is then booted on a small DOM built from its own index.html and used:
// typing, the kind tabs, a launch link, Back, the save. No check reads a
// label or the listing's wording.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

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
    appendChild: function (c) { this.child = c; return c; },
    querySelector: function () { return this.child || null; }
  };
}

function mockCanvas() {
  const c = {
    width: 64,
    height: 64,
    style: {},
    tagName: 'CANVAS',
    getContext: function () {
      return {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
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
  return c;
}

function load() {
  const sandbox = {
    console,
    Math,
    Object,
    Array,
    JSON,
    Date,
    String,
    Number,
    Boolean,
    Uint8ClampedArray,
    Uint8Array,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    isNaN,
    Infinity,
    Error,
    TypeError,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: function () {},
    navigator: { userAgent: 'node' },
    CanvasRenderingContext2D: function () {},
    Blob: function () {},
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: function () {} }
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
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'qrcode.js'), 'utf8'), sandbox, { filename: 'qrcode.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = load();
const App = sandbox.QrCodeApp;
check('app.js loads and attaches QrCodeApp', !!(App && App.encodeKind && App.makeGrid));
check('QRCode constructor is aboard', typeof sandbox.QRCode === 'function');
check('CorrectLevel.M is 0', sandbox.QRCode.CorrectLevel.M === 0, sandbox.QRCode.CorrectLevel);

// ---- encode the jobs a stranger actually types --------------------------------
check('empty text is empty', App.encodeKind('text', { text: '' }) === '');
check('plain text passes through', App.encodeKind('text', { text: 'hello' }) === 'hello');
check('a bare host becomes https', App.encodeKind('url', { url: 'gifos.app' }) === 'https://gifos.app');
check('https is left alone', App.encodeKind('url', { url: 'https://gifos.app/x' }) === 'https://gifos.app/x');
check('empty url is empty', App.encodeKind('url', { url: '  ' }) === '');
check('phone is tel:', App.encodeKind('phone', { phone: '+1 555 0100' }) === 'tel:+15550100');
check('sms without body', App.encodeKind('sms', { phone: '5550100' }) === 'SMSTO:5550100');
check('sms with body', App.encodeKind('sms', { phone: '555', body: 'hi' }) === 'SMSTO:555:hi');
check('email is mailto', App.encodeKind('email', { email: 'a@b.c' }) === 'mailto:a@b.c');
check('email subject and body', /mailto:a@b\.c\?/.test(App.encodeKind('email', { email: 'a@b.c', subject: 'Hi', body: 'Yo' })));
{
  const v = App.encodeKind('contact', { name: 'Ada', phone: '555', email: 'ada@ex', org: 'Labs' });
  check('vCard starts and ends', /^BEGIN:VCARD\nVERSION:3.0\n/.test(v) && /END:VCARD$/.test(v), v);
  check('vCard carries FN and TEL', /FN:Ada/.test(v) && /TEL:555/.test(v), v);
}
check('empty contact is empty', App.encodeKind('contact', { name: '', phone: '', email: '' }) === '');

// ---- a v1.0 save (payload only) still loads -----------------------------------
{
  const row = { id: 'last', payload: 'saved-from-1.0', ecc: 'Q', size: 192, dark: '#111111', light: '#fefefe' };
  App.hydrate(row);
  const s = App.settings();
  check('old save restores the payload', s.payload === 'saved-from-1.0', s.payload);
  check('old save defaults kind to text', s.kind === 'text', s.kind);
  check('old save puts payload in the text field', s.fields && s.fields.text === 'saved-from-1.0', s.fields);
  check('old save keeps ecc/size/colours', s.ecc === 'Q' && s.size === 192 && s.dark === '#111111', s);
}

// ---- contrast: phones need a light quiet zone ---------------------------------
check('black on white is high contrast', App.contrastRatio('#000000', '#ffffff') > 20);
check('near-grey pair is too close', App.contrastRatio('#777777', '#888888') < 2);
check('light lum is higher than dark lum', App.hexLum('#ffffff') > App.hexLum('#000000'));

// ---- PLAY: encode → modules → raster → jsQR reads it back ---------------------
const jsSandbox = {
  console, Math, Object, Array, JSON, Date, String, Number, Boolean,
  Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array,
  parseInt, parseFloat, isNaN, Infinity, Error, TypeError
};
jsSandbox.globalThis = jsSandbox;
jsSandbox.window = jsSandbox;
jsSandbox.self = jsSandbox;
vm.createContext(jsSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'qr-scan', 'vendor', 'jsQR.js'), 'utf8'),
  jsSandbox, { filename: 'jsQR.js' });
check('jsQR loads for the roundtrip', typeof jsSandbox.jsQR === 'function');

function roundtrip(text, ecc) {
  const grid = App.makeGrid(text, ecc || 'M');
  if (!grid || grid.error) return { ok: false, err: grid && grid.error, grid: grid };
  const img = App.rasterGrid(grid, 6, 4);
  const code = jsSandbox.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return { ok: !!(code && code.data === text), got: code && code.data, n: grid.n };
}

{
  const r = roundtrip('https://gifos.app', 'M');
  check('jsQR reads a URL we just drew', r.ok, r);
}
{
  const r = roundtrip('hello from gifos', 'M');
  check('jsQR reads plain text we just drew', r.ok, r);
}
{
  const payload = App.encodeKind('phone', { phone: '+15550100' });
  const r = roundtrip(payload, 'M');
  check('jsQR reads a tel: payload we just drew', r.ok, r);
}
{
  const too = 'x'.repeat(4000);
  const g = App.makeGrid(too, 'H');
  check('too-long text is refused rather than guessed', !!(g && g.error && /too long/i.test(g.error)), g);
}

// ---- a small HTML parser: the page as the browser's parser would nest it ----
// Enough for static pages: tags, attributes, comments, raw-text <script>/<style>,
// void elements, and a stray close tag that matches nothing is ignored.
function parseHtml(src) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const RAW = new Set(['script', 'style', 'textarea', 'title']);
  const root = { tag: '#root', attrs: {}, children: [], parent: null, text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/gi;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { top.children.push({ tag: '#text', text: m[4], parent: top }); continue; }
    if (m[1]) {
      const t = m[1].toLowerCase();
      let k = stack.length - 1;
      while (k > 0 && stack[k].tag !== t) k--;
      if (k > 0) stack.length = k;
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase(), attrs = {};
    const ar = /([^\s=\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    const body = m[3].replace(/\/\s*$/, '');
    while ((a = ar.exec(body))) attrs[a[1].toLowerCase()] = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '';
    const node = { tag, attrs, children: [], parent: top };
    top.children.push(node);
    if (RAW.has(tag)) {
      const end = src.toLowerCase().indexOf('</' + tag, re.lastIndex);
      const stop = end < 0 ? src.length : end;
      node.children.push({ tag: '#text', text: src.slice(re.lastIndex, stop), parent: node });
      re.lastIndex = stop;
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
  }
  return root;
}
function walk(node, fn) { fn(node); for (const c of node.children || []) walk(c, fn); }
function all(root, pred) { const out = []; walk(root, (n) => { if (n.tag[0] !== '#' && pred(n)) out.push(n); }); return out; }
function byId(root, id) { return all(root, (n) => n.attrs.id === id)[0] || null; }
function textOf(n) { let s = ''; walk(n, (x) => { if (x.tag === '#text') s += x.text; }); return s; }
function within(n, anc) { for (let p = n && n.parent; p; p = p.parent) if (p === anc) return true; return false; }
function docOrder(root) { const o = []; walk(root, (n) => o.push(n)); return (n) => o.indexOf(n); }

// ---- a small CSS parser: rule -> declarations, with its @media context ----
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  (function block(s, media) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let d = 1, j = open + 1;
      while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const inner = s.slice(open + 1, j - 1);
      if (/^@media/i.test(head)) block(inner, head.replace(/^@media\s*/i, ''));
      else if (/^@/.test(head)) { /* keyframes, font-face: not selectors */ }
      else {
        const decl = {};
        for (const part of inner.split(';')) {
          const c = part.indexOf(':');
          if (c < 0) continue;
          decl[part.slice(0, c).trim().toLowerCase()] = part.slice(c + 1).trim();
        }
        for (const sel of head.split(',')) rules.push({ sel: sel.trim().replace(/\s+/g, ' '), decl, media: media || '' });
      }
      i = j;
    }
  })(src, '');
  return rules;
}
// Every declaration of `prop` on a rule whose selector is exactly `sel`.
function cssVal(rules, sel, prop, media) {
  return rules.filter((r) => r.sel === sel && (media === undefined || r.media.includes(media)) && r.decl[prop] !== undefined).map((r) => r.decl[prop]);
}
// ---- a small live DOM built from the app's own index.html -------------------
// Enough for an app's script to boot and for a test to press its controls:
// ids, attributes, classes, dataset, hidden/disabled, text, innerHTML (parsed),
// simple selectors (tag, #id, .class, [attr], [attr=v], and descendant
// chains of those), closest(), events with bubbling, and a canvas whose 2D
// context records nothing. Needs parseHtml above.
function miniDom(html) {
  const listenersOf = new WeakMap();
  const canvasCtx = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 0 }) : k === 'getImageData' || k === 'createImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray((w || x || 1) * (h || y || 1) * 4), width: w || x, height: h || y }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  class El {
    constructor(tag, attrs) { this.tagName = String(tag).toUpperCase(); this.attrs = Object.assign({}, attrs || {}); this.childNodes = []; this.parentNode = null; this.style = {}; this._text = null; this.value = this.attrs.value !== undefined ? this.attrs.value : ''; this.checked = 'checked' in this.attrs; this.selected = 'selected' in this.attrs; }
    get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
    get children() { return this.childNodes.filter((c) => c instanceof El); }
    get firstChild() { return this.childNodes[0] || null; } get firstElementChild() { return this.children[0] || null; }
    get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = String(v); }
    get classList() {
      const self = this, get = () => (self.attrs.class || '').split(/\s+/).filter(Boolean), put = (a) => { self.attrs.class = a.join(' '); };
      return { contains: (c) => get().includes(c), add: (...c) => put([...new Set(get().concat(c))]), remove: (...c) => put(get().filter((x) => !c.includes(x))),
        toggle: (c, v) => { const on = v === undefined ? !get().includes(c) : !!v; if (on) put([...new Set(get().concat([c]))]); else put(get().filter((x) => x !== c)); return on; } };
    }
    get dataset() {
      const self = this;
      return new Proxy({}, { get: (t, k) => self.attrs['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())],
        set: (t, k, v) => { self.attrs['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = String(v); return true; } });
    }
    get hidden() { return 'hidden' in this.attrs; } set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
    get disabled() { return 'disabled' in this.attrs; } set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
    get type() { return this.attrs.type || ''; } set type(v) { this.attrs.type = v; }
    get href() { return this.attrs.href || ''; } set href(v) { this.attrs.href = v; }
    get src() { return this.attrs.src || ''; } set src(v) { this.attrs.src = v; }
    get title() { return this.attrs.title || ''; } set title(v) { this.attrs.title = v; }
    get width() { return +(this.attrs.width || 300); } set width(v) { this.attrs.width = String(v); }
    get height() { return +(this.attrs.height || 150); } set height(v) { this.attrs.height = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; } hasAttribute(k) { return k in this.attrs; }
    get textContent() { return this.childNodes.map((c) => (c instanceof El ? c.textContent : c.text)).join(''); }
    set textContent(v) { this.childNodes = [{ text: String(v), parentNode: this }]; }
    get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
    get innerHTML() { return this.textContent; }
    set innerHTML(v) { this.childNodes = []; for (const c of parseHtml(String(v)).children) adopt(this, c); }
    insertAdjacentHTML(pos, v) { for (const c of parseHtml(String(v)).children) adopt(this, c); }
    appendChild(c) { if (c.parentNode && c.parentNode.childNodes) c.parentNode.childNodes = c.parentNode.childNodes.filter((x) => x !== c); c.parentNode = this; this.childNodes.push(c); return c; }
    append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? { text: c, parentNode: this } : c); }
    insertBefore(c, ref) { this.appendChild(c); if (ref) { this.childNodes.pop(); this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); } return c; }
    removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
    replaceChildren(...cs) { this.childNodes = []; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
    matches(sel) { return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/))); }
    closest(sel) { for (let p = this; p instanceof El; p = p.parentNode) if (p.matches(sel)) return p; return null; }
    querySelectorAll(sel) { const out = []; const walkEl = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walkEl(c); } }; walkEl(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementsByTagName(t) { return this.querySelectorAll(t); }
    addEventListener(t, f) { const m = listenersOf.get(this) || {}; (m[t] = m[t] || []).push(f); listenersOf.set(this, m); }
    removeEventListener(t, f) { const m = listenersOf.get(this) || {}; m[t] = (m[t] || []).filter((x) => x !== f); }
    dispatchEvent(ev) {
      ev.target = ev.target || this; ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; }); ev.stopPropagation = ev.stopPropagation || (() => { ev._stop = true; });
      for (let p = this; p && !ev._stop; p = p.parentNode) {
        ev.currentTarget = p;
        const m = listenersOf.get(p) || {};
        for (const f of (m[ev.type] || []).slice()) f.call(p, ev);
        if (typeof p['on' + ev.type] === 'function') p['on' + ev.type].call(p, ev);
        if (!ev.bubbles) break;
      }
      return !ev.defaultPrevented;
    }
    click() { if (this.disabled) return; if (this.tagName === 'INPUT' && /checkbox|radio/.test(this.type)) this.checked = this.type === 'radio' ? true : !this.checked; this.dispatchEvent({ type: 'click', bubbles: true, button: 0 }); if (this.tagName === 'INPUT' && /checkbox|radio/.test(this.type)) this.dispatchEvent({ type: 'change', bubbles: true }); }
    input(v) { this.value = v; this.dispatchEvent({ type: 'input', bubbles: true }); this.dispatchEvent({ type: 'change', bubbles: true }); }
    focus() { doc.activeElement = this; } blur() {} select() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
    getContext() { return (this._ctx = this._ctx || canvasCtx()); }
    toDataURL() { return 'data:image/png;base64,'; }
    get options() { return this.querySelectorAll('option'); }
    get offsetWidth() { return 100; } get offsetHeight() { return 100; } get clientWidth() { return 100; } get clientHeight() { return 100; }
  }
  function matchOne(el, s) {
    const m = /^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*)$/.exec(s);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    const parts = m[2].match(/[#.][\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?/g) || [];
    return parts.every((p) => {
      if (p[0] === '#') return el.id === p.slice(1);
      if (p[0] === '.') return el.classList.contains(p.slice(1));
      if (p[0] === ':') return p === ':checked' ? el.checked : p.startsWith(':not(') ? !matchOne(el, p.slice(5, -1)) : true;
      const a = /^\[([\w-]+)(?:([~^$*|]?=)["']?([^"'\]]*)["']?)?\]$/.exec(p);
      if (!a) return false;
      const v = el.getAttribute(a[1]);
      if (!a[2]) return v !== null;
      if (v === null) return false;
      return a[2] === '=' ? v === a[3] : a[2] === '~=' ? v.split(/\s+/).includes(a[3]) : a[2] === '^=' ? v.startsWith(a[3]) : a[2] === '$=' ? v.endsWith(a[3]) : v.includes(a[3]);
    });
  }
  function matchChain(el, chain) {
    if (!matchOne(el, chain[chain.length - 1])) return false;
    if (chain.length === 1) return true;
    for (let p = el.parentNode; p instanceof El; p = p.parentNode) if (matchChain(p, chain.slice(0, -1))) return true;
    return false;
  }
  function adopt(parent, n) {
    if (n.tag === '#text') { parent.childNodes.push({ text: n.text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#8249;/g, '‹').replace(/&#8250;/g, '›'), parentNode: parent }); return; }
    if (n.tag[0] === '#') return;
    const e = new El(n.tag, n.attrs);
    parent.appendChild(e);
    for (const c of n.children) adopt(e, c);
  }
  const tree = parseHtml(html);
  const docEl = new El('html');
  for (const c of tree.children) {
    if (c.tag === 'html') { for (const cc of c.children) adopt(docEl, cc); } else adopt(docEl, c);
  }
  let body = docEl.querySelector('body'); if (!body) body = docEl.appendChild(new El('body'));
  let head = docEl.querySelector('head'); if (!head) head = docEl.appendChild(new El('head'));
  const doc = {
    documentElement: docEl, body, head, readyState: 'complete', activeElement: null, hidden: false, visibilityState: 'visible',
    getElementById: (id) => docEl.querySelector('#' + id), querySelector: (s) => docEl.querySelector(s), querySelectorAll: (s) => docEl.querySelectorAll(s),
    createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (t) => ({ text: String(t) }), createDocumentFragment: () => new El('#fragment'),
    addEventListener: (t, f) => docEl.addEventListener(t, f), removeEventListener() {}, dispatchEvent: (e) => docEl.dispatchEvent(e),
  };
  return doc;
}

// ---- the app, booted on its own page ----------------------------------------
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
function bootApp(opts) {
  opts = opts || {};
  const doc = miniDom(read('index.html'));
  const puts = [], traps = [];
  let back = null;
  const sb = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Uint8ClampedArray, Uint8Array, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, encodeURI, isNaN, Infinity, Error, TypeError, Promise,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, addEventListener() {},
    navigator: { userAgent: 'node', mediaDevices: { getUserMedia: () => { traps.push('getUserMedia'); return Promise.reject(new Error('no')); } } },
    fetch: (u) => { traps.push('fetch ' + u); const p = Promise.reject(new Error('offline')); p.catch(() => {}); return p; },
    XMLHttpRequest: function () { traps.push('xhr'); }, WebSocket: function () { traps.push('ws'); },
    CanvasRenderingContext2D: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    document: doc,
    gifos: {
      db: (name) => name === 'save' ? { getAll: () => Promise.resolve(opts.saved ? [opts.saved] : []), put: (r) => { puts.push(JSON.parse(JSON.stringify(r))); return Promise.resolve(); } } : null,
      onBack: (f) => { back = f; }, launch: () => Promise.resolve(opts.launch || null),
    },
  };
  sb.globalThis = sb; sb.window = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of ['vendor/qrcode.js', 'mp.js', 'app.js']) vm.runInContext(read(f), sb, { filename: f });
  const $ = (id) => doc.getElementById(id);
  return { doc, $, puts, traps, back: () => back && back(), settle: () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r))),
    payload: () => sb.QrCodeApp.settings().payload, drawn: () => !$('qr').hidden && !!$('qr').querySelector('canvas, img') && !$('pngBtn').disabled };
}
const manifest = JSON.parse(read('manifest.json'));
const appRuns = (async () => {
  const page = parseHtml(read('index.html'));
  {
    const A = bootApp();
    await A.settle();
    check('at first nothing is drawn: the empty state shows, the code area is hidden and Download / Copy / Print are off',
      !A.$('empty').hidden && A.$('qr').hidden && A.$('pngBtn').disabled && A.$('copyBtn').disabled && A.$('printBtn').disabled);
    A.$('f-text').input('hello from a test');
    check('typing draws a code: the empty state goes, the code shows, the actions turn on', A.$('empty').hidden && A.drawn() && A.payload() === 'hello from a test');
    const last = A.puts.filter((r) => r.id === 'last').pop();
    check('the last payload is saved privately as id last', !!last && last.payload === 'hello from a test' && manifest.data.save.visibility === 'private');
    const kind = (k) => A.doc.querySelector('#kinds [data-kind="' + k + '"]');
    check('the kinds include link and contact (tabs in the kind list)', !!kind('url') && !!kind('contact'));
    kind('url').click();
    check('the Link tab selects itself and shows a link field', kind('url').getAttribute('aria-selected') === 'true' && !!A.$('f-url'));
    A.$('f-url').input('gifos.app');
    check('a bare host in the Link field becomes an https code', A.payload() === 'https://gifos.app' && A.drawn());
    kind('contact').click();
    check('the Contact tab shows name and phone fields', !!A.$('f-name') && !!A.$('f-phone'));
    A.$('f-name').input('Test Person'); A.$('f-phone').input('555 0100');
    check('…and draws a vCard', /^BEGIN:VCARD/.test(A.payload()) && /FN:Test Person/.test(A.payload()) && A.drawn());
    A.$('looks').open = true; // the person opened Size and colours
    A.back();
    check('Back closes the open Size and colours panel', A.$('looks').open === false);
    A.$('f-name').input(''); A.$('f-phone').input('');
    check('emptying the fields returns to the empty state', !A.$('empty').hidden && A.$('qr').hidden && A.$('pngBtn').disabled);
    check('no camera, no network on the way (no getUserMedia, fetch, XHR or socket)', A.traps.length === 0, A.traps);
  }
  {
    const L = bootApp({ launch: { url: 'example.org/page' } });
    await L.settle();
    check('a launch link with go.url opens with that link drawn', L.payload() === 'https://example.org/page' && L.drawn() && !!manifest.launch.url);
    const T = bootApp({ launch: { text: 'words from a link' } });
    await T.settle();
    check('a launch link with go.text opens with that text drawn', T.payload() === 'words from a link' && T.drawn() && !!manifest.launch.text);
    const O = bootApp({ saved: { id: 'last', payload: 'saved-from-1.0' } });
    await O.settle();
    check('a 1.0 save fills the text box and draws it on boot', O.$('f-text').value === 'saved-from-1.0' && O.drawn());
  }
  const css = parseCss(read('style.css'));
  check('primary buttons are 48px tall', cssVal(css, 'button', 'height').includes('48px'));
  const fieldFont = cssVal(css, 'input[type=text]', 'font').concat(cssVal(css, 'input[type=text]', 'font-size'));
  check('fields are 16px (no iOS zoom)', fieldFont.some((v) => /^16px\b/.test(v)) && cssVal(css, 'textarea', 'font').some((v) => /^16px\b/.test(v)), fieldFont);
  check('author CSS cannot un-hide [hidden]', cssVal(css, '[hidden]', 'display').some((v) => /^none\s*!important$/.test(v)));
  // TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the
  // OS app bar owns it). The only thing that marks such a control is its name.
  check('no in-app Invite button', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
  check('minBuild stays 947', manifest.minBuild === 947);
  check('save stays private', manifest.data.save.visibility === 'private');
  check('room stays read-only', manifest.data.room.visibility === 'read-only');
  check('no network or camera capability', !manifest.capabilities.network && !manifest.capabilities.camera);
  check('author is davidshimjs, not GifOS', JSON.parse(read('listing.json')).author.name === 'davidshimjs');
})();

appRuns.then(() => {
console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall green');
process.exit(failures ? 1 : 0);
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
