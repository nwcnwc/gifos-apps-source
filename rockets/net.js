/*
 * Rockets — netplay transport.
 *
 * Upstream's sky IS a Node process (engine.js + server.js) broadcasting
 * every body at 33 Hz over socket.io. That server stays behind. The only
 * channel here is two replicated collections:
 *
 *   players  read-write  — each rocket writes ONLY its own row (pose, score,
 *                          a short ring of star claims). Nobody else's.
 *   sky      read-only   — the app owner alone writes the starfield (seed, stars,
 *                          round clock, bump resolutions, awards).
 *
 * Who is here is gifos.people(). A subscriber re-downloads the whole collection
 * on every change, so publish is slow (8 Hz) with interpolation, only on change.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;
  var SKY_HZ = 8;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Rockets needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var CLAIM_RING = 8;
  var AWARD_RING = 12;
  var BUMP_RING = 8;
  var CLAIM_TTL = 14000;

  var api = null;
  var me = { id: null, name: 'Rocket' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var sky = null;
  var seq = 0;
  var claims = [];
  var lastPublished = 0;
  var lastPubSig = '';
  var lastSky = 0;
  var lastSkySig = '';
  var onRoster = null;
  var onSky = null;
  var onAward = null;
  var onBump = null;
  var appliedAwards = {};
  var appliedBumps = {};
  var selfScore = 0;
  var selfRound = 1;
  var skySeq = 0;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }

  function tintFor(id) { return root.Rockets ? root.Rockets.hueFor(id) : 0.08; }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Rocket';
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'Rocket'; }
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
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });
    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2500);
        db('players').subscribe(function (list) {
          ingestPlayers(list || []);
          done();
        });
        db('sky').subscribe(function (list) {
          ingestSky(list || []);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function ingestPlayers(list) {
    var t = now(), seen = {}, pending = [], names = peopleNames();
    var i, p, id, cur;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id) continue;
      if (p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      if (owner && p.claims && p.claims.length) {
        for (var c = 0; c < p.claims.length; c++) {
          if (p.claims[c] && p.claims[c].s != null) {
            pending.push({ playerId: p.id, starId: p.claims[c].s, t: p.claims[c].t || t, n: p.claims[c].n });
          }
        }
      }
      cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Rocket',
        x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0,
        angle: p.a == null ? 0 : p.a,
        score: p.score || 0, thrusting: !!p.th,
        stamp: p.t, t: t,
        hue: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, angle: cur.angle, t: cur.t } : null
      };
    }
    for (id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (owner && pending.length) honorClaims(pending);
    if (onRoster) onRoster(roster());
  }

  var honored = {};
  function honorClaims(pending) {
    var R = root.Rockets;
    if (!R || !sky || !owner) return;
    var fresh = [], i, key;
    for (i = 0; i < pending.length; i++) {
      key = pending[i].playerId + ':' + pending[i].starId + ':' + (pending[i].n || 0);
      if (honored[key]) continue;
      honored[key] = now();
      fresh.push(pending[i]);
    }
    if (!fresh.length) return;
    var out = R.applyClaims(sky, fresh);
    var pid, pts, j, starId;
    for (pid in out.awarded) {
      pts = out.awarded[pid];
      if (!pts) continue;
      starId = null;
      for (j = 0; j < fresh.length; j++) {
        if (fresh[j].playerId === pid) { starId = fresh[j].starId; break; }
      }
      pushAward(pid, starId, pts);
    }
    R.pruneTaken(sky);
    R.refillStars(sky, true);
    publishSky(true);
    var cutoff = now() - CLAIM_TTL;
    for (key in honored) if (honored[key] < cutoff) delete honored[key];
  }

  function pushAward(pid, starId, pts) {
    if (!sky) return;
    if (!sky.awards) sky.awards = [];
    sky.awards.push({ p: pid, s: starId, pts: pts, n: (sky.seq || 0) + sky.awards.length });
    if (sky.awards.length > AWARD_RING) sky.awards.shift();
    if (pid === me.id && onAward) onAward(pts, starId);
  }

  function ingestSky(list) {
    var rec = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'sky') rec = list[i];
    }
    if (!rec) return;
    sky = rec;
    skySeq = rec.seq | 0;
    drainAwards(rec);
    drainBumps(rec);
    if (onSky) onSky(rec);
  }

  function drainAwards(rec) {
    if (!rec.awards || !onAward) return;
    var i, a, key;
    for (i = 0; i < rec.awards.length; i++) {
      a = rec.awards[i];
      if (!a || a.p !== me.id) continue;
      key = 'a:' + a.s + ':' + a.n;
      if (appliedAwards[key]) continue;
      appliedAwards[key] = 1;
      if (owner) continue;
      onAward(a.pts || 1, a.s);
    }
  }

  function drainBumps(rec) {
    if (!rec.bumps || !onBump) return;
    var i, b, key;
    for (i = 0; i < rec.bumps.length; i++) {
      b = rec.bumps[i];
      if (!b || b.id !== me.id) continue;
      key = 'b:' + b.n;
      if (appliedBumps[key]) continue;
      appliedBumps[key] = 1;
      onBump(b);
    }
  }

  function claimStar(starId) {
    if (!me.id || !PEOPLE) return;
    claims.push({ s: starId, n: ++seq, t: now() });
    if (claims.length > CLAIM_RING) claims.shift();
    if (owner && sky) {
      honorClaims([{ playerId: me.id, starId: starId, t: now(), n: seq }]);
    }
    publish(true);
  }

  function setScore(n) { selfScore = n | 0; }
  function setRound(n) { selfRound = n | 0; }

  function publish(force) {
    if (!api || !me.id || !PEOPLE || !root.__ROCKETS_POSE__) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var p = root.__ROCKETS_POSE__();
    if (!p) return;
    var row = {
      id: me.id, name: me.name,
      x: r1(p.x), y: r1(p.y),
      vx: r2(p.vx || 0), vy: r2(p.vy || 0),
      a: r2(p.angle || 0),
      score: selfScore | 0,
      th: !!p.thrusting,
      round: selfRound,
      claims: claims.slice()
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function publishSky(force) {
    if (!api || !me.id || !owner || !sky || !PEOPLE) return;
    var t = now();
    if (!force && t - lastSky < 1000 / SKY_HZ) return;
    var slim = [];
    var i, s;
    if (sky.stars) {
      for (i = 0; i < sky.stars.length; i++) {
        s = sky.stars[i];
        slim.push({ id: s.id, x: r1(s.x), y: r1(s.y), k: s.k | 0, by: s.by || null });
      }
    }
    var snap = {
      id: 'sky',
      by: me.id,
      seed: sky.seed,
      seq: sky.seq,
      stars: slim,
      round: sky.round,
      startedAt: sky.startedAt,
      endsAt: sky.endsAt,
      phase: sky.phase,
      bump: sky.bump !== false,
      awards: (sky.awards || []).slice(-AWARD_RING),
      bumps: (sky.bumps || []).slice(-BUMP_RING),
      bumpN: sky.bumpN || 0,
      overAt: sky.overAt || 0
    };
    var sig = JSON.stringify(snap);
    if (!force && sig === lastSkySig) return;
    lastSkySig = sig;
    lastSky = t;
    skySeq = (sky.seq | 0);
    snap.t = t;
    db('sky').put(snap).catch(function () {});
  }

  function noteBumps(events) {
    if (!owner || !sky || !events || !events.length || !PEOPLE) return;
    if (!sky.bumps) sky.bumps = [];
    var i, e;
    for (i = 0; i < events.length; i++) {
      e = events[i];
      sky.bumpN = (sky.bumpN || 0) + 1;
      sky.bumps.push({ n: sky.bumpN, id: e.a, x: r1(e.ax), y: r1(e.ay), vx: r2(e.avx), vy: r2(e.avy) });
      sky.bumpN += 1;
      sky.bumps.push({ n: sky.bumpN, id: e.b, x: r1(e.bx), y: r1(e.by), vx: r2(e.bvx), vy: r2(e.bvy) });
    }
    if (sky.bumps.length > BUMP_RING) sky.bumps = sky.bumps.slice(-BUMP_RING);
    publishSky(true);
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, angle: o.angle };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var dx = o.x - o.prev.x, dy = o.y - o.prev.y;
    var da = ((o.angle - o.prev.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      x: o.prev.x + dx * a,
      y: o.prev.y + dy * a,
      angle: o.prev.angle + da * a
    };
  }

  function roster() {
    var names = peopleNames();
    var list = [{ id: me.id, name: me.name, score: selfScore, me: true, hue: tintFor(me.id || 'local') }];
    var id;
    for (id in others) {
      list.push({
        id: id, name: names[id] || others[id].name, score: others[id].score,
        me: false, hue: others[id].hue
      });
    }
    list.sort(function (a, b) { return (b.score - a.score) || a.name.localeCompare(b.name); });
    return list;
  }

  function countOthers() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  function tick() {
    if (!api || !me.id || !PEOPLE) return;
    publish(false);
    if (owner) publishSky(false);
  }

  function adoptSky(s) { sky = s; }
  function skyNow() { return sky; }

  root.Net = {
    init: init,
    tick: tick,
    publish: publish,
    publishSky: publishSky,
    claimStar: claimStar,
    setScore: setScore,
    setRound: setRound,
    noteBumps: noteBumps,
    adoptSky: adoptSky,
    sky: skyNow,
    poseOf: poseOf,
    roster: roster,
    others: function () { return others; },
    me: function () { return me; },
    owner: function () { return owner; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    live: function () { return PEOPLE && !!me.id; },
    tintFor: tintFor,
    onRoster: function (fn) { onRoster = fn; },
    onSky: function (fn) { onSky = fn; },
    onAward: function (fn) { onAward = fn; },
    onBump: function (fn) { onBump = fn; }
  };

  root['__rockets'] = {
    state: function () {
      return skySeq ? { seq: skySeq | 0 } : null;
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
    _n.id = 'rockets-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
