/*
 * Battleboat — two-fleet transport.
 *
 * Upstream has no networking. The only channel a GifOS app has is the
 * replicated collection. Two rules:
 *
 *   1. NOBODY WRITES ANYBODY ELSE'S ROW. Each player owns exactly one
 *      record in `players` and only ever reads the others. Shots you fire
 *      and the revealed cells of YOUR fleet ride on that row. Ship
 *      positions stay in a private collection — they never leave this
 *      device.
 *   2. Invite is OS chrome: this file never draws an invite button.
 * Who is here is gifos.people(). Publish only when the snap changes.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Battleboat needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PUBLISH_MS = 200;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var lastSnap = emptySnap();
  var lastPub = 0;
  var lastPubSig = '';
  var onChange = null;
  var ready = false;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

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

  function ingest(list) {
    var names = peopleNames(), seen = {}, i, p;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Player',
        round: p.round || 1,
        phase: p.phase || 'place',
        shots: Array.isArray(p.shots) ? p.shots : [],
        board: p.board || root.BB.emptyBoard(),
        sunk: p.sunk || 0,
        lost: Array.isArray(p.lost) ? p.lost : [],
        result: p.result || '',
        at: p.at
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (onChange) onChange(view());
  }

  function opponent() {
    var best = null, id;
    for (id in others) {
      if (!best || others[id].id < best.id) best = others[id];
    }
    return best;
  }

  function view() {
    return {
      me: {
        id: me.id,
        name: me.name,
        round: lastSnap.round,
        phase: lastSnap.phase,
        shots: lastSnap.shots,
        board: lastSnap.board,
        sunk: lastSnap.sunk,
        lost: lastSnap.lost,
        result: lastSnap.result
      },
      other: opponent(),
      others: (function () { var n = 0, id; for (id in others) n++; return n; })()
    };
  }

  function putSelf(force) {
    if (!api || !me.id || !PEOPLE) return;
    var t = now();
    if (!force && t - lastPub < PUBLISH_MS) return;
    var row = {
      id: me.id,
      round: lastSnap.round || 1,
      phase: lastSnap.phase || 'place',
      shots: lastSnap.shots || [],
      board: lastSnap.board || root.BB.emptyBoard(),
      sunk: lastSnap.sunk || 0,
      lost: lastSnap.lost || [],
      result: lastSnap.result || ''
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPub = t;
    row.at = t;
    row.name = me.name;
    db('players').put(row).catch(function () {});
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
        if (onChange) onChange(view());
      }
    }, function () {});
  }

  function init(opts) {
    opts = opts || {};
    onChange = opts.onChange || null;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ ok: false });
    if (!PEOPLE) return Promise.resolve({ ok: false });
    return readRoom().then(function () {
      if (!me.id) return { ok: false };
      ready = true;
      db('players').subscribe(function (list) { ingest(list || []); });
      putSelf(true);
      setInterval(readRoom, PEOPLE_MS);
      return { ok: true, me: me };
    }).catch(function () { return { ok: false }; });
  }

  function publish(snap, force) {
    lastSnap = snap || lastSnap;
    putSelf(!!force);
    if (onChange) onChange(view());
  }

  function leave() {
    if (api && me.id) db('players').delete(me.id).catch(function () {});
    others = {};
    lastSnap = emptySnap();
    lastPubSig = '';
    ready = false;
  }

  root.BBNet = {
    init: init,
    publish: publish,
    leave: leave,
    me: function () { return me; },
    view: view,
    emptySnap: emptySnap,
    ready: function () { return ready; }
  };

  root['__battleboat'] = {
    state: function () {
      return ready ? { round: lastSnap.round | 0, phase: lastSnap.phase || '' } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return ready && owner && peopleCount() > 1; }
  };
})(window);
