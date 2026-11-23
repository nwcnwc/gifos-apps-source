/*
 * Tanks — netplay. Upstream's room IS a Node process with sockets.
 * That process stays behind. Each player owns exactly one row.
 * The shooter claims a hit; the target applies it to itself.
 * Who is here is gifos.people(). Publish only when pose/claims change
 * — no idle keep-alive (kit K3).
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Tanks needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var HIT_RING = 8;
  var SHOT_RING = 6;

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
  var onHit = null;
  var onKill = null;
  var onRoster = null;
  var onShot = null;
  var lastPublished = 0;
  var lastPubSig = '';
  var self = { lives: 3, k: 0, d: 0, alive: true, spawn: 0, lastKilledBy: null, killAck: {}, x: 0, y: 0, rot: 0, tur: 0 };
  var started = false;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function tintFor(id) {
    var h = 0, i;
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360) / 360;
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
    var t = now(), seen = {}, names = peopleNames(), i, p, cur, id;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id) continue;
      if (p.id === me.id) { if (p.k > self.k) self.k = p.k; continue; }
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      drainClaims(p);
      drainShots(p);
      cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Player',
        x: p.x, y: p.y, rot: p.rot || 0, tur: p.tur || 0,
        alive: p.alive !== false,
        lives: p.lives == null ? 3 : p.lives,
        k: p.k || 0, d: p.d || 0, spawn: p.sp || 0,
        stamp: p.t, t: t, hue: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, rot: cur.rot, tur: cur.tur, t: cur.t } : null
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
    for (id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function drainClaims(p) {
    if (!onHit) return;
    var i, h, key;
    var hits = p.hits || [];
    var live = {};
    for (i = 0; i < hits.length; i++) {
      h = hits[i];
      if (!h) continue;
      key = p.id + ':' + h.n;
      live[key] = 1;
      if (h.to !== me.id) continue;
      if (appliedClaims[key]) continue;
      appliedClaims[key] = 1;
      if (h.sp != null && h.sp !== self.spawn) continue;
      if (!self.alive) continue;
      onHit(h.d || 1, p.id, p.name || 'Player');
    }
    for (key in appliedClaims) {
      if (key.lastIndexOf(p.id + ':', 0) === 0 && !live[key]) delete appliedClaims[key];
    }
  }

  function drainShots(p) {
    if (!p.shots || !p.shots.length || !onShot) return;
    var i, s, key;
    for (i = 0; i < p.shots.length; i++) {
      s = p.shots[i];
      if (!s) continue;
      key = p.id + ':' + s.n;
      if (seenShots[key]) continue;
      seenShots[key] = now();
      onShot({ x: s.x, y: s.y, a: s.a, by: p.id });
    }
    var live = {};
    for (i = 0; i < p.shots.length; i++) {
      if (p.shots[i]) live[p.id + ':' + p.shots[i].n] = 1;
    }
    for (key in seenShots) {
      if (key.lastIndexOf(p.id + ':', 0) === 0 && !live[key]) delete seenShots[key];
    }
  }

  function claimHit(toId, dmg) {
    seq++;
    pendingHits.push({ n: seq, to: toId, d: dmg || 1, sp: (others[toId] && others[toId].spawn) || 0 });
    if (pendingHits.length > HIT_RING) pendingHits.shift();
    publish(true);
  }

  function claimShot(x, y, a) {
    shotSeq++;
    pendingShots.push({ n: shotSeq, x: r2(x), y: r2(y), a: r2(a) });
    if (pendingShots.length > SHOT_RING) pendingShots.shift();
    publish(true);
  }

  function tookHit(dmg, byId, byName) {
    if (!self.alive) return;
    self.lives -= dmg;
    if (self.lives <= 0) {
      self.lives = 0;
      self.alive = false;
      self.d++;
      self.lastKilledBy = { by: byId, at: now() };
    }
    publish(true);
  }

  function respawn(x, y) {
    self.alive = true;
    self.lives = 3;
    self.spawn++;
    self.lastKilledBy = null;
    publish(true);
  }

  function publish(force) {
    if (!started || !api || !me.id || !PEOPLE) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var row = {
      id: me.id,
      x: r2(self.x), y: r2(self.y), rot: r2(self.rot), tur: r2(self.tur),
      alive: self.alive, lives: self.lives, k: self.k, d: self.d,
      sp: self.spawn,
      hits: pendingHits.slice(), shots: pendingShots.slice(),
      lastKilledBy: self.lastKilledBy
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function tick(x, y, rot, tur) {
    var moved = !started || self.x !== x || self.y !== y || self.rot !== rot || self.tur !== tur;
    self.x = x; self.y = y; self.rot = rot; self.tur = tur;
    started = true;
    if (moved) publish(false);
  }

  function interpolate(p, t) {
    if (!p.prev) return p;
    var dt = Math.max(16, (p.t || t) - (p.prev.t || t));
    var u = Math.min(1, (t - (p.stamp || p.t || t)) / dt);
    return {
      x: p.prev.x + (p.x - p.prev.x) * u,
      y: p.prev.y + (p.y - p.prev.y) * u,
      rot: p.prev.rot + (p.rot - p.prev.rot) * u,
      tur: p.prev.tur + (p.tur - p.prev.tur) * u
    };
  }

  function roster() {
    var out = [{ id: me.id, name: me.name, k: self.k, d: self.d, lives: self.lives, alive: self.alive, me: true }];
    var id, names = peopleNames();
    for (id in others) {
      out.push({ id: id, name: names[id] || others[id].name, k: others[id].k, d: others[id].d, lives: others[id].lives, alive: others[id].alive, me: false });
    }
    return out;
  }

  function otherCount() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  root.TanksNet = {
    init: init,
    tick: tick,
    claimHit: claimHit,
    claimShot: claimShot,
    tookHit: tookHit,
    respawn: respawn,
    interpolate: interpolate,
    others: function () { return others; },
    me: function () { return me; },
    self: function () { return self; },
    roster: roster,
    otherCount: otherCount,
    onHit: function (fn) { onHit = fn; },
    onKill: function (fn) { onKill = fn; },
    onRoster: function (fn) { onRoster = fn; },
    onShot: function (fn) { onShot = fn; }
  };

  root['__tanks'] = {
    state: function () {
      // Deathmatch has no shared world row; copies agree on null.
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
    _n.id = 'tanks-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
