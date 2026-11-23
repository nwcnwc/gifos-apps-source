/*
 * Pac-Man — GifOS shell.
 *
 * Upstream is a canvas engine that listens for window keydown (arrows / space).
 * This file sizes the cabinet, keeps a d-pad under a thumb, saves the high
 * score and furthest maze in gifos.db, and publishes a cabinet roster when
 * friends are in the room (gifos.people()). Invite is OS chrome.
 */
(function (root) {
  'use strict';

  var api = typeof gifos !== 'undefined' ? gifos : null;
  var NEEDS_NEWER = 'Pac-Man needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(api && api.people);
  var saveDb = null, playersDb = null;
  try {
    if (api && api.db) {
      saveDb = api.db('save');
      playersDb = api.db('players');
    }
  } catch (e) {}

  var hiEl = document.getElementById('hi');
  var scoreEl = document.getElementById('score');
  var mazeEl = document.getElementById('maze');
  var livesEl = document.getElementById('lives');
  var statusEl = document.getElementById('status');
  var rosterEl = document.getElementById('roster');
  var stageEl = document.getElementById('stage');
  var canvas = document.getElementById('canvas');
  var wrap = document.getElementById('touch');
  var nosupport = document.getElementById('nosupport');
  var hi = 0;
  var bestLevel = 1;
  var me = { id: 'local', name: 'You' };
  var others = {};
  var lastPlayerRows = [];
  var started = false;
  var lastPub = 0;
  var lastPubSig = '';
  var roomPeople = [];
  var owner = false;
  var held = 0;
  var WASD = { KeyW: 38, KeyA: 37, KeyS: 40, KeyD: 39 };
  var KEY_ORI = { 39: 0, 40: 1, 37: 2, 38: 3 };
  var saveWarned = false;

  function P() { return root.Pacman || null; }
  function phase() { return (P() && P().phase) ? P().phase() : 'title'; }
  function scoreNow() { return (P() && P().score) ? (P().score() | 0) : 0; }
  function lifeNow() { return (P() && P().life) ? (P().life() | 0) : 0; }
  function mazeNow() {
    var i = (P() && P().stageIndex) ? P().stageIndex() : 0;
    var n = (P() && P().game) ? P().game.getStages().length : 14;
    if (i <= 0) return 1;
    if (i >= n - 1) return Math.max(1, n - 2);
    return i;
  }

  function fire(code) {
    if (P()) P()._key = code;
    try {
      root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: code }));
    } catch (err) {
      var ev = document.createEvent('Event');
      ev.initEvent('keydown', true, true);
      ev.keyCode = code;
      root.dispatchEvent(ev);
    }
    if (P()) P()._key = 0;
  }

  function sendKey(code) {
    var ph = phase();
    if ((ph === 'title' || ph === 'over') && code !== 32 && code !== 13) fire(32);
    if ((code === 37 || code === 38 || code === 39 || code === 40) && P() && P().steer && KEY_ORI[code] != null) {
      if (ph === 'title' || ph === 'over') {
        /* start() is async in the engine; steer on the next tick. */
        root.setTimeout(function () { if (P() && P().steer) P().steer(KEY_ORI[code]); }, 0);
      } else {
        P().steer(KEY_ORI[code]);
      }
    }
    fire(code);
  }

  function setHi(n) {
    hi = n | 0;
    hiEl.textContent = 'HI ' + hi;
  }

  function persistScore(n) {
    var mz = mazeNow();
    var changed = false;
    if (n > hi) { setHi(n); changed = true; }
    if (mz > bestLevel) { bestLevel = mz; changed = true; }
    if (!saveDb || !changed) return;
    saveDb.put({ id: 'hi', score: hi, bestLevel: bestLevel }).catch(function () {
      if (!saveWarned && statusEl) {
        saveWarned = true;
        statusEl.textContent = 'Couldn’t save.';
        statusEl.style.display = 'block';
      }
    });
  }

  function paintHud() {
    var s = scoreNow();
    scoreEl.textContent = String(s);
    mazeEl.textContent = String(mazeNow());
    livesEl.textContent = String(lifeNow());
    persistScore(s);
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
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      roomPeople = ppl;
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      ingestPlayers(lastPlayerRows);
    }, function () {});
  }
  function ingestPlayers(list) {
    lastPlayerRows = list || [];
    var names = peopleNames(), seen = {};
    others = {};
    lastPlayerRows.forEach(function (p) {
      if (!p || !p.id || p.id === me.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      seen[p.id] = 1;
      others[p.id] = Object.assign({}, p, { name: names[p.id] || p.name || 'Player' });
    });
    paintRoster();
    fit();
  }
  function roster() {
    var list = [{ id: me.id, name: me.name, mine: true, score: scoreNow(), life: lifeNow(), maze: mazeNow() }];
    Object.keys(others).forEach(function (id) {
      var p = others[id];
      list.push({
        id: p.id, name: p.name || 'Player', mine: false,
        score: p.score || 0, life: p.life || 0, maze: p.maze || 1
      });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  function paintRoster() {
    var list = roster();
    if (list.length < 2) {
      rosterEl.hidden = true;
      return;
    }
    rosterEl.hidden = false;
    rosterEl.innerHTML = list.map(function (p) {
      return '<div class="row' + (p.mine ? ' me' : '') + '"><span>' +
        (p.name || 'Player').replace(/[&<>]/g, '') +
        '</span><span>' + p.score + ' · maze ' + p.maze + ' · ' + p.life + ' up</span></div>';
    }).join('');
  }

  function publish() {
    if (!PEOPLE || !started || !playersDb || !me.id || me.id === 'local') return;
    if (peopleCount() < 2) return;
    var row = {
      id: me.id,
      score: scoreNow(), life: lifeNow(), maze: mazeNow()
    };
    var sig = JSON.stringify(row);
    if (sig === lastPubSig) return;
    lastPubSig = sig;
    lastPub = Date.now();
    playersDb.put(row).catch(function () {});
  }

  document.addEventListener('keydown', function (e) {
    var code = WASD[e.code];
    if (code) {
      sendKey(code);
      e.preventDefault();
    }
  });

  function padVisible() {
    try { return wrap && root.getComputedStyle(wrap).display !== 'none'; }
    catch (err) { return false; }
  }
  function phoneish() {
    if (document.body.classList.contains('touch')) return true;
    if (padVisible()) return true;
    var w = root.innerWidth || 9999;
    if (w <= 720) return true;
    try {
      if (root.matchMedia('(pointer: coarse)').matches) return true;
      if (root.matchMedia('(max-width: 720px)').matches) return true;
    } catch (err) {}
    return false;
  }

  function revealPad() {
    document.body.classList.add('touch');
    document.body.classList.remove('mouse');
    wrap.hidden = false;
    fit();
  }

  (function pad() {
    if (phoneish()) revealPad();
    else document.body.classList.add('mouse');
    document.addEventListener('touchstart', function () {
      revealPad();
    }, { passive: true });

    var btns = wrap.querySelectorAll('[data-key]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        var code = parseInt(btn.getAttribute('data-key'), 10);
        var down = function (e) {
          e.preventDefault();
          try { btn.setPointerCapture(e.pointerId); } catch (err) {}
          btn.classList.add('on');
          if (code === 32) {
            sendKey(32);
            return;
          }
          held = code;
          sendKey(code);
        };
        var up = function (e) {
          e.preventDefault();
          btn.classList.remove('on');
          if (held === code) held = 0;
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('lostpointercapture', up);
      })(btns[i]);
    }
  })();

  // Swipe on the maze — a thumb does not have to hit the pad for a turn.
  (function swipe() {
    var sx = 0, sy = 0, tracking = false;
    stageEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      tracking = true;
      sx = e.clientX; sy = e.clientY;
    });
    stageEl.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (dx * dx + dy * dy < 24 * 24) {
        if (phase() === 'title' || phase() === 'over') sendKey(32);
        return;
      }
      var code;
      if (Math.abs(dx) > Math.abs(dy)) code = dx > 0 ? 39 : 37;
      else code = dy > 0 ? 40 : 38;
      sendKey(code);
    });
    stageEl.addEventListener('pointercancel', function () { tracking = false; });
  })();

  var MAZE_X = 60, MAZE_Y = 10, MAZE_W = 560, MAZE_H = 620, CW = 960, CH = 640;
  function fit() {
    var w = root.innerWidth;
    var h = root.innerHeight;
    var phone = document.body.classList.contains('touch') || phoneish();
    var headerH = 52;
    var padH = phone ? Math.min(220, Math.max(168, h * 0.28)) : 0;
    var rosterH = rosterEl.hidden ? 0 : 52;
    var availH = Math.max(120, h - headerH - padH - rosterH - 12);
    var availW = Math.max(120, w - 12);
    if (phone) {
      var scale = Math.min(availW / MAZE_W, availH / MAZE_H);
      canvas.style.width = Math.round(CW * scale) + 'px';
      canvas.style.height = Math.round(CH * scale) + 'px';
      stageEl.style.width = Math.round(MAZE_W * scale) + 'px';
      stageEl.style.height = Math.round(MAZE_H * scale) + 'px';
      canvas.style.marginLeft = Math.round(-MAZE_X * scale) + 'px';
      canvas.style.marginTop = Math.round(-MAZE_Y * scale) + 'px';
      canvas.style.maxHeight = 'none';
    } else {
      var scaleD = Math.min(availW / CW, availH / CH);
      canvas.style.width = Math.round(CW * scaleD) + 'px';
      canvas.style.height = Math.round(CH * scaleD) + 'px';
      canvas.style.marginLeft = '0';
      canvas.style.marginTop = '0';
      stageEl.style.width = '';
      stageEl.style.height = '';
    }
  }
  fit();
  root.addEventListener('resize', fit);
  if (root.visualViewport) root.visualViewport.addEventListener('resize', fit);
  root.setTimeout(fit, 0);
  root.setTimeout(fit, 120);
  root.setTimeout(fit, 400);
  if (root.ResizeObserver) {
    try { new root.ResizeObserver(fit).observe(document.body); } catch (err) {}
  }

  function tick() {
    if (held && KEY_ORI[held] != null && P() && P().steer) P().steer(KEY_ORI[held]);
    paintHud();
    publish();
    paintRoster();
    var ph = phase();
    if (ph === 'title') statusEl.textContent = document.body.classList.contains('touch')
      ? 'Tap PAUSE or swipe the maze to start.'
      : 'Enter or Space to start. Arrows move.';
    else if (ph === 'pause') statusEl.textContent = 'Paused.';
    else if (ph === 'over') statusEl.textContent = lifeNow() ? 'You win. Space for another run.' : 'Game over. Space for another run.';
    else statusEl.textContent = 'Arrows or the pad. Space pauses.';
    root.requestAnimationFrame(tick);
  }

  function bootNet() {
    if (!api || !api.db || !playersDb) return;
    if (!PEOPLE) return;
    readRoom().then(function () {
      if (!me.id || me.id === 'local') return;
      started = true;
      playersDb.subscribe(function (list) { ingestPlayers(list || []); });
      publish();
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  root['__pacman'] = {
    state: function () {
      return started ? { score: scoreNow() | 0, maze: mazeNow() | 0 } : null;
    },
    people: function () {
      return roster().map(function (p) { return p.id; });
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'pacman-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  function load() {
    if (!canvas || !canvas.getContext || !canvas.getContext('2d')) {
      nosupport.hidden = false;
      canvas.hidden = true;
      return;
    }
    if (!saveDb) { tick(); bootNet(); return; }
    saveDb.get('hi').then(function (row) {
      if (row && row.score) setHi(row.score | 0);
      if (row && row.bestLevel) bestLevel = row.bestLevel | 0;
    }).catch(function () {
      if (statusEl) statusEl.textContent = 'Couldn’t load save.';
    }).then(function () {
      tick();
      bootNet();
    });
  }

  if (api && api.onBack) {
    api.onBack(function () {
      var ph = phase();
      if (ph === 'play') { fire(32); return true; }
      if (ph === 'die') return true;
      return false;
    });
  }

  load();
})(window);
