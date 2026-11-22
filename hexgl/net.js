/*
 * HexGL — ghost race over a meeting.
 *
 * Who is here is gifos.people(); the app owner hosts. Invite is OS chrome.
 * Each pilot owns one row in `players`: pose, lap, finish, best. Publish is
 * 8 Hz with interpolation; write only when the pose changes (no idle keep-alive).
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'HexGL needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'Pilot' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var lastPublished = 0;
  var lastPubSig = '';
  var onRoster = null;
  var started = false;

  function db(n) {
    try { return api && api.db ? api.db(n) : null; } catch (e) { return null; }
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r3(n) { return Math.round(n * 1000) / 1000; }

  function tintFor(id) {
    var h = 0;
    id = String(id || '');
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360);
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Pilot';
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'Pilot'; }
      if (key !== roomKey) {
        roomKey = key;
        // re-filter ghosts against the room
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onRoster) onRoster(roster());
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) {
      return Promise.resolve({ owner: true, others: 0 });
    }
    if (!PEOPLE) {
      return Promise.resolve({ owner: true, others: 0 });
    }
    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2200);
        var p = db('players');
        if (p) p.subscribe(function (list) {
          ingest(list || []);
          done();
        });
        else done();
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function ingest(list) {
    var t = Date.now(), seen = {}, names = peopleNames();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Pilot',
        x: p.x, y: p.y, z: p.z,
        qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw,
        lap: p.lap || 0, fin: p.fin || 0, best: p.best || 0,
        stamp: p.t, t: t, hue: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, z: cur.z, qx: cur.qx, qy: cur.qy, qz: cur.qz, qw: cur.qw, t: cur.t } : null
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function poseOf(o) {
    if (!o.prev) return o;
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (Date.now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    return {
      x: o.prev.x + (o.x - o.prev.x) * a,
      y: o.prev.y + (o.y - o.prev.y) * a,
      z: o.prev.z + (o.z - o.prev.z) * a,
      qx: o.prev.qx + (o.qx - o.prev.qx) * a,
      qy: o.prev.qy + (o.qy - o.prev.qy) * a,
      qz: o.prev.qz + (o.qz - o.prev.qz) * a,
      qw: o.prev.qw + (o.qw - o.prev.qw) * a
    };
  }

  function publish(st, force) {
    if (!PEOPLE || !me.id || !st) return;
    var p = db('players');
    if (!p) return;
    var now = Date.now();
    if (!force && now - lastPublished < 1000 / PUBLISH_HZ) return;
    var row = {
      id: me.id,
      x: r1(st.x), y: r1(st.y), z: r1(st.z),
      qx: r3(st.qx), qy: r3(st.qy), qz: r3(st.qz), qw: r3(st.qw),
      lap: st.lap | 0, fin: st.fin | 0, best: st.best | 0
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = now;
    row.t = now;
    started = true;
    p.put(row).catch(function () {});
  }

  function roster() {
    var names = peopleNames(), list = [];
    for (var id in others) {
      var o = others[id];
      list.push({
        id: o.id, name: names[o.id] || o.name, me: false,
        best: o.best, fin: o.fin, lap: o.lap, hue: o.hue
      });
    }
    return list;
  }

  function ghosts() {
    var g = [];
    for (var id in others) {
      var o = others[id];
      var p = poseOf(o);
      g.push({
        id: o.id, name: o.name, hue: o.hue,
        x: p.x, y: p.y, z: p.z,
        qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw
      });
    }
    return g;
  }

  function countOthers() {
    var n = 0;
    for (var k in others) n++;
    return n;
  }

  root.Net = {
    init: init,
    publish: publish,
    roster: roster,
    ghosts: ghosts,
    me: function () { return me; },
    owner: function () { return owner; },
    live: function () { return PEOPLE && !!me.id; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__hexgl'] = {
    // Ghost race — no shared world row; copies agree on null.
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
    _n.id = 'hexgl-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
