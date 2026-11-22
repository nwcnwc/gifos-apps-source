/*
 * Meeting wall — lean cards in room (hot, subscribed).
 * Full boards in their own collection, loaded with get(), never subscribed.
 * Who is here is gifos.people(). Cards are shared. No presence heartbeat.
 * Invite is OS chrome. This file never draws a share sheet.
 */
(function (root) {
  'use strict';

  var S = root.Sandspiel;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Sandspiel needs a newer GifOS to share the wall. Reload the page to update. Solo works on this device.';
  var api = null;
  var room = null;
  var boards = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var lastList = [];
  var roomPeople = [];
  var roomKey = '';
  var owner = false;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function liveHere() {
    var names = peopleNames(), out = [], id;
    for (id in names) {
      out.push({ id: id, name: names[id], kind: 'here' });
    }
    return out;
  }

  function cardsOf(list) {
    return (list || []).filter(function (p) { return p && p.id && p.kind === 'card'; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  function renderMp() {
    if (!on) return;
    var players = liveHere();
    var status = $('friend-status');
    var scores = $('friend-scores');
    var html = '';
    players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Friend')) + '</span>' +
        '<span class="meta">here</span></li>';
    });
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (status) {
      if (!PEOPLE) {
        status.textContent = NEEDS_NEWER;
      } else if (!others.length) {
        status.textContent = 'Waiting for a friend… Invite sends the link. Put a board on the wall while you wait.';
      } else if (others.length === 1) {
        status.textContent = (others[0].name || 'Friend') + ' is on the wall. Put a board up — they see the card.';
      } else {
        status.textContent = others.length + ' friends on the wall. Put a board up — everyone sees the card.';
      }
    }
    paintWall();
  }

  function paintWall() {
    var box = $('wall');
    if (!box) return;
    var cards = cardsOf(lastList);
    box.textContent = '';
    cards.forEach(function (c) {
      var b = document.createElement('button');
      var cv = document.createElement('canvas');
      var t = document.createElement('span');
      var a = document.createElement('span');
      b.type = 'button';
      b.className = 'card';
      cv.width = S.THUMB_W;
      cv.height = S.THUMB_H;
      S.paintThumb(cv, c.thumb);
      t.className = 't';
      t.textContent = c.title || 'Board';
      a.className = 'a';
      a.textContent = c.authorId === me.id ? 'You' : (c.author || 'Friend');
      b.appendChild(cv);
      b.appendChild(t);
      b.appendChild(a);
      b.addEventListener('click', function () { openCard(c.id); });
      box.appendChild(b);
    });
  }

  function openCard(id) {
    if (!boards || !id || !root.SandApp) return;
    boards.get(id).then(function (rec) {
      if (!rec || !rec.cells) return;
      root.SandApp.loadPacked(rec.w || S.WIDTH, rec.h || S.HEIGHT, rec.cells);
      root.SandApp.setPaused(true);
    }).catch(function (err) {
      if (root.SandApp && root.SandApp.note) {
        root.SandApp.note((err && err.message) || 'Could not open that board.');
      }
    });
  }

  function putOnWall() {
    if (!on || !room || !boards || !root.SandApp || !me.id || !PEOPLE) return;
    var title = ($('wallTitle').value || '').trim() || 'Board';
    var id = 'b_' + String(me.id).slice(0, 8) + '_' + now().toString(36);
    var packed = root.SandApp.pack();
    var uni = root.SandApp.universe();
    boards.put({
      id: id,
      w: uni.width,
      h: uni.height,
      cells: packed
    }).then(function () {
      return room.put({
        id: id,
        kind: 'card',
        title: title.slice(0, 48),
        author: me.name,
        authorId: me.id,
        at: now(),
        thumb: root.SandApp.thumb()
      });
    }).then(function () {
      $('wallTitle').value = '';
    }).catch(function (err) {
      if (root.SandApp && root.SandApp.note) {
        root.SandApp.note((err && err.message) || 'Could not put this board on the wall.');
      }
    });
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    renderMp();
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (on) renderMp();
      }
    }, function () {});
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      var s = $('friend-status');
      if (s) s.textContent = 'Play together needs a GifOS room.';
      return true;
    }
    if (!PEOPLE) {
      $('friend-bar').hidden = false;
      var s2 = $('friend-status');
      if (s2) s2.textContent = NEEDS_NEWER;
      return true;
    }
    if (on) return true;
    room = api.db('room');
    boards = api.db('boards');
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      document.body.classList.add('friend');
      $('friend-bar').hidden = false;
      $('shareBtn').hidden = true;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      renderMp();
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
    return true;
  }

  function leave() {
    on = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('shareBtn').hidden = false;
  }

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  $('putBtn').addEventListener('click', function (e) { e.preventDefault(); putOnWall(); });

  if (PEOPLE && root.gifos && root.gifos.info) {
    root.gifos.info().then(function (i) {
      if (!on && i && i.owner === false) enter();
    }).catch(function () {});
  }

  root.SandWall = { enter: enter, leave: leave, busy: function () { return on; } };

  root['__sandspiel'] = {
    state: function () { return on ? { cards: cardsOf(lastList).length } : null; },
    people: function () { return liveHere().map(function (p) { return p.id; }); },
    amHost: function () { return on && owner && peopleCount() > 1; }
  };
})(window);
