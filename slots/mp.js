// Room: anyone can pull. Each person writes ONLY their own row.
// The latest spin among people() is the table. Credits stay private.
// Invite is OS chrome. No idle heartbeats.
(function (g) {
  'use strict';

  var PEOPLE_MS = 250;
  var PEOPLE = !!(typeof gifos !== 'undefined' && gifos && gifos.people);
  var NEEDS_NEWER = 'Slots needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device';

  function nowMs() { return Date.now ? Date.now() : 0; }

  var mp = {
    on: false,
    me: { id: 'local', name: '' },
    owner: false,
    items: [],
    saveDb: null,
    roomDb: null,
    roomPeople: [],
    peopleTimer: 0
  };

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < mp.roomPeople.length; i++) {
      p = mp.roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'player';
    }
    return m;
  }

  function livePeople(items) {
    var names = peopleNames();
    return (items || []).filter(function (it) {
      return it && it.kind === 'seat' && it.id && Object.prototype.hasOwnProperty.call(names, it.id);
    }).map(function (it) {
      return Object.assign({}, it, { name: names[it.id] || it.name || 'player' });
    });
  }

  function latestSpin(items) {
    var best = null;
    livePeople(items).forEach(function (it) {
      if (!it.spin || !it.spin.symbols) return;
      if (!best || (it.spin.n || it.spin.t || 0) > (best.n || best.t || 0)) best = it.spin;
    });
    return best;
  }

  function readRoom() {
    if (!PEOPLE || typeof gifos === 'undefined' || !gifos) return Promise.resolve();
    return Promise.all([
      gifos.people(),
      gifos.info ? gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      mp.roomPeople = ppl;
      mp.owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { mp.me.id = mine.id; mp.me.name = mine.name || 'player'; }
    }, function () {});
  }

  async function putMe(extra) {
    extra = extra || {};
    if (!PEOPLE || !mp.roomDb || !mp.on) return;
    var rec = {
      id: mp.me.id,
      kind: 'seat'
    };
    var k;
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) rec[k] = extra[k];
    try { await mp.roomDb.put(rec); } catch (e) {}
  }

  function startHeartbeat() {
    // People poll only — no idle seat puts.
    if (mp.peopleTimer) clearInterval(mp.peopleTimer);
    readRoom();
    mp.peopleTimer = setInterval(readRoom, PEOPLE_MS);
  }
  function stopHeartbeat() {
    /* keep peopleTimer — who-is-here/host must stay live after leave */
  }

  mp.livePeople = livePeople;
  mp.latestSpin = latestSpin;
  mp.putMe = putMe;
  mp.startHeartbeat = startHeartbeat;
  mp.stopHeartbeat = stopHeartbeat;
  mp.readRoom = readRoom;
  g.SlotsMp = mp;

  g['__slots'] = {
    state: function () {
      var s = latestSpin(mp.items);
      return s ? { n: (s.n || s.t || 0) | 0 } : null;
    },
    people: function () {
      if (PEOPLE && typeof gifos !== 'undefined' && gifos) readRoom();
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      if (PEOPLE && typeof gifos !== 'undefined' && gifos) readRoom();
      var n = 0, i, person;
      for (i = 0; i < mp.roomPeople.length; i++) {
        person = mp.roomPeople[i];
        if (person && person.id && person.here !== 'gone') n++;
      }
      return PEOPLE && mp.owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'slots-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
