/* Optional meeting: the same document, on everyone else's screen.
 * Each person writes THEIR own row. The app owner hosts the document
 * (else lowest id). Who is here is gifos.people(). Nobody writes anybody
 * else's row. Invite is OS chrome — this file only says to press it. */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'JSON Crack needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var guest = false;
  var lastSent = '';
  var lastList = [];
  var lastPub = 0;

  var now = function () { return Date.now(); };

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
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Friend' }));
    });
    return out;
  }

  function hostOf(players) {
    if (!players.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < players.length; i++) if (players[i].id === me.id) { a = players[i]; break; }
    }
    if (a) return a;
    var h = players[0];
    for (i = 1; i < players.length; i++) if (players[i].id < h.id) h = players[i];
    return h;
  }

  function snapshot() {
    var text = root.JsonCrackApp ? root.JsonCrackApp.getText() : '';
    return { id: me.id, text: text };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    var s = snapshot();
    lastSent = s.text;
    room.put(s).catch(function () {});
  }

  function statusOf(players) {
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      return 'Press Invite (top bar) to show this document in a meeting.';
    }
    if (guest) {
      var h = hostOf(players);
      var who = h && h.id !== me.id ? (h.name || 'a friend') : 'a friend';
      return 'Showing ' + who + '\'s document. Edit it — you both see the graph.';
    }
    return (others.length === 1 ? 'A friend is here.' : others.length + ' friends are here.') +
      ' Either of you can type; the graph follows.';
  }

  function applyHost(players) {
    var h = hostOf(players);
    if (!h) return;
    guest = h.id !== me.id;
    var el = document.getElementById('meet');
    if (el) el.textContent = statusOf(players);
    if (guest && h.text != null && root.JsonCrackApp && h.text !== root.JsonCrackApp.getText()) {
      root.JsonCrackApp.setText(h.text);
    }
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (on) applyHost(live(lastList));
      }
    }, function () {});
  }

  function start() {
    if (!root.gifos || !root.gifos.db || !PEOPLE) return;
    try { room = root.gifos.db('room'); } catch (e) { return; }
    if (!room || !room.subscribe) return;
    on = true;
    readRoom().then(function () {
      publish();
    });
    room.subscribe(function (rows) {
      lastList = rows || [];
      applyHost(live(lastList));
    });
    setInterval(readRoom, PEOPLE_MS);
  }

  root.JsonCrackMp = {
    noteChange: function () { if (on) publish(); }
  };

  root['__json-crack'] = {
    state: function () {
      var players = live(lastList);
      var h = hostOf(players);
      return h ? { n: (h.text || '').length | 0 } : (on ? { n: lastSent.length | 0 } : null);
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () {
      var n = 0, id, names = peopleNames();
      for (id in names) n++;
      return on && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'jc-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  start();
})(typeof window !== 'undefined' ? window : this);
