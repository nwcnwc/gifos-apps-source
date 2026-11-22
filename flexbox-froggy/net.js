/*
 * Shared pond. Each player writes only THEIR row in `players`.
 * Highest seq wins — whoever typed last, the frogs hop on both screens.
 * Who is here is gifos.people() — the frogs along the water are the room.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Flexbox Froggy needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;
  var TYPING_MS = 450;

  var api = null;
  var me = { id: null, name: 'Frog' };
  var owner = true;
  var others = {};
  var seq = 0;
  var lastAdopted = 0;
  var lastType = 0;
  var peopleTimer = 0;
  var onMates = null;
  var lastList = [];
  var colors = ['green', 'yellow', 'red'];

  function now() { return Date.now(); }
  function db(n) { return api.db(n); }

  function tint(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Frog';
    }
    return m;
  }

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(p);
    });
    return out;
  }

  function snapshot() {
    var g = root.Froggy;
    var code = '';
    var el = document.getElementById('code');
    if (el) code = el.value;
    return {
      id: me.id,
      color: tint(me.id || 'x'),
      level: g ? g.level : 0,
      code: code,
      seq: seq,
      winning: !!(g && g.winning)
    };
  }

  function publish() {
    if (!PEOPLE || !api || !me.id) return;
    db('players').put(snapshot()).catch(function () {});
  }

  function bump(why) {
    seq += 1;
    if (why === 'type') lastType = now();
    publish();
  }

  function adopt(p) {
    var g = root.Froggy;
    if (!g) return;
    lastAdopted = p.seq | 0;
    if (p.winning) {
      if (!g.winning) g.win();
      return;
    }
    if ((p.level | 0) !== g.level || g.winning) {
      g.goLevel(p.level | 0, p.code || '');
    } else {
      g.setCode(p.code || '');
    }
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

  function ingest(list) {
    lastList = list || [];
    var players = live(lastList);
    others = {};
    players.forEach(function (p) {
      if (p.id === me.id) {
        if ((p.seq | 0) > seq) seq = p.seq | 0;
        return;
      }
      others[p.id] = p;
    });
    var leader = pickLeader(players);
    if (leader && leader.id !== me.id && (leader.seq | 0) > lastAdopted) {
      var typing = (now() - lastType) < TYPING_MS;
      if (!typing) adopt(leader);
    }
    paint();
  }

  function roster() {
    var players = live(lastList);
    var names = peopleNames();
    var out = [];
    var seen = {};
    players.forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = 1;
      out.push({
        id: p.id,
        name: names[p.id] || p.name || 'Frog',
        me: p.id === me.id,
        color: p.color || tint(p.id)
      });
    });
    if (me.id && names[me.id] && !seen[me.id]) {
      out.unshift({ id: me.id, name: names[me.id] || me.name, me: true, color: tint(me.id) });
    }
    return out;
  }

  function paint() {
    var list = roster();
    var mates = document.getElementById('mates');
    var pond = document.getElementById('pond-frogs');
    var roomy = list.length > 1;
    if (!mates || !pond) return;
    if (!roomy) {
      mates.hidden = true;
      pond.hidden = true;
      mates.innerHTML = '';
      pond.innerHTML = '';
      return;
    }
    mates.hidden = false;
    pond.hidden = false;
    mates.innerHTML = list.map(function (p) {
      return '<span class="mate' + (p.me ? ' me' : '') + '">' +
        '<span class="dot" style="background:' + frogHex(p.color) + '"></span>' +
        esc(p.name) + (p.me ? ' (you)' : '') +
        '</span>';
    }).join('');
    pond.innerHTML = list.map(function (p) {
      return '<div class="pond-frog">' +
        '<div class="sprite ' + p.color + '"></div>' +
        '<div class="who">' + esc(p.name) + (p.me ? ' (you)' : '') + '</div>' +
        '</div>';
    }).join('');
    if (onMates) onMates(list);
  }

  function frogHex(c) {
    return c === 'red' ? '#E45454' : c === 'yellow' ? '#F5D14A' : '#69DA6B';
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]);
    });
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
      var wasOwner = owner;
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'Frog'; }
      if (!wasOwner && owner && roomRead) {
        // New owner rejoins the shared pond after hand-off (P2).
        bump('join');
      }
      if (key !== roomKey) {
        roomKey = key;
        ingest(lastList);
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) {
      return Promise.resolve({ owner: true, others: 0, needsNewer: true });
    }
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: Math.max(0, roster().length - 1) });
        };
        setTimeout(done, 2200);
        db('players').subscribe(function (list) {
          ingest(list || []);
          done();
        });
        bump('join');
        if (peopleTimer) clearInterval(peopleTimer);
        peopleTimer = setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  root.Pond = {
    init: init,
    bump: bump,
    publish: publish,
    roster: roster,
    me: function () { return me; },
    owner: function () { return owner; },
    live: function () { return !!api && !!me.id && PEOPLE; },
    count: function () { return roster().length; },
    onMates: function (fn) { onMates = fn; }
  };

  root['__flexbox-froggy'] = {
    state: function () {
      // Level only — code/seq race on every keystroke (K8).
      var players = live(lastList);
      var leader = pickLeader(players);
      if (!leader) return null;
      return { level: leader.level | 0 };
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
      return PEOPLE && owner && n > 1;
    }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'ff-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
