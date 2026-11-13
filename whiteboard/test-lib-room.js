'use strict';
// Fake room for tests. Models the real runtime: one OWNER holds the store; every
// GUEST has a `mirror` (owner state + its own optimistic writes) and a `canon`
// (only what the owner last sent). A guest write is a request ("act") that can be
// lost. Rows are opaque JSON records with an `id`. Virtual clock, no real time.
//
//   const { makeRoom } = require('./test-lib-room.js');
//   const room = makeRoom({ delay: 50, ACT_TRIES: 40 });
//   const owner = room.owner();          // api: { db(collection) }
//   const g = room.guest('g1');          // api too (g.db), plus levers below
//   await room.clock.advance(1000);
//   api.db(c): put(row) delete(id) subscribe(cb) settled(id)
//   room levers: room.ACT_TRIES, room.delay, room.setReadOnlyAway(bool), room.snap(),
//     room.saveStore(), room.restartOwnerWithOldState(saved), room.replay(guest, c, id), room.stats, room.actLog
//   guest levers: g.dropActs = N, g.offline = bool, g.reconnect(), g.mirror, g.canon
//   clock: room.clock.now / setTimer(fn, ms) / clearTimer(h) / advance(ms) / settle()

function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

function makeClock() {
  const vt = { t: 1000, seq: 0, timers: [], settle: settle };
  vt.now = function () { return vt.t; };
  vt.setTimer = function (fn, ms) { const h = ++vt.seq; vt.timers.push({ h: h, at: vt.t + Math.max(0, ms | 0), fn: fn }); return h; };
  vt.clearTimer = function (h) { vt.timers = vt.timers.filter(function (x) { return x.h !== h; }); };
  // run due timers in order (ties by creation), awaiting microtasks after each
  vt.advance = async function (ms) {
    const target = vt.t + ms;
    await settle();
    for (;;) {
      let best = null;
      for (const x of vt.timers) if (!best || x.at < best.at || (x.at === best.at && x.h < best.h)) best = x;
      if (!best || best.at > target) break;
      vt.timers = vt.timers.filter(function (x) { return x !== best; });
      if (best.at > vt.t) vt.t = best.at;
      best.fn();
      await settle();
    }
    vt.t = target;
    await settle();
  };
  return vt;
}

function makeRoom(opt) {
  opt = opt || {};
  const vt = makeClock();
  const room = {
    clock: vt, delay: opt.delay || 50, ACT_TRIES: opt.ACT_TRIES || 40, away: false,
    store: {}, guests: [], ownerSubs: [],
    stats: { resends: 0, gaveUp: 0, acts: 0 }, actLog: []
  };
  const coll = function (c) { return room.store[c] || (room.store[c] = {}); };
  const rowsOfMap = function (map) { return Object.keys(map).map(function (k) { return clone(map[k]); }); };

  function ownerNotify(c) {
    room.ownerSubs.forEach(function (s) {
      if (s.c !== c) return;
      const rows = rowsOfMap(coll(c));
      Promise.resolve().then(function () { s.cb(rows); });
    });
  }
  // a store change reaches each connected guest as a delta after a virtual delay
  function changed(c, id) {
    const rec = coll(c)[id] === undefined ? null : clone(coll(c)[id]);
    room.guests.forEach(function (g) {
      const items = {}; items[id] = rec;
      vt.setTimer(function () { g._delta(c, items); }, room.delay);
    });
    ownerNotify(c);
  }

  room.owner = function () {
    return {
      db: function (c) {
        return {
          put: function (row) { coll(c)[row.id] = clone(row); changed(c, row.id); return Promise.resolve({ id: row.id }); },
          delete: function (id) { delete coll(c)[id]; changed(c, id); return Promise.resolve({ id: id }); },
          subscribe: function (cb) { room.ownerSubs.push({ c: c, cb: cb }); const rows = rowsOfMap(coll(c)); Promise.resolve().then(function () { cb(rows); }); },
          settled: function () { return Promise.resolve(true); }
        };
      }
    };
  };

  room.guest = function (name) {
    const g = { name: name, mirror: {}, canon: {}, subs: [], pending: [], lastPut: {}, dropActs: 0, offline: false };
    const m = function (c) { return g.mirror[c] || (g.mirror[c] = {}); };
    const cn = function (c) { return g.canon[c] || (g.canon[c] = {}); };
    const canonJson = function (c, id) { const r = cn(c)[id]; return r === undefined ? undefined : JSON.stringify(r); };
    const notify = function (c) {
      g.subs.forEach(function (s) {
        if (c !== null && s.c !== c) return;
        const rows = rowsOfMap(m(s.c));
        Promise.resolve().then(function () { s.cb(rows); });
      });
    };
    const finish = function (a, ok) {
      g.pending = g.pending.filter(function (x) { return x !== a; });
      a.waiters.forEach(function (w) { w(ok); });
    };
    // done: canon shows what was wanted (absent for a delete), or canon moved off the base
    const isDone = function (a) {
      const cj = canonJson(a.c, a.id);
      return a.d === 'del' ? (cj === undefined || cj !== a.base) : (cj === a.want || cj !== a.base);
    };
    const sendAct = function (a) {
      if (a.dead) return;
      a.tries++; a.sentAt = vt.now(); room.stats.acts++;
      if (a.tries > 1) room.stats.resends++;
      if (g.offline) return;
      if (g.dropActs > 0) { g.dropActs--; return; }
      room.actLog.push({ name: name, c: a.c, id: a.id, bytes: (a.want || '').length });
      if (a.d === 'put') g.lastPut[a.c + '|' + a.id] = a.want;
      vt.setTimer(function () {   // owner: whole-record replace, newest arrival wins
        if (a.d === 'put') coll(a.c)[a.id] = JSON.parse(a.want); else delete coll(a.c)[a.id];
        changed(a.c, a.id);
      }, room.delay);
    };
    const act = function (c, id, d, want) {
      const a = { c: c, id: id, d: d, base: canonJson(c, id), want: want, tries: 0, sentAt: -1e9, waiters: [] };
      // like the real runtime: one pending act per (collection, id); the newest replaces the older,
      // and the older one's settled waiters resolve with the newer one's outcome
      g.pending.forEach(function (o) { if (o.c === c && o.id === id) { o.dead = true; a.waiters = a.waiters.concat(o.waiters); o.waiters = []; } });
      g.pending = g.pending.filter(function (o) { return !o.dead; });
      g.pending.push(a);
      vt.setTimer(function () { sendAct(a); }, room.delay);
    };
    g.db = function (c) {
      return {
        put: function (row) {
          if (room.away) return Promise.reject(new Error('the app is paused'));
          m(c)[row.id] = clone(row); notify(c);
          act(c, row.id, 'put', JSON.stringify(row));
          return Promise.resolve({ id: row.id });
        },
        delete: function (id) {
          if (room.away) return Promise.reject(new Error('the app is paused'));
          delete m(c)[id]; notify(c);
          act(c, id, 'del', null);
          return Promise.resolve({ id: id });
        },
        subscribe: function (cb) { g.subs.push({ c: c, cb: cb }); const rows = rowsOfMap(m(c)); Promise.resolve().then(function () { cb(rows); }); },
        settled: function (id) {
          let last = null;
          g.pending.forEach(function (a) { if (a.c === c && a.id === id) last = a; });
          if (!last) return Promise.resolve(true);
          return new Promise(function (res) { last.waiters.push(res); });
        }
      };
    };
    g._delta = function (c, items) {
      if (g.offline) return;
      Object.keys(items).forEach(function (id) {
        if (items[id] === null) { delete m(c)[id]; delete cn(c)[id]; }
        else { m(c)[id] = clone(items[id]); cn(c)[id] = clone(items[id]); }
      });
      notify(c);
    };
    // a snapshot REPLACES the mirror: optimistic writes the owner never got vanish
    g._snap = function (state) {
      if (g.offline) return;
      g.mirror = clone(state); g.canon = clone(state);
      notify(null);
    };
    g.reconnect = function () {
      g.offline = false;
      const st = clone(room.store);
      vt.setTimer(function () { g._snap(st); }, room.delay);
    };
    // platform sweep every 1500 ms: re-send an unconfirmed act after 3000 ms, give up after ACT_TRIES
    vt.setTimer(function loop() {
      g.pending.slice().forEach(function (a) {
        if (isDone(a)) finish(a, true);
        else if (a.tries > 0 && a.tries >= room.ACT_TRIES) { room.stats.gaveUp++; finish(a, false); }
        else if (a.tries > 0 && vt.now() - a.sentAt >= 3000) sendAct(a);
      });
      vt.setTimer(loop, 1500);
    }, 1500);
    room.guests.push(g);
    const st = clone(room.store);
    vt.setTimer(function () { g._snap(st); }, room.delay); // a late guest gets a snapshot on connect
    return g;
  };

  room.snap = function () {
    const st = clone(room.store);
    room.guests.forEach(function (g) { vt.setTimer(function () { g._snap(st); }, room.delay); });
  };
  // re-deliver the last put act a guest really sent for a row (a stale copy arriving late)
  room.replay = function (guestName, c, id) {
    const g = room.guests.filter(function (x) { return x.name === guestName; })[0];
    const want = g && g.lastPut[c + '|' + id];
    if (want === undefined) throw new Error('nothing to replay for ' + guestName + ' ' + c + '/' + id);
    vt.setTimer(function () { coll(c)[id] = JSON.parse(want); changed(c, id); }, room.delay);
  };
  room.setReadOnlyAway = function (v) { room.away = !!v; };
  room.saveStore = function () { return clone(room.store); };
  room.restartOwnerWithOldState = function (saved) {
    room.store = clone(saved);
    ownerNotify('ops'); ownerNotify('pres');
    Object.keys(room.store).forEach(ownerNotify);
    room.snap();
  };
  return room;
}

module.exports = { makeRoom: makeRoom, clone: clone, settle: settle };

// ---- self-test ---------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const names = [];
  const t = async function (name, fn) { await fn(); names.push(name); console.log('ok ' + name); };
  const rowsOf = function (g, c) { return Object.keys(g.mirror[c] || {}); };
  (async function () {
    await t('guest put reaches owner and another guest', async function () {
      const room = makeRoom(), own = room.owner(), a = room.guest('a'), b = room.guest('b');
      let ownerRows = [];
      own.db('x').subscribe(function (r) { ownerRows = r; });
      await room.clock.advance(300);
      await a.db('x').put({ id: 'r1', v: 1 });
      assert.deepStrictEqual(rowsOf(a, 'x'), ['r1'], 'optimistic at once');
      let ok = null; a.db('x').settled('r1').then(function (v) { ok = v; });
      await room.clock.advance(2000);
      assert.strictEqual(ok, true);
      assert.deepStrictEqual(ownerRows, [{ id: 'r1', v: 1 }]);
      assert.deepStrictEqual(rowsOf(b, 'x'), ['r1']);
      assert.deepStrictEqual(Object.keys(b.canon.x), ['r1']);
    });
    await t('a dropped act is retried by the room', async function () {
      const room = makeRoom(), a = room.guest('a'), b = room.guest('b');
      await room.clock.advance(300);
      a.dropActs = 1;
      await a.db('x').put({ id: 'r1', v: 1 });
      await room.clock.advance(500);
      assert.ok(!room.store.x, 'lost');
      let ok = null; a.db('x').settled('r1').then(function (v) { ok = v; });
      await room.clock.advance(6000);
      assert.ok(room.store.x && room.store.x.r1, 'owner has it');
      assert.deepStrictEqual(rowsOf(b, 'x'), ['r1']);
      assert.strictEqual(ok, true); assert.ok(room.stats.resends >= 1);
    });
    await t('ACT_TRIES=1: settled is false and a snapshot erases the row', async function () {
      const room = makeRoom({ ACT_TRIES: 1 }), a = room.guest('a');
      await room.clock.advance(300);
      a.dropActs = 1;
      await a.db('x').put({ id: 'r1', v: 1 });
      let ok = null; a.db('x').settled('r1').then(function (v) { ok = v; });
      await room.clock.advance(2000);
      assert.strictEqual(ok, false); assert.strictEqual(room.stats.gaveUp, 1);
      assert.deepStrictEqual(rowsOf(a, 'x'), ['r1'], 'still optimistic');
      room.snap(); await room.clock.advance(200);
      assert.deepStrictEqual(rowsOf(a, 'x'), [], 'snapshot erased it');
    });
    await t('away mode rejects guest puts; owner restart with old state', async function () {
      const room = makeRoom(), own = room.owner(), a = room.guest('a');
      await room.clock.advance(300);
      await own.db('x').put({ id: 'o1' });
      await room.clock.advance(200);
      const saved = room.saveStore();
      room.setReadOnlyAway(true);
      await assert.rejects(function () { return a.db('x').put({ id: 'r1' }); }, /paused/);
      room.setReadOnlyAway(false);
      await own.db('x').put({ id: 'o2' }); await room.clock.advance(200);
      assert.deepStrictEqual(rowsOf(a, 'x').sort(), ['o1', 'o2']);
      room.restartOwnerWithOldState(saved); await room.clock.advance(200);
      assert.deepStrictEqual(rowsOf(a, 'x'), ['o1']);
      const late = room.guest('late'); await room.clock.advance(200);
      assert.deepStrictEqual(rowsOf(late, 'x'), ['o1'], 'late guest gets a snapshot');
    });
    await t('a newer act on the same row replaces the pending one; replay re-delivers a stale put', async function () {
      const room = makeRoom(), a = room.guest('a');
      await room.clock.advance(300);
      let ok = null;
      await a.db('x').put({ id: 'r1', v: 1 });
      a.db('x').settled('r1').then(function (v) { ok = v; });
      await a.db('x').delete('r1');
      await room.clock.advance(6000);
      assert.strictEqual(ok, true, 'waiter of the replaced act resolved');
      assert.ok(!room.store.x || !room.store.x.r1);
      assert.strictEqual(room.actLog.filter(function (l) { return l.bytes > 0; }).length, 0, 'the put was never sent');
      await a.db('x').put({ id: 'r1', v: 2 }); await room.clock.advance(2000);
      await a.db('x').delete('r1'); await room.clock.advance(2000);
      assert.ok(!room.store.x.r1);
      room.replay('a', 'x', 'r1'); await room.clock.advance(500);
      assert.deepStrictEqual(room.store.x.r1, { id: 'r1', v: 2 }, 'stale put is back');
    });
    console.log('test-lib-room: ' + names.length + ' passed');
  })().catch(function (e) { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
}
