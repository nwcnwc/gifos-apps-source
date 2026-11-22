/*
 * Invite shares the playlist titles and the graphic EQ.
 * Who is here is gifos.people(). The GIF owner writes `mix`
 * (setlist). Anyone writes `eq`. Library bytes stay private.
 * Invite is OS chrome — this file never draws that button.
 * Nobody writes a peer heartbeat row.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Webamp needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var me = { id: null, name: 'You', owner: true };
  var on = false;
  var lastMixAt = 0;
  var lastPacked = '';
  var roomPeople = [];
  var roomKey = '';
  var hooks = { onMix: function () {}, onRoster: function () {} };

  function now() { return Date.now(); }

  function roomDb() {
    if (!root.gifos || !root.gifos.db) return null;
    try { return root.gifos.db('room'); } catch (e) { return null; }
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function peopleRoster() {
    var names = peopleNames(), out = [], id, p;
    for (id in names) {
      p = { id: id, name: names[id], kind: 'peer' };
      if (me.id && p.id === me.id) continue;
      out.push(p);
    }
    return out;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function readRoom() {
    if (!PEOPLE || !root.gifos) return Promise.resolve();
    return Promise.all([
      root.gifos.people(),
      root.gifos.info ? root.gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      roomPeople = ppl;
      me.owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        hooks.onRoster(peopleRoster());
      }
    }, function () {});
  }

  var api = {
    me: function () { return me; },
    live: function () { return on; },
    onMix: function (fn) { hooks.onMix = fn || function () {}; },
    onRoster: function (fn) { hooks.onRoster = fn || function () {}; },

    publish: function (mix) {
      if (!on || !PEOPLE) return;
      var db = roomDb();
      if (!db) return;
      var packed = JSON.stringify({
        tracks: mix.tracks || [],
        eq: mix.eq || null,
        now: mix.now || null,
        owner: me.owner
      });
      if (packed === lastPacked) return;
      lastPacked = packed;
      // Two rows so a guest EQ write cannot clobber the DJ's setlist.
      db.put({
        id: 'eq', kind: 'eq',
        eq: mix.eq || null,
        by: me.id, at: now()
      }).catch(function () {});
      if (me.owner) {
        db.put({
          id: 'mix', kind: 'mix',
          tracks: mix.tracks || [],
          now: mix.now || null,
          by: me.id, at: now()
        }).catch(function () {});
      }
    },

    init: function () {
      if (!root.gifos) return Promise.resolve({ owner: true, others: 0 });
      if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });
      var db = roomDb();
      return readRoom().then(function () {
        if (!db) return { owner: me.owner, others: 0 };
        on = true;
        db.subscribe(function (all) {
          var mix = null, eqRow = null;
          (all || []).forEach(function (r) {
            if (!r) return;
            if (r.id === 'mix') mix = r;
            if (r.id === 'eq') eqRow = r;
          });
          var stamp = ((mix && mix.at) || 0) + ':' + ((eqRow && eqRow.at) || 0);
          hooks.onRoster(peopleRoster());
          if (stamp !== lastMixAt) {
            lastMixAt = stamp;
            hooks.onMix({
              tracks: (mix && mix.tracks) || [],
              now: mix && mix.now,
              eq: eqRow && eqRow.eq,
              by: (eqRow && eqRow.by) || (mix && mix.by),
              at: (eqRow && eqRow.at) || (mix && mix.at)
            });
          }
        });
        setInterval(readRoom, PEOPLE_MS);
        return db.getAll().then(function () {
          return { owner: me.owner, others: Math.max(0, peopleCount() - (me.id ? 1 : 0)) };
        });
      }).catch(function () { return { owner: true, others: 0 }; });
    }
  };

  root.Net = api;

  root['__webamp'] = {
    state: function () {
      return on ? { owner: !!me.owner } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && !!me.owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'webamp-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
