// LUDO HAS TO SEAT GUESTS AND FINISH A RACE.
//
// v1 claimed Invite was the lobby, but a guest never published a seat, so
// the second and third people both sat Green. Empty colours were not skipped.
// This suite PLAYS a full lap with forced dice, captures, three-six skip,
// and pins seatPeople so two live ids never share a colour. It then boots the
// app on a small DOM built from its own index.html: a solo game and its save,
// Continue, Back, and three people on one room (presence, seating, a guest's
// roll through the host). No check reads a label, the help or the listing.
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
  const sandbox = { console, Math, Object, Array, JSON, Date, String, Number, Boolean, window: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'rules.js'), 'utf8'), sandbox, { filename: 'rules.js' });
  return sandbox.LUDO;
}

const L = load();
check('rules.js attaches LUDO', !!(L && L.fresh && L.roll && L.apply && L.seatPeople));
check('the loop is 52 squares', L.LOOP.length === 52, L.LOOP.length);

// ---- play a token all the way home ------------------------------------------
{
  let s = L.fresh(2);
  check('two-player: green and blue sit out', s.playing[0] && s.playing[2] && !s.playing[1] && !s.playing[3]);
  s = L.roll(s, 1);
  check('a 1 does not leave the yard', L.moves(s).length === 0, L.moves(s));
  check('…and the turn passes', s.turn === 2 && !s.rolled, { turn: s.turn, rolled: s.rolled });

  s = L.fresh(2);
  s = L.roll(s, 6);
  check('a 6 frees every yard token', L.moves(s).length === 4, L.moves(s).length);
  s = L.apply(s, 0);
  check('leaving the yard lands on start (step 0)', s.tokens[0][0] === 0, s.tokens[0][0]);
  var yard = L.cellOf(0, -1, 0);
  check('a yard cell is {r,c} so paint can find the square',
    yard && typeof yard.r === 'number' && typeof yard.c === 'number', yard);
  check('a 6 is another roll', s.turn === 0 && !s.rolled, { turn: s.turn, rolled: s.rolled });

  // Walk without three sixes in a row: 6, 6, 5 (turn passes), opponent
  // has no move, red again. Then jump the remaining stretch with exact counts.
  s = L.roll(s, 6); s = L.apply(s, 0);
  check('second six advances to 6', s.tokens[0][0] === 6 && s.turn === 0, s.tokens[0][0]);
  s = L.roll(s, 5); s = L.apply(s, 0);
  check('a 5 lands on 11 and passes the turn', s.tokens[0][0] === 11 && s.turn === 2, { step: s.tokens[0][0], turn: s.turn });
  s = L.roll(s, 1);
  check('yellow with nothing out passes back to red', s.turn === 0 && !s.rolled, { turn: s.turn, log: s.log });
  s.tokens[0][0] = 50; s.sixes = 0; s.die = 0; s.rolled = false;
  s = L.roll(s, 6); s = L.apply(s, 0);
  check('an exact 6 from 50 takes it home (56)', s.tokens[0][0] === 56, s.tokens[0][0]);
  check('one token home is not a win', s.winner === -1, s.winner);
}

{
  // Overshooting home is refused.
  let s = L.fresh(2);
  s.tokens[0][0] = 55;
  s.turn = 0; s.die = 2; s.rolled = true;
  check('a 2 from 55 is not a legal home', L.moves(s).every((m) => m.t !== 0), L.moves(s));
  s.die = 1;
  check('a 1 from 55 is exact home', L.moves(s).some((m) => m.t === 0 && m.dest === 56), L.moves(s));
}

{
  // Capture: red on 14 lands on green who left start (green start is 0 = loop 13).
  let s = L.fresh(4);
  s.tokens[0][0] = 8;
  s.tokens[1][0] = 1; // green at loop 14
  s.turn = 0; s.die = 6; s.rolled = true;
  const mv = L.moves(s).filter((m) => m.t === 0)[0];
  check('landing on green off their start is a capture', !!(mv && mv.capture && mv.capture.p === 1), mv);
  s = L.apply(s, 0, 6);
  check('the captured token returns to the yard', s.tokens[1][0] === -1, s.tokens[1][0]);
  check('red stays on 14', s.tokens[0][0] === 14, s.tokens[0][0]);
}

{
  // Start square is safe.
  let s = L.fresh(4);
  s.tokens[0][0] = 7;
  s.tokens[1][0] = 0; // green on their start
  s.turn = 0; s.die = 6; s.rolled = true;
  const mv = L.moves(s).filter((m) => m.t === 0)[0];
  check('green on start is not captured', !!(mv && !mv.capture), mv);
}

{
  // Three sixes skip the turn.
  let s = L.fresh(2);
  s.sixes = 2; s.turn = 0;
  s = L.roll(s, 6);
  check('the third six skips the turn', s.turn === 2 && !s.rolled, { turn: s.turn, log: s.log });
}

{
  // Cannot land on your own token.
  let s = L.fresh(2);
  s.tokens[0][0] = 3;
  s.tokens[0][1] = 6;
  s.turn = 0; s.die = 3; s.rolled = true;
  check('a token may not land on one of its own',
    L.moves(s).every((m) => m.t !== 0 || m.dest !== 6), L.moves(s));
}

{
  // Four tokens home wins. Drive one colour home with exact counts.
  let s = L.fresh(2);
  s.tokens[0] = [56, 56, 56, 50];
  s.turn = 0; s.die = 6; s.rolled = true;
  s = L.apply(s, 3, 6);
  check('the fourth token home wins the race', s.winner === 0, { winner: s.winner, tokens: s.tokens[0] });
}

// ---- seating: the bug that shipped ------------------------------------------
{
  const a = L.seatPeople([null, null, null, null], ['host']);
  check('the first person sits Red', a[0] === 'host' && !a[1] && !a[2] && !a[3], a);

  const b = L.seatPeople(a, ['host', 'g1']);
  check('the first guest sits Green, not Red', b[0] === 'host' && b[1] === 'g1' && !b[2], b);

  const c = L.seatPeople(b, ['host', 'g2', 'g1']);
  check('a second guest sits Yellow — does NOT steal Green',
    c[0] === 'host' && c[1] === 'g1' && c[2] === 'g2' && !c[3], c);

  const d = L.seatPeople(c, ['g1', 'g2']);
  check('a missing host frees Red; the others keep their colours',
    d[0] === null && d[1] === 'g1' && d[2] === 'g2', d);

  const e = L.seatPeople(d, ['g1', 'g2', 'g3']);
  check('a late joiner takes the free Red seat', e[0] === 'g3' && e[1] === 'g1' && e[2] === 'g2', e);

  const same = L.seatPeople(['a', 'b', null, null], ['b', 'a', 'c']);
  check('seatPeople is deterministic for the same live set',
    same[0] === 'a' && same[1] === 'b' && same[2] === 'c', same);

  const play = L.playingFromSeats(['a', 'b', null, null]);
  check('empty seats are not playing', play[0] && play[1] && !play[2] && !play[3], play);

  let s = L.fresh(4);
  s.playing = play;
  s.turn = 1;
  L.nextTurn(s);
  check('nextTurn skips empty Yellow and Blue back to Red', s.turn === 0, s.turn);
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
const clock = { t: 1700000000000 };
function makeRoom() {
  const rows = new Map(), subs = [];
  const room = {
    rows, puts: 0,
    // A runaway (a put answering every delivery with another put) is cut off
    // at 600 deliveries, so it reads as a red check rather than a hang.
    adapter: () => ({
      put: (r) => { room.puts++; rows.set(r.id, JSON.parse(JSON.stringify(r))); if (room.puts < 600) Promise.resolve().then(() => subs.forEach((f) => f([...rows.values()].map((x) => JSON.parse(JSON.stringify(x)))))); return Promise.resolve(); },
      delete: (id) => { rows.delete(id); return Promise.resolve(); },
      subscribe: (f) => { subs.push(f); Promise.resolve().then(() => f([...rows.values()])); },
    }),
  };
  return room;
}
function bootApp(opts) {
  opts = opts || {};
  const doc = miniDom(read('index.html'));
  const puts = [], beats = [];
  let back = null;
  const sb = {
    console, Math: opts.math || Math, Object, Array, JSON, String, Number, Boolean, Promise, Error,
    Date: { now: () => clock.t }, document: doc,
    setInterval: (f) => { beats.push(f); return beats.length; }, clearInterval() {},
    gifos: {
      db: (name) => name === 'save' ? { get: () => Promise.resolve(opts.saved || null), put: (r) => { puts.push(JSON.parse(JSON.stringify(r))); return Promise.resolve(); } }
        : (opts.room ? opts.room.adapter() : null),
      onBack: (f) => { back = f; }, me: () => Promise.resolve({ id: opts.id || 'solo-x', name: opts.name || 'Player' }),
    },
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['rules.js', 'app.js']) vm.runInContext(read(f), sb, { filename: f });
  const $ = (id) => doc.getElementById(id);
  return { doc, $, sb, puts, beats, back: () => back && back(), app: sb.LudoApp, L: sb.LUDO };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const appRuns = (async () => {
  const page = parseHtml(read('index.html'));
  {
    // A die that always shows 6: the first roll lets a token out.
    const six = Object.create(Math); six.random = () => 0.999;
    const A = bootApp({ math: six });
    await settle();
    A.$('nSeg').querySelector('[data-n="2"]').click();
    A.$('soloBtn').click();
    check('Play on this device opens the board for the chosen number of players', !A.$('play').hidden && A.$('home').hidden &&
      A.app.game.playing.filter(Boolean).length === 2 && A.$('board').querySelectorAll('.tok').length === 8);
    A.$('rollBtn').click();
    const lit = A.$('board').querySelectorAll('.tok.lit');
    check('Roll rolls (a 6) and lights the tokens that may move', A.app.game.die === 6 && lit.length === 4, lit.length);
    lit[0].click();
    check('tapping a lit token moves it out of the yard', A.app.game.tokens[0].some((x) => x === 0));
    const saved = A.puts.filter((r) => r.id === 'save').pop();
    check('the game is saved privately on this device (id save)', !!saved && saved.game.tokens[0].some((x) => x === 0) && saved.n === 2);
    check('Back on the board goes home and is handled', A.back() === true && !A.$('home').hidden && A.$('play').hidden);
    // Two tokens on one square sit apart (the board's own CSS destacks them).
    const g = A.L.fresh(4); g.tokens[0] = [5, 5, -1, -1];
    const B = bootApp({ saved: { id: 'save', game: g, n: 4 } });
    await settle();
    check('a saved game offers Continue', !B.$('contBtn').hidden);
    B.$('contBtn').click();
    check('Continue resumes the saved game', !B.$('play').hidden && B.app.game.tokens[0][0] === 5 && B.app.game.tokens[0][1] === 5);
    const shared = B.$('board').querySelectorAll('.sq').filter((sq) => sq.querySelectorAll('.tok').length === 2);
    const css = parseCss(read('style.css'));
    const place = (k) => ['left', 'right', 'top', 'bottom'].map((pr) => (cssVal(css, '.sq .tok:nth-child(' + k + ')' + (k === 1 ? ':not(:only-child)' : ''), pr)[0] || '')).join('|');
    check('two tokens on one square are drawn as two tokens, and the CSS puts the 1st, 2nd, 3rd and 4th in four different places',
      shared.length === 1 && [1, 2, 3, 4].every((k) => place(k) !== '|||') && new Set([1, 2, 3, 4].map(place)).size === 4, [1, 2, 3, 4].map(place));
  }
  {
    // Three people on one room. Ids order the host: the lowest live id.
    const room = makeRoom();
    clock.t = 1700000000000;
    const H = bootApp({ room, id: 'a-host', name: 'Host Person' });
    const G1 = bootApp({ room, id: 'b-guest', name: 'Guest One' });
    const G2 = bootApp({ room, id: 'c-guest', name: 'Guest Two' });
    await settle();
    H.$('friendBtn').click(); await settle();
    clock.t += 100; G1.$('friendBtn').click(); await settle();
    clock.t += 100; G2.$('friendBtn').click(); await settle();
    check('every guest publishes its own presence row on the room', ['a-host', 'b-guest', 'c-guest'].every((id) => room.rows.has(id) && room.rows.get(id).at > 0));
    const at0 = room.rows.get('c-guest').at;
    clock.t += 3000; G2.beats[0](); await settle();
    check('…and a heartbeat keeps it fresh', room.rows.get('c-guest').at > at0);
    for (const A of [H, G1, G2]) { clock.t += 10; A.beats[0](); } await settle();
    const seats = room.rows.get('game') && room.rows.get('game').seats;
    check('the host seats everyone in a different colour: Red, Green, Yellow in join order', !!seats && seats[0] === 'a-host' && seats[1] === 'b-guest' && seats[2] === 'c-guest' && !seats[3], seats);
    check('each page knows its own seat', H.app.seats[0] === 'a-host' && G1.app.seats[1] === 'b-guest' && G2.app.seats[2] === 'c-guest');
    // The guest whose turn it is rolls; the host applies it to the shared board.
    const board = room.rows.get('game');
    const turn = board.game.turn;
    const actor = [H, G1, G2][turn];
    const others = [H, G1, G2].filter((x) => x !== actor);
    check('only the seat whose turn it is may roll', !actor.$('rollBtn').disabled && others.every((x) => x.$('rollBtn').disabled), turn);
    const seq0 = board.seq;
    actor.$('rollBtn').click(); await settle();
    for (const A of [H, G1, G2]) { clock.t += 10; A.beats[0](); } await settle();
    const after = room.rows.get('game');
    check('a roll goes through the host to the shared board once (the board moved on: rolled, or the turn passed; sequence +1)',
      (after.game.rolled || after.game.turn !== turn) && after.seq === seq0 + 1 && room.puts < 600, { seq: after.seq, rolled: after.game.rolled, turn: after.game.turn, puts: room.puts });
  }
  // TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the
  // OS app bar owns it). The only thing that marks such a control is its name.
  check('no in-app Invite button', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
  check('the page runs only its own two classic scripts (no framework, no module)',
    all(page, (n) => n.tag === 'script').map((n) => (n.attrs.src || '') + (n.attrs.type ? ' ' + n.attrs.type : '')).join(',') === 'rules.js,app.js');
  const listing = JSON.parse(read('listing.json'));
  check('listing tagline fits a card (120)', listing.tagline.length <= 120);
  check('help.md is there and substantive', read('help.md').trim().length >= 400);
})();

appRuns.then(() => {
if (failures) {
  console.log(failures + ' failure(s)');
  process.exit(1);
}
console.log('ok — ludo unit');
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
