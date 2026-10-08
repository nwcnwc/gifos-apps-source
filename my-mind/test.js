// MY MIND HAS TO CREATE NODES AND ROUNDTRIP THE MAP IN gifos.db.
//
// The wrap shipped Ondřej Žára's editor, but the last map could vanish into
// a memory localStorage stub, the icon was a leftover pivot grid, and nothing
// in the repo grew a child then loaded it back. This suite plays the node
// loop in a vm: empty map → add child → add grandchild → put {id:'last'} →
// get it back. The phone bar, tap-to-edit, Back, the icon and the vendored
// editor's hand-off run too, on a fake DOM built from index.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

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

function mockDb() {
  const store = {};
  const subs = [];
  const db = {
    put: function (rec) {
      if (!rec || rec.id == null) rec = Object.assign({ id: 'auto' }, rec || {});
      store[rec.id] = JSON.parse(JSON.stringify(rec));
      const all = Object.keys(store).map((k) => store[k]);
      subs.forEach((cb) => cb(all));
      return Promise.resolve(JSON.parse(JSON.stringify(store[rec.id])));
    },
    get: function (id) { return Promise.resolve(store[id] ? JSON.parse(JSON.stringify(store[id])) : null); },
    getAll: function () { return Promise.resolve(Object.keys(store).map((k) => JSON.parse(JSON.stringify(store[k])))); },
    delete: function (id) { delete store[id]; return Promise.resolve(true); },
    subscribe: function (cb) { subs.push(cb); cb(Object.keys(store).map((k) => store[k])); },
    _store: store
  };
  return db;
}

function load(opts) {
  opts = opts || {};
  const save = mockDb();
  const room = mockDb();
  const collections = { save: save, room: room };
  const sandbox = {
    console, Math: seededMath(0x5AFE), Object, Array, JSON, Date, String, Number, Boolean,
    Promise, setTimeout, clearTimeout, setImmediate,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    document: opts.document || {
      readyState: 'complete',
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {}
    },
    gifos: {
      db: function (name) { return collections[name] || mockDb(); },
      me: function () { return Promise.resolve({ id: opts.meId || 'aaa', name: opts.meName || 'You' }); },
      onBack: function (cb) { sandbox._onBack = cb; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.root = sandbox;
  vm.createContext(sandbox);
  const run = (rel) => {
    vm.runInContext(fs.readFileSync(path.join(APP, rel), 'utf8'), sandbox, { filename: rel });
  };
  run('ls-stub.js');
  run('app.js');
  run('mp.js');
  return { sandbox, save, room };
}

function page(opts) {
  opts = opts || {};
  const byId = {};
  function El(tag, attrs) { this.tag = tag.toLowerCase(); this.attrs = attrs || {}; this.children = []; this.parentNode = null; this.hidden = 'hidden' in this.attrs; this.got = []; this.listeners = {}; this.style = {}; this.textContent = ''; if (this.attrs.id) { this.id = this.attrs.id; byId[this.id] = this; } }
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
  El.prototype.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
  El.prototype.focus = function () {}; El.prototype.select = function () {};
  const simple = (e, sel) => {
    const toks = sel.match(/\[[^\]]+\]|[#.]?[\w-]+/g) || [];
    return toks.every((t) => {
      if (t[0] === '#') return e.id === t.slice(1);
      if (t[0] === '.') return (' ' + (e.attrs.class || '') + ' ').indexOf(' ' + t.slice(1) + ' ') >= 0;
      if (t[0] === '[') { const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(t); return !!m && (m[2] === undefined ? m[1] in e.attrs : e.attrs[m[1]] === m[2]); }
      return e.tag === t.toLowerCase();
    });
  };
  const matches = (e, sel) => {
    const parts = sel.trim().split(/\s+(?![^\[]*\])/);
    if (!e.attrs || !simple(e, parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    for (let a = e.parentNode; a && i >= 0; a = a.parentNode) if (a.attrs && simple(a, parts[i])) i--;
    return i < 0;
  };
  El.prototype.all = function (f, out) { out = out || []; for (const c of this.children) { if (f(c)) out.push(c); c.all(f, out); } return out; };
  El.prototype.querySelector = function (sel) { return this.all((c) => matches(c, sel))[0] || null; };
  El.prototype.closest = function (sel) { for (let n = this; n && n !== doc; n = n.parentNode) if (matches(n, sel)) return n; return null; };
  El.prototype.dispatchEvent = function (ev) { this.got.push(ev.type); return true; };
  El.prototype.click = function () { this.got.push('click'); };
  El.prototype.fire = function (type, ev) {
    const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, ev || {});
    for (let n = this; n; n = n.parentNode) for (const fn of n.listeners[type] || []) fn.call(n, e);
  };
  const doc = new El('#document');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '');
  const re = /<(\/?)(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g; const stack = [doc]; let m;
  while ((m = re.exec(body))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; (m[3] || '').replace(/([\w-]+)(?:="([^"]*)")?/g, (mm, k, v) => { attrs[k] = v === undefined ? '' : v; return mm; });
    const el = new El(m[2], attrs); stack[stack.length - 1].appendChild(el);
    if (!/^(input|br|img|meta|link)$/i.test(m[2])) stack.push(el);
  }
  const gifosCalls = []; let back = null;
  const gifos = new Proxy({
    db: () => mockDb(), me: () => Promise.resolve({ id: 'aaa', name: 'You' }), onBack: (fn) => { back = fn; },
  }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => gifosCalls.push(k) : undefined)) });
  const box = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {},
    MouseEvent: function (type) { this.type = type; }, Event: function (type) { this.type = type; },
    innerWidth: opts.width || 390, dispatchEvent() {}, addEventListener() {},
    gifos,
    document: { readyState: 'complete', body: doc, documentElement: doc, getElementById: (id) => byId[id] || null, querySelector: (s) => doc.querySelector(s), createElement: (t) => new El(t), addEventListener() {} },
  };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  for (const f of ['ls-stub.js', 'app.js', 'mp.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), box, { filename: f });
  return { box, q: (s) => doc.querySelector(s), all: (f) => doc.all(f), el: (t, a) => new El(t, a), back: () => back && back(), gifosCalls };
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

(async function main() {
  const { sandbox, save } = load();
  check('ls-stub, app.js, mp.js load and attach MMMap', !!(sandbox.MMMap && sandbox.MMMap.empty && sandbox.MMMap.addChild && sandbox.MMSave));
  check('MMLocal facade is aboard (vendor must not throw)', !!(sandbox.MMLocal && sandbox.MMLocal.setItem && sandbox.MMLocal._dump));

  const empty = sandbox.MMMap.empty();
  check('empty map has a root and no children',
    !!(empty && empty.root && empty.root.text === 'My Mind Map' && sandbox.MMMap.isEmpty(empty)),
    empty && empty.root);

  const map = sandbox.MMMap.empty();
  const child = sandbox.MMMap.addChild(map, 'root', 'Pack');
  check('addChild grows a child under the root',
    child && child.text === 'Pack' && (map.root.children || []).length === 1,
    map.root.children);
  const grand = sandbox.MMMap.addChild(map, child.id, 'Passport');
  check('addChild grows a grandchild under Pack',
    grand && grand.text === 'Passport' && child.children && child.children[0].text === 'Passport');
  const sib = sandbox.MMMap.addChild(map, 'root', 'Book');
  check('a second child is a sibling, not nested under Pack',
    (map.root.children || []).length === 2 && map.root.children[1].text === 'Book');

  sandbox.MyMind = sandbox.MyMind || {};
  sandbox.MyMind.getJSON = function () { return sandbox.MMMap.clone(map); };
  sandbox.MyMind.loadJSON = function (j) { sandbox._loaded = j; };
  sandbox.MyMind.subscribe = function () {};

  await sandbox.MMSave.persistNow();
  await flush();
  const rec = save._store.last;
  check('persistNow writes {id:last, map} into gifos.db save',
    !!(rec && rec.id === 'last' && rec.map && rec.map.root && rec.map.root.children && rec.map.root.children.length === 2),
    rec && rec.map && rec.map.root);
  check('roundtrip snapshot still has Pack → Passport and sibling Book',
    rec.map.root.children[0].text === 'Pack' &&
    rec.map.root.children[0].children[0].text === 'Passport' &&
    rec.map.root.children[1].text === 'Book');

  const { sandbox: b, save: saveB } = load();
  saveB._store.last = JSON.parse(JSON.stringify(rec));
  b.MyMind = b.MyMind || {};
  b._loaded = null;
  b.MyMind.loadJSON = function (j) { b._loaded = j; };
  b.MyMind.getJSON = function () { return b._loaded; };
  b.MyMind.subscribe = function (msg, fn) { b._subs = b._subs || {}; b._subs[msg] = fn; };
  await b.MyMind.onReady();
  await flush();
  await flush();
  check('onReady loads the last map from gifos.db',
    !!(b._loaded && b._loaded.root && b._loaded.root.children && b._loaded.root.children[0].text === 'Pack'),
    b._loaded && b._loaded.root);

  const blank = sandbox.MMMap.empty();
  sandbox.MyMind.getJSON = function () { return blank; };
  await sandbox.MMSave.persistNow();
  const blankRec = save._store.last;
  check('an empty map still roundtrips (root, no children)',
    !!(blankRec && blankRec.map && blankRec.map.root && sandbox.MMMap.isEmpty(blankRec.map)));

  sandbox.MMLocal.setItem('mm.map.names', '{"x":"Trip"}');
  sandbox.MMLocal.setItem('mm.map.x', '{"root":{"text":"Trip"}}');
  sandbox.MMLocal._flush();
  await flush();
  await flush();
  check('named maps from the Local backend dump into gifos.db, not leftover storage',
    !!(save._store.ls && save._store.ls.data && save._store.ls.data['mm.map.names'] && /Trip/.test(save._store.ls.data['mm.map.names'])));

  const { sandbox: mpBox, room } = load({ meId: 'aaa' });
  mpBox.MyMind = {
    getJSON: function () { return { root: { text: 'Host map', children: [{ id: 'c', text: 'Child' }] } }; },
    loadJSON: function (j) { mpBox._applied = j; }
  };
  mpBox.MMMp.start();
  await flush();
  await flush();
  const mine = room._store.aaa;
  check('mp.js publishes my row (id, map) into the room collection', !!(mine && mine.id === 'aaa' && mine.map && mine.map.root && mine.map.root.text === 'Host map'), room._store);
  const players = [
    { id: 'bbb', name: 'Friend', at: Date.now(), map: { root: { text: 'Watched' } } },
    { id: 'aaa', name: 'You', at: Date.now(), map: { root: { text: 'Host map' } } }
  ];
  const host = mpBox.MMMp._hostOf(players);
  check('the live host is the lowest id (a friend can watch)', host && host.id === 'aaa' && host.map.root.text === 'Host map');
  // A guest's screen follows the live host's map; the host never loads a guest's.
  const { sandbox: gBox, room: gRoom } = load({ meId: 'zzz' });
  gBox._applied = null;
  gBox.MyMind = { getJSON: () => ({ root: { text: 'Guest scratch' } }), loadJSON: (j) => { gBox._applied = j; } };
  gBox.MMMp.start();
  await flush(); await flush();
  await gRoom.put({ id: 'aaa', name: 'Host', at: Date.now(), map: { root: { text: 'Host map', children: [{ id: 'c', text: 'Child' }] } } });
  check('a guest loads the live host map', !!(gBox._applied && gBox._applied.root.text === 'Host map'), gBox._applied);
  mpBox._applied = null;
  await room.put({ id: 'zzz', name: 'Guest', at: Date.now(), map: { root: { text: 'Guest scratch' } } });
  check('the host never loads a guest map', mpBox._applied === null, mpBox._applied);
  const solo = mpBox.MMMp._statusOf([{ id: 'aaa', name: 'You', at: Date.now() }]);
  const watched = mpBox.MMMp._statusOf([{ id: 'aaa', at: 1 }, { id: 'bbb', at: 1 }]);
  check('the room line changes once a friend is watching', typeof solo === 'string' && !!solo && watched !== solo);

  // ---- the page, run for real -------------------------------------------------
  // app.js + mp.js on a fake DOM parsed (nested) from index.html, with a small
  // selector engine (tag, #id, .class, [attr="v"], descendant), events that
  // bubble, and a gifos behind a Proxy that records any call besides db/me/onBack.
  {
    const S = page({ width: 390 });
    const ctxBtn = (cmd) => S.q('#context-menu [data-command="' + cmd + '"]');
    for (const cmd of ['insert-child', 'insert-sibling', 'edit', 'delete', 'undo']) {
      const b = S.q('#phone-bar [data-cmd="' + cmd + '"]');
      const target = ctxBtn(cmd);
      const before = target ? target.got.length : 0;
      if (b) b.fire('click');
      check('phone bar ' + cmd + ' runs the editor command ' + cmd, !!b && !!target && target.got.length === before + 1 && target.got[before] === 'mousedown');
    }
    // Tap the selected bubble again: edit. A drag, or a tap on another bubble: no edit.
    const main = S.q('main');
    // The unselected bubble comes FIRST, so only a lookup of the selected one finds the right bubble.
    const other = S.el('div', { class: 'item' }); const oc = S.el('div', { class: 'content' }); other.appendChild(oc); main.appendChild(other);
    const cur = S.el('div', { class: 'item current' }); const content = S.el('div', { class: 'content' }); const word = S.el('span', {});
    cur.appendChild(content); content.appendChild(word); main.appendChild(cur);
    const edits = () => ctxBtn('edit').got.length;
    let n0 = edits();
    word.fire('pointerdown', { clientX: 50, clientY: 50 }); word.fire('pointerup', { clientX: 52, clientY: 51 });
    check('tap-again on the selected bubble starts edit', edits() === n0 + 1);
    n0 = edits();
    word.fire('pointerdown', { clientX: 50, clientY: 50 }); word.fire('pointerup', { clientX: 90, clientY: 50 });
    check('a drag from the selected bubble does not start edit', edits() === n0);
    oc.fire('pointerdown', { clientX: 50, clientY: 50 }); oc.fire('pointerup', { clientX: 50, clientY: 50 });
    check('a tap on another bubble does not start edit', edits() === n0);
    // The empty-map hint follows the map.
    S.box.MyMind.getJSON = () => S.box.MMMap.empty();
    S.box.MMSave.paintEmpty();
    const hint = S.q('#empty');
    const shownEmpty = hint.hidden === false;
    const full = S.box.MMMap.empty(); S.box.MMMap.addChild(full, 'root', 'Idea');
    S.box.MyMind.getJSON = () => full;
    S.box.MMSave.paintEmpty();
    check('the empty-map hint shows on a blank map and hides once it grows', shownEmpty && hint.hidden === true);
    // Back closes an open pane first, then lets the OS have the press.
    const help = S.q('#help'); help.hidden = false;
    const r1 = S.back();
    check('Back closes an open pane and reports it', r1 === true && help.hidden === true);
    S.q('#context-menu').hidden = true;
    check('Back with nothing open returns false', S.back() === false);
    // Every control: nothing reaches for an OS invite or share.
    for (const b of S.all((e) => e.tag === 'button')) b.fire('click');
    check('no in-app control calls an OS invite or share (Invite is OS chrome)', S.gifosCalls.length === 0, S.gifosCalls);
  }
  {
    // On a desktop the side pane opens; on a phone it stays shut for the map.
    const wide = page({ width: 1280 });
    const narrow = page({ width: 390 });
    check('the side pane opens on a desktop and stays shut on a phone', wide.q('#ui').hidden === false && narrow.q('#ui').hidden === true);
  }

  // The phone bar is laid out at 390px and hidden on a desktop (CSS cascade).
  {
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const display = (w) => {
      let out = null;
      (function scan(text) {
        let i = 0;
        while (i < text.length) {
          const open = text.indexOf('{', i); if (open < 0) break;
          const head = text.slice(i, open).trim(); let d = 1, k = open + 1;
          while (k < text.length && d) { if (text[k] === '{') d++; else if (text[k] === '}') d--; k++; }
          const inner = text.slice(open + 1, k - 1);
          if (head.startsWith('@media')) {
            const mw = /max-width:\s*(\d+)px/.exec(head); const nw = /min-width:\s*(\d+)px/.exec(head);
            if ((!mw || w <= +mw[1]) && (!nw || w >= +nw[1])) scan(inner);
          } else if (head.split(',').map((x) => x.trim()).indexOf('#phone-bar') >= 0) {
            const m = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(inner); if (m) out = m[1].trim();
          }
          i = k;
        }
      })(css);
      return out;
    };
    check('the phone bar is shown at 390px', !!display(390) && display(390) !== 'none', display(390));
    check('the phone bar is hidden on a desktop', display(1280) === 'none', display(1280));
  }

  // Offline: every file index.html loads ships in the app; no modules.
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const refs = [];
    html.replace(/<(script|link)\b([^>]*)>/gi, (m, tag, attrs) => { const a = /\b(src|href)=["']([^"']+)["']/.exec(attrs); refs.push({ ref: a ? a[2] : null, module: /type=["']module["']/i.test(attrs) }); return m; });
    const missing = refs.filter((r) => r.ref && !fs.existsSync(path.join(APP, r.ref)));
    check('every loaded file ships inside the app (no CDN)', refs.filter((r) => r.ref).length >= 4 && missing.length === 0, missing);
    check('no script is an ES module', refs.every((r) => !r.module));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
  check('listing names the upstream it ports', listing.basedOn && listing.basedOn.name === 'My Mind');
  check('manifest claims db + multiplayer, minBuild 947',
    manifest.capabilities.db === true && manifest.capabilities.multiplayer === true &&
    manifest.minBuild === 947 && manifest.data.room.visibility === 'read-write');

  // The icon: render it. A map that GROWS (later frames carry more bubble
  // pixels and more colours than the first), not a static pivot grid.
  {
    // Imported from its source text, so the file read is the one the build runs.
    const icon = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(APP, 'icon.mjs'), 'utf8')).toString('base64'));
    const ic = icon.myMindIcon();
    const inked = (f) => { const seen = new Set(); let n = 0; for (const v of f) if (v > 0) { seen.add(v); if (v > 5) n++; } return { n, colors: seen.size }; };
    const first = inked(ic.frames[0]), last = inked(ic.frames[ic.frames.length - 1]);
    check('the icon animates (several frames)', ic.frames.length >= 6, ic.frames.length);
    check('the icon map grows: the last frame has more bubbles than the first', last.n > first.n * 1.5 && last.colors > first.colors, { first, last });
    // The cover: a real PNG of a mid-use map, several bubble colours on cream.
    const { decodePng } = require('../test-lib/png.js');
    const png = decodePng(icon.screenshotPng());
    const hues = new Set();
    const px = png.rgba;
    for (let i = 0; px && i < px.length; i += 4 * 97) { const r = px[i], g = px[i + 1], b = px[i + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 60) hues.add((r > g ? 'r' : 'g') + (g > b ? 'g' : 'b') + (r > b ? 'R' : 'B')); }
    check('the cover is a mid-use map (a decodable PNG with several bubble colours)', !!px && png.width >= 600 && hues.size >= 3, { w: png.width, hues: [...hues] });
  }

  // The vendored editor's GifOS hand-off, run. The tail of my-mind.js sets
  // window.MyMind (getJSON/loadJSON over the live map) and keeps app.js's
  // onReady; init14 takes the map CSS from window.MYMIND_MAP_CSS (no fetch),
  // and vendor/map-css.js provides it.
  {
    const vendor = fs.readFileSync(path.join(APP, 'vendor', 'my-mind.js'), 'utf8');
    const tail = vendor.slice(vendor.indexOf('  var _ready = window.MyMind && window.MyMind.onReady;'), vendor.lastIndexOf('})();'));
    const shown = [];
    const live = { toJSON: () => ({ root: { text: 'Live' } }) };
    const win = { MyMind: { onReady: () => { win.readyRan = (win.readyRan || 0) + 1; } } };
    let initDone = null;
    new Function('window', 'currentMap', 'Map2', 'showMap', 'subscribe', 'init19', tail)(
      win, live, { fromJSON: (j) => ({ from: j }) }, (m) => shown.push(m), () => {}, () => new Promise((r) => { initDone = r; }));
    check('vendor exposes getJSON over the live map', !!win.MyMind.getJSON && win.MyMind.getJSON().root.text === 'Live');
    win.MyMind.loadJSON({ root: { text: 'Loaded' } });
    check('vendor loadJSON shows the given map', shown.length === 1 && shown[0].from.root.text === 'Loaded');
    if (initDone) initDone();
    await flush();
    check("vendor keeps app.js's onReady and runs it after init", win.readyRan === 1);
    const i14 = vendor.slice(vendor.indexOf('  async function init14() {'), vendor.indexOf('  // .js/keyboard.js'));
    let fetched = 0;
    const got = await new Function('window', 'fetch', 'let css = null;\n' + i14 + '\nreturn init14().then(() => css);')({ MYMIND_MAP_CSS: '.x{}' }, () => { fetched++; });
    const cssBox = {}; cssBox.window = cssBox; vm.createContext(cssBox);
    vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'map-css.js'), 'utf8'), cssBox);
    check('the map CSS comes from MYMIND_MAP_CSS, never a fetch', got === '.x{}' && fetched === 0);
    check('vendor/map-css.js provides MYMIND_MAP_CSS', typeof cssBox.MYMIND_MAP_CSS === 'string' && cssBox.MYMIND_MAP_CSS.length > 100);
  }

  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  console.log('\nall pass');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
