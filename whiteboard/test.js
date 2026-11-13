'use strict';
// Whiteboard collaboration tests: collab.js (Board merge rules and the room sync),
// run against a fake room (test-lib-room.js) that behaves like the real runtime:
// one owner holds the store, guests hold an optimistic mirror and their writes are
// requests that can be lost. Deterministic: seeded PRNG, virtual clock, no real time.
//   node test.js
const Collab = require('./collab.js');
const { makeRoom, clone } = require('./test-lib-room.js');

// ---- helpers -----------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function check(c, msg) { if (!c) throw new Error(msg || 'check failed'); }
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((msg ? msg + ': ' : '') + 'got ' + x + ' want ' + y);
}
function pick(rnd, a) { return a[Math.floor(rnd() * a.length)]; }
function perms(a) {
  if (a.length <= 1) return [a];
  const out = [];
  a.forEach(function (x, i) { perms(a.slice(0, i).concat(a.slice(i + 1))).forEach(function (p) { out.push([x].concat(p)); }); });
  return out;
}
function el(id, v, n, extra) {
  return Object.assign({ id: id, type: 'rectangle', x: 0, y: 0, width: 100, height: 100, version: v, versionNonce: n, isDeleted: false }, extra || {});
}
function row(actor, e) { return { id: actor + '/' + e.id, a: actor, e: e }; }
function sceneHash(scene) {
  return Array.from(scene.keys()).sort().map(function (id) {
    const e = scene.get(id); return id + '@' + e.version + ':' + e.versionNonce + (e.isDeleted ? 'x' : '');
  }).join(',');
}

// ---- a tiny fake page --------------------------------------------------------
function wrapApi(api, counts, noSettled) {
  return {
    db: function (c) {
      const d = api.db(c), o = {
        put: function (r) { counts[c + 'Put'] = (counts[c + 'Put'] || 0) + 1; return d.put(r); },
        delete: function (id) { counts[c + 'Del'] = (counts[c + 'Del'] || 0) + 1; return d.delete(id); },
        subscribe: function (cb) { return d.subscribe(cb); }
      };
      if (!noSettled) o.settled = function (id) { return d.settled(id); };
      return o;
    }
  };
}
function makePage(api, personId, tag, ctx, opts) {
  opts = opts || {};
  const scene = new Map(), hold = {}, actor = personId + '~' + tag, clk = ctx.room.clock;
  const board = new Collab.Board(actor);
  const page = { scene: scene, hold: hold, board: board, actor: actor, personId: personId, counts: {}, status: { pending: 0, refused: false }, people: [], statuses: 0 };
  function int() { return Math.floor(ctx.rnd() * 2147483647); }
  page.sync = Collab.sync({
    api: wrapApi(api, page.counts, opts.noSettled), board: board, me: { id: personId, name: tag },
    now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer,
    onApply: function (els) {
      els.forEach(function (e) { const cur = scene.get(e.id); if (!cur || Collab.newer(e, cur)) scene.set(e.id, Object.assign({}, e)); });
      if (opts.changeAfterApply) page.changed();
    },
    onPeople: function (l) { page.people = l; },
    onStatus: function (s) { page.status = s; page.statuses++; }
  });
  page.changed = function () { const r = board.local(Array.from(scene.values()), hold); page.sync.touch(); return r; };
  page.edit = function (id, fn) {
    const c = Object.assign({}, scene.get(id)); fn(c);
    c.version++; c.versionNonce = int(); scene.set(id, c); page.changed();
  };
  page.add = function (type, x, y) {
    let id; do { id = 'e' + Math.floor(ctx.rnd() * 0xffffff).toString(36); } while (ctx.used.has(id));
    ctx.used.add(id);
    scene.set(id, { id: id, type: type || 'rectangle', x: x || 0, y: y || 0, width: 100, height: 100, version: 1, versionNonce: int(), isDeleted: false });
    page.changed(); return id;
  };
  page.move = function (id, dx, dy) { page.edit(id, function (e) { e.x += dx; e.y += dy; }); };
  page.text = function (id, s) { page.edit(id, function (e) { e.text = s; }); };
  page.del = function (id) { page.edit(id, function (e) { e.isDeleted = true; }); };
  page.moveMany = function (ids, dx, dy) {
    ids.forEach(function (id) { const c = Object.assign({}, scene.get(id)); c.x += dx; c.y += dy; c.version++; c.versionNonce = int(); scene.set(id, c); });
    page.changed();
  };
  page.bumpInPlace = function (id) { const e = scene.get(id); e.version++; e.versionNonce = int(); e.x += 1; page.changed(); };
  page.live = function () { return Array.from(scene.values()).filter(function (e) { return !e.isDeleted; }); };
  page.start = function () { page.sync.start(); };
  return page;
}
function world(seed, roomOpt) {
  const room = makeRoom(roomOpt), rnd = mulberry32(seed);
  const ctx = { room: room, rnd: rnd, used: new Set() };
  const w = { room: room, rnd: rnd, ctx: ctx, pages: [] };
  w.owner = function (pid, tag, o) { const p = makePage(room.owner(), pid, tag, ctx, o); p.isOwner = true; w.pages.push(p); p.start(); return p; };
  w.guest = function (name, pid, tag, o) {
    const g = room.guest(name), p = makePage(g, pid, tag, ctx, o); p.g = g; w.pages.push(p); p.start(); return p;
  };
  w.adv = function (ms) { return room.clock.advance(ms); };
  w.rows = function () { return Object.keys(room.store.els || {}).map(function (k) { return room.store.els[k]; }); };
  w.rowOf = function (actor, id) { return (room.store.els || {})[actor + '/' + id] || null; };
  return w;
}
function converged(pages, label) {
  label = label || 'pages';
  const ref = pages[0], h = sceneHash(ref.scene), bh = ref.board.hash();
  pages.forEach(function (p) {
    const ph = sceneHash(p.scene);
    if (ph !== h) {
      const a = h.split(','), b = ph.split(','), d = a.filter(function (x) { return b.indexOf(x) < 0; }).concat(b.filter(function (x) { return a.indexOf(x) < 0; }));
      throw new Error(label + ': scene of ' + p.actor + ' differs from ' + ref.actor + ' (' + d.slice(0, 4).join(' ') + ')');
    }
    if (p.board.hash() !== bh) throw new Error(label + ': board hash of ' + p.actor + ' ' + p.board.hash() + ' vs ' + bh);
    if (p.board.digest() !== ph) throw new Error(label + ': scene of ' + p.actor + ' differs from its own board');
    if (p.sync.pending() !== 0) throw new Error(label + ': ' + p.actor + ' pending ' + p.sync.pending());
  });
}
const TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'text'];
function fuzzStep(w, pages) {
  const rnd = w.rnd, p = pick(rnd, pages), live = p.live(), r = rnd();
  if (!live.length || r < 0.25) p.add(pick(rnd, TYPES), Math.floor(rnd() * 800), Math.floor(rnd() * 600));
  else {
    const e = pick(rnd, live);
    if (r < 0.6) p.move(e.id, Math.floor(rnd() * 60) - 30, Math.floor(rnd() * 60) - 30);
    else if (r < 0.85) p.text(e.id, 't' + Math.floor(rnd() * 1000));
    else p.del(e.id);
  }
}

// ---- runner ------------------------------------------------------------------
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ============================ Board (pure) ====================================
t('rule: higher version wins, tie goes to lower nonce, order and duplicates do not matter', async function () {
  check(Collab.newer(el('a', 2, 9), el('a', 1, 0)), 'higher version');
  check(!Collab.newer(el('a', 1, 0), el('a', 2, 9)), 'lower version');
  check(Collab.newer(el('a', 2, 3), el('a', 2, 4)), 'lower nonce');
  check(!Collab.newer(el('a', 2, 4), el('a', 2, 3)), 'higher nonce');
  check(!Collab.newer(el('a', 2, 3), el('a', 2, 3)), 'identical is not newer');
  const rows = [row('w1', el('E', 3, 700)), row('w2', el('E', 3, 200)), row('w3', el('E', 2, 1))];
  let ref = null;
  perms(rows).forEach(function (order) {
    const variants = [order, order.concat(order), order.concat(order.slice().reverse())];
    variants.forEach(function (rs) {
      const b = new Collab.Board('me~t');
      rs.forEach(function (r) { b.ingest([clone(r)]); });
      eq(b.get('E').versionNonce, 200, 'winner');
      if (ref === null) ref = b.hash(); else eq(b.hash(), ref, 'hash');
      const b2 = new Collab.Board('me~t'); b2.ingest(clone(rs)); eq(b2.hash(), ref, 'one batch');
    });
  });
  // a writer's row replaced by a newer version of the same row
  const b = new Collab.Board('me~t');
  b.ingest([row('w1', el('E', 1, 5))]);
  const ap = b.ingest([row('w1', el('E', 4, 5))]);
  eq(ap.length, 1); eq(b.get('E').version, 4);
});

t('local: ignores unchanged, held and never-published deleted; marks published delete; reports stale', async function () {
  const b = new Collab.Board('me~t');
  const a = el('A', 1, 10);
  eq(b.local([a]).marked, 1, 'first'); eq(b.local([a]).marked, 0, 'unchanged');
  const h = el('B', 1, 11);
  eq(b.local([h], { B: true }).marked, 0, 'held'); check(b.get('B') === null, 'held not on board');
  eq(b.local([h], { B: true }).marked, 0, 'held still');
  eq(b.local([h], {}).marked, 1, 'released');
  const d = el('C', 1, 12, { isDeleted: true });
  eq(b.local([d]).marked, 0, 'never-published deleted'); check(b.get('C') === null, 'not on board');
  eq(b.local([el('A', 2, 13, { isDeleted: true })]).marked, 1, 'published then deleted');
  check(b.get('A').isDeleted === true && b.mine.A.dirty, 'delete is mine and dirty');
  b.ingest([row('o~1', el('D', 5, 1))]);
  let r = b.local([el('D', 3, 2)]);
  eq(r.marked, 0); eq(r.stale, ['D'], 'older scene copy is stale');
  b.ingest([row('o~1', el('F', 2, 5))]);
  r = b.local([el('F', 2, 9)]); eq(r.stale, ['F'], 'same version higher nonce is stale'); eq(r.marked, 0);
  r = b.local([el('F', 2, 5)]); eq(r.stale, [], 'identical to winner is neither'); eq(r.marked, 0);
});

t('in-place mutation of a scene element does not corrupt the board', async function () {
  const b = new Collab.Board('me~t');
  const e = el('A', 1, 10, { x: 5 });
  eq(b.local([e]).marked, 1);
  e.version = 2; e.versionNonce = 11; e.x = 50; // the engine edits its own object
  eq(b.get('A').version, 1, 'board copy unchanged'); eq(b.get('A').x, 5);
  check(b.mine.A.el !== e && b.get('A') !== e, 'board holds its own copy');
  const before = b.hash();
  eq(b.local([e]).marked, 1, 'next local sees the new version');
  eq(b.get('A').version, 2); eq(b.get('A').x, 50); check(b.hash() !== before);
  e.version = 3; e.x = 99;
  eq(b.get('A').version, 2, 'still its own copy');
});

t('hostile rows: nothing throws, nothing merges', async function () {
  const b = new Collab.Board('me~t');
  const good = el('G', 1, 1);
  const bad = [
    { id: 'x/', a: 'x', e: el('', 1, 1) },
    { id: 'x/E', a: 'x', e: Object.assign(el('E', 1, 1), { id: undefined }) },
    row('x', el('E', 1.5, 1)), row('x', el('E', 0, 1)), row('x', el('E', -3, 1)), row('x', el('E', 1e13, 1)),
    row('x', el('E', 1, NaN)), row('x', el('E', 1, Infinity)), row('x', el('E', 1, '5')),
    row('x', el('E', 1, 1, { type: 'weird' })), row('x', el('E', 1, 1, { type: 'selection' })), row('x', el('E', 1, 1, { type: 5 })),
    row('x', el('E', 1, 1, { x: NaN })), row('x', el('E', 1, 1, { y: 'a' })),
    row('x', el('E'.repeat(65), 1, 1)),
    { id: 'x/other', a: 'x', e: el('E', 1, 1) },
    { id: 'y/E', a: 'x', e: el('E', 1, 1) },
    { id: 'x/E', a: 5, e: el('E', 1, 1) },
    { id: 'x/E', e: el('E', 1, 1) },
    row('me~t', el('E', 9, 1)), { id: 'me~t/E', a: 'z', e: el('E', 9, 1) },
    { id: 'x/E' }, { id: 'x/E', a: 'x', e: null }, { id: 'x/E', a: 'x', e: [] }, { id: 'x/E', a: 'x', e: 'str' },
    [], [1, 2], 'a string', null, undefined, 7, true, {}, { id: 5 }
  ];
  let ap = null;
  try { ap = b.ingest(bad); } catch (e) { throw new Error('ingest threw ' + e.message); }
  eq(ap, [], 'nothing applied'); eq(b.elements().length, 0, 'nothing merged');
  [null, undefined, 'abc', 5, {}].forEach(function (x) { eq(b.ingest(x), [], 'ingest of ' + typeof x); });
  eq(b.local([el('Q', 1, NaN), el('R', 1, 1, { type: 'selection' }), el('S', 0.5, 1)]).marked, 0, 'local refuses illegal scene elements');
  eq(b.ingest([row('x', good)]).length, 1, 'control row is taken'); eq(b.elements().length, 1);
});

t('superseded: foreign newer copy marks my row gone; editing again brings it back', async function () {
  const b = new Collab.Board('me~t');
  b.local([el('X', 1, 5)]);
  eq(b.ingest([row('o~1', el('X', 1, 9))]).length, 0, 'loser row changes nothing');
  check(!b.mine.X.gone, 'not gone by a loser');
  const ap = b.ingest([row('o~1', el('X', 3, 7))]);
  eq(ap.length, 1); eq(b.get('X').version, 3, 'foreign wins');
  check(b.mine.X.gone && b.mine.X.dirty, 'my row is gone and a delete is pending');
  eq(b.local([el('X', 4, 9)]).marked, 1, 'edit again'); eq(b.get('X').version, 4);
  check(!b.mine.X.gone && b.mine.X.dirty, 'row is back');
});

// ============================ Sync through the room ===========================
t('superseded in the room: loser row is deleted, comes back after a new edit, one row per element', async function () {
  const w = world(51), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(500);
  const id = O.add('rectangle', 0, 0);
  await w.adv(2000);
  check(w.rowOf(O.actor, id), 'owner row there');
  B.move(id, 5, 5);
  await w.adv(3000);
  check(!w.rowOf(O.actor, id), 'owner row deleted after being superseded');
  check(w.rowOf(B.actor, id), 'winner row stays');
  eq(w.rows().length, 1);
  O.move(id, 1, 1);
  await w.adv(3000);
  check(w.rowOf(O.actor, id), 'owner row is back'); check(!w.rowOf(B.actor, id), 'B row now superseded');
  eq(w.rows().length, 1); converged([O, B]);
});

t('superseded within a second leaves no ghost row in the room', async function () {
  const w = world(52), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(600);
  const id = B.add('rectangle', 0, 0);
  await w.adv(300);
  O.move(id, 5, 5);
  await w.adv(20000);
  converged([O, B]);
  eq(w.rows().map(function (r) { return r.a; }), [O.actor], 'rows in the room (a stale put resend must not resurrect the loser row)');
});

t('ghost by a stale put delivered after the delete is removed again', async function () {
  const w = world(53), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  const id = B.add('rectangle', 0, 0);
  await w.adv(3000);
  O.move(id, 5, 5);
  await w.adv(4000);
  eq(w.rows().map(function (r) { return r.a; }), [O.actor], 'one row before the replay');
  w.room.replay('B', 'els', B.actor + '/' + id);
  await w.adv(60);
  check(w.rowOf(B.actor, id), 'the stale put really arrived');
  await w.adv(10000);
  eq(w.rows().map(function (r) { return r.a; }), [O.actor], 'one row again');
  converged([O, B, C]);
});

t('old sharer state that holds a superseded loser row: the row is removed again', async function () {
  const w = world(54), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  const id = B.add('rectangle', 0, 0);
  await w.adv(3000);
  const loser = clone(w.rowOf(B.actor, id));
  O.move(id, 5, 5);
  await w.adv(4000);
  const saved = w.room.saveStore();
  saved.els[B.actor + '/' + id] = loser;
  eq(Object.keys(saved.els).length, 2, 'saved state holds both rows');
  w.room.restartOwnerWithOldState(saved);
  await w.adv(15000);
  eq(w.rows().map(function (r) { return r.a; }), [O.actor], 'loser row removed again');
  converged([O, B, C]);
});

t('four pages add and move each other\'s elements and converge to one row per element', async function () {
  const w = world(6), O = w.owner('own', 'o'), g1 = w.guest('g1', 'p1', 'a'), g2 = w.guest('g2', 'p2', 'b'), g3 = w.guest('g3', 'p3', 'c');
  const pages = [O, g1, g2, g3];
  await w.adv(500);
  const own = new Map(pages.map(function (p) { return [p, []]; }));
  for (let round = 0; round < 5; round++) {
    pages.forEach(function (p) { own.get(p).push(p.add(pick(w.rnd, TYPES), Math.floor(w.rnd() * 500), Math.floor(w.rnd() * 500))); });
    await w.adv(Math.floor(w.rnd() * 300));
    for (const p of pages) {
      const foreign = Array.from(p.scene.keys()).filter(function (id) { return own.get(p).indexOf(id) < 0; });
      if (foreign.length) p.move(pick(w.rnd, foreign), Math.floor(w.rnd() * 40), 7);
      await w.adv(Math.floor(w.rnd() * 120));
    }
  }
  await w.adv(30000);
  converged(pages);
  eq(O.scene.size, 20, 'elements');
  const rows = w.rows(), ids = new Set(rows.map(function (r) { return r.e.id; }));
  if (rows.length !== 20) {
    const by = {}; rows.forEach(function (r) { (by[r.e.id] = by[r.e.id] || []).push(r.a + ' v' + r.e.version + ':' + r.e.versionNonce); });
    throw new Error('rows in the room ' + rows.length + ' want 20: ' + Object.keys(by).filter(function (k) { return by[k].length > 1; }).map(function (k) { return k + ' [' + by[k].join(' | ') + '] win ' + O.board.get(k).version + ':' + O.board.get(k).versionNonce; }).join('; '));
  }
  eq(rows.length, 20, 'rows in the room'); eq(ids.size, 20, 'distinct elements in rows');
  pages.forEach(function (p) { eq(p.sync.pending(), 0); });
});

for (let seed = 1; seed <= 15; seed++) {
  t('fuzz seed ' + seed + ': 4 pages, 300 steps, converge', async function () {
    const w = world(1000 + seed), O = w.owner('own', 'o'), g1 = w.guest('g1', 'p1', 'a'), g2 = w.guest('g2', 'p2', 'b'), g3 = w.guest('g3', 'p3', 'c');
    const pages = [O, g1, g2, g3], guests = [g1, g2, g3];
    await w.adv(500);
    for (let i = 0; i < 300; i++) {
      fuzzStep(w, pages);
      if (w.rnd() < 0.05) pick(w.rnd, guests).g.dropActs = 1;
      await w.adv(Math.floor(w.rnd() * 401));
    }
    await w.adv(60000);
    converged(pages, 'seed ' + seed);
  });
}

async function lostWrite(variant) {
  // variant: 'soft' platform retries; 'hard' platform gives up; 'hardest' give up then snapshot erases the row;
  //          'early' snapshot erases the optimistic row before the platform gives up (row check path)
  const w = world(80 + variant.length, variant === 'soft' ? {} : { ACT_TRIES: 1 });
  const O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  B.g.dropActs = 1;
  const id = B.add('rectangle', 10, 10);
  let steps = 0;
  async function step(ms) { await w.adv(ms); steps++; check(B.scene.has(id), 'B lost its own element at step ' + steps); }
  await step(100);
  if (variant === 'early') { w.room.snap(); await step(100); check(!(B.g.mirror.els || {})[B.actor + '/' + id] || true); }
  if (variant !== 'early') { for (let i = 0; i < 6; i++) await step(100); }
  if (variant === 'early') for (let i = 0; i < 6; i++) await step(100);
  if (variant === 'hard' || variant === 'hardest') check(!w.rowOf(B.actor, id), 'the act was really lost');
  if (variant === 'hardest') {
    for (let i = 0; i < 100 && w.room.stats.gaveUp < 1; i++) await step(100);
    check(w.room.stats.gaveUp >= 1, 'platform gave up');
    w.room.snap(); await step(120);
    check(!(B.g.mirror.els || {})[B.actor + '/' + id], 'snapshot erased the optimistic row');
  }
  for (let i = 0; i < 200; i++) await step(100);
  check(w.rowOf(B.actor, id), 'owner has the row');
  check(O.scene.has(id), 'owner page has it'); check(C.scene.has(id), 'C has it');
  if (variant === 'hard' || variant === 'hardest') { check(B.sync.stats.resent > 0, 'resent > 0 (was ' + B.sync.stats.resent + ')'); check(w.room.stats.gaveUp >= 1, 'gave up'); }
  if (variant === 'early') { check(B.sync.stats.resent > 0, 'row check re-sent'); eq(w.room.stats.gaveUp, 0, 'platform never gave up'); }
  converged([O, B, C]);
}
t('lost write: a dropped act is retried by the platform', function () { return lostWrite('soft'); });
t('lost write: platform gives up (ACT_TRIES=1), settled false, sync re-puts', function () { return lostWrite('hard'); });
t('lost write: platform gives up, snapshot erases optimistic row, still lands', function () { return lostWrite('hardest'); });
t('lost write: snapshot erases the optimistic row early, row check re-puts', function () { return lostWrite('early'); });

t('api without settled: one dropped act still lands via the single re-send', async function () {
  const w = world(90, { ACT_TRIES: 1 }), O = w.owner('own', 'o');
  const B = w.guest('B', 'pb', 'b', { noSettled: true }), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  B.g.dropActs = 1;
  const id = B.add('ellipse', 3, 3);
  await w.adv(1000);
  check(!w.rowOf(B.actor, id), 'the act was really lost');
  await w.adv(15000);
  check(w.rowOf(B.actor, id), 'owner has the row');
  check(B.sync.stats.resent >= 1, 'resent ' + B.sync.stats.resent);
  eq(w.room.stats.gaveUp, 1); check(O.scene.has(id) && C.scene.has(id));
  converged([O, B, C]);
});

t('sharer away: pending and refused, then everything arrives', async function () {
  const w = world(100), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(600);
  w.room.setReadOnlyAway(true);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(B.add('rectangle', i * 10, 0));
  await w.adv(7000);
  eq(B.status, { pending: 5, refused: true }, 'status while away');
  eq(w.rows().length, 0, 'nothing at the owner');
  w.room.setReadOnlyAway(false);
  await w.adv(10000);
  eq(w.rows().length, 5, 'rows arrived'); eq(B.status, { pending: 0, refused: false }, 'status after');
  ids.forEach(function (id) { check(O.scene.has(id), 'owner page has ' + id); });
  converged([O, B]);
});

t('offline then rejoin: both sides edit, including the same element, and converge', async function () {
  const w = world(110), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  const X = O.add('rectangle', 0, 0), Y = C.add('ellipse', 5, 5);
  await w.adv(3000); converged([O, B, C]);
  B.g.offline = true;
  B.move(X, 5, 5); B.text(Y, 'offline'); const Z = B.add('diamond', 9, 9);
  O.move(X, 30, 0); O.text(Y, 'online'); C.move(Y, 1, 1); O.move(X, 1, 1);
  await w.adv(8000);
  B.g.reconnect();
  await w.adv(40000);
  converged([O, B, C]);
  check(O.scene.has(Z) && C.scene.has(Z), 'B\'s offline element reached the others');
});

t('sharer comes back with OLD state: rows re-put, board heals, late joiner sees the full board', async function () {
  const w = world(120), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  const pages = [O, B, C];
  await w.adv(600);
  const first = [];
  pages.forEach(function (p) { for (let i = 0; i < 4; i++) first.push(p.add(pick(w.rnd, TYPES), i * 20, 0)); });
  await w.adv(6000);
  const saved = w.room.saveStore();
  B.move(first[0], 3, 3); B.move(first[5], 4, 4); C.text(first[1], 'more'); C.del(first[2]); O.move(first[9], 8, 8);
  for (let i = 0; i < 3; i++) B.add('ellipse', 7, i);
  C.add('arrow', 1, 1);
  await w.adv(6000);
  converged(pages);
  const before = O.board.hash();
  w.room.restartOwnerWithOldState(saved);
  await w.adv(40000);
  converged(pages, 'after restart');
  eq(O.board.hash(), before, 'full board survived');
  O.board.elements().forEach(function (e) {
    check(w.rows().some(function (r) { return r.e.id === e.id && Collab.keyOf(r.e) === Collab.keyOf(e); }), 'winner row of ' + e.id + ' is back in the owner store');
  });
  const late = w.guest('late', 'pl', 'l');
  await w.adv(6000);
  converged([O, B, C, late], 'late joiner');
  eq(late.board.hash(), before);
});

t('heal by a bystander: a page that left cannot re-send, another page re-publishes its elements', async function () {
  const w = world(130), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c'), D = w.guest('D', 'pd', 'd');
  await w.adv(600);
  O.add('rectangle', 0, 0);
  await w.adv(2000);
  const saved = w.room.saveStore();
  const ids = [B.add('rectangle', 1, 1), B.add('ellipse', 2, 2), B.add('diamond', 3, 3)];
  await w.adv(4000);
  converged([O, B, C, D]);
  B.sync.stop();
  await w.adv(500);
  w.room.restartOwnerWithOldState(saved);
  await w.adv(10000);
  const rest = [O, C, D], healed = rest.map(function (p) { return p.sync.stats.healed; });
  console.log('# heal: healed per remaining page (owner, C, D) = ' + healed.join(', '));
  check(healed.some(function (n) { return n > 0; }), 'some page healed');
  ids.forEach(function (id) {
    const win = O.board.get(id);
    check(w.rows().some(function (r) { return r.e.id === id && Collab.keyOf(r.e) === Collab.keyOf(win); }), 'owner store has ' + id + ' again');
  });
  const late = w.guest('late', 'pl', 'l');
  await w.adv(5000);
  ids.forEach(function (id) { check(late.scene.has(id), 'late joiner sees ' + id); });
  converged([O, C, D, late], 'after heal');
});

t('late joiner: same board as the others, no puts', async function () {
  const w = world(140), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(600);
  for (let i = 0; i < 150; i++) { fuzzStep(w, [O, B, C]); await w.adv(Math.floor(w.rnd() * 300)); }
  await w.adv(30000);
  converged([O, B, C]);
  const late = w.guest('late', 'pl', 'l', { changeAfterApply: true });
  await w.adv(10000);
  converged([O, B, C, late], 'late');
  eq(late.sync.stats.puts, 0, 'puts'); eq(late.sync.stats.dels, 0, 'dels'); eq(late.counts.elsPut || 0, 0, 'api puts');
  late.changed(); await w.adv(2000); eq(late.sync.stats.puts, 0, 'puts after changed()');
});

t('two pages of the same person do not overwrite each other\'s rows', async function () {
  const w = world(150), O = w.owner('own', 'o'), A = w.guest('ga', 'same', 'a'), B = w.guest('gb', 'same', 'b');
  await w.adv(600);
  check(A.actor !== B.actor, 'actors differ');
  const ia = [A.add('rectangle', 0, 0), A.add('ellipse', 1, 1)], ib = [B.add('rectangle', 2, 2), B.add('diamond', 3, 3)];
  await w.adv(3000);
  A.move(ib[0], 5, 5); B.move(ia[0], 6, 6); A.text(ia[1], 'a'); B.text(ib[1], 'b');
  await w.adv(3000);
  A.move(ia[1], 9, 9); B.move(ib[1], 9, 9);
  await w.adv(20000);
  converged([O, A, B]);
  eq(O.scene.size, 4);
  w.rows().forEach(function (r) { check(r.a === A.actor || r.a === B.actor, 'row actor ' + r.a); check(r.id === r.a + '/' + r.e.id); });
  eq(w.rows().length, 4, 'one row per element');
});

t('held stroke: 200 in-place bumps send nothing, release sends once', async function () {
  const w = world(160), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(600);
  const id = 'stroke1';
  B.scene.set(id, { id: id, type: 'freedraw', x: 0, y: 0, width: 1, height: 1, version: 1, versionNonce: 77, isDeleted: false });
  B.hold[id] = true;
  for (let i = 0; i < 200; i++) { B.bumpInPlace(id); await w.adv(20); }
  await w.adv(2000);
  eq(B.sync.stats.puts, 0, 'puts while held'); eq(B.counts.elsPut || 0, 0); check(!w.rowOf(B.actor, id), 'nothing in the room');
  eq(B.scene.get(id).version, 201);
  delete B.hold[id]; B.changed();
  await w.adv(3000);
  eq(B.sync.stats.puts, 1, 'puts after release');
  eq(w.rowOf(B.actor, id).e.version, 201); eq(O.scene.get(id).version, 201);
  converged([O, B]);
});

t('traffic: one dragged element is sent at most once per flush window', async function () {
  const w = world(170), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(600);
  const id = B.add('rectangle', 0, 0);
  await w.adv(2000);
  const p0 = B.sync.stats.puts;
  for (let i = 0; i < 60; i++) { B.move(id, 3, 1); await w.adv(50); }
  await w.adv(3000);
  const n = B.sync.stats.puts - p0;
  check(n > 1, 'puts ' + n); check(n <= 3000 / 150 + 2, 'puts ' + n + ' > ' + (3000 / 150 + 2));
  check(B.sync.stats.maxBytes < 1024, 'row bytes ' + B.sync.stats.maxBytes);
  eq(O.scene.get(id).x, 180); converged([O, B]);
});

t('traffic: 30 elements dragged at once use the slower window', async function () {
  const w = world(171), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b');
  await w.adv(600);
  const ids = []; for (let i = 0; i < 30; i++) ids.push(B.add('rectangle', i, i));
  await w.adv(4000);
  const p0 = B.sync.stats.puts;
  for (let i = 0; i < 60; i++) { B.moveMany(ids, 2, 0); await w.adv(50); }
  await w.adv(3000);
  const n = B.sync.stats.puts - p0;
  check(n >= 30, 'puts ' + n); check(n <= 30 * (3000 / 400 + 2), 'puts ' + n + ' > ' + 30 * (3000 / 400 + 2));
  check(B.sync.stats.maxBytes < 1024, 'row bytes ' + B.sync.stats.maxBytes);
  converged([O, B]);
});

t('presence: three pages list three people, exactly one me', async function () {
  const w = world(180), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(2000);
  [O, B, C].forEach(function (p) {
    eq(p.people.length, 3, p.actor + ' people'); const me = p.people.filter(function (x) { return x.me; });
    eq(me.length, 1, 'one me'); eq(me[0].id, p.actor);
    eq(p.people.map(function (x) { return x.pid; }).sort(), ['own', 'pb', 'pc']);
  });
});

t('presence: a page that stops beating drops out after STALE_MS; stop() deletes its row', async function () {
  const w = world(181), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(2000); eq(O.people.length, 3);
  C.g.offline = true; // beats no longer arrive
  await w.adv(4000); eq(O.people.length, 3, 'still there shortly after');
  await w.adv(Collab.STALE_MS + 4000);
  eq(O.people.map(function (x) { return x.pid; }).sort(), ['own', 'pb'], 'C dropped out'); eq(B.people.length, 2);
  check((w.room.store.pres || {})[B.actor], 'B row exists');
  B.sync.stop(); await w.adv(500);
  check(!(w.room.store.pres || {})[B.actor], 'B row deleted by stop()');
  eq(O.people.map(function (x) { return x.pid; }), ['own'], 'B gone at once');
});

t('presence: pointer is throttled and silent when alone', async function () {
  const w = world(182), O = w.owner('own', 'o'), B = w.guest('B', 'pb', 'b'), C = w.guest('C', 'pc', 'c');
  await w.adv(2000);
  const c0 = B.counts.presPut || 0;
  for (let i = 0; i < 100; i++) { B.sync.setPointer(i, i * 2); await w.adv(20); }
  await w.adv(500);
  const n = (B.counts.presPut || 0) - c0;
  check(n >= 2, 'pointer was sent ' + n); check(n <= 2000 / 400 + 2 + 1, 'presence puts ' + n);
  const seen = O.people.filter(function (x) { return x.pid === 'pb'; })[0];
  check(seen && typeof seen.x === 'number', 'others see the pointer');
  const w2 = world(183), S = w2.owner('own', 'o');
  await w2.adv(2000);
  const s0 = S.counts.presPut || 0;
  for (let i = 0; i < 100; i++) { S.sync.setPointer(i, i); await w2.adv(20); }
  check((S.counts.presPut || 0) - s0 <= 1, 'alone: only a heartbeat, got ' + ((S.counts.presPut || 0) - s0));
});

t('engine tidying after an apply is not sent, a real edit still is', async () => {
  // A joins a board that B made. The engine re-numbers the stacking order of what it was
  // given and counts that as a new version; that must not become A's own write.
  const a = new Collab.Board('pa~1');
  const row = (el) => ({ id: 'pb~1/' + el.id, a: 'pb~1', e: el });
  const base = { type: 'rectangle', x: 1, y: 2, width: 10, height: 10, isDeleted: false, index: 'a1', boundElements: null, groupIds: [] };
  const e1 = Object.assign({ id: 'e1', version: 3, versionNonce: 50 }, base);
  const e2 = Object.assign({ id: 'e2', version: 3, versionNonce: 60 }, base);
  check(a.ingest([row(e1), row(e2)]).length === 2, 'both applied');
  const t1 = Object.assign({}, e1, { version: 4, versionNonce: 7, index: 'a2', updated: 9 });
  const t2 = Object.assign({}, e2, { version: 4, versionNonce: 8, index: 'a3', boundElements: [{ id: 'x', type: 'arrow' }] });
  let r = a.local([t1, t2], null, true);
  check(r.marked === 0 && r.stale.length === 0, 'tidied copies are not marked: ' + JSON.stringify(r));
  check(Object.keys(a.mine).length === 0, 'no rows of mine');
  r = a.local([t1, t2], null, false);
  check(r.marked === 0, 'and stay unmarked on later scene changes');
  // the same change outside the tidy moment is a person's doing (send to back) and is sent
  const b = new Collab.Board('pc~1');
  b.ingest([row(e1)]);
  check(b.local([t1], null, false).marked === 1, 'an order change by a person is sent');
  // a real edit in the tidy moment is still sent
  const moved = Object.assign({}, e2, { version: 4, versionNonce: 9, x: 99, index: 'a3' });
  const c = new Collab.Board('pd~1');
  c.ingest([row(e2)]);
  check(c.local([moved], null, true).marked === 1, 'a move is sent even in the tidy moment');
  // and a later edit on top of a tidied copy is sent
  const t1b = Object.assign({}, t1, { version: 5, versionNonce: 3, x: 40 });
  check(a.local([t1b, t2], null, false).marked === 1, 'an edit after tidying is sent');
  check(Collab.onlyTidied(t1, e1) && !Collab.onlyTidied(moved, e2), 'onlyTidied');
});

// ---- run ---------------------------------------------------------------------
(async function () {
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('ok ' + name); }
    catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); }
  }
  console.log('whiteboard: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
