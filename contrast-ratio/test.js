// Contrast Ratio's "Best" button has to be RIGHT, not merely plausible.
//
// The most contrast any colour can have against a fixed one is pure black or
// pure white — contrast is a ratio of luminances, so it only grows as the two
// separate, and the ceiling is an endpoint of the scale. Which endpoint wins
// is NOT "black if the other is light": against #777 black wins 4.69 to 4.48,
// and the crossover sits well above 50% grey (a mid grey is closer to white
// in luminance than the eye suggests). So the pick is measured, and this
// pins the measurement.
//
// It also pins the asymmetry the button has to respect: alpha is not
// symmetric — the text composites ON the background — so replacing the
// background is a different calculation from replacing the text, and against
// a see-through colour the pick is judged on the WORST case, never the
// average, or the answer flips depending on what happens to sit underneath.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// app.js boots only when there is a document with its fields in it; with no
// document at all it just publishes ContrastRatio, which is what we want.
function load() {
  const sandbox = {
    console, Math, Object, Array, JSON, String, Number, Boolean,
    parseInt, parseFloat, isNaN, Infinity, Error, TypeError, RegExp,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: function () {},
    addEventListener: function () {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'color.js'), 'utf8'), sandbox, { filename: 'color.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = load();
const App = sandbox.ContrastRatio;
const Color = sandbox.Color;

check('app.js publishes ContrastRatio without a document', !!App);
check('…including bestAgainst', !!App && typeof App.bestAgainst === 'function');
if (!App || typeof App.bestAgainst !== 'function') process.exit(1);

// color.js parses ONLY the rgb()/rgba() form the browser hands back from
// getComputedStyle — names and hexes never reach it, the page normalises them
// first. So colours are built here the way the app has them by then.
function c(hex, alpha) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((d) => d + d).join('');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return new Color(alpha === undefined ? rgb : rgb.concat(alpha));
}
const WHITE = c('ffffff');
const BLACK = c('000000');
const best = (other, asBackground) => App.bestAgainst(other, asBackground);

// ---- the obvious ends -------------------------------------------------------
check('best text on white is black', best(WHITE, false).value === 'black', best(WHITE, false));
check('best text on black is white', best(BLACK, false).value === 'white', best(BLACK, false));
check('best background under white text is black', best(WHITE, true).value === 'black', best(WHITE, true));
check('best background under black text is white', best(BLACK, true).value === 'white', best(BLACK, true));

// ---- the endpoint claim itself ----------------------------------------------
// If the ceiling were NOT an endpoint, some mid tone would beat the winner.
// Sweep the greys and every primary ramp: nothing may beat what best() picked.
{
  let beaten = null;
  const others = ['ffffff', '000000', '777777', '808080', '663399', '00aaff', 'ffcc00', '1a7fd4'];
  for (const o of others) {
    const other = c(o);
    const pick = best(other, false);
    const winner = pick.value === 'black' ? Color.BLACK : Color.WHITE;
    const ceiling = other.contrast(winner).min;
    for (let v = 0; v <= 255; v += 5) {
      for (const cand of [new Color([v, v, v]), new Color([v, 0, 0]), new Color([0, v, 0]), new Color([0, 0, v])]) {
        const got = other.contrast(cand).min;
        if (got > ceiling + 1e-9) beaten = { other: o, v, got, ceiling };
      }
    }
  }
  check('no colour beats the endpoint the button picks', beaten === null, beaten);
}

// ---- the measured crossover -------------------------------------------------
// #777 is the case a guess gets wrong: it LOOKS like a mid grey, so "pick the
// opposite end" reasoning says white, and black actually wins.
{
  const grey = c('777777');
  const onBlack = grey.contrast(Color.BLACK).min;
  const onWhite = grey.contrast(Color.WHITE).min;
  check('#777 really is the close call', Math.abs(onBlack - onWhite) < 0.25, { onBlack, onWhite });
  check('…and black wins it', onBlack > onWhite && best(grey, false).value === 'black', { onBlack, onWhite });
  check('…which is above AA, so the button is worth pressing', onBlack >= 4.5, onBlack);
}

// ---- the asymmetry ----------------------------------------------------------
// Text composites ON the background, so the two directions are different sums.
// A see-through text colour over black vs over white is not the same question.
{
  const mist = c('000000', 0.7);              // 70% black TEXT
  const asBg = best(mist, true);              // choose a background under it
  check('a background is chosen under see-through text', !!asBg && (asBg.value === 'white' || asBg.value === 'black'), asBg);
  const white = Color.WHITE.contrast(mist).min;
  const black = Color.BLACK.contrast(mist).min;
  check('…and it is the one that measures higher', asBg.value === (white >= black ? 'white' : 'black'), { white, black, pick: asBg.value });
}

// ---- see-through OTHER: judge the worst case, never the average -------------
// A semi-transparent BACKGROUND makes the contrast a range. A pick made on the
// midpoint can be the wrong colour once something dark slides underneath.
{
  const sheer = c('000000', 0.55);            // see-through BACKGROUND
  const pick = best(sheer, false);
  const black = sheer.contrast(Color.BLACK);
  const white = sheer.contrast(Color.WHITE);
  check('a see-through background really does give a range', black.error > 0 || white.error > 0, { black, white });
  const byWorst = white.min >= black.min ? 'white' : 'black';
  check('the pick maximises the WORST case', pick.value === byWorst, { pick, blackMin: black.min, whiteMin: white.min });
  check('…and reports that worst case, not the midpoint', Math.abs(pick.worst - Math.max(black.min, white.min)) < 1e-9, pick);
}

// ---- it never returns something the app cannot type back --------------------
{
  const values = new Set();
  const cases = [c('ffffff'), c('000000'), c('777777'), c('123456'), c('000000', 0.3), c('f0b840')];
  for (const other of cases) {
    values.add(best(other, false).value);
    values.add(best(other, true).value);
  }
  check('every pick is a plain colour name the field accepts',
    [...values].every((v) => v === 'black' || v === 'white'), [...values]);
}

// ---- the hex readout --------------------------------------------------------
// It is on screen whatever was typed, so it has to be right for every form —
// including the one color.js gets wrong. toHex() multiplies alpha by 255 and
// never rounds, so 70% formats as "b2.8": a hex with a decimal point in it.
{
  check('hexOf is exported', typeof App.hexOf === 'function');
  check('an opaque colour is 6 digits, no alpha tail', App.hexOf(c('ffffff')) === '#ffffff', App.hexOf(c('ffffff')));
  check('black is #000000', App.hexOf(c('000000')) === '#000000', App.hexOf(c('000000')));
  check('a short hex is expanded', App.hexOf(c('777')) === '#777777', App.hexOf(c('777')));
  check('an odd value keeps its digits', App.hexOf(c('123456')) === '#123456', App.hexOf(c('123456')));
  const sheer = App.hexOf(c('000000', 0.7));
  check('a see-through colour gets an 8-digit hex', sheer === '#000000b3', sheer);
  check('…with no decimal point in it', !/\./.test(sheer), sheer);
  check('vendor toHex is the thing being worked around', /\./.test(c('000000', 0.7).toHex(true)), c('000000', 0.7).toHex(true));
  check('fully transparent is #00000000', App.hexOf(c('000000', 0)) === '#00000000', App.hexOf(c('000000', 0)));
  check('a composited colour rounds instead of emitting garbage',
    /^#[0-9a-f]{6}$/.test(App.hexOf(c('000000', 0.7).overlayOn(Color.WHITE))), App.hexOf(c('000000', 0.7).overlayOn(Color.WHITE)));
  check('nothing in, nothing out', App.hexOf(null) === '');
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

// ---- the buttons, pressed --------------------------------------------------
// The app is booted on a small DOM built from its own index.html. The browser
// is its colour parser (it reads getComputedStyle(swatch).backgroundColor), so
// the stand-in below answers the way a browser does for the forms used here.
function cssColor(v) {
  v = String(v || '').trim().toLowerCase();
  const named = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
  let rgba = named[v] || null, m;
  if (!rgba && (m = /^#([0-9a-f]{3,8})$/.exec(v)) && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1]; if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
    rgba = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  if (!rgba && (m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v))) {
    const H = +m[1] / 360, S = +m[2] / 100, L = +m[3] / 100;
    const f = (n) => { const k = (n + H * 12) % 12, a = S * Math.min(L, 1 - L); return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    rgba = [f(0), f(8), f(4), m[4] === undefined ? 1 : +m[4]];
  }
  if (!rgba) return null;
  return rgba[3] === 1 ? 'rgb(' + rgba.slice(0, 3).join(', ') + ')' : 'rgba(' + rgba.slice(0, 3).join(', ') + ', ' + rgba[3] + ')';
}
function bootApp(saved) {
  const doc = miniDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  const computed = new WeakMap();
  const puts = [];
  const sb = {
    console, Math, Object, Array, JSON, String, Number, Boolean, parseInt, parseFloat, isNaN, Infinity, Error, TypeError, RegExp, Promise,
    document: doc, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, addEventListener() {},
    getComputedStyle: (el) => ({ get backgroundColor() { return computed.get(el) || 'rgba(0, 0, 0, 0)'; } }),
    gifos: { db: () => ({ getAll: () => Promise.resolve(saved ? [saved] : []), put: (r) => { puts.push(r); return Promise.resolve(); } }) },
  };
  sb.globalThis = sb; sb.window = sb; sb.self = sb;
  // A swatch's style.background is parsed the way a browser parses it; a value
  // it cannot parse leaves the previous colour in place.
  for (const id of ['backgroundSwatch', 'foregroundSwatch']) {
    const el = doc.getElementById(id);
    el.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; if (k === 'background') { const c = cssColor(v); if (c) computed.set(el, c); } return true; } });
  }
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'color.js'), 'utf8'), sb, { filename: 'color.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sb, { filename: 'app.js' });
  const $ = (id) => doc.getElementById(id);
  return { $, puts, ratio: () => parseFloat($('ratio').textContent), type: (id, v) => $(id).input(v) };
}
{
  const page = parseHtml(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  check('the page carries both Best buttons and both hex readouts', ['backgroundBest', 'foregroundBest'].every((id) => byId(page, id) && byId(page, id).tag === 'button') &&
    ['backgroundHex', 'foregroundHex'].every((id) => byId(page, id) && byId(page, id).tag === 'output'));
  const A = bootApp();
  check('on boot the hex readouts show the default pair (white, and 70% black)', A.$('backgroundHex').textContent === '#ffffff' && A.$('foregroundHex').textContent === '#000000b3', [A.$('backgroundHex').textContent, A.$('foregroundHex').textContent]);
  A.$('foregroundBest').click();
  check('Best for the text on white picks black, and the readout and the ratio follow (21:1)', A.$('foreground').value === 'black' && A.$('foregroundHex').textContent === '#000000' && A.ratio() === 21, [A.$('foreground').value, A.ratio()]);
  A.type('foreground', '777');
  check('typing a bare hex is read as that colour', A.$('foreground').value === '#777' && A.$('foregroundHex').textContent === '#777777');
  A.$('backgroundBest').click();
  check('Best for the background against #777 picks BLACK (4.69 beats white\'s 4.48)', A.$('background').value === 'black' && A.$('backgroundHex').textContent === '#000000' && A.ratio() >= 4.68 && A.ratio() < 4.7, [A.$('background').value, A.ratio()]);
  A.$('swap').click();
  check('Swap trades the two colours', A.$('backgroundHex').textContent === '#777777' && A.$('foregroundHex').textContent === '#000000');
  A.type('background', 'not a colour');
  check('an unparseable value leaves the last colour in place', A.$('backgroundHex').textContent === '#777777');
  check('the pair is saved privately as id last', A.puts.length > 0 && A.puts[A.puts.length - 1].id === 'last');
  const B = bootApp({ id: 'last', background: '#123456', foreground: 'white' });
  setImmediate(() => {
    check('the last pair comes back on boot', B.$('backgroundHex').textContent === '#123456' && B.$('foregroundHex').textContent === '#ffffff');
    console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
  });
}
