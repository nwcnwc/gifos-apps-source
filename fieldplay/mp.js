/*
 * Share the field — one GLSL recipe, everyone looking at it.
 * Each player publishes the field on THEIR own row. Nobody writes
 * anybody else's row. Everyone adopts the app owner's recipe on the
 * current round (else lowest id). Who is here is gifos.people().
 * Invite is OS chrome. This file never draws a share sheet.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Field Play needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var MAX = 8000;
  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var declined = false;
  var myCode = '';
  var round = 1;
  var usedCode = null;
  var usedRound = 0;
  var lastList = [];
  var lastPub = 0;
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

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push({
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        code: p.code,
        round: p.round,
        st: p.st || null
      });
    });
    return out;
  }

  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.code != null; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return { round: maxR, code: String(a.code).slice(0, MAX), by: a.id, st: a.st || null };
  }

  function snapshot() {
    var st = root.FieldPlay.getState();
    return {
      id: me.id,
      code: myCode,
      round: round,
      st: { timeStep: st.timeStep, fadeOut: st.fadeOut, dropProbability: st.dropProbability,
            colorMode: st.colorMode, cx: st.cx, cy: st.cy, w: st.w, h: st.h }
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
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

  function applyWorld(ad) {
    usedCode = ad.code;
    usedRound = ad.round;
    round = ad.round;
    if (ad.by !== me.id) myCode = ad.code;
    if (ad.st) root.FieldPlay.setSettings(ad.st);
    root.FieldPlay.reset();
    var r = root.FieldPlay.setCode(ad.code);
    if ($('recipe')) $('recipe').value = ad.code;
    if (root.FPApp) {
      root.FPApp.paintWhich();
      root.FPApp.paintSliders();
    }
    lastPub = 0;
    publish();
    return r;
  }

  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var html = '';
    players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Friend')) + '</span>' +
        '<span class="meta">' + (p.code ? 'in the field' : 'watching') + '</span></li>';
    });
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!status) return;
    if (!others.length) {
      status.textContent = 'Waiting for a friend… Invite sends the link. You can still edit the field.';
    } else if (others.length === 1) {
      status.textContent = (others[0].name || 'Friend') + ' is looking at the same field. Apply a recipe — they see it.';
    } else {
      status.textContent = others.length + ' friends in the field. Apply a recipe — everyone sees it.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.code !== usedCode || ad.round !== usedRound)) applyWorld(ad);
    renderMp();
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
    declined = false;
    room = room || api.db('room');
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      document.body.classList.add('friend');
      $('friend-bar').hidden = false;
      $('shareBtn').hidden = true;
      myCode = root.FieldPlay.getState().code;
      round = 1;
      usedCode = null;
      usedRound = 0;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      lastPub = 0;
      publish();
    }).catch(function () {});
    return true;
  }

  function leave() {
    on = false;
    declined = true;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('shareBtn').hidden = false;
    if (room && me.id) room.delete(me.id).catch(function () {});
  }

  function bump(code) {
    myCode = String(code || '').slice(0, MAX);
    round += 1;
    lastPub = 0;
    publish();
  }

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });

  root.FPMp = {
    busy: function () { return on; },
    leave: leave,
    onApply: function (code) {
      if (!on) return false;
      bump(code);
      root.FieldPlay.setCode(code);
      if (root.FPApp) root.FPApp.paintWhich();
      return true;
    },
    onPreset: function (p) {
      if (!on) return false;
      root.FieldPlay.applyPreset(p);
      if ($('recipe')) $('recipe').value = p.code;
      bump(p.code);
      if (root.FPApp) { root.FPApp.paintWhich(); root.FPApp.paintSliders(); }
      return true;
    },
    onReset: function () {
      if (!on) return false;
      root.FieldPlay.reset();
      lastPub = 0;
      publish();
      return true;
    }
  };

  root['__fieldplay'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0 };
      return on ? { round: (usedRound || round || 0) | 0 } : null;
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

  watch();
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'fp-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
