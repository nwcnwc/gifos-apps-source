// Play a friend — a table, not a shared scorecard.
//
// gifos.room seats the people. Shared round so everyone is filling the same game of thirteen
// turns. Each player then plays THEIR dice and publishes total + filled lines on THEIR row
// (keyed by the room id, written only when the card changes). Nobody writes anybody else's
// row. When every card is full, highest total wins.
//
// Invite is OS chrome. This file only tells the player to press Invite.
(function (root) {
  'use strict';

  var api = null;
  var room = null;
  var ROOM = !!(root.gifos && root.gifos.room && root.gifos.room.subscribe);
  var rs = null;          // the room's word: who is seated, who is here, who I am
  var rows = [];          // everyone's score rows
  var on = false;
  var subscribed = false;
  var joined = false;
  var round = 1;
  var usedRound = 0;
  var lastJson = '';
  var roundOver = false;
  var declined = false;
  var EN = { needsNewer: 'Yahtzee needs a newer GifOS to play together. Reload the page to update.' };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };
  function me() { return { id: rs && rs.me ? rs.me.id : null, name: (rs && rs.me && rs.me.name) || 'You' }; }
  function needsNewer() {
    var v = root.gifos && root.gifos.i18n && root.gifos.i18n.t ? root.gifos.i18n.t('needsNewer') : 'needsNewer';
    return v === 'needsNewer' ? EN.needsNewer : v;
  }

  // The people at the table: the seats the room holds, each with their own row (if they have played).
  function live() {
    var out = [];
    ((rs && rs.seats) || []).forEach(function (x) {
      if (!x.id) return;
      var row = null;
      rows.forEach(function (r) { if (r && r.id === x.id) row = r; });
      out.push({
        id: x.id, name: x.name || 'Player', here: x.here, round: row ? row.round : 0,
        total: row ? row.total : 0, filled: row ? row.filled : 0, gameover: !!(row && row.gameover)
      });
    });
    return out;
  }

  // Authority for the round: the highest round anyone seated has published. Deterministic, and it
  // never needs a shared row: each player only ever puts their own id.
  function adopted() {
    var players = live();
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 0) > maxR) maxR = p.round; });
    return maxR ? { round: maxR } : null;
  }

  function snapshot() {
    var g = root.Yahtzee || {};
    return {
      id: me().id,
      round: round,
      total: g.total() || 0,
      filled: g.filled() || 0,
      gameover: !!g.gameover()
    };
  }

  // Only when my card changed: a person standing still writes nothing.
  function publish() {
    if (!on || !room || !me().id) return;
    var rec = snapshot(), json = JSON.stringify(rec);
    if (json === lastJson) return;
    lastJson = json;
    room.put(rec).catch(function () {});
  }

  function applyRound(r) {
    usedRound = r;
    round = r;
    roundOver = false;
    lastJson = '';
    if (root.Yahtzee && root.Yahtzee.resetGame) root.Yahtzee.resetGame();
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
    var players = live();
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
      var mine = p.id === me().id;
      var tag = p.gameover
        ? ('done · ' + (p.total || 0))
        : ((p.filled || 0) + '/13 · ' + (p.total || 0));
      html += '<li class="' + (mine ? 'me' : '') + (p.gameover ? ' win' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + tag + '</span></li>';
    });
    scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';

    var others = players.filter(function (p) { return p.id !== me().id; });
    if (v) {
      roundOver = true;
      if (v.kind === 'tie') {
        status.textContent = 'Tie at ' + (v.a.total || 0) + '.';
      } else {
        var mineWin = v.winner.id === me().id;
        var who = mineWin ? 'You' : (v.winner.name || 'They');
        status.textContent = who + ' wins with ' + (v.winner.total || 0) + '.';
      }
      again.hidden = false;
    } else {
      roundOver = false;
      again.hidden = true;
      var g = root.Yahtzee || {};
      if (!others.length) {
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

  function changed() {
    if (!rs) return;
    if (on && !joined && rs.me && rs.me.role === 'watcher') { joined = true; root.gifos.room.join().catch(function () {}); }
    if (!on) {
      // others in the room: open straight on the shared game
      if (!declined && rs.live) startTable();
      return;
    }
    var ad = adopted();
    if (ad && ad.round > usedRound) applyRound(ad.round);
    render();
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
    lastJson = '';
    var ad = adopted();
    round = usedRound = ad ? ad.round : 1;
    if (root.Yahtzee.resetGame) root.Yahtzee.resetGame();
    chrome();
    changed();
    render();
  }

  // with others here the room (top-bar back, OS leave) is how you go; alone you may go back to solo
  function chrome() {
    $('leaveBtn').hidden = !!(on && rs && rs.live);
  }

  function enter() {
    api = root.gifos;
    if (!ROOM || !api || !api.db) {
      $('friend-bar').hidden = false;
      var s = $('friend-status');
      if (s) s.textContent = needsNewer();
      return;
    }
    declined = false;
    watch();
    startTable();
  }

  // Listens to the room and the score rows once (and opens the table when others are here).
  function watch() {
    api = root.gifos;
    if (!ROOM) {
      var f = $('friendBtn');
      if (f) f.disabled = true;
      $('friend-bar').hidden = false;
      $('friend-hint').hidden = true;
      $('leaveBtn').hidden = true;
      $('friend-status').textContent = needsNewer();
      return;
    }
    if (!api || !api.db || subscribed) return;
    subscribed = true;
    room = api.db('room');
    room.subscribe(function (list) { rows = list || []; if (rs) { changed(); chrome(); } });
    api.room.subscribe(function (st) { rs = st; changed(); chrome(); });
  }

  function leave() {
    if (rs && rs.live) return;
    on = false;
    declined = true;
    root.Yahtzee.mp = false;
    roundOver = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('friendBtn').hidden = false;
    $('againBtn').hidden = true;
    if (room && me().id) room.delete(me().id).catch(function () {});
    if (root.Yahtzee && root.Yahtzee.restoreSolo) root.Yahtzee.restoreSolo();
    else if (root.Yahtzee && root.Yahtzee.resetGame) root.Yahtzee.resetGame();
  }

  function playAgain() {
    if (!on || !roundOver) return;
    round = (usedRound || round || 1) + 1;
    applyRound(round);
    publish();
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
    inRoom: function () { return !!(on && rs && rs.live); },
    get on() { return on; },
    get roundOver() { return roundOver; }
  };

  root.__yahtzee = {
    // the shared table only: the round and each seated player's card total
    state: function () {
      var ad = adopted();
      return { round: ad ? ad.round : 1, players: live().map(function (p) { return { id: p.id, total: p.total || 0, filled: p.filled || 0, gameover: !!p.gameover }; }) };
    }
  };

  $('friendBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  $('againBtn').addEventListener('click', function (e) { e.preventDefault(); playAgain(); });
})(window);
