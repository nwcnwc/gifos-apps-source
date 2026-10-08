// COMPACT HAS TO COMPACT THE CODE VIEW.
//
// In Code mode, Compact ran JSON.stringify(value) and then handed the result
// to applyParsed, which re-indented every code-mode document with two spaces:
// the button said "Compacted" and the text did not change. This suite boots
// the real app.js in a vm with a small page (the buttons it binds) and a
// stand-in JSONEditor that keeps mode and text, then clicks Sample, Code,
// Compact and Format and reads the editor's text after each click.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function element(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id, hidden: false, textContent: '', value: '', attrs: {},
    classList: {
      toggle(c, on) { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
      contains(c) { return classes.has(c); },
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    click() { (listeners.click || []).forEach((fn) => fn({ type: 'click', preventDefault() {} })); },
  };
}

// A stand-in for josdejong/jsoneditor: tree mode holds a value, code mode
// holds text; getText() in tree mode is the value as JSON, like the real one.
function FakeJSONEditor(el, opts) {
  this.opts = opts;
  this.mode = opts.mode || 'tree';
  this.value = {};
  this.text = '{}';
}
FakeJSONEditor.prototype.setMode = function (m) {
  if (m === this.mode) return;
  if (m === 'code' || m === 'text') { this.text = JSON.stringify(this.value, null, 2); }
  else { try { this.value = JSON.parse(this.text); } catch (e) { throw new Error('invalid'); } }
  this.mode = m;
};
FakeJSONEditor.prototype.getMode = function () { return this.mode; };
FakeJSONEditor.prototype.setText = function (t) { this.text = String(t); if (this.mode === 'tree') this.value = JSON.parse(t); };
FakeJSONEditor.prototype.getText = function () { return this.mode === 'tree' ? JSON.stringify(this.value) : this.text; };
FakeJSONEditor.prototype.set = function (v) { this.value = JSON.parse(JSON.stringify(v)); this.text = JSON.stringify(v, null, 2); };
FakeJSONEditor.prototype.get = function () { return this.mode === 'tree' ? this.value : JSON.parse(this.text); };

const ids = ['editor', 'tabTree', 'tabCode', 'newBtn', 'sampleBtn', 'formatBtn', 'compactBtn', 'repairBtn', 'copyBtn', 'status', 'err', 'hint', 'meet'];
const els = {};
ids.forEach((id) => { els[id] = element(id); });
let made = null;
const sandbox = {
  console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, parseInt, isNaN, Promise,
  setTimeout: () => 0, clearTimeout: () => {},
  FileReader: function () {},
  document: { readyState: 'complete', getElementById: (id) => els[id] || null, addEventListener() {} },
  JSONEditor: function (el, opts) { made = new FakeJSONEditor(el, opts); return made; },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });

check('the app boots and builds its editor', !!made);
const SAMPLE = sandbox.JsonEditorApp.SAMPLE;

els.sampleBtn.click();
els.tabCode.click();
check('Code mode is on after the Code tab', made.getMode() === 'code', made.getMode());
check('Code mode shows the sample indented', made.getText() === JSON.stringify(SAMPLE, null, 2), made.getText().slice(0, 60));

els.compactBtn.click();
check('Compact in Code mode leaves one-line JSON in the editor', made.getText() === JSON.stringify(SAMPLE), made.getText().slice(0, 60));
check('…and the document is unchanged', JSON.stringify(JSON.parse(made.getText())) === JSON.stringify(SAMPLE));
check('…and Code mode stays on', made.getMode() === 'code', made.getMode());
check('the status says Compacted', els.status.textContent === 'Compacted', els.status.textContent);

els.formatBtn.click();
check('Format in Code mode brings the indentation back', made.getText() === JSON.stringify(SAMPLE, null, 2), made.getText().slice(0, 60));

made.setText('{"a": [1,   2],\n "b":{"c":true}}');
els.compactBtn.click();
check('Compact squeezes text typed in Code mode', made.getText() === '{"a":[1,2],"b":{"c":true}}', made.getText());

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nAll json-editor Compact checks green.');
