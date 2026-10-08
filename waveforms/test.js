// WAVEFORMS HAS TO TEACH AND PLAY.
//
// The store copy is an explorable: sine / square / saw, harmonics you can
// hear assembling, a place in the guide that lives in the file. This suite
// PLAYS that loop in a vm — math, save round-trip, launch-to-a-step — and
// boots the page to press Hear, the shape chips and Back.
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
    Float32Array, Uint8Array,
    document: {
      readyState: 'complete',
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    requestAnimationFrame: () => 0,
    addEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/waveform.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const S = load();
const M = S.WaveformMath;
const A = S.WaveformsApp;
check('waveform math and app load', !!(M && A && A.STEPS && A.STEPS.length >= 10));

{
  check('sine at 0 is rest', M.getPositionAtPointRelativeToAxis('sine', 1, 1, 0) === 0);
  const peak = M.getPositionAtPointRelativeToAxis('sine', 1, 1, 25);
  check('sine peaks at +1 a quarter cycle in', Math.abs(peak - 1) < 1e-9, peak);
  check('square is high then low',
    M.getPositionAtPointRelativeToAxis('square', 1, 1, 10) === 1 &&
    M.getPositionAtPointRelativeToAxis('square', 1, 1, 60) === -1);
  const saw0 = M.getPositionAtPointRelativeToAxis('sawtooth', 1, 1, 0);
  const saw99 = M.getPositionAtPointRelativeToAxis('sawtooth', 1, 1, 99);
  check('saw runs −1 → +1 across a cycle', Math.abs(saw0 + 1) < 1e-9 && saw99 > 0.9, { saw0, saw99 });
  const tri = M.getPositionAtPointRelativeToAxis('triangle', 1, 1, 25);
  check('triangle peaks at +1', Math.abs(tri - 1) < 1e-9, tri);
}

{
  const sqH = M.getHarmonicsForWave('square', 1, 1, 2);
  check('square harmonics are 3× and 5×', sqH[0].frequency === 3 && sqH[1].frequency === 5, sqH);
  const sawH = M.getHarmonicsForWave('sawtooth', 1, 1, 3);
  check('saw harmonics are 2× 3× 4×',
    sawH[0].frequency === 2 && sawH[1].frequency === 3 && sawH[2].frequency === 4, sawH);
  check('a sine has no extras', M.getHarmonicsForWave('sine', 1, 1, 8).length === 0);
  const mixed = M.applyWaveformAddition(
    [{ x: 0, y: 1 }, { x: 1, y: 1 }],
    [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
    1
  );
  check('converge 1 replaces the fundamental with the stack', mixed[0].y === 0);
  const none = M.applyWaveformAddition(
    [{ x: 0, y: 1 }],
    [[{ x: 0, y: 0 }]],
    0
  );
  check('converge 0 keeps the fundamental', none[0].y === 1);
}

{
  A.loadRecord({ step: 10, amp: 0.5, freq: 2, shape: 'square', harm: 8, conv: 0.65, vol: 0.4 });
  const st = A.getState();
  check('saved square lesson reloads', st.step === 10 && st.shape === 'square' && st.harm === 8, st);
  check('saved amp/freq/vol reload', st.amp === 0.5 && st.freq === 2 && st.vol === 0.4, st);
  const rec = A.toRecord();
  check('toRecord keeps the gifos.db id and the same keys the current version wrote',
    rec.id === 'state' && rec.step === 10 && rec.shape === 'square' && rec.harm === 8);
  A.loadRecord({ step: 99, amp: 9, freq: 0, shape: 'nope', harm: -1, conv: 4, vol: 2 });
  const bad = A.getState();
  check('a corrupt save is clamped, not a crash',
    bad.step === A.STEPS.length - 1 && bad.shape !== 'nope' && bad.amp === 1, bad);
}

{
  A.loadRecord({ step: 0, amp: 1, freq: 1, shape: 'sine', harm: 0, conv: 0, vol: 0 });
  A.applyLaunch({ step: 'square' });
  check('launch step=square opens the square lesson', A.getState().step === 10, A.getState());
  A.applyLaunch({ step: 13, shape: 'saw' });
  check('launch step=13 (1-indexed) is sawtooth', A.getState().step === 12, A.getState());
  check('launch shape=saw aliases sawtooth', A.getState().shape === 'sawtooth', A.getState());
}

{
  A.loadRecord({ step: 10, amp: 1, freq: 1, shape: 'square', harm: 4, conv: 0.5, vol: 0 });
  const pack = A.pointsFor(64, 0);
  check('pointsFor draws a mixed square when harmonics are on',
    pack.mixed.length > 10 && pack.extras.length === 4, { mixed: pack.mixed.length, extras: pack.extras.length });
  const tab = A.harmonicTable('square', 4, 1);
  check('the audible table has the 3rd and 5th harmonic',
    tab.imag[3] > 0 && tab.imag[5] > 0, { h3: tab.imag[3], h5: tab.imag[5] });
  check('audible Hz is the slow graph × 110 (1 cycle → 110 Hz)', A.audibleHz(1) === 110);
  check('4 cycles is 440 Hz — an A4', A.audibleHz(4) === 440);
}

{
  const ids = A.STEPS.map((s) => s.id);
  check('the walk-through still has air, square, saw, and an end',
    ids.indexOf('air') >= 0 && ids.indexOf('square') >= 0 && ids.indexOf('saw') >= 0 && ids.indexOf('end') >= 0, ids);
  const air = A.STEPS.filter((s) => s.air);
  check('exactly one air-molecule step', air.length === 1);
  const harmSteps = A.STEPS.filter((s) => s.harm);
  check('harmonics show up for square/triangle/saw', harmSteps.length >= 3);
}

// ---- the page, booted -------------------------------------------------------
// index.html over a small DOM, its own scripts in order, a recording Web
// Audio and a fake gifos.db. Hear, the shape chips, Back and the save are
// used; every network and code-loading door is a trap.
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

function bootWave() {
  const audio = { started: 0, gains: [] };
  function FakeAC() {
    const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime(v) { audio.gains.push(v); } });
    this.state = 'running'; this.currentTime = 0; this.destination = {};
    this.createGain = () => ({ gain: param(), connect() {} });
    this.createBiquadFilter = () => ({ type: '', frequency: param(), connect() {} });
    this.createOscillator = () => ({ frequency: param(), type: 'sine', connect() {}, start() { audio.started++; }, setPeriodicWave() {} });
    this.createPeriodicWave = () => ({});
  }
  const traps = [];
  const trap = (name) => function () { traps.push(name); throw new Error(name + ' is not allowed here'); };
  const puts = []; let back = null;
  const timers = [];
  const dom = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), { globals: {
    AudioContext: FakeAC, fetch: trap('fetch'), XMLHttpRequest: trap('XMLHttpRequest'), WebSocket: trap('WebSocket'), eval: trap('eval'), Function: trap('Function'),
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    gifos: { db: () => ({ get: () => Promise.resolve(null), put: (r) => { puts.push(r); return Promise.resolve(); } }), onBack: (fn) => { back = fn; } },
  } });
  dom.win.navigator.mediaDevices = { getUserMedia: trap('getUserMedia') };
  let error = null;
  const srcs = dom.scripts.filter((s) => s.src).map((s) => s.src);
  try { for (const f of srcs) dom.run(fs.readFileSync(path.join(APP, f), 'utf8'), f); } catch (e) { error = e; }
  return { dom, audio, traps, puts, timers, back: () => back, error, srcs, A: dom.win.WaveformsApp, $: (id) => dom.document.getElementById(id) };
}
(async () => {
  const P = bootWave();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  check('the page boots: classic scripts in page order, none a module', !P.error && !!P.A && P.dom.document.querySelectorAll('script').every((s) => (s.attrs.type || '') !== 'module'), P.error && String(P.error));
  {
    const hear = P.$('hearBtn');
    check('Hear is a real button, not a slider the thumb misses', !!hear && hear.tagName === 'BUTTON');
    if (hear) { hear.dispatch('pointerdown'); hear.click(); }
    check('…and pressing it starts a tone you can hear', P.audio.started === 1 && P.A.getState().vol > 0 && P.audio.gains.some((g) => g > 0), { started: P.audio.started, vol: P.A.getState().vol });
  }
  {
    const row = P.$('shapeRow');
    const chip = row ? row.querySelectorAll('[data-shape]').find((c) => c.getAttribute('data-shape') === 'square') : null;
    check('shape chips exist for a thumb (not only a <select>)', !!chip && chip.tagName === 'BUTTON');
    if (row && chip) row.dispatch('click', { target: chip });
    check('…and tapping one changes the wave and marks the chip', P.A.getState().shape === 'square' && chip && chip.getAttribute('aria-pressed') === 'true', P.A.getState().shape);
  }
  {
    const fn = P.back();
    P.$('nextBtn').click(); P.$('nextBtn').click();
    const at = P.A.getState().step;
    const stepped = fn && fn();
    check('gifos.onBack steps the guide back one step', stepped === true && P.A.getState().step === at - 1, { at, now: P.A.getState().step });
    while (P.A.getState().step > 0) fn();
    check('…and at the first step lets the OS go back', fn && fn() === false);
  }
  {
    P.puts.length = 0;
    P.$('nextBtn').click();
    P.timers.splice(0).forEach((f) => f());
    const rec = P.puts[P.puts.length - 1];
    check('gifos.db save is the file: your place in the guide is written', !!rec && rec.step === P.A.getState().step && rec.shape === P.A.getState().shape, rec);
  }
  check('no eval / Function / fetch / getUserMedia / XHR / WebSocket in a whole session', P.traps.length === 0, P.traps);
  // TEXT-CHECK: a forbidden API anywhere in app.js; execution covers the paths driven above.
  check('…nor named anywhere in app.js', !/eval\(|new Function\(|fetch\(|getUserMedia|XMLHttpRequest|WebSocket/.test(fs.readFileSync(path.join(APP, 'app.js'), 'utf8')));
  {
    const els = P.dom.document.querySelectorAll('*');
    check('no Invite button in the app chrome', !els.some((e) => /invite/i.test(e.id) || ((e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*invite\s*$/i.test(e.textContent))));
    check('no CDN / remote at load (every src and href is a file in the GIF)', els.every((e) => !/^(https?:)?\/\//i.test(e.attrs.src || '') && !/^(https?:)?\/\//i.test(e.attrs.href || '')));
  }
  // TEXT-CHECK: layout and fit are CSS and a viewport meta; only a browser
  // applies them. The parsed meta and stylesheet are read.
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const vp = (html.match(/<meta\b[^>]*name="viewport"[^>]*>/) || [''])[0];
    check('viewport-fit for a phone', /(^|[\s,"])viewport-fit=cover/.test((vp.match(/content="([^"]*)"/) || [])[1] || ''));
    check('buttons are 44px tall', /min-height:\s*44px/.test(css));
    check('nav is sticky on a phone', /position:\s*fixed/.test(css) && /bottom:\s*0/.test(css));
    check('graph stays on screen while you read', /position:\s*sticky/.test(css));
    check('[hidden] wins over display:grid so the walk-through can reveal controls', /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
    check('no webfont import', !/@import|fonts\.google|typekit/i.test(css));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  check('manifest is solo + private save + launch-to-a-step',
    manifest.capabilities.db === true &&
    !manifest.capabilities.multiplayer &&
    manifest.data.save.visibility === 'private' &&
    !!(manifest.launch && manifest.launch.step) &&
    manifest.minBuild === 947);
  if (failures) {
    console.log('\n' + failures + ' failed');
    process.exit(1);
  }
  console.log('\nAll PASS lines above — waveforms core loop holds.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
