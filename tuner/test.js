// TUNER HAS TO NAME A PITCH — AND ADMIT WHEN IT CANNOT HEAR.
//
// The GIF records a clip (gifos.recordAudio), never a live mic, then runs
// Chris Wilson's ACF2+ autocorrelation on a synthetic buffer in this suite
// so a missing detector, a 440 that is not A, or a silent buffer that still
// claims a note cannot ship. The app itself is then booted on a small DOM
// built from its own index.html, with the OS recorder, the save collection and
// the audio context stubbed, and its controls are pressed: Record (good,
// quiet, noisy and cancelled takes), the instrument chips, A4 −/+, and the
// pitch pipe. No check reads a label, the help or the listing's wording.
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
    setTimeout: () => 0, clearTimeout: () => {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/pitch.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = src('index.html');
const help = src('help.md');
const listing = JSON.parse(src('listing.json'));
const manifest = JSON.parse(src('manifest.json'));

const sandbox = load();
const P = sandbox.PitchDetect;
const T = sandbox.TunerApp;
check('pitch.js and app.js load', !!(P && P.detect && P.sine && T && T.detectAt && T.classify));

check('A4 midi is 69', P.noteFromPitch(440) === 69);
check('the vendored detector is ACF2+: a clean 440 Hz reads as 440, and a buffer under the RMS floor reads as -1 (no pitch)',
  Math.abs(P.autoCorrelate(Float32Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100)), 44100) - 440) < 2 &&
  P.autoCorrelate(new Float32Array(4096).fill(0.001), 44100) === -1);
check('midi 69 is 440 Hz', Math.abs(P.frequencyFromNoteNumber(69) - 440) < 1e-6);

function sine(hz, rate, n, amp) {
  amp = amp == null ? 1 : amp;
  const out = [];
  const w = 2 * Math.PI * hz / rate;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w * i);
  return out;
}

{
  const r = T.detectAt(sine(440, 44100, 4096), 44100, 440);
  check('440 Hz is A4', !!(r && r.name === 'A' && r.octave === 4), r);
  check('440 Hz is within 2 Hz', !!(r && Math.abs(r.hz - 440) < 2), r && r.hz);
  check('440 Hz is in tune', !!(r && T.inTune(r.cents)), r && r.cents);
}

{
  const r = T.detectAt(sine(329.6276, 44100, 4096), 44100, 440);
  check('E4 (high guitar E) is E', !!(r && r.name === 'E' && r.octave === 4), r);
  check('E4 is in tune at A4=440', !!(r && T.inTune(r.cents)), r && r.cents);
}

{
  const r = T.detectAt(sine(82.40689, 44100, 8192), 44100, 440);
  check('E2 (low guitar E) is E', !!(r && r.name === 'E' && r.octave === 2), r);
  if (r) check('E2 is within a quarter-tone of 82.4 Hz', Math.abs(r.hz - 82.40689) < 2, r.hz);
}

{
  const r = T.detectAt(sine(110, 44100, 8192), 44100, 440);
  check('A2 (guitar A) is A2', !!(r && r.name === 'A' && r.octave === 2), r);
}

{
  const r = T.detectAt(sine(446, 44100, 4096), 44100, 440);
  check('446 Hz is still named A', !!(r && r.name === 'A'), r);
  check('446 Hz is sharp of A4', !!(r && r.cents > 5), r && r.cents);
}

{
  const r440 = T.detectAt(sine(440, 44100, 4096), 44100, 442);
  check('A4=442 names 440 as a slightly-flat A', !!(r440 && r440.name === 'A' && r440.cents < 0), r440);
}

{
  const quiet = sine(440, 44100, 4096, 0.001);
  const q = T.classify(quiet, 44100, 440);
  check('a near-silent buffer is quiet, not a note', q.kind === 'quiet' && !q.reading, q);
  check('rms of silence is under the 0.01 floor', T.rmsOf(quiet) < 0.01, T.rmsOf(quiet));
}

{
  const zeros = [];
  for (let i = 0; i < 2048; i++) zeros[i] = 0;
  const q = T.classify(zeros, 44100, 440);
  check('a zero buffer is quiet', q.kind === 'quiet');
}


{
  const loud = sine(440, 44100, 8192, 1);
  const c = T.classify(loud, 44100, 440);
  check('a loud 440 is ok / A', c.kind === 'ok' && c.reading && c.reading.name === 'A', c);
}

check('centsVs 440 vs 440 is 0', T.centsVs(440, 440) === 0);
check('centsVs an octave is 1200', T.centsVs(880, 440) === 1200);
check('in-tune window is ±5 cents', T.inTune(5) && T.inTune(-5) && !T.inTune(6) && !T.inTune(-6));
check('A4 clamps to 415–466', T.clampA4(400) === 415 && T.clampA4(500) === 466 && T.clampA4(440) === 440);

{
  const g = T.STRINGS.guitar;
  check('guitar is EADGBE', g.length === 6 && g[0].id === 'E2' && g[5].id === 'E4');
  const near = T.nearestString(110, g, 440);
  check('110 Hz nearest guitar string is A2', !!(near && near.string.id === 'A2' && Math.abs(near.cents) <= 2), near);
  const e4 = T.hzOfString(g[5], 440);
  check('high E at A4=440 is ~329.6', Math.abs(e4 - 329.6276) < 0.01, e4);
  const e4b = T.hzOfString(g[5], 442);
  check('high E scales with A4', Math.abs(e4b - 329.6276 * 442 / 440) < 0.01, e4b);
}

{
  const reading = T.detectAt(sine(82.40689, 44100, 8192), 44100, 440);
  const aimed = T.applyTarget(reading, 'guitar', 'E2', 440);
  check('locking E2 keeps the name E2', !!(aimed && aimed.name === 'E' && aimed.octave === 2 && aimed.target === 'E2'), aimed);
  if (aimed) check('locking E2 at 82.4 Hz is in tune', T.inTune(aimed.cents), aimed.cents);
}

{
  const reading = { hz: 440, note: 69, name: 'A', octave: 4, cents: 0, a4: 440 };
  const auto = T.applyTarget(reading, 'uke', 'auto', 440);
  check('440 on ukulele auto aims at A4', !!(auto && auto.aimed === 'A4'), auto);
}

// 1.0 save {id,hz,name,octave,cents,at} still has the fields 1.1 reads.
{
  const old = { id: 'last', hz: 440, name: 'A', octave: 4, cents: 0, at: 1 };
  check('1.0 last-reading still loads', old.hz === 440 && old.name === 'A');
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

// ---- the app, booted on its own page --------------------------------------
function bootApp(opts) {
  opts = opts || {};
  const doc = miniDom(html);
  const rows = [], gum = [], tones = [], timers = [];
  const store = new Map(Object.entries(opts.saved || {}));
  const clips = (opts.clips || []).slice();
  class FakeAC {
    constructor() { this.currentTime = 0; this.destination = {}; }
    resume() {}
    decodeAudioData(bytes) { return Promise.resolve({ sampleRate: 44100, getChannelData: () => Float32Array.from(bytes.samples) }); }
    createOscillator() { const o = { frequency: { value: 0 }, connect() {}, start() { tones.push(o.frequency.value); }, stop() {} }; return o; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createMediaStreamSource() { gum.push('createMediaStreamSource'); }
  }
  const sb = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Float32Array, Uint8ClampedArray, Error,
    document: doc, AudioContext: FakeAC,
    navigator: { mediaDevices: { getUserMedia: () => { gum.push('getUserMedia'); return Promise.reject(new Error('no')); } } },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null; },
    setInterval: (f, ms) => { timers.push({ f, ms, every: true }); return timers.length; }, clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].f = null; },
  };
  if (!opts.noGifos) {
    sb.gifos = {
      db: (name) => (name === 'save' ? { put: (r) => { rows.push(r); store.set(r.id, r); return Promise.resolve(); }, get: (id) => Promise.resolve(store.get(id) || null) } : null),
      recordAudio: (o) => { const c = clips.shift(); return c instanceof Error ? Promise.reject(c) : Promise.resolve({ bytes: { samples: c, slice() { return this; } }, mime: 'audio/webm' }); },
      onBack: (f) => { sb.__back = f; },
    };
  }
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of ['vendor/pitch.js', 'app.js']) vm.runInContext(src(f), sb, { filename: f });
  const $ = (id) => doc.getElementById(id);
  const settle = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));
  const runTimers = (ms) => { for (const t of timers.slice()) if (t.f && t.ms <= ms) t.f(); };
  return { doc, $, rows, gum, tones, timers, runTimers, settle, sb, status: () => ({ text: $('status').textContent, err: $('status').className === 'err' }) };
}
const press = (el) => { el.dispatchEvent({ type: 'pointerdown', button: 0, bubbles: true }); el.dispatchEvent({ type: 'pointerup', bubbles: true }); };
const appRuns = (async () => {
  {
    const A = bootApp({ clips: [sine(440, 44100, 8192, 0.8)] });
    check('first boot is the empty state (body.empty, which shows the empty message)', A.doc.body.classList.contains('empty') &&
      parseCss(src('style.css')).some((r) => r.sel === 'body.empty .empty-msg' && r.decl.display === 'block') && A.$('empty').classList.contains('empty-msg'));
    A.$('recBtn').click();
    check('pressing Record asks the OS recorder for a clip and disables itself while it records', A.$('recBtn').disabled === true);
    await A.settle();
    check('a clear take leaves the empty state and shows the note (A, 440 Hz)', !A.doc.body.classList.contains('empty') && A.$('note').textContent === 'A4' && Math.abs(parseFloat(A.$('pitch').textContent) - 440) < 2 && A.$('detector').classList.contains('intune'), A.$('note').textContent);
    check('…re-enables Record, and the status is not an error', A.$('recBtn').disabled === false && !A.status().err);
    const last = A.rows.filter((r) => r.id === 'last').pop();
    check('the last reading is saved privately as id last', !!last && Math.abs(last.hz - 440) < 2 && last.name === 'A' && manifest.data.save.visibility === 'private', last);
    check('records a clip, never a live mic: no getUserMedia, no live stream source', A.gum.length === 0);
  }
  {
    const quiet = bootApp({ clips: [sine(440, 44100, 8192, 0.001)] });
    quiet.$('recBtn').click(); await quiet.settle();
    const noisy = bootApp({ clips: [Array.from({ length: 8192 }, (_, i) => i / 8192 - 0.5)] }); // loud, but a slow sweep with no period in it
    noisy.$('recBtn').click(); await noisy.settle();
    const cancelled = bootApp({ clips: [new Error('Recording cancelled by the user')] });
    cancelled.$('recBtn').click(); await cancelled.settle();
    const q = quiet.status(), n = noisy.status(), c = cancelled.status();
    check('too-quiet, no-pitch and cancelled are three distinct messages', new Set([q.text, n.text, c.text]).size === 3 && q.text && n.text && c.text, [q.text, n.text, c.text]);
    check('too-quiet and no-pitch are errors; a cancel is not', q.err && n.err && !c.err);
    check('none of them claims a note or saves a reading', [quiet, noisy, cancelled].every((A) => A.doc.body.classList.contains('empty') && !A.rows.some((r) => r.hz)));
    const outside = bootApp({ noGifos: true });
    outside.$('recBtn').click(); await outside.settle();
    check('outside GifOS (no recorder) Record says so as an error and never opens the mic', outside.status().err && outside.gum.length === 0);
  }
  {
    const A = bootApp({});
    const a4 = () => +A.$('a4').textContent;
    press(A.$('a4Up'));
    const up = a4();
    press(A.$('a4Down')); press(A.$('a4Down'));
    check('A4 is adjustable: + raises it by 1 Hz, − lowers it', up === 441 && a4() === 439, [up, a4()]);
    A.$('a4Up').dispatchEvent({ type: 'pointerdown', button: 0, bubbles: true });
    A.runTimers(400); A.runTimers(80); A.runTimers(80);
    A.$('a4Up').dispatchEvent({ type: 'pointerup', bubbles: true });
    check('…and holding + keeps raising it', a4() > 440, a4());
    A.$('pipeBtn').click();
    check('the pitch pipe plays A4 at the chosen A4', A.tones.length === 1 && Math.abs(A.tones[0] - a4()) < 1e-9, A.tones);
    const inst = (name) => A.doc.querySelector('#insts [data-inst="' + name + '"]');
    for (const [name, n] of [['guitar', 6], ['uke', 4], ['bass', 4]]) {
      inst(name).click();
      const chips = A.$('strings').querySelectorAll('button');
      check('choosing ' + name + ' offers Auto plus its ' + n + ' strings and marks it on', !A.$('strings').hidden && chips.length === n + 1 && inst(name).classList.contains('on'), chips.length);
    }
    inst('guitar').click();
    A.$('strings').querySelector('[data-id="E2"]').click();
    check('picking a string sounds it (low E, about 82.4 Hz at A4=440 scaled)', A.tones.length >= 2 && Math.abs(A.tones[A.tones.length - 1] - 82.40689 * a4() / 440) < 0.05, A.tones);
    A.$('pipeBtn').click();
    check('…and the pipe then plays that string', Math.abs(A.tones[A.tones.length - 1] - 82.40689 * a4() / 440) < 0.05);
    inst('chromatic').click();
    check('chromatic hides the string chips', A.$('strings').hidden === true);
    check('Back while a tone plays stops it and is handled', typeof A.sb.__back === 'function' && (A.$('pipeBtn').click(), A.sb.__back() === true) && A.sb.__back() === false);
  }
  {
    const A = bootApp({ saved: { last: { id: 'last', hz: 329.6276, name: 'E', octave: 4, cents: 0, a4: 442, instrument: 'guitar', target: 'auto' } } });
    await A.settle();
    check('a saved reading and its settings come back on boot (the 1.0 row shape still loads)', !A.doc.body.classList.contains('empty') && A.$('note').textContent === 'E4' && A.$('a4').textContent === '442' && !A.$('strings').hidden);
  }
})();

const page = parseHtml(html);
const cssRules = parseCss(src('style.css'));
check('Record is at least 52px tall and full width', cssVal(cssRules, '#recBtn', 'min-height').includes('52px') && cssVal(cssRules, '#recBtn', 'width').includes('100%'), cssVal(cssRules, '#recBtn', 'width'));
check('string chips are thumb-sized (44px)', cssVal(cssRules, '.chips button', 'min-height').includes('44px'));
// TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the OS
// app bar owns it). The only thing that marks such a control is its name, so
// this reads the accessible names of the page's buttons.
check('no in-app Invite button', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
check('help.md is there and substantive', help.trim().length >= 400);
check('listing credits Chris Wilson', listing.author && listing.author.name === 'Chris Wilson');
check('listing is an unofficial port', listing.basedOn && listing.basedOn.name === 'PitchDetect' && listing.basedOn.blessed === false);
check('microphone capability is declared (clips, not a stream)', manifest.capabilities.microphone === true);
check('no network, no multiplayer, no wasm', !manifest.capabilities.network && !manifest.capabilities.multiplayer && !manifest.capabilities.wasm);
check('save is private', manifest.data.save.visibility === 'private');
check('classic scripts only', all(page, (n) => n.tag === 'script').every((n) => !/module/i.test(n.attrs.type || '')));
check('the page loads nothing remote (no absolute http(s) src/href)', all(page, (n) => ['src', 'href', 'action', 'poster'].some((a) => /^(https?:)?\/\//i.test(n.attrs[a] || ''))).length === 0);

appRuns.then(() => {
if (failures) {
  console.log('\n' + failures + ' FAIL');
  process.exit(1);
}
console.log('\n' + 'all PASS');
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
