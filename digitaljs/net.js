/*
 * Invite shares the bench. Each person writes THEIR own row in `room`.
 * Highest rev wins; prefer the app owner's row on that rev, else lowest id.
 * Who is here is gifos.people(). Nobody writes anyone else's row.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'DigitalJS needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var api = null, room = null, saveDb = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var rev = 1;
  var usedRev = 0;
  var usedHash = '';
  var lastList = [];
  var lastPub = 0;
  var applying = false;

  function now() { return Date.now(); }
  function $id(id) { return document.getElementById(id); }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push({
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        rev: p.rev,
        json: p.json,
        io: p.io,
        running: p.running,
        sample: p.sample
      });
    });
    return out;
  }

  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.rev || 1) > maxR) maxR = p.rev || 1; });
    var cand = players.filter(function (p) { return (p.rev || 1) === maxR && p.json; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return a;
  }

  function snapshot() {
    var app = root.DjsApp;
    var json = app ? app.currentJson() : null;
    return {
      id: me.id,
      rev: rev,
      json: json,
      io: app ? app.currentIo() : {},
      running: app ? !!app.isRunning() : false,
      sample: app ? app.currentSample() : 'counter'
    };
  }

  function publish(force) {
    if (!on || !room || !me.id || !PEOPLE || applying) return;
    var t = now();
    if (!force && t - lastPub < 120) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }

  function persistPrivate() {
    if (!saveDb || applying) return;
    var app = root.DjsApp;
    if (!app) return;
    saveDb.put({
      id: 'last',
      json: app.currentJson(),
      io: app.currentIo(),
      running: !!app.isRunning(),
      sample: app.currentSample()
    }).catch(function () {});
  }

  function applyWorld(ad) {
    if (!ad || !ad.json || !root.DjsApp) return;
    if (ad.id === me.id) return;
    var h = JSON.stringify(ad.json) + '|' + JSON.stringify(ad.io || {}) + '|' + (ad.running ? 1 : 0);
    if (ad.rev === usedRev && h === usedHash) return;
    applying = true;
    usedRev = ad.rev;
    usedHash = h;
    rev = ad.rev;
    try {
      root.DjsApp.loadFromNet(ad);
    } finally {
      applying = false;
    }
  }

  function renderMeet(list) {
    var el = $id('meet');
    if (!el) return;
    if (!PEOPLE) {
      el.textContent = NEEDS_NEWER;
      return;
    }
    var players = live(list);
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      el.textContent = 'Press Invite in the bar above to share this bench. A friend who opens the link sees the same circuit.';
      return;
    }
    var names = others.map(function (p) { return p.name || 'Friend'; });
    el.textContent = (names.length === 1 ? names[0] + ' is on this bench.' : names.length + ' friends on this bench.') +
      ' Anyone can flip a pin; Play is shared.';
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
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else renderMeet(lastList);
      }
    }, function () {});
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad) applyWorld(ad);
    renderMeet(lastList);
  }

  function bump() {
    rev += 1;
    publish(true);
    persistPrivate();
  }

  function init() {
    api = root.gifos;
    if (api && api.db) {
      try { saveDb = api.db('save'); } catch (e) {}
      if (PEOPLE) {
        try { room = api.db('room'); } catch (e) {}
      }
    }
    if (!PEOPLE) {
      renderMeet([]);
      me.id = me.id || 'local';
      return Promise.resolve(null).then(function () {
        if (saveDb && saveDb.get) return saveDb.get('last').catch(function () { return null; });
        return null;
      });
    }
    return readRoom().then(function () {
      var loaded = Promise.resolve(null);
      if (saveDb && saveDb.get) {
        loaded = saveDb.get('last').catch(function () { return null; });
      }
      return loaded;
    }).then(function (row) {
      if (room && room.subscribe) {
        on = true;
        room.subscribe(onRoom);
        setInterval(readRoom, PEOPLE_MS);
        publish(true);
      }
      return row;
    });
  }

  root.DjsNet = {
    init: init,
    me: function () { return me; },
    applying: function () { return applying; },
    noteChange: function () { persistPrivate(); publish(false); },
    noteCircuit: function () { bump(); },
    persistPrivate: persistPrivate
  };

  root['__digitaljs'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { rev: ad.rev | 0, sample: ad.sample || '' };
      return on ? { rev: rev | 0, sample: (root.DjsApp && root.DjsApp.currentSample()) || '' } : null;
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return on && owner && n > 1;
    }
  };
})(typeof window !== 'undefined' ? window : this);
