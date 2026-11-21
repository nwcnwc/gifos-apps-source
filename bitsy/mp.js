/*
 * Share the world — one world-writing, everyone walking in it.
 *
 * Shared (round, world) so every device loads the same room. Each player
 * publishes the world on THEIR own row. Nobody writes anybody else's row.
 * Everyone adopts the app owner's writing on the current round (else lowest id).
 *
 * Invite is OS chrome. This file never draws a share sheet.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Bitsy needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var MAX = 80000;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var declined = false;
  var myWorld = '';
  var round = 1;
  var usedWorld = null;
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
        world: p.world,
        round: p.round
      });
    });
    return out;
  }

  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.world != null; });
    if (!cand.length) return null;
    // App owner is the shared-world authority when their row is on this round.
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
      world: String(a.world).slice(0, MAX),
      by: a.id
    };
  }

  function snapshot() {
    return {
      id: me.id,
      world: myWorld,
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
    usedWorld = ad.world;
    usedRound = ad.round;
    round = ad.round;
    if (ad.by !== me.id) myWorld = ad.world;
    if (root.BitsyApp) root.BitsyApp.playWorld(ad.world);
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
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Friend')) + '</span>' +
        '<span class="meta">' + (mine ? 'sharing' : 'looking') + '</span>' +
        '</li>';
    });
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!status) return;
    if (!others.length) {
      status.textContent = 'Waiting for a friend… press Invite (GifOS menu) to send the link. You can still walk and make — they start from this world.';
    } else if (others.length === 1) {
      status.textContent = (others[0].name || 'Friend') + ' is here. Change the world — they see it.';
    } else {
      status.textContent = others.length + ' friends here. Change the world — everyone sees it.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.world !== usedWorld || ad.round !== usedRound)) {
      applyWorld(ad);
    }
    renderMp();
  }

  // Subscribed, not seated: the room is read for company, and enter() runs only
  // when gifos.people() shows someone else (an Invite joiner sees the host
  // immediately). enter() reuses this subscription, so there is only ever one.
  function watch() {
    api = root.gifos;
    if (!api || !api.db) return;
    if (!PEOPLE) return;
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
      if (s) s.textContent = 'Share the world needs a GifOS room.';
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
      myWorld = root.BitsyApp ? root.BitsyApp.current() : '';
      round = 1;
      usedWorld = null;
      usedRound = 0;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (!usedWorld) applyWorld({
        world: myWorld,
        round: round,
        by: me.id
      });
      else publish();
    }).catch(function () {});
    return true;
  }

  function leave() {
    on = false;
    declined = true;   // "← Solo" means solo; watch() must not seat us again
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('shareBtn').hidden = false;
    if (room && me.id) room.delete(me.id).catch(function () {});
  }

  function onApply(data) {
    if (!on) return false;
    myWorld = String(data || '').slice(0, MAX);
    round = (usedRound || round || 1) + 1;
    applyWorld({
      world: myWorld,
      round: round,
      by: me.id
    });
    if (root.BitsyApp) root.BitsyApp.persist();
    return true;
  }

  root.BitsyMp = {
    enter: enter,
    leave: leave,
    onApply: onApply,
    busy: function () { return on; }
  };

  root['__bitsy'] = {
    state: function () {
      return { round: on ? ((usedRound || round || 0) | 0) : 0 };
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () { return on && owner && live(lastList).length > 1; }
  };

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });

  // A joiner who arrived through Invite is already in a room and should sit
  // down without being asked; a solo player never should. Those two cases look
  // identical from in here, so this used to enter() unconditionally 400ms after
  // boot — which put EVERY solo player in a room they never asked for, hid the
  // Share button they were told to press, and left "Waiting for a friend…"
  // across the top of the app forever. watch() subscribes without joining and
  // sits down only once somebody else is actually on the row.
  watch();
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'bitsy-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
