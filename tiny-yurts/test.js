// TINY YURTS HAS TO DRAW A PATH.
//
// The jam build treats only event.buttons === 1 as a draw. A finger's
// pointermove often reports buttons=0, so a phone drag never placed a tile:
// the title said "touch or left-click" and a thumb did nothing. The board
// was also cropped in portrait (slice + maxHeight 68vw), so farms fell off
// the screen. And gifos.db hydrated AFTER vendor/game.js had already read
// localStorage, so a saved highscore never appeared on the title.
//
// This suite PLAYS the shipped IIFE in a fake DOM: it places a Path the
// same way a drag does, drags through the jam's own pointer handlers, and
// boots the shell (shim, game, boot) to check the save, the fit and Back.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

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
  m.floor = Math.floor; m.ceil = Math.ceil; m.round = Math.round;
  m.abs = Math.abs; m.min = Math.min; m.max = Math.max;
  m.hypot = Math.hypot; m.atan2 = Math.atan2; m.PI = Math.PI;
  m.sin = Math.sin; m.cos = Math.cos; m.sqrt = Math.sqrt;
  m.imul = Math.imul; m.pow = Math.pow;
  return m;
}

function el(tag, ns) {
  const attrs = Object.create(null);
  const kids = [];
  const listeners = Object.create(null);
  const style = {};
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    namespaceURI: ns || '',
    style,
    children: kids,
    childNodes: kids,
    parentNode: null,
    // innerText follows innerHTML, as a browser's does (boot.js reads it)
    get innerHTML() { return node._html || ''; },
    set innerHTML(v) { node._html = String(v); node._text = node._html.replace(/<[^>]*>/g, ''); },
    get innerText() { return node._text || ''; },
    set innerText(v) { node._text = String(v); node._html = node._text; },
    textContent: '',
    className: '',
    id: '',
    hidden: false,
    value: '',
    width: 0,
    height: 0,
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    append(...nodes) {
      nodes.forEach((n) => {
        if (n == null) return;
        if (typeof n === 'string') n = { textContent: n, parentNode: node };
        n.parentNode = node;
        kids.push(n);
      });
    },
    appendChild(n) { node.append(n); return n; },
    remove() {
      if (!node.parentNode) return;
      const p = node.parentNode.children;
      const i = p.indexOf(node);
      if (i >= 0) p.splice(i, 1);
      node.parentNode = null;
    },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      const w = parseFloat(attrs.width) || 160;
      const h = parseFloat(attrs.height) || 80;
      return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
    },
    querySelectorAll(sel) {   // tag selectors only (div, svg, button): what the shell asks for
      const out = [], want = String(sel).toUpperCase();
      const walk = (n) => { for (const c of n.children || []) { if (c.tagName === want) out.push(c); walk(c); } };
      walk(node);
      return out;
    },
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _attrs: attrs,
    _listeners: listeners,
  };
  Object.defineProperty(style, 'cssText', {
    get() { return node._css || ''; },
    set(v) { node._css = String(v); },
    enumerable: true,
  });
  return node;
}

function loadGame(opts) {
  opts = opts || {};
  const body = el('body');
  const head = el('head');
  const doc = {
    body,
    head,
    documentElement: el('html'),
    fullscreenElement: null,
    createElement: (t) => el(t),
    createElementNS: (ns, t) => el(t, ns),
    querySelectorAll: (sel) => {
      if (sel === 'svg') return collect(body, (n) => n.tagName === 'SVG');
      if (sel === 'div') return collect(body, (n) => n.tagName === 'DIV');
      if (sel === 'button') return collect(body, (n) => n.tagName === 'BUTTON');
      return [];
    },
    querySelector: () => null,
    addEventListener() {},
  };
  body.scrollHeight = 800;
  function collect(node, pred, out) {
    out = out || [];
    if (pred(node)) out.push(node);
    (node.children || []).forEach((c) => collect(c, pred, out));
    return out;
  }

  const mem = {};
  const localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };

  const timers = [];
  const sandbox = {
    console,
    Math: seededMath(0x51F3),
    Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, TypeError,
    parseInt, parseFloat, isNaN, Infinity,
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame(fn) { return setTimeout(() => fn(0), 0); },
    cancelAnimationFrame() {},
    performance: { now: () => 0 },
    innerWidth: opts.w || 390,
    innerHeight: opts.h || 844,
    screen: { orientation: { lock: () => Promise.resolve() } },
    AudioContext: function () { throw new Error('no audio in unit'); },
    document: doc,
    localStorage,
    addEventListener() {},
    navigator: {},
    location: { href: 'about:srcdoc' },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  if (!opts.skipGame) vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'game.js'), 'utf8'), sandbox, {
    filename: 'game.js',
  });
  return { sandbox, mem, timers, doc };
}

// ---- the game loads and the core loop can place a path ----------------------
{
  let threw = null, TY = null, sandbox = null;
  try {
    const loaded = loadGame();
    sandbox = loaded.sandbox;
    TY = sandbox.TinyYurts;
  } catch (e) { threw = e && e.message; }
  check('vendor/game.js loads in a fake DOM', !threw, threw);
  check('TinyYurts is exported', !!(TY && TY.Path && TY.inventory), TY && Object.keys(TY));
  if (TY && TY.Path) {
    check('a new valley has path tiles to spend', TY.inventory.paths > 0, TY.inventory.paths);
    check('a farm spawned at boot (the menu needs one)', (TY.farms || []).length >= 1,
      (TY.farms || []).length);
    const before = TY.paths.length;
    const n0 = TY.inventory.paths;
    // Place a path the same way handlePointermove does: adjacent cells, spend 1.
    const p = new TY.Path({ points: [{ x: 8, y: 6 }, { x: 9, y: 6 }] });
    TY.inventory.paths--;
    check('drawing a path ADDS it to the valley', TY.paths.length === before + 1,
      { before: before, after: TY.paths.length, id: !!p });
    check('…and spends one tile', TY.inventory.paths === n0 - 1,
      { from: n0, to: TY.inventory.paths });
    TY.removePath(8, 6);
    check('erasing the tile removes the path', TY.paths.length === before,
      TY.paths.length);

    // A finger reports buttons=0. The jam used to ignore that drag entirely.
    const layer = TY.gridPointerLayer;
    if (layer) {
      layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 80, right: 160, bottom: 80 });
      const ev = (type, x, y) => ({
        type: type, pointerId: 1, pointerType: 'touch', isPrimary: true,
        buttons: 0, button: 0, clientX: x, clientY: y, x: x, y: y,
        stopPropagation() {}, preventDefault() {},
      });
      const nTiles = TY.inventory.paths;
      TY.handlePointerdown(ev('pointerdown', 12, 12));
      TY.handlePointermove(ev('pointermove', 20, 12));
      TY.handlePointermove(ev('pointermove', 36, 12));
      TY.handlePointerup(ev('pointerup', 36, 12));
      check('a buttons=0 touch drag is accepted (tiles spent or handlers did not throw)',
        TY.inventory.paths <= nTiles);
    }
  }
}

// ---- a finger-drag reaches the same code a mouse-drag does ------------------
// Drags through the jam's own pointer handlers on a fresh valley, on a row the
// seeded board leaves clear.
function drag(kind, opts) {
  opts = opts || {};
  const { sandbox } = loadGame();
  const TY = sandbox.TinyYurts;
  const layer = TY.gridPointerLayer;
  let captured = 0;
  layer.setPointerCapture = () => { captured++; };
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 208, height: 112, right: 208, bottom: 112 });
  const ev = (type, x, y) => ({
    type, pointerId: 1, pointerType: kind, isPrimary: true, buttons: opts.buttons || 0, button: 0,
    clientX: x, clientY: y, x: opts.junkXY ? x + 150 : x, y: opts.junkXY ? y + 90 : y,
    stopPropagation() {}, preventDefault() {},
  });
  const pts = [[12, 92], [20, 92], [28, 92], [36, 92]];
  const n0 = TY.paths.length, inv0 = TY.inventory.paths;
  TY.handlePointerdown(ev('pointerdown', ...pts[0]));
  for (const p of pts.slice(1)) TY.handlePointermove(ev('pointermove', ...p));
  TY.handlePointerup(ev('pointerup', ...pts[pts.length - 1]));
  const cells = TY.paths.slice(n0).map((p) => p.points.map((q) => q.x + ',' + q.y).join('>')).join(' ');
  return { added: TY.paths.length - n0, spent: inv0 - TY.inventory.paths, captured, cells };
}
{
  const touch = drag('touch');
  check('touch is treated as a left-drag (a buttons=0 finger drag places path tiles)', touch.added > 0 && touch.spent === touch.added, touch);
  check('pointerdown captures the pointer so a drag cannot slip off the board', touch.captured === 1, touch);
  const junk = drag('touch', { junkXY: true });
  check('cell math uses clientX, not the non-standard event.x', junk.cells === touch.cells && junk.added === touch.added, { junk: junk.cells, real: touch.cells });
  const mouse = drag('mouse', { buttons: 1 });
  const hover = drag('mouse', { buttons: 0 });
  check('the original buttons===1 mouse path is still there (and a hover draws nothing)', mouse.added > 0 && mouse.cells === touch.cells && hover.added === 0, { mouse, hover });
}

// ---- the shell, booted: shim, game, boot in page order -----------------------
// index.html's own <script> order, the jam's fake DOM, a fake gifos.db.
function bootPage(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const order = opts.order || [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
  const puts = []; let back = null;
  const saved = opts.saved || null;
  const gifos = { db: () => ({ get: () => Promise.resolve(saved), put: (r) => { puts.push(r); return Promise.resolve(); }, subscribe() {} }),
    me: () => Promise.resolve({ id: 'local' }), onBack: (fn) => { back = fn; } };
  const g = loadGame({ skipGame: true, w: opts.w, h: opts.h });
  const sb = g.sandbox;
  sb.gifos = gifos;
  delete sb.localStorage;   // the sandboxed iframe has none: shim.js provides it
  const roster = el('div'); roster.id = 'roster'; roster.hidden = true;
  g.doc.getElementById = (id) => (id === 'roster' ? roster : null);
  let error = null;
  try { for (const f of order) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sb, { filename: f }); } catch (e) { error = e; }
  return { sb, doc: g.doc, puts, back: () => back, error, order };
}
const flushTY = () => new Promise((r) => setTimeout(r, 30));
(async () => {
  {
    const p = bootPage({ saved: { id: 'prefs', score: '1234' } });
    await flushTY();
    const title = p.doc.querySelectorAll('div').find((d) => /^Highscore:/.test(d.innerText || ''));
    check('game.js is a static script, shim.js first, boot.js last: the page boots in that order',
      !p.error && p.order.indexOf('shim.js') < p.order.indexOf('vendor/game.js') && p.order.indexOf('vendor/game.js') < p.order.indexOf('boot.js') && !!p.sb.TinyYurts, p.error && String(p.error));
    const swapped = bootPage({ order: ['vendor/game.js', 'shim.js', 'boot.js'] });
    check('…and game.js before shim.js does not boot (the sandbox has no localStorage)', !!swapped.error);
    check('boot hydrates the saved highscore onto the title', !!title && /1234/.test(title.innerText), title && title.innerText);
    try { p.sb.localStorage.setItem('Tiny Yurts', '77'); } catch (e) {}
    check('saved best score is actually written (through gifos.db)', p.puts.some((r) => r.id === 'prefs' && r.score === '77'), p.puts);
  }
  {
    const portrait = bootPage({ w: 390, h: 844 });
    const land = bootPage({ w: 1024, h: 600 });
    const board = (b) => b.doc.querySelectorAll('svg').find((s) => (s.getAttribute('viewBox') || '').indexOf('0 0 208') === 0);
    const pb = board(portrait), lb = board(land);
    check('portrait uses meet so the valley is not cropped',
      !!pb && pb.getAttribute('preserveAspectRatio') === 'xMidYMid meet' && parseFloat(pb.style.height) <= 844 * 0.58 && !!lb && lb.getAttribute('preserveAspectRatio') === 'xMidYMid slice',
      pb && pb.getAttribute('preserveAspectRatio'));
    check('the board cannot be pan-stolen from under a drag', !!pb && pb.style.touchAction === 'none');
    // TEXT-CHECK: the page-wide gesture setting is CSS; only a browser applies it.
    check('…nor the page', /touch-action:\s*none/.test(fs.readFileSync(path.join(APP, 'style.css'), 'utf8')));
  }
  {
    const p = bootPage();
    await flushTY();
    const pause = p.doc.querySelectorAll('button').find((b) => b.style.width === '64px' && b.style.height === '64px');
    let paused = 0;
    if (pause) { pause.click = () => { paused++; }; pause.style.opacity = '1'; }
    const fn = p.back();
    const first = fn ? fn() : null, second = fn ? fn() : null;
    check('Back is registered and does not always swallow (in play it pauses once, then lets go)', !!pause && first === true && paused === 1 && second === false, { first, second, paused });
    if (pause) pause.style.opacity = '0';
    check('…and on the menu it lets the OS go back', fn && fn() === false);
  }
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const tags = [...html.matchAll(/<(button|a)\b([^>]*)>([^<]*)</gi)];
    check('Invite is OS chrome, not an in-app button',
      !/\bid=["']invite["']/i.test(html) && !tags.some((t) => /^\s*invite\s*$/i.test(t[3])));
  }
  // ---- listing facts that are data, not prose ----
  {
    const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
    check('tagline fits a store card', listing.tagline.length <= 120 && listing.tagline.length > 20);
    check('unofficial port of the named original',
      listing.basedOn && listing.basedOn.name === 'Tiny Yurts' && listing.basedOn.blessed === false);
    check('author is burntcustard, porter is GifOS',
      listing.author.name === 'burntcustard' && listing.porter.name === 'GifOS');
  }
  console.log(failures ? failures + ' FAILURES' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
