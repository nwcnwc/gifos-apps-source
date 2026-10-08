// DUCK HUNT HAS TO SAVE A SCORE AND STAY IN THE GIF.
//
// The vendored Pixi game wrote a best-score helper that nothing ever called,
// replay assigned window.location.pathname (a srcdoc walk), and Invite was a
// presence count. This suite plays the SHELL — score in, best out, replay
// does not navigate — and runs the vendor's own Game methods for the hooks.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function fakeDom() {
  const nodes = {};
  function el(id) {
    if (!nodes[id]) {
      nodes[id] = {
        id: id, hidden: false, disabled: true, textContent: '',
        addEventListener: () => {},
        classList: { add() {}, remove() {}, toggle() {} },
      };
    }
    return nodes[id];
  }
  return {
    getElementById: el,
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
    addEventListener: () => {},
    _nodes: nodes,
  };
}

function load(savedRow, roomRows) {
  const puts = [];
  const document = fakeDom();
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setTimeout: (fn) => { fn(); return 1; },
    document,
    window: null,
    gifos: {
      db: (name) => ({
        get: () => Promise.resolve(name === 'save' ? savedRow : null),
        put: (row) => { puts.push({ name: name, row: row }); return Promise.resolve(); },
        subscribe: (cb) => { if (name === 'room') cb(roomRows || []); },
      }),
      me: () => Promise.resolve({ id: 'me1', name: 'Pat' }),
      onBack: (fn) => { sandbox._onBack = fn; },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'boot.js'), 'utf8'), sandbox, { filename: 'boot.js' });
  return { sandbox, puts, document };
}

// ---- the save that shipped dead ---------------------------------------------
{
  const { sandbox } = load(null, []);
  const DH = sandbox.DHSave;
  check('boot.js attaches DHSave', !!(DH && DH.onScore && DH.replay && DH.onEnd));
  DH.onScore(400);
  check('a score becomes last AND best', DH.prefs.last === 400 && DH.prefs.best === 400, DH.prefs);
  DH.onScore(200);
  check('a worse score keeps the best', DH.prefs.best === 400 && DH.prefs.last === 200, DH.prefs);
  DH.onScore(900);
  check('a better score raises the best', DH.prefs.best === 900, DH.prefs);
}

async function runAsync() {
  const { sandbox, puts, document } = load({ id: 'save', best: 700, last: 300 }, []);
  const DH = sandbox.DHSave;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  check('a saved best comes back', DH.prefs.best === 700, DH.prefs);
  check('Play is enabled once the save loads', document.getElementById('gate-go').disabled === false);

  DH.onEnd(false, 1200);
  await new Promise((r) => setImmediate(r));
  const savePuts = puts.filter((p) => p.name === 'save');
  check('onEnd writes the best into the file', savePuts.some((p) => p.row.best === 1200), savePuts.map((p) => p.row));
  const roomPuts = puts.filter((p) => p.name === 'room');
  check('onEnd publishes the pond row', roomPuts.some((p) => p.row.best === 1200 && p.row.id === 'me1'), roomPuts.map((p) => p.row));

  let loc = 'about:srcdoc';
  sandbox.window.location = loc;
  document.getElementById('gate').hidden = true;
  check('onBack while playing returns to the gate', typeof sandbox._onBack === 'function' && sandbox._onBack() === true);
  check('replay does not assign window.location', sandbox.window.location === loc, sandbox.window.location);
  check('replay shows the gate again', document.getElementById('gate').hidden === false);
  check('onBack on the gate is not swallowed', sandbox._onBack() === false);
}

// ---- pond board -------------------------------------------------------------
{
  const { document } = load(null, [
    { id: 'a', name: 'Ada', best: 500 },
    { id: 'b', name: 'Bob', best: 900 },
  ]);
  const pond = document.getElementById('pond');
  check('two people at the pond un-hide the board', pond.hidden === false);
  check('the pond lists the higher best first', /Bob 900/.test(pond.textContent) && /Ada 500/.test(pond.textContent), pond.textContent);
}

// ---- vendor hooks, RUN ------------------------------------------------------
// The vendored game is a webpack bundle around Pixi; booting it needs WebGL.
// Its Game class methods are lifted out of the bundle (the occurrence nearest
// DuckHuntStart, which is the Game class) and called on a stand-in `this`,
// with the bundle's module-scope names (ra: the sound player, Ga: layout)
// stubbed. What they do to window.DHSave, the stage and window.location is
// the assertion.
// ---- lifting real functions out of a source file ---------------------------
// matchBrace(text, open): index of the '}' that closes the '{' at `open`,
// skipping strings, template literals, comments and regex literals.
function matchBrace(text, open) {
  let depth = 0;
  const regexOk = (k) => { let b = k - 1; while (b >= 0 && /\s/.test(text[b])) b--; if (b < 0) return true; if ('(,=:[!&|?{};+-*%<>~^'.indexOf(text[b]) >= 0) return true; const w = text.slice(Math.max(0, b - 9), b + 1); return /(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new)$/.test(w); };
  for (let k = open; k < text.length; k++) {
    const c = text[k];
    if (c === '{') { depth++; continue; }
    if (c === '}') { if (--depth === 0) return k; continue; }
    if (c === '"' || c === "'") { for (k++; k < text.length && text[k] !== c; k++) if (text[k] === '\\') k++; continue; }
    if (c === '`') {
      for (k++; k < text.length && text[k] !== '`'; k++) {
        if (text[k] === '\\') { k++; continue; }
        if (text[k] === '$' && text[k + 1] === '{') k = matchBrace(text, k + 1);
      }
      continue;
    }
    if (c === '/' && text[k + 1] === '/') { while (k < text.length && text[k] !== '\n') k++; continue; }
    if (c === '/' && text[k + 1] === '*') { k = text.indexOf('*/', k + 2) + 1; continue; }
    if (c === '/' && regexOk(k)) { let cls = false; for (k++; k < text.length; k++) { const d = text[k]; if (d === '\\') { k++; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; } continue; }
  }
  return -1;
}

const vendor = fs.readFileSync(path.join(APP, 'vendor/duckhunt.js'), 'utf8');
const START = vendor.indexOf('window.DuckHuntStart=');
function gameMethod(key, kind) {
  const k = kind === 'set' ? '{key:"' + key + '",get:function' : '{key:"' + key + '",value:function';
  let i = vendor.lastIndexOf(k, START);
  if (i < 0) return null;
  if (kind === 'set') i = vendor.indexOf('set:function', i) - 1; else i += k.length - 'function'.length - 1;
  const f = vendor.indexOf('function', i);
  const close = matchBrace(vendor, vendor.indexOf('{', f));
  return close < 0 ? null : vendor.slice(f, close + 1);
}
function bind(src, scope) {
  const names = Object.keys(scope);
  return new Function(...names, 'return (' + src + ');')(...names.map((n) => scope[n]));
}
function vendorWindow() {
  const calls = [];
  const win = { DHSave: new Proxy({}, { get: (t, k) => (...a) => calls.push([k, a]) }), opened: [] };
  let loc = 'about:srcdoc';
  Object.defineProperty(win, 'location', { get: () => loc, set: (v) => { calls.push(['navigate', [v]]); loc = v; } });
  win.open = (...a) => calls.push(['open', a]);
  return { win, calls };
}
const ra = { play() {}, pause() {}, mute() {} };
{
  const { win, calls } = vendorWindow();
  const setScore = gameMethod('score', 'set');
  const self = { stage: null };
  if (setScore) bind(setScore, { window: win }).call(self, 400);
  check('vendor calls DHSave.onScore (the score setter reports the score)', calls.some(([k, a]) => k === 'onScore' && a[0] === 400), calls);
}
{
  const ends = [];
  for (const key of ['win', 'loss']) {
    const { win, calls } = vendorWindow();
    const src = gameMethod(key);
    if (src) bind(src, { window: win, ra }).call({ score: 1200, showReplay() {}, getScoreMessage() { return ''; } });
    const e = calls.find(([k]) => k === 'onEnd');
    ends.push(e && e[1]);
  }
  check('vendor calls DHSave.onEnd on win and loss', ends[0] && ends[0][0] === true && ends[0][1] === 1200 && ends[1] && ends[1][0] === false && ends[1][1] === 1200, ends);
}
function clickGame(stage, extra) {
  const { win, calls } = vendorWindow();
  const src = gameMethod('handleClick');
  const shots = [];
  const self = Object.assign({
    paused: false, bullets: 3, level: { radius: 60 }, stage: Object.assign({
      clickedPauseLink: () => false, clickedMuteLink: () => false, clickedFullscreenLink: () => false, clickedLevelCreatorLink: () => false,
      clickedReplay: () => false, hud: {}, shotsFired: (e, r) => { shots.push(r); return 0; },
    }, stage), outOfAmmo: () => false, shouldWaveEnd: () => false, updateScore() {}, pause() { calls.push(['game.pause', []]); }, mute() {}, fullscreen() {},
  }, extra || {});
  self.openLevelCreator = bind(gameMethod('openLevelCreator'), { window: win });
  bind(src, { window: win, ra }).call(self, Object.assign({ clientX: 10, clientY: 10, pointerType: 'mouse' }, (extra || {}).ev));
  return { calls, shots };
}
{
  const r = clickGame({ hud: { replayButton: 'x Play Again?' }, clickedReplay: () => true });
  check('vendor replay does not navigate', !r.calls.some(([k]) => k === 'navigate' || k === 'open'), r.calls);
  check('vendor replay calls DHSave.replay()', r.calls.some(([k]) => k === 'replay'), r.calls);
  const c = clickGame({ clickedLevelCreatorLink: () => true });
  check('no creator.html escape: the level-creator link only pauses', !c.calls.some(([k]) => k === 'navigate' || k === 'open') && c.calls.some(([k]) => k === 'game.pause'), c.calls);
  const touch = clickGame({}, { ev: { pointerType: 'touch' } });
  const mouse = clickGame({}, { ev: { pointerType: 'mouse' } });
  check('touch shots get extra radius', touch.shots[0] === 88 && mouse.shots[0] === 60, { touch: touch.shots, mouse: mouse.shots });
}
{
  const win = {};
  const inst = { loaded: 0, load() { this.loaded++; } };
  const i = START + 'window.DuckHuntStart='.length;
  const src = vendor.slice(i, matchBrace(vendor, vendor.indexOf('{', i)) + 1);
  const start = bind(src, { window: win, Za: function () { return inst; } });
  const g = start();
  check('DuckHuntStart stores the game', win.__DHGame === inst && g === inst && inst.loaded === 1);
}
{
  const hud = { createTextBox() {} };
  bind(gameMethod('addPauseLink'), { Ga: { pauseLinkBoxLocation: () => ({}) }, Ka: {} }).call({ stage: { hud } });
  check('canvas no longer paints a pause hint (the pause link text is empty)', hud.pauseLink === '', hud.pauseLink);
}

// ---- the page: the phone buttons drive the game -----------------------------
// ---- a small DOM, built from the app's own index.html -----------------------
// Elements carry ids, classes, data-*, hidden, value/checked, listeners and a
// no-op 2D context; scripts named by <script src> run in one vm context in
// page order. Enough to boot an app and click it; nothing is painted.
function fakeDomPage(htmlText, opts) {
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

{
  const dom = fakeDomPage(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), { globals: { gifos: undefined } });
  dom.run(fs.readFileSync(path.join(APP, 'boot.js'), 'utf8'), 'boot.js');
  const did = [];
  dom.win.__DHGame = { mute() { did.push('mute'); }, pause() { did.push('pause'); } };
  const mute = dom.document.getElementById('btn-mute'), pause = dom.document.getElementById('btn-pause');
  if (mute) mute.click();
  if (pause) pause.click();
  check('phone mute/pause buttons drive the game', !!mute && !!pause && did.join() === 'mute,pause', did);
  const els = dom.document.querySelectorAll('*');
  check('Invite is OS chrome, not an in-app button',
    !els.some((e) => /invite/i.test(e.id) || ((e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*invite\s*$/i.test(e.textContent))));
}
{
  // TEXT-CHECK: touch-action is a browser gesture setting; only a browser
  // honours it. The parsed stylesheet is read for the canvas rule.
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const decl = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some((x) => x.trim() === 'canvas')) for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  check('canvas touch-action none (phone aim)', decl['touch-action'] === 'none', decl);
}
{
  const man = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  // TEXT-CHECK: a trademark rule for the store text; the words are the deliverable.
  const listing = fs.readFileSync(path.join(APP, 'listing.json'), 'utf8');
  const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  check('listing does not say Nintendo', !/Nintendo/.test(listing) && !/Nintendo/.test(help) && !/Nintendo/.test(html));
  check('multiplayer + db declared', man.capabilities.db === true && man.capabilities.multiplayer === true);
  check('no network/wasm', !man.capabilities.network && !man.capabilities.wasm);
  check('minBuild stays 947', man.minBuild === 947);
}

runAsync().then(function () {
  if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exit(1);
  }
  console.log('\nAll duck-hunt checks passed.');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
