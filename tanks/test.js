// Tanks has to actually drive, shoot, and apply a hit ONCE.
//
// sim.js is the shipped physics (no DOM). net.js is the shipped room. The
// 12s re-apply bug stays pinned here as well as in store-games.js — this
// file may grow; that one must not be edited. The page itself is booted over
// a small DOM built from index.html, so the sticks and FIRE are pressed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = (f) => path.join(__dirname, f);
const read = (f) => fs.readFileSync(APP(f), 'utf8');

let failures = 0;
const MAIN = [];
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function load(files, globals) {
  const sandbox = Object.assign({
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setTimeout, clearTimeout,
  }, globals || {});
  sandbox.globalThis = sandbox;
  if (!('window' in sandbox)) sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: path.basename(f) });
  return sandbox;
}

// ---- a small DOM, built from the app's own index.html -----------------------
// Elements carry ids, classes, data-*, hidden, value/checked, listeners and a
// no-op 2D context; scripts named by <script src> run in one vm context in
// page order. Enough to boot an app and click it; nothing is painted.
function fakeDom(htmlText, opts) {
  opts = opts || {};
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const byId = new Map();
  const noopCtx = () => new Proxy({ measureText: () => ({ width: 0 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) },
    { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const all = (n) => { const out = []; const w = (x) => { for (const k of x.children) { out.push(k); w(k); } }; w(n); return out; };
  const matches = (x, sel) => {
    sel = sel.trim();
    if (sel === '*') return true;
    if (sel[0] === '#') return x.id === sel.slice(1);
    const m = /^([\w-]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel);
    if (!m || (!m[1] && !m[2] && !m[3])) return false;
    return (!m[1] || x.tagName === m[1].toUpperCase()) && (!m[2] || x.classList.contains(m[2])) &&
      (!m[3] || (m[3] in x.attrs && (m[4] === undefined || x.attrs[m[3]] === m[4]) && !(m[3] === 'type' && m[4] !== undefined && x.type !== m[4])));
  };
  const query = (root, sel) => { const parts = sel.split(/\s+/); let set = [root]; for (const p of parts) { const next = []; for (const s of set) for (const d of all(s)) if (matches(d, p) && !next.includes(d)) next.push(d); set = next; } return set; };
  const mk = (tag, attrs, parent) => {
    const dataset = {};
    for (const k in attrs) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = attrs[k];
    let html = '';
    const e = {
      tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs, parent, parentNode: parent, children: [], childNodes: null, listeners: {}, dataset,
      id: attrs.id || '', hidden: 'hidden' in attrs, disabled: 'disabled' in attrs, value: attrs.value || '', checked: 'checked' in attrs, type: attrs.type || '',
      textContent: '', title: attrs.title || '', className: attrs.class || '', style: {}, width: +(attrs.width || 300), height: +(attrs.height || 150),
      captured: [], rect: opts.rect ? Object.assign({}, opts.rect) : { left: 0, top: 0, width: 100, height: 100 },
      classList: { set: new Set((attrs.class || '').split(/\s+/).filter(Boolean)), add(...c) { c.forEach((x) => this.set.add(x)); }, remove(...c) { c.forEach((x) => this.set.delete(x)); }, contains(c) { return this.set.has(c); }, toggle(c, on) { const want = on === undefined ? !this.set.has(c) : !!on; if (want) this.set.add(c); else this.set.delete(c); return want; } },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { this.listeners[ev] = (this.listeners[ev] || []).filter((f) => f !== fn); },
      dispatch(type, init) { const ev = Object.assign({ type, target: this, currentTarget: this, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, pointerId: 1, clientX: 0, clientY: 0, button: 0 }, init || {}); for (const fn of (this.listeners[type] || []).slice()) fn.call(this, ev); const on = this['on' + type]; if (typeof on === 'function') on.call(this, ev); return ev; },
      click() { return this.dispatch('click'); },
      focus() {}, blur() {}, select() {},
      setPointerCapture(id) { this.captured.push(id); }, releasePointerCapture() {}, hasPointerCapture() { return true; },
      getBoundingClientRect() { const r = this.rect; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; },
      getContext: () => e._ctx || (e._ctx = noopCtx()),
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = v; byId.set(v, this); } },
      removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return k in this.attrs; },
      querySelector(sel) { return query(this, sel)[0] || null; },
      querySelectorAll(sel) { return query(this, sel); },
      appendChild(c) { this.children.push(c); c.parent = c.parentNode = this; return c; },
      append(...cs) { cs.forEach((c) => (typeof c === 'object' ? this.appendChild(c) : null)); },
      insertBefore(c) { return this.appendChild(c); },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      remove() { if (this.parent) this.parent.removeChild(this); },
      replaceChildren(...cs) { this.children = []; this.append(...cs); },
      closest(sel) { let n = this; while (n && n.tagName) { if (matches(n, sel)) return n; n = n.parent; } return null; },
      contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parent; } return false; },
      scrollIntoView() {},
      get firstChild() { return this.children[0] || null; },
      get innerHTML() { return html; }, set innerHTML(v) { html = String(v); this.children = []; },
      get offsetWidth() { return this.rect.width; }, get offsetHeight() { return this.rect.height; },
      get clientWidth() { return this.rect.width; }, get clientHeight() { return this.rect.height; },
    };
    if (e.id) byId.set(e.id, e);
    return e;
  };
  const docEl = mk('html', {}, null);
  let cur = docEl;
  let body = null, head = null;
  const scripts = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(htmlText))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) { let n = cur; while (n && n.tagName !== tag.toUpperCase()) n = n.parent; if (n && n.parent) cur = n.parent; continue; }
    if (tag === 'html') continue;
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g)) attrs[a[1].toLowerCase()] = a[3] != null ? a[3] : a[4] != null ? a[4] : (a[2] || '');
    const node = mk(tag, attrs, cur);
    cur.children.push(node);
    if (tag === 'body') body = node;
    if (tag === 'head') head = node;
    if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'title') {
      const end = htmlText.indexOf('</' + tag, re.lastIndex);
      const inner = htmlText.slice(re.lastIndex, end < 0 ? htmlText.length : end);
      if (tag === 'script') scripts.push(attrs.src ? { src: attrs.src } : { inline: inner });
      else node.textContent = inner;
      re.lastIndex = end < 0 ? htmlText.length : end;
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) cur = node;
    else continue;
    // simple text content for leaf-ish elements
    const close = htmlText.indexOf('<', re.lastIndex);
    const txt = htmlText.slice(re.lastIndex, close < 0 ? htmlText.length : close).trim();
    if (txt) node.textContent = txt;
  }
  body = body || mk('body', {}, docEl);
  head = head || mk('head', {}, docEl);
  const docListeners = {}, winListeners = {};
  const rafs = [];
  const store = new Map();
  const document = {
    documentElement: docEl, body, head, hidden: false, visibilityState: 'visible', readyState: 'complete',
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => query(docEl, sel)[0] || null,
    querySelectorAll: (sel) => query(docEl, sel),
    getElementsByTagName: (t) => query(docEl, t),
    createElement: (tag) => mk(tag, {}, null),
    createElementNS: (ns, tag) => mk(tag, {}, null),
    createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: () => mk('fragment', {}, null),
    addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => { docListeners[ev] = (docListeners[ev] || []).filter((f) => f !== fn); },
    dispatch(type, init) { const ev = Object.assign({ type, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, init || {}); for (const fn of (docListeners[type] || []).slice()) fn(ev); return ev; },
  };
  const win = {
    document, console, Math, JSON, Date, Promise, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Map, Set, WeakMap, Symbol, Uint8Array, Uint8ClampedArray, Int16Array, Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, ArrayBuffer, DataView, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, TextEncoder, TextDecoder, Infinity, NaN,
    setTimeout: opts.setTimeout || setTimeout, clearTimeout: opts.clearTimeout || clearTimeout, setInterval: opts.setInterval || (() => 0), clearInterval: () => {},
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; }, cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    matchMedia: (q) => ({ matches: !!(opts.media && opts.media[q]), addEventListener() {}, addListener() {} }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    navigator: { userAgent: 'node', maxTouchPoints: 0, vibrate() {} },
    location: { href: 'about:blank', hash: '', search: '' },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => { winListeners[ev] = (winListeners[ev] || []).filter((f) => f !== fn); },
    dispatch(type, init) { const ev = Object.assign({ type, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, init || {}); for (const fn of (winListeners[type] || []).slice()) fn(ev); return ev; },
    Image: function () { return mk('img', {}, null); },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  Object.assign(win, opts.globals || {});
  win.window = win; win.self = win; win.globalThis = win;
  const vmc = require('vm').createContext(win);
  return {
    win, document, scripts, rafs, vmc,
    frame(ts) { const fns = rafs.splice(0); for (const fn of fns) fn(ts); return fns.length; },
    run(code, filename) { return require('vm').runInContext(code, vmc, { filename: filename || 'inline.js' }); },
  };
}

// Boot the page: its own index.html, its own scripts in its own order.
// The page's clock is the frame clock: Date.now() inside the page advances
// only as frames are stepped, so fire-rate gaps are real game time. A fake
// gifos API stands in for the room so net.js can be fed rows.
function bootTanks(order) {
  const clock = { t: 1e6 };
  class PageDate extends Date { static now() { return clock.t; } }
  const room = { sub: null };
  const gifos = { db: () => ({ subscribe: (cb) => { room.sub = cb; }, put: () => Promise.resolve(), get: () => Promise.resolve(null) }), me: () => Promise.resolve({ id: 'me1', name: 'Tester' }) };
  const dom = fakeDom(read('index.html'), { rect: { left: 0, top: 0, width: 100, height: 100 }, globals: { Date: PageDate, gifos } });
  const frame0 = dom.frame;
  dom.frame = (ts) => { clock.t = 1e6 + ts; return frame0(ts); };
  const srcs = order || dom.scripts.filter((x) => x.src).map((x) => x.src);
  let error = null;
  try { for (const x of srcs) dom.run(read(x), x); } catch (e) { error = e; }
  return { dom, srcs, error, g: dom.win.__tanksG, room, clock };
}
const page = bootTanks();
// In page order the app wires itself to the room: a hit another tank claims
// on me lands on my tank.
async function remoteHitLands(b) {
  if (b.error || !b.g) return false;
  await new Promise((res) => setImmediate(res));
  if (!b.room.sub) return false;
  b.g.me.shieldUntil = 0;
  const lives0 = b.g.me.lives;
  b.room.sub([{ id: 'S', name: 'Other', x: 300, y: 300, rot: 0, tur: 0, alive: true, lives: 3, k: 0, d: 0, sp: 0, t: b.clock.t,
    hits: [{ n: 1, to: 'me1', d: 1, sp: b.dom.win.TanksNet ? b.dom.win.TanksNet.self().spawn : 0 }], shots: [], lastKilledBy: null }]);
  return b.g.me.lives === lives0 - 1;
}
MAIN.push(async () => {
  check('index.html loads sim.js then net.js then app.js: booted in page order, a remote hit lands on my tank',
    !page.error && await remoteHitLands(page), page.error && String(page.error));
  const swapped = bootTanks(['sim.js', 'app.js', 'net.js']);
  check('…while app.js before net.js leaves the tank deaf to the room (the order is load-bearing)', !(await remoteHitLands(swapped)));
});
check('…and app.js before its dependencies does not boot', !!bootTanks(['app.js', 'sim.js', 'net.js']).error);
{
  // MOVE stick: a press at the pad's right edge drives the tank right.
  const { dom, g } = bootTanks();
  const pad = dom.document.getElementById('movePad');
  const aim = dom.document.getElementById('aimPad');
  const fire = dom.document.getElementById('fireBtn');
  check('MOVE and AIM sticks plus FIRE are in the markup', !!(pad && aim && fire));
  g.me.shieldUntil = 0; g.drones.forEach((d) => { d.cd = 99; });
  let ts = 1000; dom.frame(ts);
  const x0 = g.me.x;
  pad.dispatch('pointerdown', { pointerId: 7, clientX: 100, clientY: 50 });
  for (let i = 0; i < 40; i++) dom.frame(ts += 16);
  check('sticks bind pointer events (not touch-only): a MOVE press drives the tank', g.me.x > x0 + 15, { from: x0, to: g.me.x });
  check('…and captures the pointer', pad.captured.includes(7));
  pad.dispatch('pointerup', { pointerId: 7 });
  dom.frame(ts += 16);
  const x1 = g.me.x;
  for (let i = 0; i < 20; i++) dom.frame(ts += 16);
  check('…and releasing it stops the tank', Math.abs(g.me.x - x1) < 2, { at: x1, now: g.me.x });
  const n0 = g.bullets.length, s0 = g.lastShot;
  aim.dispatch('pointerdown', { pointerId: 8, clientX: 100, clientY: 50 });
  for (let i = 0; i < 4; i++) dom.frame(ts += 16);
  check('holding the AIM stick fires', g.bullets.length > n0 && g.lastShot > s0, g.bullets.length);
  aim.dispatch('pointerup', { pointerId: 8 });
  for (let i = 0; i < 60; i++) dom.frame(ts += 16);
  const s1 = g.lastShot;
  fire.dispatch('pointerdown', { pointerId: 9 });
  for (let i = 0; i < 4; i++) dom.frame(ts += 16);
  check('pressing FIRE fires', g.lastShot > s1 && fire.captured.includes(9), { s1, last: g.lastShot });
}
{
  // The OS chrome owns Invite: the page offers no Invite control of its own.
  const doc = page.dom.document;
  const els = doc.querySelectorAll('*');
  check('no in-app Invite button (OS chrome owns Invite)',
    !els.some((e) => /invite/i.test(e.id) || /invite/i.test(e.className)) &&
    !els.some((e) => (e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*invite\s*$/i.test(e.textContent)));
}
// TEXT-CHECK: the icon is a picture; whether letters were stamped on it is not
// observable by running the generator, so the generator is read for the call.
check('icon.mjs does not stamp TANKS letters on the GIF frames',
  !/drawText\(put, \d+, \d+, 'TANKS'/.test(read('icon.mjs')));

const simBox = load([APP('sim.js')]);
const Sim = simBox.TanksSim;
check('sim.js loads TanksSim', !!(Sim && Sim.create && Sim.step && Sim.hitWall));

if (Sim) {
  const STEP = 0.016;
  function drive(g, frames, input) {
    for (let i = 0; i < frames; i++) {
      Sim.step(g, STEP, Object.assign({ now: g.now + STEP * 1000 }, input));
    }
  }

  {
    const g = Sim.create({ seed: 1 });
    g.me.shieldUntil = 0;
    const x0 = g.me.x, y0 = g.me.y;
    drive(g, 60, { keys: { ArrowRight: true } });
    check('holding right MOVES the tank', g.me.x > x0 + 20, { from: x0, to: g.me.x });
    const x1 = g.me.x;
    drive(g, 60, { keys: { ArrowDown: true } });
    check('holding down MOVES the tank', g.me.y > y0 + 10, { from: y0, to: g.me.y, x: g.me.x });
    check('a turn changes heading', g.me.rot !== 0, g.me.rot);
    void x1;
  }

  {
    const g = Sim.create({ seed: 2 });
    g.me.shieldUntil = 0;
    g.me.x = 154; g.me.y = 240; g.me.rot = 0;
    drive(g, 80, { keys: { ArrowRight: true } });
    check('a wall STOPS the tank (does not pass x=180)', g.me.x + Sim.TR <= 180 + 1, { x: g.me.x, tr: Sim.TR });
  }

  {
    const g = Sim.create({ seed: 3 });
    g.me.shieldUntil = 0;
    g.drones.forEach((d) => { d.cd = 99; });
    const drone = g.drones[0];
    drone.x = 260; drone.y = 80; drone.rot = 0; drone.lives = 1; drone.alive = true;
    g.me.x = 80; g.me.y = 80; g.me.tur = 0; g.me.rot = 0;
    const b = Sim.fire(g.me, 0, false);
    check('fire() returns a shell in front of the barrel', !!(b && b.x > g.me.x), b && { x: b.x, y: b.y });
    g.bullets.push(b);
    const k0 = g.me.k;
    drive(g, 80, { keys: {} });
    check('a shell that hits a drone kills it and scores', drone.alive === false && g.me.k === k0 + 1,
      { alive: drone.alive, k: g.me.k, bullets: g.bullets.length });
  }

  {
    const g = Sim.create({ seed: 4 });
    g.me.shieldUntil = 0;
    g.drones.forEach((d) => { d.cd = 99; d.x = 700; d.y = 40; });
    g.me.x = 80; g.me.y = 80; g.me.tur = 0;
    const n0 = g.bullets.length;
    drive(g, 3, { keys: { Space: true }, pointer: { x: 400, y: 80, down: false } });
    check('holding Space fires a shell', g.bullets.length > n0, g.bullets.length);
  }

  {
    const g = Sim.create({ seed: 5 });
    g.me.shieldUntil = 0;
    const d = g.drones[0];
    d.x = 90; d.y = 80; d.cd = 99;
    g.me.x = 60; g.me.y = 80; g.me.rot = 0;
    const x0 = g.me.x;
    drive(g, 40, { keys: { ArrowRight: true } });
    check('you cannot drive through another tank', g.me.x < d.x - 8, { me: g.me.x, drone: d.x, from: x0 });
  }

  {
    const g = Sim.create({ seed: 6 });
    check('a fresh tank is shielded', Sim.shielded(g.me, g.now));
    const lives0 = g.me.lives;
    Sim.hurt(g, g.me, 1);
    check('shield swallows a spawn hit', g.me.lives === lives0 && g.me.alive, { lives: g.me.lives });
    g.me.shieldUntil = 0;
    Sim.hurt(g, g.me, 1);
    check('after the shield, a hit costs a heart', g.me.lives === lives0 - 1, { lives: g.me.lives });
  }

  {
    const g = Sim.create({ seed: 7 });
    g.me.shieldUntil = 0;
    g.me.x = 60; g.me.y = 60;
    check('hitWall reports the arena edge', Sim.hitWall(-1, 60, Sim.TR) && Sim.hitWall(60, -1, Sim.TR));
    check('open yard is not a wall', !Sim.hitWall(100, 100, Sim.TR));
  }
}

{
  let fakeTime = 100000;
  let subCb = null;
  const fakeApi = {
    db: () => ({
      subscribe: (cb) => { subCb = cb; },
      put: () => Promise.resolve(),
    }),
    me: () => Promise.resolve({ id: 'me1', name: 'Alice' }),
  };
  const sandbox = load([APP('net.js')], {
    Date: { now: () => fakeTime },
    setTimeout: (fn) => { fn(); return 0; },
    gifos: fakeApi,
  });
  const Net = sandbox.TanksNet;
  check('net.js loads', !!(Net && Net.init && Net.onHit));
  if (Net) {
    const hits = [];
    let alive = true, lives = 3;
    Net.onHit((d, id) => {
      hits.push(fakeTime);
      if (!alive) return;
      lives -= d;
      Net.tookHit(d, id, 'Bob');
      if (lives <= 0) alive = false;
    });
    const row = (t) => ({
      id: 'S', name: 'Bob', x: 300, y: 300, rot: 0, tur: 0,
      alive: true, lives: 3, k: 0, d: 0, sp: 0, t,
      hits: [{ n: 1, to: 'me1', d: 1, sp: 0 }], shots: [], lastKilledBy: null,
    });
    MAIN.push(async () => {
      await Net.init();
      check('hit-claim harness init settled', !!subCb);
      Net.tick(100, 100, 0, 0);
      const T0 = fakeTime;
      while (fakeTime < T0 + 40000) {
        fakeTime += 125;
        subCb([row(fakeTime)]);
        Net.tick(100, 100, 0, 0);
        if (!alive && fakeTime - hits[hits.length - 1] > 2200) {
          alive = true; lives = 3; Net.respawn(60, 60);
        }
      }
      check('ONE claimed hit applies exactly once across 40s of republished rows',
        hits.length === 1, { applications: hits.length });
      subCb([Object.assign(row(fakeTime), { hits: [] })]);
      fakeTime += 125;
      subCb([Object.assign(row(fakeTime), { hits: [{ n: 2, to: 'me1', d: 1, sp: 0 }] })]);
      check('a genuinely new claim from the same shooter still applies',
        hits.length === 2, { applications: hits.length });
      // The claim is forgotten when the SHOOTER's row drops it (not on a clock):
      // the same claim number carried again after the drop is a new hit.
      subCb([Object.assign(row(fakeTime), { hits: [] })]);
      fakeTime += 125;
      subCb([Object.assign(row(fakeTime), { hits: [{ n: 1, to: 'me1', d: 1, sp: 0 }] })]);
      check('hit-claim forgets only when the shooter drops the ring (no 12s clock)',
        hits.length === 3, { applications: hits.length });
      // Muzzle flashes follow the same law: once per shot while the ring
      // carries it, again only after the shooter dropped it.
      const flashes = [];
      Net.onShot((s) => flashes.push(s));
      const shotRow = (shots) => Object.assign(row(fakeTime), { hits: [], shots });
      for (let i = 0; i < 100; i++) { fakeTime += 125; subCb([shotRow([{ n: 5, x: 1, y: 2, a: 0 }])]); }
      check('seenShots: one shot republished for 12s flashes once', flashes.length === 1, flashes.length);
      fakeTime += 125; subCb([shotRow([{ n: 6, x: 1, y: 2, a: 0 }])]);   // the ring moved on: n 5 dropped
      fakeTime += 125; subCb([shotRow([{ n: 5, x: 1, y: 2, a: 0 }])]);
      check('seenShots prune agrees with the live ring (forgotten once the shooter drops it)', flashes.length === 3, flashes.length);
    });
  }
}

(async () => {
  for (const fn of MAIN) await fn();
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll PASS — tanks core loop holds.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
