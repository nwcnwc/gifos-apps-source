// THE HOUSE HAS TO BE ENTERABLE, AND THE FILE HAS TO BE THE SAVE.
//
// The real jQuery/jQuery UI stack does not boot in a vm, so these checks run
// the port's own code against a fake page instead: pictures remap onto
// packed bytes, a save round-trips onto the SAME arrays the room generator
// hides items with, the shipped game.js lets you pick up the first note, and
// boot.js + patch.js + app.js boot end to end (gauge, restore, resume, taps,
// Back, the HTML5 sound shim, the preloader replacement). Every check
// asserts an outcome; none greps the source for wording.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function read(rel) {
  return fs.readFileSync(path.join(APP, rel), 'utf8');
}

function loadPort() {
  const sandbox = {
    console,
    HOUSE_TEST: true,
    HOUSE_IMAGES: {
      'images/room_note.png': 'data:image/png;base64,NOTE',
      'images/intro_logo.png': 'data:image/png;base64,LOGO',
    },
    HOUSE_SOUNDS: {
      'sound/room.mp3': 'data:audio/mpeg;base64,ROOM',
      'sound/door.ogg': 'data:audio/ogg;base64,DOOR',
    },
    HOUSE_ROOMS: {
      'room.html': '<div id="room"><div id="note" data-info="paper"></div></div>',
      'intro.html': '<div id="intro"><p id="enter">Enter</p></div>',
    },
    Object, Array, JSON, String, Number, Boolean, Date, Math,
    parseInt, parseFloat, isNaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = {
    styleSheets: [],
    addEventListener: function () {},
    documentElement: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read('app.js'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const sandbox = loadPort();
const HP = sandbox.HousePort;
check('app.js loads in a vm and exposes HousePort', !!(HP && HP.remapSrc && HP.fillArray && HP.snapshotStore && HP.restoreStore));

// ---- packed pictures and sounds, including SM2's pathname concat ------------
{
  check('images/room_note.png remaps onto a data URI',
    HP.remapSrc('images/room_note.png') === 'data:image/png;base64,NOTE');
  check('relative ../images still remaps',
    HP.remapSrc('../images/intro_logo.png') === 'data:image/png;base64,LOGO');
  check('sound/room.mp3 remaps',
    HP.remapSrc('sound/room.mp3') === 'data:audio/mpeg;base64,ROOM');
  check('SM2 srcdocsound/door.ogg (pathname + sound/) remaps',
    HP.remapSrc('srcdocsound/door.ogg') === 'data:audio/ogg;base64,DOOR');
  check('a data URI is left alone',
    HP.remapSrc('data:image/png;base64,NOTE') === 'data:image/png;base64,NOTE');
  const html = HP.remapHtml('<img src="images/room_note.png">');
  check('remapHtml rewrites img src', html.indexOf('data:image/png;base64,NOTE') !== -1);
  const css = HP.remapCssUrls('background:url(../images/intro_logo.png)');
  check('remapCssUrls rewrites url()', css.indexOf('data:image/png;base64,LOGO') !== -1);
  check('room.html is a known room', HP.roomKey('room.html') === 'room.html');
  check('room.html?cachebust is the same room', HP.roomKey('room.html?123') === 'room.html');
}

// ---- save: the file is the save, and collected stays the room's array -------
{
  const mem = {
    v: 9,
    collected: ['note'],
    used: ['key'],
    played: ['scene_intro'],
    is_in: 'room',
    fish: ['window'],
    temp_path: [],
    note_room: 'room',
    note_info: 'Some kind of illustration. Interesting... Might be useful.',
  };
  const store = Object.assign({}, mem);
  store.collected = mem.collected.slice();
  store.used = mem.used.slice();
  store.played = mem.played.slice();
  store.fish = mem.fish.slice();
  const jst = {
    _s: {},
    get: function (k, d) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : d; },
    set: function (k, v) { this._s[k] = v; return v; },
    index: function () { return Object.keys(this._s); },
  };
  HP.restoreStore(jst, store);
  check('restore writes is_in', jst.get('is_in') === 'room');
  check('restore writes collected', (jst.get('collected') || []).indexOf('note') !== -1);
  check('restore writes the note\'s room', jst.get('note_room') === 'room');

  const snap = HP.snapshotStore(jst);
  check('snapshot round-trips is_in + collected',
    snap.is_in === 'room' && (snap.collected || []).indexOf('note') !== -1);

  // The original room generator hides items via room.settings.collected_items,
  // which is a REFERENCE to the global collected array from data.js. A
  // reassignment (`collected = jStorage.get(...)`) leaves the room looking
  // at the empty array from first boot — the note is still on the desk, the
  // tray already has it. fillArray must mutate in place.
  const collected = [];
  const used = [];
  const bound = collected;
  HP.fillArray(collected, jst.get('collected', []));
  HP.fillArray(used, jst.get('used', []));
  check('fillArray keeps the same array the room is bound to', collected === bound);
  check('…and that array now holds the note', collected.indexOf('note') !== -1, collected);
  check('…and used still holds the key', used.indexOf('key') !== -1, used);

  // Picking the note up (what items.take does to jStorage) then snapshotting
  // is the save the next boot must restore.
  const afterTake = HP.snapshotStore(jst);
  afterTake.collected = collected.slice();
  const jst2 = {
    _s: {},
    get: function (k, d) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : d; },
    set: function (k, v) { this._s[k] = v; return v; },
    index: function () { return Object.keys(this._s); },
  };
  HP.restoreStore(jst2, afterTake);
  const again = [];
  HP.fillArray(again, jst2.get('collected', []));
  check('a second boot still has the note in inventory', again.indexOf('note') !== -1);
  check('…and is still in the room', jst2.get('is_in') === 'room');
}

// ---- a chainable fake jQuery: enough to run the vendor rooms and the wrap --
// Any method the code calls is recorded in `log` and returns the same wrapper,
// so a chain like $('#lightbox').fadeIn().text().append() just runs.
function makeJQ(state) {
  state = state || {};
  const log = [];
  const handlers = {};
  const fn = {};
  const st = (sel) => state[sel] || {};
  function wrap(sel) {
    const base = Object.create(fn);
    base.sel = sel;
    base.length = st(sel).length != null ? st(sel).length : 1;
    base[0] = st(sel).el || { sel: sel };
    const p = new Proxy(base, {
      get(t, k, r) {
        if (k in t) return Reflect.get(t, k, r);
        if (typeof k !== 'string' || k === 'then' || k === 'toJSON') return undefined;
        return function () { log.push([sel, k, Array.from(arguments)]); return p; };
      },
    });
    base.self = p;
    return p;
  }
  fn.attr = function (n) { return (st(this.sel).attrs || {})[n]; };
  fn.click = function (f) {
    if (typeof f === 'function') (handlers[this.sel] = handlers[this.sel] || []).push(f);
    else log.push([this.sel, 'click', []]);
    return this.self;
  };
  fn.find = function (s) { return wrap(s); };
  fn.is = function () { return !!st(this.sel).visible; };
  fn.hasClass = function (c) { return (st(this.sel).classes || []).indexOf(c) !== -1; };
  fn.children = function () { return wrap(this.sel + ' >children'); };
  fn.first = function () { return this.self; };
  fn.load = function (url) { log.push([this.sel, 'origLoad', [url]]); return this.self; };
  fn.html = function (h) {
    log.push([this.sel, 'html', [h]]);
    state[this.sel + ' >children'] = { length: 1 };
    return this.self;
  };
  fn.css = function () { log.push([this.sel, 'css', Array.from(arguments)]); return this.self; };
  const $ = function (sel) {
    if (typeof sel === 'function') return undefined;
    if (sel && typeof sel === 'object') return wrap(sel.sel || 'element');
    return wrap(sel);
  };
  $.fn = fn;
  $.inArray = (v, a) => (a || []).indexOf(v);
  return { $, log, handlers, state };
}

function makeJStorage(init) {
  return {
    _s: Object.assign({}, init || {}),
    get: function (k, d) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : d; },
    set: function (k, v) { this._s[k] = v; return v; },
    flush: function () { this._s = {}; return true; },
    deleteKey: function (k) { delete this._s[k]; return true; },
    index: function () { return Object.keys(this._s); },
  };
}

// Attributes of one element in a room's markup, by id.
function elementAttrs(html, id) {
  const m = html.match(new RegExp('<[a-z]+\\b[^>]*\\bid=["\']' + id + '["\'][^>]*>', 'i'));
  if (!m) return null;
  const attrs = {};
  m[0].replace(/([\w-]+)=["']([^"']*)["']/g, (all, k, v) => { attrs[k] = v; return all; });
  return attrs;
}

// ---- the engine can walk the first room: a note exists, and taking it saves -
// The SHIPPED (min) game.js and items.js run here: game.room() builds the
// first room, a click on #note walks to the desk and calls items.take, and
// items.take writes the note into jStorage.collected with its room and info.
{
  const roomHtml = read('vendor/room.html');
  const noteAttrs = elementAttrs(roomHtml, 'note');
  check('first room markup has a #note hotspot', !!noteAttrs);
  check('first room note carries data-info (the examine text)', !!(noteAttrs && noteAttrs['data-info']));
  check('the corridor door is a hotspot too', !!elementAttrs(roomHtml, 'door_exit'));

  const jq = makeJQ({ '#note': { attrs: noteAttrs || {} } });
  const jst = makeJStorage({ is_in: 'room', collected: [], used: [], played: ['scene_intro'] });
  jst.writes = [];
  const plainSet = jst.set;
  jst.set = function (k, v) { this.writes.push([k, JSON.parse(JSON.stringify(v))]); return plainSet.call(this, k, v); };
  jq.$.jStorage = jst;
  const walked = [];
  const sb = {
    console, Math, JSON, Array, Object, String, Number, setTimeout: () => 0,
    $: jq.$, jQuery: jq.$,
    played: ['scene_intro'], collected: [], used: [],
    room: {
      generate: (o) => { sb.lastRoom = o; o.execute(); },
      transparency() {}, pulse() {},
      the_player: { go_to: { start: (o) => { walked.push(o.target); o.action(); } } },
    },
    document: { getElementById: () => ({}) },
    soundManager: { onready() {} },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('vendor/js/min/items-min.js'), sb, { filename: 'items-min.js' });
  vm.runInContext(read('vendor/js/min/game-min.js'), sb, { filename: 'game-min.js' });
  let walkOk = true;
  try { sb.game.room(5, 6); } catch (e) { walkOk = false; console.log('  game.room threw: ' + e.message); }
  check('game.room builds the first room in a vm', walkOk && sb.lastRoom && sb.lastRoom.inject === 'room');
  check('the corridor door takes a click', (jq.handlers['#door_exit'] || []).length > 0);
  const noteClicks = jq.handlers['#note'] || [];
  check('the note takes a click', noteClicks.length > 0);
  try { noteClicks.forEach((f) => f()); } catch (e) { console.log('  note click threw: ' + e.message); }
  check('clicking the note walks to the desk', walked.length > 0);
  // jStorage.get hands back the live array, so the push alone would show up
  // in get(); only a set() reaches the wrap's save hook. Assert the write.
  check('items.take writes the note into jStorage.collected',
    jst.writes.some((w) => w[0] === 'collected' && w[1].indexOf('note') !== -1), jst.writes);
  check('items.take records the room the note came from', jst.get('note_room') === 'room', jst.get('note_room'));
  check('items.take records the note\'s examine text', jst.get('note_info') === (noteAttrs || {})['data-info']);
}

// ---- boot the whole wrap in a vm: boot.js + patch.js + app.js (not test mode)
// A fake page: manual clock, fake jQuery/jStorage, gifos.db/assets/onBack,
// Audio/Image/MouseEvent/Blob/URL. Returns the handles the checks need.
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n) { for (let i = 0; i < (n || 20); i++) await tick(); }

function bootHouse(opts) {
  opts = opts || {};
  const timers = [];
  let now = 0;
  const clock = {
    run(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = until;
    },
  };
  const el = (id) => ({
    id, style: {}, textContent: '', parentNode: null, dispatched: [],
    classList: { _c: [], add(c) { this._c.push(c); }, contains(c) { return this._c.indexOf(c) !== -1; } },
    dispatchEvent(ev) { this.dispatched.push(ev.type); return true; },
  });
  const els = { 'house-boot': el('house-boot'), 'house-boot-bar': el('house-boot-bar'), 'house-boot-note': el('house-boot-note') };
  const hotspot = el('hotspot');
  const listeners = {};
  let sheetReads = 0;
  const document = {
    get styleSheets() { sheetReads++; return []; },
    getElementById: (id) => els[id] || null,
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    elementFromPoint: () => hotspot,
    documentElement: {},
    visibilityState: 'visible',
  };
  const audios = [];
  class Audio {
    constructor() { this.src = ''; this.muted = false; this.volume = 1; this.paused = true; this.onended = null; audios.push(this); }
    play() { this.paused = false; return { catch() {} }; }
    pause() { this.paused = true; }
  }
  const imagesMade = [];
  class Image { constructor() { imagesMade.push(this); } }
  class MouseEvent { constructor(type, init) { this.type = type; this.init = init; } }
  class Blob { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } }
  let blobN = 0;

  const jq = makeJQ({
    '#the_game >children': { length: 0 },
    '#lightbox': { visible: !!opts.lightboxOpen },
    '#room_view': { length: 0 }, '.close': { length: 0 }, '#dialogue_box': { length: 0 },
  });
  const jst = makeJStorage();
  jq.$.jStorage = jst;
  let vendorPreloaderRan = false;
  jq.$.preloadCssImages = function () { vendorPreloaderRan = true; void document.styleSheets; };

  // a packed asset index: one big picture first, then enough to pass mapsReady
  const index = { 'images/big.png': 3000000 };
  for (let i = 0; i < 60; i++) index['images/p' + i + '.png'] = 1000;
  for (let i = 0; i < 12; i++) index['sound/s' + i + '.mp3'] = 1000;
  index['sound/door.ogg'] = 1000;
  const pendingAssets = {};
  const dbCalls = [];
  const puts = [];
  const backs = [];
  const gifos = {
    db(name) {
      dbCalls.push(name);
      return {
        get: () => Promise.resolve(opts.saved ? { id: 'last', store: opts.saved } : undefined),
        put: (rec) => { puts.push(JSON.parse(JSON.stringify(rec))); return Promise.resolve(); },
      };
    },
    assets(k) {
      return new Promise((res) => {
        pendingAssets[k] = () => res(new ArrayBuffer(Math.min(index[k] || 1, 8)));
        if (!opts.holdAssets) pendingAssets[k]();
      });
    },
    onBack(f) { backs.push(f); },
  };
  const calls = [];
  const sb = {
    console, Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp, Promise, Error, TypeError,
    parseInt, parseFloat, isNaN,
    setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    clearTimeout: () => {},
    document, Audio, Image, MouseEvent, Blob,
    URL: { createObjectURL: () => 'blob:house/' + (++blobN) },
    location: {},
    gifos,
    jQuery: jq.$, $: jq.$,
    game: new Proxy({}, {
      get: (t, k) => (...a) => {
        calls.push(['game.' + String(k), a]);
        jq.state['#the_game >children'] = { length: 1 }; // room.generate paints
      },
    }),
    scene: { intro: () => calls.push(['scene.intro', []]), cabin: () => calls.push(['scene.cabin', []]) },
    items: { holder: () => calls.push(['items.holder', []]) },
    settings: { init() {}, reset() {} },
    room: { settings: {}, draggable() {} },
    dialogue_box: { destroy() {}, display() {} },
    collected: [], used: [], played: [], fish: [], path: [], is_in: undefined,
    HOUSE_IMAGES: { 'fonts/a.woff': 'data:font/woff;base64,AA', 'fonts/b.woff': 'data:font/woff;base64,BB' },
    HOUSE_ROOMS: {
      'intro.html': '<div id="intro"><p id="enter">Enter</p></div>',
      'room.html': '<div id="room"><div id="note"></div></div>',
    },
    HOUSE_ASSET_INDEX: index,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(read('boot.js'), sb, { filename: 'boot.js' });
  vm.runInContext(read('patch.js'), sb, { filename: 'patch.js' });
  // what vendor game.js does: wait for onready, then load the intro room
  const onreadySaw = [];
  sb.soundManager.onready(() => {
    onreadySaw.push(jst.get('is_in'));
    jq.$('#the_game').load('intro.html', function () {});
  });
  // record what reaches the shim's createSound (the type hint is dropped there)
  const smCreates = [];
  const shimCreate = sb.soundManager.createSound;
  sb.soundManager.createSound = function (o, u) { smCreates.push(typeof o === 'string' ? { id: o, url: u } : Object.assign({}, o)); return shimCreate.call(this, o, u); };
  vm.runInContext(read('app.js'), sb, { filename: 'app.js' });
  return {
    sb, jq, jst, clock, els, hotspot, listeners, audios, imagesMade, dbCalls, puts, backs, calls,
    onreadySaw, smCreates, pendingAssets, index,
    sheetReads: () => sheetReads, vendorPreloaderRan: () => vendorPreloaderRan,
  };
}

const SAVED = {
  v: 9, collected: ['note'], used: [], played: ['scene_intro'], is_in: 'room',
  fish: [], temp_path: [], note_room: 'room', note_info: 'paper',
};

async function bootChecks() {
  // -- boot gauge: moves by bytes ------------------------------------------
  {
    const h = bootHouse({ holdAssets: true, saved: SAVED });
    await flush();
    h.pendingAssets['images/big.png']();
    delete h.pendingAssets['images/big.png'];
    await flush();
    const w = parseFloat(h.els['house-boot-bar'].style.width);
    // 3,000,000 of 3,074,000 bytes is 97.6 %; a gauge counting files would read 1.4 %
    check('the boot gauge moves by bytes, not vibes', w > 90 && w < 100, h.els['house-boot-bar'].style.width);
    for (let round = 0; round < 40; round++) {
      Object.keys(h.pendingAssets).forEach((k) => { h.pendingAssets[k](); delete h.pendingAssets[k]; });
      await flush(5);
    }
    check('the boot gauge reaches 100% when every asset has landed',
      parseFloat(h.els['house-boot-bar'].style.width) === 100, h.els['house-boot-bar'].style.width);
  }

  // -- resume: a saved room boots straight into that room -------------------
  const h = bootHouse({ saved: SAVED });
  await flush(60);
  check('gifos.db("save") is the save', h.dbCalls[0] === 'save', h.dbCalls);
  check('restore puts the saved room into jStorage', h.jst.get('is_in') === 'room');
  check('onready is held until the save is in',
    h.onreadySaw.length === 1 && h.onreadySaw[0] === 'room', h.onreadySaw);
  check('room.settings.collected_items is rebound to the restored collected[]',
    h.sb.room.settings.collected_items === h.sb.collected && h.sb.collected.indexOf('note') !== -1);
  h.clock.run(3000);
  const roomCalls = h.calls.filter((c) => c[0] === 'game.room');
  const introHtml = h.jq.log.filter((l) => l[0] === '#the_game' && l[1] === 'html');
  check('resume skips the splash when is_in is set',
    roomCalls.length === 1 && roomCalls[0][1][0] === 5 && roomCalls[0][1][1] === 6 && introHtml.length === 0,
    { roomCalls, introHtml: introHtml.length });

  // -- the file is the save: a jStorage write lands in gifos.db('save') -----
  {
    const before = h.puts.length;
    const c = h.jst.get('collected').slice();
    c.push('key');
    h.sb.$.jStorage.set('collected', c);
    await flush();
    const last = h.puts[h.puts.length - 1];
    check('taking an item writes the save record at once',
      h.puts.length > before && last.id === 'last' && last.store.collected.indexOf('key') !== -1 &&
      last.store.is_in === 'room', last);
  }

  // -- phone taps ----------------------------------------------------------
  {
    const fire = (type, ev) => (h.listeners[type] || []).forEach((f) => f(Object.assign({ preventDefault() {} }, ev)));
    const t0 = { clientX: 100, clientY: 100, screenX: 0, screenY: 0, target: h.hotspot };
    h.hotspot.dispatched.length = 0;
    fire('touchstart', { touches: [t0] });
    fire('touchend', { changedTouches: [t0] });
    check('a phone tap synthesizes click (touchend)', h.hotspot.dispatched.indexOf('click') !== -1, h.hotspot.dispatched);
    h.hotspot.dispatched.length = 0;
    const t1 = Object.assign({}, t0, { clientX: 160 });
    fire('touchstart', { touches: [t0] });
    fire('touchmove', { touches: [t1] });
    fire('touchend', { changedTouches: [t1] });
    check('a drag is not a click', h.hotspot.dispatched.indexOf('click') === -1, h.hotspot.dispatched);
  }

  // -- Back --------------------------------------------------------------
  {
    check('Back is wired', h.backs.length === 1);
    const back = h.backs[0];
    check('Back with nothing open lets the house close', back() === false);
    h.jq.state['#lightbox'].visible = true;
    const n = h.jq.log.length;
    const r = back();
    const closed = h.jq.log.slice(n).some((l) => l[0] === '#lightbox' && l[1] === 'hide');
    check('Back closes a close-up, not the house', r === true && closed);
    h.jq.state['#lightbox'].visible = false;
  }

  // -- sound: the shim, the type hint, no Flash ----------------------------
  {
    const sm = h.sb.soundManager;
    check('soundManager runs without Flash (HTML5 only, Flash ignored)',
      sm.useHTML5Audio === true && sm.ignoreFlash === true && sm.ok() === true && h.sb.SM2_DEFER === true);
    h.smCreates.length = 0;
    const door = sm.createSound('door', 'sound/door.ogg');
    const roomSnd = sm.createSound({ id: 'roomsnd', url: 'sound/s1.mp3' });
    check('blob sounds carry a type hint (string form)',
      h.smCreates[0] && h.smCreates[0].type === 'audio/ogg' && /^blob:/.test(h.smCreates[0].url), h.smCreates[0]);
    check('blob sounds carry a type hint (object form)',
      h.smCreates[1] && h.smCreates[1].type === 'audio/mpeg' && /^blob:/.test(h.smCreates[1].url), h.smCreates[1]);
    let finished = 0;
    door.play({ volume: 40, onfinish() { finished++; } });
    const a = door._el;
    check('play() plays an HTML5 Audio at the asked volume', a.paused === false && Math.abs(a.volume - 0.4) < 1e-9);
    a.onended && a.onended();
    check('onfinish fires when the sound ends', finished === 1);
    roomSnd.play();
    sm.mute();
    check('mute silences every sound', door._el.muted && roomSnd._el.muted);
    sm.unmute();
    check('unmute brings them back', !door._el.muted && !roomSnd._el.muted);
    sm.stopAll();
    check('stopAll stops every sound', door._el.paused && roomSnd._el.paused);
    const urls = h.audios.map((x) => x.src).concat(h.imagesMade.map((x) => x.src || ''));
    check('the wrap does not point at a .swf', sm.url === '' && !urls.some((u) => /\.swf/i.test(u)), urls.filter((u) => /swf/.test(u)));
  }

  // -- the preloader never scrapes the CSSOM --------------------------------
  {
    const reads = h.sheetReads();
    const got = h.sb.$.preloadCssImages({ statusBarEl: '#preloader' });
    const imageKeys = Object.keys(h.index).filter((k) => k.indexOf('images/') === 0);
    check('the vendor CSS preloader is replaced, never allowed to scrape the CSSOM',
      !h.vendorPreloaderRan() && h.sheetReads() === reads && Array.isArray(got) && got.length === imageKeys.length,
      { sheetReads: h.sheetReads() - reads, got: got && got.length });
  }

  // -- a fresh file shows the intro ----------------------------------------
  {
    const f = bootHouse({});
    await flush(60);
    f.clock.run(3000);
    const intro = f.jq.log.filter((l) => l[0] === '#the_game' && l[1] === 'html');
    check('a fresh file loads the intro room from the packed rooms',
      intro.length === 1 && intro[0][2][0].indexOf('id="intro"') !== -1 &&
      !f.calls.some((c) => c[0] === 'game.room'));
    check('the boot card leaves when the first room lands', f.els['house-boot'].classList.contains('gone'));
  }
}

// ---- package facts: manifest, listing metadata, page structure, packer -----
{
  const listing = JSON.parse(read('listing.json'));
  check('listing is an unofficial port of The House', listing.basedOn && listing.basedOn.name === 'The House' && listing.basedOn.blessed === false);
  check('author is Artur Kot, not GifOS', listing.author && listing.author.name === 'Artur Kot');

  const man = JSON.parse(read('manifest.json'));
  check('db only — no network, no fullscreen, no fake multiplayer',
    man.capabilities && man.capabilities.db === true && !man.capabilities.network && !man.capabilities.fullscreen && !man.capabilities.multiplayer);
  check('save collection is private', man.data && man.data.save && man.data.save.visibility === 'private');
  // minBuild 1206 = 0.9.6, the first runtime whose replyAsset serves packed
  // .assets/ files — on anything older the house would boot artless and mute.
  check('minBuild is 1206 (packed .assets/ serving)', man.minBuild === 1206);

  const html = read('index.html');
  const ids = new Set();
  html.replace(/\bid=["']([^"']+)["']/g, (a, id) => { ids.add(id); return a; });
  check('first-run is a house assembling, not a black frame', ids.has('house-boot'));
  check('the boot card is a gauge — bar and note, not a mood', ids.has('house-boot-bar') && ids.has('house-boot-note'));
  const scripts = [];
  html.replace(/<script\b([^>]*)>/gi, (a, attrs) => {
    const o = {};
    attrs.replace(/([\w-]+)(?:=["']([^"']*)["'])?/g, (b, k, v) => { o[k] = v === undefined ? true : v; return b; });
    scripts.push(o);
    return a;
  });
  // THE WEIGHT RULE (measured 2026-08-24): art/sound inlined as base64 script
  // chunks made the app document 24 MB, and the vendor CSS preloader's regex
  // over the data-URI-baked CSSOM backtracked catastrophically — the page
  // wedged for minutes with every timer dead. Art rides .assets/, the app
  // document stays light, and the preloader is replaced with a map walk.
  check('no inline picture/sound chunk scripts in index.html',
    scripts.length > 0 && !scripts.some((s) => /^(images|sounds?)\//.test(String(s.src || ''))));
  const bySrc = (src) => scripts.find((s) => s.src === src) || {};
  check('the asset index and fonts are deferred so the card can paint',
    bySrc('assets-index.js').defer === true && bySrc('fonts.js').defer === true);

  // The character's 587x562 z-999 halo could sit over the HUD and eat the
  // click that opens the items tray (playtest: tray dead at the exact moment
  // the game first highlights it). Decoration never takes a click.
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  let glowPE = null;
  css.replace(/([^{}]+)\{([^}]*)\}/g, (a, sel, body) => {
    if (sel.split(',').some((x) => x.trim().replace(/\s+/g, ' ') === '#the_game #glow')) {
      body.split(';').forEach((d) => {
        const i = d.indexOf(':');
        if (i > 0 && d.slice(0, i).trim() === 'pointer-events') glowPE = d.slice(i + 1).trim();
      });
    }
    return a;
  });
  check('the glow is click-transparent (pointer-events none)', glowPE === 'none', glowPE);

  // The packer: lift its asset loop and its weight guard out of build.mjs and
  // run them on invented files (running build.mjs itself writes the GIF).
  const build = read('build.mjs');
  const lift = (from, to) => {
    const a = build.indexOf(from);
    const b = build.indexOf(to, a);
    return a !== -1 && b !== -1 ? build.slice(a, b) : null;
  };
  const assetSrc = lift('const assetFiles = {};', 'const rooms = {};');
  let packed = null;
  try {
    const bins = {
      'vendor/images/room_note.png': Buffer.from([0x89, 1, 2, 3]),
      'vendor/sound/door.ogg': Buffer.from([0x4f, 0x67, 0x67, 9, 9]),
      'vendor/fonts/f.woff': Buffer.from([7, 7]),
    };
    const walk = (rel) => Object.keys(bins).filter((k) => k.indexOf(rel + '/') === 0);
    const readBin = (p) => bins[p];
    const dataUri = (rel, buf) => 'data:x;base64,' + Buffer.from(buf).toString('base64');
    packed = new Function('walk', 'readBin', 'dataUri',
      assetSrc + '\nreturn { assetFiles, assetIndex, images, sounds };')(walk, readBin, dataUri);
  } catch (e) { console.log('  asset loop threw: ' + e.message); }
  check('the packer sends art and sound as raw .assets/ files',
    !!packed &&
    Buffer.isBuffer(packed.assetFiles['.assets/images/room_note.png']) &&
    packed.assetFiles['.assets/images/room_note.png'][0] === 0x89 &&
    Buffer.isBuffer(packed.assetFiles['.assets/sound/door.ogg']) &&
    packed.assetIndex['images/room_note.png'] === 4 && packed.assetIndex['sound/door.ogg'] === 5 &&
    !Object.keys(packed.images).some((k) => /^(images|sound)\//.test(k)) &&
    Object.keys(packed.sounds).length === 0, packed && Object.keys(packed.assetFiles));
  const weightSrc = lift('let srcdocBytes = 0;', 'const assetBytes');
  const weigh = (files) => {
    try { new Function('files', weightSrc)(files); return 'ok'; } catch (e) { return /heavy/.test(e.message) ? 'heavy' : 'error: ' + e.message; }
  };
  const heavyArt = Buffer.alloc(8 * 1024 * 1024);
  check('the packer enforces the app-document weight ceiling',
    !!weightSrc &&
    weigh({ 'index.html': '<p>', '.assets/images/big.png': heavyArt }) === 'ok' &&
    weigh({ 'index.html': '<p>', 'rooms.js': 'x'.repeat(4 * 1024 * 1024) }) === 'heavy');
}

bootChecks().then(() => {
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nall PASS');
}, (e) => { console.log('FAIL — boot harness threw: ' + (e && e.stack)); process.exit(1); });
