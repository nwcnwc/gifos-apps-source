// Play a friend — a table, not a shared scorecard.
//
// Shared round so everyone is filling the same game of thirteen turns. Each
// player then plays THEIR dice and publishes total + filled lines on THEIR
// row. Nobody writes anybody else's row. When every card is full, highest
// total wins.
//
// Who is here is gifos.people(). Invite is OS chrome. This file only tells
// the player to press Invite.
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Yahtzee needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var round = 1;
  var usedRound = 0;
  var lastList = [];
  var roundOver = false;
  var declined = false;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var lastPubSig = '';

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

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Player' }));
    });
    return out;
  }

  // Authority for the round: the highest round anyone has published, then the
  // lexicographically smallest id on that round. Deterministic, and it never
  // needs a shared row — each player only ever puts their own id.
  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR; });
    if (!cand.length) return null;
    cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { round: maxR, by: cand[0].id };
  }

  function snapshot() {
    var g = root.Yahtzee || {};
    return {
      id: me.id,
      round: round,
      total: g.total() || 0,
      filled: g.filled() || 0,
      gameover: !!g.gameover()
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var row = snapshot();
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    row.name = me.name;
    row.at = now();
    room.put(row).catch(function () {});
  }

  function applyRound(r) {
    usedRound = r;
    round = r;
    roundOver = false;
    lastPubSig = '';
    if (root.Yahtzee && root.Yahtzee.resetGame) root.Yahtzee.resetGame();
    publish();
  }

  function verdict(players) {
    if (players.length < 2) return null;
    if (!players.every(function (p) { return p.gameover; })) return null;
    var ranked = players.slice().sort(function (a, b) {
      return (b.total || 0) - (a.total || 0);
    });
    if (ranked[0].total === ranked[1].total) return { kind: 'tie', a: ranked[0], b: ranked[1] };
    return { kind: 'score', winner: ranked[0] };
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
      if (!!a.gameover !== !!b.gameover) return a.gameover ? 1 : -1;
      return (b.total || 0) - (a.total || 0);
    });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      var tag = p.gameover
        ? ('done · ' + (p.total || 0))
        : ((p.filled || 0) + '/13 · ' + (p.total || 0));
      html += '<li class="' + (mine ? 'me' : '') + (p.gameover ? ' win' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + tag + '</span></li>';
    });
    scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (v) {
      roundOver = true;
      if (v.kind === 'tie') {
        status.textContent = 'Tie at ' + (v.a.total || 0) + '.';
      } else {
        var mineWin = v.winner.id === me.id;
        var who = mineWin ? 'You' : (v.winner.name || 'They');
        status.textContent = who + ' wins with ' + (v.winner.total || 0) + '.';
      }
      again.hidden = false;
    } else {
      roundOver = false;
      again.hidden = true;
      var g = root.Yahtzee || {};
      if (!PEOPLE) {
        status.textContent = NEEDS_NEWER;
      } else if (!others.length) {
        status.textContent = 'Waiting for a friend. You can fill your card now — they sit the same round.';
      } else if (g.gameover && g.gameover()) {
        status.textContent = 'Your card is full at ' + (g.total() || 0) + '. Waiting for the others.';
      } else {
        status.textContent = others.length === 1
          ? ('You both play now. ' + (others[0].name || 'Friend') + ' is on ' + (others[0].filled || 0) + '/13.')
          : ('You all play now. ' + others.length + ' others filling their cards.');
      }
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && ad.round !== usedRound) applyRound(ad.round);
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
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else if (!declined) {
          var others = live(lastList).filter(function (p) { return p.id && p.id !== me.id; });
          if (others.length) startTable();
        }
      }
    }, function () {});
  }

  function startTable() {
    on = true;
    root.Yahtzee.mp = true;
    document.body.classList.add('friend');
    $('friend-bar').hidden = false;
    $('friendBtn').hidden = true;
    round = 1;
    usedRound = 0;
    roundOver = false;
    lastPubSig = '';
    if (!usedRound) applyRound(round);
    render();
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      var s = $('friend-status');
      if (s) s.textContent = 'Play a friend needs a GifOS room.';
      return;
    }
    if (!PEOPLE) {
      $('friend-bar').hidden = false;
      var s2 = $('friend-status');
      if (s2) s2.textContent = NEEDS_NEWER;
      return;
    }
    room = room || api.db('room');
    declined = false;
    readRoom().then(function () {
      if (!me.id) return;
      watch();
      startTable();
    }).catch(function () {});
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
          var others = live(lastList).filter(function (p) { return p.id && p.id !== me.id; });
          if (others.length) startTable();
        } else {
          onRoom(lastList);
        }
      });
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  function leave() {
    on = false;
    declined = true;
    root.Yahtzee.mp = false;
    roundOver = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('friendBtn').hidden = false;
    $('againBtn').hidden = true;
    if (room && me.id) room.delete(me.id).catch(function () {});
    if (root.Yahtzee && root.Yahtzee.restoreSolo) root.Yahtzee.restoreSolo();
    else if (root.Yahtzee && root.Yahtzee.resetGame) root.Yahtzee.resetGame();
  }

  function playAgain() {
    if (!on || !roundOver) return;
    round = (usedRound || round || 1) + 1;
    applyRound(round);
  }

  function onChange() {
    if (!on) return;
    publish();
    render();
  }

  root.Yahtzee = root.Yahtzee || {};
  root.Yahtzee.Mp = {
    enter: enter,
    leave: leave,
    playAgain: playAgain,
    onChange: onChange,
    watch: watch,
    get on() { return on; },
    get roundOver() { return roundOver; }
  };

  root['__yahtzee'] = {
    state: function () { return on ? { round: usedRound || round | 0 } : null; },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () { return on && owner && peopleCount() > 1; }
  };

  if ($('friendBtn')) {
    $('friendBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  }
  if ($('leaveBtn')) {
    $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  }
  if ($('againBtn')) {
    $('againBtn').addEventListener('click', function (e) { e.preventDefault(); playAgain(); });
  }

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'yahtzee-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
