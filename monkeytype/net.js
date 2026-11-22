/*
 * Monkeytype race — same words, live WPM, no server.
 *
 * Each racer writes ONLY their own row in `players`. The app owner alone
 * writes `match` (the seed, the countdown, the clock). Who is here is
 * gifos.people(). Invite is OS chrome.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Monkeytype needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PUB_MS = 220;
  var COUNTDOWN_MS = 3000;

  var api = null;
  var matchDb = null, playersDb = null;
  var me = { id: 'local', name: 'You' };
  var owner = false;
  var roomPeople = [];
  var others = {};
  var lastPlayerRows = [];
  var match = null;
  var onChange = null;
  var lastPub = 0;
  var lastPubSig = '';
  var selfRow = {
    wpm: 0, raw: 0, acc: 100, progress: 0, done: false, finishedAt: 0, keys: 0
  };

  function now() { return Date.now(); }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Racer';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') n++;
    }
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
      roomPeople = ppl;
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      ingestPlayers(lastPlayerRows);
    }, function () {});
  }

  function init(opts) {
    opts = opts || {};
    onChange = opts.onChange || null;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0, needsNewer: true });
    try {
      matchDb = api.db('match');
      playersDb = api.db('players');
    } catch (e) {
      return Promise.resolve({ owner: true, others: 0 });
    }
    return readRoom().then(function () {
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 1800);
        playersDb.subscribe(function (list) {
          ingestPlayers(list || []);
          done();
        });
        matchDb.subscribe(function (list) {
          ingestMatch(list || []);
        });
        putSelf(true);
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: false, others: 0 };
    });
  }

  function countOthers() {
    var n = 0, id;
    for (id in others) if (Object.prototype.hasOwnProperty.call(others, id)) n++;
    return n;
  }

  function ingestPlayers(list) {
    lastPlayerRows = list || [];
    var names = peopleNames(), seen = {}, i, p;
    others = {};
    for (i = 0; i < lastPlayerRows.length; i++) {
      p = lastPlayerRows[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Racer',
        wpm: p.wpm || 0,
        raw: p.raw || 0,
        acc: p.acc == null ? 100 : p.acc,
        progress: p.progress || 0,
        done: !!p.done,
        finishedAt: p.finishedAt || 0,
        keys: p.keys || 0
      };
    }
    fire();
  }

  function ingestMatch(list) {
    var row = null, i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'match') { row = list[i]; break; }
    }
    match = row;
    fire();
  }

  function putSelf(force) {
    if (!PEOPLE || !playersDb || !me.id || me.id === 'local') return;
    if (peopleCount() < 2 && !force) return;
    var row = {
      id: me.id,
      wpm: selfRow.wpm,
      raw: selfRow.raw,
      acc: selfRow.acc,
      progress: selfRow.progress,
      done: !!selfRow.done,
      finishedAt: selfRow.finishedAt || 0,
      keys: selfRow.keys || 0
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    playersDb.put(row).catch(function () {});
  }

  function publish(snap, force) {
    if (!snap) return;
    selfRow = {
      wpm: snap.wpm || 0,
      raw: snap.raw || 0,
      acc: snap.acc == null ? 100 : snap.acc,
      progress: snap.progress || 0,
      done: !!snap.done,
      finishedAt: snap.done ? (snap.finishedAt || now()) : 0,
      keys: snap.keys || 0
    };
    var t = now();
    if (!force && t - lastPub < PUB_MS) return;
    lastPub = t;
    putSelf(!!force);
  }

  function hostStart(cfg) {
    if (!matchDb) return Promise.reject(new Error('No room.'));
    if (!owner) return Promise.reject(new Error('The host starts the race.'));
    var startAt = now() + COUNTDOWN_MS;
    var row = {
      id: 'match',
      host: me.id,
      status: 'cd',
      seed: cfg.seed >>> 0,
      mode: cfg.mode,
      mode2: cfg.mode2,
      punct: !!cfg.punct,
      numbers: !!cfg.numbers,
      lang: cfg.lang || 'english',
      startAt: startAt
    };
    match = row;
    return matchDb.put(row).catch(function (e) { throw e; });
  }

  function hostLive() {
    if (!matchDb || !owner || !match) return;
    if (match.status === 'live') return;
    match.status = 'live';
    matchDb.put(match).catch(function () {});
  }

  function hostDone() {
    if (!matchDb || !owner || !match) return;
    match.status = 'done';
    matchDb.put(match).catch(function () {});
  }

  function hostLobby() {
    if (!matchDb || !owner) return;
    var row = {
      id: 'match', host: me.id, status: 'lobby',
      seed: 0, mode: 'time', mode2: 30, punct: false, numbers: false,
      lang: 'english', startAt: 0
    };
    match = row;
    matchDb.put(row).catch(function () {});
  }

  function roster() {
    var list = [{
      id: me.id, name: me.name, me: true,
      wpm: selfRow.wpm, raw: selfRow.raw, acc: selfRow.acc,
      progress: selfRow.progress, done: selfRow.done,
      finishedAt: selfRow.finishedAt, keys: selfRow.keys
    }];
    var id, p;
    for (id in others) {
      p = others[id];
      list.push({
        id: p.id, name: p.name, me: false,
        wpm: p.wpm, raw: p.raw, acc: p.acc,
        progress: p.progress, done: p.done,
        finishedAt: p.finishedAt, keys: p.keys
      });
    }
    list.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? -1 : 1;
      if (b.wpm !== a.wpm) return b.wpm - a.wpm;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
    return list;
  }

  function fire() {
    if (onChange) onChange(state());
  }

  function state() {
    return {
      owner: owner,
      me: me,
      match: match,
      others: countOthers(),
      roster: roster(),
      live: !!(match && (match.status === 'cd' || match.status === 'live'))
    };
  }

  function setName(n) {
    if (n) me.name = n;
  }

  root.MonkeyNet = {
    init: init,
    publish: publish,
    hostStart: hostStart,
    hostLive: hostLive,
    hostDone: hostDone,
    hostLobby: hostLobby,
    state: state,
    roster: roster,
    setName: setName,
    COUNTDOWN_MS: COUNTDOWN_MS
  };

  root['__monkeytype'] = {
    state: function () {
      if (!match) return null;
      return { status: match.status || '', seed: match.seed | 0 };
    },
    people: function () {
      return roster().map(function (p) { return p.id; });
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };
})(this);
