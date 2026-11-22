/*
 * TOSIOS — netplay transport.
 *
 * Upstream's room IS a Colyseus GameRoom on a Node server (packages/server).
 * That server, the Docker image, and every socket path stay behind. The room
 * here is a GifOS meeting; the only channel an app has is the replicated
 * collection — gifos.db('players').subscribe(...) — hosted by the host's
 * browser. Two properties shape every decision below:
 *
 *   1. A subscriber re-downloads the WHOLE collection on every change, so
 *      traffic is O(players²). The answer is a LOW publish rate with client-side
 *      interpolation, not a high one, and rows kept mean (coordinates rounded).
 *   2. There is no datagram path and no server tick. So this cannot be, and does
 *      not pretend to be, competitive-grade netcode.
 *
 * NOBODY WRITES TO ANYBODY ELSE'S ROW. Each player owns exactly one record and
 * only ever reads the others — fps-simple's rule (and anyroad's before it).
 * That decides how damage flows:
 *
 *   - The SHOOTER decides what it hit, locally, against the bodies it can see.
 *     Claims ride on the shooter's own row as a short ring of recent shots.
 *   - The TARGET decides what that costs it. It applies the wound to itself,
 *     decides its own death, and publishes its own lives. A client that ignored
 *     incoming hits would be cheating, and it would be cheating in a game you
 *     reach by sending someone a link — the threat model is friends, so the
 *     honest design is the simple one, said plainly in the README.
 *
 * A claim is deduped on (shooter id, sequence), because a row is re-delivered
 * on every unrelated change and a hit must land exactly once.
 *
 * Who is here is gifos.people(). Publish only when pose/claims change.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 6;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'TOSIOS needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var HIT_RING = 8;
  var SHOT_RING = 6;
  var CLAIM_TTL = 12000;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var seq = 0;
  var shotSeq = 0;
  var pendingHits = [];
  var pendingShots = [];
  var appliedClaims = {};
  var seenShots = {};
  var appliedTotal = 0;
  var onHit = null;
  var onKill = null;
  var onRoster = null;
  var onShot = null;
  var onTook = null;
  var lastPublished = 0;
  var lastPubSig = '';
  var self = { lives: 3, k: 0, d: 0, alive: true, spawn: 0, lastKilledBy: null, killAck: {}, took: [] };
  var started = false;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function tintFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360) / 360;
  }

  var r2 = function (n) { return Math.round(n * 100) / 100; };

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
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
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Player'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve(null);
    if (!PEOPLE) return Promise.resolve(null);
    return readRoom().then(function () {
      if (!me.id) return null;
      var settled = false;
      return new Promise(function (resolve) {
        var done = function (list) { if (!settled) { settled = true; resolve(list || []); } };
        setTimeout(function () { done([]); }, 2500);
        db('players').subscribe(function (list) {
          ingest(list || []);
          done(list || []);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () { return null; });
  }

  function ingest(list) {
    var t = now(), seen = {}, allTook = {}, names = peopleNames();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.id) continue;
      if (p.took && p.took.length) {
        for (var f = 0; f < p.took.length; f++) allTook[p.took[f]] = 1;
      }
      if (p.id === me.id) { reconcileSelf(p); continue; }
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      drainClaims(p);
      drainShots(p);
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Player',
        x: p.x, y: p.y, rot: p.rot || 0,
        mv: p.mv || 0, alive: p.alive !== false,
        lives: p.lives == null ? 3 : p.lives,
        k: p.k || 0, d: p.d || 0, spawn: p.sp || 0,
        stamp: p.t, t: t, hue: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, rot: cur.rot, t: cur.t } : null,
      };
      if (p.lastKilledBy && p.lastKilledBy.by === me.id) {
        var ak = p.id + ':' + p.lastKilledBy.at;
        if (!self.killAck[ak]) {
          self.killAck[ak] = 1; self.k++;
          if (onKill) onKill(p.name || 'Player');
          publish(true);
        }
      }
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onTook) onTook(allTook);
    if (onRoster) onRoster(roster());
  }

  function reconcileSelf(p) {
    if (p && p.k > self.k) self.k = p.k;
  }

  function drainClaims(p) {
    if (!p.hits || !p.hits.length || !onHit) return;
    for (var i = 0; i < p.hits.length; i++) {
      var h = p.hits[i];
      if (!h || h.to !== me.id) continue;
      var key = p.id + ':' + h.n;
      if (appliedClaims[key]) continue;
      appliedClaims[key] = now();
      appliedTotal++;
      if (h.sp != null && h.sp !== self.spawn) continue;
      if (!self.alive) continue;
      onHit(h.d || 1, p.id, p.name || 'Player');
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in appliedClaims) if (appliedClaims[k] < cutoff) delete appliedClaims[k];
  }

  function drainShots(p) {
    if (!p.shots || !p.shots.length || !onShot) return;
    for (var i = 0; i < p.shots.length; i++) {
      var s = p.shots[i];
      if (!s) continue;
      var key = p.id + ':s' + s.n;
      if (seenShots[key]) continue;
      seenShots[key] = now();
      onShot(p.id, s.x, s.y, s.a, tintFor(p.id));
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in seenShots) if (seenShots[k] < cutoff) delete seenShots[k];
  }

  function claimHit(targetId, targetSpawn) {
    if (!api || !me.id || !PEOPLE) return;
    pendingHits.push({ to: targetId, d: 1, n: ++seq, sp: targetSpawn });
    if (pendingHits.length > HIT_RING) pendingHits.shift();
    publish(true);
  }

  function noteShot(x, y, a) {
    if (!PEOPLE) return;
    pendingShots.push({ x: r2(x), y: r2(y), a: r2(a), n: ++shotSeq });
    if (pendingShots.length > SHOT_RING) pendingShots.shift();
    publish(true);
  }

  function setSelf(s) {
    self.lives = s.lives; self.alive = s.alive; self.spawn = s.spawn;
    if (s.deaths != null) self.d = s.deaths;
    if (s.took) self.took = s.took;
    if (s.killedBy) self.lastKilledBy = { by: s.killedBy, at: s.spawn };
  }

  function publish(force) {
    if (!api || !me.id || !PEOPLE || !root.__TOSIOS_POSE__) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var p = root.__TOSIOS_POSE__();
    if (!p) return;
    var row = {
      id: me.id, name: me.name,
      x: r2(p.x), y: r2(p.y), rot: r2(p.rot),
      mv: r2(p.speed || 0),
      lives: self.lives | 0, alive: !!self.alive, sp: self.spawn,
      k: self.k, d: self.d,
      lastKilledBy: self.lastKilledBy,
      hits: pendingHits.slice(),
      shots: pendingShots.slice(),
      took: self.took.slice()
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () { /* a dropped frame of presence is not an error */ });
    started = true;
  }

  function tick() {
    if (!api || !me.id || !PEOPLE) return;
    publish(false);
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, rot: o.rot, mv: o.mv };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var dr = ((o.rot - o.prev.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      x: o.prev.x + (o.x - o.prev.x) * a,
      y: o.prev.y + (o.y - o.prev.y) * a,
      rot: o.prev.rot + dr * a,
      mv: o.mv,
    };
  }

  function roster() {
    var names = peopleNames();
    var list = [{ id: me.id, name: me.name, k: self.k, d: self.d, lives: self.lives, alive: self.alive, me: true }];
    for (var id in others) {
      list.push({
        id: id, name: names[id] || others[id].name, k: others[id].k, d: others[id].d,
        lives: others[id].lives, alive: others[id].alive, me: false,
      });
    }
    list.sort(function (a, b) { return (b.k - a.k) || (a.d - b.d) || a.name.localeCompare(b.name); });
    return list;
  }

  function hsv(h) {
    var i6 = Math.floor(h * 6), f = h * 6 - i6, s = 0.55, v = 0.92;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i6 % 6];
    return 'rgb(' + ((m[0] * 255) | 0) + ',' + ((m[1] * 255) | 0) + ',' + ((m[2] * 255) | 0) + ')';
  }

  function countOthers() {
    var n = 0;
    for (var k in others) n++;
    return n;
  }

  root.Net = {
    init: init,
    tick: tick,
    publish: publish,
    setSelf: setSelf,
    claimHit: claimHit,
    noteShot: noteShot,
    poseOf: poseOf,
    roster: roster,
    others: function () { return others; },
    me: function () { return me; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    live: function () { return PEOPLE && !!me.id; },
    tintFor: tintFor,
    hsv: hsv,
    appliedTotal: function () { return appliedTotal; },
    onHit: function (fn) { onHit = fn; },
    onKill: function (fn) { onKill = fn; },
    onRoster: function (fn) { onRoster = fn; },
    onShot: function (fn) { onShot = fn; },
    onTook: function (fn) { onTook = fn; },
  };

  root['__tosios'] = {
    state: function () { return null; },
    people: function () {
      var names = peopleNames(), out = [], id;
      if (me.id && names[me.id]) out.push(me.id);
      for (id in others) if (names[id]) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'tosios-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
