// JSON DIFF HAS TO ACTUALLY DIFF.
//
// The wrap shipped two paste boxes around jsondiffpatch, but nothing in the
// repo played a pair: empty sides went silent, invalid JSON blanked the
// difference pane, and list items were matched only by position. This suite
// loads the pinned UMD + app.js in a vm and diffs real documents — so a
// formatter regression, a swallowed parse error, or a dead objectHash cannot
// ship again. Phone/input rules a vm cannot run are pinned by source scan.
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
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error,
    parseInt, isNaN, Promise, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  sandbox.document = null;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'jsondiffpatch.umd.js'), 'utf8'), sandbox, { filename: 'jsondiffpatch.umd.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = load();
const App = sandbox.JsonDiffApp;
const J = sandbox.jsondiffpatch;

check('jsondiffpatch UMD attaches', !!(J && typeof J.diff === 'function' && J.formatters && J.formatters.html));
check('app.js exports parseJson / diffPair / compareTexts', !!(App && App.parseJson && App.diffPair && App.compareTexts));

{
  const p = App.parseJson('');
  check('empty string is empty, not a parse error', !!(p.empty && !p.error && !('value' in p)));
  check('whitespace-only is empty', !!App.parseJson('  \n\t  ').empty);
}

{
  const p = App.parseJson('{');
  check('truncated JSON is an error, with a message', !!(p.error && typeof p.message === 'string' && p.message.trim()), p);
  check('…and does not invent a value', p.value === undefined);
}

{
  const p = App.parseJson('{not json}');
  check('invalid JSON is an error', !!(p.error && p.message));
}

{
  const p = App.parseJson('{"a": 1}');
  check('valid object parses', p.value && p.value.a === 1);
  check('valid array parses', App.parseJson('[1,2]').value[1] === 2);
  check('valid primitive parses', App.parseJson('true').value === true);
  check('null parses as null, not empty', App.parseJson('null').value === null);
}

{
  // Each case gets its own message: the reader is told WHICH side, not just
  // "something is wrong". (Assert the cases are told apart, not their words.)
  const c = App.compareTexts('', '');
  const L = App.compareTexts('', '{"a":1}');
  const R = App.compareTexts('{"a":1}', '   ');
  const bad = App.compareTexts('{', '{"a":1}');
  const badR = App.compareTexts('{"a":1}', '{');
  const mixed = App.compareTexts('{', '');
  const msgs = [c, L, R, bad, badR, mixed].map((x) => x.message);
  check('two empty sides say so', !!(c.empty && c.message && c.message.trim()), c);
  check('empty left and empty right are named apart', !!(L.empty && R.empty && L.message && R.message && L.message !== R.message && L.message !== c.message && R.message !== c.message), { L, R });
  check('invalid vs valid refuses to compare, naming the bad side', !!(bad.invalid && badR.invalid && bad.message && bad.message !== badR.message && !bad.delta), { bad, badR });
  check('invalid left and empty right names both', !!(mixed.invalid && mixed.message && mixed.message !== bad.message && mixed.message !== R.message), mixed);
  check('every case has a message of its own', new Set(msgs).size === msgs.length, msgs);
}

{
  const d = App.diffPair({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }, { matchById: false });
  check('modified field is in the delta', d.delta && d.delta.b && d.delta.b[0] === 2 && d.delta.b[1] === 3, d.delta);
  check('added field is in the delta', d.delta && d.delta.c && d.delta.c[0] === 4, d.delta);
  check('html formatter paints the delta', typeof d.html === 'string' && d.html.indexOf('jsondiffpatch') >= 0);
  check('JSON view is stringify of the delta', d.json && d.json.indexOf('"b"') >= 0);
  check('JSON Patch view is a list of ops', typeof d.patch === 'string' && d.patch.indexOf('replace') >= 0 && d.patch.indexOf('/b') >= 0, d.patch);
  check('stats count added and changed', d.stats && d.stats.added >= 1 && d.stats.changed >= 1, d.stats);
}

{
  const same = App.diffPair({ a: 1 }, { a: 1 }, { matchById: false });
  check('equal documents are same, not an empty object', !!(same.same && same.delta === undefined), same);
}

{
  const left = JSON.parse(App.SAMPLE_LEFT);
  const right = JSON.parse(App.SAMPLE_RIGHT);
  const withId = App.diffPair(left, right, { matchById: true });
  const noId = App.diffPair(left, right, { matchById: false });
  check('sample pair diffs', !!(withId.delta && !withId.same));
  check('sample html has an added bit', /jsondiffpatch-added/.test(withId.html || ''));
  check('sample html has a modified bit', /jsondiffpatch-modified/.test(withId.html || ''));
  const items = withId.delta && withId.delta.items;
  check('match-by-id treats the items list as an array delta', !!(items && items._t === 'a'), items);
  const removedX = items && (items._0 || items['_0']);
  check('item id=x is removed, not shifted', !!(removedX && removedX[2] === 0 && removedX[0] && removedX[0].id === 'x'), removedX);
  check('positional match of the same lists is a different delta', JSON.stringify(withId.delta.items) !== JSON.stringify(noId.delta && noId.delta.items));
}

{
  const left = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const right = [{ id: 'b', n: 3 }, { id: 'a', n: 1 }];
  const hashed = App.diffPair(left, right, { matchById: true });
  check('reordered objects with ids are not rewritten as whole-list churn', hashed.stats && hashed.stats.changed <= 1 && hashed.stats.added === 0 && hashed.stats.removed === 0, hashed.stats);
  const moved = hashed.delta && hashed.delta._t === 'a';
  check('array delta still records the move', !!moved, hashed.delta);
}

{
  const cmp = App.compareTexts(App.SAMPLE_LEFT, App.SAMPLE_RIGHT, { matchById: true });
  check('compareTexts of the sample yields html + json + patch', !!(cmp.html && cmp.json && cmp.patch && cmp.stats));
  const fs1 = App.formatStats(cmp.stats);
  check('formatStats carries the counts', typeof fs1 === 'string' && ['added', 'removed', 'changed'].every((k) => !cmp.stats[k] || fs1.indexOf(String(cmp.stats[k])) >= 0) && App.formatStats({ added: 2 }) !== App.formatStats({ removed: 2 }), fs1);
}

// ---- the page, booted -------------------------------------------------------
// index.html over a small DOM, its own scripts in order; the phone tabs and
// Back are used, and every network door is a trap.
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

function bootDiff(opts) {
  opts = opts || {};
  const traps = []; let back = null;
  const trap = (n) => function () { traps.push(n); throw new Error(n + ' is not allowed here'); };
  const media = opts.phone ? { '(max-width: 640px)': true, '(max-width: 700px)': true, '(pointer: coarse)': true } : {};
  const dom = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), { media, globals: {
    fetch: trap('fetch'), XMLHttpRequest: trap('XMLHttpRequest'), WebSocket: trap('WebSocket'), innerWidth: opts.phone ? 390 : 1280,
    gifos: { db: () => ({ get: () => Promise.resolve(null), getAll: () => Promise.resolve([]), put: () => Promise.resolve(), subscribe() {} }), onBack: (fn) => { back = fn; }, me: () => Promise.resolve({ id: 'local' }) },
  } });
  let error = null;
  try { for (const s of dom.scripts) if (s.src) dom.run(fs.readFileSync(path.join(APP, s.src), 'utf8'), s.src); } catch (e) { error = e; }
  return { dom, traps, error, back: () => back, $: (id) => dom.document.getElementById(id) };
}
(async () => {
  {
    const P = bootDiff({ phone: true });
    await new Promise((r) => setTimeout(r, 30));
    const tabs = ['tabLeft', 'tabRight', 'tabDiff'].map((id) => P.$(id));
    check('phone tabs exist (Left, Right, Difference)', !P.error && tabs.every((t) => t && t.tagName === 'BUTTON'), P.error && String(P.error));
    const shows = (i, cls) => { tabs[i].click(); return P.dom.document.body.classList.contains(cls) && tabs[i].getAttribute('aria-selected') === 'true' && tabs.every((t, j) => j === i || t.getAttribute('aria-selected') === 'false'); };
    check('…and each tab shows its pane', shows(1, 'tab-right') && shows(0, 'tab-left') && shows(2, 'tab-diff'));
    const fn = P.back();
    const first = fn && fn();
    check('Back is registered: on a phone it returns to the Left pane first', first === true && P.dom.document.body.classList.contains('tab-left'));
    check('…then lets the OS go back', fn && fn() === false);
    // TEXT-CHECK: which screen counts as a phone is a CSS media query.
    check('…with the phone layout in the stylesheet', /@media[^{]*max-width:\s*640px/.test(fs.readFileSync(path.join(APP, 'style.css'), 'utf8')));
    P.$('sampleBtn').click(); P.$('swapBtn').click(); P.$('prettyBtn').click(); P.$('viewPatch').click(); P.$('clearBtn').click();
    await new Promise((r) => setTimeout(r, 30));
    check('app.js does not fetch (a session: tabs, sample, swap, pretty, views, clear)', P.traps.length === 0, P.traps);
    // TEXT-CHECK: a forbidden API anywhere in app.js; execution covers the paths driven above.
    const src = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
    check('…nor names a network API anywhere', !/\bfetch\(/.test(src) && !src.includes('XMLHttpRequest'));
    const els = P.dom.document.querySelectorAll('*');
    check('no in-app Invite button', !els.some((e) => /invite/i.test(e.id) || ((e.tagName === 'BUTTON' || e.tagName === 'A') && /^\s*invite\s*$/i.test(e.textContent))));
    check('index.html loads nothing remote (every src and href is a file in the GIF)', els.every((e) => !/^(https?:)?\/\//i.test(e.attrs.src || '') && !/^(https?:)?\/\//i.test(e.attrs.href || '')));
  }
  {
    const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
    check('capabilities.db and multiplayer stay declared', !!(m.capabilities && m.capabilities.db === true && m.capabilities.multiplayer === true && m.minBuild === 947));
  }
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll json-diff checks passed.');
})().catch((e) => { console.error(e); process.exit(1); });
