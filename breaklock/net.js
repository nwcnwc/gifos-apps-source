/*
 * BreakLock — a live "I set a pattern, you crack it" room.
 *
 * Each person writes ONLY their own players row. The current secret lives
 * on match (one row, id "match"); whoever is the setter writes it. Guests
 * use it to score pegs locally and never paint it until the round is over.
 * Who is here is gifos.people(). No heartbeat.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'BreakLock needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'You' };
  var owner = true;
  var others = {};
  var match = null;
  var onChange = null;
  var roomPeople = [];
  var roomKey = '';
  var lastPut = 0;
  var lastPubSig = '';

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

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

  function countOthers() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  function live() {
    return !!api && !!me.id && PEOPLE;
  }

  function versusOn() {
    return live() && countOthers() > 0;
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
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onChange) onChange();
      }
    }, function () {});
  }

  function ingestPlayers(list) {
    var t = now();
    var seen = {};
    var names = peopleNames();
    var i, p, id;
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        role: p.role || 'crack',
        count: p.count | 0,
        cracked: !!p.cracked,
        attempts: p.attempts || [],
        round: p.round | 0,
        t: p.t || t,
        seen: t
      };
    }
    for (id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onChange) onChange();
  }

  function ingestMatch(list) {
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'match') rec = list[i];
    }
    match = rec;
    if (onChange) onChange();
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });

    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2500);
        db('players').subscribe(function (list) {
          ingestPlayers(list);
          done();
        });
        db('match').subscribe(function (list) {
          ingestMatch(list);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function putPlayer(row) {
    if (!live()) return;
    row.id = me.id;
    row.name = me.name;
    row.t = now();
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    lastPut = now();
    db('players').put(row).catch(function () {});
  }

  function putMatch(row) {
    if (!live()) return;
    row.id = 'match';
    row.by = me.id;
    row.t = now();
    db('match').put(row).catch(function () {});
  }

  function othersList() {
    var list = [], id;
    for (id in others) list.push(others[id]);
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
    owner: function () { return owner; },
    others: othersList,
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    match: function () { return match; },
    roster: roster,
    putPlayer: putPlayer,
    putMatch: putMatch,
    vsNext: vsNext,
    onChange: function (fn) { onChange = fn; }
  };

  root['__breaklock'] = {
    state: function () {
      return match ? { round: match.round | 0, state: match.state || '' } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      if (me.id && names[me.id]) out.push(me.id);
      for (id in others) if (names[id]) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'bl-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
