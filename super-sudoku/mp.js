/*
 * Super Sudoku — same-puzzle race.
 *
 * Upstream has no networking. Two rules:
 *   1. NOBODY WRITES ANYBODY ELSE'S ROW. Each player owns one record in
 *      `players` and only ever reads the others. Time, fill and result ride
 *      on that row.
 *   2. The race document (`id: 'race'`) is the puzzle deal — difficulty and
 *      index — not a person. The app owner deals (else anyone may put that
 *      one document). That is not writing another player's row.
 *
 * Who is here is gifos.people(). Invite is OS chrome: this file never draws
 * an invite button.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Super Sudoku needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PUBLISH_MS = 250;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var raceRec = null;
  var lastSnap = { diff: 'easy', index: 0, filled: 0, empty: 0, time: 0, won: false, hints: 0 };
  var lastPub = 0;
  var lastPubSig = '';
  var onRace = null;
  var onRoster = null;
  var ready = false;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function tintFor(id) {
    var h = 0, i;
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'Player'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onRoster) onRoster(roster());
      }
    }, function () {});
  }

  function ingestPlayers(list) {
    var t = now(), seen = {}, names = peopleNames(), i, p;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      var cur = others[p.id];
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Player',
        diff: p.diff || '',
        index: p.index || 0,
        filled: p.filled || 0,
        empty: p.empty || 0,
        time: p.time || 0,
        won: !!p.won,
        hints: p.hints || 0,
        stamp: p.at,
        hue: tintFor(p.id)
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function ingestRace(list) {
    var next = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'race') next = list[i];
    }
    var prevKey = raceRec && (raceRec.diff + ':' + raceRec.index + ':' + raceRec.at);
    raceRec = next;
    var nextKey = next && (next.diff + ':' + next.index + ':' + next.at);
    if (onRace && next && nextKey !== prevKey) onRace(next);
    if (onRoster) onRoster(roster());
  }

  function roster() {
    var list = [];
    list.push({
      id: me.id,
      name: me.name,
      mine: true,
      diff: lastSnap.diff,
      index: lastSnap.index,
      filled: lastSnap.filled || 0,
      empty: lastSnap.empty || 0,
      time: lastSnap.time || 0,
      won: !!lastSnap.won,
      hints: lastSnap.hints || 0,
      hue: me.id ? tintFor(me.id) : 170
    });
    for (var id in others) list.push({
      id: others[id].id,
      name: others[id].name,
      mine: false,
      diff: others[id].diff,
      index: others[id].index,
      filled: others[id].filled,
      empty: others[id].empty,
      time: others[id].time,
      won: others[id].won,
      hints: others[id].hints,
      hue: others[id].hue
    });
    return list;
  }

  function putSelf(force) {
    if (!api || !me.id || !PEOPLE) return;
    var t = now();
    var row = {
      id: me.id,
      diff: lastSnap.diff,
      index: lastSnap.index || 0,
      filled: lastSnap.filled || 0,
      empty: lastSnap.empty || 0,
      time: lastSnap.time || 0,
      won: !!lastSnap.won,
      hints: lastSnap.hints || 0
    };
    var sig = JSON.stringify(row);
    if (!force && (t - lastPub < PUBLISH_MS || sig === lastPubSig)) return;
    lastPub = t;
    lastPubSig = sig;
    db('players').put(row).catch(function () {});
  }

  function init(opts) {
    opts = opts || {};
    onRace = opts.onRace || null;
    onRoster = opts.onRoster || null;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ ok: false });
    if (!PEOPLE) return Promise.resolve({ ok: false });
    return readRoom().then(function () {
      if (!me.id) return { ok: false };
      ready = true;
      db('players').subscribe(function (list) { ingestPlayers(list || []); });
      db('race').subscribe(function (list) { ingestRace(list || []); });
      putSelf(true);
      setInterval(readRoom, PEOPLE_MS);
      return { ok: true, me: me };
    }).catch(function () { return { ok: false }; });
  }

  function publish(snap, force) {
    lastSnap = snap || lastSnap;
    putSelf(!!force);
    if (onRoster) onRoster(roster());
  }

  function deal(cfg) {
    if (!api || !me.id || !PEOPLE || !owner) return;
    db('race').put({
      id: 'race',
      diff: cfg.diff,
      index: cfg.index | 0,
      byId: me.id,
      by: me.name,
      at: now()
    }).catch(function () {});
  }

  function otherCount() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  root.SSNet = {
    init: init,
    publish: publish,
    deal: deal,
    race: function () { return raceRec; },
    me: function () { return me; },
    roster: roster,
    others: otherCount,
    ready: function () { return ready; }
  };

  root['__super-sudoku'] = {
    state: function () {
      if (!raceRec) return ready ? { diff: lastSnap.diff || '', index: lastSnap.index | 0 } : null;
      return { diff: raceRec.diff || '', index: raceRec.index | 0, at: raceRec.at | 0 };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'ss-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
