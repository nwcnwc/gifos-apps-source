/*
 * Extra bodies — each player writes ONLY their own row.
 * The seed on the oldest row is the maze: everyone who presses Play walks the
 * same halls. Invite is OS chrome, so this file never draws a button; it only
 * counts who turned up and hands the number to the HUD.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Backdooms needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [], roomKey = '', owner = false, roomRead = false;

  var db = null, me = { id: 'solo', name: 'you' };
  var lastPub = 0;
  var lastShot = {};
  var lastHits = [];
  var shotSeq = 0;
  var roster = [];

  function readRoom() {
    if (!PEOPLE || !root.gifos) return Promise.resolve();
    return Promise.all([
      root.gifos.people(),
      root.gifos.info ? root.gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      roomKey = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me = { id: mine.id, name: mine.name || 'you' }; }
      onAll(roster);
    }, function () {});
  }

  function init() {
    if (!root.gifos || !root.gifos.db) return Promise.resolve();
    if (!PEOPLE) return Promise.resolve();
    db = gifos.db('players');
    return readRoom().then(function () {
      if (!me.id || me.id === 'solo') return;
      db.subscribe(onAll);
      setInterval(readRoom, PEOPLE_MS);
      publish(true);
    }).catch(function () {});
  }

  function sharedSeed() {
    var i, r, pick = null, bestT = Infinity;
    for (i = 0; i < roster.length; i++) {
      r = roster[i];
      if (!r || r.id === me.id || r.seed == null) continue;
      if ((r.t || 0) < bestT) { bestT = r.t || 0; pick = r.seed; }
    }
    return pick;
  }

  function onAll(rows) {
    var now = Date.now(), list = [], i, r, hits, seq, names = {}, id;
    if (rows) roster = rows;
    for (i = 0; i < roomPeople.length; i++) {
      if (roomPeople[i] && roomPeople[i].id && roomPeople[i].here !== 'gone') {
        names[roomPeople[i].id] = roomPeople[i].name;
      }
    }
    for (i = 0; i < roster.length; i++) {
      r = roster[i];
      if (!r || !r.id) continue;
      if (!Object.prototype.hasOwnProperty.call(names, r.id)) continue;
      if (r.id === me.id) continue;
      list.push({ id: r.id, x: r.x, y: r.y, a: r.a, h: r.hp, name: names[r.id] || 'you' });
      seq = r.shot | 0;
      hits = r.hits || [];
      if (seq && seq !== lastShot[r.id] && hits.indexOf(me.id) >= 0) {
        lastShot[r.id] = seq;
        if (root.Backdooms && root.Backdooms.hurt) {
          /* which way the shot came from, so the damage arc points at them */
          var mine = root.Backdooms.state();
          var bear = Math.atan2(r.y - mine.y, r.x - mine.x) - mine.a;
          root.Backdooms.hurt(34, Math.atan2(Math.sin(bear), Math.cos(bear)));
        }
      } else if (seq) {
        lastShot[r.id] = seq;
      }
    }
    if (root.Backdooms && root.Backdooms.setRemotes) root.Backdooms.setRemotes(list);
    if (root.Hud) root.Hud.room(1 + list.length);
  }

  /*
   * WRITE WHEN SOMETHING CHANGED, not on a metronome.
   *
   * Measured on the old code: 11.8 writes a second while STANDING PERFECTLY
   * STILL, and 12 while walking — it never asked whether anything had moved.
   * That is not free. docs/app-services.md §4: a guest write is a proposal
   * that floods to the owner, which validates it, Ed25519-signs the WHOLE
   * collection and floods the result; every client then re-reads all N rows
   * (runtime.js `subscribe` does a full getAll on every db-change). It names
   * Anyroad's players collection doing exactly this at 5N writes/sec as what
   * puts "a ceiling of a few dozen players" on the mesh. This app was doing
   * it at 12N.
   *
   * So: a floor of 120 ms between writes, nothing sent unless the player
   * actually moved, turned, took damage or scored, and a keepalive every 2.5 s
   * because onAll() drops a row that has not been heard from in 8 s. Standing
   * still goes from ~12 writes a second to 0.4. render-side interpolation
   * (game.js) covers the lower rate, so the figures move MORE smoothly, not
   * less.
   *
   * This is a mitigation, not the fix. Positions are service-3 traffic riding
   * service 4, and service 3 does not exist yet.
   */
  var lastSent = null;

  function worthSending(s) {
    if (!lastSent) return true;
    if (Math.abs(s.x - lastSent.x) > 0.03 || Math.abs(s.y - lastSent.y) > 0.03) return true;
    var da = Math.abs(s.a - lastSent.a);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da > 0.02) return true;
    return s.hp !== lastSent.hp || s.score !== lastSent.score || s.ammo !== lastSent.ammo;
  }

  function publish(force) {
    if (!db) return;
    var now = Date.now();
    var s = root.Backdooms.state();
    if (!force) {
      if (now - lastPub < 120) return;
      if (!worthSending(s)) return;
    }
    lastPub = now;
    lastSent = { x: s.x, y: s.y, a: s.a, hp: s.hp, score: s.score, ammo: s.ammo };
    db.put({
      id: me.id,
      x: s.x, y: s.y, a: s.a, hp: s.hp, score: s.score, seed: s.seed,
      shot: shotSeq, hits: lastHits, t: now
    }).catch(function () {});
  }

  function onShot(hits) {
    shotSeq++;
    lastHits = hits || [];
    publish(true);
  }

  function tick() {
    publish(false);
    if (root.Hud) root.Hud.paint();
  }

  root.Net = {
    init: init,
    tick: tick,
    publish: publish,
    onShot: onShot,
    sharedSeed: sharedSeed
  };

  root['__backdooms'] = {
    // seed from a published row only — local maze seed races before the first put
    state: function () {
      var seed = sharedSeed();
      return seed != null ? { seed: seed } : null;
    },
    people: function () {
      var out = [], i, r, names = {};
      for (i = 0; i < roomPeople.length; i++) {
        if (roomPeople[i] && roomPeople[i].id && roomPeople[i].here !== 'gone') names[roomPeople[i].id] = 1;
      }
      for (i = 0; i < roster.length; i++) {
        r = roster[i];
        if (r && r.id && names[r.id]) out.push(r.id);
      }
      return out;
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return !!db && owner && n > 1;
    }
  };
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'bd-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
