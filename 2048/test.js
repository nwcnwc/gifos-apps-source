// 2048 HAS TO KEEP THE GAME YOU JUST LEFT.
//
// Upstream 2048 holds ONE game state and "New Game" overwrites it, so the board
// you reached 4096 on is gone the instant you deal the next one. This suite
// plays REAL games through the shipped vendor GameManager on top of the shipped
// storage/archive, and pins the three things that made that bug possible:
//
//   1. New Game must OPEN a row, never overwrite one.
//   2. The board that ends a lost game must reach disk — upstream's actuate()
//      calls clearGameState() the moment `over` is true, so the last position
//      you ever saw is the one it never saves.
//   3. Nothing but remove() may drop a played game. No cap, no expiry, no
//      "keep the last N".
//
// Plus: the archive survives a reload, resuming is lossless in BOTH directions,
// friend-mode never touches the solo archive, and the pre-archive save migrates
// instead of dying.
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

// ---- a db that behaves like gifos.db('save'): one collection, keyed by id ----
function fakeDb() {
  const rows = new Map();
  const api = {
    rows,
    getAll: () => Promise.resolve([...rows.values()].map((r) => JSON.parse(JSON.stringify(r)))),
    put: (rec) => { rows.set(rec.id, JSON.parse(JSON.stringify(rec))); return Promise.resolve(rec); },
    delete: (id) => { rows.delete(id); return Promise.resolve(true); },
  };
  return api;
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
    if (sel.indexOf(',') >= 0) return sel.split(',').some((s1) => matches(x, s1));
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
      getElementsByClassName(c) { return all(this).filter((x) => x.classList.contains(c)); },
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
  let body = null, head = null;
  const scripts = [];
  function parseInto(root, htmlText) {
  let cur = root;
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
  }
  parseInto(docEl, htmlText);
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
    addEventListener: (ev, fn, o) => { (docListeners[ev] = docListeners[ev] || []).push({ fn, capture: o === true || !!(o && o.capture) }); },
    removeEventListener: (ev, fn) => { docListeners[ev] = (docListeners[ev] || []).filter((l) => l.fn !== fn); },
    // capture listeners first; stopPropagation() in one keeps the event from the bubble listeners
    dispatch(type, init) {
      let stopped = false;
      const ev = Object.assign({ type, target: body, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; } }, init || {});
      const ls = (docListeners[type] || []).slice();
      for (const l of ls.filter((x) => x.capture)) l.fn(ev);
      if (!stopped) for (const l of ls.filter((x) => !x.capture)) { l.fn(ev); if (stopped) break; }
      return ev;
    },
    getElementsByClassName: (c) => all(docEl).filter((x) => x.classList.contains(c)),
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
    // fragment(html): rendered markup as elements (to click what a page painted)
    fragment(html) { const box = mk('div', {}, null); parseInto(box, String(html)); return box; },
    frame(ts) { const fns = rafs.splice(0); for (const fn of fns) fn(ts); return fns.length; },
    run(code, filename) { return require('vm').runInContext(code, vmc, { filename: filename || 'inline.js' }); },
  };
}

// ---- boot the app the way index.html does, minus the DOM ----------------
// hist.js and storage.js are pure; the vendor engine needs only Grid/Tile.
// The actuator and input manager are stubs — this suite is about the SAVE.
// The panel's own wiring is run at the bottom, on the booted page.
function boot(db, opts) {
  opts = opts || {};
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, TypeError,
    setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.gifos = { db: () => db };
  const listeners = {};
  sandbox.addEventListener = (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); };
  sandbox.fire = (n) => (listeners[n] || []).forEach((fn) => fn());
  vm.createContext(sandbox);
  for (const f of ['vendor/grid.js', 'vendor/tile.js', 'hist.js', 'storage.js', 'vendor/game_manager.js']) {
    vm.runInContext(read(f), sandbox, { filename: f });
  }
  // The two seams app.js installs, replayed here without the DOM half.
  vm.runInContext(`
    var origActuate = GameManager.prototype.actuate;
    GameManager.prototype.actuate = function () {
      if (this.over && !window.G2048.mp && LocalStorageManager.finalize) {
        LocalStorageManager.finalize(this.serialize());
      }
      origActuate.call(this);
    };
  `, sandbox);
  vm.runInContext(`
    function Actuator() {}
    Actuator.prototype.actuate = function () {};
    Actuator.prototype.continueGame = function () {};
    function Input() { this.handlers = {}; }
    Input.prototype.on = function (e, fn) { (this.handlers[e] = this.handlers[e] || []).push(fn); };
  `, sandbox);
  return sandbox;
}

function newGameManager(s) {
  return vm.runInContext('window.G2048.game = new GameManager(4, Input, Actuator, LocalStorageManager)', s);
}

// Writes are debounced 200 ms (a move must not cost a db round trip), so a
// db assertion has to outwait the timer.
const settle = () => new Promise((r) => setTimeout(r, 300));

// Slide until something moves. Deterministic enough to build real histories.
function playMoves(game, n) {
  let made = 0;
  for (let i = 0; i < n * 8 && made < n; i++) {
    const before = JSON.stringify(game.serialize().grid.cells);
    game.move(i % 4);
    if (JSON.stringify(game.serialize().grid.cells) !== before) made++;
    if (game.over) break;
  }
  return made;
}

// ---- boot mp.js against a paper DOM -------------------------------------
// The race bar is pure string-building off a room snapshot, so it needs no
// browser — only the six ids it reaches for and a room whose subscribe()
// callback we can pull. show() sets the local board, feeds a snapshot, and
// hands back what the bar now reads.
function bootMp() {
  const node = () => ({
    textContent: '', innerHTML: '', hidden: false,
    classList: { add() {}, remove() {} },
    addEventListener() {}, getElementsByTagName: () => [{ textContent: '' }],
  });
  const nodes = {};
  for (const id of ['friend-status', 'friend-scores', 'againBtn', 'friend-bar', 'friendBtn', 'leaveBtn']) {
    nodes[id] = node();
  }
  const game = {
    score: 0, won: false, over: false, grid: { eachCell() {} },
    resetBoard() {}, setup() {}, actuator: { continueGame() {} },
  };
  let feed = null;
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setInterval: () => 0, clearInterval() {},
    document: {
      getElementById: (id) => nodes[id],
      querySelector: () => node(),
      body: { classList: { add() {}, remove() {} } },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.G2048 = { game };
  sandbox.gifos = {
    db: () => ({ put: () => Promise.resolve(), delete: () => Promise.resolve(), subscribe: (fn) => { feed = fn; } }),
    me: () => Promise.resolve({ id: 'aaa', name: 'You' }),
  };
  vm.createContext(sandbox);
  vm.runInContext(read('mp.js'), sandbox, { filename: 'mp.js' });
  sandbox.G2048.Mp.enter();
  return {
    ready: () => new Promise((r) => setTimeout(r, 0)),
    show(board, list) {
      Object.assign(game, board);
      feed(list);
      return {
        status: nodes['friend-status'].textContent || nodes['friend-status'].innerHTML,
        scores: nodes['friend-scores'].innerHTML,
      };
    },
  };
}

function gameRows(db) {
  return [...db.rows.values()].filter((r) => r.kind === 'game');
}

(async function main() {
  // ---- the pure archive helpers ------------------------------------------
  {
    const s = boot(fakeDb());
    const H = s.window.G2048.Hist;
    // grid.cells is cells[x][y] with x the COLUMN. A naive flatten transposes
    // the board, which would draw every preview mirrored down the diagonal.
    const state = {
      grid: { size: 2, cells: [[{ value: 2 }, { value: 8 }], [{ value: 4 }, null]] },
      score: 12, over: false, won: false, keepPlaying: false,
    };
    check('previewCells reads row-major, not transposed',
      JSON.stringify(H.previewCells(state)) === JSON.stringify([2, 4, 8, 0]),
      H.previewCells(state));
    check('maxTile is the biggest tile on the board', H.maxTile(state) === 8);
    check('tileCount counts occupied cells', H.tileCount(state) === 3);
    check('signature changes with the score even on the same cells',
      H.signature(state) !== H.signature(Object.assign({}, state, { score: 13 })));
    const now = Date.UTC(2026, 7, 24, 12, 0, 0);
    check('relTime says "earlier" for a game with no timestamp — never 1970',
      H.relTime(null, now) === 'earlier' && H.relTime(0, now) === 'earlier');
    check('relTime is relative up to a week',
      H.relTime(now - 30000, now) === 'just now' &&
      H.relTime(now - 5 * 60000, now) === '5 min ago' &&
      H.relTime(now - 3 * 3600000, now) === '3 hours ago' &&
      H.relTime(now - 30 * 3600000, now) === 'yesterday' &&
      H.relTime(now - 4 * 86400000, now) === '4 days ago');
    check('relTime dates anything older, and carries the year across new year',
      /^[A-Z][a-z]{2} \d+$/.test(H.relTime(now - 20 * 86400000, now)) &&
      /, 2025$/.test(H.relTime(Date.UTC(2025, 4, 2), now)));
    check('status names the three ends a game can have',
      H.status({ state: { over: true } }) === 'finished' &&
      H.status({ state: { won: true, keepPlaying: false } }) === 'won' &&
      H.status({ state: {} }) === 'in play');
    check('persistable drops the derived fields and keeps the move count',
      (() => {
        const p = H.persistable({ id: 'x', state, score: 12, max: 8, moves: 7, startedAt: 1, updatedAt: 2, sig: 'q', cellsSig: 'q' });
        return p.sig === undefined && p.cellsSig === undefined && p.moves === 7 && p.kind === 'game';
      })());
  }

  // ---- THE BUG: New Game must not eat the board you were on ---------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);

    playMoves(game, 12);
    const first = hist.currentId();
    const firstScore = hist.get(first).score;
    const firstCells = JSON.stringify(game.serialize().grid.cells);
    check('a game is in the archive from the first move', !!first && hist.count() === 1);

    game.restart();
    playMoves(game, 6);
    const second = hist.currentId();
    check('New Game opens a SECOND row instead of overwriting the first',
      second !== first && hist.count() === 2, { first, second, count: hist.count() });
    check('the game you left still has its score and its board',
      hist.get(first).score === firstScore &&
      JSON.stringify(hist.get(first).state.grid.cells) === firstCells);

    // ...and going back is lossless the other way too.
    const secondCells = JSON.stringify(game.serialize().grid.cells);
    const resumed = hist.resume(first);
    game.actuator.continueGame();
    game.setup();
    check('resuming an old game puts that exact board back on the table',
      JSON.stringify(game.serialize().grid.cells) === firstCells && !!resumed);
    check('the game you stepped away from is untouched by the switch',
      JSON.stringify(hist.get(second).state.grid.cells) === secondCells);
    check('switching back and forth never creates a third game', hist.count() === 2);

    hist.resume(second);
    game.setup();
    check('and the other direction restores it exactly',
      JSON.stringify(game.serialize().grid.cells) === secondCells);
  }

  // ---- boards nobody played are not games ---------------------------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    playMoves(game, 3);
    game.restart();
    game.restart();
    game.restart();
    // One played game, plus the deal now on the table. The two unplayed boards
    // in between left no trace.
    check('hammering New Game does not litter history with unplayed deals',
      hist.count() === 2, hist.games().map((g) => g.moves));
    check('exactly one of them is a game somebody actually played',
      hist.games().filter((g) => g.moves > 0).length === 1 &&
      hist.games().filter((g) => g.moves > 0)[0].moves >= 3);
  }

  // ---- the losing board has to reach disk ---------------------------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    // Cycle the four directions until the board is genuinely dead. This is a
    // real game played to its real end, not a hand-placed corpse.
    let guard = 0;
    while (!game.over && guard < 20000) game.move(guard++ % 4);
    check('the board really did fill up', game.over === true, guard);
    const row = hist.games()[0];
    check('the final, LOST board is the one archived — not the move before it',
      row.state.over === true && JSON.stringify(row.state.grid.cells) === JSON.stringify(game.serialize().grid.cells));
    check('a lost game is still in history', hist.count() === 1 && row.score > 0 && row.moves > 10);
    check('...and the app lets go of it, so the next boot deals fresh',
      hist.currentId() === null && hist.state() === null);
    await settle();
    check('the lost game reached the db, not just memory',
      gameRows(db).length === 1 && gameRows(db)[0].state.over === true);
  }

  // ---- it survives a reload ----------------------------------------------
  {
    const db = fakeDb();
    const s1 = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s1);
    const g1 = newGameManager(s1);
    playMoves(g1, 10);
    g1.restart();
    playMoves(g1, 5);
    s1.fire('pagehide');
    await settle();
    const liveId = s1.window.G2048.hist.currentId();
    const liveCells = JSON.stringify(g1.serialize().grid.cells);
    const best = g1.storageManager.getBestScore();

    const s2 = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s2);
    const hist2 = s2.window.G2048.hist;
    const g2 = newGameManager(s2);
    check('both games come back after a reload', hist2.count() === 2);
    check('the game in progress is still the one on the table',
      hist2.currentId() === liveId && JSON.stringify(g2.serialize().grid.cells) === liveCells);
    check('best score comes back too', g2.storageManager.getBestScore() === best && best > 0);
    check('re-opening the app does not count as a move',
      hist2.get(liveId).moves === s1.window.G2048.hist.get(liveId).moves);
  }

  // ---- only YOU delete a game --------------------------------------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    for (let i = 0; i < 12; i++) { if (i) game.restart(); playMoves(game, 4); }
    check('twelve games played, twelve games kept — there is no cap',
      hist.count() === 12, hist.count());
    const ids = hist.games().map((g) => g.id);
    hist.remove(ids[3]);
    check('remove() drops exactly one', hist.count() === 11 && !hist.get(ids[3]));
    check('...and it is gone from the db as well', gameRows(db).length === 11);
    check('remove() of an unknown id is a no-op', hist.remove('nope') === false && hist.count() === 11);
    check('the list is newest-first',
      hist.games().every((g, i, a) => i === 0 || (a[i - 1].updatedAt || 0) >= (g.updatedAt || 0)));
  }

  // ---- the pre-archive save is migrated, not lost -------------------------
  {
    const db = fakeDb();
    const cells = [[{ position: { x: 0, y: 0 }, value: 4096 }, null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]];
    await db.put({ id: 'best', score: 99999 });
    await db.put({ id: 'game', state: { grid: { size: 4, cells }, score: 77777, over: false, won: true, keepPlaying: true } });
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    check('the old single save becomes the first game in the archive',
      hist.count() === 1 && hist.games()[0].max === 4096 && hist.games()[0].score === 77777);
    check('and it is still the game on the table',
      game.score === 77777 && hist.currentId() === hist.games()[0].id);
    check('a migrated game has no invented start time', hist.games()[0].startedAt === null);
    await settle();
    check('the legacy row is retired so it cannot migrate twice',
      !db.rows.has('game') && gameRows(db).length === 1);
    check('best score is untouched by the migration', game.storageManager.getBestScore() === 99999);
  }

  // ---- a race is not a game you played alone ------------------------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    playMoves(game, 8);
    const soloId = hist.currentId();
    const soloCells = JSON.stringify(hist.get(soloId).state.grid.cells);
    const soloMoves = hist.get(soloId).moves;

    s.window.G2048.mp = true;
    game.storageManager.setGameState(game.serialize());
    game.storageManager.clearGameState();
    vm.runInContext('LocalStorageManager.finalize({ grid: { size: 4, cells: [[null,null,null,null],[null,null,null,null],[null,null,null,null],[null,null,null,null]] }, score: 1, over: true })', s);
    check('friend-mode writes nothing into the solo archive',
      hist.count() === 1 && hist.get(soloId).moves === soloMoves &&
      JSON.stringify(hist.get(soloId).state.grid.cells) === soloCells);
    check('...and does not let go of the solo game either',
      hist.currentId() === soloId && game.storageManager.getGameState() === null);
    s.window.G2048.mp = false;
    check('leaving the race hands the solo board straight back',
      JSON.stringify(game.storageManager.getGameState().grid.cells) === soloCells);
  }

  // ---- deleting the game under your hands ---------------------------------
  {
    const db = fakeDb();
    const s = boot(db);
    await vm.runInContext('LocalStorageManager.load()', s);
    const hist = s.window.G2048.hist;
    const game = newGameManager(s);
    playMoves(game, 6);
    const id = hist.currentId();
    hist.remove(id);
    check('deleting the current game lets go of it', hist.currentId() === null && hist.count() === 0);
    game.restart();
    playMoves(game, 4);
    check('the next game is a NEW row, not the deleted one resurrected',
      hist.count() === 1 && hist.currentId() !== id);
  }

  // ---- one score, printed once -------------------------------------------
  // The race bar is the scoreboard: every live score, ranked, with its highest
  // tile. The status line beside it exists to say what the list CANNOT — press
  // Invite, you are out, why the round ended — and the heading's Score/Best
  // pair stands down. It shipped saying "Kim is on 1,000." beside a chip that
  // already read 1,000, and tagging a 2048 winner "2048" next to a chip that
  // said 2048. Every state below is checked for a number said twice.
  {
    const mp = bootMp();
    await mp.ready();   // enter() subscribes only after me() resolves
    const t = Date.now();
    const row = (o) => Object.assign(
      { seed: 1, round: 1, score: 0, hash: 'x', max: 0, won: false, over: false, at: t }, o);
    const you = (o) => row(Object.assign({ id: 'aaa', name: 'Me' }, o));
    const kim = (o) => row(Object.assign({ id: 'bbb', name: 'Kim' }, o));
    const anon = (o) => row(Object.assign({ id: 'ccc', name: '' }, o));

    // Scores chosen so no gap COINCIDES with a printed score — otherwise
    // "You’re 1,000 ahead." beside Kim's 1,000 would read as a repeat.
    const states = [
      ['alone', { score: 0 }, [you({})]],
      ['ahead', { score: 1240 }, [you({ score: 1240, max: 64 }), kim({ score: 1000, max: 32 })]],
      ['behind', { score: 900 }, [you({ score: 900 }), kim({ score: 1030 })]],
      ['level', { score: 1000 }, [you({ score: 1000 }), kim({ score: 1000 })]],
      ['a crowd', { score: 10 }, [you({ score: 10 }), kim({ score: 5 }), anon({ score: 1 })]],
      ['you out, they play on', { score: 900, over: true },
        [you({ score: 900, over: true }), kim({ score: 1030 })]],
      ['they reached 2048', { score: 900 },
        [you({ score: 900 }), kim({ score: 2400, max: 2048, won: true })]],
      ['you reached 2048', { score: 2400, won: true },
        [you({ score: 2400, max: 2048, won: true }), kim({ score: 900 })]],
      ['a nameless winner', { score: 900 },
        [you({ score: 900 }), anon({ score: 2400, max: 2048, won: true })]],
      ['a nameless winner on score', { score: 800, over: true },
        [you({ score: 800, over: true }), anon({ score: 1900, over: true, max: 256 })]],
      ['you win on score', { score: 2000, over: true },
        [you({ score: 2000, over: true, max: 512 }), kim({ score: 940, over: true, max: 256 })]],
      ['they win on score', { score: 800, over: true },
        [you({ score: 800, over: true }), kim({ score: 1900, over: true, max: 256 })]],
      ['a tie', { score: 900, over: true },
        [you({ score: 900, over: true }), kim({ score: 900, over: true })]],
    ];

    const said = [];
    for (const [name, game, list] of states) {
      const { status, scores } = mp.show(game, list);
      const printed = [...scores.matchAll(/class="score">([^<]+)</g)].map((m) => m[1]);
      // Whole numbers only — the "0" in a score of 0 is not a repeat of the
      // "0" inside "first to 2048".
      const dupes = printed.filter((n) =>
        new RegExp('(^|[^\\d,])' + n + '([^\\d,]|$)').test(status));
      check('a score is printed once — ' + name, dupes.length === 0, { status, dupes });
      check('the bar still says something — ' + name, status.trim().length > 3, status);
      said.push([name, status]);
    }

    const byName = Object.fromEntries(said);
    // Who the line names, and which numbers it carries — not its exact words.
    const names = (t) => ['You', 'Kim', 'They'].filter((n) => new RegExp('\\b' + n + '\\b').test(t));
    check('the winner is the one the line names — and a nameless winner is never "They wins"',
      names(byName['they reached 2048']).join() === 'Kim' &&
      names(byName['a nameless winner']).join() === 'They' &&
      names(byName['a nameless winner on score']).join() === 'They' && !/\bThey wins\b/.test(byName['a nameless winner on score']) &&
      names(byName['you win on score']).join() === 'You' &&
      names(byName['they win on score']).join() === 'Kim' &&
      byName['you win on score'] !== byName['they win on score'].replace('Kim', 'You'), byName);
    const nums = (t) => (t.match(/-?\d+(?:,\d{3})*/g) || []).join();
    check('the gap is what the line adds — the one thing two scores do not say',
      nums(byName['ahead']) === '240' && nums(byName['behind']) === '130' && nums(byName['level']) === '' &&
      new Set([byName['ahead'].replace('240', 'N'), byName['behind'].replace('130', 'N'), byName['level']]).size === 3, byName);
    check('the overlay across the board says you are out, so the bar does not too',
      !/out/i.test(byName['you out, they play on']), byName['you out, they play on']);

    const wonList = mp.show({ score: 2400, won: true },
      [you({ score: 2400, max: 2048, won: true }), kim({ score: 900 })]).scores;
    check('a 2048 winner is not tagged "2048" beside a chip that reads 2048',
      /chip-2048">2048</.test(wonList) && !/tag">2048</.test(wonList), wonList);
  }

  // ---- the page, booted -------------------------------------------------
  // index.html over a small DOM, its scripts in page order, the save in a
  // fake gifos.db. The Games panel is opened, clicked and typed at.
  {
    async function bootPage(order, rowsIn) {
      const db = fakeDb();
      for (const r of rowsIn || []) db.rows.set(r.id, r);
      let gets = 0; const g0 = db.getAll; db.getAll = () => { gets++; return g0(); };
      const dom = fakeDom(read('index.html'), { globals: { gifos: { db: () => db } } });
      const srcs = order || dom.scripts.filter((x) => x.src).map((x) => x.src);
      let error = null;
      try { for (const f of srcs) dom.run(read(f), f); } catch (e) { error = e; }
      await new Promise((r) => setTimeout(r, 20));
      try { dom.frame(16); } catch (e) { error = error || e; }
      const G = dom.win.G2048 || {};
      return { dom, db, G, error, srcs, gets: () => gets, $: (id) => dom.document.getElementById(id) };
    }
    const cells = (game) => JSON.stringify(game.serialize().grid.cells);
    const p = await bootPage();
    check('index.html ships the Games button and the panel, and the button opens it',
      !p.error && !!p.$('histBtn') && !!p.$('hist-list') && p.$('hist-panel').hidden === true &&
      (p.$('histBtn').click(), p.$('hist-panel').hidden === false && p.G.HistUI.isOpen()));
    p.$('hist-close').click();
    check('✕ is close, never delete: it closes the panel and every game is still there',
      p.$('hist-panel').hidden === true && !p.$('hist-close').classList.contains('row-del') && p.G.hist.games().length >= 1);
    check('hist.js loads before storage.js and hist-ui.js: in page order the panel mounts on a live game',
      !p.error && !!p.G.game && !!p.G.HistUI, p.error && String(p.error));
    const swap = (a, b) => p.srcs.map((x) => (x === a ? b : x === b ? a : x));
    for (const [what, order] of [['storage.js before hist.js', swap('hist.js', 'storage.js')], ['hist-ui.js before hist.js', p.srcs.filter((x) => x !== 'hist-ui.js').flatMap((x) => (x === 'hist.js' ? ['hist-ui.js', x] : [x]))]]) {
      const q = await bootPage(order);
      let works = !q.error && !!q.G.game && !!q.G.HistUI;
      if (works) { try { q.$('histBtn').click(); works = q.$('hist-list').innerHTML.length > 0; } catch (e) { works = false; } }
      check('…and ' + what + ' does not boot a working panel', !works);
    }
    // the panel blocks play
    p.$('histBtn').click();
    const before = cells(p.G.game);
    for (let d = 0; d < 4; d++) p.G.game.move(d);
    check('the panel blocks play instead of taking moves you cannot see', cells(p.G.game) === before);
    // keys: capture, before the game hears them
    for (const [key, code] of [['ArrowLeft', 37], ['ArrowUp', 38], ['ArrowRight', 39], ['ArrowDown', 40], ['r', 82]]) p.dom.document.dispatch('keydown', { key, keyCode: code, which: code });
    check('the panel swallows keys in CAPTURE, before the game hears them', cells(p.G.game) === before && p.G.HistUI.isOpen());
    p.dom.document.dispatch('keydown', { key: 'Escape', keyCode: 27, which: 27 });
    check('…and Escape closes it', !p.G.HistUI.isOpen());
    // with the panel shut the same keys play
    let moved = false;
    for (const [key, code] of [['ArrowLeft', 37], ['ArrowUp', 38], ['ArrowRight', 39], ['ArrowDown', 40]]) { p.dom.document.dispatch('keydown', { key, keyCode: code, which: code }); if (cells(p.G.game) !== before) { moved = true; break; } }
    check('control: with the panel shut the same keys move tiles', moved);
    // delete asks first
    p.G.game.restart();               // a second game, so the first is history
    playMoves(p.G.game, 3);
    p.$('histBtn').click();
    const listEl = p.$('hist-list');
    // click what the panel painted, in a row that is not the game in play
    const clickRendered = (sel) => {
      const frag = p.dom.fragment(listEl.innerHTML);
      const li = frag.querySelectorAll('li').find((x) => !x.classList.contains('now') && x.querySelector(sel));
      const t = li ? li.querySelector(sel) : null;
      if (t) listEl.dispatch('click', { target: t });
      return t;
    };
    const n0 = p.G.hist.games().length;
    const del = clickRendered('[data-del]');
    check('delete asks first — no one-tap loss of a game', !!del && p.G.hist.games().length === n0 && !!p.dom.fragment(listEl.innerHTML).querySelector('[data-yes]'));
    clickRendered('[data-no]');
    check('…Keep keeps it', p.G.hist.games().length === n0 && !p.dom.fragment(listEl.innerHTML).querySelector('[data-yes]'));
    clickRendered('[data-del]'); clickRendered('[data-yes]');
    check('…and Delete, after asking, removes exactly that game', p.G.hist.games().length === n0 - 1);
    // tapping a past game sits you back down at it: the panel drives the live game
    {
      p.$('hist-close').click(); p.G.game.restart(); playMoves(p.G.game, 2); p.$('histBtn').click();
      const frag = p.dom.fragment(listEl.innerHTML);
      const li = frag.querySelectorAll('li').find((x) => !x.classList.contains('now') && x.querySelector('[data-open]'));
      const id = li && li.querySelector('[data-open]').getAttribute('data-open');
      const row = id && p.G.hist.games().find((r) => r.id === id);
      if (li) listEl.dispatch('click', { target: li.querySelector('[data-open]') });
      check('app.js mounts the panel on the live game: tapping a past game resumes it on the board',
        !!row && p.G.hist.currentId() === id && JSON.stringify(p.G.game.serialize().grid.cells) === JSON.stringify(row.state.grid.cells) && !p.G.HistUI.isOpen(),
        { id, cur: p.G.hist.currentId() });
      p.$('histBtn').click();
    }
    const delBtn = p.dom.fragment(listEl.innerHTML).querySelector('[data-del]');
    check('delete is the standard row-del button carrying the shared trash glyph',
      !!delBtn && delBtn.tagName === 'BUTTON' && delBtn.classList.contains('row-del') && delBtn.children.some((c) => c.tagName === 'SVG'));
    // TEXT-CHECK: a style is painted only by a browser; the parsed stylesheet
    // is read for the rules the markup above relies on.
    {
      const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
      const rules = [];
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const sel of m[1].split(',')) rules.push({ sel: sel.trim().replace(/\s+/g, ' '), body: m[2] });
      const declOf = (sel) => { const d = {}; for (const r of rules.filter((x) => x.sel === sel)) for (const kv of r.body.split(';')) { const i = kv.indexOf(':'); if (i > 0) d[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } return d; };
      check('…styled by the shared button.row-del rule', rules.some((r) => /(^|\s)button\.row-del$/.test(r.sel)));
      check('friend-mode hides the Games button', rules.some((r) => /^body\.friend .*\.hist-button$/.test(r.sel) && /display:\s*none/.test(r.body)));
      check('friend-mode stands the heading Score/Best pair down — the bar has both', /none/.test(declOf('body.friend .scores-container').display || ''));
    }
    // the panel escapes what it prints
    {
      const evil = '"><img src=x onerror=alert(1)>';
      const q = await bootPage(null, [{ id: evil, kind: 'game', state: { grid: { size: 4, cells: [[null, null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]] }, score: 4, over: true, won: false, keepPlaying: false }, score: 4, max: 2, moves: 1, startedAt: 1, updatedAt: 2 }]);
      q.$('histBtn').click();
      const html = q.$('hist-list').innerHTML;
      const frag = q.dom.fragment(html);
      check('the panel escapes ids and names it prints', !/<img/i.test(html) && frag.querySelectorAll('[data-open]').some((b) => b.getAttribute('data-open').indexOf('&quot;') >= 0 || b.getAttribute('data-open').indexOf('"') < 0), html.slice(0, 200));
    }
    // app.js files the losing board before upstream clears it
    {
      const q = await bootPage();
      const game = q.G.game;
      // The board that ends a game: full, no merges. The real actuate() (with
      // app.js's seam) runs on it the way move() runs it when a game is lost.
      const full = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
      game.grid = new q.dom.win.Grid(4, full.map((col, x) => col.map((v, y) => ({ position: { x, y }, value: v }))));
      game.over = true;
      game.actuate();
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...q.db.rows.values()].filter((r) => r.kind === 'game');
      const lost = rows.find((r) => r.state && r.state.over);
      check('app.js files the losing board before upstream clears it', game.over && !!lost && JSON.stringify(lost.state.grid.cells) === JSON.stringify(game.serialize().grid.cells), { over: game.over, rows: rows.length });
    }
    // storage: best stays out of the archive; the collection is read once
    {
      const q = await bootPage(null, [{ id: 'best', score: 5000 }]);
      const gets0 = q.gets();
      q.G.game.restart(); playMoves(q.G.game, 4); q.G.game.restart(); playMoves(q.G.game, 4);
      await new Promise((r) => setTimeout(r, 300));
      const puts = []; const put0 = q.db.put; q.db.put = (r) => { puts.push(r.id); return put0(r); };
      const victim = q.G.hist.games().find((r) => r.id !== q.G.hist.currentId());
      q.G.hist.remove(victim.id);
      await new Promise((r) => setTimeout(r, 300));
      check('storage.js keeps best score out of the archive — deleting a game does not rewrite it',
        q.db.rows.get('best') && q.db.rows.get('best').score === 5000 && !puts.includes('best') && !q.G.hist.games().some((r) => r.id === 'best'), { puts });
      check('storage.js reads the collection ONCE at boot', gets0 === 1 && q.gets() === 1, { atBoot: gets0, after: q.gets() });
    }
  }
  // build.mjs, run on a copy of the app in a temp tree
  {
    const os = require('os'), cp = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g2048-build-'));
    const copy = (dir) => { fs.mkdirSync(path.join(tmp, dir), { recursive: true }); };
    copy('apps'); copy('gifos-app/js');
    fs.cpSync(APP, path.join(tmp, 'apps/2048'), { recursive: true });
    const codec = path.join(__dirname, '..', '..', 'gifos-app', 'js', 'gifos-gif.js');
    fs.copyFileSync(codec, path.join(tmp, 'gifos-app/js/gifos-gif.js'));
    const build = () => cp.spawnSync(process.execPath, [path.join(tmp, 'apps/2048/build.mjs')], { encoding: 'utf8' });
    const ok = build();
    const gifPath = path.join(tmp, 'gifos-app', 'apps', '2048', '2048.gif');
    let names = [];
    if (ok.status === 0 && fs.existsSync(gifPath)) {
      require(codec);
      const a = await globalThis.GifOS.gif.decode(new Uint8Array(fs.readFileSync(gifPath)));
      names = a && a.files ? Object.keys(a.files) : [];
    }
    check('build.mjs packs both new files (the built GIF carries hist.js and hist-ui.js)', names.includes('hist.js') && names.includes('hist-ui.js'), { status: ok.status, err: (ok.stderr || '').slice(-200) });
    const idx = path.join(tmp, 'apps/2048/index.html');
    fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/<div id="hist-panel"[\s\S]*?<\/div>\s*<\/div>/, ''));
    const refused = build();
    check('build.mjs refuses a build with no way into history', refused.status !== 0, refused.status);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  {
    const css = read('style.css');
    // A preview whose tile colours lose to the empty-cell rule paints every
    // board as blank — which is exactly what shipped for one build, because
    // `.prev .pv` (two classes) outranks a bare `.pv-16` (one).
    {
      const classes = (sel) => (sel.match(/\.[A-Za-z0-9_-]+/g) || []).length;
      const base = (css.match(/([^{}\n]*\.pv)\s*\{/) || [])[1];
      const tiles = [...css.matchAll(/([^{}\n]*\.pv-[A-Za-z0-9]+)\s*\{/g)].map((m) => m[1].trim());
      check('every preview tile colour outranks the empty-cell rule',
        !!base && tiles.length >= 12 &&
        tiles.every((t) => classes(t) >= classes(base)),
        { base: base && base.trim(), weakest: tiles.filter((t) => classes(t) < classes(base || '')) });
    }
  }
  console.log(failures ? '\n' + failures + ' FAILED' : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
