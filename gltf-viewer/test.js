// glTF Viewer has to refuse remote skies, refuse compressed files, inline
// sibling buffers, and keep the last model on this device. A vm can play that
// loop without WebGL. The app shell (app.js) is then booted on a small DOM
// built from its own index.html, with a stand-in for the WebGL viewer, and
// used: open a model, a big model, Inspect and Back, a saved model. The phone
// layout is read from the parsed stylesheet. No check reads wording.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function loadViewer() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Map,
    Uint8Array, ArrayBuffer, DataView, atob, btoa,
    setTimeout: (fn) => { fn(); return 0; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'viewer.js'), 'utf8'), sandbox, { filename: 'viewer.js' });
  return sandbox;
}

const S = loadViewer();
const V = S.GltfViewer;
check('viewer.js attaches GltfViewer', !!(V && V.isGlb && V.inlineGltf && V.refuseCompressed && V.glbJson));

const glbMagic = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0, 0, 0, 2]).buffer;
check('isGlb: glTF magic', V.isGlb(glbMagic));
check('isGlb: rejects junk', !V.isGlb(new Uint8Array([0, 1, 2, 3]).buffer));

{
  const json = V.inlineGltf(
    '{"asset":{"version":"2.0"},"buffers":[{"uri":"a.bin","byteLength":3}]}',
    new Map([['a.bin', new Uint8Array([1, 2, 3]).buffer]])
  );
  check('inlineGltf: sibling .bin becomes a data: URI', json.buffers[0].uri.indexOf('data:') === 0);
}

function throws(fn, re) {
  try { fn(); return false; } catch (e) { return re.test(String(e && e.message)); }
}

check('Draco is refused by name',
  throws(() => V.inlineGltf('{"extensionsUsed":["KHR_draco_mesh_compression"]}', new Map()), /Draco/));
check('Meshopt is refused by name',
  throws(() => V.inlineGltf('{"extensionsUsed":["EXT_meshopt_compression"]}', new Map()), /Meshopt/));
check('KTX2 / basisu is refused by name',
  throws(() => V.inlineGltf('{"extensionsRequired":["KHR_texture_basisu"]}', new Map()), /KTX2/));
check('a missing sidecar names the file',
  throws(() => V.inlineGltf('{"buffers":[{"uri":"mesh.bin","byteLength":4}]}', new Map()), /mesh\.bin/));

function makeGlb(obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const pad = (4 - (body.length % 4)) % 4;
  const jsonLen = body.length + pad;
  const total = 12 + 8 + jsonLen;
  const buf = Buffer.alloc(total);
  buf.write('glTF', 0);
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(total, 8);
  buf.writeUInt32LE(jsonLen, 12);
  buf.writeUInt32LE(0x4E4F534A, 16);
  body.copy(buf, 20);
  for (let i = 0; i < pad; i++) buf[20 + body.length + i] = 0x20;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

{
  const plain = makeGlb({ asset: { version: '2.0' } });
  check('glbJson reads the JSON chunk of a GLB', V.glbJson(plain) && V.glbJson(plain).asset.version === '2.0');
  const draco = makeGlb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression'] });
  check('a Draco GLB is refused before parse',
    throws(() => V.refuseCompressed(V.glbJson(draco)), /Draco/));
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
// ---- the page's inline scripts as a syntax tree (acorn), not as text ----
const acorn = require('acorn');
function pageScripts(page) {
  const out = [], re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(page))) {
    if (/type=["'](?!(text|application)\/javascript|module)/.test(m[1])) continue;
    out.push({ code: m[2], ast: acorn.parse(m[2], { ecmaVersion: 'latest', sourceType: /module/.test(m[1]) ? 'module' : 'script' }) });
  }
  return out;
}
// Visit every node with its ancestor chain.
function walkAst(node, fn, parents) {
  parents = parents || [];
  fn(node, parents);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k === 'parent') continue;
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walkAst(c, fn, parents.concat([node])); }
    else if (v && typeof v.type === 'string') walkAst(v, fn, parents.concat([node]));
  }
}
// The name of the nearest named function around a node ('' at top level).
function fnNameOf(parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i];
    if (p.type === 'FunctionDeclaration' && p.id) return p.id.name;
    if ((p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression')) {
      const up = parents[i - 1];
      if (up && up.type === 'VariableDeclarator' && up.id.type === 'Identifier') return up.id.name;
      if (up && up.type === 'Property' && up.key) return up.key.name || up.key.value;
      if (up && up.type === 'AssignmentExpression') return srcOfMember(up.left);
    }
  }
  return '';
}
function srcOfMember(n) {
  if (!n) return '';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'MemberExpression') return srcOfMember(n.object) + '.' + (n.computed ? '[' + (n.property.value !== undefined ? n.property.value : '?') + ']' : n.property.name);
  return '?';
}

// ---- the app shell, booted on its own page ----------------------------------
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
function bootApp(opts) {
  opts = opts || {};
  const doc = miniDom(read('index.html'));
  const puts = [], traps = [], viewers = [];
  let back = null;
  class FakeViewer {
    constructor(el) { this.el = el; this.state = {}; this.clips = []; this.content = null; viewers.push(this); }
    loadBytes(name, buf) { if (opts.loadFails) return Promise.reject(new Error('Draco compressed files are not supported here')); this.content = { name }; return Promise.resolve(); }
    stats() { return { meshes: 1, materials: 1, triangles: 12, vertices: 8, cameras: 0, bones: 0, clips: 0 }; }
    graph() { return [{ depth: 0, label: 'Scene', uuid: 'u1' }]; }
    updateDisplay() {} updateEnvironment() {} resize() {} resetView() { this.reset = true; } playAll() {} pauseAll() {} flash() {}
  }
  const sb = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Map, Uint8Array, ArrayBuffer, Promise, Error,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, document: doc, GltfViewer: FakeViewer,
    fetch: (u) => { traps.push('fetch ' + u); const p = Promise.reject(new Error('offline')); p.catch(() => {}); return p; },
    XMLHttpRequest: function () { traps.push('xhr'); }, WebSocket: function () { traps.push('ws'); },
    FileReader: function () { this.readAsArrayBuffer = (f) => { this.result = f.buf; this.onload(); }; },
    gifos: {
      db: (name) => name === 'save' ? { get: () => Promise.resolve(opts.saved || null), put: (r) => { puts.push(r); return Promise.resolve(); } } : { subscribe() {} },
      onBack: (f) => { back = f; },
    },
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(read('app.js'), sb, { filename: 'app.js' });
  const $ = (id) => doc.getElementById(id);
  const open = (name, bytes) => { $('file-input').files = [{ name, buf: new Uint8Array(bytes).buffer }]; $('file-input').dispatchEvent({ type: 'change' }); };
  return { doc, $, puts, traps, viewers, open, back: () => back && back(), settle: () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r))) };
}
const appRuns = (async () => {
  const page = parseHtml(read('index.html'));
  const manifest = JSON.parse(read('manifest.json'));
  const listing = JSON.parse(read('listing.json'));
  {
    const A = bootApp();
    await A.settle();
    check('at first the placeholder shows and the viewer and HUD are hidden', !A.$('placeholder').hidden && A.$('viewer').hidden && A.$('hud').hidden);
    const glb = new Uint8Array(makeGlb({ asset: { version: '2.0' } }));
    A.open('box.glb', glb);
    await A.settle();
    check('opening a model shows the viewer and the HUD, and marks the page loaded', A.viewers.length === 1 && !A.$('viewer').hidden && !A.$('hud').hidden && A.doc.body.classList.contains('loaded'));
    const hud = A.$('hud');
    check('Open stays available after a model loads (the HUD carries a control for the same file input)', !!hud.querySelector('label[for="file-input"]') && !!A.$('file-input'));
    const last = A.puts.filter((r) => r.id === 'last').pop();
    check('the last model is saved privately as id last, bytes and all', !!last && last.name === 'box.glb' && last.bytes && last.bytes.byteLength === glb.byteLength && manifest.data.save.visibility === 'private');
    A.$('toggleInspect').click();
    check('Inspect opens the scene panel (body.inspect)', A.doc.body.classList.contains('inspect'));
    check('Back closes Inspect and is handled', A.back() === true && !A.doc.body.classList.contains('inspect'));
    check('…and with Inspect closed Back is not the app\'s', A.back() === false);
    A.open('big.glb', new Uint8Array(8 * 1024 * 1024 + 1));
    await A.settle();
    const big = A.puts.filter((r) => r.id === 'last').pop();
    check('a model over 8 MB opens but is not stuffed into the file (no bytes saved), and the person is told', big.name === 'big.glb' && !big.bytes && !A.$('toast').hidden);
    A.open('edge.glb', new Uint8Array(8 * 1024 * 1024));
    await A.settle();
    const edge = A.puts.filter((r) => r.id === 'last').pop();
    check('…a model of exactly 8 MB is kept', edge.name === 'edge.glb' && edge.bytes && edge.bytes.byteLength === 8 * 1024 * 1024);
    check('the app shell reached for no network (no fetch, XHR or socket)', A.traps.length === 0, A.traps);
  }
  {
    const B = bootApp({ saved: { id: 'last', name: 'saved.glb', bytes: new Uint8Array(makeGlb({ asset: { version: '2.0' } })), wireframe: true } });
    await B.settle();
    check('the last model comes back on boot, with its display settings', B.viewers.length === 1 && B.viewers[0].content && B.viewers[0].content.name === 'saved.glb' && B.$('wireframe').checked === true);
    const C = bootApp({ loadFails: true });
    await C.settle();
    C.open('draco.glb', new Uint8Array(16));
    await C.settle();
    check('a model the viewer refuses shows its reason and opens Inspect so it can be read', !C.$('err').hidden && C.$('err').textContent.length > 0 && C.doc.body.classList.contains('inspect'));
  }
  const css = parseCss(read('style.css'));
  check('the canvas takes pinch and drag itself (touch-action none)', cssVal(css, '.viewer canvas', 'touch-action').includes('none'));
  const phone = (sel, prop) => cssVal(css, sel, prop, 'max-width: 640px');
  check('on a phone Inspect is a sheet: off screen below until body.inspect slides it in',
    phone('aside', 'transform').some((v) => /translateY\((\d+)%\)/.test(v) && +/translateY\((\d+)%\)/.exec(v)[1] >= 100) &&
    phone('body.inspect aside', 'transform').includes('translateY(0)') && phone('aside', 'position').includes('absolute'));
  check('hidden wins over display:flex, and a loaded page hides the placeholder (the empty state cannot cover the model)',
    cssVal(css, '[hidden]', 'display').some((v) => /^none\s*!important$/.test(v)) && cssVal(css, 'body.loaded .placeholder', 'display').some((v) => /^none/.test(v)));
  // TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the
  // OS app bar owns it). The only thing that marks such a control is its name.
  check('no in-app Invite button', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
  const accept = (byId(page, 'file-input').attrs.accept || '').split(',').map((x) => x.trim());
  check('the picker offers glTF, its sidecars and images, and no .ktx2 (this copy does not unpack it)', accept.includes('.glb') && accept.includes('.gltf') && accept.includes('.bin') && !accept.includes('.ktx2'), accept);
  // TEXT-CHECK: AST, not wording. viewer.js needs WebGL to run; its syntax tree
  // must hold no call to fetch, no XMLHttpRequest or WebSocket, and no URL to a
  // CDN (the loaders must never fetch a decoder).
  const vAst = acorn.parse(read('viewer.js'), { ecmaVersion: 'latest' });
  const bad = [];
  walkAst(vAst, (n) => {
    if (n.type === 'CallExpression' && /(^|\.)fetch$/.test(srcOfMember(n.callee))) bad.push('fetch');
    if (n.type === 'NewExpression' && /(XMLHttpRequest|WebSocket)$/.test(srcOfMember(n.callee))) bad.push(srcOfMember(n.callee));
    if (n.type === 'Literal' && typeof n.value === 'string' && /^(https?:)?\/\//.test(n.value)) bad.push(n.value);
  });
  check('viewer.js fetches nothing (no fetch, XHR, socket or remote URL)', bad.length === 0, bad);
  check('no network capability', !manifest.capabilities.network);
  check('no wasm capability (loaders never fetch decoders)', !manifest.capabilities.wasm);
  check('save collection is private', manifest.data.save.visibility === 'private');
  check('help.md is there and substantive', read('help.md').trim().length > 400);
  check('author is Don McCurdy, porter is GifOS', listing.author.name === 'Don McCurdy' && listing.porter.name === 'GifOS');
})();

appRuns.then(() => {
console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL PASS');
process.exit(failures ? 1 : 0);
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
