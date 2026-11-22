// Play a friend — a race, not a shared board.
//
// Shared seed so both boards spawn the same sequence of shapes. Each player
// then plays THEIR board and publishes score + lines + the well on THEIR row.
// Nobody writes anybody else's row. Last one still stacking wins; if both
// boards fill up, highest score among the stuck boards takes it.
// Who is here is gifos.people(). The app owner hosts the shared seed; GifOS
// hands that on when they leave. Invite is OS chrome.
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Falling Blocks needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
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
  var declined = false;
  var mySeed = 0;
  var round = 1;
  var usedSeed = null;
  var usedRound = 0;
  var lastList = [];
  var roundOver = false;
  var lastPub = 0;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
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
        seed: p.seed,
        round: p.round,
        score: p.score,
        lines: p.lines,
        over: p.over,
        board: p.board,
        piece: p.piece,
        cx: p.cx,
        cy: p.cy
      });
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
    var FB = root.FB || {};
    return {
      id: me.id,
      seed: mySeed,
      round: round,
      score: FB.score || 0,
      lines: FB.lines || 0,
      over: !!(FB.over || (typeof lose !== 'undefined' && lose)),
      board: FB.packBoard ? FB.packBoard() : '',
      piece: FB.packPiece ? FB.packPiece() : '',
      cx: (typeof currentX === 'number') ? currentX : 0,
      cy: (typeof currentY === 'number') ? currentY : 0
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
      if (handed) {
        declined = false;
        if (!on) enter();
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

  function applySeed(seed, r) {
    usedSeed = seed;
    usedRound = r;
    round = r;
    roundOver = false;
    root.FB.frozen = false;
    root.FB.over = false;
    root.FB.random = mulberry32(seed >>> 0);
    if (root.FB.banner) root.FB.banner('');
    if (typeof newGame === 'function') newGame();
    var pb = $('playbutton');
    if (pb) pb.disabled = true;
    lastPub = 0;
    publish();
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

  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var v = verdict(players);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var again = $('againBtn');
    var wrap = $('them-wrap');
    var html = '';
    players.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + (p.over ? ' out' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + (p.score || 0) + (p.over ? ' · out' : '') + '</span>' +
        '</li>';
    });
    scores.innerHTML = html;

    var other = pickOther(players);
    if (wrap) wrap.hidden = !other;
    if (other) {
      var nm = $('them-name');
      if (nm) nm.textContent = other.name || 'Friend';
      if (root.FB.paintThem) root.FB.paintThem(other);
    }

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (v) {
      roundOver = true;
      root.FB.frozen = true;
      if (typeof clearAllIntervals === 'function') clearAllIntervals();
      if (v.kind === 'tie') {
        status.textContent = 'Tie at ' + (v.a.score || 0) + '.';
        if (root.FB.banner) root.FB.banner('Tie!', 'lose');
      } else {
        var mineWin = v.winner.id === me.id;
        var who = mineWin ? 'You' : (v.winner.name || 'They');
        var why = v.kind === 'last' ? ' still stacking' : ' wins on score';
        status.textContent = who + why + ' (' + (v.winner.score || 0) + ').';
        if (root.FB.banner) root.FB.banner(mineWin ? 'You win!' : (v.winner.name || 'They') + ' wins!', mineWin ? 'win' : 'lose');
      }
      again.hidden = false;
    } else {
      roundOver = false;
      again.hidden = true;
      if (!others.length) {
        status.innerHTML = 'Press <b>Invite</b> in the bar above, then send the link. You can play now — same shapes when they join.';
      } else if (root.FB.over) {
        status.textContent = 'You’re out. Waiting on the rest.';
        if (root.FB.banner) root.FB.banner('You\u2019re out', 'lose');
      } else {
        status.textContent = others.length === 1
          ? (others[0].name || 'Friend') + ' · ' + (others[0].score || 0)
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
      applySeed(ad.seed, ad.round);
    }
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
        if (!on) {
          if (declined) return;
          maybeEnterFromPeople();
        } else {
          onRoom(lastList);
        }
      });
      setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      var s = $('friend-status');
      $('friend-bar').hidden = false;
      if (s) s.textContent = 'Play a friend needs a GifOS room.';
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
      root.FB.mp = true;
      document.body.classList.add('friend');
      $('friend-bar').hidden = false;
      $('friendBtn').hidden = true;
      var mn = $('mine-name');
      if (mn) mn.textContent = 'You';
      mySeed = newSeed();
      round = 1;
      usedSeed = null;
      usedRound = 0;
      roundOver = false;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (!usedSeed) applySeed(mySeed, round);
      else { lastPub = 0; publish(); renderMp(); }
    }).catch(function () {});
    return true;
  }

  function leave() {
    on = false;
    declined = true;
    root.FB.mp = false;
    root.FB.frozen = false;
    root.FB.random = null;
    roundOver = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('friendBtn').hidden = false;
    $('againBtn').hidden = true;
    var wrap = $('them-wrap');
    if (wrap) wrap.hidden = true;
    if (root.FB.banner) root.FB.banner('');
    if (room && me.id) room.delete(me.id).catch(function () {});
    if (typeof clearAllIntervals === 'function') clearAllIntervals();
    var pb = $('playbutton');
    if (pb) pb.disabled = false;
    if (typeof playButtonClicked === 'function') playButtonClicked();
    if (root.FB.paintHud) root.FB.paintHud();
  }

  function playAgain() {
    if (!on || !roundOver) return;
    mySeed = newSeed();
    round = (usedRound || round || 1) + 1;
    applySeed(mySeed, round);
  }

  var lastSig = "";
  function onActuate(user) {
    if (!on) return;
    var FB = root.FB || {};
    var sig = [FB.score || 0, FB.lines || 0, FB.over ? 1 : 0, mySeed, round].join("|");
    // K3: gravity alone must not write. Publish on user input or score/lines/over change.
    if (!user && sig === lastSig) { renderMp(); return; }
    lastSig = sig;
    lastPub = 0;
    publish();
    renderMp();
  }

  function onRestart() {
    if (!on) return false;
    if (roundOver) playAgain();
    return true;
  }

  root.FB = root.FB || {};
  root.FB.Mp = {
    enter: enter,
    leave: leave,
    playAgain: playAgain,
    onActuate: onActuate,
    onRestart: onRestart,
    mulberry32: mulberry32
  };

  root['__falling-blocks'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, seed: ad.seed >>> 0 };
      return on ? { round: (usedRound || round || 0) | 0, seed: (usedSeed || mySeed || 0) >>> 0 } : null;
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      return on && owner;
    }
  };

  $('friendBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  $('againBtn').addEventListener('click', function (e) { e.preventDefault(); playAgain(); });

  watch();
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'fb-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
