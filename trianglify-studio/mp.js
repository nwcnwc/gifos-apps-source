/*
 * Share the wallpaper — one seed + palette, everyone looking at it.
 *
 * Shared (round, seed, palette, cell, variance, look, fill, sizeId) so every
 * device paints the same triangles. Each player publishes the recipe on
 * THEIR own row. Nobody writes anybody else's row. Everyone adopts the
 * app owner's recipe on the current round (else lowest id). Who is here
 * is gifos.people().
 *
 * Invite is OS chrome. This file never draws a share sheet.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Trianglify needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var SEED_MAX = 80;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var declined = false;
  var mine = null;
  var round = 1;
  var usedKey = null;
  var usedRound = 0;
  var lastList = [];
  var lastPub = 0;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function snapOf(s) {
    s = s || (root.TFApp && root.TFApp.current && root.TFApp.current()) || {};
    return {
      seed: String(s.seed || '').slice(0, SEED_MAX),
      palette: s.palette || 'YlGnBu',
      cell: s.cell | 0,
      variance: +s.variance,
      look: s.look || 'linear',
      fill: !!s.fill,
      stroke: +s.stroke || 0,
      sizeId: s.sizeId || 'hd'
    };
  }

  function keyOf(s) {
    return [s.seed, s.palette, s.cell, s.variance, s.look, s.fill ? 1 : 0, s.stroke, s.sizeId].join('|');
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
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Friend' }));
    });
    return out;
  }

  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.seed; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return {
      round: maxR,
      by: a.id,
      seed: String(a.seed).slice(0, SEED_MAX),
      palette: a.palette,
      cell: a.cell,
      variance: a.variance,
      look: a.look,
      fill: a.fill,
      stroke: a.stroke,
      sizeId: a.sizeId
    };
  }

  function snapshot() {
    var s = mine || snapOf();
    return {
      id: me.id,
      seed: s.seed,
      palette: s.palette,
      cell: s.cell,
      variance: s.variance,
      look: s.look,
      fill: s.fill,
      stroke: s.stroke,
      sizeId: s.sizeId,
      round: round
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }

  function applyWorld(ad) {
    usedKey = keyOf(ad);
    usedRound = ad.round;
    round = ad.round;
    if (ad.by !== me.id) mine = snapOf(ad);
    if (root.TFApp) root.TFApp.applyState(ad, true);
    lastPub = 0;
    publish();
  }

  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var html = '';
    players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    players.forEach(function (p) {
      var mineRow = p.id === me.id;
      html += '<li class="' + (mineRow ? 'me' : '') + '">' +
        '<span class="name">' + (mineRow ? 'You' : esc(p.name || 'Friend')) + '</span>' +
        '<span class="meta">' + (mineRow ? 'sharing' : 'looking') + '</span>' +
        '</li>';
    });
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!status) return;
    if (!others.length) {
      status.textContent = 'Waiting for a friend… press Invite (GifOS menu) to send the link. You can keep painting — they start from this wallpaper.';
    } else if (others.length === 1) {
      status.textContent = (others[0].name || 'Friend') + ' is looking. Change the wallpaper — they see it.';
    } else {
      status.textContent = others.length + ' friends looking. Change the wallpaper — everyone sees it.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (keyOf(ad) !== usedKey || ad.round !== usedRound)) {
      applyWorld(ad);
    }
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
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mineRow = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mineRow = ppl[i];
      if (mineRow) { me.id = mineRow.id; me.name = mineRow.name || 'You'; }
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
      var s = $('friend-status');
      if (s) s.textContent = 'Share the wallpaper needs a GifOS room.';
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
      mine = snapOf();
      round = 1;
      usedKey = null;
      usedRound = 0;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (!usedKey) applyWorld({
        round: round,
        by: me.id,
        seed: mine.seed,
        palette: mine.palette,
        cell: mine.cell,
        variance: mine.variance,
        look: mine.look,
        fill: mine.fill,
        stroke: mine.stroke,
        sizeId: mine.sizeId
      });
      else { lastPub = 0; publish(); }
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

  function onChange(next) {
    if (!on) return false;
    mine = snapOf(next);
    round = (usedRound || round || 1) + 1;
    applyWorld({
      round: round,
      by: me.id,
      seed: mine.seed,
      palette: mine.palette,
      cell: mine.cell,
      variance: mine.variance,
      look: mine.look,
      fill: mine.fill,
      stroke: mine.stroke,
      sizeId: mine.sizeId
    });
    if (root.TFApp) root.TFApp.persist();
    return true;
  }

  root.TFMp = {
    enter: enter,
    leave: leave,
    onChange: onChange,
    busy: function () { return on; }
  };

  root['__trianglify-studio'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, seed: ad.seed || '', palette: ad.palette || '' };
      var s = mine || snapOf();
      return on ? { round: (usedRound || round || 0) | 0, seed: s.seed || '', palette: s.palette || '' } : null;
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return on && owner && n > 1;
    }
  };

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'tf-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }
})(window);
