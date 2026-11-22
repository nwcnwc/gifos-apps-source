// Play a friend — a race on the same puzzle, not a shared program.
//
// Shared (round, levelId) so both people work the same picture. Each player
// publishes solved + step count on THEIR row. Nobody writes anybody else's
// row, and the functions themselves never leave this device. First to match
// the goal wins. Who is here is gifos.people(). The app owner hosts the
// shared level; GifOS hands that on when they leave. Invite is OS chrome.
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Cube Composer needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var myLevel = null;
  var round = 1;
  var usedLevel = null;
  var usedRound = 0;
  var lastList = [];
  var roundOver = false;
  var solvedAt = 0;
  var declined = false;
  var lastPub = 0;

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
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

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push({
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        levelId: p.levelId,
        round: p.round,
        steps: p.steps,
        solved: p.solved,
        solvedAt: p.solvedAt
      });
    });
    return out;
  }

  // Highest round anyone has published; prefer the app owner's level on that
  // round, else the lexicographically smallest id. Deterministic; never needs
  // a shared row.
  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.levelId; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return { round: maxR, levelId: a.levelId, by: a.id };
  }

  function snapshot() {
    var g = root.CCGame;
    return {
      id: me.id,
      levelId: myLevel || (g && g.levelId),
      round: round,
      steps: g ? g.program.length : 0,
      solved: !!(g && g.solved),
      solvedAt: solvedAt || 0
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
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
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && !on && !declined) {
        var n = 0, id, names = peopleNames();
        for (id in names) if (id !== me.id) n++;
        if (n > 0) enter();
      } else if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else maybeEnterFromPeople();
      }
    }, function () {});
  }

  function maybeEnterFromPeople() {
    if (on || declined || !PEOPLE) return;
    var names = peopleNames(), id, n = 0;
    for (id in names) { if (id !== me.id) n++; }
    if (n > 0) enter();
  }

  function applyLevel(levelId, r) {
    usedLevel = levelId;
    usedRound = r;
    round = r;
    myLevel = levelId;
    roundOver = false;
    solvedAt = 0;
    if (root.CCGame) root.CCGame.goLevel(levelId, { race: true, fresh: true });
    lastPub = 0;
    publish();
  }

  function verdict(players) {
    var won = players.filter(function (p) { return p.solved; });
    if (!won.length) return null;
    won.sort(function (a, b) {
      return (a.solvedAt || 0) - (b.solvedAt || 0) ||
        (a.steps || 0) - (b.steps || 0);
    });
    return { winner: won[0] };
  }

  function render() {
    if (!on) return;
    var players = live(lastList);
    var v = verdict(players);
    var status = $('friend-status');
    var scores = $('friend-scores');
    var again = $('againBtn');
    var html = '';
    players.sort(function (a, b) {
      if (a.solved && b.solved) return (a.solvedAt || 0) - (b.solvedAt || 0);
      if (a.solved !== b.solved) return a.solved ? -1 : 1;
      return (a.steps || 0) - (b.steps || 0);
    });
    players.forEach(function (p) {
      var mine = p.id === me.id;
      var tag = p.solved
        ? ('solved · ' + (p.steps || 0))
        : ((p.steps || 0) + ' step' + ((p.steps || 0) === 1 ? '' : 's'));
      html += '<li class="' + (mine ? 'me' : '') + (p.solved ? ' win' : '') + '">' +
        '<span class="name">' + (mine ? 'You' : esc(p.name || 'Player')) + '</span>' +
        '<span class="meta">' + tag + '</span></li>';
    });
    scores.innerHTML = html;

    var others = players.filter(function (p) { return p.id !== me.id; });
    if (v) {
      roundOver = true;
      var mineWin = v.winner.id === me.id;
      var who = mineWin ? 'You' : (v.winner.name || 'They');
      status.textContent = who + ' matched the picture' +
        (v.winner.steps != null ? ' in ' + v.winner.steps + ' step' + (v.winner.steps === 1 ? '' : 's') : '') + '.';
      again.hidden = false;
    } else {
      roundOver = false;
      again.hidden = true;
      if (!others.length) {
        status.innerHTML = 'Press <b>Invite</b> to send the link. Same puzzle — first to match.';
      } else if (root.CCGame && root.CCGame.solved) {
        status.textContent = 'You matched it. Waiting to see if anyone was first.';
      } else {
        status.textContent = others.length === 1
          ? ((others[0].name || 'Friend') + ' is on ' + (others[0].steps || 0) + ' step' + ((others[0].steps || 0) === 1 ? '' : 's') + '.')
          : (others.length + ' playing. First to match the picture wins.');
      }
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && (ad.levelId !== usedLevel || ad.round !== usedRound)) {
      if (ad.by !== me.id) myLevel = ad.levelId;
      applyLevel(ad.levelId, ad.round);
    }
    render();
  }

  function startRace() {
    on = true;
    document.body.classList.add('friend');
    $('friend-bar').hidden = false;
    $('friendBtn').hidden = true;
    $('levels').disabled = true;
    myLevel = (root.CCGame && root.CCGame.levelId) || '0.1';
    round = 1;
    usedLevel = null;
    usedRound = 0;
    roundOver = false;
    solvedAt = 0;
    if (!usedLevel) applyLevel(myLevel, round);
    else { lastPub = 0; publish(); render(); }
  }

  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      document.body.classList.add('friend');
      $('friend-bar').hidden = false;
      $('friendBtn').hidden = true;
      $('friend-status').textContent = 'Play a friend needs a GifOS room.';
      return true;
    }
    if (!PEOPLE) {
      document.body.classList.add('friend');
      $('friend-bar').hidden = false;
      $('friendBtn').hidden = true;
      $('friend-status').textContent = NEEDS_NEWER;
      return true;
    }
    if (on) return true;
    declined = false;
    room = room || api.db('players');
    readRoom().then(function () {
      if (!me.id) return;
      watch();
      startRace();
    }).catch(function () {});
    return true;
  }

  function watch() {
    api = root.gifos;
    if (!api || !api.db || !PEOPLE) return;
    room = room || api.db('players');
    readRoom().then(function () {
      if (subscribed) return;
      subscribed = true;
      room.subscribe(function (list) {
        lastList = list || [];
        if (!on) {
          if (declined) return;
          maybeEnterFromPeople();
        } else {
          onRoom(lastList);
        }
      });
      setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }

  function leave() {
    on = false;
    declined = true;
    roundOver = false;
    document.body.classList.remove('friend');
    $('friend-bar').hidden = true;
    $('friendBtn').hidden = false;
    $('againBtn').hidden = true;
    $('levels').disabled = false;
    if (room && me.id) room.delete(me.id).catch(function () {});
  }

  function playAgain() {
    if (!on || !roundOver) return;
    var next = root.CC && root.CC.nextLevel(usedLevel || myLevel);
    myLevel = next;
    round = (usedRound || round || 1) + 1;
    applyLevel(myLevel, round);
  }

  function onSolved() {
    if (!on) return;
    if (!solvedAt) solvedAt = now();
    lastPub = 0;
    publish();
    render();
  }

  function onChange() {
    if (!on) return;
    lastPub = 0;
    publish();
    render();
  }

  root.CCMp = {
    enter: enter,
    leave: leave,
    playAgain: playAgain,
    onSolved: onSolved,
    onChange: onChange,
    watch: watch,
    get on() { return on; }
  };

  root['__cube-composer'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, levelId: ad.levelId || '' };
      return on ? { round: (usedRound || round || 0) | 0, levelId: usedLevel || myLevel || '' } : null;
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return on && owner && n > 1;
    }
  };

  $('friendBtn').addEventListener('click', function (e) { e.preventDefault(); enter(); });
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
  $('againBtn').addEventListener('click', function (e) { e.preventDefault(); playAgain(); });

  watch();
  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'cc-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
