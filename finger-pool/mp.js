/* Take turns. Each player writes their score on THEIR row. Nobody writes
 * anybody else's. Who is here is gifos.people(). Invite is OS chrome —
 * this file only says to press it. */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Finger Pool needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PUBLISH_HZ = 12;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var declined = false;
  var lastList = [];
  var lastPub = 0;
  var lastPubSig = '';
  var round = 1;
  var hadOther = false;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;

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

  function othersOf(players) {
    return players.filter(function (p) { return p.id !== me.id; });
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
    (players || live(lastList)).forEach(function (p) {
      if (!p || !p.table) return;
      if (!best || (p.seq || 0) > (best.seq || 0)) best = p;
    });
    return best;
  }

  function snapshot(game) {
    return {
      id: me.id,
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

  function publish(game, force) {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (!force && t - lastPub < 1000 / PUBLISH_HZ) return;
    var row = snapshot(game);
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPub = t;
    room.put(row).catch(function () {});
  }

  var Mp = {
    me: function () { return me; },
    on: function () { return on; },
    round: function () { return round; },
    setRound: function (r) { round = r; },
    live: function () { return live(lastList); },
    others: function () { return othersOf(live(lastList)); },
    turn: function () { return whoseTurn(live(lastList)); },
    myTurn: function () {
      if (!on || !me.id) return true;
      var players = live(lastList);
      if (othersOf(players).length === 0) return true;
      var w = whoseTurn(players);
      return !!(w && w.id === me.id);
    },
    adoptedRound: function () { return adoptedRound(live(lastList)); },
    bestTable: function () { return bestTable(live(lastList)); },
    publish: publish,
    esc: esc,
    enter: enter,
    leave: leave,
    onList: null
  };

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var players = live(lastList);
    var other = othersOf(players).length > 0;
    if (other && !hadOther) hadOther = true;
    if (Mp.onList) Mp.onList(players, hadOther && other);
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
      }
    }, function () {});
  }

  function enter(game) {
    api = root.gifos;
    if (!api || !api.db) {
      if (Mp.onList) Mp.onList([], false);
      return;
    }
    if (!PEOPLE) {
      if (Mp.onList) Mp.onList([], false);
      return;
    }
    declined = false;
    room = api.db('players');
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      hadOther = false;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      publish(game, true);
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  function leave() {
    on = false;
    declined = true;
    hadOther = false;
  }

  root.FingerMp = Mp;

  root['__finger-pool'] = {
    state: function () {
      var players = live(lastList);
      var best = bestTable(players);
      return best ? { round: best.round | 0, seq: best.seq | 0 } : (on ? { round: round | 0 } : null);
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () {
      var n = 0, id, names = peopleNames();
      for (id in names) n++;
      return on && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'fp-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
