// CROSSWORD HAS TO BE A COMPLETE GRID YOU CAN FILL.
//
// v1 shipped a 4×4 word square, a pad that did not advance, and a pad that
// stayed hidden until a touchstart (so a phone with a real keyboard never
// opened). This suite compiles the baked puzzles, PLAYS each one by writing
// every solution letter into the model, and source-scans the phone input
// rules a vm cannot type through.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

const puzzles = JSON.parse(fs.readFileSync(path.join(APP, 'vendor', 'puzzles.json'), 'utf8')).puzzles;
const sand = JSON.parse(fs.readFileSync(path.join(APP, 'vendor', 'puzzle.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
const lib = fs.readFileSync(path.join(APP, 'vendor', 'crosswords.js'), 'utf8');

function compileAll() {
  const ctx = {
    console,
    window: {},
    self: {},
    globalThis: {},
    document: {
      createElement() {
        return {
          style: {}, classList: { add() {}, remove() {} },
          appendChild() {}, addEventListener() {}, children: [],
          dataset: {}, setAttribute() {},
        };
      },
    },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(lib, ctx, { filename: 'crosswords.js' });
  return ctx.crosswords;
}

const cw = compileAll();
check('UMD attaches compileCrossword', !!(cw && typeof cw.compileCrossword === 'function'));

check('three baked puzzles', puzzles.length >= 3, puzzles.length);
check('heart + racecar + sand',
  puzzles.some((p) => p.id === 'heart') &&
  puzzles.some((p) => p.id === 'racecar') &&
  puzzles.some((p) => p.id === 'sand'));

const byId = {};
puzzles.forEach((p) => { byId[p.id] = p; });

function play(def) {
  const model = cw.compileCrossword(def);
  if (!model || !model.lightCells) return { ok: false, reason: 'no model', lights: 0 };
  let wrote = 0;
  (model.acrossClues || []).forEach((clue) => {
    const sol = clue.solution || '';
    for (let i = 0; i < sol.length; i++) {
      const cell = clue.cells[i];
      if (!cell) continue;
      cell.answer = sol[i];
      wrote++;
    }
  });
  const lights = model.lightCells;
  const filled = lights.filter((c) => (c.answer || ' ').trim() === c.solution);
  const missing = lights.filter((c) => (c.answer || ' ').trim() !== c.solution).slice(0, 4)
    .map((c) => c.x + ',' + c.y + '=' + (c.answer || '') + '/' + c.solution);
  return {
    ok: filled.length === lights.length && lights.length >= 12,
    lights: lights.length,
    filled: filled.length,
    wrote,
    missing,
    width: model.width,
    height: model.height,
  };
}

{
  const h = play(byId.heart);
  check('Heart compiles and PLAYS to a full 5×5', h.ok && h.width === 5 && h.lights === 25, h);
}
{
  const r = play(byId.racecar);
  check('Racecar compiles and PLAYS to a 7×7 with blacks', r.ok && r.width === 7 && r.lights < 49, r);
  check('Racecar is a complete grid (every light has a letter)', r.filled === r.lights, r);
}
{
  const s = play(byId.sand);
  check('Sand still PLAYS (v1 save target)', s.ok && s.width === 4 && s.lights === 16, s);
}
{
  const s2 = play(sand);
  check('vendor/puzzle.json is still the Sand grid', s2.ok && s2.lights === 16, s2);
}

// A wrong letter must stay detectable — Check word is not a no-op.
{
  const model = cw.compileCrossword(byId.heart);
  const cell = model.acrossClues[0].cells[0];
  cell.answer = cell.solution === 'X' ? 'Y' : 'X';
  check('a wrong letter is not the solution', cell.answer !== cell.solution, cell.answer);
}

// ---- the app shell, executed ----------------------------------------------
// app.js runs in a vm against a small fake DOM. The real crosswords-js
// controller wants a browser, so newCrosswordController is a thin stand-in
// built on the REAL compiled model (compileCrossword above). Its
// setGridCell only accepts a DOM node, as the library's does (it reads
// dataset.xy), and writes the letter into the clue's answer string the way
// the library does — so a cell.answer that is never updated is the stale
// value the app must not read.
function fakeEl(tag, id) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: '', type: '', value: '',
    textContent: '', style: {}, dataset: {}, attrs: {}, children: [], listeners: {}, focused: 0,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const l = this.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    fire(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {}, type: t, target: el }, ev || {}))); },
    focus() { this.focused++; },
  };
  Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set() { el.children = []; } });
  return el;
}
function bootApp(opts) {
  opts = opts || {};
  const els = {};
  const document = fakeEl('document');
  document.body = fakeEl('body');
  document.getElementById = (id) => (els[id] = els[id] || fakeEl('div', id));
  document.createElement = (tag) => fakeEl(tag);
  const timers = [];
  const gridCalls = [];
  const ctrls = [];
  const lib = {
    newCrosswordController(def) {
      const model = cw.compileCrossword(def);
      const nodes = new Map();
      const ctrl = {
        model,
        currentClue: model.acrossClues[0],
        currentCell: model.acrossClues[0].cells[0],
        cellElement(cell) {
          if (!nodes.has(cell)) { const n = fakeEl('div'); n.dataset.xy = cell.x + ',' + cell.y; nodes.set(cell, n); }
          return nodes.get(cell);
        },
        setGridCell(node, ch) {
          gridCalls.push(node);
          if (!node || !node.dataset || !node.dataset.xy) return;   // the library reads dataset.xy; a model cell writes nothing
          const p = node.dataset.xy.split(',');
          const cell = model.cells[+p[0]][+p[1]];
          [['acrossClue', 'acrossClueLetterIndex'], ['downClue', 'downClueLetterIndex']].forEach(([k, ix]) => {
            const clue = cell[k]; if (!clue) return;
            const ans = (clue.answer || '').padEnd(clue.cells.length, ' ').split('');
            ans[cell[ix]] = ch; clue.answer = ans.join('');
          });
        },
        addEventsListener() {},
        testCurrentClue() {}, testCrossword() { return 2; }, revealCurrentCell() {}, resetCrossword() {}, destroy() {},
      };
      ctrls.push(ctrl);
      return ctrl;
    },
  };
  const rows = {}, puts = [];
  const calls = { onBack: [] };
  const saveDb = {
    get(id) { return Promise.resolve(rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null); },
    put(r) { puts.push(JSON.parse(JSON.stringify(r))); rows[r.id] = JSON.parse(JSON.stringify(r)); return Promise.resolve(); },
    subscribe() {},
  };
  Object.assign(rows, opts.rows || {});
  const roomDb = { get() { return Promise.resolve(null); }, put() { return Promise.resolve(); }, subscribe() {} };
  const gifos = opts.noApi ? undefined : {
    db(name) { return name === 'save' ? saveDb : roomDb; },
    me() { return Promise.resolve({ id: 'local' }); },
    onBack(fn) { calls.onBack.push(fn); },
  };
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, Map, Set,
    gifos, document, crosswords: lib,
    CROSSWORD_PUZZLES: JSON.parse(JSON.stringify(puzzles)),
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(n) { if (n) timers[n - 1] = null; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(appJs, sandbox, { filename: 'app.js' });
  const flush = () => { const t = timers.splice(0); t.forEach((fn) => fn && fn()); };
  return { App: sandbox.CrosswordApp, els, document, gridCalls, ctrls, rows, puts, calls, flush };
}
const settle = () => new Promise((r) => setImmediate(r));
const cellAt = (ctrl, x, y) => ctrl.model.cells[x][y];

async function appChecks() {
  // Typing walks along the clue, and every write goes to the DOM node.
  {
    const A = bootApp();
    await settle(); await settle();
    const App = A.App;
    check('app.js attaches CrosswordApp', !!(App && App.enterLetter && App.snapshot && App.ctrl));
    const ctrl = App.ctrl;
    const clue = ctrl.currentClue, cells = clue.cells;
    const ok = ['h', 'E', 'a'].map((ch) => App.enterLetter(ch));
    const snap = App.snapshot();
    const k = (c) => c.x + ',' + c.y;
    check('app.js enterLetter advances along the clue',
      ok.every(Boolean) && ctrl.currentCell === cells[3]
        && snap[k(cells[0])] === 'H' && snap[k(cells[1])] === 'E' && snap[k(cells[2])] === 'A',
      { at: cells.indexOf(ctrl.currentCell), snap });
    check('the last square of a clue stays put instead of running off the end',
      (() => { ctrl.currentCell = cells[cells.length - 1]; App.enterLetter('Z'); return ctrl.currentCell === cells[cells.length - 1]; })());
    ctrl.currentCell = cells[2];
    App.enterLetter('DEL');
    check('DEL clears the square and steps back', App.snapshot()[k(cells[2])] === '' && ctrl.currentCell === cells[1], App.snapshot());
    check('a non-letter is refused', App.enterLetter('7') === false && App.enterLetter('') === false);
    check('setGridCell is called with the DOM cell, not the model cell',
      A.gridCalls.length > 0 && A.gridCalls.every((n) => n && n.dataset && /^\d+,\d+$/.test(n.dataset.xy) && !('light' in n)),
      A.gridCalls.length);

    // snapshot reads the letter the library keeps on the clue, not the
    // model cell's own answer, which the library leaves stale.
    const c0 = cells[0];
    c0.answer = 'Q';
    clue.answer = 'W' + (clue.answer || '').slice(1);
    check('snapshot reads the clue letter, not a stale cell.answer', App.snapshot()[k(c0)] === 'W', App.snapshot()[k(c0)]);

    // Save: the debounced save writes the puzzle id with the progress row
    // and a per-puzzle row.
    A.flush();
    const prog = A.puts.filter((r) => r.id === 'progress').pop();
    check('save writes puzzle id on progress',
      !!prog && prog.puzzle === App.currentId && prog.cells && prog.cells[k(cells[1])] === 'E'
        && A.puts.some((r) => r.id === App.currentId && r.puzzle === App.currentId),
      prog);

    // Picking another puzzle from the picker saves the first and switches.
    const first = App.currentId;
    const btn = A.els.puzzles.children.find((b) => b.getAttribute('data-id') === 'racecar');
    A.puts.length = 0;
    if (btn) btn.fire('click');
    await settle(); await settle();
    check('the picker switches puzzle and keeps the letters of the one left behind',
      !!btn && App.currentId === 'racecar' && App.ctrl.model.width === 7
        && A.puts.some((r) => r.id === first && r.cells && r.cells[k(cells[1])] === 'E'),
      { now: App.currentId });

    // The phone keyboard <input id="kb"> feeds enterLetter.
    const kb = A.els.kb;
    App.ctrl.currentCell = App.ctrl.currentClue.cells[0];
    kb.value = 'r';
    kb.fire('input');
    const c = App.ctrl.currentClue.cells[0];
    check('typing into the phone keyboard input writes a letter and clears the input',
      App.snapshot()[k(c)] === 'R' && kb.value === '' && App.ctrl.currentCell === App.ctrl.currentClue.cells[1]);
    App.ctrl.currentCell = c;
    kb.fire('keydown', { key: 'Backspace' });
    check('Backspace on the phone keyboard clears the square', App.snapshot()[k(c)] === '', App.snapshot()[k(c)]);

    // The pad: 26 letter keys + DEL mounted in #keys, and a press writes.
    const keys = [];
    (A.els.keys.children || []).forEach((row) => row.children.forEach((b) => keys.push(b)));
    const letters = keys.filter((b) => /^[A-Z]$/.test(b.textContent));
    check('app.js builds a QWERTY pad', letters.length === 26 && new Set(letters.map((b) => b.textContent)).size === 26
      && A.els.keys.children.length === 3 && A.els.keys.children[0].children.length === 10, letters.length);
    const kKey = letters.find((b) => b.textContent === 'K');
    App.ctrl.currentCell = App.ctrl.currentClue.cells[0];
    const before = kb.focused;
    if (kKey) kKey.fire('pointerdown');
    check('a pad key writes its letter and keeps the phone keyboard focused',
      !!kKey && App.snapshot()[k(App.ctrl.currentClue.cells[0])] === 'K' && kb.focused > before);

    // Back is registered and says the app handled nothing it must stop.
    check('onBack is registered', A.calls.onBack.length === 1 && typeof A.calls.onBack[0] === 'function');
  }

  // Reopen: the saved letters come back on the saved puzzle.
  {
    const A = bootApp({ rows: {
      progress: { id: 'progress', puzzle: 'racecar', cells: { '0,0': 'R' } },
      racecar: { id: 'racecar', puzzle: 'racecar', cells: { '0,0': 'R' } },
    } });
    await settle(); await settle();
    check('a saved progress row reopens its puzzle with its letters',
      A.App.currentId === 'racecar' && A.App.snapshot()['0,0'] === 'R', { id: A.App.currentId, s: A.App.snapshot()['0,0'] });
  }
  // v1 save: progress with no puzzle id is a Sand grid.
  {
    const A = bootApp({ rows: { progress: { id: 'progress', cells: { '0,0': 'S', '1,0': 'A' } } } });
    await settle(); await settle();
    check('app.js still opens a v1 progress row on Sand',
      A.App.currentId === 'sand' && A.App.ctrl.model.width === 4 && A.App.snapshot()['0,0'] === 'S' && A.App.snapshot()['1,0'] === 'A',
      { id: A.App.currentId });
  }
  // Without gifos (opened as a plain page) the grid still plays.
  {
    const A = bootApp({ noApi: true });
    await settle();
    check('without gifos the first grid still loads and takes letters',
      !!A.App.ctrl && A.App.enterLetter('A') === true);
  }
}

// ---- markup and layout -----------------------------------------------------
// The phone keyboard: an <input id="kb"> that asks for a text keyboard.
function tagById(markup, id) {
  const m = markup.match(new RegExp('<([a-z]+)\\b[^>]*\\bid\\s*=\\s*["\']' + id + '["\'][^>]*>', 'i'));
  if (!m) return null;
  const attrs = {};
  m[0].replace(/([a-z-]+)\s*=\s*["']([^"']*)["']/gi, (_, k, v) => { attrs[k.toLowerCase()] = v; });
  return { tag: m[1].toLowerCase(), attrs };
}
{
  const kb = tagById(html, 'kb');
  check('index.html has inputmode=text for the phone keyboard',
    !!kb && kb.tag === 'input' && kb.attrs.inputmode === 'text', kb);
  const keys = tagById(html, 'keys');
  check('index.html has a QWERTY pad mount', !!keys);
}

// The pad must show on a phone without waiting for a touchstart. Evaluate
// style.css's rules for #keys under a phone viewport and a desktop one.
function keysDisplay(cssText, env) {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0, order = 0;
  function parseBlock(str, media) {
    let j = 0;
    while (j < str.length) {
      const open = str.indexOf('{', j);
      if (open < 0) break;
      const head = str.slice(j, open).trim();
      let depth = 1, k = open + 1;
      while (k < str.length && depth) { if (str[k] === '{') depth++; else if (str[k] === '}') depth--; k++; }
      const bodyText = str.slice(open + 1, k - 1);
      if (/^@media/i.test(head)) parseBlock(bodyText, head.replace(/^@media/i, '').trim());
      else if (!/^@/.test(head)) rules.push({ sels: head.split(',').map((x) => x.trim()), body: bodyText, media, order: order++ });
      j = k;
    }
  }
  parseBlock(text, null);
  const mediaOk = (q) => !q || q.split(',').some((part) => {
    const conds = part.match(/\(([^)]+)\)/g) || [];
    return conds.every((c) => {
      const [k, v] = c.slice(1, -1).split(':').map((x) => x.trim());
      if (k === 'max-width') return env.width <= parseFloat(v);
      if (k === 'min-width') return env.width >= parseFloat(v);
      if (k === 'hover') return env.hover === v;
      if (k === 'pointer') return env.pointer === v;
      return false;
    });
  });
  const matchSel = (sel) => {
    const parts = sel.split(/\s+/);
    if (parts[parts.length - 1] !== '#keys') return -1;
    let spec = 100;
    for (const p of parts.slice(0, -1)) {
      const m = p.match(/^(body)?((?:\.[\w-]+)*)$/);
      if (!m) return -1;
      const cls = (m[2].match(/\.[\w-]+/g) || []).map((x) => x.slice(1));
      if (!cls.every((c) => env.bodyClasses.indexOf(c) >= 0)) return -1;
      spec += (m[1] ? 1 : 0) + 10 * cls.length;
    }
    return spec;
  };
  let best = null;
  rules.forEach((r) => {
    if (!mediaOk(r.media)) return;
    const d = r.body.match(/(?:^|;)\s*display\s*:\s*([^;]+)/);
    if (!d) return;
    r.sels.forEach((sel) => {
      const sp = matchSel(sel);
      if (sp < 0) return;
      if (!best || sp > best.sp || (sp === best.sp && r.order >= best.order)) best = { sp, order: r.order, v: d[1].trim() };
    });
  });
  return best ? best.v : 'block';
}
{
  const phone = keysDisplay(css, { width: 400, hover: 'hover', pointer: 'fine', bodyClasses: [] });
  const desk = keysDisplay(css, { width: 1200, hover: 'hover', pointer: 'fine', bodyClasses: [] });
  const touched = keysDisplay(css, { width: 1200, hover: 'hover', pointer: 'fine', bodyClasses: ['touch'] });
  check('pad is shown at phone width without waiting for touchstart',
    phone === 'flex' && desk === 'none' && touched === 'flex', { phone, desk, touched });
}

// TEXT-CHECK: Invite is OS chrome and there is no app API behind an in-app
// Invite control, so there is nothing to run. This scans the markup for a
// control whose id or visible name is Invite.
check('no in-app Invite button', !tagById(html, 'invite') && !/<button\b[^>]*>\s*Invite\s*</i.test(html));
check('listing tagline fits the store card', typeof listing.tagline === 'string' && listing.tagline.length <= 120);

let appDone = false;
process.on('exit', () => {
  if (!appDone) { console.log('FAIL — the app checks never finished (a promise hung)'); process.exitCode = 1; }
});
appChecks().then(() => {
  appDone = true;
  if (failures) {
    console.log(failures + ' failure(s)');
    process.exit(1);
  }
  console.log('ok — crossword unit');
}, (e) => { console.log('FAIL — app harness threw: ' + (e && e.stack || e)); process.exit(1); });
