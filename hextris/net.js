/*
 * Hextris — a race, not a shared hex.
 *
 * Shared seed so both players get the same sequence of falling blocks.
 * Each then plays THEIR hex and publishes score + stacks on THEIR row.
 * Nobody writes anybody else's row. Last one still stacking wins; if
 * both hexes fill, highest score among the stuck boards takes it.
 *
 * Who is here is gifos.people(); the app owner hosts the seed. Invite is OS chrome.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Hextris needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var peopleTimer = 0;
  var mySeed = 0;
  var round = 1;
  var usedSeed = null;
  var usedRound = 0;
  var lastList = [];
  var roundOver = false;
  var lastPub = 0;
  var lastScorePub = -1;

  var $id = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function newSeed() { return (Math.random() * 0x100000000) >>> 0; }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
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

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(p);
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
    return { round: maxR, seed: a.seed, by: a.id };
  }

  function snapshot() {
    return {
      id: me.id,
      seed: mySeed,
      round: round,
      score: root.score | 0,
      over: !!(root.HT && HT.over && HT.over()),
      stacks: (root.HT && HT.packStacks) ? HT.packStacks() : ''
    };
  }

  function publish(force) {
    if (!PEOPLE || !on || !room || !me.id) return;
    var t = now();
    if (!force && t - lastPub < 2000) return;
    if (force && t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }

  function applySeed(seed, r, doPut) {
    usedSeed = seed;
    usedRound = r;
    round = r;
    roundOver = false;
    root.HT.rng = mulberry32(seed >>> 0);
    var go = $id('gameoverscreen');
    if (go) go.style.display = 'none';
    if (typeof init === 'function') init(1);
    if (doPut) { lastPub = 0; publish(); }
    paintThem(null);
  }

  function verdict(players) {
    if (players.length < 2) return null;
    var alive = players.filter(function (p) { return !p.over; });
    if (alive.length === 1) return { kind: 'last', winner: alive[0] };
    if (alive.length > 1) return null;
    var ranked = players.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    if ((ranked[0].score || 0) === (ranked[1].score || 0)) return { kind: 'tie', a: ranked[0], b: ranked[1] };
    return { kind: 'score', winner: ranked[0] };
  }

  function pickOther(players) {
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!others.length) return null;
    others.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    return others[0];
  }

  function paintThem(p) {
    var wrap = $id('them-wrap');
    if (!wrap) return;
    if (!p) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var nm = $id('them-name');
    if (nm) nm.textContent = (peopleNames()[p.id] || p.name || 'Friend') + ' · ' + (p.score || 0) + (p.over ? ' · out' : '');
    var c = $id('them');
    if (!c || !c.getContext) return;
    var ctx = c.getContext('2d');
    var W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2 + 4;
    var side = 18;
    var colors = root.colors || ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71'];
    function hex(x, y, r, fill) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (Math.PI / 180) * (30 + i * 60);
        var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    hex(cx, cy, 46, '#bdc3c7');
    hex(cx, cy, side, '#2c3e50');
    var lanes = String(p.stacks || '').split(',');
    var bh = 7;
    for (var lane = 0; lane < 6; lane++) {
      var stack = lanes[lane] || '';
      var ang = (Math.PI / 180) * (30 + lane * 60);
      for (var k = 0; k < stack.length; k++) {
        var idx = stack.charCodeAt(k) - 48;
        if (idx < 0 || idx > 3) idx = 0;
        var dist = side * Math.sqrt(3) / 2 + 4 + k * bh;
        var bx = cx + Math.cos(ang) * dist;
        var by = cy + Math.sin(ang) * dist;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = colors[idx];
        ctx.beginPath();
        ctx.moveTo(-6, -bh / 2);
        ctx.lineTo(6, -bh / 2);
        ctx.lineTo(8, bh / 2);
        ctx.lineTo(-8, bh / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var v = verdict(players);
    var status = $id('friend-status');
    var scores = $id('friend-scores');
    var again = $id('againBtn');
    var html = '';
    players.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + (p.over ? ' out' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(peopleNames()[p.id] || p.name || 'Player')) + '</span>' +
        '<span class="meta">' + (p.score || 0) + (p.over ? ' · out' : '') + '</span>' +
        '</li>';
    });
    if (scores) scores.innerHTML = html;

    var other = pickOther(players);
    paintThem(other);

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (v) {
      roundOver = true;
      if (v.kind === 'tie') {
        if (status) status.textContent = 'Tie at ' + (v.a.score || 0) + '.';
      } else {
        var mineWin = v.winner.id === me.id;
        var who = mineWin ? 'You' : (peopleNames()[v.winner.id] || v.winner.name || 'They');
        var why = v.kind === 'last' ? ' still stacking' : ' wins on score';
        if (status) status.textContent = who + why + ' (' + (v.winner.score || 0) + ').';
      }
      if (again) again.hidden = false;
    } else {
      roundOver = false;
      if (again) again.hidden = true;
      if (!others.length) {
        if (status) status.innerHTML = 'Press <b>Invite</b> in the bar above, then send the link. You can play now — same blocks when they join.';
      } else if (root.HT && HT.over && HT.over()) {
        if (status) status.textContent = 'You’re out. Waiting on the rest.';
      } else {
        if (status) status.textContent = others.length === 1
          ? (peopleNames()[others[0].id] || others[0].name || 'Friend') + ' · ' + (others[0].score || 0)
          : others.length + ' playing · last one stacking wins';
      }
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.seed !== usedSeed || ad.round !== usedRound)) {
      if (ad.by !== me.id) mySeed = ad.seed;
      applySeed(ad.seed, ad.round, false);
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
        else maybeEnterFromPeople();
      }
    }, function () {});
  }

  function maybeEnterFromPeople() {
    if (on || !PEOPLE) return;
    if (peopleCount() > 1) enter(false);
  }

  function enter(fromAct) {
    api = root.gifos;
    var bar = $id('friend-bar');
    if (bar) bar.hidden = false;
    if (!api || !api.db) {
      var s = $id('friend-status');
      if (s) s.textContent = 'Play a friend needs a GifOS room.';
      return;
    }
    if (!PEOPLE) {
      var s2 = $id('friend-status');
      if (s2) s2.textContent = NEEDS_NEWER;
      return;
    }
    if (on) return;
    room = room || api.db('room');
    readRoom().then(function () {
      on = true;
      document.body.classList.add('friend');
      $id('friendBtn').hidden = true;
      mySeed = newSeed();
      round = 1;
      usedSeed = null;
      usedRound = 0;
      roundOver = false;
      lastScorePub = -1;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (!usedSeed) applySeed(mySeed, round, !!(fromAct || owner));
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
      renderMp();
    }).catch(function () {});
  }

  function leave() {
    on = false;
    roundOver = false;
    root.HT.rng = null;
    document.body.classList.remove('friend');
    var bar = $id('friend-bar');
    if (bar) bar.hidden = true;
    $id('friendBtn').hidden = false;
    var again = $id('againBtn');
    if (again) again.hidden = true;
    paintThem(null);
    if (room && me.id) room.delete(me.id).catch(function () {});
    if (typeof init === 'function') init(1);
  }

  function playAgain() {
    if (!on || !roundOver) return;
    mySeed = newSeed();
    round = (usedRound || round || 1) + 1;
    applySeed(mySeed, round, true);
  }

  function onActuate() {
    if (!on) return;
    var sc = root.score | 0;
    var over = !!(root.HT && HT.over && HT.over());
    if (sc > lastScorePub || over) {
      if (sc > lastScorePub) lastScorePub = sc;
      publish(true);
    }
    renderMp();
  }

  function onRestart() {
    if (!on) return false;
    if (roundOver) playAgain();
    return true;
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
        if (!on) maybeEnterFromPeople();
        else onRoom(lastList);
      });
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  root.HT = root.HT || {};
  root.HT.Mp = {
    enter: function () { enter(true); },
    leave: leave,
    playAgain: playAgain,
    onActuate: onActuate,
    onRestart: onRestart,
    mulberry32: mulberry32,
    live: function () { return on; }
  };

  root['__hextris'] = {
    state: function () {
      var ad = adopted(lastList);
      if (!ad) return null;
      return { round: ad.round | 0 };
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  watch();
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'ht-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
