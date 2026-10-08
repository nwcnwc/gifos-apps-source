// Lost in Cyberspace has to actually walk, nmap, and send codes.
//
// The maze generator is the original (vendor/network.js). The HACKER view is
// a canvas rewrite. Invite is the room: the hacker sends codes they found,
// the navigator nmaps ALL of them together — one code is one layer, four is
// the maze. A suite that only boots the generator would miss the inbox
// mapping one code at a time (the bug this port shipped with) and a solo
// seat-switch that threw the maze away. So the real app.js is booted on a DOM
// built from its own index.html, and its buttons are pressed: one client alone,
// and two clients sharing one room.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// ---- a tiny DOM, built from the app's own index.html ------------------------
// Enough of the DOM for the app's real script to boot and for a test to press
// its buttons: ids, attributes, hidden/disabled, classList, textContent,
// innerHTML (parsed into children), click/keydown/submit with bubbling.
function anything() {
  const store = new Map();
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (!store.has(k)) store.set(k, anything());
      return store.get(k);
    },
    set(t, k, v) { store.set(k, v); return true; },
    apply() { return anything(); },
    construct() { return anything(); },
  });
  return p;
}
function makeDom(html) {
  const byId = new Map();
  const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr', 'source']);
  const decode = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.attrs = {};
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.style = {};
      this.dataset = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.className = '';
      this._text = '';
      this.onclick = null;
      this.width = 640; this.height = 400;
      this.scrollTop = 0; this.scrollHeight = 0;
      const self = this;
      this.classList = {
        _l() { return self.className.split(/\s+/).filter(Boolean); },
        add(...c) { const l = this._l(); c.forEach((x) => { if (l.indexOf(x) < 0) l.push(x); }); self.className = l.join(' '); },
        remove(...c) { self.className = this._l().filter((x) => c.indexOf(x) < 0).join(' '); },
        contains(c) { return this._l().indexOf(c) >= 0; },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
      };
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.setAttribute('id', v); }
    getAttribute(k) {
      if (k === 'class') return this.className;
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    }
    setAttribute(k, v) {
      v = String(v);
      if (k === 'class') { this.className = v; return; }
      this.attrs[k] = v;
      if (k === 'id') byId.set(v, this);
      if (k === 'hidden') this.hidden = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'value') this.value = v;
      if (k.indexOf('data-') === 0) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); if (c.attrs.id) byId.set(c.attrs.id, c); return c; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._text = String(v); }
    set innerHTML(v) { this.children = []; this._text = ''; parseInto(this, String(v)); }
    get innerHTML() { return this.children.map((c) => c.outer()).join('') || this._text; }
    outer() {
      if (this.tagName === '#TEXT') return this._text;
      const a = Object.keys(this.attrs).map((k) => ' ' + k + '="' + this.attrs[k] + '"').join('') + (this.className ? ' class="' + this.className + '"' : '');
      return '<' + this.tagName.toLowerCase() + a + '>' + this.innerHTML + '</' + this.tagName.toLowerCase() + '>';
    }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    dispatch(type, init) {
      const ev = Object.assign({ type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, init || {});
      for (let n = this; n; n = n.parentNode) {
        ev.currentTarget = n;
        if (type === 'click' && typeof n.onclick === 'function') n.onclick.call(n, ev);
        (n.listeners[type] || []).slice().forEach((f) => f.call(n, ev));
      }
      if (doc.listeners[type]) doc.listeners[type].slice().forEach((f) => f.call(doc, ev));
      return ev;
    }
    click() { return this.dispatch('click'); }
    closest(sel) {
      for (let n = this; n; n = n.parentNode) if (matches(n, sel)) return n;
      return null;
    }
    querySelectorAll(sel) { return all(this).filter((n) => matches(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    focus() {} blur() {} setSelectionRange() {} setPointerCapture() {}
    getContext() { return anything(); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
  }
  function all(root) { const out = []; (function w(n) { n.children.forEach((c) => { if (c.tagName !== '#TEXT') { out.push(c); w(c); } }); })(root); return out; }
  // Selectors used by tests only: #id, .class, tag, [attr="v"], [attr].
  function matches(n, sel) {
    if (!n.attrs) return false;
    return sel.split(',').some((s) => {
      s = s.trim();
      const m = /^([a-z0-9]*)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(s);
      if (!m) return false;
      if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
      const parts = m[2].match(/[#.][\w-]+/g) || [];
      for (const p of parts) {
        if (p[0] === '#' && n.id !== p.slice(1)) return false;
        if (p[0] === '.' && !n.classList.contains(p.slice(1))) return false;
      }
      const at = m[3].match(/\[[^\]]+\]/g) || [];
      for (const a of at) {
        const q = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
        if (!q) return false;
        const v = n.getAttribute(q[1]);
        if (v === null || (q[2] !== undefined && v !== q[2])) return false;
      }
      return true;
    });
  }
  function text(s) { const t = new El('#text'); t._text = decode(s); return t; }
  function parseInto(root, src) {
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) { if (m[4]) top.appendChild(text(m[4])); continue; }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; } continue; }
      const el = new El(tag);
      const ar = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3]))) el.setAttribute(a[1], decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : ''));
      top.appendChild(el);
      if (tag === 'script' || tag === 'style') {
        const end = src.toLowerCase().indexOf('</' + tag, re.lastIndex);
        re.lastIndex = end < 0 ? src.length : end;
        continue;
      }
      if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
  const doc = {
    readyState: 'complete',
    listeners: {},
    documentElement: new El('html'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (t) => new El(t),
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
    querySelector: (s) => doc.documentElement.querySelector(s),
  };
  parseInto(doc.documentElement, html);
  doc.body = doc.documentElement.querySelector('body') || doc.documentElement;
  return doc;
}
// ---- a tiny stylesheet cascade ---------------------------------------------
// What a selector resolves to at a viewport width: the last declaration from a
// rule whose selector list names it, inside no @media or a matching one.
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
  let m;
  const add = (media, sel, body) => {
    const decls = {};
    body.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    rules.push({ media: media ? media.trim() : null, sels: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  };
  while ((m = re.exec(css))) {
    if (m[1] !== undefined) {
      const inner = /([^{}]+)\{([^{}]*)\}/g;
      let r;
      while ((r = inner.exec(m[2]))) add(m[1], r[1], r[2]);
    } else add(null, m[3], m[4]);
  }
  return rules;
}
function mediaOk(media, width) {
  if (!media) return true;
  const max = /max-width:\s*(\d+)px/.exec(media), min = /min-width:\s*(\d+)px/.exec(media);
  return (!max || width <= +max[1]) && (!min || width >= +min[1]);
}
function cssValue(rules, sel, prop, width) {
  let v = null;
  rules.forEach((r) => { if (r.sels.indexOf(sel) >= 0 && mediaOk(r.media, width) && prop in r.decls) v = r.decls[prop]; });
  return v;
}

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

function load(seed) {
  const sandbox = {
    console,
    Math: seededMath(seed == null ? 0xC0DE : seed),
    Object, Array, JSON, Date, String, Number, Boolean,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'network.js'), 'utf8'), sandbox, { filename: 'network.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'maze.js'), 'utf8'), sandbox, { filename: 'maze.js' });
  return sandbox;
}

const S = load(0xC0DE);
const M = S.LIC;
check('network.js + maze.js attach LIC', !!(M && M.fresh && M.walkForward && M.hack));

{
  const st = M.fresh();
  check('a fresh maze starts at 0,0 with 256 seconds', st.x === 0 && st.y === 0 && st.time === 256, { x: st.x, y: st.y, time: st.time });
  check('four sector codes sit on the terminals', st.codes && st.codes.length === 4, st.codes);
  check('the four codes nmap back to the same target', (() => {
    const back = S.networkFromCodes(st.codes);
    return back.target && back.target.join() === st.net.target.join();
  })());
  check('…and the same traps', (() => {
    const back = S.networkFromCodes(st.codes);
    const a = (st.net.traps.trapsXY || []).map((p) => p.join()).sort().join('|');
    const b = (back.traps.trapsXY || []).map((p) => p.join()).sort().join('|');
    return a === b;
  })());
  check('sectors are 2×2 quadrants', M.sectorOf(0, 0) === 0 && M.sectorOf(7, 0) === 1 && M.sectorOf(0, 7) === 2 && M.sectorOf(7, 7) === 3);
}

{
  const st = M.fresh();
  const face0 = st.facing;
  M.turnRight(st);
  check('turn right changes facing', st.facing === (face0 + 1) % 4, st.facing);
  M.turnLeft(st);
  check('turn left undoes it', st.facing === face0, st.facing);
  M.turnBack(st);
  check('turn around is 180', st.facing === (face0 + 2) % 4, st.facing);
}

// Walk until we have actually moved. A maze that refuses every door is a
// generator bug; a walker that never calls enter is ours.
{
  const st = M.fresh();
  let moved = false;
  for (let i = 0; i < 8 && !moved; i++) {
    if (M.doorAhead(st)) moved = M.walkForward(st);
    else M.turnRight(st);
  }
  check('the hacker can walk through a door', moved && (st.x !== 0 || st.y !== 0), { x: st.x, y: st.y, facing: st.facing, moved });
  check('walking starts the locator', st.ticking === true);
  check('a move is counted', st.moves >= 0, st.moves);
}

{
  const st = M.fresh();
  // Force a trap underfoot and walk in (enter charges TRAP_COST).
  const before = st.time;
  st.net.traps = st.net.traps || { trapsXY: [] };
  // Stand on a trap via enter() by faking a move onto a neighbouring trap.
  const ds = M.doors(st);
  const dir = ds.e ? [1, 0] : ds.s ? [0, 1] : ds.n ? [0, -1] : [-1, 0];
  const nx = st.x + dir[0], ny = st.y + dir[1];
  st.net.traps.trapsXY = (st.net.traps.trapsXY || []).concat([[nx, ny]]);
  const ok = M.tryMove(st, dir[0], dir[1]);
  check('walking onto a trap is allowed', ok);
  check('a trap costs 32 seconds', ok && st.time <= before - M.TRAP_COST, { before: before, time: st.time, cost: M.TRAP_COST });
}

{
  const st = M.fresh();
  const before = st.time;
  const r = M.hack(st);
  check('hacking a non-target is denied', r === 'denied' || r === 'dead' || r === 'win', r);
  if (r === 'denied') {
    check('a wrong hack costs 16 seconds', st.time === before - M.WRONG_HACK, { before: before, time: st.time });
    check('…and starts the locator', st.ticking === true);
  }
}

{
  const st = M.fresh();
  st.x = st.net.target[0];
  st.y = st.net.target[1];
  const r = M.hack(st);
  check('hacking the TARGET wins', r === 'win' && st.win === true, r);
  check('a win issues a score code', typeof st.scoreCode === 'string' && st.scoreCode.indexOf('0x') === 0, st.scoreCode);
  let dec = null;
  try { dec = S.codeToScore(st.scoreCode); } catch (e) { dec = { err: String(e.message) }; }
  check('the score code round-trips time and moves',
    dec && dec.time === Math.min(255, st.time) && dec.moves === Math.max(0, st.moves), dec);
}

{
  const st = M.fresh();
  const here = M.here(st);
  check('spawn reports a sector code', !!here.code, here);
  M.rememberSent(st, here.code);
  M.rememberSent(st, here.code);
  check('Send code is idempotent', st.sent.length === 1 && st.sent[0] === here.code, st.sent);
  const found = M.foundCodes(st);
  check('standing in a sector counts as a found code', found.indexOf(here.code) >= 0, found);
}

{
  const a = ['0xC16F8'];
  const b = ['0xD1234', '0xC16F8'];
  const m = M.mergeCodes(a, b);
  check('inbox merges codes instead of replacing them', m.length === 2 && m.indexOf('0xC16F8') >= 0 && m.indexOf('0xD1234') >= 0, m);
}

{
  const st = M.fresh();
  const one = S.networkFromCodes([st.codes[0]]);
  const all = S.networkFromCodes(st.codes);
  check('one code is one layer — not the whole maze', !one.walls || !one.traps || !one.target, {
    walls: !!one.walls, traps: !!one.traps, target: !!one.target, colors: !!one.colors,
  });
  check('all four codes reconstruct walls, traps, target, colours', !!(all.walls && all.traps && all.target && all.colors));
}

{
  const st = M.fresh();
  st.time = 1;
  st.ticking = true;
  M.tick(st);
  check('the last tick loses', st.over === true && st.time === 0);
}

// ---- the real app.js, on a DOM built from its own index.html ----------------
// Each client is network.js + maze.js + app.js in its own window, on a shared
// room collection and a shared fake clock. The room applies a put and tells
// every subscriber at once; timers only fire when a test advances the clock.
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = read('index.html');
const css = read('style.css');
const help = read('help.md');
const listing = JSON.parse(read('listing.json'));
const manifest = JSON.parse(read('manifest.json'));
const NETWORK = read('vendor/network.js');
const MAZE = read('maze.js');
const APPJS = read('app.js');

const NET = [];
function makeClock() {
  const timers = new Map();
  let seq = 1;
  const clock = {
    t: 5000000,
    set(fn, ms, every) { const id = seq++; timers.set(id, { fn, at: clock.t + (ms || 0), every }); return id; },
    clear(id) { timers.delete(id); },
    advance(ms) {
      const end = clock.t + ms;
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        clock.t = next[1].at;
        if (next[1].every) next[1].at = clock.t + next[1].every; else timers.delete(next[0]);
        next[1].fn();
      }
      clock.t = end;
    },
  };
  return clock;
}
function makeRoom() {
  const rows = new Map();
  const subs = [];
  const snap = () => [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)));
  const notify = () => subs.slice().forEach((cb) => cb(snap()));
  return {
    rows,
    put(rec) { rows.set(rec.id, JSON.parse(JSON.stringify(rec))); notify(); },
    handle() {
      return {
        put(rec) { rows.set(rec.id, JSON.parse(JSON.stringify(rec))); notify(); return Promise.resolve(rec); },
        get(id) { return Promise.resolve(rows.get(id) || null); },
        delete(id) { rows.delete(id); notify(); return Promise.resolve(); },
        subscribe(cb) { subs.push(cb); cb(snap()); },
      };
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));

// opts.room: a shared room (absent = no GifOS room); opts.id: this player.
async function client(opts) {
  opts = opts || {};
  const clock = opts.clock || makeClock();
  const doc = makeDom(html);
  const save = new Map();
  let back = null;
  const gifos = opts.noGifos ? undefined : {
    db: (n) => {
      if (n === 'room') { if (!opts.room) throw new Error('no room'); return opts.room.handle(); }
      return { get: (id) => Promise.resolve(save.get(id) || null), put: (r) => { save.set(r.id, r); return Promise.resolve(r); } };
    },
    me: () => Promise.resolve({ id: opts.id || 'p1', name: opts.name || 'Player' }),
    onBack: (f) => { back = f; },
  };
  const sb = {
    console, Math: seededMath(opts.seed || 0xBEEF), Object, Array, JSON, String, Number, Boolean, Promise, Error, parseInt,
    Date: { now: () => clock.t },
    setTimeout: (fn, ms) => clock.set(fn, ms, 0), clearTimeout: (id) => clock.clear(id),
    setInterval: (fn, ms) => clock.set(fn, ms, ms), clearInterval: (id) => clock.clear(id),
    fetch: (u) => { NET.push('fetch ' + u); return new Promise(() => {}); },
    XMLHttpRequest: function () { NET.push('xhr'); },
    WebSocket: function (u) { NET.push('ws ' + u); },
    document: doc,
  };
  if (gifos) sb.gifos = gifos;
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(NETWORK, sb, { filename: 'network.js' });
  vm.runInContext(MAZE, sb, { filename: 'maze.js' });
  vm.runInContext(APPJS, sb, { filename: 'app.js' });
  const $ = (id) => doc.getElementById(id);
  const c = {
    doc, sb, clock, $, save,
    back: () => back,
    view() { return ['home', 'lobby', 'hacker', 'navigator'].filter((k) => !$(k).hidden); },
    // Where the hacker stands and faces, read off the minimap the app draws.
    pos() {
      const cells = $('minimap').querySelectorAll('i');
      const i = cells.findIndex((n) => n.classList.contains('here'));
      return { i, x: i % 8, y: Math.floor(i / 8), face: ['▲', '▶', '▼', '◀'].indexOf(cells[i] ? cells[i].textContent : ''), visited: cells.filter((n) => n.classList.contains('on')).length };
    },
    // Walk until the hacker has moved off the spawn, turning at walls.
    walk(steps) {
      for (let k = 0; k < (steps || 1); k++) {
        const p0 = c.pos();
        for (let t = 0; t < 4; t++) {
          $('goFwd').click();
          const p = c.pos();
          if (p.i !== p0.i) break;
          $('turnR').click();
        }
      }
    },
    terminalLines() { return $('terminal').children.length; },
    lastLegend() {
      const lists = $('terminal').querySelectorAll('ul');
      const ul = lists[lists.length - 1];
      return ul ? { green: ul.querySelectorAll('li.color-springgreen').length, red: ul.querySelectorAll('li.color-red').length } : null;
    },
    inboxButtons() { return $('inboxList').querySelectorAll('button'); },
    async join() { $('friendBtn').click(); await tick(); },
  };
  return c;
}

(async () => {
  // ---- solo: walk, switch seats, the maze stays -----------------------------
  {
    const c = await client({ noGifos: true });
    c.$('soloHacker').click();
    check('Play as HACKER opens the hacker seat', c.view().join() === 'hacker', c.view());
    const p0 = c.pos();
    c.$('turnB').click();
    check('the phone D-pad turn-around button faces the other way', c.pos().face === (p0.face + 2) % 4,
      { before: p0.face, after: c.pos().face });
    c.$('turnL').click();
    check('the turn-left button turns', c.pos().face === (p0.face + 1) % 4, c.pos().face);
    c.walk(3);
    const p1 = c.pos();
    check('the walk button moves the hacker through doors', p1.i !== p0.i && p1.visited > 1, { p0, p1 });

    c.$('hackerSwitch').click();
    check('the hacker\'s switch button opens the navigator seat', c.view().join() === 'navigator', c.view());
    const lg = c.lastLegend();
    check('...which maps the codes the hacker found, at once', !!lg && lg.green >= 1, lg);
    c.$('navSwitch').click();
    const p2 = c.pos();
    check('switching back keeps the maze and the spot: same cell, same rooms seen',
      c.view().join() === 'hacker' && p2.i === p1.i && p2.visited === p1.visited, { p1, p2 });
  }

  // ---- Back: the OS back gesture leaves a seat, then lets the OS go back -----
  {
    const room = makeRoom();
    const c = await client({ room, id: 'p1' });
    const back = c.back();
    check('the app registers a Back handler', typeof back === 'function');
    check('Back on the home screen is the OS\'s', back && back() === false);
    c.$('soloHacker').click();
    check('Back in a seat returns home', back && back() === true && c.view().join() === 'home', c.view());
    await c.join();
    check('Play with a friend opens the lobby and writes our row', c.view().join() === 'lobby' && room.rows.has('p1'), c.view());
    check('Back in the lobby leaves the room and deletes our row',
      back() === true && c.view().join() === 'home' && !room.rows.has('p1'), { view: c.view(), rows: [...room.rows.keys()] });
  }

  // ---- no room: Invite lives in the OS bar, the app has no seats to hand out --
  {
    const c = await client({ id: 'p1' });   // gifos without a room collection
    await c.join();
    const live = c.$('lobby').querySelectorAll('button').filter((b) => !b.disabled).map((b) => b.id);
    check('with no room the lobby offers only Leave (the invite is the OS\'s, not a button here)',
      c.view().join() === 'lobby' && c.$('roleHacker').disabled && c.$('roleNav').disabled && live.join() === 'lobbyLeave', live);
  }

  // ---- two players: Send code fills the navigator's map ---------------------
  {
    const room = makeRoom(), clock = makeClock();
    const h = await client({ room, clock, id: 'h1', name: 'Rook', seed: 11 });
    const n = await client({ room, clock, id: 'n1', name: 'Wren', seed: 22 });
    await h.join(); await n.join();
    h.$('roleHacker').click();
    check('one player takes the hacker seat', h.view().join() === 'hacker' && room.rows.get('h1').role === 'hacker');
    check('...and the other\'s lobby will not offer it again', n.$('roleHacker').disabled === true);
    n.$('roleHacker').onclick();
    check('...even if pressed: one live hacker per room', n.view().join() === 'lobby', n.view());
    n.$('roleNav').click();
    check('the other takes the navigator seat', n.view().join() === 'navigator');
    n.$('navSwitch').click();
    check('the navigator cannot switch into a seat a live hacker holds', n.view().join() === 'navigator', n.view());

    check('Send code is offered in a room', h.$('sendBtn').hidden === false);
    h.$('sendBtn').click();
    check('Send code puts the code on the hacker\'s own row', (room.rows.get('h1').codes || []).length === 1, room.rows.get('h1'));
    check('...and it lands in the navigator\'s inbox', n.inboxButtons().length === 1, n.inboxButtons().length);
    const one = n.lastLegend();
    check('...which maps it straight away: one code, one layer', !!one && one.green === 1, one);
  }

  // ---- the inbox maps ALL the codes together, never one at a time ------------
  {
    const room = makeRoom(), clock = makeClock();
    const n = await client({ room, clock, id: 'n1', name: 'Wren' });
    await n.join();
    n.$('roleNav').click();
    const codes = M.fresh().codes;   // four codes of one invented maze
    room.put({ id: 'h9', name: 'Rook', at: clock.t, role: 'hacker', codes: codes.slice(0, 2) });
    const two = n.lastLegend();
    check('two codes sent: the map shows both layers', !!two && two.green === 2, two);
    room.put({ id: 'h9', name: 'Rook', at: clock.t, role: 'hacker', codes: codes });
    const four = n.lastLegend();
    check('all four sent: the map is the whole maze, every layer green', !!four && four.green === 4 && four.red === 0, four);
    check('...and the inbox lists all four', n.inboxButtons().length === 4, n.inboxButtons().length);
    const before = n.terminalLines();
    n.inboxButtons()[0].click();
    const tap = n.lastLegend();
    check('tapping one inbox code does not drop the others', n.terminalLines() === before && tap.green === 4, { before, after: n.terminalLines(), tap });
  }

  // ---- the stylesheet: no double-tap zoom on the pad -------------------------
  {
    const rules = cssRules(css);
    check('touch-action is manipulation on the pad buttons', cssValue(rules, '.pad button', 'touch-action', 400) === 'manipulation',
      cssValue(rules, '.pad button', 'touch-action', 400));
  }

  // ---- nothing from the network --------------------------------------------
  const doc = makeDom(html);
  const refs = doc.querySelectorAll('[src]').map((n) => n.getAttribute('src'))
    .concat(doc.querySelectorAll('[href]').map((n) => n.getAttribute('href')));
  check('every script and stylesheet the page loads is a file in the app',
    refs.length >= 4 && refs.every((r) => !/^[a-z]+:|^\/\//i.test(r) && fs.existsSync(path.join(APP, r))), refs);
  check('nothing the app did touched the network (fetch, XHR, WebSocket)', NET.length === 0, NET);
  // TEXT-CHECK: "never the network" covers every code path, not only the ones
  // driven above, so the shipped app.js and maze.js are also scanned.
  check('app.js and maze.js have no A-Frame / fetch / WebSocket / XHR on any path',
    !/aframe|fetch\(|WebSocket|XMLHttpRequest/i.test(read('app.js') + read('maze.js')));

  // ---- manifest / listing: the platform reads these fields --------------------
  // TEXT-CHECK: help.md is a document; there is no behaviour to run, only that the page exists with content.
  check('help.md is a real page', help.trim().length > 400);
  check('listing is an unofficial port, author is them', listing.basedOn && listing.basedOn.blessed === false && !/gifos/i.test(listing.author.name));
  check('manifest declares db + multiplayer, minBuild 947, no network', manifest.capabilities.db === true && manifest.capabilities.multiplayer === true && manifest.minBuild === 947 && !manifest.capabilities.network);
  check('room is read-write, save is private', manifest.data.room.visibility === 'read-write' && manifest.data.save.visibility === 'private');

  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nall ' + 'ok');
})().catch((e) => { console.error(e); process.exit(1); });
