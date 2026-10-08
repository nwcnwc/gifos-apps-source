// SERVER SURVIVAL HAS TO PLACE, TICK, AND SAVE.
//
// The original is a GitHub Pages game on a three.js CDN, Tailwind's Play CDN
// and a 12 MB soundtrack. This copy vendors all of that. The hunt for the
// port: a wave can be started, a phone can place/upgrade, the tutorial is
// skippable, the memory localStorage shim is NOT the save (gifos.db is),
// and nothing hits a CDN at load.
//
// The whole page runs here: index.html's own <script src> list (shim, three,
// the 21k-line game, app.js) in a vm over a fake DOM built from index.html's
// ids, a WebGL stub, fake timers and a hand-driven animation frame. The suite
// taps the board, plays frames, presses Skip and Back, and reads STATE, the
// DOM and gifos.db. Layout questions are answered by resolving style.css.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const shimJs = read('shim.js');
const appJs = read('app.js');

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
  ['floor', 'ceil', 'round', 'abs', 'min', 'max', 'hypot', 'atan2', 'sin', 'cos',
    'sqrt', 'imul', 'pow', 'log', 'exp', 'tan', 'acos', 'asin', 'atan'].forEach((k) => { m[k] = Math[k]; });
  m.PI = Math.PI; m.SQRT2 = Math.SQRT2;
  return m;
}

// ---- PLAY the save path: shim hydrates gifos.db into LS before the game reads it
function memoryStore() {
  const mem = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
    key: (i) => Object.keys(mem)[i] || null,
    get length() { return Object.keys(mem).length; }
  };
}

function el(id) {
  const attrs = Object.create(null);
  const cls = new Set();
  const style = { display: '', transform: '', left: '', right: '', top: '', bottom: '', maxWidth: '', maxHeight: '', overflowY: '' };
  const node = {
    id: id || '',
    tagName: 'DIV',
    style,
    className: '',
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => { if (on === undefined) { if (cls.has(c)) cls.delete(c); else cls.add(c); } else if (on) cls.add(c); else cls.delete(c); }
    },
    children: [],
    innerHTML: '',
    innerText: '',
    textContent: '',
    value: '',
    hidden: false,
    setAttribute(k, v) { attrs[String(k)] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    addEventListener() {},
    removeEventListener() {},
    click() {},
    appendChild(n) { node.children.push(n); return n; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  if (id === 'load-btn') style.display = 'none';
  if (id === 'btn-share-link') style.display = 'none';
  return node;
}

function fakeDom() {
  const byId = Object.create(null);
  const htmlEl = el('html');
  const doc = {
    documentElement: htmlEl,
    body: el('body'),
    hidden: false,
    getElementById: (id) => {
      if (!byId[id]) byId[id] = el(id);
      return byId[id];
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag) => el(tag),
    createEvent: (t) => ({ initEvent() {}, key: '' })
  };
  doc.body.appendChild = () => {};
  return { doc, byId, htmlEl };
}

async function playSavePath() {
  const { doc, htmlEl } = fakeDom();
  const store = {};
  const db = {
    get: (id) => Promise.resolve(store[id] || null),
    put: (row) => { store[row.id] = JSON.parse(JSON.stringify(row)); return Promise.resolve(); }
  };
  const ls = memoryStore();
  const sandbox = {
    console, Math: seededMath(1), Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setTimeout, clearTimeout,
    localStorage: ls,
    sessionStorage: memoryStore(),
    document: doc,
    window: null,
    gifos: { db: () => db, onBack: (fn) => { sandbox.__onBack = fn; } }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.gifos = sandbox.gifos;
  sandbox.window.document = doc;
  sandbox.window.localStorage = ls;
  sandbox.window.innerWidth = 390;
  sandbox.window.innerHeight = 844;
  sandbox.window.addEventListener = () => {};
  // A previous session saved a last run, the tutorial flag and sound prefs.
  store.last = {
    id: 'last',
    keys: {
      serverSurvivalSave: JSON.stringify({ version: '2.0', money: 777, reputation: 88 }),
      game_locale: 'en',
      serverSurvivalTutorialComplete: 'true',
      serverSurvivalSoundPrefs: JSON.stringify({ musicMuted: true, sfxMuted: true })
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(shimJs, sandbox, { filename: 'shim.js' });
  check('shim hands the game a ready promise to wait on', !!sandbox.__ssReady && typeof sandbox.__ssReady.then === 'function');
  await sandbox.__ssReady;   // the SHIM's own hydrate, not a copy of it
  check('hydrated last-run is in the memory LS (game can Continue)',
    ls.getItem('serverSurvivalSave') !== null && ls.getItem('serverSurvivalSave').indexOf('777') !== -1);
  check('hydrated tutorial-complete flag is in LS so the tutorial is not a brick wall on return',
    ls.getItem('serverSurvivalTutorialComplete') === 'true');

  vm.runInContext(appJs, sandbox, { filename: 'app.js' });
  await new Promise((r) => setTimeout(r, 20));
  ls.setItem('serverSurvivalSave', JSON.stringify({ version: '2.0', money: 4242 }));
  await new Promise((r) => setTimeout(r, 500));
  check('app.js persist writes gifos.db, not only the memory shim',
    !!(store.last && store.last.keys && store.last.keys.serverSurvivalSave &&
      store.last.keys.serverSurvivalSave.indexOf('4242') !== -1),
    store.last && store.last.keys && Object.keys(store.last.keys));
  check('ss-narrow class is set on a 390×844 viewport',
    htmlEl.classList.contains('ss-narrow'));
  check('Copy Link stays display:none after boot',
    doc.getElementById('btn-share-link').style.display === 'none');
}

// ---- the whole page, booted -------------------------------------------------
function fakeGL() {
  const noop = () => 1;
  return new Proxy({
    getParameter: (p) => (p === 7938 ? 'WebGL 2.0' : p === 35724 ? 'WebGL GLSL ES 3.00' : 16),
    getShaderPrecisionFormat: () => ({ rangeMin: 1, rangeMax: 1, precision: 23 }),
    getContextAttributes: () => ({ alpha: true, antialias: true }),
    getExtension: () => new Proxy({}, { get: () => noop }),
    getSupportedExtensions: () => [],
    getProgramParameter: (p, k) => (k === 35718 || k === 35721 ? 0 : true),
    getShaderParameter: () => true, getProgramInfoLog: () => '', getShaderInfoLog: () => '',
    checkFramebufferStatus: () => 36053, isContextLost: () => false,
  }, { get: (t, p) => (p in t ? t[p] : () => ({})) });
}

// Every element in index.html with an id becomes a node carrying its classes,
// inline display and inline onclick; any other id the game asks for is made
// on demand. Methods the game calls but this suite does not observe are no-ops.
const NOOP_METHODS = ['removeEventListener', 'removeAttribute', 'removeChild', 'insertBefore', 'append', 'prepend', 'remove', 'focus', 'blur', 'scrollIntoView', 'replaceChildren', 'setPointerCapture', 'releasePointerCapture'];
function bootPage(opts) {
  opts = opts || {};
  const byId = Object.create(null);
  const net = [];
  function El(tag, attrs) {
    attrs = attrs || {};
    const cls = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const listeners = {};
    const style = { setProperty() {}, removeProperty() {}, display: '' };
    const sm = /display\s*:\s*([\w-]+)/.exec(attrs.style || ''); if (sm) style.display = sm[1];
    const o = {
      tagName: String(tag || 'div').toUpperCase(), id: attrs.id || '', attrs, style, dataset: {}, children: [], childNodes: [], listeners,
      classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
      innerHTML: '', textContent: '', innerText: '', value: '', checked: false, disabled: false, hidden: false,
      offsetWidth: 100, offsetHeight: 40, clientWidth: 390, clientHeight: 600, scrollTop: 0,
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, hasAttribute: (k) => k in attrs,
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
      click: () => { if (attrs.onclick) vm.runInContext(attrs.onclick, win); (listeners.click || []).forEach((f) => f({ preventDefault() {}, stopPropagation() {} })); },
      appendChild: (c) => { o.children.push(c); return c; },
      querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [], getElementsByClassName: () => [], closest: () => null, contains: () => false, matches: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600, x: 0, y: 0 }),
      cloneNode: () => El(tag), getContext: () => null,
    };
    Object.defineProperty(o, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); } });
    return new Proxy(o, { get: (t, k) => (k in t ? t[k] : NOOP_METHODS.includes(k) ? () => {} : undefined) });
  }
  const html = read('index.html');
  html.replace(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g, (m, tag, a) => {
    const attrs = {}; a.replace(/([\w-]+)(?:="([^"]*)")?/g, (mm, k, v) => { attrs[k] = v === undefined ? '' : v; return mm; });
    if (attrs.id) byId[attrs.id] = El(tag, attrs);
    return m;
  });
  const canvas = () => {
    const c = El('canvas'); c.width = 390; c.height = 600;
    c.getContext = (t) => (/webgl/.test(String(t)) ? fakeGL() : new Proxy({ measureText: () => ({ width: 0 }), getImageData: () => ({ data: [] }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (t2, k) => (k in t2 ? t2[k] : () => {}) }));
    return c;
  };
  const docL = {};
  const htmlEl = El('html'), body = El('body');
  const document = {
    documentElement: htmlEl, body, hidden: false, readyState: 'complete',
    getElementById: (id) => byId[id] || (byId[id] = El('div', { id })),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, fn) => { (docL[t] = docL[t] || []).push(fn); }, removeEventListener() {},
    createElement: (t) => (String(t).toLowerCase() === 'canvas' ? canvas() : El(t)),
    createElementNS: (ns, t) => (String(t).toLowerCase() === 'canvas' ? canvas() : El(t)),
    createTextNode: (t) => ({ textContent: t }),
    createEvent: () => ({ initEvent(type) { this.type = type; } }),
    dispatchEvent: (e) => { (docL[e.type] || []).forEach((f) => f(e)); return true; },
  };
  const timers = [];
  const win = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    Math: seededMath(3), Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, TypeError, Map, Set, WeakMap, Symbol, Reflect, Proxy,
    parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, RegExp, encodeURIComponent, decodeURIComponent, URL,
    Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, ArrayBuffer, DataView,
    setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0 }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { win.__raf = fn; return 1; }, cancelAnimationFrame() {},
    performance: { now: () => 1000 },
    navigator: { userAgent: 'node', maxTouchPoints: 5, language: 'en' },
    location: { href: 'https://app.example/', search: '', hash: '' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    innerWidth: opts.w || 390, innerHeight: opts.h || 844, devicePixelRatio: 1,
    document,
    Image: function () { return El('img'); },
    Audio: function () { return { play: () => Promise.resolve(), pause() {}, addEventListener() {} }; },
    AudioContext: function () {
      const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      this.state = 'running'; this.currentTime = 0; this.destination = {}; this.resume = () => Promise.resolve();
      this.createGain = () => ({ gain: param(), connect() {} });
      this.createOscillator = () => ({ frequency: param(), connect() {}, start() {}, stop() {}, type: '' });
      this.createBufferSource = () => ({ connect() {}, start() {}, stop() {} });
      this.createBuffer = () => ({ getChannelData: () => new Float32Array(10) });
      this.createBiquadFilter = () => ({ frequency: param(), Q: param(), connect() {} });
    },
    Event: function (t) { this.type = t; }, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    KeyboardEvent: function (t, o) { Object.assign(this, o || {}); this.type = t; },
    HTMLCanvasElement: function () {}, HTMLElement: function () {}, Element: function () {}, Node: function () {},
    ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    IntersectionObserver: function () { this.observe = () => {}; },
    Blob: function () {}, FileReader: function () {},
    // The network, watched: any use is recorded and refused.
    fetch: (u) => { net.push(['fetch', String(u)]); return Promise.reject(new Error('offline')); },
    XMLHttpRequest: function () { net.push(['xhr']); this.open = () => {}; this.send = () => {}; },
    WebSocket: function (u) { net.push(['ws', String(u)]); },
    gifos: opts.gifos,
  };
  win.window = win; win.self = win; win.globalThis = win; win.top = win; win.parent = win;
  const winL = {};
  win.addEventListener = (t, fn) => { (winL[t] = winL[t] || []).push(fn); };
  win.removeEventListener = () => {};
  win.dispatchEvent = (e) => { (winL[e.type] || []).forEach((f) => f(e)); return true; };
  win.webkitAudioContext = win.AudioContext;
  vm.createContext(win);
  // Run the page's OWN script list, in the page's order.
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  for (const f of scripts) vm.runInContext(read(f), win, { filename: f });
  let t = 2000;
  return {
    win, document, htmlEl, byId: (id) => byId[id], scripts, net, timers,
    STATE: () => win.STATE,
    frames: (n) => { for (let i = 0; i < n; i++) { t += 100; if (win.__raf) win.__raf(t); } },
    runTimers: () => { for (let k = 0; k < 5 && timers.length; k++) timers.splice(0).forEach((x) => { try { x.fn(); } catch (e) {} }); },
    tap: (x, y) => (byId['canvas-container'].listeners.touchstart || []).forEach((f) => f({ touches: [{ clientX: x, clientY: y }], preventDefault() {} })),
  };
}
const flushP = () => new Promise((r) => setImmediate(r));
function memDb(seed) {
  const store = Object.assign({}, seed || {});
  return { store, get: (id) => Promise.resolve(store[id] ? JSON.parse(JSON.stringify(store[id])) : null), put: (r) => { store[r.id] = JSON.parse(JSON.stringify(r)); return Promise.resolve(); } };
}

async function playPage() {
  // ---- a fresh device: nothing saved ----
  {
    const db = memDb(); let back = null;
    const P = bootPage({ gifos: { db: () => db, onBack: (f) => { back = f; } } });
    check('index.html loads shim, then three, then the game, then app.js', P.scripts.join(',') === 'shim.js,vendor/three.min.js,vendor/game.js,app.js', P.scripts);
    check('the page boots: the game exposes startGame / setTool / STATE', typeof P.win.startGame === 'function' && typeof P.win.setTool === 'function' && !!P.STATE());
    await flushP(); P.runTimers();
    check('Continue Game is hidden until a save exists', P.byId('load-btn').style.display === 'none');
    check('Copy Link (in-app share) is hidden after boot (Invite is OS chrome)', P.byId('btn-share-link').style.display === 'none');
    check('ss-narrow is set on a 390x844 phone', P.htmlEl.classList.contains('ss-narrow'));
    check('Back on the menu with nothing open returns false (the OS may leave)', !!back && back() === false);

    // Sandbox: a tap on the ground with a tool places it; the same tool on it upgrades.
    P.win.startSandbox();
    P.frames(2);
    P.win.setTool('lambda');
    const m0 = P.STATE().money;
    P.tap(150, 250);
    const svc = P.STATE().services[0];
    check('a finger tap on the ground places the tool (touchstart)', P.STATE().services.length === 1 && !!svc && svc.type === 'compute');
    check('placing spends money', !!svc && P.STATE().money < m0, { m0, now: P.STATE().money, fin: P.STATE().finances && P.STATE().finances.expenses.services });
    P.frames(2);
    const tier0 = svc && svc.tier, m1 = P.STATE().money;
    P.tap(150, 250);
    check('the same tool tapped on it upgrades it, and nothing new is placed', !!svc && svc.tier === tier0 + 1 && P.STATE().services.length === 1 && P.STATE().money < m1, { tier: svc && svc.tier, tier0 });
    P.win.setTool('waf');
    P.tap(150, 250);
    check('a different tool on an occupied cell places nothing', P.STATE().services.length === 1);

    // Survival: the tutorial comes up on a first run; Skip ends it and remembers.
    P.win.startGame();
    P.runTimers();
    check('a first survival run starts the tutorial', P.win.tutorial && P.win.tutorial.isActive === true);
    P.byId('tutorial-skip').click();
    check('Skip tutorial ends it', P.win.tutorial.isActive === false && P.win.localStorage.getItem('serverSurvivalTutorialComplete') === 'true');
    P.runTimers(); await flushP();
    const saved = db.store.last && db.store.last.keys;
    check('the skip is saved in gifos.db, so the next visit does not teach again', !!saved && saved.serverSurvivalTutorialComplete === 'true', saved && Object.keys(saved));
    // The wave: requests spawn while running.
    P.win.setTimeScale(1);
    P.frames(60);
    const failed = Object.values(P.STATE().failuresByReason || {}).reduce((a, b) => a + b, 0);
    check('a running survival wave spawns requests every tick', P.STATE().requests.length + failed >= 3 && P.STATE().elapsedGameTime > 5, { requests: P.STATE().requests.length, failed, t: P.STATE().elapsedGameTime });
    // Back mid-run: a snapshot is saved and the pause menu is asked for.
    let esc = 0; P.document.addEventListener('keydown', (e) => { if (e.key === 'Escape') esc++; });
    const r = back();
    P.runTimers(); await flushP();
    check('Back mid-run pauses (Escape) and reports it handled the press', r === true && esc === 1);
    check('Back mid-run leaves a resumable run in gifos.db', !!(db.store.last && db.store.last.keys && db.store.last.keys.serverSurvivalSave));
    check('nothing in a whole session touches the network (fetch / XHR / WebSocket)', P.net.length === 0, P.net);
  }
  // ---- a returning device: a save exists ----
  {
    const db = memDb({ last: { id: 'last', keys: { serverSurvivalSave: JSON.stringify({ version: '2.0', money: 1 }), serverSurvivalSoundPrefs: JSON.stringify({ musicMuted: false, sfxMuted: true }) } } });
    const P = bootPage({ gifos: { db: () => db, onBack() {} } });
    await flushP(); P.runTimers();
    check('Continue Game shows once a save exists', P.byId('load-btn').style.display === 'block');
    check('saved sound prefs reach the game (defaults are the other way round)', P.STATE().sound.musicMuted === false && P.STATE().sound.sfxMuted === true);
  }
  // ---- a desktop ----
  {
    const P = bootPage({ w: 1280, h: 900, gifos: { db: () => memDb(), onBack() {} } });
    await flushP(); P.runTimers();
    check('ss-narrow is not set on a 1280x900 desktop', !P.htmlEl.classList.contains('ss-narrow'));
  }
}

// ---- the stylesheet, resolved per element -----------------------------------
function cssResolve() {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = []; let order = 0;
  (function scan(text, media) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i); if (open < 0) break;
      const head = text.slice(i, open).trim(); let d = 1, k = open + 1;
      while (k < text.length && d) { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; }
      const inner = text.slice(open + 1, k - 1);
      if (head.startsWith('@media')) scan(inner, head.slice(6).trim());
      else if (!head.startsWith('@')) for (const sel of head.split(',')) rules.push({ sel: sel.trim(), body: inner, media, order: order++ });
      i = k;
    }
  })(css, null);
  const mediaOk = (q, w) => !q || (q.match(/\(([^)]+)\)/g) || []).every((f) => { const [k, v] = f.slice(1, -1).split(':').map((x) => x.trim()); return k === 'max-width' ? w <= parseFloat(v) : k === 'min-width' ? w >= parseFloat(v) : false; });
  const simple = (n, part) => { const m = part.match(/^([a-z]+)?((?:[.#][\w-]+)*)$/i); if (!m) return false; if (m[1] && n.tag !== m[1].toLowerCase()) return false; return (m[2].match(/[.#][\w-]+/g) || []).every((t) => (t[0] === '#' ? n.id === t.slice(1) : n.cls.indexOf(t.slice(1)) >= 0)); };
  const matches = (n, sel) => { const toks = sel.split(/\s+/); if (!simple(n, toks[toks.length - 1])) return false; let i = toks.length - 2; for (let a = n.parent; a && i >= 0; a = a.parent) if (simple(a, toks[i])) i--; return i < 0; };
  const spec = (sel) => (sel.match(/#/g) || []).length * 100 + (sel.match(/\./g) || []).length * 10 + (sel.match(/(^|\s)[a-z]/gi) || []).length;
  return (n, prop, w) => {
    let best = null;
    for (const r of rules) {
      if (!mediaOk(r.media, w) || !matches(n, r.sel)) continue;
      const m = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(r.body); if (!m) continue;
      const imp = /!important/.test(m[1]); const sp = spec(r.sel) + (imp ? 10000 : 0);
      if (!best || sp > best.sp || (sp === best.sp && r.order > best.order)) best = { v: m[1].replace('!important', '').trim(), sp, order: r.order };
    }
    return best && best.v;
  };
}

(async () => {
  await playSavePath();
  await playPage();

  {
    const resolve = cssResolve();
    const node = (tag, id, cls, parent) => ({ tag, id: id || '', cls: cls || [], parent: parent || null });
    const phoneRoot = node('html', '', ['ss-narrow']);
    const deskRoot = node('html', '', []);
    const panel = (root, id) => node('div', id, [], node('body', '', [], root));
    check('on a phone the stacked panels collapse (details, health, metrics, finances, objectives)',
      ['detailsPanel', 'healthPanel', 'metricsPanel', 'financesPanel', 'objectivesPanel'].every((id) => resolve(panel(phoneRoot, id), 'display', 390) === 'none'));
    check('on a desktop those panels are not collapsed', ['detailsPanel', 'healthPanel'].every((id) => resolve(panel(deskRoot, id), 'display', 1280) !== 'none'));
    const row = (root) => node('div', '', ['flex', 'ss-desk-only'], panel(root, 'statsPanel'));
    check('phone stats hide desk-only rows so the board is tappable', resolve(row(phoneRoot), 'display', 390) === 'none' && resolve(row(deskRoot), 'display', 1280) !== 'none');
    check('the board takes touch-action: none, so a drag is a pan, not a page scroll', resolve(node('div', 'canvas-container', [], node('body', '', [], deskRoot)), 'touch-action', 390) === 'none');
  }

  // Offline: every file index.html loads ships in the app; no modules.
  {
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    const refs = [];
    html.replace(/<(script|link)\b([^>]*)>/gi, (m, tag, attrs) => { const a = /\b(src|href)=["']([^"']+)["']/.exec(attrs); refs.push({ ref: a ? a[2] : null, module: /type=["']module["']/i.test(attrs) }); return m; });
    const missing = refs.filter((r) => r.ref && !fs.existsSync(path.join(APP, r.ref)));
    check('every file index.html loads ships inside the app (no CDN)', refs.filter((r) => r.ref).length >= 5 && missing.length === 0, missing);
    check('index.html has no type=module', refs.every((r) => !r.module));
  }

  // TEXT-CHECK: an absence guarantee over all 21k lines of the game, including
  // paths no suite reaches (campaign, uploads). The session above runs with a
  // network spy; this keeps the guarantee for the paths it does not run.
  {
    const gameJs = read('vendor/game.js');
    check('game.js has no fetch / XHR / WebSocket anywhere', !/\bfetch\(/.test(gameJs) && !/XMLHttpRequest/.test(gameJs) && !/new WebSocket/.test(gameJs));
  }

  // The build refuses a CDN: run build.mjs's own index.html guard on the real
  // page (passes) and on the page with a CDN stylesheet added (refused).
  {
    const build = read('build.mjs');
    const scriptsLine = (build.match(/const SCRIPTS = \[[^\]]*\];/) || [''])[0];
    const a = build.indexOf("const html = files['index.html'];");
    const b = build.indexOf('\n', build.indexOf("throw new Error('CDN')"));
    const guard = a >= 0 && b > a ? build.slice(a, b) : '';
    const runGuard = (html) => { try { new Function('files', scriptsLine + '\n' + guard)({ 'index.html': html }); return 'ok'; } catch (e) { return e.message; } };
    const real = read('index.html');
    check('the build guard passes the shipped page', !!guard && runGuard(real) === 'ok', runGuard(real));
    const cdn = real.replace('</head>', '<!-- --><link rel="stylesheet" href="//cdn.tailwindcss.com/x.css"></head>');
    check('build.mjs refuses a CDN in packed HTML', !!guard && runGuard(cdn) !== 'ok', runGuard(cdn));
  }

  if (failures) {
    console.log(failures + ' FAIL');
    process.exit(1);
  }
  console.log('ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
