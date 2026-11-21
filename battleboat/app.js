/*
 * Battleboat — shell: placement, solo vs the computer, two-device play.
 *
 * Solo is the original: you place, you fire, the AI fires back. Play a
 * friend: each person writes ONLY their own shots and the revealed cells
 * of their own fleet. Ship positions stay in a private collection.
 */
(function () {
  'use strict';

  var BB = window.BB;
  var $ = function (id) { return document.getElementById(id); };
  var SIZE = BB.SIZE;
  var REPLY_MS = 280;

  var mode = 'cpu';
  var solo = null;
  var placing = true;
  var placeType = '';
  var placeDir = BB.VERTICAL;
  var preview = [];
  var mpOn = false;
  var mpLocal = null;
  var prefsDb = null;
  var secretDb = null;
  var stats = { gamesPlayed: 0, gamesWon: 0, totalShots: 0, totalHits: 0 };
  var lastEnemy = null;
  var lastOwn = null;
  var busy = false;
  var replyTimer = 0;
  var picked = false;   // the player chose a local game: do not pull them into the shared one
  var EN = { needsNewer: 'Battleboat needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);

  try {
    if (window.gifos) {
      prefsDb = gifos.db('prefs');
      secretDb = gifos.db('secret');
    }
  } catch (e) {}

  function setChip(cls, text) {
    $('chip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('chipText').textContent = text;
  }
  function setStatus(text, cls) {
    $('status').className = 'statusline' + (cls ? ' ' + cls : '');
    $('status').textContent = text;
  }
  function setPhase(p) {
    document.body.classList.remove('setup', 'place', 'hunting', 'over');
    document.body.classList.add(p);
  }

  function clsFor(t, fog) {
    if (fog && t === BB.SHIP) t = BB.EMPTY;
    if (t === BB.SHIP) return 'cell ship';
    if (t === BB.MISS) return 'cell miss';
    if (t === BB.HIT) return 'cell hit';
    if (t === BB.SUNK) return 'cell sunk';
    return 'cell';
  }

  function paintGrid(el, grid, opts) {
    opts = opts || {};
    var fog = !!opts.fog;
    var cells = el.children;
    var i = 0, x, y, t, cls, px;
    var pending = opts.pending || [];
    var pend = {};
    var last = opts.last || null;
    for (i = 0; i < pending.length; i++) pend[pending[i].x + ',' + pending[i].y] = 1;
    i = 0;
    for (x = 0; x < SIZE; x++) for (y = 0; y < SIZE; y++) {
      t = grid ? grid.at(x, y) : BB.EMPTY;
      if (opts.board) t = Number(opts.board.charAt(x * SIZE + y) || 0);
      cls = clsFor(t, fog);
      if (opts.preview) {
        for (px = 0; px < opts.preview.length; px++) {
          if (opts.preview[px].x === x && opts.preview[px].y === y) {
            cls += opts.previewOk ? ' preview' : ' preview-bad';
          }
        }
      }
      if (pend[x + ',' + y] && t === BB.EMPTY) cls += ' pending';
      if (last && last.x === x && last.y === y) cls += ' last';
      if (cells[i]) cells[i].className = cls;
      i++;
    }
  }

  function paintFromBoard(el, board, pending, last) {
    var fake = { at: function (x, y) { return Number((board || '').charAt(x * SIZE + y) || 0); } };
    paintGrid(el, fake, { fog: true, pending: pending, last: last });
  }

  function hitCell(el, ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return null;
    if (t.parentNode !== el) t = t.closest ? t.closest('.cell') : t;
    if (!t || t.parentNode !== el) return null;
    var x = parseInt(t.getAttribute('data-x'), 10);
    var y = parseInt(t.getAttribute('data-y'), 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x: x, y: y };
  }

  function buildGrid(el) {
    el.innerHTML = '';
    var x, y, b;
    for (x = 0; x < SIZE; x++) for (y = 0; y < SIZE; y++) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.setAttribute('data-x', x);
      b.setAttribute('data-y', y);
      b.setAttribute('aria-label', 'Row ' + (x + 1) + ' column ' + (y + 1));
      el.appendChild(b);
    }
  }

  function pipRow(n) {
    var s = '', i;
    for (i = 0; i < n; i++) s += '<i></i>';
    return s;
  }

  function renderRoster(fleet) {
    var ul = $('roster');
    ul.innerHTML = '';
    BB.TYPES.forEach(function (spec) {
      var ship = fleet.findByType(spec.id);
      var li = document.createElement('li');
      li.setAttribute('data-type', spec.id);
      li.innerHTML = '<span class="len">' + pipRow(spec.len) + '</span>' + (spec.short || spec.name);
      if (ship && ship.placed) li.className = 'placed';
      else if (placeType === spec.id) li.className = 'placing';
      if (ship && ship.placed && mpOn && placing) {
        // the shared game starts with a random fleet: tapping the list takes the ships up to place them by hand
        li.addEventListener('click', placeByHand);
      }
      if (!ship || !ship.placed) {
        li.addEventListener('click', function () {
          placeType = spec.id;
          renderRoster(fleet);
          clearPreview();
        });
      }
      ul.appendChild(li);
    });
  }

  function renderPips(lost) {
    var ul = $('pips');
    if (!ul) return;
    ul.innerHTML = '';
    var set = {};
    var i;
    if (Array.isArray(lost)) for (i = 0; i < lost.length; i++) set[lost[i]] = 1;
    BB.TYPES.forEach(function (spec) {
      var li = document.createElement('li');
      li.className = set[spec.id] ? 'sunk' : '';
      li.setAttribute('title', spec.name);
      li.innerHTML = pipRow(spec.len);
      ul.appendChild(li);
    });
  }

  function showHuntBar(lost) {
    $('huntBar').hidden = false;
    renderPips(lost || []);
  }
  function hideHuntBar() { $('huntBar').hidden = true; }

  function ghostCells(fleet, x, y) {
    var spec = BB.typeById(placeType);
    if (!spec) return { ok: false, cells: [] };
    var ship = fleet.findByType(placeType);
    if (!ship || ship.placed) return { ok: false, cells: [] };
    var cells = [], i, cx, cy;
    for (i = 0; i < spec.len; i++) {
      cx = placeDir === BB.VERTICAL ? x + i : x;
      cy = placeDir === BB.VERTICAL ? y : y + i;
      cells.push({ x: cx, y: cy });
    }
    return { ok: ship.fits(fleet.grid, x, y, placeDir), cells: cells };
  }

  function clearPreview() {
    preview = [];
    if (mpOn && mpLocal) paintGrid($('humanGrid'), mpLocal.grid, { last: lastOwn });
    else if (solo) paintGrid($('humanGrid'), solo.humanGrid, { last: lastOwn });
  }

  function showPreview(x, y, fleet) {
    if (!placing || !placeType) { clearPreview(); return; }
    var g = ghostCells(fleet, x, y);
    preview = g.cells;
    paintGrid($('humanGrid'), fleet.grid, { preview: g.cells, previewOk: g.ok });
  }

  function updateStartBtn(fleet) {
    var all = fleet.allPlaced();
    $('startBtn').hidden = !all;
    $('rotateBtn').hidden = all;
    $('scatterBtn').hidden = all;
    if (all) {
      if (mpOn) setStatus('Ships placed. Press Ready, or tap the ship list to place them by hand.');
      else setStatus('Ships placed. Start when you are ready.');
    }
  }

  /* ---- stats ---- */
  function loadStats() {
    if (!prefsDb) return;
    prefsDb.get('stats').then(function (row) {
      if (!row) return;
      stats.gamesPlayed = row.gamesPlayed || 0;
      stats.gamesWon = row.gamesWon || 0;
      stats.totalShots = row.totalShots || 0;
      stats.totalHits = row.totalHits || 0;
      paintSetupStats();
    }).catch(function () {});
  }
  function saveStats() {
    if (!prefsDb) return;
    prefsDb.put({
      id: 'stats',
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
      totalShots: stats.totalShots,
      totalHits: stats.totalHits
    }).catch(function () {});
  }
  function paintSetupStats() {
    if (!stats.gamesPlayed) { $('setupStats').textContent = ''; return; }
    var acc = stats.totalShots ? Math.round(100 * stats.totalHits / stats.totalShots) : 0;
    $('setupStats').textContent = 'Won ' + stats.gamesWon + ' of ' + stats.gamesPlayed + ' · ' + acc + '% hits';
  }

  function paintSolo() {
    if (!solo) return;
    paintGrid($('humanGrid'), solo.humanGrid, { last: lastOwn });
    paintGrid($('enemyGrid'), solo.computerGrid, { fog: true, last: lastEnemy });
    showHuntBar(solo.computerFleet.lostTypes());
  }

  /* ---- solo ---- */
  function beginCpu() {
    picked = true;
    $('leaveBtn').hidden = false;
    mode = 'cpu';
    mpOn = false;
    busy = false;
    if (replyTimer) { clearTimeout(replyTimer); replyTimer = 0; }
    lastEnemy = null;
    lastOwn = null;
    solo = new BB.Solo();
    placing = true;
    placeType = 'carrier';
    placeDir = BB.VERTICAL;
    $('setup').hidden = true;
    $('game').hidden = false;
    $('inviteHint').hidden = true;
    $('leaveBtn').textContent = 'Leave';
    $('gameTitle').textContent = 'Computer';
    $('enemyTitle').textContent = 'Enemy fleet';
    $('overBar').hidden = true;
    $('placeBar').hidden = false;
    hideHuntBar();
    setPhase('place');
    setChip('ready', 'Computer');
    setStatus('Pick a ship, then tap your map. Rotate if you need to.');
    renderRoster(solo.humanFleet);
    paintGrid($('humanGrid'), solo.humanGrid, {});
    paintGrid($('enemyGrid'), solo.computerGrid, { fog: true });
    updateStartBtn(solo.humanFleet);
    $('startBtn').textContent = 'Start';
  }

  function startSolo() {
    if (!solo.start()) return;
    placing = false;
    $('placeBar').hidden = true;
    setPhase('hunting');
    setStatus('Your shot. Tap the enemy map.');
    setChip('ready', 'Your shot');
    paintSolo();
  }

  function fireSolo(x, y) {
    if (!solo || placing || solo.over || busy) return;
    var r = solo.fire(x, y);
    if (!r) return;
    lastEnemy = { x: x, y: y };
    paintSolo();
    if (solo.over) {
      finishSolo();
      return;
    }
    if (r.result === BB.MISS) setStatus('Miss.');
    else if (r.result === BB.SUNK) setStatus('You sank a ship.');
    else setStatus('Hit.');
    busy = true;
    setChip('', 'Their shot');
    replyTimer = setTimeout(function () {
      replyTimer = 0;
      busy = false;
      if (!solo || solo.over) return;
      var reply = solo.reply();
      if (reply) lastOwn = { x: reply.x, y: reply.y };
      paintSolo();
      if (solo.over) {
        finishSolo();
        return;
      }
      setStatus('Your shot. Tap the enemy map.');
      setChip('ready', 'Your shot');
    }, REPLY_MS);
  }

  function finishSolo() {
    busy = false;
    var win = solo.winner === 'human';
    stats.gamesPlayed++;
    if (win) stats.gamesWon++;
    stats.totalShots += solo.shots;
    stats.totalHits += solo.hits;
    saveStats();
    setPhase('over');
    setChip(win ? 'ready' : '', win ? 'You win' : 'Defeated');
    setStatus(win ? 'You sank the fleet.' : 'The computer sank your fleet.', win ? 'good' : 'warn');
    $('overText').textContent = win ? 'You win.' : 'The computer wins.';
    $('overBar').hidden = false;
    paintSolo();
  }

  /* ---- multiplayer ---- */
  function freshLocal(round) {
    var grid = new BB.Grid();
    var fleet = new BB.Fleet(grid);
    return {
      grid: grid,
      fleet: fleet,
      processed: 0,
      snap: {
        round: round || 1,
        phase: 'place',
        shots: [],
        board: BB.emptyBoard(),
        sunk: 0,
        lost: [],
        result: ''
      }
    };
  }

  function saveShips() {
    if (!secretDb || !mpLocal) return;
    secretDb.put({
      id: 'ships',
      round: mpLocal.snap.round,
      ships: mpLocal.fleet.dump()
    }).catch(function () {});
  }
  function loadShips(round) {
    if (!secretDb) return Promise.resolve(false);
    return secretDb.get('ships').then(function (row) {
      if (!row || row.round !== round || !row.ships) return false;
      return mpLocal.fleet.load(row.ships);
    }).catch(function () { return false; });
  }

  function publishMp(force) {
    if (!mpLocal) return;
    mpLocal.snap.board = mpLocal.grid.encode(true);
    mpLocal.snap.sunk = mpLocal.fleet.sunkCount();
    mpLocal.snap.lost = mpLocal.fleet.lostTypes();
    window.BBNet.publish(mpLocal.snap);
  }

  function inGame(p) {
    return p && (p.phase === 'ready' || p.phase === 'play' || p.phase === 'over');
  }
  // my shot: the room says it is my turn, both fleets are placed, nobody has won, the other seat is here
  function mpTurn(view) {
    var them = view.other;
    if (!them || !view.myTurn || !mpLocal) return false;
    var me = mpLocal.snap;
    if (!inGame(me) || !inGame(them)) return false;
    if (me.phase === 'place' || them.phase === 'place') return false;
    if (me.result || them.result) return false;
    return them.here !== 'away';
  }

  function applyIncoming(them) {
    if (!mpLocal || !them) return;
    var shots = them.shots || [];
    var i, s, changed = false;
    for (i = mpLocal.processed; i < shots.length; i++) {
      s = shots[i];
      if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') {
        mpLocal.processed = i + 1;
        continue;
      }
      BB.shoot(mpLocal.grid, mpLocal.fleet, s.x, s.y);
      lastOwn = { x: s.x, y: s.y };
      mpLocal.processed = i + 1;
      changed = true;
    }
    if (mpLocal.fleet.allSunk() && !mpLocal.snap.result) {
      mpLocal.snap.result = 'lose';
      mpLocal.snap.phase = 'over';
      changed = true;
    }
    if (changed) publishMp(true);
  }

  function beginMp() {
    if (!ROOM) { $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false; return; }
    picked = true;
    mode = 'mp';
    mpOn = true;
    solo = null;
    busy = false;
    lastEnemy = null;
    lastOwn = null;
    placing = true;
    placeType = 'carrier';
    placeDir = BB.VERTICAL;
    var v0 = window.BBNet.view();
    mpLocal = freshLocal(v0.round);
    autoPlace(mpLocal.fleet);
    $('setup').hidden = true;
    $('game').hidden = false;
    $('inviteHint').hidden = false;
    $('leaveBtn').hidden = false;
    $('leaveBtn').textContent = 'Leave';
    $('gameTitle').textContent = 'A friend';
    $('enemyTitle').textContent = 'Their fleet';
    $('overBar').hidden = true;
    $('placeBar').hidden = false;
    hideHuntBar();
    setPhase('place');
    $('startBtn').textContent = 'Ready';
    setChip('ready', 'A friend');
    setStatus('Place your ships. Press Invite in the bar above so they can hide theirs.');
    renderRoster(mpLocal.fleet);
    paintGrid($('humanGrid'), mpLocal.grid, {});
    paintFromBoard($('enemyGrid'), BB.emptyBoard(), []);
    updateStartBtn(mpLocal.fleet);
    window.BBNet.join();
    loadShips(mpLocal.snap.round).then(function (ok) {
      if (ok) {
        placing = false;
        mpLocal.snap.phase = 'ready';
        $('placeBar').hidden = true;
        setPhase('hunting');
        renderRoster(mpLocal.fleet);
        paintGrid($('humanGrid'), mpLocal.grid, {});
        publishMp(true);
      }
      paintMp(window.BBNet.view());
    });
  }

  function onMp(view) {
    // with other people here and no local game picked, the shared game is what you see; alone you start on the menu
    if (!mpOn && !picked && view.live && !$('setup').hidden) { beginMp(); return; }
    if (!mpOn || !mpLocal) return;
    var them = view.other;
    if (view.round > mpLocal.snap.round) {
      resetMpRound(view.round);
      gateCells(view);
      return;
    }
    mpLocal.snap.shots = view.me.shots;
    if (them) applyIncoming(them);

    if (mpLocal.snap.phase === 'ready' && them && (them.phase === 'ready' || them.phase === 'play' || them.phase === 'over')) {
      if (mpLocal.snap.phase !== 'play' && !mpLocal.snap.result) {
        mpLocal.snap.phase = 'play';
        placing = false;
        $('placeBar').hidden = true;
        setPhase('hunting');
        publishMp(true);
      }
    }

    if (them && them.sunk >= BB.TYPES.length && !mpLocal.snap.result) {
      mpLocal.snap.result = 'win';
      mpLocal.snap.phase = 'over';
      publishMp(true);
    }

    paintMp(view);
  }

  // Only a cell you can act on now is a live button: your own sea while placing, their sea on your shot.
  function gateCells(view) {
    var h = $('humanGrid').children, e = $('enemyGrid').children, i, x, y, ch, shot = {}, k, mine = view.me.shots || [];
    for (k = 0; k < mine.length; k++) shot[mine[k].x + ',' + mine[k].y] = 1;
    var them = view.other, turn = mpTurn(view);
    for (i = 0; i < h.length; i++) h[i].disabled = !(placing && !!placeType);
    i = 0;
    for (x = 0; x < SIZE; x++) for (y = 0; y < SIZE; y++) {
      ch = them ? (them.board || '').charAt(x * SIZE + y) : '';
      if (e[i]) e[i].disabled = !(turn && (!ch || ch === '0') && !shot[x + ',' + y]);
      i++;
    }
  }
  function paintMp(view) {
    paintMpInner(view);
    $('leaveBtn').hidden = !!view.live;   // with others here the room is how you go
    gateCells(view);
  }
  function paintMpInner(view) {
    var them = view.other;
    var meRow = mpLocal.snap;
    paintGrid($('humanGrid'), mpLocal.grid, placing ? { preview: preview, previewOk: true } : { last: lastOwn });
    var pending = [];
    var myShots = meRow.shots || [];
    if (myShots.length) lastEnemy = myShots[myShots.length - 1];
    if (them) {
      var i, s, ch;
      for (i = 0; i < myShots.length; i++) {
        s = myShots[i];
        ch = (them.board || '').charAt(s.x * SIZE + s.y);
        if (ch === '0' || ch === '' || ch == null) pending.push(s);
      }
      paintFromBoard($('enemyGrid'), them.board, pending, lastEnemy);
      showHuntBar(them.lost || []);
    } else {
      paintFromBoard($('enemyGrid'), BB.emptyBoard(), myShots, lastEnemy);
      hideHuntBar();
    }

    if (meRow.result) {
      var win = meRow.result === 'win';
      setPhase('over');
      setChip(win ? 'ready' : '', win ? 'You win' : 'Defeated');
      setStatus(win ? 'You sank their fleet.' : 'They sank your fleet.', win ? 'good' : 'warn');
      $('overText').textContent = win ? 'You win.' : (them && them.name ? them.name : 'They') + ' wins.';
      $('overBar').hidden = false;
      $('inviteHint').hidden = true;
      return;
    }
    $('overBar').hidden = true;

    // somebody else sat down in the other seat mid-game: that fleet is gone, so start the game over
    if (them && mpLocal.oppId && them.id !== mpLocal.oppId) {
      setPhase('over');
      setChip('', 'New opponent');
      setStatus((them.name || 'Someone') + ' sat down. Play again to start fresh.', 'warn');
      $('overText').textContent = 'New opponent.';
      $('overBar').hidden = false;
      return;
    }
    if (them && !mpLocal.oppId && inGame(mpLocal.snap) && inGame(them)) mpLocal.oppId = them.id;
    if (view.role === 'asking' || view.role === 'waiting') {
      setChip('', view.role === 'asking' ? 'Asking' : 'In line');
      setStatus(view.role === 'asking' ? 'Waiting for the host to let you in…' : 'Both seats are taken. You are next in line.');
      return;
    }
    if (view.note) { setStatus(view.note, 'warn'); }

    if (!them) {
      setChip('ready', 'Waiting');
      if ((meRow.shots || []).length || meRow.phase === 'play' || meRow.phase === 'over') {
        setStatus('They left. Press Invite to bring them back, or Leave.');
        $('inviteHint').hidden = true;
      } else {
        setStatus('Waiting for a friend… press Invite in the bar above to send the link.');
        $('inviteHint').hidden = false;
      }
      return;
    }
    $('inviteHint').hidden = true;
    $('enemyTitle').textContent = (them.name || 'Friend') + '’s fleet';

    if (meRow.phase === 'place' || (placing && meRow.phase !== 'play')) {
      setPhase('place');
      setChip('ready', them.phase === 'ready' || them.phase === 'play' ? 'They are ready' : 'Placing');
      return;
    }
    if (meRow.phase === 'ready' && them.phase === 'place') {
      setPhase('hunting');
      setStatus((them.name || 'They') + ' is still hiding ships.');
      setChip('ready', 'Waiting');
      return;
    }
    setPhase(meRow.phase === 'over' ? 'over' : 'hunting');
    if (mpTurn(view)) {
      setChip('ready', 'Your shot');
      setStatus('Your shot. Tap their map.');
    } else if (them.here === 'away') {
      setChip('', 'Reconnecting');
      setStatus((them.name || 'They') + ' is reconnecting…');
    } else {
      setChip('', 'Their shot');
      setStatus('Waiting for ' + (them.name || 'them') + ' to fire…');
    }
  }

  function fireMp(x, y) {
    if (!mpOn || !mpLocal || placing) return;
    var view = window.BBNet.view();
    var them = view.other;
    if (!them || !mpTurn(view)) return;
    var ch = (them.board || '').charAt(x * SIZE + y);
    if (ch && ch !== '0') return;
    var shots = view.me.shots, i;
    for (i = 0; i < shots.length; i++) if (shots[i].x === x && shots[i].y === y) return;
    lastEnemy = { x: x, y: y };
    if (mpLocal.snap.phase === 'ready') { mpLocal.snap.phase = 'play'; publishMp(true); }
    window.BBNet.shoot(x, y);
  }

  function readyMp() {
    if (!mpLocal || !mpLocal.fleet.allPlaced()) return;
    placing = false;
    mpLocal.snap.phase = 'ready';
    $('placeBar').hidden = true;
    setPhase('hunting');
    saveShips();
    publishMp(true);
    setStatus('Waiting for the other fleet…');
  }

  function resetMpRound(round) {
    mpLocal = freshLocal(round);
    placing = true;
    placeDir = BB.VERTICAL;
    autoPlace(mpLocal.fleet);
    lastEnemy = null;
    lastOwn = null;
    $('overBar').hidden = true;
    $('placeBar').hidden = false;
    hideHuntBar();
    setPhase('place');
    $('startBtn').textContent = 'Ready';
    setStatus('New game. Place your ships.');
    renderRoster(mpLocal.fleet);
    paintGrid($('humanGrid'), mpLocal.grid, {});
    paintFromBoard($('enemyGrid'), BB.emptyBoard(), []);
    updateStartBtn(mpLocal.fleet);
  }

  /* ---- shared UI ---- */
  function currentFleet() {
    if (mpOn && mpLocal) return mpLocal.fleet;
    if (solo) return solo.humanFleet;
    return null;
  }
  function currentGrid() {
    if (mpOn && mpLocal) return mpLocal.grid;
    if (solo) return solo.humanGrid;
    return null;
  }

  function tryPlace(x, y) {
    var fleet = currentFleet();
    if (!fleet || !placing || !placeType) return;
    if (!fleet.placeShip(x, y, placeDir, placeType)) return;
    placeType = '';
    var i, spec, ship;
    for (i = 0; i < BB.TYPES.length; i++) {
      spec = BB.TYPES[i];
      ship = fleet.findByType(spec.id);
      if (ship && !ship.placed) { placeType = spec.id; break; }
    }
    renderRoster(fleet);
    paintGrid($('humanGrid'), fleet.grid, {});
    updateStartBtn(fleet);
    if (mpOn) { saveShips(); publishMp(false); }
  }

  function autoPlace(fleet) {
    resetFleet(fleet);
    fleet.placeRandomly(false);
    placeType = '';
  }
  // the shared game starts with a random fleet already placed: press Ready, or take the ships up and place them by hand
  function placeByHand() {
    var fleet = currentFleet();
    if (!fleet || !placing || !mpOn) return;
    resetFleet(fleet);
    placeType = 'carrier';
    renderRoster(fleet);
    paintGrid($('humanGrid'), fleet.grid, {});
    updateStartBtn(fleet);
    paintMp(window.BBNet.view());
  }
  function scatter() {
    var fleet = currentFleet();
    if (!fleet || !placing) return;
    autoPlace(fleet);
    renderRoster(fleet);
    paintGrid($('humanGrid'), fleet.grid, {});
    updateStartBtn(fleet);
    if (mpOn) { saveShips(); publishMp(false); }
  }

  function leave() {
    if (replyTimer) { clearTimeout(replyTimer); replyTimer = 0; }
    busy = false;
    if (mpOn) {
      try { window.BBNet.leave(); } catch (e) {}
    }
    picked = true;
    $('leaveBtn').hidden = false;
    mpOn = false;
    mpLocal = null;
    solo = null;
    placing = true;
    lastEnemy = null;
    lastOwn = null;
    $('game').hidden = true;
    $('setup').hidden = false;
    $('overBar').hidden = true;
    hideHuntBar();
    setPhase('setup');
    setChip('ready', 'Ready');
    paintSetupStats();
  }

  function playAgain() {
    if (mpOn) {
      // the room starts the next game for both: the shots start over and the turn goes to the next starter
      window.BBNet.newRound();
      return;
    }
    beginCpu();
  }

  function resetFleet(fleet) {
    fleet.grid.clear();
    var i, s;
    for (i = 0; i < fleet.roster.length; i++) {
      s = fleet.roster[i];
      s.placed = false; s.damage = 0; s.sunk = false;
    }
  }

  /* Store cover: a mid-hunt with a line of hits on the other map. */
  function coverShot() {
    beginCpu();
    resetFleet(solo.humanFleet);
    resetFleet(solo.computerFleet);
    var H = [
      ['carrier', 2, 1, BB.HORIZONTAL],
      ['battleship', 4, 3, BB.VERTICAL],
      ['destroyer', 0, 6, BB.HORIZONTAL],
      ['submarine', 5, 0, BB.VERTICAL],
      ['patrolboat', 8, 0, BB.HORIZONTAL]
    ];
    var C = [
      ['carrier', 4, 4, BB.HORIZONTAL],
      ['battleship', 1, 0, BB.VERTICAL],
      ['destroyer', 8, 7, BB.HORIZONTAL],
      ['submarine', 5, 2, BB.HORIZONTAL],
      ['patrolboat', 0, 2, BB.HORIZONTAL]
    ];
    var i, p;
    for (i = 0; i < H.length; i++) {
      p = H[i];
      solo.humanFleet.placeShip(p[1], p[2], p[3], p[0]);
    }
    for (i = 0; i < C.length; i++) {
      p = C[i];
      solo.computerFleet.placeShip(p[1], p[2], p[3], p[0]);
    }
    solo.start();
    placing = false;
    $('placeBar').hidden = true;
    $('overBar').hidden = true;
    setPhase('hunting');
    document.body.classList.add('cover');
    var enemyShots = [
      [1, 1], [2, 8], [7, 2], [0, 9], [6, 1], [3, 3], [5, 7], [9, 4],
      [2, 2], [7, 8], [1, 5], [9, 0], [0, 2], [0, 3], [8, 8],
      [4, 4], [4, 5], [4, 6]
    ];
    var ownShots = [
      [0, 0], [1, 8], [6, 6], [8, 0], [8, 1], [2, 2], [2, 3], [5, 3]
    ];
    for (i = 0; i < enemyShots.length; i++) BB.shoot(solo.computerGrid, solo.computerFleet, enemyShots[i][0], enemyShots[i][1]);
    for (i = 0; i < ownShots.length; i++) BB.shoot(solo.humanGrid, solo.humanFleet, ownShots[i][0], ownShots[i][1]);
    lastEnemy = { x: 4, y: 6 };
    lastOwn = { x: 5, y: 3 };
    solo.shots = enemyShots.length;
    solo.hits = 4;
    setStatus('Hit. Your shot.');
    setChip('ready', 'Your shot');
    $('gameTitle').textContent = 'Computer';
    paintSolo();
  }

  buildGrid($('humanGrid'));
  buildGrid($('enemyGrid'));

  $('cpuBtn').onclick = beginCpu;
  $('friendBtn').onclick = beginMp;
  $('leaveBtn').onclick = leave;
  $('againBtn').onclick = playAgain;
  $('scatterBtn').onclick = scatter;
  $('startBtn').onclick = function () {
    if (mpOn) readyMp();
    else startSolo();
  };
  $('rotateBtn').onclick = function () {
    placeDir = placeDir === BB.VERTICAL ? BB.HORIZONTAL : BB.VERTICAL;
    $('rotateBtn').textContent = placeDir === BB.VERTICAL ? 'Rotate' : 'Rotate · across';
    clearPreview();
  };

  $('humanGrid').addEventListener('click', function (e) {
    var c = hitCell($('humanGrid'), e); if (!c) return;
    tryPlace(c.x, c.y);
  });
  $('humanGrid').addEventListener('pointermove', function (e) {
    if (!placing) return;
    var c = hitCell($('humanGrid'), e); if (!c) return;
    var fleet = currentFleet(); if (!fleet) return;
    showPreview(c.x, c.y, fleet);
  });
  $('humanGrid').addEventListener('pointerleave', clearPreview);

  $('enemyGrid').addEventListener('click', function (e) {
    var c = hitCell($('enemyGrid'), e); if (!c) return;
    if (mpOn) fireMp(c.x, c.y);
    else fireSolo(c.x, c.y);
  });

  window.BBApp = { coverShot: coverShot };

  // Read-only, for the room kit: the shared game only (round and public shots).
  window.__battleboat = { state: function () { return window.BBNet.shared(); } };

  if (ROOM) window.BBNet.init({ onChange: onMp });
  else { $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false; }
  loadStats();
  paintSetupStats();
})();
