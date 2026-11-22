/*
 * Follow-along. The host writes one `session` row: algorithm, input, cursor,
 * playing, speed. Guests subscribe and rebuild the same trace locally — the
 * input is the whole story, so the wire stays small. Nobody writes another
 * person's row.
 *
 * Who is here is gifos.people(); the app owner hosts. No presence heartbeat.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Algorithm Visualizer needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);

  var api = null;
  var me = { id: null, name: 'You' };
  var owner = true;
  var live = false;
  var lastPut = 0;
  var lastHash = '';
  var onFollow = null;
  var onRoster = null;
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;
  var peopleTimer = 0;
  var lastSession = null;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function readRoom() {
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      var changed = key !== roomKey;
      roomKey = key;
      roomPeople = ppl;
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && ppl.length > 1) live = true;
      if (changed && onRoster) onRoster(roster());
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) {
      var blurb = document.getElementById('blurb');
      if (blurb) blurb.textContent = NEEDS_NEWER;
      var room = document.getElementById('room');
      if (room) { room.hidden = false; room.textContent = NEEDS_NEWER; }
      return Promise.resolve({ owner: true, others: 0 });
    }
    return readRoom().then(function () {
      live = true;
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 1800);
        db('session').subscribe(function (list) {
          ingestSession(list || []);
          done();
        });
        peopleTimer = setInterval(readRoom, PEOPLE_MS);
        if (onRoster) onRoster(roster());
        done();
      });
    }).catch(function () {
      live = false;
      owner = true;
      return { owner: true, others: 0 };
    });
  }

  function ingestSession(list) {
    var rec = null, i;
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === 'play') rec = list[i];
    lastSession = rec;
    if (owner || !rec || !onFollow) return;
    onFollow(rec);
  }

  function hashOf(s) {
    return [s.algo, JSON.stringify(s.input), s.cursor, s.playing ? 1 : 0, s.speed].join('|');
  }

  function publish(state, force) {
    if (!live || !owner || !me.id) return;
    var t = now();
    var h = hashOf(state);
    if (!force && h === lastHash && t - lastPut < 160) return;
    if (!force && t - lastPut < 90) return;
    lastPut = t;
    lastHash = h;
    var row = {
      id: 'play',
      by: me.id,
      algo: state.algo,
      input: state.input,
      cursor: state.cursor | 0,
      playing: !!state.playing,
      speed: state.speed,
      t: t
    };
    lastSession = row;
    db('session').put(row).catch(function () {});
  }

  function countOthers() {
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.id !== me.id && p.here !== 'gone') n++;
    }
    return n;
  }

  function roster() {
    var list = [], i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (!p || !p.id || p.here === 'gone') continue;
      list.push({ id: p.id, name: p.name || 'Someone', me: !!p.me });
    }
    return list;
  }

  root.AVNet = {
    init: init,
    publish: publish,
    owner: function () { return owner; },
    live: function () { return live; },
    me: function () { return me; },
    roster: roster,
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    onFollow: function (fn) { onFollow = fn; },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__algorithm-visualizer'] = {
    state: function () {
      return lastSession ? {
        algo: lastSession.algo,
        playing: !!lastSession.playing, by: lastSession.by || null
      } : null;
    },
    people: function () {
      return live ? roster().map(function (p) { return p.id; }) : [];
    },
    amHost: function () { return live && owner; }
  };
})(window);
