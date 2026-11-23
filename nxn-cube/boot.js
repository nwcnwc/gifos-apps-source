// NxN Cube — GifOS shell around NXN.Rubiks.
// Solo is the toy. In a room, the app owner publishes a scramble seed so every
// peer builds the same shuffle; each player then writes ONLY their own row.
// Who is here is gifos.people().
(function () {
  'use strict';

  var Rubiks = window.NXN && (NXN.Rubiks || NXN.default);
  if (!Rubiks) throw new Error('NXN.Rubiks missing — vendor/cube.js did not boot');

  var $ = function (id) { return document.getElementById(id); };
  var cube = new Rubiks($('stage'));

  var NEEDS_NEWER = 'NxN Cube needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 250;
  var PEOPLE = !!(typeof gifos !== 'undefined' && gifos && gifos.people);
  var me = { id: 'local', name: 'You' };
  var myMoves = 0;
  var mySolved = false;
  var mySolvedAt = 0;
  var applying = false;
  var raceRec = null;
  var roster = [];
  var lastPlayerRows = [];
  var prefsDb = null, raceDb = null, playersDb = null;
  var roomPeople = [];
  var owner = false;
  var roomRead = false;

  try {
    if (window.gifos && gifos.db) {
      prefsDb = gifos.db('prefs');
      raceDb = gifos.db('race');
      playersDb = gifos.db('players');
    }
  } catch (e) {}

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
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
    if (!PEOPLE || typeof gifos === 'undefined' || !gifos) return Promise.resolve();
    return Promise.all([
      gifos.people(),
      gifos.info ? gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      ingestPlayers(lastPlayerRows);
    }, function () {});
  }

  function setStatus(solved) {
    $('status').textContent = solved ? 'Solved' : 'Shuffled';
    $('status').className = 'stat' + (solved ? ' solved' : '');
    $('moves').textContent = String(myMoves);
  }

  function publish() {
    if (!PEOPLE || !playersDb || !me.id || me.id === 'local') return;
    if (peopleCount() < 2) return;
    playersDb.put({
      id: me.id,
      moves: myMoves,
      solved: mySolved,
      solvedAt: mySolvedAt || 0,
      seed: raceRec ? raceRec.seed : (cube.seed || 0),
      order: cube.order
    }).catch(function () {});
  }

  function ingestPlayers(list) {
    lastPlayerRows = list || [];
    var names = peopleNames();
    roster = [];
    lastPlayerRows.forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      roster.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Player' }));
    });
    paintBoard();
  }

  function paintBoard() {
    var list = roster.slice();
    if (me.id !== 'local' && !list.some(function (p) { return p.id === me.id; })) {
      list.push({ id: me.id, name: me.name, moves: myMoves, solved: mySolved, solvedAt: mySolvedAt });
    }
    list.sort(function (a, b) {
      if (a.solved && b.solved) return (a.solvedAt || 0) - (b.solvedAt || 0) || a.moves - b.moves;
      if (a.solved !== b.solved) return a.solved ? -1 : 1;
      return a.moves - b.moves;
    });
    var winner = list.find(function (p) { return p.solved; });
    $('board').innerHTML = list.map(function (p, i) {
      var cls = (p.id === me.id ? 'me' : '') + (winner && winner.id === p.id ? ' win' : '');
      var meta = p.solved
        ? ('solved · ' + p.moves)
        : (p.moves + ' move' + (p.moves === 1 ? '' : 's'));
      var tag = (winner && winner.id === p.id) ? ' · first' : '';
      return '<li class="' + cls + '"><span class="name">' + esc(p.name || 'Player') +
        tag + '</span><span class="meta">' + esc(meta) + '</span></li>';
    }).join('');
    if (list.length > 1) {
      $('race-note').textContent = winner
        ? (winner.name || 'Someone') + ' finished first. Scramble for another race.'
        : 'Same scramble. First to solved wins.';
    }
  }

  function applyRace(r) {
    if (!r || r.seed == null) return;
    if (raceRec && raceRec.seed === r.seed && raceRec.order === r.order) return;
    raceRec = { seed: r.seed, order: r.order, at: r.at, by: r.by };
    applying = true;
    if (cube.order !== r.order) {
      cube.setOrder(r.order);
      $('order').value = String(r.order);
    }
    cube.scramble(r.seed);
    myMoves = 0;
    mySolved = false;
    mySolvedAt = 0;
    applying = false;
    setStatus(false);
    publish();
    paintBoard();
  }

  cube.onTurn(function (info) {
    myMoves = info.moves;
    if (info.finish && cube.seed != null) {
      if (!mySolved) {
        mySolved = true;
        mySolvedAt = Date.now();
      }
    } else {
      mySolved = false;
      mySolvedAt = 0;
    }
    setStatus(!!info.finish);
    publish();
    paintBoard();
  });

  $('scramble').onclick = function () {
    var seed = cube.scramble();
    myMoves = 0;
    mySolved = false;
    mySolvedAt = 0;
    setStatus(false);
    // Shared raceRec only from host put (or solo). Guests must not publish a private seed.
    if (PEOPLE && peopleCount() > 1 && !owner) {
      publish();
      paintBoard();
      return;
    }
    raceRec = { seed: seed, order: cube.order, at: Date.now(), by: me.name };
    if (raceDb && PEOPLE && owner && peopleCount() > 1) {
      raceDb.put({
        id: 'race',
        seed: seed,
        order: cube.order,
        n: raceRec.at,
        byId: me.id
      }).catch(function () {});
    }
    publish();
    paintBoard();
  };

  $('restore').onclick = function () {
    cube.restore();
    myMoves = 0;
    mySolved = false;
    mySolvedAt = 0;
    setStatus(true);
    publish();
    paintBoard();
  };

  $('order').onchange = function () {
    var n = +this.value;
    cube.setOrder(n);
    myMoves = 0;
    mySolved = false;
    mySolvedAt = 0;
    setStatus(true);
    if (prefsDb) prefsDb.put({ id: 'prefs', order: n }).catch(function () {});
    if (raceDb && raceRec) {
      $('scramble').click();
      return;
    }
    publish();
    paintBoard();
  };

  if (prefsDb) {
    prefsDb.get('prefs').then(function (p) {
      if (p && p.order >= 2 && p.order <= 10 && p.order !== cube.order) {
        cube.setOrder(p.order);
        $('order').value = String(p.order);
      }
    }).catch(function () {});
  }

  function boot() {
    var roomP = PEOPLE ? readRoom() : Promise.resolve();
    if (!PEOPLE && window.gifos && gifos.me) {
      gifos.me().then(function (id) {
        me.id = (id && id.id) || 'local';
        me.name = (id && id.name) || 'You';
      }).catch(function () {});
    }
    roomP.then(function () {
      if (PEOPLE && playersDb) {
        playersDb.subscribe(function (list) { ingestPlayers(list || []); });
      }
      if (PEOPLE && raceDb) {
        raceDb.subscribe(function (list) {
          var r = (list || []).find(function (x) { return x && x.id === 'race'; });
          if (r && !applying) applyRace(r);
        });
      }
      if (PEOPLE) setInterval(readRoom, PEOPLE_MS);
      publish();
      paintBoard();
    }).catch(function () {});
  }

  window['__nxn-cube'] = {
    state: function () {
      if (!raceRec) return null;
      return { seed: raceRec.seed | 0, order: raceRec.order | 0 };
    },
    people: function () {
      if (PEOPLE && typeof gifos !== 'undefined' && gifos) readRoom();
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      if (PEOPLE && typeof gifos !== 'undefined' && gifos) readRoom();
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'nxn-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  boot();
  setStatus(true);
})();
