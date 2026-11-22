/*
 * Racer — netplay.
 *
 * There is no game server. Each player owns exactly one row in `players` and
 * only ever writes that row — position, speed, lap, finish time. The app
 * owner writes the `race` record (read-only for guests) to start a countdown.
 * The board is assembled by READING everyone else's row, never by writing it.
 * Who is here is gifos.people().
 *
 * A subscriber re-downloads the whole collection on every change, so publish
 * is 6 Hz with interpolation, not a high tick. Comfortable for a handful of
 * friends on a link; not a claim about competitive netcode.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 6;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Racer needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var COUNTDOWN_MS = 3000;

  var api = null;
  var me = { id: null, name: 'Driver' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var raceRec = null;
  var myFinish = null;
  var myRaceAt = 0;
  var acc = 0;
  var lastPubSig = '';
  var onRace = null;
  var onRoster = null;
  var isHost = false;
  var started = false;

  function db(n) {
    try { return api && api.db ? api.db(n) : null; } catch (e) { return null; }
  }

  function tintFor(id) {
    var h = 0;
    id = String(id || '');
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360) / 360;
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Driver';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function readRoom() {
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      roomPeople = ppl;
      isHost = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Driver'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onRoster) onRoster(roster());
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) {
      isHost = true;
      return Promise.resolve({ host: true, others: 0 });
    }
    if (!PEOPLE) {
      isHost = true;
      return Promise.resolve({ host: true, others: 0 });
    }
    return readRoom().then(function () {
      if (!me.id) return { host: isHost, others: 0 };
      var p = db('players');
      var r = db('race');
      if (p) p.subscribe(function (list) { ingestPlayers(list || []); });
      if (r) r.subscribe(function (list) { ingestRace(list || []); });
      setInterval(readRoom, PEOPLE_MS);
      return { host: isHost, others: Math.max(0, peopleCount() - 1) };
    }).catch(function () {
      isHost = true;
      return { host: true, others: 0 };
    });
  }

  function ingestPlayers(list) {
    var names = peopleNames(), seen = {}, i, p, cur;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Driver',
        x: p.x, z: p.z, spd: p.spd || 0,
        lap: p.lap || 0, fin: p.fin || 0, raceAt: p.raceAt || 0,
        stamp: p.t, t: Date.now(), hue: tintFor(p.id),
        prev: cur ? { x: cur.x, z: cur.z, spd: cur.spd, t: cur.t } : null
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function ingestRace(list) {
    var rec = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'race') rec = list[i];
    }
    var prev = raceRec && raceRec.startedAt;
    raceRec = rec;
    if (raceRec && raceRec.startedAt !== prev) {
      myFinish = null;
      myRaceAt = raceRec.startedAt;
    }
    if (onRace) onRace(raceState());
  }

  function publish(st, force) {
    var p = db('players');
    if (!p || !me.id || !PEOPLE) return;
    var now = Date.now();
    if (!force) {
      acc += st && st.dt ? st.dt : 0;
      if (acc < 1 / PUBLISH_HZ) return;
      acc = 0;
    }
    var row = {
      id: me.id,
      x: r2(st.x),
      z: Math.round(st.z),
      spd: Math.round(st.speed),
      lap: st.lap || 0,
      fin: myFinish || 0,
      raceAt: myRaceAt || 0
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    row.t = now;
    p.put(row).catch(function () {});
  }

  function ghosts() {
    if (!root.Racer) return [];
    var now = Date.now(), out = [], tl = (root.Racer.state().trackLength) || 1;
    for (var id in others) {
      var o = others[id];
      var x = o.x, z = o.z, spd = o.spd;
      if (o.prev) {
        var span = Math.max(1, o.t - o.prev.t);
        var k = Math.min(1.4, (now - o.t) / span);
        x = o.x + (o.x - o.prev.x) * k;
        var dz = o.z - o.prev.z;
        if (dz >  tl / 2) dz -= tl;
        if (dz < -tl / 2) dz += tl;
        z = o.z + dz * k;
        if (z < 0) z += tl;
        if (z >= tl) z -= tl;
        spd = o.spd + (o.spd - o.prev.spd) * k;
      }
      out.push({
        id: o.id,
        name: o.name,
        offset: x,
        z: z,
        speed: spd,
        sprite: root.Racer.spriteFor(o.id)
      });
    }
    return out;
  }

  function count() {
    return peopleCount() || (me.id ? 1 : 0);
  }

  function roster() {
    var names = peopleNames();
    var list = [{
      id: me.id, name: me.name, mine: true,
      fin: myFinish || 0, lap: 0, raceAt: myRaceAt
    }];
    var st = root.Racer ? root.Racer.state() : null;
    if (st) list[0].lap = st.lap;
    for (var id in others) {
      var o = others[id];
      list.push({ id: o.id, name: names[o.id] || o.name, mine: false, fin: o.fin || 0, lap: o.lap || 0, raceAt: o.raceAt || 0 });
    }
    return list;
  }

  function startRace() {
    if (!isHost) return Promise.resolve(false);
    var r = db('race');
    var startedAt = Date.now() + COUNTDOWN_MS;
    myFinish = null;
    myRaceAt = startedAt;
    var rec = { id: 'race', startedAt: startedAt, by: me.name, byId: me.id, nLaps: 1 };
    if (!r || !PEOPLE) {
      raceRec = rec;
      if (onRace) onRace(raceState());
      return Promise.resolve(true);
    }
    return r.put(rec).then(function () { return true; })
      .catch(function () { return false; });
  }

  function markFinished(ms) {
    if (myFinish) return;
    myFinish = Math.round(ms);
    var st = root.Racer ? root.Racer.state() : { x: 0, z: 0, speed: 0, lap: 1 };
    st.dt = 1;
    publish(st, true);
    if (onRoster) onRoster(roster());
  }

  function raceState() {
    if (!raceRec || !raceRec.startedAt) return null;
    var now = Date.now();
    var countdown = Math.max(0, raceRec.startedAt - now);
    var elapsed = Math.max(0, now - raceRec.startedAt);
    var board = [];
    var people = roster();
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (p.raceAt === raceRec.startedAt && p.fin) board.push({ name: p.name, ms: p.fin, mine: p.mine, id: p.id });
    }
    board.sort(function (a, b) { return a.ms - b.ms; });
    return {
      startedAt: raceRec.startedAt,
      countdown: countdown,
      elapsed: elapsed,
      running: countdown === 0,
      nLaps: raceRec.nLaps || 1,
      by: raceRec.by,
      mine: myFinish,
      board: board
    };
  }

  root.Net = {
    init: init,
    publish: publish,
    ghosts: ghosts,
    count: count,
    roster: roster,
    startRace: startRace,
    markFinished: markFinished,
    raceState: raceState,
    isHost: function () { return isHost; },
    me: function () { return me; },
    onRace: function (cb) { onRace = cb; },
    onRoster: function (cb) { onRoster = cb; }
  };

  root['__racer'] = {
    state: function () {
      if (!raceRec) return PEOPLE && me.id ? { startedAt: 0 } : null;
      return { startedAt: raceRec.startedAt | 0, nLaps: raceRec.nLaps | 0 };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && isHost && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'racer-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
