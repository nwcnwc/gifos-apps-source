// ORCA'S SAVE HAS TO HOLD THE GRID.
//
// boot.js built the save record with `'' + client.orca`. Orca defines its own
// valueOf(glyph) (a base-36 glyph reader), so string concatenation called
// that, not toString, and every save stored "0": reopening the file lost the
// program. This suite boots the real boot.js over the real Orca core in a vm,
// edits the grid, lets the app save on blur, then reopens a second instance
// from the saved record and compares the cells.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// One app instance: Orca core + boot.js, a fake page that never fires load,
// and a gifos.db('save') that keeps what the app puts.
function instance(store) {
  const listeners = {};
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setInterval: function () { return 0; },
    document: { readyState: 'loading', body: {} },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    gifos: {
      db: function (name) {
        if (name !== 'save') return null;
        return {
          put: function (rec) { store[rec.id] = JSON.parse(JSON.stringify(rec)); return Promise.resolve(); },
          get: function (id) { return Promise.resolve(store[id] || null); }
        };
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const core = path.join(APP, 'vendor', 'core');
  vm.runInContext(fs.readFileSync(path.join(core, 'operator.js'), 'utf8'), sandbox, { filename: 'operator.js' });
  vm.runInContext(fs.readFileSync(path.join(core, 'library.js'), 'utf8') + '\nthis.library = library;', sandbox, { filename: 'library.js' });
  vm.runInContext(fs.readFileSync(path.join(core, 'orca.js'), 'utf8'), sandbox, { filename: 'orca.js' });
  vm.runInContext(
    'this.Client = function () {' +
    '  this.orca = new Orca(library);' +
    '  this.tile = { w: 10, h: 15 };' +
    '  this.clock = { speed: { value: 120 }, setSpeed: function (a) { this.speed.value = a; } };' +
    '  this.history = { reset: function () {}, record: function () {} };' +
    '  this.install = function () {}; this.resize = function () {}; this.update = function () {};' +
    '};', sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'boot.js'), 'utf8'), sandbox, { filename: 'boot.js' });
  sandbox.fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }));
  return sandbox;
}

const store = {};
const a = instance(store);
check('boot.js exposes the client and OrcaApp', !!(a.client && a.client.orca && a.OrcaApp));

a.OrcaApp.loadStarter();
a.client.orca.write(6, 1, 'E');   // the person's own edit on top of the starter
const before = a.client.orca.s;
check('the edited grid differs from the starter', before !== a.OrcaApp.starter && before.length === 24, before);

a.fire('blur');                     // the app saves on blur
const rec = store.grid;
check('a blur writes the grid record', !!rec, Object.keys(store));
check('the saved record carries the grid cells, not a number',
  !!rec && typeof rec.orca === 'string' && rec.orca.replace(/\s/g, '') === before, rec && rec.orca);

const b = instance(store);
const applied = !!rec && b.OrcaApp.apply(rec);
check('reopening applies the saved record', applied === true);
check('the reopened grid is the edited grid, cell for cell', b.client.orca.s === before, b.client.orca.s);
check('the reopened grid keeps its size', b.client.orca.w === 8 && b.client.orca.h === 3, [b.client.orca.w, b.client.orca.h]);
check('the starter D still bangs after the reopen', b.client.orca.glyphAt(1, 0) === 'D' && b.client.orca.glyphAt(6, 1) === 'E');

{
  // A file saved by an older build holds "0" for an 8x3 grid.
  const c = instance({});
  c.OrcaApp.loadStarter();
  const ok = c.OrcaApp.apply({ id: 'grid', orca: '0', w: 8, h: 3, f: 5 });
  check('a broken "0" record is refused, not loaded as the grid', ok === false && c.client.orca.s === c.OrcaApp.starter, c.client.orca.s);
}

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nAll orca save checks green.');
