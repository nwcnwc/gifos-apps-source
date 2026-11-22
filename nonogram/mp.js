/*
 * Nonogram — same-puzzle race.
 *
 * Nobody writes anybody else's row. Each player owns one record in
 * `players`. The race document is the puzzle deal — only the app owner
 * puts it. Who is here is gifos.people(). Invite is OS chrome.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Nonogram needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PUBLISH_MS = 250;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var raceRec = null;
  var lastSnap = { size: 5, index: 0, filled: 0, total: 0, time: 0, won: false };
  var lastPub = 0;
  var lastPubSig = '';
  var onRace = null;
  var onRoster = null;
  var ready = false;
  var roomPeople = [];
  var owner = false;
  var roomRead = false;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
    }
    return m;
  }

  function tintFor(id) {
    var h = 0, i;
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function readRoom() {
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Player'; }
      if (onRoster) onRoster(roster());
    }, function () {});
  }

  function ingestPlayers(list) {
    var names = peopleNames(), seen = {}, i, p;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Player',
        size: p.size || 0,
        index: p.index || 0,
        filled: p.filled || 0,
        total: p.total || 0,
        time: p.time || 0,
        won: !!p.won,
        hue: tintFor(p.id)
      };
    }
    for (var id in others) {
      if (!seen[id] || !Object.prototype.hasOwnProperty.call(names, id)) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function ingestRace(list) {
    var next = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'race') next = list[i];
    }
    var prevKey = raceRec && (raceRec.size + ':' + raceRec.index + ':' + (raceRec.n || raceRec.at || 0));
    raceRec = next;
    var nextKey = next && (next.size + ':' + next.index + ':' + (next.n || next.at || 0));
    if (onRace && next && nextKey !== prevKey) onRace(next);
    if (onRoster) onRoster(roster());
  }

  function roster() {
    var list = [];
    list.push({
      id: me.id,
      name: me.name,
      mine: true,
      size: lastSnap.size,
      index: lastSnap.index,
      filled: lastSnap.filled || 0,
      total: lastSnap.total || 0,
      time: lastSnap.time || 0,
      won: !!lastSnap.won,
      hue: me.id ? tintFor(me.id) : 190
    });
    for (var id in others) list.push({
      id: others[id].id,
      name: others[id].name,
      mine: false,
      size: others[id].size,
      index: others[id].index,
      filled: others[id].filled,
      total: others[id].total,
      time: others[id].time,
      won: others[id].won,
      hue: others[id].hue
    });
    return list;
  }

  function putSelf(force) {
    if (!PEOPLE || !api || !me.id) return;
    var t = now();
    if (!force && t - lastPub < PUBLISH_MS) return;
    var row = {
      id: me.id,
      size: lastSnap.size,
      index: lastSnap.index || 0,
      filled: lastSnap.filled || 0,
      total: lastSnap.total || 0,
      time: lastSnap.time || 0,
      won: !!lastSnap.won
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPub = t;
    db('players').put(row).catch(function () {});
  }

  function init(opts) {
    opts = opts || {};
    onRace = opts.onRace || null;
    onRoster = opts.onRoster || null;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ ok: false });
    if (!PEOPLE) return Promise.resolve({ ok: false, needsNewer: true });
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
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
    if (!PEOPLE || !api || !me.id || !owner) return;
    db('race').put({
      id: 'race',
      size: cfg.size | 0,
      index: cfg.index | 0,
      byId: me.id,
      n: now()
    }).catch(function () {});
  }

  function otherCount() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  root.NGNet = {
    init: init,
    publish: publish,
    deal: deal,
    race: function () { return raceRec; },
    me: function () { return me; },
    roster: roster,
    others: otherCount,
    ready: function () { return ready; }
  };

  root['__nonogram'] = {
    state: function () {
      if (!raceRec) return null;
      return { size: raceRec.size | 0, index: raceRec.index | 0, n: raceRec.n | 0 };
    },
    people: function () {
      return roster().filter(function (p) { return p.id; }).map(function (p) { return p.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return PEOPLE && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'nonogram-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(this);
