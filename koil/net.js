/*
 * Koil — multiplayer over gifos.db.
 *
 * Who is here is gifos.people(); the app owner hosts. Invite is OS chrome.
 * Each player owns one `players` row: pose, bomb throws, item claims.
 * Publish only when the pose or claims change — no idle keep-alive (kit K3).
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 6;
  var THROW_RING = 6;
  var CLAIM_TTL = 20000;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Koil needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var seq = 0;
  var myGot = [];
  var pendingThrows = [];
  var seenThrows = {};
  var appliedGot = {};
  var lastPublished = 0;
  var lastPubSig = '';
  var onRoster = null;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r2(n) { return Math.round(n * 100) / 100; }

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

  function hueFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h & 255;
  }

  function spawnFor(id) {
    var spots = [[1.5, 1.5], [1.5, 4.5], [4.5, 4.5], [5.5, 6.5], [0.5, 0.5], [6.5, 3.5]];
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
    return spots[h % spots.length];
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
        for (id in others) {
          if (!names[id]) {
            root.Koil.dropOther(id);
            delete others[id];
          }
        }
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
      var sp = spawnFor(me.id);
      root.Koil.me.id = me.id;
      root.Koil.me.name = me.name;
      root.Koil.me.x = sp[0];
      root.Koil.me.y = sp[1];
      root.Koil.me.hue = hueFor(me.id);
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
      if (p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      drainGot(p);
      drainThrows(p);
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Player',
        x: p.x, y: p.y, dir: p.dir || 0, moving: p.mv || 0, hue: p.hue || 0,
        stamp: p.t, t: t,
        prev: cur ? { x: cur.x, y: cur.y, dir: cur.dir, t: cur.t } : null
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) {
        root.Koil.dropOther(id);
        delete others[id];
      }
    }
    paintOthers();
    if (onRoster) onRoster(roster());
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, dir: o.dir };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var dd = ((o.dir - o.prev.dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      x: o.prev.x + (o.x - o.prev.x) * a,
      y: o.prev.y + (o.y - o.prev.y) * a,
      dir: o.prev.dir + dd * a
    };
  }

  function paintOthers() {
    for (var id in others) {
      var p = poseOf(others[id]);
      root.Koil.setOther(id, {
        x: p.x, y: p.y, dir: p.dir,
        moving: others[id].moving, hue: others[id].hue, name: others[id].name
      });
    }
  }

  function drainGot(p) {
    if (!p.got || !p.got.length) return;
    for (var i = 0; i < p.got.length; i++) {
      var idx = p.got[i] | 0;
      var key = p.id + ':' + idx;
      if (appliedGot[key]) continue;
      appliedGot[key] = now();
      root.Koil.killItem(idx);
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in appliedGot) if (appliedGot[k] < cutoff) delete appliedGot[k];
  }

  function drainThrows(p) {
    if (!p.throws || !p.throws.length) return;
    for (var i = 0; i < p.throws.length; i++) {
      var th = p.throws[i];
      if (!th) continue;
      var key = p.id + ':' + th.n;
      if (seenThrows[key]) continue;
      seenThrows[key] = now();
      root.Koil.spawnRemoteBomb(th);
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in seenThrows) if (seenThrows[k] < cutoff) delete seenThrows[k];
  }

  function claimItem(index) {
    if (myGot.indexOf(index) < 0) myGot.push(index);
    publish(true);
  }

  function claimThrow(spawned) {
    pendingThrows.push({
      n: ++seq,
      x: r2(spawned.x), y: r2(spawned.y), z: r2(spawned.z),
      dx: r2(spawned.dx), dy: r2(spawned.dy), dz: r2(spawned.dz),
      life: r2(spawned.life)
    });
    if (pendingThrows.length > THROW_RING) pendingThrows.shift();
    publish(true);
  }

  function publish(force) {
    if (!api || !me.id || !PEOPLE) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var p = root.Koil.me;
    var row = {
      id: me.id,
      x: r2(p.x), y: r2(p.y), dir: r2(p.dir),
      mv: p.moving | 0, hue: p.hue | 0,
      got: myGot.slice(),
      throws: pendingThrows.slice()
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function tick() {
    if (!api || !me.id || !PEOPLE) return;
    paintOthers();
    publish(false);
  }

  function roster() {
    var names = peopleNames();
    var list = [{ id: me.id, name: me.name, me: true }];
    for (var id in others) list.push({ id: id, name: names[id] || others[id].name, me: false });
    return list;
  }

  root.Net = {
    init: init,
    tick: tick,
    publish: publish,
    claimItem: claimItem,
    claimThrow: claimThrow,
    roster: roster,
    others: function () { return others; },
    me: function () { return me; },
    count: function () { var n = 0; for (var k in others) n++; return n + 1; },
    live: function () { return PEOPLE && !!api && !!me.id; },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__koil'] = {
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

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'koil-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
