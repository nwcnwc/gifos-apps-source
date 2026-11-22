/*
 * Invite jams the same song.
 *
 * Each player writes the song JSON on THEIR own row. The host (app owner)
 * copies a legal song onto the `song` row. Nobody writes anybody else's row.
 * Who is here is gifos.people(). Solo work stays in gifos.db('songs').
 * Invite is OS chrome. This file never draws an Invite button.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'BeepBox needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PUB_MS = 280;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var owner = false;
  var on = false;
  var lastList = [];
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;
  var lastSong = null;
  var applying = false;
  var lastPacked = '';
  var myN = 0;
  var pubTimer = 0;
  var jamEl = null;
  var getJson = null;
  var applyJson = null;
  var frozen = null;

  function now() { return Date.now(); }

  function legalSong(j) {
    return j && typeof j === 'object' && j.format === 'BeepBox' &&
      Array.isArray(j.channels) && j.channels.length >= 1 &&
      typeof j.beatsPerMinute === 'number' &&
      j.beatsPerMinute >= 30 && j.beatsPerMinute <= 300;
  }

  function pack(j) {
    try { return JSON.stringify(j); } catch (e) { return ''; }
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
      var changed = key !== roomKey;
      roomKey = key;
      roomPeople = ppl;
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && ppl.length > 1) {
        on = true;
        if (getJson) frozen = getJson();
      }
      if (changed && on) ingest(lastList);
    }, function () {});
  }

  function playersHere(list) {
    var names = {}, out = [], seen = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      if (roomPeople[i] && roomPeople[i].id && roomPeople[i].here !== 'gone') {
        names[roomPeople[i].id] = roomPeople[i].name;
      }
    }
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === 'song') continue;
      if (!Object.prototype.hasOwnProperty.call(names, p.id) || seen[p.id]) continue;
      seen[p.id] = true;
      out.push(Object.assign({}, p, { name: names[p.id] || 'Player' }));
    }
    return out;
  }

  function isHost() { return on && owner; }

  function songOf(list) {
    var i;
    for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'song') return list[i];
    return null;
  }

  function paintJam(people) {
    if (!jamEl) return;
    if (!on || people.length < 2) {
      jamEl.hidden = true;
      jamEl.textContent = '';
      return;
    }
    jamEl.hidden = false;
    jamEl.textContent = people.length + ' jamming this song';
  }

  function snapshot() {
    var j = getJson ? getJson() : null;
    return {
      id: me.id,
      n: myN,
      json: legalSong(j) ? j : null
    };
  }

  function publish() {
    if (!on || !room || !me.id) return;
    room.put(snapshot()).catch(function () {});
  }

  function publishSong(json, seq) {
    if (!on || !room || !me.id || !owner) return;
    if (!legalSong(json)) return;
    var row = {
      id: 'song',
      host: me.id,
      seq: seq || ((lastSong && lastSong.seq) || 0) + 1,
      json: json
    };
    lastSong = row;
    lastPacked = pack(json);
    room.put(row).catch(function () {});
  }

  var ingesting = false;
  function ingest(list) {
    // put() notifies subscribers sync — never re-enter or the host adopt loops the stack.
    if (ingesting) { lastList = list || []; return; }
    ingesting = true;
    try {
      lastList = list || [];
      var people = playersHere(lastList);
      var others = 0, i;
      for (i = 0; i < people.length; i++) if (people[i].id !== me.id) others++;
      var became = others > 0;
      if (became && !on) {
        on = true;
        if (getJson) frozen = getJson();
      }
      paintJam(people);
      if (!on) return;

      var canonical = songOf(lastList);
      if (canonical && legalSong(canonical.json)) {
        var packed = pack(canonical.json);
        if (packed && packed !== lastPacked) {
          lastPacked = packed;
          lastSong = canonical;
          if (applyJson) {
            applying = true;
            try { applyJson(canonical.json); } finally { applying = false; }
            coolUntil = now() + 800;
            // Absorb fromJson/toJson drift so a later getJson does not look like an edit.
            if (getJson) {
              var after = pack(getJson());
              if (after) lastPacked = after;
            }
          }
        }
      }

      if (isHost()) {
        var newest = null;
        for (i = 0; i < people.length; i++) {
          var p = people[i];
          if (!legalSong(p.json)) continue;
          if (!newest || (p.n | 0) > (newest.n | 0)) newest = p;
        }
        if (newest) {
          var np = pack(newest.json);
          var cp = canonical ? pack(canonical.json) : '';
          // Only adopt a guest song that differs from the wire canonical — and
          // defer the put so subscribe cannot re-enter this stack frame.
          if (np && np !== cp) {
            var adopt = newest.json;
            var adoptSeq = ((lastSong && lastSong.seq) || 0) + 1;
            setTimeout(function () { publishSong(adopt, adoptSeq); }, 0);
          }
        } else if (getJson && !canonical) {
          setTimeout(function () { publishSong(getJson(), 1); }, 0);
        }
      }
    } finally {
      ingesting = false;
    }
  }

  var coolUntil = 0;
  function noteLocalChange() {
    if (applying || !on || !me.id || now() < coolUntil) return;
    myN += 1;
    publish();
    if (isHost()) {
      var j = getJson && getJson();
      if (legalSong(j)) publishSong(j);
    }
  }

  function init(opts) {
    getJson = opts && opts.getJson;
    applyJson = opts && opts.applyJson;
    jamEl = document.getElementById('jam');
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });

    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      room = api.db('room');
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: playersHere(lastList).length });
        };
        setTimeout(done, 2200);
        room.subscribe(function (list) {
          ingest(list || []);
          done();
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).then(function (roomInfo) {
      on = true;
      // No publish on boot or on a timer — fromJson/toJson drifts; a host
      // interval that re-published drift fought remote applies into a stack overflow.
      // Song publishes come only from noteLocalChange (real editor edits).
      if (pubTimer) { clearInterval(pubTimer); pubTimer = 0; }
      return roomInfo;
    }).catch(function () { return { owner: true, others: 0 }; });
  }

  root.BeepNet = {
    init: init,
    noteLocalChange: noteLocalChange,
    live: function () { return on && playersHere(lastList).length > 1; }
  };

  root['__beepbox'] = {
    // Song row seq only — host id races across hand-off before republish.
    state: function () {
      var s = songOf(lastList);
      return s ? { seq: s.seq | 0 } : null;
    },
    people: function () {
      return on ? playersHere(lastList).map(function (p) { return p.id; }) : [];
    },
    amHost: function () { return isHost(); }
  };
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'bb-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
