/* Take turns. gifos.room seats the people; each player writes their score on THEIR row
 * (keyed by the room id), only when it changes. Nobody writes anybody else's.
 * Invite is OS chrome — this file only says to press it. */
(function (root) {
  'use strict';

  var api = null;
  var room = null;
  var ROOM = !!(root.gifos && root.gifos.room && root.gifos.room.subscribe);
  var rs = null;          // the room's word: who is seated, who is here, who I am
  var rows = [];          // everyone's score rows (game data keyed by room id)
  var on = false;
  var started = false;
  var joined = false;
  var lastJson = '';
  var lastCount = null;   // turns finished by my last write: a write that raises it hands the turn on
  var autoKey = '';       // the turn I already passed because my game is over
  var round = 1;
  var EN = { needsNewer: 'Bowling needs a newer GifOS to play together. Reload the page to update.' };
  function needsNewer() {
    var v = root.gifos && root.gifos.i18n && root.gifos.i18n.t ? root.gifos.i18n.t('needsNewer') : 'needsNewer';
    return v === 'needsNewer' ? EN.needsNewer : v;
  }

  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };
  function me() { return { id: rs && rs.me ? rs.me.id : null, name: (rs && rs.me && rs.me.name) || 'You' }; }

  // The people at the lane: the seats the room holds, each with their own score row (if they have bowled).
  function roster() {
    var out = [];
    ((rs && rs.seats) || []).forEach(function (x) {
      if (!x.id) return;
      var row = null;
      rows.forEach(function (r) { if (r && r.id === x.id) row = r; });
      var p = { id: x.id, name: x.name || 'Friend', here: x.here, frames: [], cur: [], total: 0, done: false, round: 1 };
      if (row) ['frames', 'cur', 'total', 'done', 'round', 'standing', 'lane', 'aimX'].forEach(function (k) { if (row[k] !== undefined) p[k] = row[k]; });
      out.push(p);
    });
    return out;
  }

  function othersOf(players) {
    return players.filter(function (p) { return p.id !== me().id; });
  }

  /* The room's turn (it skips open seats): the seated player whose turn it is, from the roster. */
  function whoseTurn(players) {
    var i, x;
    if (!rs || !rs.turn) return null;
    for (i = 0; i < (rs.seats || []).length; i++) {
      x = rs.seats[i];
      if (x.seat === rs.turn && x.id) {
        for (var j = 0; j < players.length; j++) if (players[j].id === x.id) return players[j];
      }
    }
    return null;
  }

  function adoptedRound(players) {
    var maxR = 1;
    players.forEach(function (p) {
      if ((p.round || 1) > maxR) maxR = p.round || 1;
    });
    return maxR;
  }

  function snapshot(game) {
    var rec = {
      id: me().id,
      round: round,
      frames: game ? game.frames : [],
      cur: game ? game.cur : [],
      total: game ? root.Bowl.Score.total(game.frames) : 0,
      done: !!(game && root.Bowl.Score.gameOver(game.frames)),
      standing: game ? game.standing() : 10
    };
    if (game) {
      rec.lane = game.pack();
      rec.aimX = game.ball.x;
    }
    return rec;
  }

  // The row goes through the room as a move: only the player whose turn it is writes. The turn stays with them
  // until a write that finishes a turn (a closed frame / a settled shot), which hands it to the next seated player.
  // `fresh` starts the next round (any seated player).
  function publish(game, fresh) {
    if (!on || !room || !me().id) return;
    var rec = snapshot(game), json = JSON.stringify(rec);
    if (json === lastJson && !fresh) return;
    lastJson = json;
    var n = rec.frames.length, ends = lastCount !== null && n > lastCount && true;
    lastCount = fresh ? 0 : n;
    (fresh ? api.room.newRound('players', rec) : api.room.move('players', rec, { keep: !ends })).catch(function () {});
  }

  // A player whose game is over still comes up in the room's order: they hand the turn on at once.
  function passIfDone() {
    if (!rs || !rs.myTurn) { autoKey = ''; return; }
    var mine = null, others = false;
    rows.forEach(function (r) { if (r && r.id === me().id) mine = r; });
    roster().forEach(function (p) { if (p.id !== me().id && !p.done) others = true; });
    var key = rs.round + ':' + rs.turn;
    if (!mine || !mine.done || !others || autoKey === key) return;
    autoKey = key;
    api.room.move('players', mine, { keep: false }).catch(function () { autoKey = ''; });
  }

  var Mp = {
    me: me,
    on: function () { return on; },
    round: function () { return round; },
    setRound: function (r) { round = r; },
    live: roster,
    others: function () { return othersOf(roster()); },
    turn: function () { return whoseTurn(roster()); },
    myTurn: function () {
      if (!on || !me().id) return true;
      var players = roster();
      var mine = players.some(function (p) { return p.id === me().id; });
      if (!mine) return !(rs && rs.live);
      if (othersOf(players).length === 0) return true;
      return !!(rs && rs.myTurn);
    },
    adoptedRound: function () { return adoptedRound(roster()); },
    publish: publish,
    esc: esc,
    inRoom: function () { return !!(on && rs && rs.live); },
    needsNewer: needsNewer,
    room: function () { return ROOM; },
    enter: enter,
    leave: leave,
    onList: null
  };

  function changed() {
    if (!on || !rs) return;
    if (!joined && rs.me && rs.me.role === 'watcher') { joined = true; root.gifos.room.join().catch(function () {}); }
    passIfDone();
    if (Mp.onList) Mp.onList(roster(), !!rs.live);
  }

  // Idempotent: listens to the room and the score rows once.
  function enter(game) {
    api = root.gifos;
    on = true;
    if (!ROOM || !api || !api.db) { on = false; return; }
    if (started) return;
    started = true;
    room = api.db('players');
    room.subscribe(function (list) { rows = list || []; changed(); });
    api.room.subscribe(function (st) { rs = st; changed(); });
  }

  function leave() { on = false; }

  root.BowlMp = Mp;
})(window);
