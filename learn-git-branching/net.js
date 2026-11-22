/* Same-level race. Each player owns one row. The shared level is the
 * highest round anyone published; first to match the goal wins.
 *
 * Invite remounts the GIF in a new room. `on` dies with the page, so
 * join cannot be a one-shot 1.8s window: keep watching, rejoin if we
 * were racing, and a guest (info.owner === false) joins without a tap.
 * The owner/lead row wins a tie so the host's lesson is the one that
 * lands, not whoever published intro-commits first.
 * Who is here is gifos.people(). Publish only when progress changes. */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Learn Git Branching needs a newer GifOS to race with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var owner = true;
  var on = false;
  var subscribed = false;
  var round = 1;
  var myLevel = null;
  var usedLevel = null;
  var usedRound = 0;
  var lastList = [];
  var solvedAt = 0;
  var roundOver = false;
  var declined = false;
  var roomPeople = [];
  var roomKey = '';
  var lastPubSig = '';

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Someone' }));
    });
    return out;
  }

  function othersOf(list) {
    return live(list).filter(function (p) { return p.id && p.id !== me.id; });
  }

  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.levelId; });
    if (!cand.length) return null;
    var leads = cand.filter(function (p) { return p.lead; });
    if (leads.length) cand = leads;
    cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return { round: maxR, levelId: cand[0].levelId, by: cand[0].id };
  }

  function snapshot() {
    var g = root.LGBApp;
    return {
      id: me.id,
      levelId: myLevel || (g && g.levelId),
      round: round,
      commands: g ? g.commandCount : 0,
      solved: !!(g && g.solved),
      solvedAt: solvedAt || 0,
      lead: !!owner
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var row = snapshot();
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    row.name = me.name;
    row.at = now();
    room.put(row).catch(function () {});
  }

  function markRacing(v) {
    var g = root.LGBApp;
    if (!g) return;
    g.racing = !!v;
    if (g.touchSave) g.touchSave();
  }

  function applyLevel(levelId, r) {
    usedLevel = levelId;
    usedRound = r;
    round = r;
    myLevel = levelId;
    roundOver = false;
    solvedAt = 0;
    lastPubSig = '';
    if (root.LGBApp) root.LGBApp.goLevel(levelId, { race: true, fresh: true });
    publish();
  }

  function verdict(players) {
    var won = players.filter(function (p) { return p.solved; });
    if (!won.length) return null;
    won.sort(function (a, b) {
      return (a.solvedAt || a.at || 0) - (b.solvedAt || b.at || 0) ||
        (a.commands || 0) - (b.commands || 0);
    });
    return { winner: won[0] };
  }

  function showBar(show) {
    var bar = $('friend-bar');
    var btn = $('friendBtn');
    if (bar) bar.hidden = !show;
    if (btn) btn.hidden = !!show;
  }

  function paint(list) {
    lastList = list || [];
    var players = live(lastList);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var again = $('againBtn');
    if (!on) {
      showBar(false);
      return;
    }
    showBar(true);
    var ad = adopted(lastList);
    if (ad && (ad.levelId !== usedLevel || ad.round !== usedRound)) {
      var follow = !owner || (ad.round || 1) > usedRound;
      if (follow) applyLevel(ad.levelId, ad.round);
    }
    var v = verdict(players);
    if (v && !roundOver) {
      roundOver = true;
      if (again) again.hidden = false;
    }
    if (status) {
      if (!PEOPLE) status.textContent = NEEDS_NEWER;
      else if (players.length < 2) status.textContent = 'Waiting for a friend… send the Invite in the bar above.';
      else if (v) {
        status.textContent = (v.winner.id === me.id ? 'You' : (v.winner.name || 'Friend')) +
          ' solved it in ' + (v.winner.commands || 0) + ' commands.';
      } else {
        var lv = root.LGB_LEVELS && root.LGB_LEVELS.levels[myLevel];
        status.textContent = 'Same lesson' + (lv ? ': ' + lv.name : '') + '. First to match the goal wins.';
      }
    }
    if (scores) {
      scores.innerHTML = players.map(function (p) {
        var you = p.id === me.id ? ' (you)' : '';
        var mark = p.solved ? ' ✓' : '';
        return '<li' + (p.id === me.id ? ' class="me"' : '') + '>' +
          esc(p.name || 'Someone') + you + ' · ' + (p.commands || 0) + ' cmds' + mark + '</li>';
      }).join('');
    }
    if (again) again.hidden = !v;
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        maybeAutoJoin();
        if (on) paint(lastList);
      }
    }, function () {});
  }

  function join(levelId) {
    if (declined || !PEOPLE) return;
    var already = on;
    on = true;
    if (owner) markRacing(true);
    myLevel = levelId || myLevel || (root.LGBApp && root.LGBApp.levelId);
    round = Math.max(round, usedRound, 1);
    showBar(true);
    if (!already) {
      usedLevel = null;
      usedRound = 0;
      lastPubSig = '';
    }
    var ad = adopted(lastList);
    if (!owner && ad && ad.levelId) {
      applyLevel(ad.levelId, ad.round);
    } else {
      usedLevel = myLevel;
      usedRound = round;
      publish();
    }
  }

  function maybeAutoJoin() {
    if (on || declined || !PEOPLE) return;
    var others = othersOf(lastList);
    var racing = !!(root.LGBApp && root.LGBApp.racing);
    if (!owner || others.length || racing) {
      var ad = adopted(lastList);
      var mine = (root.LGBApp && root.LGBApp.levelId) || myLevel;
      join(owner || racing ? mine : ((ad && ad.levelId) || mine));
    }
  }

  function ingest(list) {
    lastList = list || [];
    maybeAutoJoin();
    paint(lastList);
  }

  function bootJoin() {
    maybeAutoJoin();
    if (on) paint(lastList);
  }

  var Net = {
    init: function () {
      api = root.gifos;
      if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
      if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });
      return readRoom().then(function () {
        if (!me.id) return { owner: true, others: 0 };
        room = api.db('players');
        return new Promise(function (resolve) {
          var done = false;
          var finish = function () {
            if (done) return;
            done = true;
            resolve({ owner: owner, others: othersOf(lastList).length });
          };
          setTimeout(finish, 1800);
          if (subscribed) {
            ingest(lastList);
            finish();
            return;
          }
          subscribed = true;
          room.subscribe(function (list) {
            ingest(list || []);
            finish();
          });
          setInterval(readRoom, PEOPLE_MS);
        });
      }).catch(function () { return { owner: true, others: 0 }; });
    },
    join: join,
    bootJoin: bootJoin,
    leave: function () {
      on = false;
      declined = true;
      roundOver = false;
      markRacing(false);
      showBar(false);
      if (room && me.id) room.delete(me.id).catch(function () {});
    },
    live: function () { return on && PEOPLE; },
    owner: function () { return owner; },
    onSolved: function () {
      if (!on) return;
      if (!solvedAt) solvedAt = now();
      publish();
    },
    onCommand: function () { if (on) publish(); },
    onLevel: function (levelId) {
      myLevel = levelId;
      if (!on) return;
      round += 1;
      usedLevel = levelId;
      usedRound = round;
      roundOver = false;
      solvedAt = 0;
      lastPubSig = '';
      publish();
    },
    nextRound: function (levelId) {
      if (!on) return;
      round += 1;
      applyLevel(levelId, round);
    },
    me: function () { return me; }
  };

  root.LGBNet = Net;

  root['__learn-git-branching'] = {
    state: function () {
      return on ? { round: usedRound || round | 0, levelId: usedLevel || myLevel || '' } : null;
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () { return on && owner && peopleCount() > 1; }
  };
})(typeof window !== 'undefined' ? window : this);
