// PIVOT HAS TO ACTUALLY PIVOT.
//
// The wrap shipped Papa Parse + PivotTable.js, but nothing in the repo counted
// a cell: empty CSV still called pivotUI, Excel files were read as text, and
// phone drag was claimed without a fallback. This suite loads the pinned
// vendor (Papa + a jQuery stub + PivotData) and app.js in a vm, parses the
// baked MP sample, and asserts the Quebec×NDP count — so a parser or
// aggregator regression cannot ship again. The page itself is booted over a
// small DOM from index.html, and its phone controls are used.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function jqueryStub() {
  const $ = function () {
    const api = {
      length: 0,
      pivotUI: function () { return api; },
      each: function () { return api; },
      text: function () { return ''; },
      heatmap: function () { return api; },
      barchart: function () { return api; },
    };
    return api;
  };
  $.extend = function (tgt) {
    let i = 1;
    if (typeof tgt === 'boolean') { tgt = arguments[1] || {}; i = 2; }
    tgt = tgt || {};
    for (; i < arguments.length; i++) {
      const s = arguments[i];
      if (!s) continue;
      Object.keys(s).forEach((k) => { tgt[k] = s[k]; });
    }
    return tgt;
  };
  $.isArray = Array.isArray;
  $.isFunction = (f) => typeof f === 'function';
  $.isEmptyObject = (o) => {
    if (!o) return true;
    for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return false;
    return true;
  };
  $.fn = {};
  return $;
}

function load() {
  const $ = jqueryStub();
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error,
    parseInt, parseFloat, isNaN, isFinite, Promise, setTimeout, clearTimeout,
    jQuery: $, $: $,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.document = {
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  vm.createContext(sandbox);
  const run = (rel) => {
    vm.runInContext(fs.readFileSync(path.join(APP, rel), 'utf8'), sandbox, { filename: rel });
  };
  run('vendor/papaparse.min.js');
  run('vendor/pivot.js');
  run('vendor/export_renderers.js');
  run('vendor/sample.js');
  run('app.js');
  return sandbox;
}

const sandbox = load();
const App = sandbox.PivotApp;
const Papa = sandbox.Papa;
const utils = sandbox.$ && sandbox.$.pivotUtilities;

check('Papa Parse attaches', !!(Papa && typeof Papa.parse === 'function'));
check('PivotData and aggregators attach', !!(utils && utils.PivotData && utils.aggregators && utils.aggregators.Count));
check('app.js exports parseTable / pivotValue', !!(App && App.parseTable && App.pivotValue));
check('baked MP sample is aboard (it parses with Name, Party, Province first)', typeof sandbox.PIVOT_SAMPLE_CSV === 'string' && (App.parseTable(sandbox.PIVOT_SAMPLE_CSV, Papa).fields || []).slice(0, 3).join() === 'Name,Party,Province');

{
  const empty = App.parseTable('', Papa);
  check('empty CSV is empty, not a grid (and says something)', !!(empty.empty && !empty.error && typeof empty.message === 'string' && empty.message.trim()), empty);
  check('whitespace-only is empty', !!App.parseTable('  \n\t  ', Papa).empty);
}

{
  const headerOnly = App.parseTable('item,region,qty\n', Papa);
  check('header with no data rows is an error, with its own message', !!(headerOnly.error && typeof headerOnly.message === 'string' && headerOnly.message.trim() && headerOnly.message !== App.parseTable('', Papa).message), headerOnly);
}

{
  const badHeader = App.parseTable('\n\n', Papa);
  check('no header is empty or error, never a silent grid', !!(badHeader.empty || badHeader.error), badHeader);
}

{
  const parsed = App.parseTable(sandbox.PIVOT_SAMPLE_CSV, Papa);
  check('sample parses with fields', !!(parsed.data && parsed.fields && parsed.fields.indexOf('Province') >= 0 && parsed.fields.indexOf('Party') >= 0), parsed.fields);
  check('sample has hundreds of MP rows', parsed.rows > 200 && parsed.rows < 400, parsed.rows);

  let quebecNdp = 0, ontarioLib = 0, total = 0;
  for (let i = 1; i < parsed.data.length; i++) {
    const rec = {};
    parsed.fields.forEach((k, j) => { rec[k] = parsed.data[i][j]; });
    total++;
    if (rec.Province === 'Quebec' && rec.Party === 'NDP') quebecNdp++;
    if (rec.Province === 'Ontario' && rec.Party === 'Liberal') ontarioLib++;
  }
  check('manual count of the sample ran', total === parsed.rows, { total: total, rows: parsed.rows });

  const cell = App.pivotValue(parsed.data, {
    aggregatorName: 'Count',
    rows: ['Province'],
    cols: ['Party'],
    rowKey: ['Quebec'],
    colKey: ['NDP']
  }, utils);
  check('PivotData Count of Quebec × NDP matches the CSV', cell === quebecNdp, { cell: cell, quebecNdp: quebecNdp });

  const ont = App.pivotValue(parsed.data, {
    aggregatorName: 'Count',
    rows: ['Province'],
    cols: ['Party'],
    rowKey: ['Ontario'],
    colKey: ['Liberal']
  }, utils);
  check('PivotData Count of Ontario × Liberal matches the CSV', ont === ontarioLib, { ont: ont, ontarioLib: ontarioLib });

  const grand = App.pivotValue(parsed.data, {
    aggregatorName: 'Count',
    rows: ['Province'],
    cols: ['Party'],
    rowKey: [],
    colKey: []
  }, utils);
  check('grand total is every MP', grand === parsed.rows, { grand: grand, rows: parsed.rows });

  const avg = App.pivotValue(parsed.data, {
    aggregatorName: 'Average',
    rows: [],
    cols: [],
    vals: ['Age'],
    rowKey: [],
    colKey: []
  }, utils);
  check('Average of Age is a plausible number of years', typeof avg === 'number' && avg > 30 && avg < 70, avg);
}

{
  check('xlsx is refused', App.looksSpreadsheet('budget.xlsx') === true);
  check('xls is refused', App.looksSpreadsheet('old.xls') === true);
  check('csv is allowed', App.looksSpreadsheet('seats.csv') === false);
}

{
  const tiny = App.parseTable('item,region,qty\nWidget,East,12\nGadget,West,5\n', Papa);
  const east = App.pivotValue(tiny.data, {
    aggregatorName: 'Sum',
    rows: ['region'],
    cols: [],
    vals: ['qty'],
    rowKey: ['East'],
    colKey: []
  }, utils);
  check('Sum of qty for East is 12', Number(east) === 12, east);
}

{
  const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  check('capabilities.db stays declared, no network', !!(m.capabilities && m.capabilities.db === true && !m.capabilities.network && m.minBuild === 947));
}
// ---- the page, booted -------------------------------------------------------
// app.js over a small DOM built from index.html, with the pinned Papa and
// PivotTable aggregators; pivotUI (the jQuery UI widget) is the stub's, and
// records what it is asked to draw.
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

function bootPivot(opts) {
  opts = opts || {};
  const drawn = [];
  const $ = jqueryStub();
  const real$ = $;
  const $wrap = function (el) { const api = real$(el); api.pivotUI = function (data, o) { drawn.push({ data, o }); return api; }; return api; };
  Object.assign($wrap, real$);
  const net = [];
  let back = null;
  const media = opts.phone ? { '(max-width: 700px)': true, '(pointer: coarse)': true } : { '(min-width: 701px)': true };
  const dom = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), { media, globals: {
    jQuery: $wrap, $: $wrap,
    fetch: (...a) => { net.push(['fetch', a]); return Promise.reject(new Error('offline')); },
    XMLHttpRequest: function () { net.push(['xhr']); this.open = () => {}; this.send = () => {}; },
    gifos: { db: () => ({ get: () => Promise.resolve(null), put: () => Promise.resolve() }), onBack: (fn) => { back = fn; } },
    FileReader: function () { const self = this; this.readAsText = (f) => { self.result = f.text; setTimeout(() => self.onload && self.onload(), 0); }; },
  } });
  for (const rel of ['vendor/papaparse.min.js', 'vendor/pivot.js', 'vendor/export_renderers.js', 'vendor/sample.js', 'app.js']) dom.run(fs.readFileSync(path.join(APP, rel), 'utf8'), rel);
  return { dom, drawn, net, back: () => back, $: (id) => dom.document.getElementById(id) };
}
const settleP = () => new Promise((r) => setTimeout(r, 20));
(async () => {
  {
    const p = bootPivot({ phone: true });
    await settleP();
    const rows = p.$('assignFields').children.filter((r) => r.className === 'assign-row');
    const prov = rows.find((r) => r.children[0].textContent === 'Province');
    check('assign panel exists for phone: one role picker per field of the table', !!p.$('assign') && rows.length >= 3 && !!prov, rows.length);
    const before = p.drawn.length;
    if (prov) { const sel = prov.children[1]; sel.value = 'rows'; sel.dispatch('change'); }
    const last = p.drawn[p.drawn.length - 1];
    check('…and picking Rows for a field redraws the pivot with it in the rows', p.drawn.length > before && last && last.o.rows.includes('Province'), last && last.o.rows);
    // TEXT-CHECK: which screens count as a phone is a CSS media query; only a
    // browser evaluates it. The stylesheet is read for the query.
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
    check('…laid out for coarse pointers', /@media[^{]*\(pointer:\s*coarse\)/.test(css));
    // Back: a phone with the paste box open closes it first, then lets go.
    p.$('pasteWrap').open = true;
    const handled = p.back() ? p.back()() : null;
    check('Back is registered: on a phone it closes the open paste box', handled === true && p.$('pasteWrap').open === false);
    check('…and with nothing open it lets the OS go back', p.back()() === false);
    // offline: nothing in the session reaches the network
    p.$('sample').click(); p.$('blank').click();
    p.$('csv').value = 'item,region,qty\nWidget,East,12\n'; p.$('csv').dispatch('input');
    p.$('file').files = [{ name: 'invented.csv', text: 'a,b\n1,2\n' }]; p.$('file').dispatch('change');
    await new Promise((r) => setTimeout(r, 450));
    check('app.js does not fetch (a whole session: sample, blank, paste, file)', p.net.length === 0 && p.drawn.length > 3, p.net);
    // TEXT-CHECK: a forbidden API anywhere in app.js; execution covers only the
    // paths driven above.
    const src = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
    check('…nor names a network API anywhere', !/\bfetch\(/.test(src) && !src.includes('XMLHttpRequest'));
    const els = p.dom.document.querySelectorAll('*');
    check('no in-app Invite button', !els.some((e) => /invite/i.test(e.id) || ((e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*invite\s*$/i.test(e.textContent))));
    check('index.html loads nothing remote (every src and href is a file in the GIF)',
      els.every((e) => !/^(https?:)?\/\//i.test(e.attrs.src || '') && !/^(https?:)?\/\//i.test(e.attrs.href || '')));
    const scripts = p.dom.scripts.filter((x) => x.src).map((x) => x.src);
    check('touch-punch is still in the GIF, after jQuery UI', scripts.indexOf('vendor/jquery.ui.touch-punch.min.js') > scripts.indexOf('vendor/jquery-ui.min.js') && scripts.indexOf('vendor/jquery-ui.min.js') >= 0, scripts);
  }
  {
    // touch-punch, run over a jQuery UI mouse: a touch on a widget becomes mouse events.
    const bound = [];
    const proto = { _mouseInit() {}, _mouseDestroy() {}, _mouseCapture: () => true };
    const jq = { support: {}, ui: { mouse: { prototype: proto } }, proxy: (o, m) => (e) => o[m](e) };
    const box = { jQuery: jq, document: { ontouchend: null, createEvent: () => ({ initMouseEvent() {} }) }, window: {} };
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(APP, 'vendor/jquery.ui.touch-punch.min.js'), 'utf8'), box);
    const widget = Object.create(proto); widget.element = { bind: (m) => bound.push(Object.keys(m).sort().join()) };
    proto._mouseInit.call(widget);
    check('touch-punch turns a widget\'s touches into mouse events (touchstart/move/end bound)', bound.join() === 'touchend,touchmove,touchstart', bound);
  }
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll pivot checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
