/*
 * Emoji Minesweeper — race transport.
 *
 * Upstream has no networking. The only channel a GifOS app has is the
 * replicated collection, hosted by the host's browser. Two rules:
 *
 *   1. NOBODY WRITES ANYBODY ELSE'S ROW. Each player owns exactly one
 *      record in `players` and only ever reads the others. Times, result
 *      and progress ride on that row.
 *   2. The race document (`id: 'race'`) is the board deal — seed, size,
 *      emoji set — not a person. The app owner deals a new board by
 *      putting that one document. That is not writing another player's
 *      row.
 *
 * Who is here is gifos.people(). Invite is OS chrome: this file never
 * draws an invite button.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Emoji Minesweeper needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var PUBLISH_MS = 250;

  var api = null;
  var me = { id: null, name: 'Player' };
  var others = {};
  var raceRec = null;
  var lastSnap = { seed: 0, opened: 0, safe: 0, moves: 0, time: 0, result: '', flagged: 0 };
  var lastPub = 0;
  var lastRows = [];
  var onRace = null;
  var onRoster = null;
  var ready = false;
  var peopleTimer = 0;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function tintFor(id) {
    var h = 0, i;
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 360);
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
    }
    return m;
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
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Player'; }
      if (key !== roomKey) {
        roomKey = key;
        ingestPlayers(lastRows);
      }
    }, function () {});
  }

  function ingestPlayers(list) {
    lastRows = list || [];
    var names = peopleNames(), seen = {}, i, p;
    for (i = 0; i < lastRows.length; i++) {
      p = lastRows[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || 'Player',
        seed: p.seed || 0,
        opened: p.opened || 0,
        safe: p.safe || 0,
        moves: p.moves || 0,
        time: p.time || 0,
        result: p.result || '',
        flagged: p.flagged || 0,
        hue: tintFor(p.id)
      };
    }
    for (var id in others) {
      if (!seen[id]) delete others[id];
    }
    if (onRoster) onRoster(roster());
  }

  function ingestRace(list) {
    var next = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'race') next = list[i];
    }
    var prevSeed = raceRec && raceRec.seed;
    var prevAt = raceRec && raceRec.at;
    raceRec = next;
    if (onRace && next && (next.seed !== prevSeed || next.at !== prevAt)) onRace(next);
    if (onRoster) onRoster(roster());
  }

  function roster() {
    var list = [];
    var names = peopleNames();
    if (me.id && names[me.id]) {
      list.push({
        id: me.id,
        name: names[me.id] || me.name,
        mine: true,
        seed: lastSnap.seed || 0,
        opened: lastSnap.opened || 0,
        safe: lastSnap.safe || 0,
        moves: lastSnap.moves || 0,
        time: lastSnap.time || 0,
        result: lastSnap.result || '',
        flagged: lastSnap.flagged || 0,
        hue: me.id ? tintFor(me.id) : 40
      });
    }
    for (var id in others) list.push({
      id: others[id].id,
      name: others[id].name,
      mine: false,
      seed: others[id].seed,
      opened: others[id].opened,
      safe: others[id].safe,
      moves: others[id].moves,
      time: others[id].time,
      result: others[id].result,
      flagged: others[id].flagged,
      hue: others[id].hue
    });
    return list;
  }

  function putSelf(force) {
    if (!PEOPLE || !api || !me.id) return;
    var names = peopleNames(), n = 0, id;
    for (id in names) n++;
    if (n < 2 && !force) return;
    var t = now();
    if (!force && t - lastPub < PUBLISH_MS) return;
    lastPub = t;
    db('players').put({
      id: me.id,
      seed: lastSnap.seed || 0,
      opened: lastSnap.opened || 0,
      safe: lastSnap.safe || 0,
      moves: lastSnap.moves || 0,
      time: Math.round((lastSnap.time || 0) * 100) / 100,
      result: lastSnap.result || '',
      flagged: lastSnap.flagged || 0
    }).catch(function () {});
  }

  function init(opts) {
    opts = opts || {};
    onRace = opts.onRace || null;
    onRoster = opts.onRoster || null;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ ok: false });
    if (!PEOPLE) {
      ready = false;
      return Promise.resolve({ ok: false, needsNewer: true });
    }
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      ready = true;
      db('players').subscribe(function (list) { ingestPlayers(list || []); });
      db('race').subscribe(function (list) { ingestRace(list || []); });
      putSelf(true);
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
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
      seed: cfg.seed >>> 0,
      cols: Number(cfg.cols),
      rows: Number(cfg.rows),
      bombs: Number(cfg.bombs),
      emojiset: cfg.emojiset,
      byId: me.id,
      at: now()
    }).catch(function () {});
  }

  function otherCount() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  root.MineNet = {
    init: init,
    publish: publish,
    deal: deal,
    race: function () { return raceRec; },
    me: function () { return me; },
    roster: roster,
    others: otherCount,
    ready: function () { return ready; },
    owner: function () { return owner; }
  };

  root['__emoji-minesweeper'] = {
    state: function () {
      if (!ready || !raceRec) return null;
      return { seed: raceRec.seed >>> 0, at: raceRec.at | 0 };
    },
    people: function () {
      return roster().map(function (p) { return p.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return ready && owner && n > 1;
    }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'em-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
