/*
 * BreakLock — a live "I set a pattern, you crack it" room.
 *
 * gifos.room seats the people. Each seated person writes ONLY their own players
 * row. The current secret lives on match (one row, id "match"); the setter
 * writes it with gifos.room.move. Guests use it to score pegs locally and
 * never paint it until the round is over.
 */
(function (root) {
  'use strict';

  // gifos.room holds the seats (who plays, who is here, the line). The setter, or whoever cracks it, writes the
  // match record with gifos.room.move; each seated person writes ONLY their own players row (attempts, count),
  // keyed by their room id. Rows of people who do not hold a seat are ignored. No presence rows, no heartbeat.
  var api = null;
  var rs = null;
  var ROOM = false;
  var joined = false;
  var me = { id: null, name: 'You' };
  var rows = {};
  var match = null;
  var note = '';
  var onChange = null;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function fire() { if (onChange) onChange(); }

  function seats() { return (rs && rs.seats) || []; }
  function heldOthers() {
    return seats().filter(function (x) { return x.id && x.id !== me.id; });
  }
  function live() {
    return !!api && ROOM && !!me.id;
  }
  function seated() {
    return !!(rs && rs.me && rs.me.seat);
  }
  function versusOn() {
    return live() && heldOthers().length > 0;
  }

  function ingestPlayers(list) {
    var next = {}, i, p;
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (p && p.id) next[p.id] = p;
    }
    rows = next;
    fire();
  }

  function ingestMatch(list) {
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'match') rec = list[i];
    }
    match = rec;
    note = '';
    fire();
  }

  function init() {
    api = root.gifos;
    ROOM = !!(api && api.db && api.room && api.room.subscribe);
    if (!ROOM) return Promise.resolve({ owner: true, others: 0 });
    db('players').subscribe(ingestPlayers);
    db('match').subscribe(ingestMatch);
    return new Promise(function (resolve) {
      var first = true;
      api.room.subscribe(function (s) {
        rs = s;
        note = '';   // a refusal's note goes with the next room state
        me.id = s.me.id;
        me.name = s.me.name || 'You';
        // opening the game is asking to play, once; the room seats, lines up, or asks the host
        if (!joined && s.me.role === 'watcher') { joined = true; api.room.join().catch(function () {}); }
        fire();
        if (first) { first = false; resolve({ owner: true, others: heldOthers().length }); }
      });
    });
  }

  function putPlayer(row) {
    if (!live() || !seated()) return;
    row.id = me.id;
    row.name = me.name;
    row.t = now();
    db('players').put(row).catch(function () {});
  }

  function putMatch(row) {
    if (!live() || !seated()) return;
    row.id = 'match';
    row.by = me.id;
    row.t = now();
    api.room.move('match', row).catch(function (e) { note = (e && e.message) || ''; fire(); });
  }

  function othersList() {
    var list = heldOthers().map(function (x) {
      var p = rows[x.id] || {};
      return {
        id: x.id,
        name: (x.name || 'Friend') + (x.here === 'away' ? ' …' : ''),
        role: p.role || 'crack',
        count: p.count | 0,
        cracked: !!p.cracked,
        attempts: p.attempts || [],
        round: p.round | 0,
        t: p.t || 0
      };
    });
    list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return list;
  }

  function roster() {
    return [{ id: me.id, name: me.name, me: true }].concat(othersList());
  }

  /**
   * What a client should do next from the live match row.
   * Summary is not a wall — YOUR TURN_ writes state=setting with the
   * cracker as setterId, and they must leave Success to draw.
   * Returns null if the current screen already matches.
   */
  function vsNext(m, myId, cur) {
    if (!m || !myId) return null;
    cur = cur || {};
    var screen = cur.screen || 'menu';
    var role = cur.role || 'solo';
    var ended = !!cur.ended;
    var hasSecret = !!cur.secret;
    var sameRound = (cur.round | 0) === (m.round | 0);

    if (m.state === 'setting') {
      if (m.setterId === myId) {
        if (role === 'set' && screen === 'game' && !ended && sameRound) return null;
        return 'set';
      }
      if (role === 'crack' && screen === 'game' && !hasSecret && !ended && sameRound) return null;
      return 'wait';
    }
    if (m.state === 'playing' && m.secret && m.secret.length) {
      // Stay on Success until match goes over or YOUR TURN_ starts the next round.
      if (screen === 'summary' && sameRound) return null;
      if (m.setterId === myId) {
        if (role === 'watch' && screen === 'game' && !ended && sameRound) return null;
        return 'watch';
      }
      if (role === 'crack' && hasSecret && screen === 'game' && !ended && sameRound) return null;
      return 'crack';
    }
    if (m.state === 'over') {
      if (screen === 'summary' && sameRound) return null;
      return 'summary';
    }
    return null;
  }

  root.BreakLockNet = {
    init: init,
    live: live,
    versusOn: versusOn,
    me: function () { return me; },
    others: othersList,
    seated: seated,
    note: function () { return note; },
    waiting: function () { return !!(rs && rs.me && (rs.me.role === 'waiting' || rs.me.role === 'asking')); },
    isHeld: function (id) { return seats().some(function (x) { return x.id === id; }); },
    match: function () { return match; },
    roster: roster,
    putPlayer: putPlayer,
    putMatch: putMatch,
    vsNext: vsNext,
    onChange: function (fn) { onChange = fn; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
