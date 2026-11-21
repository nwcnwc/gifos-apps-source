/*
 * Invite shares a game, a level, and the blocks on it.
 * Each player writes only THEIR row. Highest seq is the shared board.
 * Who is here is gifos.people(); the app owner is the host for checks.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Blockly Games needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);

  var api = null, me = { id: null, name: 'Player' }, owner = false;
  var seq = 0, lastAdopted = 0, lastList = [];
  var roomPeople = [], roomKey = '', roomRead = false, live = false;

  function now() { return Date.now(); }
  function db(n) { return api.db(n); }

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
      if (mine) { me.id = mine.id; me.name = mine.name || 'Player'; }
      if (handed && ppl.length > 1) { live = true; if (me.id) publish(); }
      if (changed) { roster(lastList); }
    }, function () {});
  }

  function snapshot() {
    var g = root.BG;
    return {
      id: me.id,
      game: g ? g.game : 'home',
      level: g ? g.level : 1,
      xml: g ? g.xml() : '',
      seq: seq
    };
  }

  function publish() {
    if (!api || !me.id || !live) return;
    db('players').put(snapshot()).catch(function () {});
  }

  function bump() {
    seq += 1;
    publish();
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
      if (!p || !p.id || !Object.prototype.hasOwnProperty.call(names, p.id) || seen[p.id]) continue;
      seen[p.id] = true;
      out.push(Object.assign({}, p, { name: names[p.id] || 'Player' }));
    }
    return out;
  }

  function pickLeader(players) {
    var best = null;
    players.forEach(function (p) {
      if (!best || (p.seq | 0) > (best.seq | 0) ||
          ((p.seq | 0) === (best.seq | 0) && p.id < best.id)) {
        best = p;
      }
    });
    return best;
  }

  function roster(list) {
    lastList = list || lastList;
    var el = document.getElementById('roster');
    if (!el) return;
    var names = [];
    playersHere(lastList).forEach(function (p) {
      names.push((p.name || 'Player') + (p.id === me.id ? ' (you)' : '') +
        (p.game && p.game !== 'home' ? ' · ' + p.game + ' ' + (p.level || '') : ''));
    });
    if (names.length < 2) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = names.join(' · ');
  }

  function ingest(list) {
    roster(list);
    var crowd = playersHere(list);
    if (crowd.length < 2) return;
    var lead = pickLeader(crowd);
    if (!lead || lead.id === me.id) return;
    if ((lead.seq | 0) <= lastAdopted) return;
    lastAdopted = lead.seq | 0;
    if (root.BG && root.BG.adopt) root.BG.adopt(lead);
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) {
      var el = document.getElementById('roster');
      if (el) { el.hidden = false; el.textContent = NEEDS_NEWER; }
      return Promise.resolve({ owner: true, others: 0 });
    }
    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      live = true;
      db('players').subscribe(function (list) { ingest(list || []); });
      publish();
      setInterval(readRoom, PEOPLE_MS);
      return { owner: owner, others: playersHere(lastList).length };
    }).catch(function () { return { owner: true, others: 0 }; });
  }

  root.Net = {
    init: init,
    bump: bump,
    publish: publish,
    live: function () { return live; },
    me: function () { return me; }
  };

  root['__blockly-games'] = {
    state: function () {
      var crowd = playersHere(lastList);
      var lead = pickLeader(crowd);
      return lead ? { game: lead.game, level: lead.level | 0, seq: lead.seq | 0 } : null;
    },
    people: function () {
      return live ? playersHere(lastList).map(function (p) { return p.id; }) : [];
    },
    amHost: function () { return live && owner; }
  };
})(window);
