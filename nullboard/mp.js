/* Optional meeting: the same board on everyone else's screen.
 * Each person writes THEIR own row. The app owner hosts the live board
 * (else lowest id). Who is here is gifos.people(). Invite is OS chrome. */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Nullboard needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var guest = false;
  var applying = false;
  var lastSent = '';
  var lastList = [];
  var pubTimer = 0;
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
      out.push(p);
    });
    return out;
  }

  function hostOf(players) {
    if (!players.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < players.length; i++) if (players[i].id === me.id && players[i].board) { a = players[i]; break; }
    }
    if (a) return a;
    var withBoard = players.filter(function (p) { return p && p.board; });
    if (!withBoard.length) return null;
    a = withBoard[0];
    for (i = 1; i < withBoard.length; i++) {
      if (withBoard[i].id < a.id) a = withBoard[i];
    }
    return a;
  }

  // Kept for tests that still call _newest — now owner (else lowest id).
  function newest(players) { return hostOf(players); }

  function boardJson() {
    try { return root.NB && root.NB.board ? JSON.parse(JSON.stringify(root.NB.board)) : null; } catch (e) { return null; }
  }

  function snapshot() {
    return { id: me.id, board: boardJson() };
  }

  function publish() {
    if (!on || !room || !me.id || applying || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    var s = snapshot();
    if (!s.board) return;
    var packed;
    try { packed = JSON.stringify(s.board); } catch (e) { return; }
    lastSent = packed;
    room.put(s).catch(function () {});
  }

  function noteChange() {
    if (!on) return;
    if (pubTimer) clearTimeout(pubTimer);
    pubTimer = setTimeout(function () { pubTimer = 0; lastPub = 0; publish(); }, 280);
  }

  function statusOf(players) {
    var others = players.filter(function (p) { return p.id !== me.id; });
    var el = typeof document !== 'undefined' ? document.getElementById('meet') : null;
    if (!el) return;
    if (!others.length) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    var names = others.map(function (p) { return peopleNames()[p.id] || p.name || 'a friend'; });
    if (names.length === 1) el.textContent = names[0] + ' is on this board.';
    else el.textContent = names.join(', ') + ' are on this board.';
  }

  function applyRemote(row) {
    if (!row || !row.board || !root.NB) return;
    if (row.id === me.id) return;
    var next;
    try { next = JSON.stringify(row.board); } catch (e) { return; }
    if (next === lastSent) return;
    var cur;
    try { cur = JSON.stringify(boardJson()); } catch (e) { cur = ''; }
    if (next === cur) return;
    applying = true;
    lastSent = next;
    try {
      if (typeof $ !== 'undefined') $('.board .edit').each(function () {
        if (this === document.activeElement) this.blur();
      });
      root.NB.board = row.board;
      if (root.NB.storage && root.NB.storage.setActiveBoard) {
        try { root.NB.storage.saveBoard(row.board); } catch (e) {}
        root.NB.board = row.board;
      }
      if (typeof root.showBoard === 'function') root.showBoard(true);
    } catch (e) {}
    applying = false;
  }

  function onList(rows) {
    lastList = rows || [];
    var players = live(lastList);
    statusOf(players);
    var n = hostOf(players);
    guest = !!(n && n.id !== me.id);
    if (n) applyRemote(n);
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
        if (on) onList(lastList);
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
      room.subscribe(onList);
      publish();
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  root.NBMp = {
    start: start,
    noteChange: noteChange,
    applying: function () { return applying; },
    _newest: newest,
    _live: live
  };

  root['__nullboard'] = {
    state: function () {
      var h = hostOf(live(lastList));
      if (!h || !h.board) return null;
      var n = 0;
      try { n = JSON.stringify(h.board).length; } catch (e) { n = 0; }
      return { host: h.id, bytes: n | 0 };
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
    _n.id = 'nullboard-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(typeof window !== 'undefined' ? window : this);
