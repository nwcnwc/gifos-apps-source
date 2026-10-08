// SANDSPIEL HAS TO POUR, AND THE FILE HAS TO BE THE WORLD.
//
// The store copy is a falling-sand toy. A vm can step the species tick
// (sand piles, water finds a way down, lava and water make stone, fire
// dies in water) without a browser. The pouring engine is wasm32 compiled
// from apps/sandspiel/vendor/kernel.c and packed inside the GIF; Node can
// instantiate that same object file. The shell (pour with a finger, the
// world kept in the file, the fail sentences, Back, the meeting wall) is
// driven through the real wasm.js + app.js + wall.js on a tiny DOM built
// from index.html: the checks touch the controls and assert what happened.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const os = require('os');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

const lift = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const src = lift;

function loadSpecies() {
  const sandbox = {
    console, Math, Uint8Array, Uint8ClampedArray, Array, String, Number, Date, Object,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(lift('species.js'), sandbox, { filename: 'species.js' });
  return sandbox;
}

const G = loadSpecies();
const S = G.Sandspiel;
const Sp = S.Species;
check('species.js loads Sandspiel', !!(S && S.Universe && Sp && Sp.Sand === 2 && Sp.Water === 3));

{
  const u = new S.Universe(6, 6);
  u.setCell(2, 2, S.makeCell(Sp.Sand, 120, 0));
  u.tick();
  check('sand falls one cell', u.getCell(2, 3).species === Sp.Sand && u.getCell(2, 2).species === Sp.Empty);
}

{
  const u = new S.Universe(4, 6);
  u.setCell(1, 1, S.makeCell(Sp.Water, 120, 0));
  u.tick();
  check('water falls one cell', u.getCell(1, 2).species === Sp.Water);
}

{
  const u = new S.Universe(6, 8);
  u.setCell(2, 2, S.makeCell(Sp.Sand, 120, 0));
  u.setCell(2, 3, S.makeCell(Sp.Water, 120, 0));
  u.setCell(1, 3, S.makeCell(Sp.Wall, 80, 0));
  u.setCell(3, 3, S.makeCell(Sp.Wall, 80, 0));
  u.tick();
  check('sand sinks through water', u.getCell(2, 3).species === Sp.Sand && u.getCell(2, 2).species === Sp.Water);
  for (let t = 0; t < 12; t++) u.tick();
  let sandY = -1, waterY = -1;
  for (let x = 0; x < 6; x++) for (let y = 0; y < 8; y++) {
    if (u.getCell(x, y).species === Sp.Sand) sandY = Math.max(sandY, y);
    if (u.getCell(x, y).species === Sp.Water) waterY = Math.max(waterY, y);
  }
  check('after a pour, sand rests below water', sandY >= waterY && sandY >= 0, { sandY, waterY });
}

{
  const u = new S.Universe(5, 5);
  u.setCell(2, 2, S.makeCell(Sp.Lava, 140, 0));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
    if (x || y) u.setCell(2 + x, 2 + y, S.makeCell(Sp.Water, 120, 0));
  }
  let stone = false;
  for (let t = 0; t < 40; t++) {
    u.tick();
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      if (u.getCell(x, y).species === Sp.Stone) stone = true;
    }
    if (stone) break;
  }
  check('lava and water make stone', stone);
}

{
  const u = new S.Universe(5, 5);
  u.setCell(2, 2, S.makeCell(Sp.Fire, 200, 0));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
    if (x || y) u.setCell(2 + x, 2 + y, S.makeCell(Sp.Water, 120, 0));
  }
  let fireGone = false;
  for (let t = 0; t < 40; t++) {
    u.tick();
    let f = false;
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      if (u.getCell(x, y).species === Sp.Fire) f = true;
    }
    if (!f) { fireGone = true; break; }
  }
  check('fire dies in water', fireGone);
}

{
  const u = new S.Universe(8, 8);
  u.setCell(4, 6, S.makeCell(Sp.Sand, 120, 0));
  u.setCell(4, 5, S.makeCell(Sp.Plant, 140, 0));
  let plant = false;
  for (let t = 0; t < 80; t++) {
    u.tick();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      if (u.getCell(x, y).species === Sp.Plant) plant = true;
    }
  }
  check('a plant cell is still a plant after ticks', plant);
}

{
  const u = new S.Universe(8, 8);
  u.setCell(4, 4, S.makeCell(Sp.Wall, 80, 0));
  u.paint(4, 4, 1, Sp.Sand);
  check('paint does not overwrite wall', u.getCell(4, 4).species === Sp.Wall);
  u.paint(3, 4, 1, Sp.Sand);
  check('paint fills empty', u.getCell(3, 4).species === Sp.Sand);
  u.paint(4, 4, 1, Sp.Empty);
  check('erase clears wall', u.getCell(4, 4).species === Sp.Empty);
}

{
  const u = new S.Universe(4, 3);
  u.setCell(1, 1, S.makeCell(Sp.Sand, 120, 3));
  u.setCell(2, 0, S.makeCell(Sp.Water, 90, 6));
  const packed = S.packCells(u.cells);
  const cells2 = S.unpackCells(packed, 4 * 3);
  check('pack roundtrip length', cells2.length === 12);
  check('pack roundtrip sand', cells2[u.index(1, 1)].species === Sp.Sand && cells2[u.index(1, 1)].ra === 120);
  check('pack roundtrip water', cells2[u.index(2, 0)].species === Sp.Water && cells2[u.index(2, 0)].rb === 6);
  const raw = S.unpackRaw(packed, 12);
  check('unpackRaw matches pack', raw[u.index(1, 1) * 4] === Sp.Sand && raw[u.index(2, 0) * 4] === Sp.Water);
  u.pushUndo();
  u.reset();
  check('reset empties', u.getCell(1, 1).species === Sp.Empty);
  u.popUndo();
  check('undo restores sand', u.getCell(1, 1).species === Sp.Sand);
}

// WASM kernel — same pour, from the object file packed in the GIF.
async function stepWasm() {
  const srcC = path.join(APP, 'vendor', 'kernel.c');
  check('kernel.c is in the tree', fs.existsSync(srcC));
  const out = path.join(os.tmpdir(), 'sandspiel-unit-' + process.pid + '.wasm');
  const r = spawnSync('clang', [
    '--target=wasm32', '-nostdlib', '-O2', '-fno-builtin', '-ffreestanding',
    '-c', '-o', out, srcC,
  ], { encoding: 'utf8' });
  check('clang --target=wasm32 builds the kernel', r.status === 0, r.stderr);
  if (r.status !== 0 || typeof WebAssembly === 'undefined') return null;
  const bytes = fs.readFileSync(out);
  try { fs.unlinkSync(out); } catch (e) {}
  const mod = await WebAssembly.compile(bytes);
  const mem = new WebAssembly.Memory({ initial: 8 });
  const sp = new WebAssembly.Global({ value: 'i32', mutable: true }, 65536);
  const tab = new WebAssembly.Table({ initial: 8, element: 'anyfunc' });
  const env = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    if (i.module !== 'env') continue;
    if (i.kind === 'memory') env[i.name] = mem;
    if (i.kind === 'global') env[i.name] = sp;
    if (i.kind === 'table') env[i.name] = tab;
  }
  const inst = await WebAssembly.instantiate(mod, { env });
  const e = inst.exports;
  check('wasm exports tick/paint/init', !!(e.sand_tick && e.sand_paint && e.sand_init && e.sand_get));
  check('wasm grid is 180×120', e.sand_width() === 180 && e.sand_height() === 120);
  e.sand_init();
  e.sand_set(2, 2, Sp.Sand, 120, 0);
  e.sand_tick();
  check('wasm sand falls', (e.sand_get(2, 3) & 255) === Sp.Sand && (e.sand_get(2, 2) & 255) === Sp.Empty);
  e.sand_init();
  e.sand_set(1, 1, Sp.Water, 120, 0);
  e.sand_tick();
  check('wasm water falls', (e.sand_get(1, 2) & 255) === Sp.Water);
  e.sand_init();
  e.sand_set(2, 2, Sp.Sand, 120, 0);
  e.sand_set(2, 3, Sp.Water, 120, 0);
  e.sand_set(1, 3, Sp.Wall, 80, 0);
  e.sand_set(3, 3, Sp.Wall, 80, 0);
  e.sand_tick();
  check('wasm sand sinks through water', (e.sand_get(2, 3) & 255) === Sp.Sand && (e.sand_get(2, 2) & 255) === Sp.Water);
  e.sand_init();
  e.sand_set(4, 4, Sp.Wall, 80, 0);
  e.sand_paint(4, 4, 1, Sp.Sand);
  check('wasm paint does not overwrite wall', (e.sand_get(4, 4) & 255) === Sp.Wall);
  e.sand_paint(3, 4, 1, Sp.Sand);
  check('wasm paint fills empty', (e.sand_get(3, 4) & 255) === Sp.Sand);
  return bytes;
}

// ---- the shell, driven ------------------------------------------------------
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

const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };

// One booted copy of the app. `wasmB64` is the kernel compiled above (what
// build.mjs packs as wasm-bytes.js); without it the shell must fall back.
// The fake GifOS records every db call; opts.failPut makes save rejects.
function bootApp(opts) {
  opts = opts || {};
  const timers = [];
  let rafs = [];
  const ctx2d = () => ({
    putImageData() {}, drawImage() {},
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
  });
  const doc = miniDom(lift('index.html'), {
    context: (c, kind) => (opts.noCanvas || kind !== '2d' ? null : ctx2d()),
    rect: (e) => (e.id === 'world' ? { left: 0, top: 0, width: 180, height: 120 } : { left: 0, top: 0, width: 10, height: 10 }),
  });
  const log = [];
  const dbs = {};
  function store(name) {
    if (dbs[name]) return dbs[name];
    const rows = Object.assign({}, (opts.seed || {})[name] || {});
    const d = dbs[name] = {
      rows, subs: [],
      put(r) {
        log.push({ op: 'put', db: name, id: r.id, row: r });
        if (opts.failPut && name === 'save') return Promise.reject(new Error(''));
        rows[r.id] = r; d.subs.forEach((f) => f(Object.values(rows))); return Promise.resolve();
      },
      get(id) { log.push({ op: 'get', db: name, id }); return Promise.resolve(rows[id] || null); },
      getAll() { return Promise.resolve(Object.values(rows)); },
      delete(id) { log.push({ op: 'delete', db: name, id }); delete rows[id]; d.subs.forEach((f) => f(Object.values(rows))); return Promise.resolve(); },
      subscribe(f) { log.push({ op: 'subscribe', db: name }); d.subs.push(f); f(Object.values(rows)); },
    };
    return d;
  }
  let back = null;
  const api = {
    db: store,
    me: () => Promise.resolve({ id: 'u-wren', name: 'Wren Tamsin' }),
    info: () => Promise.resolve({ owner: true }),
    onBack: (fn) => { back = fn; },
  };
  const sb = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Error, RegExp,
    Uint8Array, Uint8ClampedArray, Float32Array, parseInt, parseFloat, isNaN,
    WebAssembly,
    btoa: (x) => Buffer.from(x, 'binary').toString('base64'),
    atob: (x) => Buffer.from(x, 'base64').toString('binary'),
    document: doc, gifos: api,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (id) timers[id - 1] = null; },
    setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    fetch: () => { throw new Error('fetch is not allowed'); },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  on(sb);
  vm.createContext(sb);
  vm.runInContext(lift('species.js'), sb, { filename: 'species.js' });
  if (opts.wasmB64) sb.SAND_WASM_B64 = opts.wasmB64;
  vm.runInContext(lift('wasm.js'), sb, { filename: 'wasm.js' });
  vm.runInContext(lift('app.js'), sb, { filename: 'app.js' });
  vm.runInContext(lift('wall.js'), sb, { filename: 'wall.js' });
  const $ = (id) => doc.getElementById(id);
  return {
    sb, doc, $, log, dbs, back: () => back, App: () => sb.SandApp,
    flushTimers() { while (timers.some(Boolean)) { const i = timers.findIndex(Boolean); const f = timers[i]; timers[i] = null; f(); } },
    frames(n) { for (let i = 0; i < n; i++) { const q = rafs; rafs = []; q.forEach((f) => f()); } },
    puts(id) { return log.filter((l) => l.op === 'put' && l.db === 'save' && (id == null || l.id === id)); },
    fail() { const f = $('fail'); return { shown: !f.hidden && !!f.textContent, sticky: f.classList.contains('sticky') }; },
    pour(x, y) {
      const w = $('world');
      const ev = { type: 'pointerdown', button: 0, pointerId: 7, clientX: x, clientY: y };
      w.dispatchEvent(ev);
      w.dispatchEvent({ type: 'pointerup', pointerId: 7 });
      return ev;
    },
  };
}
function on(t) { // window-level listeners for the vm global
  const ls = {};
  t.addEventListener = (ty, fn) => { (ls[ty] = ls[ty] || []).push(fn); };
  t.removeEventListener = () => {};
  t.dispatchEvent = (ev) => { (ls[ev.type] || []).forEach((fn) => fn(ev)); return true; };
}

async function shell(wasmBytes) {
  const b64 = wasmBytes ? Buffer.from(wasmBytes).toString('base64') : null;

  // The packed kernel boots with no fetch (fetch throws in this sandbox).
  if (b64) {
    const A = bootApp({ wasmB64: b64 });
    await settle();
    check('WASM boots from the packed bytes, no fetch', A.App().engine() === 'wasm' && !A.fail().shown,
      { engine: A.App().engine(), fail: A.$('fail').textContent });
  } else {
    check('WASM boots from the packed bytes, no fetch', false, 'no kernel bytes (clang failed above)');
  }

  // No packed kernel: a sentence, and the JS universe still pours.
  {
    const A = bootApp();
    await settle();
    check('WASM fail is a sentence, and the JS world still runs', A.App().engine() === 'js' && A.fail().shown && !A.fail().sticky,
      { engine: A.App().engine(), fail: A.$('fail').textContent });
    // First run: the tap hint shows; a pour hides it.
    check('empty first-run shows the tap hint', A.$('hint').hidden === false);
    const ev = A.pour(90, 60);
    const cell = A.App().universe().getCell(90, 60);
    check('phone pour: a finger on the world pours the chosen species there', cell.species === Sp.Water && ev.defaultPrevented, cell);
    check('phone pour: the pointer is captured', A.$('world').captured === 7);
    check('the hint goes away after the first pour', A.$('hint').hidden === true);
    // The world is kept in the file, as id last, after the pour settles.
    A.flushTimers();
    const last = A.puts('last');
    check('world persists in gifos.db save collection', last.length === 1 && !!last[0].row.cells && last[0].row.w === 180,
      last.map((l) => l.id));
    // The animation loop keeps the world without a write per frame.
    A.log.length = 0;
    for (let i = 0; i < 180; i++) { A.frames(1); A.flushTimers(); }
    check('persist is not every animation frame', A.puts().length >= 1 && A.puts().length <= 3, A.puts().length);
    // Leaving the page flushes at once — no timer needed.
    A.log.length = 0;
    A.sb.dispatchEvent({ type: 'pagehide' });
    check('persist on pagehide', A.puts('last').length === 1);
    A.log.length = 0;
    A.doc.hidden = true;
    A.doc.dispatchEvent({ type: 'visibilitychange' });
    check('persist when the page is hidden', A.puts('last').length === 1);
    // Named boards: Keep writes an n_ row in save and lists it.
    A.$('saveName').value = 'Dune Garden';
    A.$('keepBtn').click();
    await settle();
    const kept = A.puts().filter((l) => /^n_/.test(l.id));
    check('named boards also go in save', kept.length === 1 && kept[0].row.title === 'Dune Garden' && !!kept[0].row.cells, kept.map((k) => k.id));
    check('a kept board is listed to load again', A.$('saveList').querySelectorAll('button').length === 2);
    // Reset empties; the listed board loads the poured world back.
    A.$('resetBtn').click();
    check('Reset empties the world', A.App().universe().pack() === new S.Universe(180, 120).pack() && kept[0].row.cells !== new S.Universe(180, 120).pack());
    A.$('saveList').querySelector('.load').click();
    await settle();
    check('loading a kept board brings its world back', A.App().universe().pack() === kept[0].row.cells );
  }

  // A save the file refuses is shown, not swallowed.
  {
    const A = bootApp({ failPut: true });
    await settle();
    A.$('fail').hidden = true;
    A.pour(10, 10);
    A.flushTimers();
    await settle();
    check('db rejection is shown, not swallowed', A.fail().shown, A.$('fail').textContent);
  }

  // No canvas at all: a sticky sentence, never a black canvas.
  {
    const A = bootApp({ noCanvas: true });
    await settle();
    check('canvas fail is a sentence, not a black canvas', A.fail().shown && A.fail().sticky && A.$('hint').hidden === true,
      A.$('fail').textContent);
  }

  // The meeting wall: room is subscribed, boards are fetched by get(); Back leaves.
  {
    const A = bootApp({ seed: {
      room: { b_x1: { id: 'b_x1', kind: 'card', title: 'Salt Flats', author: 'Ivo Brandt', authorId: 'u-ivo', at: 5, thumb: '' } },
      boards: { b_x1: { id: 'b_x1', w: 180, h: 120, cells: (() => { const u = new S.Universe(180, 120); u.setCell(3, 4, S.makeCell(Sp.Sand, 120, 0)); return u.pack(); })() } },
    } });
    await settle();
    A.$('shareBtn').click();
    await settle();
    check('the wall opens with a status line', A.sb.SandWall.busy() && A.$('friend-bar').hidden === false && !!A.$('friend-status').textContent);
    check('room is subscribed, boards are never subscribed',
      A.log.some((l) => l.op === 'subscribe' && l.db === 'room') && !A.log.some((l) => l.op === 'subscribe' && l.db === 'boards'));
    const card = A.$('wall').querySelector('.card');
    check('a card on the wall is drawn', !!card);
    if (card) card.click();
    await settle();
    check('tapping a card get()s its board and opens it paused',
      A.log.some((l) => l.op === 'get' && l.db === 'boards' && l.id === 'b_x1') &&
      A.App().universe().getCell(3, 4).species === Sp.Sand && A.App().paused());
    const back = A.back();
    const handled = back && back();
    check('Back leaves the wall', handled === true && !A.sb.SandWall.busy() && A.$('friend-bar').hidden === true);
    // The engine note (no packed kernel here) is still up: Back dismisses it first.
    const second = back && back();
    check('Back dismisses a passing note', second === true && A.$('fail').hidden === true);
    check('Back with nothing open is left to GifOS', back && back() === false);
  }
}

function scan() {
  const html = src('index.html');
  const css = src('style.css');
  const listing = src('listing.json');
  const help = src('help.md');
  const manifest = JSON.parse(src('manifest.json'));
  const doc = miniDom(html);

  // TEXT-CHECK: touch-action is a CSS declaration; Node has no layout or gesture engine.
  check('phone pour: touch-action none on the world', /#world/.test(css) && /touch-action:\s*none/.test(css));
  // TEXT-CHECK: a scrolling strip is layout; no layout engine in Node.
  check('palette is a sideways strip on a phone', /overflow-x:\s*auto/.test(css));
  // TEXT-CHECK: tap-target size is layout; no layout engine in Node.
  check('44px tap targets on actions', /min-height:\s*44px/.test(css));
  // TEXT-CHECK: the rule is about a visible label (Invite is OS chrome); no behaviour tells such a button apart.
  check('no in-app Invite button', !/<button\b[^>]*>\s*Invite\s*</i.test(html) && !doc.querySelectorAll('button').some((b) => /invite/i.test(b.id)));
  check('capabilities: db + multiplayer + wasm, no network',
    manifest.capabilities.db && manifest.capabilities.multiplayer && manifest.capabilities.wasm && !manifest.capabilities.network);
  check('save is private, room and boards are read-write',
    manifest.data.save.visibility === 'private' &&
    manifest.data.room.visibility === 'read-write' &&
    manifest.data.boards.visibility === 'read-write');
  // TEXT-CHECK: listing and help are reader-facing text; the rule (no internals jargon) is about that text.
  check('listing/help do not say gifos.db / WASM / sandbox',
    !/gifos\.db|WASM|sandbox|localStorage|WebRTC/.test(listing) &&
    !/gifos\.db|WASM|sandbox|localStorage|WebRTC/.test(help));
  check('help.md is a real help file', help.trim().length >= 400);
  const scripts = doc.querySelectorAll('script');
  check('scripts are classic, not modules', scripts.length >= 4 && scripts.every((x) => x.getAttribute('type') !== 'module'));

  if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exit(1);
  }
  console.log('\nAll PASS — sandspiel pours, the file is the world.');
}

stepWasm().catch((err) => {
  check('wasm instantiate', false, err && err.message);
  return null;
}).then(shell).catch((err) => {
  check('shell harness ran', false, err && err.stack);
}).then(scan);
