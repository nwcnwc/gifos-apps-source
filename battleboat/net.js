/*
 * Battleboat — two-fleet transport over gifos.room.
 *
 * gifos.room seats the two fleets (Red, Blue), keeps who is here and passes
 * the turn ("order": one shot, then the other seat). Rules:
 *
 *   1. SHOTS ARE THE MOVES. A shot is public by nature: the shooter appends
 *      {seat, x, y} to the one `shots` record with gifos.room.move.
 *   2. NOBODY WRITES ANYBODY ELSE'S ROW. Each seated player owns one record
 *      in `players` (their own room id) and only ever reads the other's.
 *      It carries the fogged board (hits, misses, sunk: never ship cells),
 *      what is still afloat and the result, tagged with the room's round.
 *      Ship positions stay in a private collection — they never leave this
 *      device.
 *   3. Invite is OS chrome: this file never draws an invite button.
 */
(function (root) {
  'use strict';

  var api = null;
  var rs = null;
  var ROOM = false;
  var want = false;      // the player opened the shared game: ask for a seat, once
  var joined = false;
  var me = { id: null, name: 'Player' };
  var rows = {};
  var shotsRec = null;
  var lastWritten = '';
  var lastSnap = emptySnap();
  var onChange = null;
  var note = '';
  var ready = false;

  function db(n) { return api.db(n); }

  function emptySnap() {
    return {
      round: 1,
      phase: 'place',
      shots: [],
      board: root.BB.emptyBoard(),
      sunk: 0,
      lost: [],
      result: ''
    };
  }

  function seatList() { return (rs && rs.seats) || []; }
  function mySeatIdx() {
    var i, s = seatList();
    if (!rs || !rs.me || !rs.me.seat) return -1;
    for (i = 0; i < s.length; i++) if (s[i].seat === rs.me.seat) return i;
    return -1;
  }
  function otherSeat() {
    var i = mySeatIdx(), j = i === 0 ? 1 : 0, s = seatList();
    if (i < 0) {
      // a watcher sees whoever holds the first other seat
      for (j = 0; j < s.length; j++) if (s[j].id) return j;
      return -1;
    }
    return s[j] && s[j].id ? j : -1;
  }
  function shotsOf(idx) {
    var out = [], list = (shotsRec && shotsRec.list) || [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].s === idx && typeof list[i].x === 'number' && typeof list[i].y === 'number') out.push({ x: list[i].x, y: list[i].y });
    }
    return out;
  }
  function rowOf(id) {
    var r = rows[id];
    return r && rs && r.round === rs.round ? r : null;
  }

  function opponent() {
    var j = otherSeat();
    if (j < 0) return null;
    var x = seatList()[j], r = rowOf(x.id);
    return {
      id: x.id,
      name: x.name || 'Player',
      here: x.here,
      round: rs.round,
      phase: r ? r.phase : 'place',
      shots: shotsOf(j),
      board: r && r.board ? r.board : root.BB.emptyBoard(),
      sunk: r ? r.sunk | 0 : 0,
      lost: r && Array.isArray(r.lost) ? r.lost : [],
      result: r ? r.result || '' : ''
    };
  }

  function view() {
    return {
      me: {
        id: me.id,
        name: me.name,
        round: lastSnap.round,
        phase: lastSnap.phase,
        shots: shotsOf(mySeatIdx()),
        board: lastSnap.board,
        sunk: lastSnap.sunk,
        lost: lastSnap.lost,
        result: lastSnap.result
      },
      other: opponent(),
      round: rs ? rs.round : 1,
      live: !!(rs && rs.live),
      seated: mySeatIdx() >= 0,
      myTurn: !!(rs && rs.myTurn),
      role: rs && rs.me ? rs.me.role : 'watcher',
      note: note
    };
  }
  function fire() { if (onChange) onChange(view()); }

  function putSelf() {
    if (!api || !ROOM || !me.id || mySeatIdx() < 0 || !rs) return;
    var rec = {
      id: me.id,
      round: rs.round,
      phase: lastSnap.phase || 'place',
      board: lastSnap.board || root.BB.emptyBoard(),
      sunk: lastSnap.sunk || 0,
      lost: lastSnap.lost || [],
      result: lastSnap.result || ''
    };
    var key = JSON.stringify(rec);
    if (key === lastWritten) return;
    lastWritten = key;
    db('players').put(rec).catch(function () {});
  }

  function wantSeat() {
    if (want && !joined && rs && rs.me && rs.me.role === 'watcher') { joined = true; api.room.join().catch(function () {}); }
  }

  function init(opts) {
    opts = opts || {};
    onChange = opts.onChange || null;
    api = root.gifos;
    ROOM = !!(api && api.db && api.room && api.room.subscribe);
    if (!ROOM) return Promise.resolve({ ok: false });
    db('players').subscribe(function (list) {
      var next = {}, i;
      for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id) next[list[i].id] = list[i];
      rows = next;
      fire();
    });
    db('shots').subscribe(function (list) {
      var rec = null, i;
      for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'shots') rec = list[i];
      shotsRec = rec; note = '';
      fire();
    });
    return new Promise(function (resolve) {
      var first = true;
      api.room.subscribe(function (s) {
        rs = s; note = '';   // a refusal's note goes with the next room state
        me.id = s.me.id;
        me.name = s.me.name || 'Player';
        ready = true;
        wantSeat();
        fire();
        if (first) { first = false; resolve({ ok: true, me: me }); }
      });
    });
  }

  // asking to play: the room seats, lines up, or asks the host
  function join() { want = true; wantSeat(); }

  function publish(snap) {
    lastSnap = snap || lastSnap;
    putSelf();
    fire();
  }

  // one shot: the whole next record; the room passes the turn
  function shoot(x, y) {
    var i = mySeatIdx();
    if (!ROOM || i < 0) return Promise.resolve(false);
    var list = ((shotsRec && shotsRec.list) || []).concat([{ s: i, x: x, y: y }]);
    var rec = { id: 'shots', list: list };
    shotsRec = rec;
    return api.room.move('shots', rec).catch(function (e) { note = (e && e.message) || ''; fire(); });
  }

  // the next game: the shots start over, the turn goes to the next starter
  function newRound() {
    if (!ROOM || mySeatIdx() < 0) return Promise.resolve(false);
    return api.room.newRound('shots', { id: 'shots', list: [] }).catch(function (e) { note = (e && e.message) || ''; fire(); });
  }

  function leave() {
    want = false; joined = false;
    if (api && ROOM) api.room.leave().catch(function () {});
    lastSnap = emptySnap();
    lastWritten = '';
  }

  root.BBNet = {
    init: init,
    join: join,
    publish: publish,
    shoot: shoot,
    newRound: newRound,
    leave: leave,
    room: function () { return ROOM; },
    me: function () { return me; },
    view: view,
    // the shared game only (for the room kit): the round and the public shots
    shared: function () {
      var list = (shotsRec && shotsRec.list) || [];
      return { round: rs ? rs.round : 1, shots: list.map(function (x) { return x.s + ':' + x.x + ',' + x.y; }).join(' ') };
    },
    emptySnap: emptySnap,
    ready: function () { return ready; }
  };
})(window);
