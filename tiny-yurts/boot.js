/*
 * Tiny Yurts — GifOS shell.
 * Invite is OS chrome. Best score is private. gifos.db hydrates into the
 * localStorage stub; the title highscore is painted on after that. The jam
 * itself is a static script so the packer inlines it.
 * Who is here is gifos.people(). Publish score only when it changes.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Tiny Yurts needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = typeof gifos !== 'undefined' ? gifos : null;
  var saveDb = null, playersDb = null;
  try {
    if (api && api.db) {
      saveDb = api.db('save');
      playersDb = api.db('players');
    }
  } catch (e) {}

  var rosterEl = document.getElementById('roster');
  var me = { id: 'local', name: 'You' };
  var others = {};
  var started = false;
  var lastScore = 0;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var lastPubSig = '';

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function currentScore() {
    var v = root.localStorage && root.localStorage.getItem('Tiny Yurts');
    return v ? (parseInt(v, 10) || 0) : 0;
  }

  function paintHi(n) {
    if (!n) return;
    var nodes = document.body.querySelectorAll('div');
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].innerText || '';
      if (t.indexOf('Highscore:') === 0 || t.indexOf('Tip:') === 0) {
        nodes[i].innerText = 'Highscore: ' + n;
        break;
      }
    }
  }

  function publish() {
    if (!started || !playersDb || !me.id || me.id === 'local' || !PEOPLE) return;
    var row = { id: me.id, score: currentScore() };
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    row.name = me.name;
    row.t = Date.now();
    playersDb.put(row).catch(function () {});
  }

  function paintRoster() {
    var names = peopleNames();
    var list = [];
    if (me.id && names[me.id]) list.push({ id: me.id, name: me.name, mine: true, score: currentScore() });
    Object.keys(others).forEach(function (id) {
      if (!names[id]) return;
      var p = others[id];
      list.push({ id: p.id, name: names[id] || p.name || 'Player', mine: false, score: p.score || 0 });
    });
    if (list.length < 2) { rosterEl.hidden = true; return; }
    list.sort(function (a, b) { return b.score - a.score; });
    rosterEl.hidden = false;
    rosterEl.innerHTML = list.map(function (p) {
      return '<div class="' + (p.mine ? 'me' : '') + '">' +
        (p.name || 'Player').replace(/[<>&]/g, '') + ' · ' + p.score + '</div>';
    }).join('');
  }

  root.TYOnSave = function (key, val) {
    if (!saveDb) return;
    var rec = { id: 'prefs' };
    rec.score = root.localStorage.getItem('Tiny Yurts') || '';
    rec.sound = root.localStorage.getItem('Tiny Yurtss') || '';
    rec.grid = root.localStorage.getItem('Tiny Yurtsg') || '';
    saveDb.put(rec).catch(function () {});
    if (key === 'Tiny Yurts') {
      lastScore = parseInt(val, 10) || 0;
      publish();
      paintRoster();
    }
  };

  function hydrate(row) {
    if (!row) return;
    if (row.score) {
      root._tyMem['Tiny Yurts'] = String(row.score);
      lastScore = parseInt(row.score, 10) || 0;
    }
    if (row.sound) root._tyMem['Tiny Yurtss'] = String(row.sound);
    if (row.grid) root._tyMem['Tiny Yurtsg'] = String(row.grid);
  }

  function fitBoard() {
    var svgs = document.querySelectorAll('svg');
    var board = null;
    for (var i = 0; i < svgs.length; i++) {
      var vb = svgs[i].getAttribute('viewBox') || '';
      if (vb.indexOf('0 0 208') === 0) { board = svgs[i]; break; }
    }
    if (!board) return;
    var w = root.innerWidth || 360, h = root.innerHeight || 640;
    var portrait = h > w;
    board.style.touchAction = 'none';
    if (portrait) {
      board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      board.style.maxHeight = 'none';
      board.style.maxWidth = '100vw';
      board.style.width = '100vw';
      var boardH = Math.min(h * 0.58, w * (112 / 208) * 1.28);
      board.style.height = Math.round(boardH) + 'px';
      document.body.classList.add('portrait');
    } else {
      board.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      board.style.maxHeight = '68vw';
      board.style.maxWidth = '200vh';
      board.style.width = '100vw';
      board.style.height = '100vh';
      document.body.classList.remove('portrait');
    }
    var title = null;
    var nodes = document.body.querySelectorAll('div');
    for (var j = 0; j < nodes.length; j++) {
      if ((nodes[j].innerText || '') === 'Tiny Yurts' && nodes[j].children.length === 0) {
        title = nodes[j];
        break;
      }
    }
    if (title && w < 520) title.style.fontSize = '42px';
  }

  function pauseButton() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.style.width === '64px' && b.style.height === '64px') return b;
    }
    return null;
  }

  if (api && api.onBack) {
    var backPaused = false;
    api.onBack(function () {
      var pause = pauseButton();
      var playing = pause && parseFloat(pause.style.opacity || '0') > 0.5;
      if (playing && !backPaused) {
        pause.click();
        backPaused = true;
        return true;
      }
      backPaused = false;
      return false;
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
      roomPeople = ppl;
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        paintRoster();
      }
    }, function () {});
  }

  function bootNet() {
    if (!api || !playersDb || !PEOPLE) return;
    readRoom().then(function () {
      if (!me.id || me.id === 'local') return;
      started = true;
      playersDb.subscribe(function (list) {
        var names = peopleNames(), seen = {};
        (list || []).forEach(function (p) {
          if (!p || !p.id || p.id === me.id) return;
          if (!names[p.id]) return;
          seen[p.id] = 1;
          others[p.id] = Object.assign({}, p, { name: names[p.id] || p.name });
        });
        Object.keys(others).forEach(function (id) { if (!seen[id] || !names[id]) delete others[id]; });
        paintRoster();
      });
      publish();
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  fitBoard();
  root.addEventListener('resize', fitBoard);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', fitBoard);

  root['__tiny-yurts'] = {
    state: function () { return started ? { score: currentScore() | 0 } : null; },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return started && owner && peopleCount() > 1; }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'ty-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (!saveDb) { bootNet(); return; }
  saveDb.get('prefs').then(function (row) {
    hydrate(row);
    paintHi(currentScore());
  }).catch(function () {}).then(bootNet);
})(window);
