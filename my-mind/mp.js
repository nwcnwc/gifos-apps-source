/* Optional meeting: the same map, on everyone else's screen.
 * Each person writes THEIR own row. The app owner hosts the live map
 * (else lowest id). Who is here is gifos.people(). Invite is OS chrome. */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'My Mind needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var lastList = [];
  var lastSent = '';
  var lastPub = 0;
  var guest = false;

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
      out.push(p);
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
    a = players[0];
    for (i = 1; i < players.length; i++) {
      if (players[i].id < a.id) a = players[i];
    }
    return a;
  }

  function mapJson() {
    try { return root.MyMind && root.MyMind.getJSON ? root.MyMind.getJSON() : null; } catch (e) { return null; }
  }

  function snapshot() {
    return { id: me.id, map: mapJson() };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    var s = snapshot();
    try { lastSent = JSON.stringify(s.map); } catch (e) { lastSent = ''; }
    room.put(s).catch(function () {});
  }

  function statusOf(players) {
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      return 'Press Invite (top bar) so a friend can watch this map.';
    }
    if (guest) {
      var h = hostOf(players);
      var who = h && h.id !== me.id ? (h.name || peopleNames()[h.id] || 'a friend') : 'a friend';
      return 'Watching ' + who + "'s map. Edits they make land here.";
    }
    return (others.length === 1 ? 'A friend is watching.' : others.length + ' friends are watching.') +
      ' The same map, on their screen.';
  }

  function applyHost(players) {
    var h = hostOf(players);
    if (!h) return;
    guest = h.id !== me.id;
    var el = typeof document !== 'undefined' ? document.getElementById('meet') : null;
    if (el) el.textContent = statusOf(players);
    if (!guest || !h.map || !root.MyMind || !root.MyMind.loadJSON) return;
    var next;
    try { next = JSON.stringify(h.map); } catch (e) { return; }
    var cur;
    try { cur = JSON.stringify(mapJson()); } catch (e) { cur = ''; }
    if (next === cur || next === lastSent) return;
    if (root.MMSave && root.MMSave.applying) root.MMSave.applying(true);
    try { root.MyMind.loadJSON(h.map); } catch (e) {}
    if (root.MMSave && root.MMSave.applying) root.MMSave.applying(false);
    if (root.MMSave && root.MMSave.paintEmpty) root.MMSave.paintEmpty();
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
      roomRead = true;
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
    if (on) return;
    if (!root.gifos || !root.gifos.db) return;
    if (!PEOPLE) return;
    try { room = root.gifos.db('room'); } catch (e) { return; }
    if (!room || !room.subscribe) return;
    on = true;
    readRoom().then(function () {
      if (me.id) publish();
    }).catch(function () {});
    room.subscribe(function (rows) {
      lastList = rows || [];
      applyHost(live(lastList));
    });
    setInterval(readRoom, PEOPLE_MS);
  }

  root.MMMp = {
    start: start,
    noteChange: function () { if (on) { lastPub = 0; publish(); } },
    _hostOf: hostOf,
    _live: live,
    _statusOf: statusOf
  };

  root['__my-mind'] = {
    state: function () {
      var players = live(lastList);
      var h = hostOf(players);
      if (!h || !h.map) return null;
      var sig;
      try { sig = JSON.stringify(h.map).length; } catch (e) { sig = 0; }
      return { host: h.id, bytes: sig | 0 };
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

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'mymind-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(typeof window !== 'undefined' ? window : this);
