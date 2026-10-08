// FIELD PLAY HAS TO POUR, SAVE, AND SHARE.
//
// The store port shipped a GPU field that could pan but never poured particles
// on a tap, never saved the camera after a pan, and had no suite at all. This
// file PLAYS the non-GL half in a vm (encode, presets, adopt-the-recipe, save
// shape, extras) and greps the one-liners a vm cannot run (touch-action, pinch,
// dropAt, Back, no Invite button, no fetch).
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

function el() {
  return {
    hidden: true,
    textContent: '',
    value: '',
    innerHTML: '',
    checked: false,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return ''; },
    addEventListener() {},
    appendChild() {},
    querySelectorAll() { return []; },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
    clientWidth: 400,
    clientHeight: 300,
    width: 400,
    height: 300,
  };
}

function load(files, extra) {
  const els = {};
  const document = {
    getElementById(id) { return (els[id] = els[id] || el()); },
    createElement() { return el(); },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    addEventListener() {},
  };
  const sandbox = Object.assign({
    console, Math: seededMath(0xF1E1D), Object, Array, JSON, Date, String, Number, Boolean, Promise,
    Uint8Array, Float32Array, Int32Array,
    document,
    window: null,
    setTimeout(fn) { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    addEventListener() {},
    matchMedia() { return { matches: false }; },
  }, extra || {});
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.root = sandbox;
  sandbox.this = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.__els = els;
  return sandbox;
}

const engine = load(['vendor/fieldplay.js', 'vendor/presets.js']);
check('engine attaches FieldPlay', !!(engine.FieldPlay && engine.FieldPlay.encodeFloatRGBA && engine.FieldPlay.dropAt));
check('presets aboard (>= 8, no texture fetches)', (engine.FPPresets || []).length >= 8
  && engine.FPPresets.every((p) => p.code && p.code.indexOf('get_velocity') >= 0 && p.code.indexOf('texture2D') < 0),
  (engine.FPPresets || []).length);

{
  const out = new Uint8Array(4);
  engine.FieldPlay.encodeFloatRGBA(1.5, out, 0);
  const z = new Uint8Array(4);
  engine.FieldPlay.encodeFloatRGBA(0, z, 0);
  check('encodeFloatRGBA(0) is zero bytes', z[0] === 0 && z[3] === 0);
  check('encodeFloatRGBA(1.5) is not zero', !(out[0] === 0 && out[1] === 0 && out[2] === 0 && out[3] === 0));
}

check('mount without WebGL fails honestly', engine.FieldPlay.mount({
  getContext() { return null; },
  addEventListener() {},
  style: {},
  clientWidth: 400,
  clientHeight: 300,
}) === false);
check('lastError names WebGL when mount fails', /WebGL/i.test(engine.FieldPlay.lastError() || ''));

const app = load(['vendor/fieldplay.js', 'vendor/presets.js', 'app.js', 'mp.js']);
check('FPApp extras include follow-the-finger',
  !!(app.FPApp && app.FPApp.extras && app.FPApp.extras.some((p) => p.id === 'follow-finger')));
check('follow-the-finger uses cursor so a finger warps the field',
  (app.FPApp.extras.find((p) => p.id === 'follow-finger').code.indexOf('cursor.zw') >= 0));
check('findPresetByKey matches black-hole',
  !!(app.FPApp.findPresetByKey('black-hole') && app.FPApp.findPresetByKey('Black hole')));
check('findPresetByKey misses junk', app.FPApp.findPresetByKey('no-such-field') == null);

// ---- a fake WebGL and a fake page -----------------------------------------
// The engine runs for real against a recording GL context. Its one GLSL rule
// is the one that bit this port: a call to get_velocity( must come after a
// declaration of it, or the shader does not compile.
function glslOk(src) {
  const re = /get_velocity\s*\(/g;
  let m, firstDecl = -1, firstCall = -1;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/vec2\s+$/.test(before)) { if (firstDecl < 0) firstDecl = m.index; }
    else if (firstCall < 0) firstCall = m.index;
  }
  return firstCall < 0 || (firstDecl >= 0 && firstDecl < firstCall);
}
function fakeGL() {
  const log = { texSub: [], compiled: [] };
  let n = 0;
  const impl = {
    createShader(type) { return { type, src: '', ok: false }; },
    shaderSource(sh, src) { sh.src = src; },
    compileShader(sh) { sh.ok = glslOk(sh.src); log.compiled.push(sh); },
    getShaderParameter(sh) { return sh.ok; },
    getShaderInfoLog(sh) { return sh.ok ? '' : "ERROR: 0:1: 'get_velocity' : no matching overloaded function found"; },
    getProgramParameter(pr, k) { return k === 'C_LINK_STATUS' ? true : 0; },
    texSubImage2D(...args) { log.texSub.push(args); },
  };
  const gl = new Proxy({}, {
    get(t, k) {
      if (k === '__log') return log;
      if (k in impl) return impl[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 'C_' + k;
      return () => ({ id: ++n });
    },
  });
  return gl;
}
function pageEl(tag, id) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', hidden: false, value: '', checked: false,
    style: {}, attrs: {}, children: [], listeners: {}, _text: '',
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); },
      toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelectorAll(sel) { return sel === 'button' ? this.children.filter((c) => c.tagName === 'BUTTON') : []; },
    fire(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn.call(e, Object.assign({ preventDefault() {}, type: t, target: e }, ev || {}))); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 }; },
    setPointerCapture() {},
    clientWidth: 400, clientHeight: 300, width: 0, height: 0,
    getContext() { return null; },
  };
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); if (v === '') e.children = []; } });
  return e;
}
function page(opts) {
  opts = opts || {};
  const els = {};
  const gl = fakeGL();
  const document = {
    body: pageEl('body'),
    getElementById(id) {
      if (!els[id]) {
        els[id] = pageEl(id === 'field' ? 'canvas' : 'div', id);
        if (id === 'err' || id === 'friend-bar') els[id].hidden = true;   // as index.html ships them
        if (id === 'field' && opts.gl !== false) els[id].getContext = () => gl;
      }
      return els[id];
    },
    createElement(tag) { return pageEl(tag); },
    addEventListener() {},
  };
  const timers = [];
  const rows = Object.assign({}, opts.rows || {}), puts = [], dbNames = [];
  const backs = [];
  let roomSub = null;
  const roomPuts = [];
  const gifos = opts.noApi ? undefined : {
    db(name) {
      dbNames.push(name);
      if (name === 'room') return { put(r) { roomPuts.push(r); return Promise.resolve(); }, subscribe(fn) { roomSub = fn; }, get() { return Promise.resolve(null); } };
      if (name !== 'save') return { get() { return Promise.resolve(null); }, put() { return Promise.resolve(); }, subscribe() {} };
      return {
        get(id) { return Promise.resolve(rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null); },
        put(r) { puts.push(JSON.parse(JSON.stringify(r))); rows[r.id] = r; return Promise.resolve(); },
      };
    },
    me() { return Promise.resolve({ id: opts.meId || 'm', name: 'Sample' }); },
    onBack(fn) { backs.push(fn); },
    launch: opts.launch ? () => Promise.resolve(opts.launch) : undefined,
  };
  const sandbox = {
    console, Math: seededMath(0xF1E1D), Object, Array, JSON, Date, String, Number, Boolean, Promise,
    Uint8Array, Float32Array, Int32Array, Set,
    document, gifos,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1] = null; },
    setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    addEventListener() {},
    devicePixelRatio: 1,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/fieldplay.js', 'vendor/presets.js', 'app.js', 'mp.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  const flush = () => { const t = timers.splice(0); t.forEach((fn) => fn && fn()); };
  return { S: sandbox, els, gl, log: gl.__log, rows, puts, dbNames, backs, flush, room: () => roomSub, roomPuts };
}
const settle = () => new Promise((r) => setImmediate(r));
const ptr = (canvas, type, id, x, y) => canvas.fire(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch' });

async function pageChecks() {
  // The engine on a (fake) GL: touch-action, tap pours, drag pans, pinch zooms.
  {
    const P = page();
    await settle(); await settle();
    const FP = P.S.FieldPlay, canvas = P.els.field;
    check('the field mounts on a WebGL canvas and compiles the first preset',
      !!FP.getState().code && !FP.lastError() && P.log.compiled.length >= 4 && P.log.compiled.every((sh) => sh.ok), FP.lastError());
    check('canvas is touch-action none', canvas.style.touchAction === 'none');
    let views = 0;
    FP.onView(() => { views++; });
    const before = P.log.texSub.length;
    ptr(canvas, 'pointerdown', 1, 200, 150);
    ptr(canvas, 'pointerup', 1, 203, 151);
    const poured = P.log.texSub.length - before;
    check('engine pours particles on a tap (dropAt)', poured === 2 && views === 1, { poured, views });
    const st0 = FP.getState();
    const before2 = P.log.texSub.length;
    ptr(canvas, 'pointerdown', 1, 200, 150);
    ptr(canvas, 'pointermove', 1, 260, 150);
    ptr(canvas, 'pointerup', 1, 260, 150);
    const st1 = FP.getState();
    check('a drag pans instead of pouring', P.log.texSub.length === before2 && st1.cx < st0.cx && views === 2,
      { cx0: st0.cx, cx1: st1.cx, poured: P.log.texSub.length - before2 });
    ptr(canvas, 'pointerdown', 1, 100, 150);
    ptr(canvas, 'pointerdown', 2, 300, 150);
    ptr(canvas, 'pointermove', 2, 500, 150);
    const st2 = FP.getState();
    ptr(canvas, 'pointerup', 2, 500, 150);
    ptr(canvas, 'pointerup', 1, 100, 150);
    check('engine pinch-zooms with two pointers', Math.abs(st2.w - st1.w / 2) < 1e-9 && Math.abs(st2.h - st1.h / 2) < 1e-9,
      { w1: st1.w, w2: st2.w });
    check('…and a pinch does not pour', P.log.texSub.length === before2, P.log.texSub.length - before2);

    // GLSL: rk4 calls get_velocity, so the shader must declare it first —
    // even for a recipe whose own helper calls get_velocity before defining it.
    const recipe = 'vec2 spin(vec2 p) { return get_velocity(p) * 0.5; }\n' +
      'vec2 get_velocity(vec2 p) { return vec2(-p.y, p.x); }';
    const r = FP.setCode(recipe);
    check('GLSL defines get_velocity before rk4 uses it', !!(r && r.ok), r);
  }

  // The shell: save, restore, launch, back, empty recipe.
  {
    const P = page();
    await settle(); await settle();
    const FP = P.S.FieldPlay, canvas = P.els.field;
    P.flush();
    P.puts.length = 0;
    ptr(canvas, 'pointerdown', 1, 200, 150);
    ptr(canvas, 'pointermove', 1, 100, 150);
    ptr(canvas, 'pointerup', 1, 100, 150);
    P.flush();
    const row = P.puts.filter((x) => x.id === 'field').pop();
    check('pan/zoom persist via onView', !!row && row.cx === FP.getState().cx && row.code === FP.getState().code, row);
    check('save collection is gifos.db("save")', !!P.rows.field && P.rows.field.cx === FP.getState().cx);

    // Empty recipe: nothing is compiled, the field stays, the error shows.
    const code0 = FP.getState().code, compiled0 = P.log.compiled.length;
    P.els.recipe.value = '   \n ';
    P.els.applyBtn.fire('click');
    check('empty recipe does not wipe the field',
      FP.getState().code === code0 && P.log.compiled.length === compiled0 && P.els.err.hidden === false);

    // Back: closes the recipe sheet, then leaves a room, then lets go.
    const back = P.backs[0];
    P.els.recipeBtn.fire('click');
    const opened = P.S.document.body.classList.contains('show-recipe');
    const r1 = back && back();
    const closed = !P.S.document.body.classList.contains('show-recipe');
    P.els.shareBtn.fire('click');
    await settle(); await settle();
    const inRoom = P.S.FPMp.busy();
    const r2 = back && back();
    const left = !P.S.FPMp.busy();
    const r3 = back && back();
    check('Back closes the recipe sheet then leaves a room',
      !!back && opened && r1 === true && closed && inRoom && r2 === true && left && r3 === false,
      { opened, r1, closed, inRoom, r2, left, r3 });
  }
  // Reopen: the saved camera and recipe come back.
  {
    const preset = page().S.FPPresets[1];
    const P = page({ rows: { field: { id: 'field', code: preset.code, timeStep: 0.02, fadeOut: 0.95, dropProbability: 0.01,
      colorMode: 2, cx: 3.5, cy: -2, w: 7, h: 7, particleRes: 64 } } });
    await settle(); await settle();
    const st = P.S.FieldPlay.getState();
    check('a saved field reopens with its camera and recipe',
      st.cx === 3.5 && st.cy === -2 && st.w === 7 && st.code === preset.code && st.particleRes === 64, st);
  }
  // Launch: a named field from the OS opens that field.
  {
    const P = page({ launch: { field: 'black-hole' } });
    await settle(); await settle();
    const want = P.S.FPApp.findPresetByKey('black-hole');
    check('a launch with field=black-hole opens that field',
      !!want && P.S.FieldPlay.getState().code === want.code && P.S.FPApp.currentId() === want.id);
  }
  // Without WebGL the app says so instead of a blank square.
  {
    const P = page({ gl: false });
    await settle();
    check('without WebGL the error box is shown', P.els.err.hidden === false && !!P.els.err.textContent);
  }
  // Room: adopt the recipe of the lowest-id player on the newest round —
  // executed through mp.js's room subscription.
  {
    const P = page({ meId: 'z' });
    await settle(); await settle();
    P.els.shareBtn.fire('click');
    await settle(); await settle();
    const sub = P.room();
    const mk = (body) => 'vec2 get_velocity(vec2 p) { return ' + body + '; }';
    const t = Date.now();
    if (sub) sub([
      { id: 'c', at: t, round: 2, code: mk('vec2(1.0, 0.0)') },
      { id: 'b', at: t, round: 2, code: mk('vec2(0.0, 1.0)') },
      { id: 'a', at: t, round: 1, code: mk('vec2(2.0, 2.0)') },
    ]);
    check('shared field adopts lowest id on the newest round',
      !!sub && P.S.FieldPlay.getState().code === mk('vec2(0.0, 1.0)'), P.S.FieldPlay.getState().code);
    check('…and publishes on its own row only', P.roomPuts.length > 0 && P.roomPuts.every((r) => r.id === 'z'));
  }
}

const src = {
  app: read('app.js'),
  mp: read('mp.js'),
  html: read('index.html'),
  listing: read('listing.json'),
  manifest: JSON.parse(read('manifest.json')),
};
// TEXT-CHECK: Invite is OS chrome and there is no app API behind an in-app
// Invite control, so there is nothing to run. This scans the markup.
check('no Invite button in the app chrome', !/<button\b[^>]*>\s*Invite\s*</i.test(src.html) && !/\bid\s*=\s*["']invite["']/i.test(src.html));
// TEXT-CHECK: the absence of a network or eval path can only be proven over
// the whole source; running the app exercises only the paths a test takes.
check('no fetch/XHR/WebSocket/eval in app chrome',
  !['fetch(', 'XMLHttpRequest', 'WebSocket', 'eval(', 'new Function('].some((b) => src.app.includes(b) || src.mp.includes(b)));
check('manifest launch.field is declared', !!(src.manifest.launch && src.manifest.launch.field));
check('save stays private; room is read-write',
  src.manifest.data.save.visibility === 'private' && src.manifest.data.room.visibility === 'read-write');
check('minBuild stays 947', src.manifest.minBuild === 947);
check('author is anvaka, never GifOS', src.manifest && JSON.parse(src.listing).author.name === 'anvaka');

let pageDone = false;
process.on('exit', () => {
  if (!pageDone) { console.log('FAIL — the page checks never finished (a promise hung)'); process.exitCode = 1; }
});
pageChecks().then(() => {
  pageDone = true;
  if (failures) {
    console.log(failures + ' FAIL');
    process.exit(1);
  }
  console.log('ok — ' + 'fieldplay unit');
}, (e) => { console.log('FAIL — page harness threw: ' + (e && e.stack || e)); process.exit(1); });
