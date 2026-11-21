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

  function completed(p) {
    return (p.frames && p.frames.length) || 0;
  }

  function midFrame(p) {
    return !!(p.cur && p.cur.length && !p.done);
  }

  /* Fewest finished frames bowls next. A player who has started a frame
   * finishes it. Roster order is id. Derived from own rows only. */
  function whoseTurn(players) {
    var roster = players.slice().sort(function (a, b) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var open = roster.filter(function (p) { return !p.done; });
    if (!open.length) return null;
    var mid = open.filter(midFrame);
    if (mid.length) return mid[0];
    var minC = 99;
    open.forEach(function (p) {
      var c = completed(p);
      if (c < minC) minC = c;
    });
    var cand = open.filter(function (p) { return completed(p) === minC; });
    return cand[0] || null;
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

  root.BowlMp = Mp;
})(window);
