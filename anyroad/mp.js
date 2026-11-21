// Anyroad — multiplayer.
//
// This is the part GifOS is genuinely better at than a normal web game: there
// is no game server, no account, and no lobby. The room IS the invite link, the
// host's browser holds the state, and a guest who opens the link lands in the
// same place on Earth as everyone else.
//
// Two things shape the design, both from the platform:
//
//  1. A subscriber re-downloads the WHOLE collection on every change. Position
//     traffic is therefore O(players²) and the sensible move is a low publish
//     rate (5 Hz) with client-side interpolation, not a high one.
//  2. Positions are published as LATITUDE AND LONGITUDE, never as world metres.
//     Each player's world frame is pinned at their own hop point, so metres
//     mean different things in different tabs — geographic coordinates are the
//     only thing that survives the trip.
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Anyroad needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var PUBLISH_HZ = 5;
  var FINISH_RADIUS = 30;     // metres
  var lastPubSig = '';

  var me = { id: null, name: 'Driver' };
  var frame = null;
  var others = {};            // id -> { lat, lon, yaw, spd, t, prev, name, tint }
  var raceRec = null;
  var worldRec = null;
  var acc = 0;
  var myResult = null;
  var celebrated = {};      // finishes already announced, so a republish is quiet
  var finishCb = null;
  var noteCb = null;   // room-level news the player must be told (a followed hop)
  var myFlare = 0;     // when I last sent one up (ms); rides my own row
  var listeners = [];

  function db(n) { return root.Host.db(n); }

  // A stable colour per player, so the same car is the same colour for everyone
  // watching. Derived from the id rather than assigned, so no coordination.
  function tintFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    var hue = (h % 360) / 360;
    // HSV -> RGB at fixed saturation/value, kept bright enough to read at range.
    var i6 = Math.floor(hue * 6), f = hue * 6 - i6, s = 0.62, v = 0.95;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var m = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i6 % 6];
    return m;
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Driver';
    }
    return m;
  }

  function readRoom() {
    if (!PEOPLE || !root.gifos) return Promise.resolve();
    return Promise.all([
      root.gifos.people(),
      root.gifos.info ? root.gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      roomPeople = ppl;
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Driver'; }
      if (key !== roomKey) {
        roomKey = key;
        listeners.forEach(function (cb) { try { cb(); } catch (e) {} });
      }
    }, function () {});
  }

  function init() {
    if (!PEOPLE) return;
    readRoom().then(function () {
      if (!me.id) return;
      db('players').subscribe(function (list) {
        drainHits(list || []);
        var now = Date.now();
        var seen = {};
        var names = peopleNames();
        (list || []).forEach(function (p) {
          if (!p || !p.id || p.id === me.id) return;
          if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
          seen[p.id] = 1;
          var cur = others[p.id];
          others[p.id] = {
            lat: p.lat, lon: p.lon, yaw: p.yaw, spd: p.spd || 0, name: names[p.id] || 'Driver',
            flare: p.flare || 0,
            stamp: p.t, t: now, tint: tintFor(p.id),
            prev: cur ? { lat: cur.lat, lon: cur.lon, yaw: cur.yaw, t: cur.t } : null,
          };
        });
        for (var id in others) if (!seen[id]) delete others[id];
      });

      db('race').subscribe(function (list) {
        var prevStart = raceRec && raceRec.startedAt;
        var prevResults = (raceRec && raceRec.results || []).length;
        raceRec = null; worldRec = null;
        (list || []).forEach(function (r) {
          if (r.id === 'race') raceRec = r;
          if (r.id === 'world') worldRec = r;
        });
        if (raceRec && raceRec.startedAt !== prevStart) {
          myResult = null;
          celebrated = {};
        }
        if (raceRec && finishCb) {
          var res = raceRec.results || [];
          if (res.length > prevResults) {
            for (var i = prevResults; i < res.length; i++) {
              var r2 = res[i];
              if (!r2 || celebrated[r2.id + ':' + r2.ms]) continue;
              celebrated[r2.id + ':' + r2.ms] = 1;
              finishCb({ name: r2.name, ms: r2.ms, place: i + 1,
                         mine: r2.id === me.id, total: res.length });
            }
          }
        }
        if (worldRec && isFinite(worldRec.lat) && isFinite(worldRec.lon) && !root.App.hasHopped()) {
          root.App.hop(worldRec.lat, worldRec.lon, worldRec.place);
          myWorld = { lat: worldRec.lat, lon: worldRec.lon };
        } else if (worldRec && isFinite(worldRec.lat) && isFinite(worldRec.lon)
                   && worldRec.byId && worldRec.byId !== me.id && myWorld
                   && farFrom(myWorld, worldRec) && root.App.hasHopped()) {
          myWorld = { lat: worldRec.lat, lon: worldRec.lon };
          root.App.hop(worldRec.lat, worldRec.lon, worldRec.place);
          if (noteCb) noteCb((worldRec.by || 'They') + ' hopped to ' + (worldRec.place || 'somewhere else') + ' — following.');
        }
        listeners.forEach(function (cb) { try { cb(); } catch (e) {} });
      });
      setInterval(readRoom, PEOPLE_MS);
    });
  }

  var myWorld = null;
  function setFrame(f, lat, lon, place) {
    frame = f;
    myResult = null;
    myWorld = { lat: lat, lon: lon };
    if (PEOPLE && me.id) db('race').put({ id: 'world', lat: lat, lon: lon, place: place || '',
                     byId: me.id, at: Date.now() }).catch(function () {});
  }

  // Two worlds are "the same place" if you could plausibly drive between them.
  // A hop is a teleport — cities apart — so anything under a kilometre is the
  // same world re-published (a re-pin, a rejoin) and must not move anybody.
  function farFrom(a, b) {
    if (!a || !b || b.lat == null || b.lon == null) return false;
    var dLat = (b.lat - a.lat) * 111320;
    var dLon = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon) > 1000;
  }

  function tick(car, dt) {
    if (!frame || !me.id || !PEOPLE) return;
    acc += dt;
    if (acc < 1 / PUBLISH_HZ) return;
    acc = 0;
    var g = frame.toGeo(car.x, car.z);
    var row = {
      id: me.id, lat: g.lat, lon: g.lon,
      yaw: car.yaw, spd: Math.abs(car.speed),
      // Shots I have FIRED, on my own row. Nobody ever writes to anybody
      // else's record: every player owns exactly one row and reads the rest,
      // which is the same shape the ghosts already use and needs no authority
      // to arbitrate. You claim a hit; the other browser decides what to do
      // about it. Among friends over a link that is the right trade - anyone
      // running a modified copy can ignore it, and nothing else breaks.
      hits: myShots,
      // A FLARE IS A TIMESTAMP. Everything else about it - where, what colour,
      // how long it has left - is derived from the row it rides on, so it
      // costs one number and cannot disagree with the position it marks.
      flare: myFlare || 0
    };
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    row.t = Date.now();
    db('players').put(row).catch(function () {});
  }

  // Other cars, in MY world frame, interpolated toward their latest sample.
  // Shots I have fired recently, kept short — this rides on every publish at
  // 5 Hz, so it is a rolling window and not a log.
  var myShots = [];
  function shoot(targetId) {
    if (!targetId) return;
    myShots.push({ t: targetId, at: Date.now() });
    if (myShots.length > 6) myShots.shift();
  }

  // Hits fired AT ME that I have not applied yet. Keyed on the shot's own
  // timestamp so a row republished five times a second cannot land the same
  // shot five times.
  var seenShot = {}, hitCb = null;
  function drainHits(rows) {
    if (!hitCb || !me.id) return;
    var landed = 0, now = Date.now();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.id === me.id || !r.hits) continue;
      for (var h = 0; h < r.hits.length; h++) {
        var s = r.hits[h];
        if (!s || s.t !== me.id) continue;
        var key = r.id + ':' + s.at;
        if (seenShot[key]) continue;
        // Ignore anything stale: a row that arrives late must not replay a
        // volley from a minute ago the moment you reconnect.
        if (now - s.at > 15000) { seenShot[key] = 1; continue; }
        seenShot[key] = 1;
        landed++;
      }
    }
    if (landed) hitCb(landed);
  }

  function ghosts() {
    if (!frame) return [];
    var now = Date.now(), out = [], names = peopleNames();
    for (var id in others) {
      var o = others[id];
      if (!Object.prototype.hasOwnProperty.call(names, id)) continue;
      var lat = o.lat, lon = o.lon, yaw = o.yaw;
      if (o.prev) {
        // Extrapolate across the gap between publishes so a ghost glides
        // instead of stepping five times a second.
        var span = Math.max(1, o.t - o.prev.t);
        var k = Math.min(1.6, (now - o.t) / span);
        lat = o.lat + (o.lat - o.prev.lat) * k;
        lon = o.lon + (o.lon - o.prev.lon) * k;
        var dy = ((o.yaw - o.prev.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        yaw = o.yaw + dy * k;
      }
      var w = frame.toWorld(lat, lon);
      var h = root.Terrain.heightAt(frame, w.x, w.z);
      // No ground loaded under them yet: skip rather than draw the car at sea
      // level, which in hilly terrain is a car hanging in the sky.
      if (h === null) continue;
      out.push({ x: w.x, y: h, z: w.z, yaw: yaw, tint: o.tint, name: o.name });
    }
    return out;
  }

  // Every flare currently burning, in MY frame — mine included, because the
  // person who fired it should see what everyone else is being shown. Sorted
  // out here rather than in the renderer: only this module knows where other
  // people are.
  var FLARE_MS = 45000;
  function sendFlare() { myFlare = Date.now(); return true; }
  function flares(car) {
    var now = Date.now(), out = [];
    if (myFlare && now - myFlare < FLARE_MS && car) {
      out.push({ x: car.x, z: car.z, life: 1 - (now - myFlare) / FLARE_MS, mine: true, tint: [1.0, 0.85, 0.35] });
    }
    if (!frame) return out;
    for (var id in others) {
      var o = others[id];
      if (!o.flare || now - o.flare > FLARE_MS) continue;
      var w = frame.toWorld(o.lat, o.lon);
      out.push({ x: w.x, z: w.z, life: 1 - (now - o.flare) / FLARE_MS,
                 mine: false, name: o.name, tint: o.tint });
    }
    return out;
  }

  function count() {
    var names = peopleNames(), n = 0, id;
    for (id in others) if (Object.prototype.hasOwnProperty.call(names, id)) n++;
    return n + (me.id && names[me.id] ? 1 : 0);
  }

  // ---- races ---------------------------------------------------------------
  // A race is two points and a start time. Everything else — who is ahead, who
  // finished — is derived, so there is no authority to disagree with.
  function setRace(startGeo, finishGeo) {
    return db('race').put({
      id: 'race',
      sLat: startGeo.lat, sLon: startGeo.lon,
      fLat: finishGeo.lat, fLon: finishGeo.lon,
      startedAt: Date.now() + 3000,          // a three-second countdown for everyone
      results: [],
    });
  }

  function clearRace() { return db('race').delete('race'); }

  // Move the flag onto the nearest road, ONCE. A flag dropped on a random
  // bearing lands wherever it lands — the middle of a lake, a cliff, the wrong
  // side of a river — and a race that cannot be finished is not a race. Marked
  // `snapped` so the first player whose copy manages it settles the question
  // for everyone: this is a shared read-write record and two players nudging
  // the flag at each other would never converge.
  function snapFinish(geo) {
    if (!raceRec || raceRec.snapped) return Promise.resolve(false);
    return db('race').put(Object.assign({}, raceRec, {
      fLat: geo.lat, fLon: geo.lon, snapped: true,
    })).then(function () { return true; });
  }

  function raceState(car) {
    if (!raceRec || !frame) return null;
    var now = Date.now();
    var fin = frame.toWorld(raceRec.fLat, raceRec.fLon);
    var d = Math.hypot(car.x - fin.x, car.z - fin.z);
    var state = {
      countdown: Math.max(0, raceRec.startedAt - now),
      elapsed: Math.max(0, now - raceRec.startedAt),
      toFinish: d,
      finish: fin,
      start: frame.toWorld(raceRec.sLat, raceRec.sLon),
      results: raceRec.results || [],
      snapped: !!raceRec.snapped,
      done: !!myResult,
      myTime: myResult,
    };
    if (!myResult && state.countdown === 0 && d < FINISH_RADIUS) {
      myResult = state.elapsed;
      state.done = true; state.myTime = myResult;
      var results = (raceRec.results || []).slice();
      results.push({ id: me.id, name: me.name, ms: myResult });
      results.sort(function (a, b) { return a.ms - b.ms; });
      db('race').put(Object.assign({}, raceRec, { results: results })).catch(function () {});
    }
    return state;
  }

  root.MP = {
    init: init, setFrame: setFrame, tick: tick, ghosts: ghosts, count: count,
    setRace: setRace, clearRace: clearRace, raceState: raceState, snapFinish: snapFinish,
    shoot: shoot, onHit: function (cb) { hitCb = cb; },
    sendFlare: sendFlare, flares: flares, FLARE_MS: FLARE_MS,
    onFinish: function (cb) { finishCb = cb; },
    onNote: function (cb) { noteCb = cb; },
    worldState: function () {
      return { rec: worldRec ? { lat: worldRec.lat, lon: worldRec.lon, place: worldRec.place,
                                 by: worldRec.by, byId: worldRec.byId } : null,
               myWorld: myWorld, meId: me.id, hopped: !!(root.App && root.App.hasHopped()) };
    },
    hasRace: function () { return !!raceRec; },
    onChange: function (cb) { listeners.push(cb); },
    me: function () { return me; },
    owner: function () { return owner; },
    live: function () { return PEOPLE && !!me.id && count() > 1; }
  };

  root['__anyroad'] = {
    state: function () {
      if (!raceRec) return null;
      return {
        startedAt: raceRec.startedAt || 0,
        results: (raceRec.results || []).length | 0,
        snapped: !!raceRec.snapped
      };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return PEOPLE && owner && count() > 1; }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'ar-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
