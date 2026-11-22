// Shared freehand board.
//
// Each player writes paint strokes on THEIR own row. The app owner applies legal strokes onto the board row.
// Who is here is gifos.people(). Nobody writes anybody else's
// row. Invite is OS chrome. This file never draws an Invite button.
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Paint Board needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PUB_MS = 120;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var declined = false;
  var KINDS = {
    basic: 1, rainbow: 1, stars: 1, crayon: 1, pixels: 1, stripe: 1,
    web: 1, mesh: 1, dots: 1, wave: 1, thorn: 1, erase: 1
  };
  var MAX_PENDING = 48;
  var MAX_BOARD = 400;
  var MAX_PTS = 800;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var pubTimer = 0;
  var lastList = [];
  var myN = 0;
  var pending = [];
  var lastBoard = null;
  var lastPacked = '';
  var lastLocal = null;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function legalColor(c) {
    return typeof c === 'string' && c.length <= 16 && /^#[0-9a-fA-F]{3,8}$/.test(c);
  }
  function legalStroke(s) {
    if (!s || !KINDS[s.k]) return false;
    if (!(s.w > 0) || s.w > 48) return false;
    if (!legalColor(s.c)) return false;
    if (s.cs) {
      if (!Array.isArray(s.cs) || s.cs.length > 8) return false;
      var i;
      for (i = 0; i < s.cs.length; i++) if (!legalColor(s.cs[i])) return false;
    }
    var p = s.p;
    if (!Array.isArray(p) || p.length < 2 || p.length > MAX_PTS || (p.length % 2)) return false;
    var j;
    for (j = 0; j < p.length; j++) {
      if (p[j] !== (p[j] | 0) || p[j] < 0 || p[j] > 999) return false;
    }
    return true;
  }
  function cleanStroke(s) {
    var out = { n: s.n | 0, k: s.k, c: s.c, w: +s.w, p: s.p.slice(), seed: (s.seed >>> 0) };
    if (s.cs && s.cs.length) out.cs = s.cs.slice();
    return out;
  }
  function packStr(list) {
    return JSON.stringify((list || []).map(function (s) {
      return { k: s.k, c: s.c, w: s.w, p: s.p, seed: s.seed, cs: s.cs };
    }));
  }
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
      if (!p || !p.id || p.id === 'board') return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Friend' }));
    });
    return out;
  }
  function isHost(people) {
    return !!(PEOPLE && owner);
  }
  function boardOf(list) {
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'board') return list[i];
    }
    return null;
  }

  function snapshot(extra) {
    var row = {
      id: me.id,
      n: myN,
      pending: pending.slice()
    };
    if (extra) {
      if (extra.pending) row.pending = extra.pending;
      if (extra.wipe) row.wipe = extra.wipe;
    }
    return row;
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    room.put(snapshot()).catch(function () {});
  }
  function schedulePublish() {
    if (pubTimer) return;
    pubTimer = setTimeout(function () {
      pubTimer = 0;
      publish();
    }, PUB_MS);
  }

  function putBoard(c) {
    if (!PEOPLE || !owner) return;
    lastBoard = c;
    // board row has no idle heartbeat
    delete c.at;
    room.put(c).catch(function () {});
  }

  function freshBoard(hostId) {
    var strokes = (lastLocal && lastLocal.length) ? lastLocal.slice() : [];
    return {
      id: 'board',
      host: hostId,
      strokes: strokes,
      seq: 0,
      applied: {},
      wipeN: {}
    };
  }

  function applyBoard(strokes) {
    if (!root.PaintBoard || !root.PaintBoard.replace) return;
    var next = (strokes || []).slice();
    pending.forEach(function (s) {
      if (legalStroke(s)) next.push(s);
    });
    var packed = packStr(next);
    if (packed === lastPacked) {
      lastLocal = next;
      return;
    }
    lastPacked = packed;
    lastLocal = next;
    root.PaintBoard.replace(next);
  }

  function reconcile(B, people) {
    var c = {
      id: 'board',
      host: me.id,
      strokes: (B.strokes && B.strokes.length) ? B.strokes.slice() : [],
      seq: B.seq || 0,
      applied: B.applied ? Object.assign({}, B.applied) : {},
      wipeN: B.wipeN ? Object.assign({}, B.wipeN) : {}
    };
    var ch = c.host !== B.host;
    people.forEach(function (p) {
      var last = c.applied[p.id] || 0;
      var wipe = p.wipe || 0;
      if (wipe && wipe > (c.wipeN[p.id] || 0)) {
        c.strokes = [];
        c.wipeN[p.id] = wipe;
        c.seq = (c.seq || 0) + 1;
        ch = true;
      }
      (p.pending || []).forEach(function (s) {
        if (!s || s.n <= last) return;
        if (!legalStroke(s)) return;
        c.strokes.push(cleanStroke(s));
        last = s.n;
        ch = true;
      });
      if (c.strokes.length > MAX_BOARD) c.strokes = c.strokes.slice(-MAX_BOARD);
      if (last !== (c.applied[p.id] || 0)) {
        c.applied[p.id] = last;
        c.seq = (c.seq || 0) + 1;
        ch = true;
      }
    });
    return ch ? c : null;
  }

  function dropSpent(board) {
    if (!board) return;
    var last = (board.applied && board.applied[me.id]) || 0;
    var wipeLast = (board.wipeN && board.wipeN[me.id]) || 0;
    var kept = pending.filter(function (s) { return s.n > last; });
    var dropped = kept.length !== pending.length || (wipeLast && wipeLast >= myN && pending.length);
    if (dropped) {
      pending = kept;
      schedulePublish();
    }
  }

  function onStroke(stroke) {
    if (!on) return;
    if (!legalStroke(stroke)) return;
    myN += 1;
    pending.push(cleanStroke(Object.assign({ n: myN }, stroke)));
    lastLocal = (lastLocal || []).concat([stroke]);
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
    schedulePublish();
  }

  function render() {
    if (!on) return;
    var people = live(lastList);
    var status = $('friend-status');
    var roster = $('friend-roster');
    var html = '';
    people.sort(function (a, b) {
      var an = a.name || '', bn = b.name || '';
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    people.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + '" data-id="' + esc(p.id) + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + (p.n || 0) + ' strokes</span></li>';
    });
    roster.innerHTML = html || '<li>Just you so far</li>';
    var others = people.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      status.textContent = 'Waiting for a friend… press Invite (GifOS menu) to send the link. You can paint in the meantime.';
    } else {
      status.textContent = 'One board. Everyone paints. ' + others.length + ' with you.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var people = live(lastList);
    var board = boardOf(lastList);
    if (!board) {
      if (isHost(people)) putBoard(freshBoard(me.id));
      render();
      return;
    }
    lastBoard = board;
    if (isHost(people)) {
      var next = reconcile(board, people);
      if (next) {
        putBoard(next);
        board = next;
      }
    }
    dropSpent(board);
    applyBoard(board.strokes || []);
    render();
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
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && !on && !declined) {
        var n = 0, id, names = peopleNames();
        for (id in names) if (id !== me.id) n++;
        if (n > 0) enter();
      } else if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else maybeEnterFromPeople();
      }
    }, function () {});
  }
  function maybeEnterFromPeople() {
    if (on || declined || !PEOPLE) return;
    var names = peopleNames(), id, n = 0;
    for (id in names) { if (id !== me.id) n++; }
    if (n > 0) enter();
  }
  function watch() {
    api = root.gifos;
    if (!api || !api.db || !PEOPLE) return;
    room = room || api.db('room');
    readRoom().then(function () {
      if (subscribed) return;
      subscribed = true;
      room.subscribe(function (list) {
        lastList = list || [];
        if (on) { onRoom(lastList); return; }
        if (declined) return;
        maybeEnterFromPeople();
      });
      setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = 'Sharing needs a GifOS room.';
      return;
    }
    if (!PEOPLE) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = NEEDS_NEWER;
      return;
    }
    if (on) return;
    declined = false;
    room = room || api.db('room');
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      pending = [];
      myN = 0;
      lastPacked = '';
      lastBoard = null;
      if (root.PaintBoard.flushSave) root.PaintBoard.flushSave();
      lastLocal = root.PaintBoard.pack ? root.PaintBoard.pack() : [];
      root.PaintBoard.mp = true;
      document.body.classList.add('together');
      $('friend-bar').hidden = false;
      $('friend-hint').textContent = 'Press Invite (GifOS menu) to send the link. Everyone paints on the same board.';
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      publish();
    }).catch(function () {});
  }

  function leave() {
    on = false;
    declined = true;
    pending = [];
    root.PaintBoard.mp = false;
    document.body.classList.remove('together');
    $('friend-bar').hidden = true;
    if (pubTimer) { clearTimeout(pubTimer); pubTimer = 0; }
    if (room && me.id) room.delete(me.id).catch(function () {});
    if (root.PaintBoard.restoreSave) root.PaintBoard.restoreSave();
  }

  function wipe() {
    if (!on) return;
    myN += 1;
    pending = [];
    lastLocal = [];
    lastPacked = packStr([]);
    room.put(snapshot({ wipe: myN, pending: [] })).catch(function () {});
    if (root.PaintBoard && root.PaintBoard.empty) root.PaintBoard.empty();
  }

  root.PaintBoard = root.PaintBoard || {};
  root.PaintBoard.Mp = {
    enter: enter,
    leave: leave,
    wipe: wipe,
    onStroke: onStroke,
    isOn: function () { return on; },
    isHost: isHost
  };

  root['__paint-board'] = {
    state: function () {
      var b = boardOf(lastList);
      if (!b) return null;
      return { seq: b.seq | 0, strokes: (b.strokes || []).length };
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
    _n.id = 'paint-board-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
})(window);
