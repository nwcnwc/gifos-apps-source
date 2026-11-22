/*
 * Eagle Defense — two devices, no game server.
 *
 * The only channel is the replicated collection. Each player owns exactly one
 * row in `players` and only ever writes that row. The app owner owns the single
 * `world` row and is the authority for the stage, the AI, the bricks and the
 * eagle. Guests publish pose + fire; the host reads those and simulates.
 * Who is here is gifos.people().
 *
 * A subscriber re-downloads the whole collection on every change, so we keep
 * the rate low (~8 Hz) and force a publish on fire.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Eagle Defense needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'Player' };
  var owner = true;
  var roomPeople = [];
  var roomKey = '';
  var others = {};
  var world = null;
  var lastPublished = 0;
  var lastPubSig = '';
  var fireN = 0;
  var onWorld = null;
  var onRoster = null;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  var r1 = function (n) { return Math.round(n * 10) / 10; };

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
        if (onRoster) onRoster(roster());
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) {
      me.id = 'local';
      owner = true;
      return Promise.resolve({ me: me, owner: true, others: [] });
    }
    if (!PEOPLE) {
      me.id = 'local';
      owner = true;
      return Promise.resolve({ me: me, owner: true, others: [] });
    }
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ me: me, owner: owner, others: roster() });
        };
        setTimeout(done, 2200);
        db('players').subscribe(function (list) {
          ingestPlayers(list || []);
          done();
        });
        db('world').subscribe(function (list) {
          var rec = null;
          for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'world') rec = list[i];
          world = rec;
          if (onWorld && rec) onWorld(rec);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      me.id = 'local';
      owner = true;
      return { me: me, owner: true, others: [] };
    });
  }

  function ingestPlayers(list) {
    var t = now(), seen = {}, names = peopleNames();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.id) continue;
      if (p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Player',
        x: p.x, y: p.y, dir: p.dir || 'up',
        keys: p.keys || {}, fireN: p.fireN || 0, fireDir: p.fireDir,
        stamp: p.t, t: t
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function publish(pose, force) {
    if (!api || !me.id || !PEOPLE || me.id === 'local') return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var row = {
      id: me.id,
      x: r1(pose.x), y: r1(pose.y), dir: pose.dir,
      keys: pose.keys || {},
      fireN: pose.fireN || fireN,
      fireDir: pose.fireDir || pose.dir
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function bumpFire() { return ++fireN; }

  function putWorld(snap) {
    if (!api || !owner || !me.id || !PEOPLE) return;
    snap.id = 'world';
    snap.hostId = me.id;
    snap.t = now();
    db('world').put(snap).catch(function () {});
  }

  function savePrefs(rec) {
    if (!api || !api.db) return;
    rec.id = 'hi';
    db('prefs').put(rec).catch(function () {});
  }
  function loadPrefs() {
    if (!api || !api.db) return Promise.resolve(null);
    return db('prefs').get('hi').catch(function () { return null; });
  }

  function roster() {
    var names = peopleNames();
    var list = [{ id: me.id, name: me.name, me: true }];
    for (var id in others) list.push({ id: id, name: names[id] || others[id].name, me: false });
    return list;
  }

  function otherList() {
    var out = [];
    for (var id in others) out.push(others[id]);
    return out;
  }

  root.BCNet = {
    init: init,
    publish: publish,
    bumpFire: bumpFire,
    fireN: function () { return fireN; },
    putWorld: putWorld,
    savePrefs: savePrefs,
    loadPrefs: loadPrefs,
    onWorld: function (cb) { onWorld = cb; },
    onRoster: function (cb) { onRoster = cb; },
    roster: roster,
    others: otherList,
    me: function () { return me; },
    isOwner: function () { return owner; },
    count: function () { var n = 1; for (var k in others) n++; return n; },
    world: function () { return world; }
  };

  root['__battle-city'] = {
    state: function () {
      return world ? { t: world.t | 0, stage: world.stage | 0 } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'bc-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
