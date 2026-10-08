// BACKDOOMS HAS TO WALK, SHOOT, AND DIE.
//
// The port shipped a corridor you could look at. This suite PLAYS it: game.js
// is a classic script over `root`, and step() is one original 16 ms frame, so
// a vm can hold W and watch x move, put a round into the thing in front of
// you, and fall over when something stands on your toes. The shell (boot.js,
// touch.js, net.js) runs on a fake page: pointer lock, pause, Back, prefs,
// the shared seed, published shots, and the thumbs are all driven, not read.
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
  m.cos = Math.cos; m.sin = Math.sin; m.hypot = Math.hypot; m.atan2 = Math.atan2;
  m.atan = Math.atan; m.min = Math.min; m.max = Math.max; m.abs = Math.abs;
  m.PI = Math.PI; m.floor = Math.floor; m.round = Math.round;
  m.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return m;
}

function load(mathSeed) {
  const sandbox = {
    console,
    Math: seededMath(mathSeed == null ? 0xB00D : mathSeed),
    Object, Array, JSON, Date, String, Number, Boolean,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    document: { getElementById: () => null },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });
  return sandbox;
}

const sandbox = load();
const BD = sandbox.Backdooms;
check('game.js loads and attaches Backdooms',
  !!(BD && BD.start && BD.step && BD.shoot && BD.keys && BD.state));

{
  BD.start({ seed: 7, headless: true });
  const s0 = BD.state();
  check('a run starts alive in the open square', s0.alive && s0.x === 4 && s0.y === 4, s0);
  check('a run starts with a clip and a full bar', s0.hp === 100 && s0.ammo === 25, s0);
  check('two things spawn next to you', s0.enemies === 2, s0.enemies);
}

{
  BD.start({ seed: 7, headless: true });
  const k = BD.keys();
  k.w = 1;
  const x0 = BD.state().x, y0 = BD.state().y;
  for (let i = 0; i < 40; i++) BD.step(16);
  const s = BD.state();
  check('holding W MOVES the player', Math.hypot(s.x - x0, s.y - y0) > 0.5,
    { from: [x0, y0], to: [s.x, s.y] });
}

{
  BD.start({ seed: 7, headless: true });
  const k = BD.keys();
  k.a = 1;
  const x0 = BD.state().x, y0 = BD.state().y;
  for (let i = 0; i < 40; i++) BD.step(16);
  const s = BD.state();
  check('holding A strafes (not just turns)', Math.hypot(s.x - x0, s.y - y0) > 0.5,
    { from: [x0, y0], to: [s.x, s.y], a: s.a });
}

{
  BD.start({ seed: 7, headless: true });
  const k = BD.keys();
  k._jx = 0; k._jy = -1;
  const x0 = BD.state().x;
  for (let i = 0; i < 40; i++) BD.step(16);
  check('the analog stick walks forward', BD.state().x > x0 + 0.5,
    { x: BD.state().x, from: x0 });
}

{
  BD.start({ seed: 7, headless: true });
  const a0 = BD.state().ammo, sc0 = BD.state().score, en0 = BD.state().enemies;
  const r1 = BD.shoot();
  const r2 = BD.shoot();
  const s = BD.state();
  check('a shot spends a round', s.ammo === a0 - 2, { ammo: s.ammo, from: a0 });
  check('the thing in front of you can be put down', s.score > sc0 || s.enemies < en0,
    { score: s.score, enemies: s.enemies, hits: [r1 && r1.hits, r2 && r2.hits] });
}

{
  BD.start({ seed: 7, headless: true });
  BD.setRemotes([{ id: 'friend', x: 5, y: 4, h: 100 }]);
  const r = BD.shoot();
  check('a shot in the chest of a friend counts', r && r.hits && r.hits.indexOf('friend') >= 0, r);
  BD.setRemotes([]);
}

{
  BD.start({ seed: 7, headless: true });
  BD.setRemotes([{ id: 'friend', x: 6.5, y: 4, h: 100 }]);
  const r = BD.shoot();
  check('a shot in the chest of a friend down the hall counts', r && r.hits && r.hits.indexOf('friend') >= 0, r);
}

{
  BD.start({ seed: 7, headless: true });
  let dead = null;
  BD.onDead = (score) => { dead = score; };
  BD.hurt(100);
  BD.step(16);
  check('emptying the bar ends the run', BD.state().alive === false && dead === 0,
    { alive: BD.state().alive, dead: dead });
}

{
  BD.start({ seed: 7, headless: true });
  BD.setPaused(true);
  const k = BD.keys();
  k.w = 1;
  const x0 = BD.state().x;
  for (let i = 0; i < 40; i++) BD.step(16);
  check('paused means the player does not walk', BD.state().x === x0, BD.state().x);
  BD.setPaused(false);
  for (let i = 0; i < 40; i++) BD.step(16);
  check('unpausing lets them walk again', BD.state().x > x0, BD.state().x);
}

{
  const A = load(1);
  const B = load(1);
  A.Backdooms.start({ seed: 42, headless: true });
  B.Backdooms.start({ seed: 42, headless: true });
  let same = true;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    if (A.Backdooms.cell(i, j) !== B.Backdooms.cell(i, j)) same = false;
  }
  check('the same seed is the same maze', same);
  B.Backdooms.start({ seed: 99, headless: true });
  let diff = false;
  for (let i = 0; i < 20 && !diff; i++) for (let j = 0; j < 20 && !diff; j++) {
    if (A.Backdooms.cell(i, j) !== B.Backdooms.cell(i, j)) diff = true;
  }
  check('a different seed is a different maze', diff);
}

{
  BD.start({ seed: 7, headless: true });
  const k = BD.keys();
  k.w = 1;
  for (let i = 0; i < 200; i++) BD.step(16);
  check('walking around does not clip through a wall (still in open cells)',
    BD.cell(BD.state().x | 0, BD.state().y | 0) === '0', BD.state());
}

{
  // Other people arrive as SNAPSHOTS, not a stream — net.js only writes a row
  // when something actually changed, because every write is an owner-signed
  // room-wide flood of the WHOLE collection (docs/app-services.md 4). The
  // drawn figure has to ease toward what lands, or a friend teleports.
  const B = load().Backdooms;
  B.start({ seed: 7, headless: true });
  const paleX = () => { const p = B.view().sprites.filter((sp) => sp.pale)[0]; return p ? p.x : null; };
  B.setRemotes([{ id: 'sam', x: 6, y: 4, h: 100 }]);
  check('a first sighting appears where they are', paleX() === 6, paleX());
  B.setRemotes([{ id: 'sam', x: 6.9, y: 4, h: 100 }]);
  B.step(16);
  const eased = paleX();
  check('a moved friend is eased toward, not teleported', eased > 6 && eased < 6.5, eased);
  B.setRemotes([{ id: 'sam', x: 19, y: 4, h: 100 }]);
  B.step(16);
  check('but a lost row snaps instead of gliding across the room', paleX() === 19, paleX());
  B.setRemotes([]);
}

// --- what the 1.2 gauntlet run bought, so none of it can rot back ---------
//
// Every one of these is a bug that SHIPPED, and every one was found by running
// the thing rather than reading it. They are cheap, pure-sim checks; the
// browser cannot be trusted to notice any of them.

{
  // The two you wake to used to stand 2.5 metres away and simply walk in: six
  // passive runs died at 7.4s, to the tick. The room is 0..8 and you wake at
  // (4,4), so 'across the room' has to be a coordinate near 8, not near 7.
  const B = load().Backdooms;
  B.start({ seed: 7, headless: true });
  const s = B.state();
  const d = B.view().sprites.map((sp) => Math.hypot(sp.x - s.x, sp.y - s.y));
  check('you do not wake with something on top of you', Math.min(...d) >= 4,
    d.map((v) => +v.toFixed(2)));
}

{
  // Two seconds of grace, and then a fight you can lose. Both halves matter:
  // no grace is the 7.4-second death, and no death at all is not a game.
  const B = load().Backdooms;
  B.start({ seed: 7, headless: true });
  let t = 0, firstHit = null;
  while (B.state().alive && t < 40000) {
    B.step(16); t += 16;
    if (firstHit === null && B.state().hp < 100) firstHit = t;
  }
  check('nothing can touch you for the first two seconds', firstHit >= 2000, firstHit);
  check('but standing still does kill you', !B.state().alive && t < 25000,
    { deadAt: t, alive: B.state().alive });
}

{
  // They used to close to 0.2 units — inside your head, sprite filling the
  // screen, no way to see the room or the other one.
  const B = load().Backdooms;
  B.start({ seed: 7, headless: true });
  let closest = 99;
  for (let i = 0; i < 900; i++) {
    B.step(16);
    const s = B.state();
    for (const sp of B.view().sprites) {
      if (sp.dying != null) continue;
      closest = Math.min(closest, Math.hypot(sp.x - s.x, sp.y - s.y));
    }
    if (!s.alive) break;
  }
  check('they stop at arm\'s length, not inside your head', closest > 0.45,
    +closest.toFixed(3));
}

{
  // A blocked thing used to stand at a corner for good. A competent bot
  // survived three minutes untouched because of it. Walk the maze (healing so
  // the run lasts) and watch every live hunter that is not yet on you: none
  // may stand frozen in place for a frame.
  let stuck = 0, far = 0;
  for (const seed of [7, 42, 999]) {
    const B = load().Backdooms;
    B.start({ seed, headless: true });
    const k = B.keys();
    let prev = null;
    for (let i = 0; i < 4000; i++) {
      k.w = (i % 400) < 200 ? 1 : 0;
      k.ArrowLeft = (i % 400) >= 380 ? 1 : 0;
      B.step(16);
      const s = B.state();
      if (!s.alive) break;
      if (s.hp < 50) B.hurt(-50);
      const sp = B.view().sprites.filter((x) => !x.pale && x.dying == null).map((x) => [x.x, x.y]);
      if (prev && prev.length === sp.length) {
        sp.forEach((p, j) => {
          if (Math.hypot(p[0] - s.x, p[1] - s.y) <= 1) return;
          far++;
          if (p[0] === prev[j][0] && p[1] === prev[j][1]) stuck++;
        });
      }
      prev = sp;
    }
  }
  check('a blocked thing slides along the wall instead of stopping', far > 1000 && stuck === 0, { stuck, far });
}

{
  // cancelAnimationFrame can only cancel the ONE handle it kept, so a second
  // loop would run for the life of the page — stepping the sim and fighting
  // the live loop over the same state. Each run carries a generation and a
  // stale callback stops rather than rescheduling. Run the real loop on a
  // fake requestAnimationFrame and count the callbacks waiting per frame.
  const queue = new Map();
  let nextId = 1;
  const sb = load();
  sb.requestAnimationFrame = (f) => { const id = nextId++; queue.set(id, f); return id; };
  sb.cancelAnimationFrame = (id) => { queue.delete(id); };
  let restartInFrame = false;
  sb.Render = {
    init: () => true,
    frame: () => { if (restartInFrame) { restartInFrame = false; sb.Backdooms.start({ seed: 7 }); } },
  };
  const B = sb.Backdooms;
  const pump = () => { const fs = Array.from(queue.values()); queue.clear(); fs.forEach((f, i) => f(16 * (nextId + i))); };
  for (let i = 0; i < 8; i++) B.start({ seed: 7 });
  for (let i = 0; i < 5; i++) pump();
  check('eight start() calls leave one render loop', queue.size === 1, queue.size);
  // the door the generation closes: a restart from inside a frame (the old
  // tick then reschedules itself over the new loop's handle)
  restartInFrame = true;
  pump();
  const rightAfter = queue.size;
  for (let i = 0; i < 5; i++) pump();
  check('only one render loop can ever be live', rightAfter === 1 && queue.size === 1, { rightAfter, later: queue.size });
  B.stop();
  pump();
  check('stop() leaves no loop running', queue.size === 0, queue.size);
}

{
  // Bodies stay. Kill twenty things and the room used to be spotless.
  const B = load().Backdooms;
  B.start({ seed: 7, headless: true });
  B.shoot(); B.shoot();
  let corpses = 0;
  for (let i = 0; i < 200; i++) {
    B.step(16);
    corpses = B.view().sprites.filter((sp) => sp.dying != null && sp.dying >= 1).length;
    if (corpses) break;
  }
  check('a body is still there after the death animation ends', corpses > 0, corpses);
}

{
  // THE LEVEL. A 70x70 scan of the old generator found the longest run of open
  // floor with a wall on both sides was SIX tiles, in either axis, anywhere —
  // which is the block width, because crossings every seven cells cut the wall
  // open at every junction. An endless hall was structurally impossible.
  const B = load().Backdooms;
  const HALL = 12;
  let best = 0;
  for (const seed of [42, 7, 999]) {
    B.start({ seed, headless: true });
    // BOTH axes. Scanning only one hid a real asymmetry: a doorway always
    // punched on the same edge cut every horizontal corridor to five tiles
    // while vertical ones ran to ten.
    for (const axis of [0, 1]) {
      let axisBest = 0;
      for (let k = -5; k < 5; k++) {
        const a0 = k * HALL; let run = 0;
        for (let n = -70; n < 70; n++) {
          const at = (u, v) => (axis ? B.cell(v, u) : B.cell(u, v));
          const lane = at(n, a0) === '0' && at(n, a0 + 1) === '0';
          const walled = at(n, a0 - 1) === '1' && at(n, a0 + 2) === '1';
          if (lane && walled) { run++; axisBest = Math.max(axisBest, run); } else run = 0;
        }
      }
      best = best === 0 ? axisBest : Math.min(best, axisBest);
    }
  }
  check('there is a corridor you cannot see the end of', best >= 10, best + ' tiles');
}

{
  // Halls are always lit: a corridor with no fixtures is a corridor whose
  // length you cannot read, and the receding line of them is the strongest
  // depth cue in the game.
  const B = load().Backdooms;
  B.start({ seed: 42, headless: true });
  let lit = 0, hallCells = 0;
  for (let i = 12; i < 60; i++) {
    if (B.cell(i, 12) !== '0') continue;
    hallCells++;
    if (B.light(i, 12)) lit++;
  }
  check('a hall has a line of fixtures down it', hallCells > 20 && lit >= hallCells / 4,
    { hallCells, lit });
}

{
  // Pellets stop at walls. It used to be a hitscan cone that fired through
  // solid mass.
  const B = load().Backdooms;
  B.start({ seed: 42, headless: true });
  // put a friend on the far side of the nearest wall along +x
  const s = B.state();
  let wx = s.x;
  while (wx < s.x + 30 && B.cell(Math.floor(wx), Math.floor(s.y)) === '0') wx += 0.25;
  B.setRemotes([{ id: 'behind', x: wx + 1.5, y: s.y, h: 100 }]);
  const r = B.shoot();
  check('you cannot shoot through the mass', r.hits.indexOf('behind') < 0,
    { wallAt: +wx.toFixed(2), hits: r.hits });
}

// --- the shell: game.js + net.js + touch.js + boot.js on a fake page --------
const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = src('index.html');
const css = src('style.css');
const listing = JSON.parse(src('listing.json'));
const manifest = JSON.parse(src('manifest.json'));

// every element with an id in index.html: tag and initial hidden state
const pageEls = {};
html.replace(/<([a-z0-9]+)\b([^>]*)>/gi, (all, tag, attrs) => {
  const id = /\bid="([^"]+)"/.exec(attrs);
  if (id) pageEls[id[1]] = { tag: tag.toLowerCase(), hidden: /\shidden(\s|$|=)/.test(attrs) };
  return all;
});
const buttonIds = Object.keys(pageEls).filter((id) => pageEls[id].tag === 'button');

const flushP = () => new Promise((r) => setImmediate(r));
async function flushAll() { for (let i = 0; i < 20; i++) await flushP(); }

function shell(opts) {
  opts = opts || {};
  const listen = (o) => {
    o.listeners = {};
    o.addEventListener = (t, f) => { (o.listeners[t] = o.listeners[t] || []).push(f); };
    o.removeEventListener = (t, f) => { o.listeners[t] = (o.listeners[t] || []).filter((g) => g !== f); };
    o.fire = (t, ev) => {
      const e = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {});
      (o.listeners[t] || []).slice().forEach((f) => f(e));
    };
    return o;
  };
  const els = {};
  const mkEl = (id, tag) => {
    const cls = new Set();
    const o = listen({
      id, tagName: (tag || 'div').toUpperCase(), hidden: false, textContent: '', value: '', disabled: false,
      children: [], style: { setProperty() {} },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); },
        contains: (c) => cls.has(c),
      },
      appendChild(c) { this.children.push(c); return c; },
      querySelector: (q) => (q === '.t-knob' ? (els.__knob = els.__knob || mkEl('__knob')) : null),
      getBoundingClientRect: () => ({ width: 120, height: 120 }),
      setPointerCapture() {},
      lockCalls: 0,
      requestPointerLock() { this.lockCalls++; },
    });
    return o;
  };
  Object.keys(pageEls).forEach((id) => {
    const e = mkEl(id, pageEls[id].tag);
    e.hidden = pageEls[id].hidden;
    els[id] = e;
  });
  const intervals = [];
  let ivN = 0;
  const document = listen({
    body: mkEl('body'),
    documentElement: mkEl('html'),
    pointerLockElement: null,
    getElementById: (id) => els[id] || null,
    createElement: (t) => mkEl('', t),
    hasFocus: () => true,
  });
  const stores = {};
  const db = (name) => {
    if (!stores[name]) {
      const st = { rows: {}, puts: [], subs: [] };
      st.api = {
        get: (id) => Promise.resolve(st.rows[id]),
        put: (row) => { st.puts.push(JSON.parse(JSON.stringify(row))); st.rows[row.id] = row; return Promise.resolve(); },
        subscribe: (f) => { st.subs.push(f); },
      };
      stores[name] = st;
    }
    return stores[name].api;
  };
  if (opts.prefs) { db('prefs'); stores.prefs.rows.prefs = opts.prefs; }
  const backs = [];
  const sb = listen({
    console, Math: seededMath(0xB00D), Object, Array, JSON, Date, String, Number, Boolean, Promise, Error,
    document,
    navigator: { maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false }),
    innerWidth: 844, innerHeight: 390,
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: (f, ms) => { const id = ++ivN; intervals.push({ id, f, ms }); return id; },
    clearInterval: (id) => { const i = intervals.findIndex((x) => x.id === id); if (i >= 0) intervals.splice(i, 1); },
    gifos: {
      db,
      me: () => Promise.resolve({ id: 'me-1', name: 'Tester' }),
      onBack: (f) => backs.push(f),
    },
  });
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['game.js', 'net.js', 'touch.js', 'boot.js']) {
    vm.runInContext(src(f), sb, { filename: f });
  }
  // advance every live interval by ms (one tick per period)
  const advance = (ms) => {
    intervals.slice().forEach((iv) => { for (let t = iv.ms; t <= ms; t += iv.ms) if (intervals.indexOf(iv) !== -1) iv.f(); });
  };
  return { sb, els, document, stores, backs, advance, B: sb.Backdooms, Net: sb.Net };
}

async function shellChecks() {
  check('phone pad markup is in the page', !!(pageEls['t-move'] && pageEls['t-fire'] && pageEls['t-look']));
  check('FIRE is a real button, not a lettered tile', pageEls['t-fire'] && pageEls['t-fire'].tag === 'button');
  check('click-to-look overlay exists', !!pageEls.resume);

  // -- pointer lock, pause, Back, death ------------------------------------
  {
    const h = shell({ prefs: { id: 'prefs', speed: 22, best: 3 } });
    await flushAll();
    const canvas = h.els.c;
    check('prefs are read from gifos.db("prefs")', +h.els.m.value === 22 && h.sb.Boot.best === 3,
      { speed: h.els.m.value, best: h.sb.Boot && h.sb.Boot.best });
    check('every button in the page does something (no dead Invite button)',
      buttonIds.length > 0 && buttonIds.every((id) => ['click', 'pointerdown'].some((t) => (h.els[id].listeners[t] || []).length)) &&
      !Object.keys(pageEls).some((id) => /invite/i.test(id)), buttonIds);
    check('boot does not lock the pointer on load', canvas.lockCalls === 0 && !h.B.state().alive);
    h.els['gate-go'].fire('click');
    check('boot locks the pointer on click', canvas.lockCalls === 1 && h.B.state().alive && h.els.gate.hidden === true);

    h.document.pointerLockElement = canvas;
    h.document.fire('pointerlockchange');
    check('a locked pointer plays', h.B.state().paused === false && h.els.resume.hidden === true);
    h.document.pointerLockElement = null;
    h.document.fire('pointerlockchange');
    check('lost pointer lock pauses and offers click to look',
      h.B.state().paused === true && h.els.resume.hidden === false);
    h.els.resume.fire('click');
    check('clicking the overlay asks for the pointer again', canvas.lockCalls === 2);
    h.document.pointerLockElement = canvas;
    h.document.fire('pointerlockchange');
    check('getting it back unpauses and hides the overlay', h.B.state().paused === false && h.els.resume.hidden === true);

    check('Back is wired', h.backs.length === 1);
    const back = h.backs[0];
    const r1 = back();
    check('Back backs out of a run to the gate', r1 === true && h.els.gate.hidden === false && !h.B.state().alive);
    check('Back at the gate lets the OS close', back() === false);

    // death: the over card, and a new best lands in gifos.db('prefs')
    h.els['gate-go'].fire('click');
    h.B.onDead(7);
    const putsP = h.stores.prefs.puts;
    check('dying shows the over card with the score', h.els.over.hidden === false && /\b7\b/.test(h.els['over-score'].textContent));
    check('a new best is saved in gifos.db("prefs")', putsP.length > 0 && putsP[putsP.length - 1].best === 7);
    check('Back from the over card goes to the gate', back() === true && h.els.over.hidden === true && h.els.gate.hidden === false);

    h.els.m.value = '15';
    h.els.m.fire('input');
    const lastPut = putsP[putsP.length - 1];
    check('prefs live in gifos.db', lastPut && lastPut.id === 'prefs' && lastPut.speed === 15, lastPut);
  }

  // -- the room: shared seed, shots published -------------------------------
  {
    const h = shell({});
    await flushAll();
    const players = h.stores.players;
    check('players join gifos.db("players")', !!players && players.subs.length === 1);
    const now = Date.now();
    const rows = [
      { id: 'other-a', seed: 4242, t: now - 500, x: 5, y: 4, a: 0, hp: 100 },
      { id: 'other-b', seed: 99, t: now - 100, x: 30, y: 30, a: 0, hp: 100 },
    ];
    players.subs[0](rows);
    check('the oldest row\'s seed is the maze', h.Net.sharedSeed() === 4242, h.Net.sharedSeed());
    h.els['gate-go'].fire('click');
    check('the room shares a maze seed', h.B.state().seed === 4242, h.B.state().seed);
    const mine = players.puts[players.puts.length - 1];
    check('my row carries the seed for whoever comes next', mine && mine.id === 'me-1' && mine.seed === 4242, mine);
    players.subs[0](rows.map((r) => Object.assign({}, r, { t: Date.now() })));
    const n0 = players.puts.length;
    const r = h.B.shoot();
    const shot = players.puts[players.puts.length - 1];
    check('a shot at a friend is published', r && r.hits.indexOf('other-a') >= 0 && players.puts.length > n0 &&
      shot.shot === 1 && shot.hits.indexOf('other-a') >= 0, { hits: r && r.hits, shot });
    // and the other side: their shot naming me hurts me
    const hp0 = h.B.state().hp;
    players.subs[0]([Object.assign({}, rows[0], { t: Date.now(), shot: 1, hits: ['me-1'] })]);
    check('a friend\'s published shot that names me hurts me', h.B.state().hp < hp0, { hp0, hp: h.B.state().hp });
  }

  // -- thumbs -----------------------------------------------------------------
  {
    const h = shell({});
    await flushAll();
    h.els['gate-go'].fire('click');
    const look = h.els['t-look'];
    const ammo = () => h.B.state().ammo;
    let a0 = ammo();
    look.fire('pointerdown', { pointerId: 1, clientX: 600, clientY: 200 });
    look.fire('pointerup', { pointerId: 1, clientX: 603, clientY: 201 });
    check('look-side tap fires', ammo() === a0 - 1, { ammo: ammo(), from: a0 });
    a0 = ammo();
    const ang0 = h.B.state().a;
    look.fire('pointerdown', { pointerId: 2, clientX: 600, clientY: 200 });
    look.fire('pointermove', { pointerId: 2, clientX: 680, clientY: 200 });
    look.fire('pointerup', { pointerId: 2, clientX: 680, clientY: 200 });
    check('a look drag turns and does not fire', ammo() === a0 && h.B.state().a !== ang0, { ammo: ammo(), a: h.B.state().a });

    // the stick appears under the thumb, wherever it lands on the left
    const mv = h.els['t-move'];
    look.fire('pointerdown', { pointerId: 3, clientX: 200, clientY: 200 });
    const placedA = [mv.style.left, mv.style.top];
    look.fire('pointermove', { pointerId: 3, clientX: 260, clientY: 200 });
    const jx = h.B.keys()._jx;
    look.fire('pointerup', { pointerId: 3, clientX: 260, clientY: 200 });
    look.fire('pointerdown', { pointerId: 4, clientX: 120, clientY: 300 });
    const placedB = [mv.style.left, mv.style.top];
    look.fire('pointerup', { pointerId: 4, clientX: 120, clientY: 300 });
    check('the stick floats under the thumb', placedA[0] === '140px' && placedA[1] === '140px' &&
      placedB[0] === '60px' && placedB[1] === '240px', { placedA, placedB });
    check('pushing the stick right walks right', jx > 0.9 && h.B.keys()._jx === 0, jx);

    const fire = h.els['t-fire'];
    a0 = ammo();
    fire.fire('pointerdown', { pointerId: 5 });
    h.advance(380 * 3);
    const held = a0 - ammo();
    fire.fire('pointerup', { pointerId: 5 });
    const a1 = ammo();
    h.advance(380 * 3);
    check('FIRE repeats while held', held === 4, held);
    check('FIRE stops when let go', ammo() === a1, { a1, now: ammo() });
  }
}

// --- layout: CSS declarations read through a parser (no layout engine here) -
const cssRules = [];
css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => {
  const decls = {};
  body.split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  });
  cssRules.push({ sels: sel.split(',').map((x) => x.trim().replace(/\s+/g, ' ')), decls });
  return all;
});
const cssDecl = (sel, prop) => {
  let v = null;
  cssRules.forEach((r) => { if (r.sels.indexOf(sel) !== -1 && r.decls[prop] != null) v = r.decls[prop]; });
  return v;
};
const pxOf = (v) => { const m = /(-?\d+(?:\.\d+)?)px\)?\s*$/.exec(v || ''); return m ? +m[1] : -1; };
const allDecls = [];
cssRules.forEach((r) => Object.keys(r.decls).forEach((k) => allDecls.push(r.decls[k])));

// The claim is a MINIMUM, so read the number and compare it.
check('phone pad is at least 76px', pxOf(cssDecl('#t-fire', 'width')) >= 76 && pxOf(cssDecl('#t-move', 'width')) >= 120,
  { fire: cssDecl('#t-fire', 'width'), move: cssDecl('#t-move', 'width') });
// The whole left side of the screen used to be dead: the look surface began
// at 40% and the stick was a fixed pad in the corner.
check('the look surface is the WHOLE screen', cssDecl('#t-look', 'inset') === '0', cssDecl('#t-look', 'inset'));
check('the stick never eats a pointer', cssDecl('#t-move', 'pointer-events') === 'none');
// max(14px, env(...)) lands the HUD exactly ON the home indicator; the margin
// has to be added to the inset, not compared with it.
check('safe-area insets are added to, not maxed with',
  !allDecls.some((v) => /max\([^)]*env\(safe-area/.test(v)) &&
  allDecls.some((v) => /^calc\(env\(safe-area-inset-bottom\)\s*\+\s*\d+px\)$/.test(v)));
check('FIRE clears the shells readout',
  pxOf(cssDecl('#t-fire', 'bottom')) > pxOf(cssDecl('.pod', 'bottom')) + 40,
  { fire: cssDecl('#t-fire', 'bottom'), pod: cssDecl('.pod', 'bottom') });

check('author is Kuber, porter is GifOS',
  listing.author.name === 'Kuberwastaken' && listing.porter.name === 'GifOS' && listing.basedOn.blessed === false);
check('pointer + fullscreen + db + multiplayer, no network',
  manifest.capabilities.pointer && manifest.capabilities.fullscreen &&
  manifest.capabilities.db && manifest.capabilities.multiplayer && !manifest.capabilities.network);
check('minBuild stays 1314', manifest.minBuild === 1314);

shellChecks().then(() => {
  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  console.log('\nall pass');
}, (e) => { console.log('FAIL — shell harness threw: ' + (e && e.stack)); process.exit(1); });
