/*
 * Eagle Defense — two devices, no game server (gifos.room).
 *
 * The seats (P1, P2) come from gifos.room; the line waits. The only channel
 * for play is the replicated collection. A seated guest owns one row in
 * `players` (its pose and fire, keyed by its room id) and writes it only when
 * it changes (~8 Hz at most). The app's owner (gifos.info().owner) owns the
 * single `world` row and is the authority for the stage, the AI, the bricks
 * and the eagle: it reads the other seat's row and simulates. When the owner
 * leaves, GifOS hands the app to the next copy, which takes the simulation
 * over from the world it has been painting. Rows of people who hold no seat
 * are ignored.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;

  var api = null;
  var ROOM = false;
  var rs = null;
  var joined = false;
  var me = { id: null, name: 'Player' };
  var owner = true;
  var rows = {};
  var world = null;
  var lastPublished = 0;
  var lastRowSig = null;
  var lastWorldSig = null;
  var fireN = 0;
  var onWorld = null;
  var onRoster = null;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  var r1 = function (n) { return Math.round(n * 10) / 10; };

  function init() {
    api = root.gifos;
    if (!api || !api.db) {
      me.id = 'local';
      owner = true;
      return Promise.resolve({ me: me, owner: true, old: false });
    }
    ROOM = !!(api.room && api.room.subscribe);
    if (!ROOM) {
      // An older GifOS has no room: solo play only, nothing shared is written.
      me.id = 'local';
      owner = true;
      return Promise.resolve({ me: me, owner: true, old: true });
    }
    var infoP = api.info ? api.info().catch(function () { return { owner: true }; }) : Promise.resolve({ owner: true });
    return infoP.then(function (i) {
      owner = !!(i && i.owner);
      db('players').subscribe(ingestPlayers);
      db('world').subscribe(function (list) {
        var rec = null;
        for (var k = 0; k < (list || []).length; k++) if (list[k] && list[k].id === 'world') rec = list[k];
        world = rec;
        if (onWorld && rec) onWorld(rec);
      });
      api.room.subscribe(onRoomState);
      return { me: me, owner: owner, old: false };
    }).catch(function () {
      me.id = 'local';
      owner = true;
      return { me: me, owner: true, old: false };
    });
  }

  function onRoomState(s) {
    rs = s;
    if (s && s.me) { me.id = s.me.id; me.name = s.me.name || 'Player'; }
    // Opening the game is asking to play, once; the room seats me, lines me up, or asks the host.
    if (!joined && s && s.me && s.me.role === 'watcher') { joined = true; api.room.join().catch(function () {}); }
    refreshOwner();
    if (onRoster) onRoster(roster());
  }

  // Who owns the app can change (the owner leaves, GifOS hands it on): a local read, no network.
  function refreshOwner() {
    if (!ROOM || !api.info) return;
    api.info().then(function (i) {
      var o = !!(i && i.owner);
      if (o !== owner) { owner = o; lastWorldSig = null; lastRowSig = null; if (onRoster) onRoster(roster()); }
    }).catch(function () {});
  }

  function mySlot() {
    if (!ROOM || !rs || !rs.me) return 0;
    for (var i = 0; i < rs.seats.length; i++) if (rs.seats[i].id && rs.seats[i].id === rs.me.id) return i;
    return -1;
  }

  function ingestPlayers(list) {
    rows = {};
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      rows[p.id] = {
        id: p.id, x: p.x, y: p.y, dir: p.dir || 'up',
        keys: p.keys || {}, fireN: p.fireN || 0, fireDir: p.fireDir
      };
    }
    if (onRoster) onRoster(roster());
  }

  // The other seated people who are here: their seat slot, name and last row (rows of unseated ids never count).
  function otherList() {
    var out = [];
    if (!ROOM || !rs) return out;
    var mine = mySlot();
    for (var i = 0; i < rs.seats.length; i++) {
      var st = rs.seats[i];
      if (i === mine || !st.id || st.here !== 'here') continue;
      var r = rows[st.id] || {};
      out.push({ id: st.id, name: st.name || 'Player', slot: i, x: r.x, y: r.y, dir: r.dir || 'up',
                 keys: r.keys || {}, fireN: r.fireN || 0, fireDir: r.fireDir });
    }
    return out;
  }

  // My row: only a guest writes one, only when I am seated with somebody, only when it changed.
  function publish(pose, force) {
    if (!ROOM || !rs || !rs.me || owner || mySlot() < 0 || otherList().length === 0) return;
    var t = now();
    var row = {
      id: me.id,
      x: r1(pose.x), y: r1(pose.y), dir: pose.dir,
      keys: pose.keys || {},
      fireN: pose.fireN || fireN,
      fireDir: pose.fireDir || pose.dir
    };
    var sig = JSON.stringify(row);
    if (lastRowSig === null) { lastRowSig = sig; if (!force) return; }   // the first look is a baseline
    if (sig === lastRowSig && !force) return;
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    lastPublished = t;
    lastRowSig = sig;
    db('players').put(row).catch(function () {});
  }

  function bumpFire() { return ++fireN; }

  // The owner's world, only while somebody else is seated, and only when it changed.
  function putWorld(snap) {
    if (!ROOM || !owner || !me.id || otherList().length === 0) return;
    var sig = JSON.stringify(snap);
    if (sig === lastWorldSig) return;
    lastWorldSig = sig;
    snap.id = 'world';
    snap.hostId = me.id;
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
    var list = [{ id: me.id, name: me.name, me: true }];
    var o = otherList();
    for (var i = 0; i < o.length; i++) list.push({ id: o[i].id, name: o[i].name, me: false });
    return list;
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
    count: function () { return 1 + otherList().length; },
    world: function () { return world; },
    seats: function () { return rs ? rs.seats.map(function (x) { return x.id || null; }) : []; },
    mySlot: mySlot,
    refreshOwner: refreshOwner,
    room: function () { return ROOM; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
