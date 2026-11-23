// Play a friend — a race on the same warehouse, not a shared floor.
//
// Shared (round, levelId) so both people work the same room. Each player
// publishes solved + move count on THEIR row. App owner hosts the level
// (else lowest id). Who is here is gifos.people(). Invite is OS chrome.
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Sokoban needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 250;
  var PEOPLE = !!(root.gifos && root.gifos.people);

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var myLevel = null;
  var round = 1;
  var usedLevel = null;
  var usedRound = 0;
  var lastList = [];
  var roundOver = false;
  var solvedAt = 0;
  var declined = false;
  var lastPub = 0;
  var lastPubSig = '';
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
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.levelId != null; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return { round: maxR, levelId: a.levelId, by: a.id };
  }

  function snapshot() {
    var g = root.SKGame;
    return {
      id: me.id,
      levelId: myLevel || (g && g.levelId),
      round: round,
      moves: g ? g.moves : 0,
      pushes: g ? g.pushes : 0,
      parked: g ? g.parked : 0,
      total: g ? g.total : 0,
      solved: !!(g && g.solved),
      solvedAt: solvedAt || 0
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var row = snapshot();
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    room.put(row).catch(function () {});
  }

  function applyLevel(levelId, r) {
    usedLevel = levelId;
    usedRound = r;
    round = r;
    myLevel = levelId;
    roundOver = false;
    solvedAt = 0;
    if (root.SKGame) root.SKGame.goLevel(levelId, { race: true, fresh: true });
    publish();
  }

  function verdict(players) {
    var won = players.filter(function (p) { return p.solved; });
    if (!won.length) return null;
    won.sort(function (a, b) {
      return (a.solvedAt || a.at || 0) - (b.solvedAt || b.at || 0) ||
        (a.moves || 0) - (b.moves || 0) ||
        (a.pushes || 0) - (b.pushes || 0);
    });
    return { winner: won[0] };
  }

  function render() {
    if (!on) return;
    var players = live(lastList);
    var v = verdict(players);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var again = $('againBtn');
    var html = '';
    players.sort(function (a, b) {
      if (a.solved && b.solved) return (a.solvedAt || 0) - (b.solvedAt || 0);
      if (a.solved !== b.solved) return a.solved ? -1 : 1;
      return (a.moves || 0) - (b.moves || 0);
    });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      var tag = p.solved
        ? ('solved · ' + (p.moves || 0))
        : ((p.moves || 0) + ' move' + ((p.moves || 0) === 1 ? '' : 's') +
          ' · ' + (p.parked || 0) + '/' + (p.total || 0));
      html += '<li class="' + (mine ? 'me' : '') + (p.solved ? ' win' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + tag + '</span></li>';
    });
    scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (v) {
      roundOver = true;
      var mineWin = v.winner.id === me.id;
      var who = mineWin ? 'You' : (v.winner.name || 'They');
      status.textContent = who + ' parked every box' +
        (v.winner.moves != null ? ' in ' + v.winner.moves + ' move' + (v.winner.moves === 1 ? '' : 's') : '') + '.';
      again.hidden = false;
    } else {
      roundOver = false;
      again.hidden = true;
      if (!others.length) {
        status.textContent = 'Waiting for a friend… press Invite (GifOS menu) to send the link. You can push in the meantime — they get the same warehouse.';
      } else if (root.SKGame && root.SKGame.solved) {
        status.textContent = 'You parked them. Waiting to see if anyone was first.';
      } else {
        status.textContent = others.length === 1
          ? ((others[0].name || 'Friend') + ' is on ' + (others[0].moves || 0) + ' move' + ((others[0].moves || 0) === 1 ? '' : 's') + '.')
          : (others.length + ' playing. First to park every box wins.');
      }
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.levelId !== usedLevel || ad.round !== usedRound)) {
      if (ad.by !== me.id) myLevel = ad.levelId;
      applyLevel(ad.levelId, ad.round);
    }
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
        if (n > 0) startRace();
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
    if (n > 0) startRace();
  }

  function startRace() {
    if (!PEOPLE) return;
    on = true;
    document.body.classList.add('friend');
    $('friend-bar').hidden = false;
    $('friendBtn').hidden = true;
    $('levels').disabled = true;
    myLevel = (root.SKGame && root.SKGame.levelId) || 1;
    round = 1;
    usedLevel = null;
    usedRound = 0;
    roundOver = false;
    solvedAt = 0;
    lastPubSig = '';
    if (!usedLevel) applyLevel(myLevel, round);
    else { publish(); render(); }
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = 'Play a friend needs a GifOS room.';
      return;
    }
    if (!PEOPLE) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = NEEDS_NEWER;
      return;
    }
    room = room || api.db('players');
    declined = false;
    readRoom().then(function () {
      watch();
      startRace();
    }).catch(function () {});
  }

  function watch() {
    api = root.gifos;
    if (!api || !api.db || !PEOPLE) return;
    room = room || api.db('players');
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
      if (!peopleTimer) peopleTimer = setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  function leave() {
    on = false;
    declined = true;
    roundOver = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('friendBtn').hidden = false;
    $('againBtn').hidden = true;
    $('levels').disabled = false;
    if (room && me.id) room.delete(me.id).catch(function () {});
  }

  function playAgain() {
    if (!on || !roundOver) return;
    var next = root.SK && root.SK.nextId(usedLevel || myLevel);
    myLevel = next;
    round = (usedRound || round || 1) + 1;
    applyLevel(myLevel, round);
  }

  function onSolved() {
    if (!on) return;
    if (!solvedAt) solvedAt = now();
    publish();
    render();
  }

  function onChange() {
    if (!on) return;
    publish();
    render();
  }

  root.SKMp = {
    enter: enter,
    leave: leave,
    playAgain: playAgain,
    onSolved: onSolved,
    onChange: onChange,
    watch: watch,
    get on() { return on; }
  };

  root['__sokoban'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, levelId: ad.levelId };
      return on ? { round: (usedRound || round || 0) | 0, levelId: usedLevel || myLevel } : null;
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

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'sokoban-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }

  $('friendBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  $('againBtn').addEventListener('click', function (e) { e.preventDefault(); playAgain(); });
})(window);
