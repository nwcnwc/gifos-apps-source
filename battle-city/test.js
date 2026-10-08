// EAGLE DEFENSE HAS TO ACTUALLY MOVE.
//
// The app shipped with every tank frozen to its spawn tile. `tryMove` tests a
// COPY of the mover and handed it to `canMove`, which skipped the mover with a
// reference compare (`o === tank`) — a compare the copy can never satisfy. So
// every tank found "another" tank parked on its own previous position and
// every move in the game was refused. The player turned on the spot, the bots
// sat in the top row, no stage could be cleared: unplayable from the first
// frame of stage 1, and nothing in the repo noticed, because apps/battle-city
// had no test at all. A game that cannot be finished by a machine is not
// something a human should be asked to check by hand.
//
// So this suite PLAYS it. game.js is a plain IIFE over `root`, and its whole
// simulation is deterministic given the inputs, so the sim runs headless in a
// vm at a fixed 16ms step — no browser, no servers, nothing to go stale. The
// browser-only half (input, layout) is RUN too: boot.js boots over a small DOM
// built from the app's own index.html, and the pad is pressed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// ---- load the shipped sim exactly as the GIF would run it -------------------
// The bot AI and the spawn picker roll dice, so an unseeded run is a suite
// that fails one time in five and gets called a flake. Hand the sandbox a
// fixed stream instead: same tape every run, on every box.
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

function load() {
  const sandbox = {
    console, Math: seededMath(0x5AFE), Object, Array, JSON, Date, String, Number, Boolean,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['stages.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const sandbox = load();
const BC = sandbox.BattleCity;
check('stages.js and game.js load and attach BattleCity',
  !!(BC && BC.create && BC.tick && BC.render));
check('all 35 stages are aboard', (sandbox.BC_STAGES || []).length === 35,
  (sandbox.BC_STAGES || []).length);

const IDLE = [{ dir: null, fire: false }, { dir: null, fire: false }];
const STEP = 16;
const hold = (dir, fire) => [{ dir: dir, fire: !!fire }, { dir: null, fire: false }];

// Run to the first playable frame: title -> start -> curtain -> play.
function fresh(two, stage) {
  const g = BC.create();
  BC.start(g, !!two, stage || 0);
  for (let i = 0; i < 200 && g.phase !== 'play'; i++) BC.tick(g, STEP, IDLE);
  return g;
}

// ---- the bug that shipped ---------------------------------------------------
// One second of held input has to put the tank somewhere else. 0.045 px/ms is
// ~43px in 60 frames; stage 1 leaves the player a clear lane up and to the
// left of the eagle, so assert a floor well under a full run rather than an
// exact number — this is "did it move at all", not a physics pin.
{
  const g = fresh(false, 0);
  check('the game reaches play', g.phase === 'play', g.phase);
  const p = g.players[0];
  const x0 = p.x, y0 = p.y;

  for (let i = 0; i < 60; i++) BC.tick(g, STEP, hold('left'));
  check('the player MOVES when a direction is held', p.x < x0 - 8,
    { from: x0, to: p.x, dir: p.direction });
  check('…and faces the way it went', p.direction === 'left', p.direction);

  const xl = p.x;
  for (let i = 0; i < 60; i++) BC.tick(g, STEP, hold('up'));
  check('…and squares up to the 8px grid when it turns', p.x === Math.round(xl / 8) * 8,
    { xl: xl, x: p.x });
}

// All four directions, on a board cleared of everything that could honestly
// block one — otherwise "it did not move" and "a brick was in the way" are the
// same result, which is how the frozen board read as a hard stage.
{
  for (const dir of ['up', 'down', 'left', 'right']) {
    const g = fresh(false, 0);
    g.map.bricks.fill(false);
    g.map.steels.fill(false);
    g.map.rivers.fill(false);
    g.map.eagle.broken = true;
    g.tanks = g.tanks.filter((t) => t.side === 'player');
    g.players = g.tanks.slice();
    const p = g.players[0];
    p.x = 96; p.y = 96;
    const x0 = p.x, y0 = p.y;
    for (let i = 0; i < 40; i++) BC.tick(g, STEP, hold(dir));
    const d = { up: y0 - p.y, down: p.y - y0, left: x0 - p.x, right: p.x - x0 }[dir];
    check('a clear board lets the tank drive ' + dir, d > 8, { moved: d, x: p.x, y: p.y });
  }
}

// A tank blocking ITSELF is the exact failure, so pin it directly: one tank
// alone on the board, nothing near it, must be able to take a step.
{
  const g = fresh(false, 0);
  g.tanks = g.tanks.filter((t) => t.side === 'player');
  g.players = g.tanks.slice();
  const p = g.players[0];
  const x0 = p.x;
  for (let i = 0; i < 20; i++) BC.tick(g, STEP, hold('left'));
  check('a tank alone on the board does not block itself', p.x < x0,
    { from: x0, to: p.x });
}

// The bots run through the same tryMove/canMove pair, so they froze too.
{
  const g = fresh(false, 0);
  const start = g.tanks.filter((t) => t.side === 'bot').map((t) => ({ id: t.id, x: t.x, y: t.y }));
  check('bots spawn', start.length > 0, start.length);
  for (let i = 0; i < 180; i++) BC.tick(g, STEP, IDLE);
  const moved = start.filter((s) => {
    const t = g.tanks.filter((k) => k.id === s.id)[0];
    return t && (t.x !== s.x || t.y !== s.y);
  });
  check('the bots leave their spawn tiles', moved.length === start.length,
    { spawned: start.length, moved: moved.length });
}

// ---- the rest of the loop, so "playable" means finishable --------------------
{
  // Build the shot rather than hoping for one: bots roam, and "the bullet hit
  // a tank instead" and "the gun does nothing" look identical from the outside.
  const g = fresh(false, 0);
  g.tanks = g.tanks.filter((t) => t.side === 'player');
  g.players = g.tanks.slice();
  const p = g.players[0];
  p.x = 64; p.y = 96; p.direction = 'up'; p.cooldown = 0;
  g.map.bricks.fill(false);
  for (let c = 16; c < 20; c++) g.map.bricks[22 * 52 + c] = true; /* a wall right above the gun */
  const bricks = () => g.map.bricks.filter(Boolean).length;
  const before = bricks();
  check('the wall is standing before the shot', before === 4, before);
  for (let i = 0; i < 30; i++) BC.tick(g, STEP, hold('up', i === 0));
  check('a player bullet eats brick', bricks() < before, { before: before, after: bricks() });

  // A held trigger is one shot per cooldown, not one per frame.
  p.x = 64; p.y = 96; p.direction = 'up'; p.cooldown = 0;
  g.bullets = [];
  for (let i = 0; i < 10; i++) BC.tick(g, STEP, hold(null, true));
  check('firing is on a cooldown, not one bullet per frame',
    g.bullets.filter((b) => b.owner === p.id).length === 1,
    g.bullets.length);
}

{
  // Clear the board and the next stage has to load, or the game is 20 tanks long.
  const g = fresh(false, 0);
  g.remain = [];
  g.tanks.filter((t) => t.side === 'bot').forEach((t) => { t.alive = false; });
  for (let i = 0; i < 200; i++) BC.tick(g, STEP, IDLE);
  check('clearing the stage advances to the next one', g.stageIndex === 1,
    { stage: g.stageIndex, phase: g.phase });
}

{
  // Dying costs a life and gives one back; running out ends the run.
  const g = fresh(false, 0);
  const lives0 = g.players[0].lives;
  for (let death = 0; death < 3; death++) {
    const p = g.players[0];
    p.helmet = 0; p.alive = false; p.visible = false;
    for (let i = 0; i < 200; i++) BC.tick(g, STEP, IDLE);
  }
  check('a death costs a life', g.players[0].lives < lives0,
    { before: lives0, after: g.players[0].lives });
  check('the last life ends the run', g.phase === 'over', g.phase);
}

{
  // The eagle is the whole point. Losing it ends the run immediately.
  const g = fresh(false, 0);
  const e = g.map.eagle;
  g.map.bricks.fill(false); /* the base's own wall would eat the shot first */
  g.bullets.push({
    id: 'x1', owner: 'nobody', side: 'bot', x: e.x + 6, y: e.y - 12,
    direction: 'down', speed: 0.12, power: 1,
  });
  for (let i = 0; i < 60 && g.phase === 'play'; i++) BC.tick(g, STEP, IDLE);
  check('a bullet into the eagle ends the run', g.phase === 'over' && g.map.eagle.broken,
    { phase: g.phase, broken: g.map.eagle.broken });
}

{
  // Every prize has to do its one thing; a dud powerup is a silent tax.
  const g = fresh(false, 0);
  const p = g.players[0];
  const takes = (kind) => { g.pup = { x: p.x, y: p.y, kind: kind, blink: 0 }; BC.tick(g, STEP, IDLE); return g.pup === null; };

  const lives = p.lives;
  check('tank: an extra life', takes('tank') && p.lives === lives + 1);
  check('star: the gun goes up a level', takes('star') && p.level !== 'basic', p.level);
  check('grenade: the board is cleared of bots',
    takes('grenade') && g.tanks.filter((t) => t.side === 'bot' && t.alive).length === 0);
  check('timer: the bots freeze', takes('timer') && g.frozenBots > 0, g.frozenBots);
  check('helmet: a shield', takes('helmet') && p.helmet > 1000, p.helmet);
  const steelsBefore = g.map.steels.filter(Boolean).length;
  check('shovel: the base gets steel walls',
    takes('shovel') && g.map.steels.filter(Boolean).length > steelsBefore,
    { before: steelsBefore, after: g.map.steels.filter(Boolean).length });
}

// ---- two devices: the guest's tank is the host's simulation ------------------
{
  const g = fresh(true, 0);
  check('2P puts two tanks on the board', g.players.length === 2, g.players.length);
  const p2 = g.players[1];
  const x0 = p2.x;
  for (let i = 0; i < 60; i++) {
    BC.tick(g, STEP, [{ dir: null, fire: false }, { dir: 'left', fire: false }]);
  }
  check('the guest tank moves on the guest keys the host relays', p2.x < x0,
    { from: x0, to: p2.x });

  // fireN is an edge counter, not a boolean: the host fires once per bump and
  // not once per frame, however long the guest's row sits there unchanged.
  // Clear the lane first. The guest is parked beside the base: on the real
  // board its shot hits the eagle's own brick two frames later, and with the
  // brick gone it hits the EAGLE and ends the run — neither is a missed fire.
  g.map.bricks.fill(false);
  g.map.steels.fill(false);
  g.tanks.filter((t) => t.side === 'bot').forEach((t) => { t.alive = false; });
  g.bullets = [];
  p2.x = 32; p2.y = 96; p2.direction = 'up'; p2.cooldown = 0;
  const mine = () => g.bullets.filter((b) => b.owner === p2.id).length;
  const n0 = mine();
  for (let i = 0; i < 10; i++) {
    BC.tick(g, STEP, [{ dir: null, fire: false }, { dir: null, fire: false, fireN: 1 }]);
  }
  check('a guest fireN bump fires exactly once', mine() === n0 + 1, { before: n0, after: mine() });
  for (let i = 0; i < 10; i++) {
    BC.tick(g, STEP, [{ dir: null, fire: false }, { dir: null, fire: false, fireN: 1 }]);
  }
  check('…and a stale row does not keep firing', mine() === n0 + 1, mine());
}

{
  // The guest paints what the host sends, so the snapshot has to survive the trip.
  const g = fresh(false, 0);
  for (let i = 0; i < 120; i++) BC.tick(g, STEP, hold('up', i % 30 === 0));
  const snap = BC.snapshot(g);
  const guest = BC.create();
  BC.applySnap(guest, snap);
  check('the world snapshot round-trips the walls',
    guest.map.bricks.filter(Boolean).length === g.map.bricks.filter(Boolean).length &&
    guest.map.steels.filter(Boolean).length === g.map.steels.filter(Boolean).length,
    { bricks: [g.map.bricks.filter(Boolean).length, guest.map.bricks.filter(Boolean).length] });
  check('…and the tanks', guest.tanks.length === g.tanks.filter((t) => t.alive).length,
    { host: g.tanks.filter((t) => t.alive).length, guest: guest.tanks.length });
  check('…and the phase and the enemy count',
    guest.phase === g.phase && guest.remainN === g.remain.length,
    { phase: guest.phase, remainN: guest.remainN, host: g.remain.length });
}

// ---- drawing: a throw in render() is a black screen --------------------------
{
  // A recording stub, not a mock with opinions: it only has to not be missing
  // anything render() reaches for, and to prove the field was painted.
  function stubCtx() {
    const calls = Object.create(null);
    const target = {};
    const ctx = new Proxy(target, {
      get(t, k) {
        if (k === 'canvas') return { width: 256, height: 240 };
        if (typeof k === 'symbol') return undefined;
        if (!(k in t)) t[k] = () => { calls[k] = (calls[k] || 0) + 1; };
        return t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return { ctx: ctx, calls: calls };
  }
  const phases = [];
  const g = BC.create();
  for (const step of ['title', 'stage', 'play', 'over', 'win']) {
    if (step === 'stage') BC.start(g, false, 0);
    if (step === 'play') { for (let i = 0; i < 200 && g.phase !== 'play'; i++) BC.tick(g, STEP, IDLE); }
    if (step === 'over' || step === 'win') g.phase = step;
    const s = stubCtx();
    let threw = null;
    try { BC.render(s.ctx, g); } catch (e) { threw = e.message; }
    phases.push({ step: step, threw: threw, painted: s.calls.fillRect || 0 });
  }
  check('render() survives every phase', phases.every((p) => !p.threw),
    phases.filter((p) => p.threw));
  check('…and paints something in each', phases.every((p) => p.painted > 0),
    phases.map((p) => p.step + ':' + p.painted));

  // The explosions used to be a stroked circle that grew past a whole tile and
  // spilled onto the border chrome. Render a frame through a ctx that keeps
  // the transform and the clip, with and without a big explosion at the
  // field's corner: every pixel the explosion adds must land inside the field.
  function rasterCtx() {
    let st = { tx: 0, ty: 0, clip: null }; const stack = []; let path = null; const painted = [];
    const isect = (a, b) => { if (!b) return a; const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; };
    const api = {
      canvas: { width: 256, height: 240 },
      save() { stack.push(Object.assign({}, st)); }, restore() { st = stack.pop() || { tx: 0, ty: 0, clip: null }; },
      translate(x, y) { st.tx += x; st.ty += y; }, setTransform() { st.tx = 0; st.ty = 0; },
      beginPath() { path = null; }, rect(x, y, w, h) { path = { x: x + st.tx, y: y + st.ty, w, h }; },
      clip() { st.clip = path ? (isect(path, st.clip) || { x: 0, y: 0, w: 0, h: 0 }) : st.clip; },
      fillRect(x, y, w, h) { const r = isect({ x: x + st.tx, y: y + st.ty, w, h }, st.clip); if (r) painted.push(r.x + ',' + r.y + ',' + r.w + ',' + r.h); },
      measureText: () => ({ width: 0 }),
    };
    return { ctx: new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }), painted };
  }
  {
    const g = fresh(false, 0);
    const base = rasterCtx(); BC.render(base.ctx, g);
    g.fx.push({ x: 0, y: 0, t: 200, big: true }, { x: 192, y: 192, t: 200, big: true });   // at the widest step, in two corners
    const boom = rasterCtx(); BC.render(boom.ctx, g);
    const before = new Set(base.painted);
    const added = boom.painted.filter((r) => !before.has(r)).map((r) => r.split(',').map(Number));
    const F = { x: 16, y: 16, w: 208, h: 208 };
    const outside = added.filter(([x, y, w, h]) => x < F.x || y < F.y || x + w > F.x + F.w || y + h > F.y + F.h);
    check('the playfield is clipped so effects cannot paint over the chrome',
      added.length > 0 && outside.length === 0, { added: added.length, outside });
  }
}

// ---- the shell: what a finger and a small screen need ------------------------
// boot.js is RUN: the page's own index.html over a small DOM, its scripts in
// page order, the page clock driven by the frames.
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
  let cur = docEl;
  let body = null, head = null;
  const scripts = [];
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
    addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    removeEventListener: (ev, fn) => { docListeners[ev] = (docListeners[ev] || []).filter((f) => f !== fn); },
    dispatch(type, init) { const ev = Object.assign({ type, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} }, init || {}); for (const fn of (docListeners[type] || []).slice()) fn(ev); return ev; },
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
    frame(ts) { const fns = rafs.splice(0); for (const fn of fns) fn(ts); return fns.length; },
    run(code, filename) { return require('vm').runInContext(code, vmc, { filename: filename || 'inline.js' }); },
  };
}

function bootPage(view, order) {
  const clock = { t: 1e6 };
  class PageDate extends Date { static now() { return clock.t; } }
  const timers = [];
  const dom = fakeDom(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), {
    globals: { Date: PageDate, performance: { now: () => clock.t }, Math: seededMath(0x5AFE),
      btoa: (x) => Buffer.from(x, 'binary').toString('base64'), atob: (x) => Buffer.from(x, 'base64').toString('binary'),
      setTimeout: (fn, ms) => { timers.push({ at: clock.t + (ms || 0), fn }); return timers.length; }, setInterval: () => 0 } });
  Object.assign(dom.win, view || {});
  const srcs = order || dom.scripts.filter((s) => s.src).map((s) => s.src);
  let game = null, error = null;
  try {
    for (const f of srcs) {
      dom.run(fs.readFileSync(path.join(APP, f), 'utf8'), f);
      if (f === 'game.js' && dom.win.BattleCity) { const c0 = dom.win.BattleCity.create; dom.win.BattleCity.create = (o) => (game = c0(o)); }
    }
  } catch (e) { error = e; }
  const step = (n) => { for (let i = 0; i < (n || 1); i++) { clock.t += 16; for (const t of timers.splice(0).filter((x) => { if (x.at <= clock.t) return true; timers.push(x); return false; })) t.fn(); dom.frame(clock.t); } };
  return { dom, error, srcs, step, game: () => game, clock };
}
const settle = () => new Promise((r) => setImmediate(r));
(async () => {
  {
    const p = bootPage();
    await settle(); await settle();
    try { p.step(2); } catch (e) { p.error = p.error || e; }
    check('index.html loads every script the shell needs, in order: the page boots and paints',
      !p.error && !!p.game() && (p.dom.win.BC_STAGES || []).length === 35 && !!p.dom.win.BCSound && !!p.dom.win.BCNet && p.dom.rafs.length === 1,
      p.error && String(p.error));
    for (const f of ['stages.js', 'sound.js', 'game.js', 'net.js']) {
      const q = bootPage(null, p.srcs.filter((x) => x !== f));
      await settle(); await settle();
      let painted = false; try { q.step(2); painted = q.dom.rafs.length === 1 && (q.dom.win.BC_STAGES || []).length === 35; } catch (e) {}
      check('…and without ' + f + ' it does not', !!q.error || !painted);
    }
  }
  try {
    // A tap is shorter than a frame: press and release land between two ticks.
    const p = bootPage();
    await settle(); await settle();
    p.dom.document.dispatch('touchstart');
    const g = p.game();
    p.dom.document.getElementById('t-start').dispatch('pointerdown');
    p.dom.document.getElementById('t-start').dispatch('pointerup');
    for (let i = 0; i < 300 && g.phase !== 'play'; i++) p.step(1);
    g.bullets.length = 0;
    g.map.bricks.fill(false); g.map.steels.fill(false); g.map.rivers.fill(false);
    g.tanks.filter((t) => t !== g.players[0]).forEach((t) => { t.alive = false; });
    const right = p.dom.document.querySelectorAll('button[data-dir]').find((b) => b.getAttribute('data-dir') === 'right');
    const before = g.players[0].direction;
    right.dispatch('pointerdown'); right.dispatch('pointerup');   // the whole tap, between two frames
    p.step(1);
    check('a tapped direction is held past the release (the tank turns)', g.phase === 'play' && before !== 'right' && g.players[0].direction === 'right', { phase: g.phase, before, after: g.players[0].direction });
    p.step(20);
    const x1 = g.players[0].x; p.step(10);
    check('…and then lets go (a tap is a nudge, not a held stick)', g.players[0].x === x1, { x1, x: g.players[0].x });
  } catch (e) { check('the pad can be tapped in a booted page', false, String(e)); }
  try {
    // An integer-only scale threw away half a phone: 390x844 floors to 1x.
    const p = bootPage({ innerWidth: 390, innerHeight: 844 });
    await settle();
    const c = p.dom.document.getElementById('game');
    const w0 = parseFloat(c.style.width);
    check('the board is not scaled by whole steps only (a phone gets more than 1x, in quarter steps)', w0 > 256 * 1.25 && Number.isInteger((w0 / 256) * 4), c.style.width);
    check('…and with no pad shown the board owns the screen', p.dom.document.body.style.paddingBottom === '0px', p.dom.document.body.style.paddingBottom);
    p.dom.document.dispatch('touchstart');
    const pad = parseFloat(p.dom.document.body.style.paddingBottom), h1 = parseFloat(c.style.height);
    check('the pad gets its own strip, and the board is fitted above it',
      pad > 0 && h1 + pad <= 844 && p.dom.document.getElementById('touch').hidden === false, { pad, h1 });
    // …and on a short screen, where the height decides the scale
    const q = bootPage({ innerWidth: 800, innerHeight: 600 });
    await settle();
    q.dom.document.dispatch('touchstart');
    const qc = q.dom.document.getElementById('game');
    const qpad = parseFloat(q.dom.document.body.style.paddingBottom), qh = parseFloat(qc.style.height);
    check('…on a short screen too: board plus pad fit the height', qpad > 0 && qh + qpad <= 600, { qpad, qh });
  } catch (e) { check('the board is fitted in a booted page', false, String(e)); }
  // TEXT-CHECK: a visible rim is paint; only a browser draws it. The parsed
  // stylesheet is read for the pad buttons' border width.
  {
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const decl = {};
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some((x) => x.trim() === '#touch button')) for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    check('the pad buttons have a visible rim', /^[1-9]/.test(decl.border || decl['border-width'] || ''), decl);
  }
  console.log(failures ? `${failures} FAILURES` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
