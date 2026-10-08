// BLACKJACK HAS TO ACTUALLY PLAY A HAND.
//
// The table shipped Deal / Hit / Stand but Invite seating lost the host on
// the first heartbeat (`joined` was rewritten undefined), guests never
// collected their chips, Double was missing, and a broke pile still dealt.
// This suite PLAYS the shipped rules with a seeded shoe — deal, hit, stand,
// double, split, 3:2, S17, a broke table — then boots the app itself on a
// small DOM built from its own index.html and plays it: the buttons and keys
// alone, a broke pile and Restock, an old save, and a two-seat table (host
// and guest sharing one room) through heartbeats, a guest action, and the
// settle. No check reads a label, the help or the listing's wording.
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

function load(math) {
  const sandbox = {
    console, Math: math || Math, Object, Array, JSON, Date, String, Number, Boolean,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('bj.js'), sandbox, { filename: 'bj.js' });
  return sandbox;
}

const { BJ } = load();
check('bj.js attaches BJ', !!(BJ && BJ.createTable && BJ.hit && BJ.stand && BJ.double));
check('a shoe is 52', BJ.makeDeck().length === 52);

const C = (v, s) => BJ.card(v, s);
const ace = C('a', 'spades');
const ten = C('10', 'hearts');
const six = C('6', 'clubs');
const nine = C('9', 'diamonds');
const five = C('5', 'clubs');
const eight = C('8', 'spades');
const eightH = C('8', 'hearts');
const two = C('2', 'clubs');
const three = C('3', 'diamonds');
const four = C('4', 'spades');
const king = C('k', 'hearts');

check('ace + ten is 21', BJ.total([ace, ten]) === 21);
check('soft aces: A A 6 is 18', BJ.total([ace, ace, six]) === 18);
check('A + 6 is soft 17', BJ.isSoft([ace, six]) && BJ.total([ace, six]) === 17);
check('a natural labels as 21, not soft 21', BJ.totalLabel([ace, ten]) === '21');
check('A + 6 labels as soft 17', BJ.totalLabel([ace, six]) === 'soft 17');
check('natural is blackjack', BJ.isBj([ace, ten]) && !BJ.isBj([ace, five, five]));
check('8-8 is a pair, 10-K is not', BJ.isPair([eight, eightH]) && !BJ.isPair([ten, king]));

{
  const r = BJ.decide([ten, six], [ace, ten]);
  check('player blackjack beats a 16', r.winner === 1 && r.bj === true, r);
  check('a natural pays 3:2 (10 → +15)', BJ.chipDelta(10, r) === 15, BJ.chipDelta(10, r));
  check('even money on a 10 stake is +10', BJ.chipDelta(10, { winner: 1 }) === 10);
  check('a loss is −stake', BJ.chipDelta(10, { winner: 0 }) === -10);
  check('a push is 0', BJ.chipDelta(10, { winner: 2 }) === 0);
}

{
  const bust = BJ.decide([ten, six], [ten, ten, five]);
  check('a bust loses even if the dealer is live', bust.winner === 0 && bust.tag === 'bust', bust);
}

// S17: dealer hits 16, stands on 17 including soft 17.
{
  const d16 = [ten, six];
  BJ.dealerPlay(d16, [five, nine]);
  check('dealer hits a 16', BJ.total(d16) === 21, BJ.total(d16));
  const d17 = [ten, C('7', 'clubs')];
  BJ.dealerPlay(d17, [ace]);
  check('dealer stands on a hard 17', d17.length === 2 && BJ.total(d17) === 17);
  const soft = [ace, six];
  BJ.dealerPlay(soft, [four]);
  check('dealer stands on a soft 17', soft.length === 2 && BJ.total(soft) === 17, BJ.total(soft));
}

check('broke table: 0 chips cannot cover a 10 stake', BJ.canDeal(0, 10) === false);
check('9 chips still cannot deal', BJ.canDeal(9, 10) === false);
check('10 chips can deal', BJ.canDeal(10, 10) === true);
check('a refill is 200 chips', BJ.REFILL === 200 && BJ.START === 200 && BJ.STAKE === 10);

// PLAY a natural from a known shoe. Deal order: P, D, P, D.
{
  const shoe = [ace, nine, ten, six];
  const tab = BJ.createTable({ shoe: shoe, players: [{ id: 'p', name: 'you' }], handId: 1 });
  check('a dealt natural ends the hand', tab.phase === 'done', tab.phase);
  check('player cards are A then 10', tab.hands[0].cards[0].value === 'a' && tab.hands[0].cards[1].value === '10');
  check('the natural nets +15', BJ.netFor(tab, 'p') === 15, BJ.netFor(tab, 'p'));
  check('the public table does not leak the shoe', BJ.publicTable(tab).shoe === undefined);
  check('chips 200 + 15 stay non-negative', BJ.applyDeltas(200, [BJ.netFor(tab, 'p')]) === 215);
}

// PLAY a full hit/stand hand against a seeded shoe.
{
  const sand = load(seededMath(0xB1A7));
  const tab = sand.BJ.createTable({
    rand: sand.Math.random,
    players: [{ id: 'p', name: 'you' }],
    handId: 'seed',
  });
  check('a seeded deal reaches play or a natural', tab.phase === 'play' || tab.phase === 'done', tab.phase);
  let steps = 0;
  while (tab.phase === 'play' && steps < 12) {
    const h = sand.BJ.activeHand(tab, 'p');
    const t = sand.BJ.total(h.cards);
    if (t < 17) sand.BJ.hit(tab, 'p');
    else sand.BJ.stand(tab, 'p');
    steps++;
  }
  check('the seeded hand finishes', tab.phase === 'done', tab.phase);
  const d = sand.BJ.total(tab.dealer);
  const p = sand.BJ.total(tab.hands[0].cards);
  const live = p <= 21;
  check('S17: a live player leaves the dealer at 17+', !live || d >= 17, { d: d, p: p });
  const net = sand.BJ.netFor(tab, 'p');
  check('the payout is a legal chip delta', net === -10 || net === 0 || net === 10 || net === 15, net);
  let chips = 200;
  chips = sand.BJ.applyDeltas(chips, [net]);
  check('bankroll moves and never goes negative', chips >= 0 && chips === 200 + net, chips);
}

// Double: 5+6 vs 10+7, next card 9 → 20 vs 17, bet 20, +20.
{
  const shoe = [five, ten, six, C('7', 'clubs'), nine];
  const tab = BJ.createTable({ shoe: shoe, players: [{ id: 'p', name: 'you' }], handId: 2 });
  check('11 vs 10 is still in play', tab.phase === 'play' && BJ.total(tab.hands[0].cards) === 11);
  check('double is legal at 200 chips', BJ.canDouble(tab, 'p', 200));
  check('double is refused when the pile cannot cover a second stake', BJ.canDouble(tab, 'p', 15) === false);
  const ok = BJ.double(tab, 'p', 200);
  check('double takes one card and stands', ok && tab.hands[0].doubled && tab.hands[0].stood);
  check('double 5+6+9 is 20', BJ.total(tab.hands[0].cards) === 20);
  check('the hand is done after a double', tab.phase === 'done');
  check('a doubled win pays even money on 20', BJ.netFor(tab, 'p') === 20, BJ.netFor(tab, 'p'));
}

// Split 8s: each half gets one card. Split aces stand.
{
  const shoe = [eight, ten, eightH, C('7', 'clubs'), three, two, four, five];
  const tab = BJ.createTable({ shoe: shoe, players: [{ id: 'p', name: 'you' }], handId: 3 });
  check('8-8 can split', BJ.canSplit(tab, 'p', 200));
  const ok = BJ.split(tab, 'p', 200);
  check('split makes two hands', ok && BJ.myHands(tab, 'p').length === 2, BJ.myHands(tab, 'p').length);
  check('no re-split', BJ.canSplit(tab, 'p', 200) === false);
  BJ.stand(tab, 'p');
  BJ.stand(tab, 'p');
  check('both halves settle', tab.phase === 'done', tab.phase);
  const nets = BJ.resultsFor(tab, 'p');
  check('two results after a split', nets.length === 2);
  check('a 21 after a split is not a 3:2 natural', nets.every(function (r) { return !r.bj; }));
}

{
  const shoe = [ace, ten, C('a', 'hearts'), C('7', 'clubs'), C('9', 'spades'), C('k', 'clubs')];
  const tab = BJ.createTable({ shoe: shoe, players: [{ id: 'p', name: 'you' }], handId: 4 });
  BJ.split(tab, 'p', 200);
  check('split aces get one card each and stand', tab.phase === 'done' && BJ.myHands(tab, 'p').every(function (h) {
    return h.cards.length === 2 && h.stood;
  }));
}

// Two seats, host deals, guest hits, dealer plays only after both are done.
{
  const shoe = [
    five, eight, ten,           // p1 5, p2 8, dealer up 10
    six, C('7', 'hearts'), nine, // p1 6, p2 7, dealer hole 9  → 11, 15, 19
    two, four, three
  ];
  const tab = BJ.createTable({
    shoe: shoe,
    players: [{ id: 'host', name: 'H' }, { id: 'guest', name: 'G' }],
    handId: 5,
  });
  check('two seats are dealt', tab.hands.length === 2 && tab.phase === 'play');
  check('dealer hole stays in the private shoe until the end', tab.shoe.length > 0);
  BJ.hit(tab, 'host');
  check('a host hit does not play the dealer yet', tab.phase === 'play');
  BJ.stand(tab, 'guest');
  check('one stand is not enough', tab.phase === 'play');
  BJ.stand(tab, 'host');
  check('dealer plays once every seat is done', tab.phase === 'done');
  check('dealer stood on 19', BJ.total(tab.dealer) === 19, BJ.total(tab.dealer));
  check('guest 15 vs 19 loses 10', BJ.netFor(tab, 'guest') === -10);
}

// Invite seating helpers: live seats, host is first joined, stale seats drop.
{
  const now = 1e12;
  const items = [
    { kind: 'seat', id: 'a', at: now, joined: 10, name: 'Ann' },
    { kind: 'seat', id: 'b', at: now, joined: 20, name: 'Bob' },
    { kind: 'seat', id: 'c', at: now - 20000, joined: 1, name: 'Stale' },
    { kind: 'table', id: 'table', phase: 'play' },
  ];
  const live = BJ.liveSeats(items, now, BJ.PRES_TTL);
  check('a seat older than 12s is not at the table', live.length === 2 && live[0].id === 'a', live.map(function (p) { return p.id; }));
  check('the host is the first person who sat', BJ.hostId(live) === 'a');
  check('an empty room falls back to the owner', BJ.hostId([], 'owner') === 'owner');
}

// applyDeltas never pays cash below zero.
check('a broke pile cannot go negative', BJ.applyDeltas(5, [-10]) === 0);

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
function makeRoom() {
  const items = new Map(), subs = [];
  const list = () => [...items.values()].map((r) => JSON.parse(JSON.stringify(r)));
  return {
    items, subs, puts: [],
    deliver() { for (const f of subs) f(list()); },
    adapter() {
      const room = this;
      // A runaway (a put answering every delivery with another put) is cut off
      // at 400 deliveries, so it reads as a red check rather than a hang.
      return { put: (r) => { room.puts.push(JSON.parse(JSON.stringify(r))); items.set(r.id, JSON.parse(JSON.stringify(r))); if (room.puts.length < 400) Promise.resolve().then(() => room.deliver()); return Promise.resolve(); },
        subscribe: (f) => { subs.push(f); Promise.resolve().then(() => f(list())); } };
    },
  };
}
const clock = { t: 1700000000000 };
function bootApp(opts) {
  opts = opts || {};
  const doc = miniDom(read('index.html'));
  const saved = new Map(Object.entries(opts.saved || {}));
  const puts = [];
  const beats = [];
  const sb = {
    console, Math: seededMath(opts.seed || 1), Object, Array, JSON, String, Number, Boolean, Promise, Error,
    Date: { now: () => clock.t }, document: doc,
    setInterval: (f) => { beats.push(f); return beats.length; }, clearInterval() {}, setTimeout: (f) => { f(); return 0; },
    gifos: {
      info: () => Promise.resolve({ owner: opts.owner !== false }),
      me: () => Promise.resolve({ id: opts.id || 'host', name: opts.name || 'Player One' }),
      db: (name) => name === 'save' ? { get: (id) => Promise.resolve(saved.get(id) || null), put: (r) => { puts.push(JSON.parse(JSON.stringify(r))); saved.set(r.id, r); return Promise.resolve(); } }
        : (opts.room ? opts.room.adapter() : null),
    },
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(read('bj.js'), sb, { filename: 'bj.js' });
  vm.runInContext(read('app.js'), sb, { filename: 'app.js' });
  const $ = (id) => doc.getElementById(id);
  const shown = (id) => !$(id).hidden;
  const key = (k) => doc.body.dispatchEvent({ type: 'keydown', key: k, bubbles: true, target: doc.body });
  const myCards = () => $('pHands').querySelectorAll('.card').length;
  const hands = () => $('pHands').querySelectorAll('.hand').length;
  return { doc, $, shown, key, myCards, hands, puts, beats, sb, chips: () => +$('chips').textContent, msg: () => $('msg').textContent, BJ: sb.BJ };
}
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
// The first seed whose opening deal fits `want(table)`, played through the
// app's own BJ with that seed, so the app deals the same hand.
function seedFor(want) {
  for (let seed = 1; seed < 5000; seed++) {
    const { BJ: B } = load(seededMath(seed));
    const tab = B.createTable({ players: [{ id: 'host', name: 'p' }], stake: B.STAKE, handId: 1 });
    if (want(tab, B)) return seed;
  }
  return 0;
}
const appRuns = (async () => {
  const page = parseHtml(read('index.html'));
  check('Hit / Stand / Double / Split / Restock / Deal are real buttons in the action bar',
    ['deal', 'hit', 'stand', 'double', 'split', 'refill'].every((id) => byId(page, id) && byId(page, id).tag === 'button' && within(byId(page, id), all(page, (n) => /\bbar\b/.test(n.attrs.class || ''))[0])));
  {
    // a hand that can double (two cards, not 21, dealer no blackjack)
    const seed = seedFor((t, B) => t.phase === 'play' && B.canDouble(t, 'host', 200) && !B.canSplit(t, 'host', 200) && B.total(t.hands[0].cards) <= 11);
    const A = bootApp({ seed, solo: true });
    await settle();
    check('at rest only Deal shows', A.shown('deal') && !['hit', 'stand', 'double', 'split', 'refill'].some(A.shown));
    A.$('deal').click();
    check('Deal deals: two cards to me, the dealer\'s hole card face down, and Hit / Stand / Double offered',
      A.myCards() === 2 && A.$('dCards').querySelectorAll('.card.back').length === 1 && A.shown('hit') && A.shown('stand') && A.shown('double') && !A.shown('deal'));
    const dealMsg = A.msg();
    A.key('h');
    check('the H key hits: a third card', A.myCards() === 3);
    check('after a hit Double is gone and the prompt no longer offers it (it changed with the buttons)', !A.shown('double') && A.shown('hit') && A.msg() !== dealMsg);
    const before = A.chips();
    A.key('s');
    await settle();
    check('the S key stands: the hand ends, the hole card turns, Deal returns', A.shown('deal') && !A.shown('hit') && A.$('dCards').querySelectorAll('.card.back').length === 0);
    const last = A.puts.filter((r) => r.id === 'last').pop();
    check('the result is paid into the pile and kept in the save', A.chips() !== before || /push/i.test(A.msg()) ? (!!last && last.chips === A.chips()) : false, { before, after: A.chips(), last });
  }
  {
    const seed = seedFor((t, B) => t.phase === 'play' && B.canDouble(t, 'host', 200) && !B.canSplit(t, 'host', 200));
    const A = bootApp({ seed, solo: true });
    await settle();
    A.$('deal').click();
    A.key('d');
    check('the D key doubles: one more card and the hand is over', A.myCards() === 3 && A.shown('deal'));
    const seedP = seedFor((t, B) => t.phase === 'play' && B.canSplit(t, 'host', 200));
    const P = bootApp({ seed: seedP, solo: true });
    await settle();
    P.$('deal').click();
    check('a pair offers Split', P.shown('split'), seedP);
    P.key('p');
    check('…and Split makes two hands', P.hands() === 2);
  }
  {
    const A = bootApp({ solo: true, saved: { last: { id: 'last', chips: 5 } } });
    await settle();
    check('an old save (just a chips number) loads', A.chips() === 5);
    check('a broke pile cannot deal: Deal hides, Restock shows', !A.shown('deal') && A.shown('refill'));
    A.$('refill').click();
    const last = A.puts.filter((r) => r.id === 'last').pop();
    check('Restock adds REFILL chips, saves them, and Deal returns', A.chips() === 5 + A.BJ.REFILL && last && last.chips === 5 + A.BJ.REFILL && A.shown('deal') && !A.shown('refill'));
  }
  {
    // Two seats on one room: the host joined first. The scenario is played as
    // the app plays it; the host's shuffle seed is the first one that leaves
    // the guest a hand to play and a result that moves chips (so a settle that
    // never happens, or happens twice, shows).
    async function twoSeat(hostSeed) {
      const r = {};
      const room = makeRoom();
      clock.t = 1700000000000;
      const H = bootApp({ room, id: 'host', name: 'Host Person', seed: hostSeed });
      await settle();
      clock.t += 1000;
      const G = bootApp({ room, id: 'guest', name: 'Guest Person', owner: false, seed: 99 });
      await settle();
      r.hostJoined = room.items.get('host').joined;
      for (let k = 0; k < 4; k++) { clock.t += 3000; H.beats[0](); G.beats[0](); await settle(); }
      r.hostJoinedAfter = room.items.get('host').joined; r.guestJoined = room.items.get('guest').joined;
      r.dealShown = { guest: G.shown('deal'), host: H.shown('deal') };
      H.$('deal').click();
      await settle();
      r.pub = room.items.get('table');
      const gHand = () => room.items.get('table').hands.find((h) => h.pid === 'guest');
      r.playable = !!r.pub && r.pub.phase === 'play' && !gHand().stood && !gHand().bust;
      if (r.playable) {
        r.n0 = gHand().cards.length;
        G.$('hit').click();
        await settle();
        r.seat = room.items.get('guest');
        r.n1 = gHand().cards.length;
        for (let k = 0; k < 3; k++) { clock.t += 3000; G.beats[0](); H.beats[0](); await settle(); }
        r.n2 = gHand().cards.length;
        if (!gHand().stood && !gHand().bust) { G.$('stand').click(); await settle(); }
      }
      if (room.items.get('table').phase === 'play') { H.$('stand').click(); await settle(); }
      r.done = room.items.get('table');
      r.net = H.BJ.netFor(r.done, 'guest');
      r.want = H.BJ.applyDeltas(200, [r.net]);
      r.chips = G.chips();
      for (let k = 0; k < 3; k++) { clock.t += 3000; H.beats[0](); G.beats[0](); await settle(); }
      r.chipsAfter = G.chips();
      r.runaway = room.puts.length >= 400;
      return r;
    }
    let r = null, hostSeed = 0;
    for (let sd = 1; sd < 60 && !r; sd++) { const t = await twoSeat(sd); if (t.playable && t.net !== 0 && t.done.phase === 'done') { r = t; hostSeed = sd; } }
    check('(fixture) a seeded deal leaves the guest a hand to play and a result that moves chips', !!r, hostSeed);
    r = r || await twoSeat(7);
    check('heartbeats keep each seat\'s joined time (the host does not flip)', r.hostJoinedAfter === r.hostJoined && r.guestJoined > r.hostJoined);
    check('the guest is not offered Deal; the host is', !r.dealShown.guest && r.dealShown.host);
    check('the host writes a public table with no shoe in it', !!r.pub && r.pub.phase && Array.isArray(r.pub.hands) && r.pub.hands.length === 2 && !('shoe' in r.pub), r.pub && Object.keys(r.pub));
    check('a guest action goes out on its seat with a sequence number', !!r.seat && r.seat.action === 'hit' && r.seat.seq === 1);
    check('the host applies it exactly once, though the seat is re-delivered on every heartbeat', !r.runaway && r.n1 === r.n0 + 1 && r.n2 === r.n1, [r.n0, r.n1, r.n2, r.runaway]);
    check('the hand finishes on the shared table', r.done.phase === 'done');
    check('the guest settles its own pile from the public table', r.chips === r.want && r.chips !== 200, { chips: r.chips, net: r.net });
    check('…once: re-delivered tables do not pay it again', r.chipsAfter === r.chips);
  }
  const css = parseCss(read('style.css'));
  const px = (v) => parseFloat(v) || 0;
  check('phone tap targets are 48px+ and tap without a zoom delay',
    cssVal(css, '.bar button', 'min-height').every((v) => px(v) >= 48) && cssVal(css, '.bar button', 'min-height').length >= 1 &&
    cssVal(css, '.bar button', 'touch-action').includes('manipulation'));
  check('hidden action buttons stay hidden (display:none !important beats the button layout)',
    cssVal(css, '.bar button[hidden]', 'display').some((v) => /^none\s*!important$/.test(v)));
  // TEXT-CHECK: the GifOS rule is that an app never draws its own Invite (the
  // OS app bar owns it). The only thing that marks such a control is its name.
  check('no in-app Invite button (OS chrome)', !all(page, (n) => n.tag === 'button').some((b) => /\binvite\b/i.test(textOf(b) + ' ' + (b.attrs['aria-label'] || '') + ' ' + (b.attrs.id || ''))));
  const listing = JSON.parse(read('listing.json'));
  const manifest = JSON.parse(read('manifest.json'));
  check('listing tagline fits a card', listing.tagline.length <= 80);
  check('author is hanhaechi, not GifOS', listing.author.name === 'hanhaechi' && listing.porter.name === 'GifOS');
  check('minBuild stays 947', manifest.minBuild === 947);
  check('save is private, room is read-write',
    manifest.data.save.visibility === 'private' && manifest.data.room.visibility === 'read-write');
  const rawCss = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no CDN / webfont / remote at load (no remote src/href, no @import, no remote url())',
    all(page, (n) => ['src', 'href', 'action', 'poster'].some((a) => /^(https?:)?\/\//i.test(n.attrs[a] || ''))).length === 0 &&
    !/@import\b/i.test(rawCss) && !(rawCss.match(/url\(([^)]*)\)/g) || []).some((u) => /^url\(\s*["']?(https?:)?\/\//i.test(u)));
  check('classic scripts only', all(page, (n) => n.tag === 'script').every((n) => !/module/i.test(n.attrs.type || '')));
})();

appRuns.then(() => {
if (failures) {
  console.log('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nblackjack unit: all PASS');
}, (e) => { console.log('FAIL — harness threw ' + (e && e.stack || e)); process.exit(1); });
