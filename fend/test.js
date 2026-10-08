// FEND HAS TO CONVERT 1 FT TO CM — AND SAY SO WHEN IT CANNOT.
//
// The GIF ships printfn's wasm engine. This suite boots that engine in a vm
// (same glue as the GIF: classic IIFE, bytes in, no fetch) and evaluates the
// fixtures the listing claims. Then it boots the REAL app.js on a small DOM
// built from the app's own index.html and presses its buttons: the phone
// keypad types a line, Enter answers it, a miss shows the engine's sentence,
// the pad is saved and comes back on the next open, an engine that will not
// start leaves the app dead with the MISS line, and nothing touches the
// network. If this box cannot instantiate wasm, the same presses run against
// a JS engine with the known answers.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// ---- a tiny DOM, built from the app's own index.html ------------------------
// Enough of the DOM for the app's real script to boot and for a test to press
// its buttons: ids, attributes, hidden/disabled, classList, textContent,
// innerHTML (parsed into children), click/keydown/submit with bubbling.
function anything() {
  const store = new Map();
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (!store.has(k)) store.set(k, anything());
      return store.get(k);
    },
    set(t, k, v) { store.set(k, v); return true; },
    apply() { return anything(); },
    construct() { return anything(); },
  });
  return p;
}
function makeDom(html) {
  const byId = new Map();
  const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr', 'source']);
  const decode = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.attrs = {};
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.style = {};
      this.dataset = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.className = '';
      this._text = '';
      this.onclick = null;
      this.width = 640; this.height = 400;
      this.scrollTop = 0; this.scrollHeight = 0;
      const self = this;
      this.classList = {
        _l() { return self.className.split(/\s+/).filter(Boolean); },
        add(...c) { const l = this._l(); c.forEach((x) => { if (l.indexOf(x) < 0) l.push(x); }); self.className = l.join(' '); },
        remove(...c) { self.className = this._l().filter((x) => c.indexOf(x) < 0).join(' '); },
        contains(c) { return this._l().indexOf(c) >= 0; },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
      };
    }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.setAttribute('id', v); }
    getAttribute(k) {
      if (k === 'class') return this.className;
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    }
    setAttribute(k, v) {
      v = String(v);
      if (k === 'class') { this.className = v; return; }
      this.attrs[k] = v;
      if (k === 'id') byId.set(v, this);
      if (k === 'hidden') this.hidden = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'value') this.value = v;
      if (k.indexOf('data-') === 0) this.dataset[k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = v;
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); if (c.attrs.id) byId.set(c.attrs.id, c); return c; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._text = String(v); }
    set innerHTML(v) { this.children = []; this._text = ''; parseInto(this, String(v)); }
    get innerHTML() { return this.children.map((c) => c.outer()).join('') || this._text; }
    outer() {
      if (this.tagName === '#TEXT') return this._text;
      const a = Object.keys(this.attrs).map((k) => ' ' + k + '="' + this.attrs[k] + '"').join('') + (this.className ? ' class="' + this.className + '"' : '');
      return '<' + this.tagName.toLowerCase() + a + '>' + this.innerHTML + '</' + this.tagName.toLowerCase() + '>';
    }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    dispatch(type, init) {
      const ev = Object.assign({ type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, init || {});
      for (let n = this; n; n = n.parentNode) {
        ev.currentTarget = n;
        if (type === 'click' && typeof n.onclick === 'function') n.onclick.call(n, ev);
        (n.listeners[type] || []).slice().forEach((f) => f.call(n, ev));
      }
      if (doc.listeners[type]) doc.listeners[type].slice().forEach((f) => f.call(doc, ev));
      return ev;
    }
    click() { return this.dispatch('click'); }
    closest(sel) {
      for (let n = this; n; n = n.parentNode) if (matches(n, sel)) return n;
      return null;
    }
    querySelectorAll(sel) { return all(this).filter((n) => matches(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    focus() {} blur() {} setSelectionRange() {} setPointerCapture() {}
    getContext() { return anything(); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 400 }; }
  }
  function all(root) { const out = []; (function w(n) { n.children.forEach((c) => { if (c.tagName !== '#TEXT') { out.push(c); w(c); } }); })(root); return out; }
  // Selectors used by tests only: #id, .class, tag, [attr="v"], [attr].
  function matches(n, sel) {
    if (!n.attrs) return false;
    return sel.split(',').some((s) => {
      s = s.trim();
      const m = /^([a-z0-9]*)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(s);
      if (!m) return false;
      if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
      const parts = m[2].match(/[#.][\w-]+/g) || [];
      for (const p of parts) {
        if (p[0] === '#' && n.id !== p.slice(1)) return false;
        if (p[0] === '.' && !n.classList.contains(p.slice(1))) return false;
      }
      const at = m[3].match(/\[[^\]]+\]/g) || [];
      for (const a of at) {
        const q = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
        if (!q) return false;
        const v = n.getAttribute(q[1]);
        if (v === null || (q[2] !== undefined && v !== q[2])) return false;
      }
      return true;
    });
  }
  function text(s) { const t = new El('#text'); t._text = decode(s); return t; }
  function parseInto(root, src) {
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) { if (m[4]) top.appendChild(text(m[4])); continue; }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; } continue; }
      const el = new El(tag);
      const ar = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3]))) el.setAttribute(a[1], decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : ''));
      top.appendChild(el);
      if (tag === 'script' || tag === 'style') {
        const end = src.toLowerCase().indexOf('</' + tag, re.lastIndex);
        re.lastIndex = end < 0 ? src.length : end;
        continue;
      }
      if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
  const doc = {
    readyState: 'complete',
    listeners: {},
    documentElement: new El('html'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (t) => new El(t),
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
    querySelector: (s) => doc.documentElement.querySelector(s),
  };
  parseInto(doc.documentElement, html);
  doc.body = doc.documentElement.querySelector('body') || doc.documentElement;
  return doc;
}
// ---- a tiny stylesheet cascade ---------------------------------------------
// What a selector resolves to at a viewport width: the last declaration from a
// rule whose selector list names it, inside no @media or a matching one.
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
  let m;
  const add = (media, sel, body) => {
    const decls = {};
    body.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    rules.push({ media: media ? media.trim() : null, sels: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
  };
  while ((m = re.exec(css))) {
    if (m[1] !== undefined) {
      const inner = /([^{}]+)\{([^{}]*)\}/g;
      let r;
      while ((r = inner.exec(m[2]))) add(m[1], r[1], r[2]);
    } else add(null, m[3], m[4]);
  }
  return rules;
}
function mediaOk(media, width) {
  if (!media) return true;
  const max = /max-width:\s*(\d+)px/.exec(media), min = /min-width:\s*(\d+)px/.exec(media);
  return (!max || width <= +max[1]) && (!min || width >= +min[1]);
}
function cssValue(rules, sel, prop, width) {
  let v = null;
  rules.forEach((r) => { if (r.sels.indexOf(sel) >= 0 && mediaOk(r.media, width) && prop in r.decls) v = r.decls[prop]; });
  return v;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = src('index.html');
const css = src('style.css');
const appSrc = src('app.js');
const help = src('help.md');
const listing = JSON.parse(src('listing.json'));
const manifest = JSON.parse(src('manifest.json'));
const WASM = fs.readFileSync(path.join(APP, 'vendor/fend_wasm_bg.wasm'));
const GLUE = src('vendor/fend_wasm.js');

// Every network call the app makes, from any boot in this file. It must stay empty.
const NET = [];
function loadApp(extra) {
  const sandbox = Object.assign({
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error,
    Uint8Array, Int32Array, DataView, TextEncoder, TextDecoder, WebAssembly,
    setTimeout: () => 0, clearTimeout: () => {},
    Promise, Map,
    performance: { now: () => Date.now() },
    fetch: (u) => { NET.push('fetch ' + u); return new Promise(() => {}); },
    XMLHttpRequest: function () { NET.push('xhr'); },
    WebSocket: function (u) { NET.push('ws ' + u); },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    document: {
      readyState: 'complete',
      getElementById: () => null,
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        style: {}, setAttribute: () => {}, appendChild: () => {},
        addEventListener: () => {}, textContent: '', className: ''
      }),
      body: { classList: { add: () => {} } }
    }
  }, extra || {});
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

// A JS stand-in for the engine with the known answers, for a box that cannot
// instantiate wasm. It keeps variables the way the engine does: JSON in, JSON out.
const FAKE_ANSWERS = {
  '1 ft to cm': '30.48 cm', '2 + 2': '4', '5 kg in lb': '11.0231131092 lbs',
};
function fakeEngine(log) {
  return {
    initSync(arg) { if (log) log.init = arg; },
    evaluateFendWithVariablesJson(q, ms, vars) {
      const v = JSON.parse(vars || '{}');
      let m;
      if (FAKE_ANSWERS[q]) return JSON.stringify({ ok: true, result: FAKE_ANSWERS[q], variables: JSON.stringify(v) });
      if ((m = /^(\w+) = (\d+)$/.exec(q))) { v[m[1]] = +m[2]; return JSON.stringify({ ok: true, result: m[2], variables: JSON.stringify(v) }); }
      if ((m = /^(\w+) \* (\d+)$/.exec(q)) && m[1] in v) return JSON.stringify({ ok: true, result: String(v[m[1]] * m[2]), variables: JSON.stringify(v) });
      return JSON.stringify({ ok: false, message: "unknown identifier '" + q + "'" });
    },
  };
}

// Boot the real app.js on the DOM from index.html. opts.engine: 'real' (the
// packed wasm, same bytes the build packs), 'fake', or 'none'. opts.store is
// the private 'save' collection, shared between boots to model reopening.
async function bootFend(opts) {
  opts = opts || {};
  const doc = makeDom(html);
  const store = opts.store || new Map();
  const timers = [];
  const opened = [];
  let back = null;
  const saveDb = {
    get: (id) => Promise.resolve(store.has(id) ? JSON.parse(JSON.stringify(store.get(id))) : null),
    put: (rec) => { store.set(rec.id, JSON.parse(JSON.stringify(rec))); return Promise.resolve(rec); },
  };
  const box = loadApp({
    document: doc,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
    gifos: { db: (n) => { opened.push(n); return saveDb; }, onBack: (f) => { back = f; } },
  });
  const engLog = {};
  if (opts.engine === 'real') {
    vm.runInContext(GLUE, box, { filename: 'fend_wasm.js' });
    // The glue tells {module} from a bare module by its prototype; an object
    // literal made inside the vm has the vm's Object.prototype, which a page
    // never has. Re-make the same object on this side; the bytes are untouched.
    const init = box.Fend.initSync;
    box.Fend.initSync = (arg) => init(arg && arg.module ? { module: arg.module } : arg);
    box.FEND_WASM_B64 = opts.b64 !== undefined ? opts.b64 : WASM.toString('base64');
  } else if (opts.engine === 'fake') {
    box.Fend = fakeEngine(engLog);
    box.FEND_WASM_B64 = opts.b64 !== undefined ? opts.b64 : Buffer.from([0, 97, 115, 109]).toString('base64');
  }
  if (opts.before) opts.before(box);
  vm.runInContext(appSrc, box, { filename: 'app.js' });
  await new Promise((r) => setImmediate(r));
  const $ = (id) => doc.getElementById(id);
  return {
    doc, box, store, opened, engLog, $,
    back: () => back,
    flush() { timers.splice(0).forEach((f) => f && f()); },
    key(token, where) { const b = $(where || 'pad').querySelector('button[data-token="' + token + '"]'); if (b) b.click(); return !!b; },
    chip(token) { return this.key(token, 'chips'); },
    enter(line) { $('input').value = line; $('form').dispatch('submit'); },
    lines() { return $('log').querySelectorAll('.line').length; },
    answers() { return $('log').querySelectorAll('.ans').map((n) => n.textContent); },
    misses() { return $('log').querySelectorAll('.bad').map((n) => n.textContent); },
  };
}

(async () => {
// ---- manifest / listing: the platform reads these fields ---------------------
check('capabilities.wasm and db, no network',
  !!(manifest.capabilities && manifest.capabilities.wasm === true &&
     manifest.capabilities.db === true && !manifest.capabilities.network));
check('minBuild stays 947', manifest.minBuild === 947);
check('the save collection is private', manifest.data && manifest.data.save && manifest.data.save.visibility === 'private');
check('listing author is printfn, porter GifOS, unofficial',
  listing.author && listing.author.name === 'printfn' &&
  listing.porter && listing.porter.name === 'GifOS' &&
  listing.basedOn && listing.basedOn.blessed === false);
// TEXT-CHECK: help.md is a document; there is no behaviour to run, only that the page exists with content.
check('help.md is a real page', help.trim().length >= 400);

// ---- the stylesheet: the pad is the keyboard at phone width -----------------
// A vm has no layout, so the cascade is resolved here: at 400px the pad is a
// grid, at desktop width it is not shown, and its keys are thumb-sized.
{
  const rules = cssRules(css);
  check('the pad shows as a grid at phone width', cssValue(rules, '.pad', 'display', 400) === 'grid',
    cssValue(rules, '.pad', 'display', 400));
  check('the pad is hidden at desktop width', cssValue(rules, '.pad', 'display', 1280) === 'none',
    cssValue(rules, '.pad', 'display', 1280));
  const mh = parseFloat(cssValue(rules, '.pad button', 'min-height', 400));
  check('pad keys are at least 44px tall', mh >= 44, mh);
}

// ---- glue: insertToken builds the signature line; answerOf is honest --------
const sandbox = loadApp();
vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
const A = sandbox.FendApp;
check('app.js exports FendApp', !!(A && A.evaluate && A.insertToken && A.answerOf && A.MISS));

{
  let cur = '';
  cur = A.insertToken(cur, '1', 'key');
  cur = A.insertToken(cur, 'ft', 'unit');
  cur = A.insertToken(cur, 'to', 'word');
  cur = A.insertToken(cur, 'cm', 'unit');
  check('insertToken types 1 ft to cm on the phone pad', cur === '1 ft to cm', cur);
  check('backspace drops the last character', A.insertToken('1 ft', '⌫', 'bksp') === '1 f');
  check('space is a no-op on an empty prompt', A.insertToken('', 'spc', 'spc') === '');
}

check('empty input is skipped, not an error line',
  !!(A.evaluate('', '{}', { evaluateFendWithVariablesJson: () => { throw new Error('should not run'); } }).skip));

{
  const fake = {
    evaluateFendWithVariablesJson: function (q) {
      const known = {
        '1 ft to cm': { ok: true, result: '30.48 cm', variables: '{}' },
        '2 + 2': { ok: true, result: '4', variables: '{}' },
        'nope': { ok: false, message: "unknown identifier 'nope'" }
      };
      return JSON.stringify(known[q] || { ok: false, message: 'unknown' });
    }
  };
  const ok = A.evaluate('1 ft to cm', '{}', fake);
  check('wrapper: 1 ft to cm is 30.48 cm', ok.ok && ok.a === '30.48 cm', ok);
  const bad = A.evaluate('nope', '{}', fake);
  check('wrapper: a miss is the engine sentence, not "error"',
    !bad.ok && bad.a === "unknown identifier 'nope'", bad);
  check('answerOf reads message when ok is false',
    A.answerOf({ ok: false, message: 'exchange rates are not available' }) ===
      'exchange rates are not available');
}

// ---- real engine, if this box can instantiate the packed wasm ---------------
let engine = null;
try {
  const engBox = loadApp();
  vm.runInContext(GLUE, engBox, { filename: 'fend_wasm.js' });
  if (!engBox.Fend || typeof engBox.Fend.initSync !== 'function') throw new Error('no Fend.initSync');
  engBox.Fend.initSync({ module: WASM });
  engine = engBox.Fend;
  check('wasm boots in the vm (initSync from bytes)', true);
} catch (e) {
  check('wasm boots in the vm (initSync from bytes)', false, String(e && e.message || e));
}

if (engine) {
  const ft = A.evaluate('1 ft to cm', '{}', engine);
  check('1 ft to cm is 30.48 cm', ft.ok && ft.a === '30.48 cm', ft);
  const kg = A.evaluate('5 kg in lb', '{}', engine);
  check('5 kg in lb names pounds', kg.ok && /lb/i.test(kg.a), kg);
  const c = A.evaluate('100 C to F', '{}', engine);
  check('100 C to F is 212 °F', c.ok && /212/.test(c.a) && /F/.test(c.a), c);
  const sum = A.evaluate('2 + 2 * 3', '{}', engine);
  check('2 + 2 * 3 is 8', sum.ok && sum.a === '8', sum);
  const hex = A.evaluate('0xFF', '{}', engine);
  check('0xFF is hex 0xff', hex.ok && /ff/i.test(hex.a), hex);
  const sin = A.evaluate('sin(pi / 2)', '{}', engine);
  check('sin(pi / 2) is 1', sin.ok && sin.a === '1', sin);
  const a = A.evaluate('a = 3', '{}', engine);
  const twice = A.evaluate('a * 2', a.vars, engine);
  check('variables stick: a = 3 then a * 2 is 6', twice.ok && twice.a === '6', twice);
  const nope = A.evaluate('nope', '{}', engine);
  check('unknown identifier is a sentence, not "error"',
    !nope.ok && /unknown identifier/.test(nope.a) && nope.a !== 'error', nope);
  const fx = A.evaluate('1 USD to GBP', '{}', engine);
  check('currency without a network is refused honestly',
    !fx.ok && /not available/i.test(fx.a), fx);
  const roll = A.evaluate('roll 4d6', '{}', engine);
  check('roll 4d6 is a number between 4 and 24',
    roll.ok && /^\d+$/.test(roll.a) && Number(roll.a) >= 4 && Number(roll.a) <= 24, roll);
} else {
  console.log('NOTE — wasm did not instantiate here; the app runs below on the JS engine only.');
}
const ENGINE = engine ? 'real' : 'fake';

// ---- the real app on its own page -------------------------------------------
{
  // The phone pad and the unit chips type the signature line; Enter answers it.
  const app = await bootFend({ engine: ENGINE });
  check('the app boots live (not marked dead)', !app.doc.body.classList.contains('dead'));
  check('the input starts with the phone keypad as its keyboard',
    app.$('input').getAttribute('inputmode') === 'none', app.$('input').getAttribute('inputmode'));
  const typed = app.key('1') && app.chip('ft') && app.chip('to') && app.chip('cm');
  check('pressing 1, ft, to, cm on the pad types 1 ft to cm', typed && app.$('input').value === '1 ft to cm',
    app.$('input').value);
  app.key('⌫');
  check('the pad delete key drops a character', app.$('input').value === '1 ft to c', app.$('input').value);
  app.$('input').value = '1 ft to cm';
  app.key('=');
  check('the pad Enter key answers the line: 30.48 cm', app.answers().join('|') === '30.48 cm', app.answers());
  check('...and clears the prompt for the next line', app.$('input').value === '');

  // The abc key hands the input to the OS keyboard; any pad key takes it back.
  app.chip('abc');
  check('abc switches the input to the OS keyboard',
    app.$('input').getAttribute('inputmode') === 'text' && app.$('abc').getAttribute('aria-pressed') === 'true');
  app.key('7');
  check('a pad key switches back to the pad', app.$('input').getAttribute('inputmode') === 'none' &&
    app.$('abc').getAttribute('aria-pressed') === 'false' && app.$('input').value === '7');
  const back = app.back();
  check('Back first leaves a half-typed line empty, then lets the OS go back',
    !!back && back() === true && app.$('input').value === '' && back() === false);

  // A line that does not calculate shows the engine's own sentence.
  app.enter('nope');
  const miss = app.misses();
  check('a miss shows the engine\'s sentence on the pad', miss.length === 1 && /unknown identifier/.test(miss[0]), miss);
  check('...and the same sentence in the status line', app.$('status').textContent === miss[0],
    app.$('status').textContent);

  // The pad is written to the private 'save' collection as 'last'.
  app.enter('a = 3');
  app.flush();
  const saved = app.store.get('last');
  check('the pad is saved to the save collection as last',
    app.opened.indexOf('save') >= 0 && !!saved && Array.isArray(saved.lines) && saved.lines.length === 3, saved);

  // Reopen on the same collection: the pad and its variables come back.
  const again = await bootFend({ engine: ENGINE, store: app.store });
  check('the last pad comes back on the next open', again.lines() === 3 && again.answers()[0] === '30.48 cm',
    { lines: again.lines(), answers: again.answers() });
  again.enter('a * 2');
  check('...with its variables: a * 2 is 6', again.answers().slice(-1)[0] === '6', again.answers());

  // Clear empties the pad and the saved copy.
  again.$('clear').click();
  again.flush();
  check('Clear empties the pad and the saved copy',
    again.lines() === 0 && again.store.get('last').lines.length === 0, again.store.get('last'));
}

{
  // An empty pad offers examples; pressing one answers it.
  const app = await bootFend({ engine: ENGINE });
  const row = app.$('log').querySelector('.examples');
  const ex = row ? row.querySelectorAll('button') : [];
  check('an empty pad offers one button per example', ex.length === A.EXAMPLES.length && ex.length > 0, ex.length);
  const ft = ex.filter((b) => b.textContent === '1 ft to cm')[0];
  if (ft) ft.click();
  check('pressing the 1 ft to cm example answers it', !!ft && app.answers()[0] === '30.48 cm', app.answers());
}

{
  // The engine is started from the packed bytes, not fetched.
  const bytes = [0, 97, 115, 109, 1, 0, 0, 0, 7, 250];
  const app = await bootFend({ engine: 'fake', b64: Buffer.from(bytes).toString('base64') });
  const got = app.engLog.init && app.engLog.init.module;
  check('the engine starts from the packed bytes (initSync gets them)',
    !!got && got.length === bytes.length && Array.from(got).every((b, i) => b === bytes[i]), got && Array.from(got));
}

{
  // No engine: the app is dead and says the MISS line, three ways.
  const none = await bootFend({ engine: 'none' });
  check('no engine: the app is marked dead', none.doc.body.classList.contains('dead'));
  check('...and the status line is the MISS sentence', none.$('status').textContent === A.MISS, none.$('status').textContent);
  const noBytes = await bootFend({ engine: 'fake', b64: '' });
  check('no packed bytes: dead with the MISS sentence',
    noBytes.doc.body.classList.contains('dead') && noBytes.$('status').textContent === A.MISS);
  const throws = await bootFend({ engine: 'fake', before: (b) => { b.Fend.initSync = () => { throw new Error('CompileError'); }; } });
  check('bytes that will not compile: dead with the MISS sentence',
    throws.doc.body.classList.contains('dead') && throws.$('status').textContent === A.MISS);
}

check('nothing the app did touched the network (fetch, XHR, WebSocket)', NET.length === 0, NET);
// TEXT-CHECK: "never the network" covers every code path, not only the ones
// driven above, so the shipped app.js is also scanned.
check('app.js has no fetch / XHR / WebSocket on any path',
  !appSrc.includes('fetch(') && !appSrc.includes('XMLHttpRequest') && !appSrc.includes('WebSocket'));

if (failures) {
  console.log(failures + ' failure(s)');
  process.exit(1);
}
console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
