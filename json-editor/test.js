// JSON EDITOR HAS TO PARSE AND EDIT A FIXTURE.
//
// The wrap shipped josdejong/jsoneditor's dist, but nothing in the repo played
// a document: empty first-run dumped a sample, invalid JSON still said
// "Saved", and Tree/Code on a phone was a 24px menu. This suite loads app.js
// in a vm (the Ace bundle needs a real DOM) and parses, formats, repairs,
// and edits a fixture — so a swallowed parse error or a broken save record
// cannot ship again. The app is then booted on a small DOM built from its
// own index.html, with a recording stand-in for the JSONEditor widget, and its
// tabs, buttons, Back and the read-only meeting view are driven. No check
// reads a label, the help or the listing's wording.
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
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error,
    parseInt, isNaN, Promise, setTimeout, clearTimeout, FileReader: function () {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = null;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'mp.js'), 'utf8'), sandbox, { filename: 'mp.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = load();
const App = sandbox.JsonEditorApp;

check('app.js exports parseJson / formatText / repairText / loadRecord',
  !!(App && App.parseJson && App.formatText && App.compactText && App.repairText && App.loadRecord && App.persistRecord && App.setAt));

const FIXTURE = {
  project: 'notes',
  offline: true,
  modes: ['tree', 'code'],
  user: { id: 'a1', role: 'editor' },
  items: [
    { id: 'x', n: 1 },
    { id: 'y', n: 2 }
  ]
};

{
  const p = App.parseJson(JSON.stringify(FIXTURE));
  check('fixture parses', !!(p.value && p.value.project === 'notes' && p.value.items[1].id === 'y'), p.value);
  check('fixture is not empty', !App.isEmptyDoc(p.value));
  const edited = App.setAt(p.value, ['user', 'role'], 'guest');
  check('setAt edits a nested field', edited.user.role === 'guest', edited.user);
  const compact = App.compactText(JSON.stringify(edited));
  check('compact round-trips the edit', compact.value.user.role === 'guest' && compact.text.indexOf('\n') < 0, compact.text && compact.text.slice(0, 80));
  const pretty = App.formatText(compact.text);
  check('format pretty-prints the edited fixture', pretty.text.indexOf('\n') >= 0 && pretty.value.items[0].n === 1, pretty.text && pretty.text.slice(0, 60));
}

{
  const p = App.parseJson('');
  check('empty string is empty, not a parse error', !!(p.empty && !p.error && !('value' in p)));
  check('whitespace-only is empty', !!App.parseJson('  \n\t  ').empty);
  check('empty object is empty-looking', App.isEmptyDoc({}));
  check('empty array is empty-looking', App.isEmptyDoc([]));
  check('null is a document, not empty-looking', App.isEmptyDoc(null) === false);
  check('0 is a document, not empty-looking', App.isEmptyDoc(0) === false);
}

{
  const p = App.parseJson('{');
  check('truncated JSON is an error', !!(p.error && /valid JSON/i.test(p.message)), p);
  check('…and does not invent a value', p.value === undefined);
  const bad = App.parseJson('{not json}');
  check('invalid JSON is an error', !!(bad.error && /valid JSON/i.test(bad.message)), bad);
  const fmt = App.formatText('{');
  check('format refuses invalid JSON', !!(fmt.error && /valid JSON/i.test(fmt.message)));
  const cmp = App.compactText('{not');
  check('compact refuses invalid JSON', !!(cmp.error));
}

{
  const trail = App.repairText('{ "a": 1, }');
  check('repair trailing comma', !!(trail.value && trail.value.a === 1 && trail.repaired), trail);
  const keys = App.repairText('{ a: 1, b: 2 }');
  check('repair unquoted keys', !!(keys.value && keys.value.a === 1 && keys.value.b === 2), keys);
  const comments = App.repairText('{ "a": 1 } // keep me\n');
  check('repair strips a line comment', !!(comments.value && comments.value.a === 1), comments);
  const already = App.repairText('{"a":1}');
  check('repair of valid JSON is not marked repaired', already.repaired === false && already.value.a === 1);
  const hopeless = App.repairText('{');
  check('repair of truncated JSON stays an error', !!(hopeless.error && /valid JSON/i.test(hopeless.message)));
  const html = App.friendlyError({ message: "Parse error on line 1:<br>{<br>-^<br>Expecting 'STRING', '}', got 'EOF'" });
  check('friendlyError strips html from ace parse errors and keeps the parser\'s detail', html.indexOf('<') < 0 && /EOF/.test(html) && /line 1/.test(html), html);
}

{
  const first = App.loadRecord(null);
  check('first-run is empty, not the sample', !!(first.empty && first.doc && Object.keys(first.doc).length === 0), first);
  check('sample is richer than the empty object', App.SAMPLE && App.SAMPLE.items && App.SAMPLE.items.length === 2);

  const saved = App.persistRecord('tree', App.parseJson(JSON.stringify(FIXTURE)));
  check('persist of a valid document stores doc, not text', saved.id === 'last' && saved.doc && saved.doc.project === 'notes' && saved.text === null, saved);
  const loaded = App.loadRecord(saved);
  check('saved document loads back', loaded.doc && loaded.doc.user.id === 'a1' && loaded.mode === 'tree' && !loaded.empty);

  const invalid = App.persistRecord('code', App.parseJson('{'));
  check('persist of invalid JSON keeps the text', invalid.doc === null && invalid.text === '{' && invalid.mode === 'code', invalid);
  const loadedBad = App.loadRecord(invalid);
  check('invalid last document comes back as text, honestly (flagged invalid, with a message)', !!(loadedBad.invalid && loadedBad.mode === 'code' && loadedBad.text === '{' && typeof loadedBad.message === 'string' && loadedBad.message.length > 0), loadedBad);

  const old = App.loadRecord({ id: 'last', mode: 'tree', doc: { greeting: 'Hello' }, text: null });
  check('v1 save {doc, mode} still loads', old.doc && old.doc.greeting === 'Hello' && old.mode === 'tree');

  const oldText = App.loadRecord({ id: 'last', mode: 'text', doc: null, text: '{"a":1}' });
  check('v1 text-mode save maps to code', oldText.mode === 'code' && oldText.doc && oldText.doc.a === 1);
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
  const net = [], puts = [], roomPuts = [], media = [];
  let subscriber = null, backFn = null;
  const editors = [];
  class FakeJSONEditor {
    constructor(el, o) { this.el = el; this.o = o; this.mode = o.mode; this.text = '{}'; this.workerOff = 0; editors.push(this);
      const self = this; this.aceEditor = { session: { setUseWorker: (v) => { if (v === false) self.workerOff++; } }, setOption: () => {} }; }
    setMode(m) { this.mode = m; } getMode() { return this.mode; }
    set(v) { this.text = JSON.stringify(v); } get() { return JSON.parse(this.text); }
    setText(t) { this.text = t; } getText() { return this.text; } expandAll() {}
    type(t) { this.text = t; this.o.onChange(); } // a person typing into the widget
  }
  const sb = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, parseInt, isNaN, Promise, Uint8ClampedArray,
    setTimeout: (f) => { f(); return 1; }, clearTimeout() {}, document: doc, JSONEditor: FakeJSONEditor,
    FileReader: function () { this.readAsText = (f) => { this.result = f.text; this.onload(); }; },
    matchMedia: (q) => { media.push(q); return { matches: !!opts.phone && q === '(max-width: 640px)' }; },
    fetch: (u) => { net.push(String(u)); const p = Promise.reject(new Error('offline')); p.catch(() => {}); return p; },
    XMLHttpRequest: function () { net.push('xhr'); }, WebSocket: function (u) { net.push('ws ' + u); },
    navigator: { clipboard: { writeText: (t) => { sb.__copied = t; return Promise.resolve(); } } },
    gifos: {
      db: (name) => name === 'save' ? { get: () => Promise.resolve(opts.saved || null), put: (r) => { puts.push(r); return Promise.resolve(); } }
        : { put: (r) => { roomPuts.push(r); return Promise.resolve(); }, subscribe: (f) => { subscriber = f; } },
      onBack: (f) => { backFn = f; }, me: () => Promise.resolve({ id: opts.owner === false ? 'guest-1' : 'host-1', name: 'Test Person' }),
      info: () => Promise.resolve({ owner: opts.owner !== false }),
    },
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(read('mp.js'), sb, { filename: 'mp.js' });
  vm.runInContext(read('app.js'), sb, { filename: 'app.js' });
  const $ = (id) => doc.getElementById(id);
  return { doc, $, sb, net, puts, roomPuts, media, ed: () => editors[0], back: () => backFn && backFn(), room: (list) => subscriber && subscriber(list),
    settle: () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r))) };
}
const appRuns = (async () => {
  const page = parseHtml(read('index.html'));
  {
    const A = bootApp({});
    await A.settle();
    const ed = A.ed();
    check('first run: the editor opens on an empty object with the empty hint showing', !!ed && ed.getText() === '{}' && A.$('hint').hidden === false && A.$('err').hidden === true);
    check('the widget is made with Tree and Code modes', !!ed && JSON.stringify(ed.o.modes) === '["tree","code"]');
    A.$('sampleBtn').click();
    check('Sample fills the editor with the sample and hides the hint', JSON.parse(ed.getText()).items.length === 2 && A.$('hint').hidden === true);
    const tabs = all(page, (n) => n.attrs.role === 'tablist')[0];
    check('Tree and Code tabs exist as buttons in the tab list', !!tabs && byId(page, 'tabTree') && within(byId(page, 'tabTree'), tabs) && within(byId(page, 'tabCode'), tabs) &&
      byId(page, 'tabTree').tag === 'button' && byId(page, 'tabCode').tag === 'button');
    A.$('tabCode').click();
    check('clicking Code switches the widget to code and marks the tab selected', ed.mode === 'code' && A.$('tabCode').classList.contains('on') && A.$('tabCode').getAttribute('aria-selected') === 'true' && A.$('tabTree').getAttribute('aria-selected') === 'false');
    check('Ace workers are turned off in Code', ed.workerOff > 0);
    ed.type('{"a": ');
    check('invalid JSON is kept as text, an error shows, and the saved record holds the text (no false "saved document")', A.$('err').hidden === false &&
      A.puts.length > 0 && A.puts[A.puts.length - 1].doc === null && A.puts[A.puts.length - 1].text === '{"a": ');
    A.$('tabTree').click();
    check('…and Tree refuses until it is valid: it stays in Code', ed.mode === 'code' && A.$('tabCode').classList.contains('on'));
    A.$('repairBtn').click();
    ed.type('{"a": 1, "b": [1, 2]}');
    check('valid JSON clears the error and saves the document', A.$('err').hidden === true && A.puts[A.puts.length - 1].doc && A.puts[A.puts.length - 1].doc.b[1] === 2);
    A.$('compactBtn').click();
    // (Compact's one-line text is re-pretty-printed when the editor is in Code:
    // applyParsed re-stringifies with indentation. Reported, not pinned here.)
    check('Compact keeps the same document and saves it', JSON.stringify(JSON.parse(ed.getText())) === '{"a":1,"b":[1,2]}' && A.puts[A.puts.length - 1].doc.b[1] === 2);
    A.$('formatBtn').click();
    check('Format pretty-prints it', ed.getText().indexOf('\n') > 0 && JSON.parse(ed.getText()).b[0] === 1);
    A.$('tabTree').click();
    check('Tree works again once the text is valid', ed.mode === 'tree' && A.$('tabTree').classList.contains('on'));
    A.$('copyBtn').click(); await A.settle();
    check('Copy puts the document on the clipboard', JSON.parse(A.sb.__copied).a === 1);
    A.$('file').files = [{ text: '{"opened": true}' }]; A.$('file').dispatchEvent({ type: 'change' });
    check('Open reads a file into the editor', JSON.parse(ed.getText()).opened === true);
    A.$('newBtn').click();
    check('New empties the document', ed.getText() === '{}');
    check('Back on a computer is not handled by the app', A.back() === false);
    check('the app reached for no network on the way (no fetch, XHR or socket)', A.net.length === 0, A.net);
  }
  {
    // Back on a phone in Code returns to Tree, at the same breakpoint the CSS uses.
    const P = bootApp({ phone: true });
    await P.settle();
    P.$('tabCode').click();
    const handled = P.back();
    const q = P.media.find((m) => /max-width/.test(m)) || '(the app asked no breakpoint)';
    const css = parseCss(read('style.css'));
    const phoneRules = css.filter((r) => r.media === q.replace(/^\(|\)$/g, '') || '(' + r.media.replace(/^\(|\)$/g, '') + ')' === q);
    check('Back on a phone in Code goes to Tree and is handled', handled === true && P.ed().mode === 'tree');
    check('on that phone breakpoint the CSS hides the widget menu and cancels its negative top margin',
      phoneRules.some((r) => r.sel === '.jsoneditor-menu' && /none/.test(r.decl.display)) &&
      phoneRules.some((r) => r.sel === 'div.jsoneditor-outer.has-main-menu-bar' && /^0\b/.test(r.decl['margin-top'])), q);
  }
  {
    // The meeting: the host publishes its document; a guest sees it read-only
    // and its own last document is held aside, not overwritten.
    const H = bootApp({ saved: { id: 'last', mode: 'tree', doc: { mine: 1 }, text: null } });
    await H.settle();
    H.ed().type('{"shared": 42}');
    const pub = H.roomPuts[H.roomPuts.length - 1];
    check('the host publishes its document to the room', !!pub && pub.id === 'shared' && JSON.parse(pub.text).shared === 42);
    const G = bootApp({ owner: false, saved: { id: 'last', mode: 'tree', doc: { mine: 2 }, text: null } });
    await G.settle();
    const before = G.puts.length;
    G.room([{ id: 'shared', mode: 'tree', text: '{"shared": 42}' }]);
    check('a guest shows the host\'s document, read-only', JSON.parse(G.ed().getText()).shared === 42 && G.ed().o.onEditable() === false && G.doc.body.classList.contains('guest'));
    G.$('newBtn').click(); G.ed().type('{"tamper": true}');
    check('…and nothing a guest does is saved over its own document', G.puts.length === before);
  }
  {
    const vendorDoc = miniDom(read('index.html'));
    const vb = { console, setTimeout, clearTimeout, navigator: { userAgent: 'node' }, document: vendorDoc };
    vb.window = vb; vb.self = vb; vb.globalThis = vb;
    vm.createContext(vb);
    let ok = false; try { vm.runInContext(read('vendor/jsoneditor.min.js'), vb); ok = typeof vb.JSONEditor === 'function'; } catch (e) { ok = false; }
    check('the vendored jsoneditor dist loads and defines JSONEditor', ok);
    const urls = (read('vendor/jsoneditor.min.css').match(/url\(([^)]*)\)/g) || []).map((u) => u.slice(4, -1).replace(/^["']|["']$/g, ''));
    check('its CSS fetches nothing: every url() is an inline data: URI (the icon sprite included)', urls.length > 0 && urls.every((u) => /^data:/.test(u)), urls.length);
  }
  // TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the
  // OS app bar owns it). The only thing that marks such a control is its name.
  check('no in-app Invite button', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
  check('the page loads nothing remote (no absolute http(s) src/href)', all(page, (n) => ['src', 'href', 'action', 'poster'].some((a) => /^(https?:)?\/\//i.test(n.attrs[a] || ''))).length === 0);
  const listing = JSON.parse(read('listing.json'));
  const manifest = JSON.parse(read('manifest.json'));
  check('capabilities.db and multiplayer stay declared',
    manifest.capabilities && manifest.capabilities.db === true && manifest.capabilities.multiplayer === true && manifest.minBuild === 947);
  check('no network capability', !manifest.capabilities.network);
  check('save is private, room is read-only',
    manifest.data && manifest.data.save && manifest.data.save.visibility === 'private' &&
    manifest.data.room && manifest.data.room.visibility === 'read-only');
  check('author is Jos de Jong, never GifOS',
    listing.author && /Jos de Jong/i.test(listing.author.name) && listing.porter && listing.porter.name === 'GifOS' && listing.basedOn && listing.basedOn.blessed === false);
})();

appRuns.then(() => {
if (failures) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nAll json-editor checks passed.');
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
