(function (root) {
  'use strict';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'LRC Maker needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var api = null, room = null, me = { id: null, name: 'You' };
  var on = false, peopleTimer = 0, round = 1, usedRound = 0, usedKey = '', lastList = [], lastPub = 0;
  var roomPeople = [], roomKey = '', owner = false, roomRead = false, acted = false;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
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
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') n++;
    }
    return n;
  }
  function keyOf(lines) { return JSON.stringify(lines || []).slice(0, 2000); }
  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!names[p.id]) return;
      out.push(p);
    });
    return out;
  }
  function adopted(list) {
    var players = live(list); if (!players.length) return null;
    var maxR = 0; players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.lines; });
    if (!cand.length) return null;
    if (owner && me.id) {
      var i, mine = null;
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { mine = cand[i]; break; }
      if (mine) return { round: maxR, lines: mine.lines, cur: mine.cur || 0, by: mine.id };
    }
    cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { round: maxR, lines: cand[0].lines, cur: cand[0].cur || 0, by: cand[0].id };
  }
  function snapshot() {
    return { id: me.id, round: round, lines: root.LRCApp.getLines(), cur: 0 };
  }
  function publish() {
    if (!PEOPLE || !on || !room || !me.id || !acted) return;
    var t = now(); if (t - lastPub < 80) return; lastPub = t;
    room.put(snapshot()).catch(function () {});
  }
  function applyWorld(ad) {
    usedRound = ad.round; usedKey = keyOf(ad.lines); round = ad.round;
    root.LRCApp.setLines(ad.lines, ad.cur);
    // absorb remote — do not re-publish
  }
  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var names = peopleNames();
    var html = '';
    players.sort(function (a, b) { return (names[a.id] || '').localeCompare(names[b.id] || ''); });
    players.forEach(function (p) {
      html += '<li class="' + (p.id === me.id ? 'me' : '') + '"><span class="name">' +
        (p.id === me.id ? 'You' : esc(names[p.id] || 'Friend')) + '</span><span class="meta">lyrics</span></li>';
    });
    var scores = $('friend-scores'); if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';
    var others = players.filter(function (p) { return p.id !== me.id; });
    var status = $('friend-status'); if (!status) return;
    if (!others.length) status.textContent = 'Waiting for a friend… Invite sends the link. They get the lyrics, not the song file.';
    else status.textContent = others.length === 1 ? (names[others[0].id] || 'Friend') + ' has the same lyrics.' : others.length + ' friends on the lyrics.';
  }
  function onRoom(list) {
    lastList = list || []; if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.round !== usedRound || keyOf(ad.lines) !== usedKey)) applyWorld(ad);
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
      var handed = !owner && !!info.owner && roomRead;
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && !on) enter(true);
      else if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else if (peopleCount() > 1) enter(false);
      }
    }, function () {});
  }
  function enter(fromAct) {
    api = root.gifos;
    if (!api || !api.db) { $('friend-bar').hidden = false; $('friend-status').textContent = 'Play together needs a GifOS room.'; return true; }
    if (!PEOPLE) { $('friend-bar').hidden = false; $('friend-status').textContent = NEEDS_NEWER; return true; }
    if (on) return true;
    room = api.db('room');
    readRoom().then(function () {
      on = true; document.body.classList.add('friend');
      $('friend-bar').hidden = false; $('shareBtn').hidden = true;
      round = 1; usedRound = 0; usedKey = ''; acted = false;
      if (!room._lrSub) { room._lrSub = true; room.subscribe(onRoom); }
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
      // No publish on enter (K3).
      renderMp();
    }).catch(function () {});
    return true;
  }
  function leave() {
    on = false; document.body.classList.remove('friend');
    $('friend-bar').hidden = true; $('shareBtn').hidden = false;
    if (peopleTimer) { clearInterval(peopleTimer); peopleTimer = 0; }
    if (room && me.id) room.delete(me.id).catch(function () {});
  }
  if ($('shareBtn')) {
    if (!PEOPLE) { $('shareBtn').disabled = true; $('shareBtn').title = NEEDS_NEWER; }
    $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(true); });
  }
  if ($('leaveBtn')) $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  root.LRMp = {
    busy: function () { return on; }, leave: leave,
    onStamp: function (i, t) {
      if (!on) return false;
      root.LRCApp.stampAt(i, t); round += 1; acted = true; lastPub = 0; publish(); return true;
    }
  };
  root['__lrc-maker'] = {
    state: function () {
      var ad = adopted(lastList);
      return ad ? { round: ad.round | 0 } : null;
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () { return PEOPLE && owner && peopleCount() > 1 && on; }
  };
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'lrc-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  } else if (root.gifos && root.gifos.db) {
    api = root.gifos;
    room = api.db('room');
    readRoom().then(function () {
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
    });
  }
})(window);
