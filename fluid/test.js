// Fluid: one page, no fetch, settings + a still in the file, honest GPU.
//
// The patched simulation (vendor/script.js) and the shell (app.js) are run in
// a vm on a tiny DOM built from index.html, with a recording stand-in for the
// WebGL context, dat.GUI and gifos. The checks drive them — no GPU, a slow
// phone, a capture, Back, a reload — and assert what happened, not wording.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APP = __dirname;
const lift = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

const read = lift;
const help = read('help.md');
const listing = JSON.parse(read('listing.json'));
const manifest = JSON.parse(read('manifest.json'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, f))).digest('hex');

check('script.js is the pinned patch',
  sha('vendor/script.js') === '212086dcc8cb170ef6984f325822b0c4d37ea7c6c899b25b501cf848fa40368f');
check('dat.gui is the pinned MIT copy',
  sha('vendor/dat.gui.min.js') === '27976ca8ac2e125de97163455131890e8686ed2afc2007cd5524080b7d53ef7b');

// ---- a tiny DOM built from the app's own index.html (test scaffolding) ----
function miniDom(html, hooks) {
  hooks = hooks || {};
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const doc = { listeners: {}, hidden: false, readyState: 'complete' };
  function on(target) {
    target.listeners = target.listeners || {};
    target.addEventListener = (t, fn) => { (target.listeners[t] = target.listeners[t] || []).push(fn); };
    target.removeEventListener = (t, fn) => { target.listeners[t] = (target.listeners[t] || []).filter((f) => f !== fn); };
    target.dispatchEvent = (ev) => {
      if (!ev.target) ev.target = target;
      ev.currentTarget = target;
      if (!ev.preventDefault) { ev.defaultPrevented = false; ev.preventDefault = () => { ev.defaultPrevented = true; }; }
      if (!ev.stopPropagation) ev.stopPropagation = () => { ev.stopped = true; };
      (target.listeners[ev.type] || []).slice().forEach((fn) => fn.call(target, ev));
      return !ev.defaultPrevented;
    };
    target.fire = (type, init) => target.dispatchEvent(Object.assign({ type }, init || {}));
  }
  function el(tag, attrs) {
    const e = { tagName: tag.toUpperCase(), attrs: Object.assign({}, attrs || {}), children: [], parentNode: null, style: {}, _text: '' };
    on(e);
    const cls = new Set(String(e.attrs.class || '').split(/\s+/).filter(Boolean));
    e.classList = {
      add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
      contains: (c) => cls.has(c),
      toggle: (c, f) => { const want = f === undefined ? !cls.has(c) : !!f; if (want) cls.add(c); else cls.delete(c); return want; },
    };
    Object.defineProperty(e, 'className', { get: () => [...cls].join(' '), set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); } });
    e.id = e.attrs.id || '';
    e.hidden = 'hidden' in e.attrs;
    e.value = e.attrs.value || '';
    e.type = e.attrs.type || '';
    e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k === 'id') e.id = String(v); };
    e.hasAttribute = (k) => k in e.attrs;
    e.appendChild = (c) => { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = e; e.children.push(c); return c; };
    e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; return c; };
    Object.defineProperty(e, 'textContent', {
      get: () => e._text + e.children.map((c) => c.textContent).join(''),
      set: (v) => { e.children.forEach((c) => { c.parentNode = null; }); e.children = []; e._text = String(v); },
    });
    Object.defineProperty(e, 'innerHTML', {
      get: () => e._html || '',
      set: (v) => { e.children = []; e._text = ''; e._html = String(v); parseInto(e, String(v)); },
    });
    e.click = () => e.dispatchEvent({ type: 'click' });
    e.focus = () => {}; e.blur = () => {}; e.select = () => {};
    e.setPointerCapture = (id) => { e.captured = id; };
    e.releasePointerCapture = () => {};
    e.getBoundingClientRect = () => (hooks.rect ? hooks.rect(e) : { left: 0, top: 0, width: 100, height: 100 });
    e.querySelectorAll = (sel) => all(e).filter((x) => x !== e && matches(x, sel));
    e.querySelector = (sel) => e.querySelectorAll(sel)[0] || null;
    if (e.tagName === 'CANVAS') {
      e.width = +(e.attrs.width || 300); e.height = +(e.attrs.height || 150);
      e.getContext = (kind) => (hooks.context ? hooks.context(e, kind) : null);
      e.toDataURL = (mime) => 'data:' + (mime || 'image/png') + ';base64,QUJD';
      e.toBlob = (cb, mime) => cb({ type: mime || 'image/png', size: 3 });
    }
    if (hooks.decorate) hooks.decorate(e);
    return e;
  }
  function all(root) { const out = [root]; root.children.forEach((c) => out.push(...all(c))); return out; }
  function matches(x, sel) {
    return sel.split(',').some((s) => {
      s = s.trim();
      const m = /^([a-zA-Z0-9]*)(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\])?$/.exec(s);
      if (!m) throw new Error('miniDom selector not supported: ' + s);
      if (m[1] && x.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && x.id !== m[2]) return false;
      if (m[3] && !x.classList.contains(m[3])) return false;
      if (m[4] && !(m[4] in x.attrs)) return false;
      if (m[5] !== undefined && m[4] && x.attrs[m[4]] !== m[5]) return false;
      return true;
    });
  }
  function parseInto(parent, src) {
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
    const stack = [parent];
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[5] !== undefined) { if (m[5].trim()) top.appendChild(textNode(m[5])); continue; }
      if (!m[2]) continue;
      if (m[1]) { // close
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === m[2].toUpperCase()) { stack.length = i; break; }
        continue;
      }
      const attrs = {};
      const ar = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
      const node = el(m[2], attrs);
      top.appendChild(node);
      if (!VOID.test(m[2]) && !m[4]) stack.push(node);
    }
  }
  function textNode(t) { return { nodeType: 3, textContent: t, children: [], parentNode: null }; }
  const rootEl = el('#root');
  parseInto(rootEl, html);
  const body = all(rootEl).find((x) => x.tagName === 'BODY') || rootEl;
  on(doc);
  doc.documentElement = all(rootEl).find((x) => x.tagName === 'HTML') || rootEl;
  doc.body = body;
  doc.getElementById = (id) => all(rootEl).find((x) => x.id === id) || null;
  doc.querySelectorAll = (sel) => all(rootEl).filter((x) => x !== rootEl && matches(x, sel));
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
  doc.createElement = (tag) => el(tag, {});
  doc.createTextNode = textNode;
  doc.createEvent = () => ({ initEvent(t) { this.type = t; } });
  doc.execCommand = () => false;
  doc.all = () => all(rootEl);
  return doc;
}

// A WebGL context that accepts every call: constants are numbers, objects
// are tokens, every status query says "fine". Enough for script.js to build
// its programs, framebuffers and loop without a GPU.
function fakeGL() {
  const K = {};
  let n = 1;
  const konst = (name) => (K[name] = K[name] || 0x1000 + n++);
  const methods = {
    getExtension: (name) => ({ HALF_FLOAT_OES: konst('HALF_FLOAT_OES'), name }),
    checkFramebufferStatus: () => konst('FRAMEBUFFER_COMPLETE'),
    getShaderParameter: () => true,
    getProgramParameter: (p, which) => (which === konst('ACTIVE_UNIFORMS') ? 0 : true),
    getActiveUniform: () => ({ name: 'u' }),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  };
  return new Proxy({}, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(k)) return konst(k);
      if (methods[k]) return methods[k];
      return () => ({ token: k });
    },
  });
}

// One booted page: script.js then app.js, as index.html orders them.
function boot(opts) {
  opts = opts || {};
  let now = 1000;
  let rafs = [];
  const timers = [];
  const intervals = [];
  const net = { fetch: 0, xhr: 0, beacon: 0, eval: 0, imageSrcs: [] };
  const doc = miniDom(lift('index.html'), {
    context: (c, kind) => {
      if (kind === '2d') return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {} };
      if (opts.noGL) return null;
      return kind === 'webgl2' ? fakeGL() : null;
    },
    decorate: (e) => { if (e.tagName === 'CANVAS') { e.clientWidth = 400; e.clientHeight = 300; } },
  });
  doc.getElementsByTagName = (t) => doc.querySelectorAll(t);
  // dat.GUI stand-in: records controllers so the test can press them.
  const gui = { closed: false, controllers: [], close() { this.closed = true; }, open() { this.closed = false; } };
  function Ctl(obj, prop) { this.obj = obj; this.prop = prop; gui.controllers.push(this); }
  ['name', 'step', 'listen'].forEach((m) => { Ctl.prototype[m] = function (v) { if (m === 'name') this.label = v; return this; }; });
  Ctl.prototype.onFinishChange = function (fn) { this.done = fn; return this; };
  const folder = { add: (o, p) => new Ctl(o, p), addColor: (o, p) => new Ctl(o, p), addFolder: () => folder };
  function GUI() { Object.assign(this, folder); this.gui = gui; return Object.assign(gui, folder); }
  const dbs = {};
  const puts = [];
  function store(name) {
    const rows = Object.assign({}, (opts.seed || {})[name] || {});
    return dbs[name] = dbs[name] || {
      put(r) { puts.push({ db: name, row: JSON.parse(JSON.stringify(r)) }); rows[r.id] = r; return Promise.resolve(); },
      get(id) { return Promise.resolve(rows[id] || null); },
    };
  }
  let back = null;
  function FakeImage() {}
  Object.defineProperty(FakeImage.prototype, 'src', { set(v) { net.imageSrcs.push(String(v)); this._src = v; }, get() { return this._src; } });
  const sb = {
    console: { log() {}, warn() {}, error() {}, trace() {} },
    Math, Object, Array, JSON, String, Number, Boolean, Promise, Error, RegExp, parseInt, parseFloat, isNaN,
    Float32Array, Uint8Array, Uint8ClampedArray, Uint16Array, Int32Array,
    Date: Object.assign(function () { return new Date(now); }, { now: () => now }),
    navigator: { userAgent: opts.mobile ? 'Mozilla/5.0 (Linux; Android 14) Mobile' : 'Mozilla/5.0 (X11; Linux x86_64)', sendBeacon: () => { net.beacon++; } },
    devicePixelRatio: opts.dpr || 1,
    document: doc, Image: FakeImage, dat: { GUI },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    fetch: () => { net.fetch++; return new Promise(() => {}); },
    XMLHttpRequest: function () { net.xhr++; this.open = () => {}; this.send = () => {}; },
    eval: () => { net.eval++; },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (id) timers[id - 1] = null; },
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    gifos: opts.noApi ? undefined : { db: store, onBack: (fn) => { back = fn; } },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  const wl = {};
  sb.addEventListener = (t, fn) => { (wl[t] = wl[t] || []).push(fn); };
  vm.createContext(sb);
  let threw = null;
  try { vm.runInContext(lift('vendor/script.js'), sb, { filename: 'script.js' }); } catch (e) { threw = e; }
  // Count GPU rebuilds the shell asks for.
  let applied = 0;
  if (typeof sb.FluidApply === 'function') { const real = sb.FluidApply; sb.FluidApply = function () { applied++; return real(); }; }
  let appThrew = null;
  try { vm.runInContext(lift('app.js'), sb, { filename: 'app.js' }); } catch (e) { appThrew = e; }
  const $ = (id) => doc.getElementById(id);
  return {
    sb, doc, $, gui, puts, net, threw, appThrew, applied: () => applied, back: () => back,
    canvas: doc.querySelector('canvas'),
    // Advance the clock `ms` per frame for `n` frames of the real update loop.
    frames(n, ms) { for (let i = 0; i < n; i++) { now += ms; const q = rafs; rafs = []; q.forEach((f) => f()); } },
    flushTimers() { while (timers.some(Boolean)) { const i = timers.findIndex(Boolean); const f = timers[i]; timers[i] = null; f(); } },
    tickIntervals() { intervals.forEach((f) => f()); },
    saves() { return puts.filter((p) => p.db === 'save'); },
  };
}
const settle = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r)); };

async function main() {
  // No WebGL: the sim marks FluidNoGL instead of throwing; the shell says so.
  {
    const A = boot({ noGL: true });
    check('WebGL miss sets FluidNoGL instead of throwing', !A.threw && A.sb.FluidNoGL === true, A.threw && String(A.threw));
    check('no WebGL shows the nogl sentence and hides the hint', !A.appThrew && A.$('nogl').hidden === false && A.$('hint').hidden === true);
  }

  // With a GPU: the sim runs, loads nothing from the network, and its dither
  // texture is decoded from a data URL.
  const A = boot();
  await settle();
  check('with WebGL the simulation boots', !A.threw && !A.appThrew && A.sb.FluidNoGL === false,
    String(A.threw || A.appThrew || ''));
  A.frames(5, 16);
  check('script.js and app.js never fetch, XHR, beacon or eval',
    A.net.fetch === 0 && A.net.xhr === 0 && A.net.beacon === 0 && A.net.eval === 0, A.net);
  check('dither texture is a data URL, not a fetch',
    A.net.imageSrcs.length >= 1 && A.net.imageSrcs.every((u) => /^data:image\/png;base64,/.test(u)), A.net.imageSrcs.map((u) => u.slice(0, 40)));

  // Settings and a still go in the private save collection as id last.
  A.flushTimers();
  let s = A.saves();
  check('settings persist privately as id last', s.length >= 1 && s[s.length - 1].row.id === 'last' &&
    s[s.length - 1].row.DYE_RESOLUTION != null && !!s[s.length - 1].row.BACK_COLOR, s.map((x) => x.row));
  A.sb.FluidConfig.PAUSED = true;
  A.tickIntervals();
  A.flushTimers();
  s = A.saves();
  check('a paused swirl leaves a still in the file', /^data:image\/jpeg/.test(s[s.length - 1].row.snap || ''), s[s.length - 1].row);
  A.sb.FluidConfig.PAUSED = false;

  // Capture: the panel's screenshot button writes the picture into the file.
  const shot = A.gui.controllers.find((c) => c.label === 'take screenshot');
  check('the panel has a screenshot control', !!shot);
  const before = A.saves().length;
  if (shot) shot.obj[shot.prop]();
  check('Capture says it was saved', A.$('note').hidden === false && !!A.$('note').textContent);
  A.flushTimers();
  s = A.saves();
  check('Capture writes into the file', s.length > before && /^data:image\/png/.test(s[s.length - 1].row.snap || '') && !!s[s.length - 1].row.snapAt, s[s.length - 1] && s[s.length - 1].row);

  // A panel change is saved too.
  const quality = A.gui.controllers.find((c) => c.prop === 'DYE_RESOLUTION');
  A.sb.FluidConfig.DYE_RESOLUTION = 128;
  const n0 = A.saves().length;
  if (quality && quality.done) quality.done();
  A.flushTimers();
  s = A.saves();
  check('changing quality in the panel is saved', s.length > n0 && s[s.length - 1].row.DYE_RESOLUTION === 128);

  // Back: an open panel closes first; a closed panel leaves Back to GifOS.
  const back = A.back();
  check('onBack is wired', typeof back === 'function');
  A.gui.closed = false;
  check('Back closes an open panel', back && back() === true && A.gui.closed === true);
  check('Back with the panel closed is left to GifOS', back && back() === false);

  // The hint goes away on the first touch of the page.
  check('the hint shows on a fresh page', !A.$('hint').classList.contains('gone'));
  A.doc.dispatchEvent({ type: 'pointerdown' });
  check('hint hides after a drag', A.$('hint').classList.contains('gone'));

  // Slow frames step quality down; quick frames do not.
  {
    const F = boot();
    await settle();
    F.frames(120, 16);
    check('quick frames keep full quality', F.sb.FluidConfig.BLOOM === true && F.sb.FluidConfig.DYE_RESOLUTION > 256, F.sb.FluidConfig.DYE_RESOLUTION);
    const S = boot();
    await settle();
    const a0 = S.applied();
    S.frames(60, 120);
    const c = S.sb.FluidConfig;
    check('slow frames step quality down', c.DYE_RESOLUTION <= 256 && c.SIM_RESOLUTION <= 64 && !c.BLOOM && !c.SUNRAYS && !c.SHADING && S.applied() > a0,
      { dye: c.DYE_RESOLUTION, sim: c.SIM_RESOLUTION, bloom: c.BLOOM, applied: S.applied() - a0 });
    check('the drop in quality is told', S.$('note').hidden === false && !!S.$('note').textContent);
  }

  // Pixel ratio: capped at 2 on a desktop, 1.5 on a phone.
  {
    const D = boot({ dpr: 3 });
    const M = boot({ dpr: 3, mobile: true });
    check('pixel ratio is capped at 2', D.canvas.width === 800, D.canvas.width);
    check('pixel ratio is capped at 1.5 on phones', M.canvas.width === 600, M.canvas.width);
  }

  // A reload restores the saved settings, rebuilds the GPU side, shows the still.
  {
    const R = boot({ seed: { save: { last: { id: 'last', DYE_RESOLUTION: 256, BLOOM: false, BACK_COLOR: { r: 10, g: 20, b: 30 }, snap: 'data:image/jpeg;base64,QUJD' } } } });
    const a0 = R.applied();
    await settle();
    const c = R.sb.FluidConfig;
    check('saved quality is restored onto FluidConfig', c.DYE_RESOLUTION === 256);
    check('saved bloom-off is restored', c.BLOOM === false);
    check('saved background colour is restored', c.BACK_COLOR.r === 10 && c.BACK_COLOR.b === 30);
    check('restore calls FluidApply so the GPU rebuilds', R.applied() > a0);
    check('the saved still is shown until the first touch', R.$('lastStill').hidden === false && R.$('lastStill').src === 'data:image/jpeg;base64,QUJD');
    R.doc.dispatchEvent({ type: 'touchstart' });
    check('the still hides on the first touch', R.$('lastStill').hidden === true);
  }

  // ---- the shipped page and its data -------------------------------------
  const doc = miniDom(lift('index.html'));
  const scripts = doc.querySelectorAll('script').map((x) => x.getAttribute('src'));
  check('index.html loads dat.gui, script, app — in that order',
    JSON.stringify(scripts) === JSON.stringify(['vendor/dat.gui.min.js', 'vendor/script.js', 'app.js']), scripts);
  check('scripts are classic', doc.querySelectorAll('script').every((x) => x.getAttribute('type') !== 'module'));
  const refs = doc.all().map((e) => e.attrs && (e.attrs.src || e.attrs.href)).filter(Boolean);
  check('the page links nothing outside the app (no store badges, no CDN)',
    refs.length >= 4 && refs.every((r) => !/^([a-z]+:)?\/\//i.test(r)), refs);
  // TEXT-CHECK: help.md is reader text; the rule (no internals jargon, a real page) is about that text.
  check('help.md is the OS Help, a real page with no internals jargon', help.trim().length > 400 && !/gifos\.db/.test(help));
  check('listing is an unofficial port, author is them',
    listing.basedOn && listing.basedOn.blessed === false && !/gifos/i.test(listing.author.name)
    && listing.basedOn.url.indexOf('PavelDoGreat/WebGL-Fluid-Simulation') >= 0);
  // TEXT-CHECK: the listing is reader text; the rule (no internals jargon) is about that text.
  check('listing does not mention internals',
    !/gifos\.db|WASM|sandbox|WebRTC|localStorage/.test(JSON.stringify(listing)));
  check('manifest: db, minBuild 947, no network',
    manifest.capabilities.db === true && manifest.minBuild === 947 && !manifest.capabilities.network
    && manifest.data.save.visibility === 'private');
}

main().catch((e) => check('harness ran', false, e && e.stack)).then(() => {
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nall ok');
});
