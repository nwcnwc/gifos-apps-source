/* Take turns. gifos.room seats the people; each player writes their score and table on THEIR row
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
  var round = 1;
  var EN = { needsNewer: 'Finger Pool needs a newer GifOS to play together. Reload the page to update.' };
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

  // The people at the lane: the seats the room holds, each with their own score row (if they have played).
  function roster() {
    var out = [];
    ((rs && rs.seats) || []).forEach(function (x) {
      if (!x.id) return;
      var row = null;
      rows.forEach(function (r) { if (r && r.id === x.id) row = r; });
      var p = { id: x.id, name: x.name || 'Friend', here: x.here, shots: 0, seq: 0, score: 0, moving: false, done: false, round: 1 };
      if (row) ['shots', 'seq', 'score', 'moving', 'done', 'round', 'left', 'table'].forEach(function (k) { if (row[k] !== undefined) p[k] = row[k]; });
      out.push(p);
    });
    return out;
  }

  function othersOf(players) {
    return players.filter(function (p) { return p.id !== me().id; });
  }

  /* Fewest finished shots plays next. A player who has started a shot
   * finishes it. Roster order is id. Derived from own rows only. */
  function whoseTurn(players) {
    var roster = players.slice().sort(function (a, b) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var open = roster.filter(function (p) { return !p.done; });
    if (!open.length) return null;
    var mid = open.filter(function (p) { return !!p.moving; });
    if (mid.length) return mid[0];
    var minC = 99;
    open.forEach(function (p) {
      var c = p.shots || 0;
      if (c < minC) minC = c;
    });
    var cand = open.filter(function (p) { return (p.shots || 0) === minC; });
    return cand[0] || null;
  }

  function adoptedRound(players) {
    var maxR = 1;
    players.forEach(function (p) {
      if ((p.round || 1) > maxR) maxR = p.round || 1;
    });
    return maxR;
  }

  function bestTable(players) {
    var best = null;
    (players || roster()).forEach(function (p) {
      if (!p || !p.table) return;
      if (!best || (p.seq || 0) > (best.seq || 0)) best = p;
    });
    return best;
  }

  function snapshot(game) {
    return {
      id: me().id,
      round: round,
      shots: game ? game.shots() : 0,
      seq: game ? game.seq() : 0,
      score: game ? game.score() : 0,
      moving: !!(game && game.moving()),
      done: !!(game && game.over()),
      left: game ? game.coloredLeft() : 15,
      table: game ? game.pack() : null
    };
  }

  // Only when the row changed: a person standing still writes nothing.
  function publish(game) {
    if (!on || !room || !me().id) return;
    var rec = snapshot(game), json = JSON.stringify(rec);
    if (json === lastJson) return;
    lastJson = json;
    room.put(rec).catch(function () {});
  }

  var Mp = {
    me: me,
    on: function () { return on; },
    round: function () { return round; },
    setRound: function (r) { round = r; },
    live: roster,
    others: function () { return othersOf(roster()); },
    turn: function () { return whoseTurn(roster()); },
    bestTable: function () { return bestTable(roster()); },
    myTurn: function () {
      if (!on || !me().id) return true;
      var players = roster();
      var mine = players.some(function (p) { return p.id === me().id; });
      if (!mine) return !(rs && rs.live);
      if (othersOf(players).length === 0) return true;
      var w = whoseTurn(players);
      return !!(w && w.id === me().id);
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

  root.FingerMp = Mp;
})(window);
