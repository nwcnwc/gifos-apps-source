/*
 * Share the jar — one mix, everyone stirs.
 *
 * Shared (round, seed, colors, count) so every device starts the same jar.
 * Each player publishes a poke on THEIR own row. Nobody writes anybody
 * else's row. Everyone adopts the app owner's seed on the current round
 * (else lowest id). Who is here is gifos.people().
 *
 * Invite is OS chrome. This file never draws a share sheet.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Particle Life needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 250;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PL = root.ParticleLife;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var declined = false;
  var mySeed = 0;
  var round = 1;
  var usedSeed = null;
  var usedRound = 0;
  var usedColors = 0;
  var usedCount = 0;
  var lastList = [];
  var pokeSeq = 0;
  var lastPoke = null;
  var applied = {};
  var lastPub = 0;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var peopleTimer = 0;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function newSeed() { return (Math.random() * 0x100000000) >>> 0; }

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
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.seed != null; });
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
      seed: a.seed,
      colors: a.colors || 4,
      count: a.count || 180,
      by: a.id
    };
  }

  function snapshot() {
    var row = {
      id: me.id,
      seed: mySeed,
      round: round,
      colors: PL.settings.numColors,
      count: PL.settings.atoms.count,
      pokeSeq: pokeSeq
    };
    if (lastPoke) {
      row.px = lastPoke.x;
      row.py = lastPoke.y;
      row.ps = lastPoke.sign;
    }
    return row;
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }

  function applyWorld(ad) {
    usedSeed = ad.seed;
    usedRound = ad.round;
    usedColors = ad.colors;
    usedCount = ad.count;
    round = ad.round;
    if (ad.by !== me.id) mySeed = ad.seed;
    PL.settings.numColors = ad.colors;
    PL.settings.atoms.count = ad.count;
    PL.setSeed(ad.seed);
    var colors = $('colors');
    var count = $('count');
    if (colors) colors.value = String(ad.colors);
    if (count) {
      count.value = String(ad.count);
      if ($('countN')) $('countN').textContent = String(ad.count);
    }
    if (root.PLApp) root.PLApp.paintSeed();
    lastPub = 0;
    publish();
  }

  function applyPokes(players) {
    players.forEach(function (p) {
      if (!p.id || p.id === me.id) return;
      if (p.pokeSeq == null || p.px == null || p.py == null) return;
      var last = applied[p.id] || 0;
      if (p.pokeSeq <= last) return;
      applied[p.id] = p.pokeSeq;
      PL.poke(p.px * PL.WORLD_W, p.py * PL.WORLD_H, p.ps < 0 ? -1 : 1);
    });
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
        '<span class="meta">' + (mine && lastPoke ? 'stirring' : (p.pokeSeq ? 'in the jar' : 'watching')) + '</span>' +
        '</li>';
    });
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!status) return;
    if (!others.length) {
      status.textContent = 'Waiting for a friend… Invite sends the link. You can stir — they start from the same mix.';
    } else if (others.length === 1) {
      status.textContent = (others[0].name || 'Friend') + ' is in the jar. Tap to stir — they see it.';
    } else {
      status.textContent = others.length + ' friends in the jar. Tap to stir — everyone sees it.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.seed !== usedSeed || ad.round !== usedRound || ad.colors !== usedColors || ad.count !== usedCount)) {
      applyWorld(ad);
    }
    applyPokes(live(lastList));
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
      if (!peopleTimer) peopleTimer = setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      var s = $('friend-status');
      if (s) s.textContent = 'Share the jar needs a GifOS room.';
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
      mySeed = PL.getSeed();
      if (!mySeed) mySeed = newSeed();
      round = 1;
      usedSeed = null;
      usedRound = 0;
      usedColors = 0;
      usedCount = 0;
      pokeSeq = 0;
      lastPoke = null;
      applied = {};
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (!usedSeed) applyWorld({
        seed: mySeed,
        round: round,
        colors: PL.settings.numColors,
        count: PL.settings.atoms.count,
        by: me.id
      });
      else publish();
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

  function onPoke(nx, ny, sign) {
    if (!on) return;
    pokeSeq += 1;
    lastPoke = { x: nx, y: ny, sign: sign < 0 ? -1 : 1 };
    lastPub = 0;
    publish();
  }

  function onNewMix() {
    if (!on) return false;
    mySeed = newSeed();
    round = (usedRound || round || 1) + 1;
    pokeSeq = 0;
    lastPoke = null;
    applied = {};
    applyWorld({
      seed: mySeed,
      round: round,
      colors: PL.settings.numColors,
      count: PL.settings.atoms.count,
      by: me.id
    });
    return true;
  }

  function onRecipe(chg) {
    if (!on) return false;
    if (chg && chg.colors != null) PL.settings.numColors = chg.colors | 0;
    if (chg && chg.count != null) PL.settings.atoms.count = chg.count | 0;
    round = (usedRound || round || 1) + 1;
    applyWorld({
      seed: mySeed || PL.getSeed() || newSeed(),
      round: round,
      colors: PL.settings.numColors,
      count: PL.settings.atoms.count,
      by: me.id
    });
    return true;
  }

  function onReset() {
    return onNewMix();
  }

  root.PLMp = {
    enter: enter,
    leave: leave,
    onPoke: onPoke,
    onNewMix: onNewMix,
    onRecipe: onRecipe,
    onReset: onReset,
    busy: function () { return on; }
  };

  root['__particle-life'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, seed: ad.seed >>> 0 };
      return on ? { round: (usedRound || round || 0) | 0, seed: (usedSeed || mySeed || 0) >>> 0 } : null;
    },
    people: function () {
      if (api && PEOPLE) readRoom();
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      if (api && PEOPLE) readRoom();
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return PEOPLE && owner && n > 1;
    }
  };

  $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'particle-life-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }
})(window);
