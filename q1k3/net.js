/*
 * Q1K3 — extra bodies over a meeting.
 *
 * Upstream has no networking. The only channel GifOS gives an app is a
 * replicated collection. Two rules shape this:
 *
 *   1. A subscriber re-downloads the WHOLE collection on every change, so
 *      publish is slow (6 Hz) with interpolation, not a datagram stream.
 *   2. NOBODY WRITES TO ANYBODY ELSE'S ROW. Each player owns one record in
 *      `players`. Hits ride on the shooter's row; the target applies them.
 *
 * Who is here is gifos.people(). This is extra bodies in the same halls,
 * not competitive netcode. Publish only when the pose changes — no idle
 * keep-alive (kit K3).
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 6;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Q1K3 needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var HIT_RING = 24;
  var CLAIM_TTL = 12000;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var seq = 0;
  var pendingHits = [];
  var appliedClaims = {};
  var lastPublished = 0;
  var lastPubSig = '';
  var onHit = null;
  var onKill = null;
  var onRoster = null;
  var self = { hp: 100, k: 0, d: 0, alive: true, spawn: 0, lastKilledBy: null, killAck: {} };

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }

  function tintFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 3;
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') n++;
    }
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
        if (onRoster) onRoster(roster());
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
    var t = now(), seen = {}, names = peopleNames();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.id) continue;
      if (p.id === me.id) {
        if (p.k > self.k) self.k = p.k;
        continue;
      }
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      drainClaims(p);
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Player',
        x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: p.pitch || 0,
        mv: !!p.mv, alive: p.alive !== false, hp: p.hp == null ? 100 : p.hp,
        k: p.k || 0, d: p.d || 0, spawn: p.sp || 0,
        stamp: p.t, t: t, kind: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, z: cur.z, yaw: cur.yaw, t: cur.t } : null
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
    if (onRoster) onRoster(roster());
  }

  function drainClaims(p) {
    if (!p.hits || !p.hits.length || !onHit) return;
    for (var i = 0; i < p.hits.length; i++) {
      var h = p.hits[i];
      if (!h || h.to !== me.id) continue;
      var key = p.id + ':' + h.n;
      if (appliedClaims[key]) continue;
      appliedClaims[key] = now();
      if (h.sp != null && h.sp !== self.spawn) continue;
      if (!self.alive) continue;
      onHit(h.d || 0, p.id, p.name || 'Player');
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in appliedClaims) if (appliedClaims[k] < cutoff) delete appliedClaims[k];
  }

  function claimHit(targetId, dmg, targetSpawn) {
    if (!api || !me.id || !PEOPLE) return;
    pendingHits.push({ to: targetId, d: Math.round(dmg), n: ++seq, sp: targetSpawn });
    if (pendingHits.length > HIT_RING) pendingHits.shift();
    publish(true);
  }

  function setSelf(s) {
    if (s.hp != null) self.hp = s.hp;
    if (s.alive != null) self.alive = s.alive;
    if (s.spawn != null) self.spawn = s.spawn;
    if (s.deaths != null) self.d = s.deaths;
    if (s.killedBy) self.lastKilledBy = { by: s.killedBy, at: s.spawn };
  }

  function pose() {
    var p = typeof game_entity_player !== 'undefined' ? game_entity_player : null;
    if (!p) return null;
    return {
      x: p.p.x, y: p.p.y, z: p.p.z,
      yaw: p._yaw, pitch: p._pitch,
      mv: !!(p.a && (p.a.x || p.a.z)),
      hp: p._health, alive: !p._dead
    };
  }

  function publish(force) {
    if (!api || !me.id || !PEOPLE) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var po = pose();
    if (!po) return;
    var row = {
      id: me.id,
      x: r1(po.x), y: r1(po.y), z: r1(po.z),
      yaw: r2(po.yaw), pitch: r2(po.pitch),
      mv: po.mv ? 1 : 0,
      alive: po.alive, hp: Math.round(po.hp),
      k: self.k, d: self.d, sp: self.spawn,
      lastKilledBy: self.lastKilledBy,
      hits: pendingHits.slice()
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, z: o.z, yaw: o.yaw };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var dyaw = ((o.yaw - o.prev.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      x: o.prev.x + (o.x - o.prev.x) * a,
      y: o.prev.y + (o.y - o.prev.y) * a,
      z: o.prev.z + (o.z - o.prev.z) * a,
      yaw: o.prev.yaw + dyaw * a
    };
  }

  function tick() {
    if (!api || !me.id || !PEOPLE) return;
    var p = typeof game_entity_player !== 'undefined' ? game_entity_player : null;
    if (p) {
      self.hp = p._health;
      self.alive = !p._dead;
    }
    // Write only while moving (or force via claim) — no idle keep-alive.
    var po = pose();
    if (po && po.mv) publish(false);
  }

  function roster() {
    var p = typeof game_entity_player !== 'undefined' ? game_entity_player : null;
    var names = peopleNames();
    var list = [{
      id: me.id, name: me.name, me: true,
      k: self.k, d: self.d,
      alive: p ? !p._dead : self.alive
    }];
    for (var id in others) {
      var o = others[id];
      list.push({ id: o.id, name: names[o.id] || o.name, me: false, k: o.k, d: o.d, alive: o.alive });
    }
    list.sort(function (a, b) { return (b.k - a.k) || a.name.localeCompare(b.name); });
    return list;
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
    poseOf: poseOf,
    roster: roster,
    others: function () { return others; },
    me: function () { return me; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    live: function () { return PEOPLE && !!me.id; },
    onHit: function (fn) { onHit = fn; },
    onKill: function (fn) { onKill = fn; },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__q1k3'] = {
    state: function () {
      // No shared world doc — pose rows are each player's own.
      return null;
    },
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
    _n.id = 'q1k3-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
