// Tic-Tac-Toe. Computer is perfect play on this device. A friend sits the
// other mark on a shared board. Invite is OS chrome — this file never
// draws a share button.
//
// Seats, turns and who is here come from gifos.room; the mover writes the board.
(function () {
  'use strict';
  var T = window.TTT;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
  };
  var MARK_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<path class="markx a" d="M26 26 L74 74"/>'
    + '<path class="markx b" d="M74 26 L26 74"/>'
    + '<circle class="marko" cx="50" cy="50" r="26"/>'
    + '</svg>';

  var state = { mode: 'cpu', mark: 'x', s: null, over: false, hist: [] };
  var cpuTok = 0;
  var db = null;
  try { if (window.gifos) db = gifos.db('ttt'); } catch (e) {}
  var stats = { win: 0, draw: 0, loss: 0 };

  function setChip(cls, text) {
    $('aiChip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('aiState').textContent = text;
  }
  function setStatus(el, text, cls) {
    el.className = 'statusline' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }
  function showStats() {
    var t = 'Win ' + stats.win + ' · Draw ' + stats.draw + ' · Loss ' + stats.loss;
    $('statsLine').textContent = t;
    if ($('gameStats')) $('gameStats').textContent = t;
  }

  function bindSeg(id, key, attr, onChange) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
      b.classList.add('on');
      state[key] = b.getAttribute(attr);
      if (onChange) onChange();
    });
  }
  bindSeg('modeSeg', 'mode', 'data-mode', function () {
    var cpu = state.mode === 'cpu';
    $('cpuOpts').hidden = !cpu;
    $('hotseatNote').hidden = cpu;
  });
  bindSeg('markSeg', 'mark', 'data-mark');

  function paintWin(svg, s, instant) {
    if (!svg) return;
    var line = svg.querySelector('.seg');
    if (!line) return;
    if (!s || !s.winLine) {
      svg.classList.remove('on', 'instant');
      line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
      line.setAttribute('x2', '0'); line.setAttribute('y2', '0');
      return;
    }
    var a = s.winLine[0], b = s.winLine[2];
    var x1 = ((a % 3) + 0.5) / 3 * 100, y1 = (((a / 3) | 0) + 0.5) / 3 * 100;
    var x2 = ((b % 3) + 0.5) / 3 * 100, y2 = (((b / 3) | 0) + 0.5) / 3 * 100;
    line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
    svg.classList.toggle('instant', !!instant);
    svg.classList.add('on');
  }

  function paint(boardEl, winSvg, s, opts) {
    var i, cell, mark, win = {}, last = -1, want, had, instant;
    opts = opts || {};
    instant = !!opts.instant;
    if (!boardEl) return;
    if (s && s.winLine) for (i = 0; i < s.winLine.length; i++) win[s.winLine[i]] = 1;
    if (s && s.last) last = T.idx(s.last.r, s.last.c);
    for (i = 0; i < 9; i++) {
      cell = boardEl.children[i];
      if (!cell || cell.tagName !== 'BUTTON') continue;
      mark = s ? s.cells[i] : 0;
      want = mark === T.X ? 'x' : mark === T.O ? 'o' : '';
      had = cell.classList.contains('x') || cell.classList.contains('o');
      cell.className = 'cell'
        + (want ? ' ' + want : '')
        + (win[i] ? ' win' : '')
        + (last === i && !win[i] ? ' last' : '')
        + ((want && (instant || had)) ? ' settled' : '');
      cell.disabled = !!(s && (s.winner || mark));
      cell.setAttribute('aria-label', mark === T.X ? 'X' : mark === T.O ? 'O' : 'empty');
    }
    paintWin(winSvg, s, instant);
  }

  function makeBoard(el, onPlay) {
    var i, b;
    el.innerHTML = '';
    for (i = 0; i < 9; i++) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.setAttribute('data-i', String(i));
      b.innerHTML = MARK_SVG;
      b.addEventListener('click', function () {
        var n = parseInt(this.getAttribute('data-i'), 10);
        onPlay((n / T.N) | 0, n % T.N);
      });
      el.appendChild(b);
    }
  }

  function isHumanTurn() {
    if (!state.s || state.over) return false;
    if (state.mode === 'hotseat') return true;
    return T.colorName(state.s.turn) === state.mark;
  }
  function whoNames() {
    var xName, oName;
    if (state.mode === 'hotseat') { xName = 'X'; oName = 'O'; }
    else if (state.mark === 'x') { xName = 'You'; oName = 'Computer'; }
    else { xName = 'Computer'; oName = 'You'; }
    $('whoXName').textContent = xName;
    $('whoOName').textContent = oName;
  }
  function whoTurn() {
    var s = state.s;
    $('whoX').classList.toggle('on', !!(s && !s.winner && s.turn === T.X));
    $('whoO').classList.toggle('on', !!(s && !s.winner && s.turn === T.O));
    $('whoX').classList.toggle('win', !!(s && s.winner === T.X));
    $('whoO').classList.toggle('win', !!(s && s.winner === T.O));
  }
  function localStatus() {
    if (!state.s) return;
    whoTurn();
    $('undoBtn').disabled = !state.hist.length;
    $('againBtn').classList.toggle('on', !!state.over);
    if (state.s.winner === -1) {
      setStatus($('statusLine'), 'Draw.', '');
      return;
    }
    if (state.s.winner) {
      var w = T.colorName(state.s.winner);
      var you = state.mode === 'cpu' && w === state.mark;
      var msg = state.mode === 'hotseat'
        ? (w.toUpperCase() + ' wins')
        : (you ? 'You win' : 'Computer wins');
      setStatus($('statusLine'), msg + '.', you ? 'good' : (state.mode === 'cpu' ? 'warn' : ''));
      return;
    }
    if (state.mode === 'hotseat') {
      setStatus($('statusLine'), T.colorName(state.s.turn).toUpperCase() + ' to play.', '');
    } else {
      setStatus($('statusLine'), T.colorName(state.s.turn) === state.mark ? 'Your turn.' : 'Computer to play.', '');
    }
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', mode: state.mode, mark: state.mark,
      cells: state.s ? state.s.cells.slice() : null,
      over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function saveStats() {
    if (!db) return;
    db.put({ id: 'stats', win: stats.win, draw: stats.draw, loss: stats.loss }).catch(function () {});
    showStats();
  }
  function recordResult(s, myMark) {
    if (!s || !s.winner) return;
    if (s.winner === -1) stats.draw++;
    else if (T.colorName(s.winner) === myMark) stats.win++;
    else stats.loss++;
    saveStats();
  }
  function playLocal(r, c) {
    if (!state.s || state.over) return false;
    if (!isHumanTurn() && state.mode === 'cpu') return false;
    var ns = T.place(state.s, r, c);
    if (!ns) return false;
    state.hist.push(state.s);
    state.s = ns;
    paint($('board'), $('boardWin'), state.s);
    if (ns.winner) {
      state.over = true;
      if (state.mode === 'cpu') recordResult(ns, state.mark);
      localStatus();
      saveLocal();
      return true;
    }
    localStatus();
    saveLocal();
    if (state.mode === 'cpu' && T.colorName(state.s.turn) !== state.mark) cpuMove();
    return true;
  }
  function cpuMove() {
    if (!state.s || state.over || state.mode !== 'cpu') return;
    var tok = ++cpuTok;
    setChip('thinking', 'Thinking…');
    $('board').classList.add('busy');
    setTimeout(function () {
      if (tok !== cpuTok || !state.s || state.over) return;
      var p = T.cpuPick(state.s);
      setChip('ready', 'On this device');
      $('board').classList.remove('busy');
      if (!p) return;
      var ns = T.place(state.s, p.r, p.c);
      if (!ns) return;
      state.hist.push(state.s);
      state.s = ns;
      paint($('board'), $('boardWin'), state.s);
      if (ns.winner) {
        state.over = true;
        recordResult(ns, state.mark);
      }
      localStatus();
      saveLocal();
    }, 320);
  }
  function newLocal() {
    cpuTok++;
    state.s = T.fresh(); state.over = false; state.hist = [];
    setChip('ready', state.mode === 'cpu' ? 'On this device' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    $('board').classList.remove('busy');
    whoNames();
    paint($('board'), $('boardWin'), state.s, { instant: true });
    localStatus();
    saveLocal();
    if (state.mode === 'cpu' && state.mark === 'o') cpuMove();
  }
  function undoLocal() {
    if (!state.hist.length) return;
    cpuTok++;
    $('board').classList.remove('busy');
    setChip('ready', state.mode === 'cpu' ? 'On this device' : 'Two players');
    if (state.mode === 'cpu') {
      // Undo the pair: computer reply + your mark. If the game just ended on
      // your mark (no reply yet), one step is enough.
      state.s = state.hist.pop();
      if (state.hist.length && T.colorName(state.s.turn) !== state.mark) {
        state.s = state.hist.pop();
      }
    } else {
      state.s = state.hist.pop();
    }
    state.over = !!state.s.winner;
    paint($('board'), $('boardWin'), state.s, { instant: true });
    localStatus();
    saveLocal();
  }

  $('startBtn').onclick = function () { newLocal(); };
  $('againBtn').onclick = function () { newLocal(); };
  $('undoBtn').onclick = function () { undoLocal(); };
  $('newBtn').onclick = function () {
    cpuTok++;
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'On this device');
  };

  makeBoard($('board'), function (r, c) { playLocal(r, c); });

  // ---- multiplayer ----
  // Who sits, whose turn it is, who is here and who waits is gifos.room's (manifest "room"). This app draws the
  // board and makes moves: the mover writes the whole next board with gifos.room.move.
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var NEEDS_NEWER = 'Tic-Tac-Toe needs a newer GifOS to play together. Reload the page to update.';
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('ttt-mp'); } catch (e) {}
  var mp = { on: false, rs: null, board: null, auto: false, note: '' };
  var _mpCells = '';

  function freshBoard() {
    return { id: 'board', cells: [0, 0, 0, 0, 0, 0, 0, 0, 0], winner: null, result: '', last: null, seq: 0 };
  }
  function curBoard() { return mp.board || freshBoard(); }
  function mySeat() { return mp.rs && mp.rs.me ? mp.rs.me.seat : null; }
  function seatRow(name) {
    var rows = (mp.rs && mp.rs.seats) || [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].seat === name) return rows[i];
    return { seat: name, id: null, name: '', here: 'open' };
  }
  // The room says whose turn it is. Alone, one person plays every open seat.
  function mpCanPlay() {
    var rs = mp.rs;
    if (!ROOM || !rs || !rs.me || !mySeat() || curBoard().winner) return false;
    if (!rs.live) return seatRow(rs.turn).here !== 'away';
    return !!rs.myTurn;
  }
  function mpSay(e) {
    mp.note = e && e.message ? e.message : '';
    mpRender();
    setTimeout(function () { mp.note = ''; mpRender(); }, 2500);
  }
  function boardToState(b) {
    return T.fromCells(b && b.cells);
  }

  $('friendBtn').onclick = mpEnter;
  function mpEnter() {
    mp.on = true; cpuTok++;
    _mpCells = '';
    $('setup').hidden = true; $('game').hidden = true; $('friend').hidden = false;
    setChip('ready', 'A friend');
    // Opening the game is asking to play; the room seats, lines up, or asks the host.
    if (ROOM && mp.rs && mp.rs.me && mp.rs.me.role === 'watcher') gifos.room.join().catch(function () {});
    mpRender();
  }
  function mpLeave() {
    mp.on = false;
    if (ROOM) gifos.room.leave().catch(function () {});
    $('friend').hidden = true; $('setup').hidden = false; setChip('ready', 'On this device');
  }
  $('fLeave').onclick = mpLeave;

  function mpPlay(r, c) {
    if (!mpCanPlay()) return false;
    var prev = mp.board, b = curBoard();
    var ns = T.place(boardToState(b), r, c);
    if (!ns) return false;
    var nb = { id: 'board', cells: ns.cells.slice(), winner: null, result: '', last: { r: r, c: c }, seq: (b.seq || 0) + 1 };
    if (ns.winner === -1) { nb.winner = 'draw'; nb.result = 'Draw'; }
    else if (ns.winner) { nb.winner = T.colorName(ns.winner); nb.result = 'Three in a row'; }
    mp.board = nb; mpRender();
    gifos.room.move('ttt-mp', nb).catch(function (e) { mp.board = prev; mpSay(e); });
    return true;
  }
  // A finished game: anyone seated may start the next one (X goes first).
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat() || !curBoard().winner) return;
    gifos.room.newRound('ttt-mp', freshBoard(), { first: 'x' }).catch(mpSay);
  };

  var lastMpStat = -1;
  function maybeRecordMp(b, seat) {
    if (!b || !b.winner || !seat || b.round === lastMpStat) return;
    lastMpStat = b.round;
    recordResult({ winner: b.winner === 'draw' ? -1 : T.colorNum(b.winner) }, seat);
  }
  function seatHtml(name) {
    var row = seatRow(name), b = curBoard();
    var who = row.id ? esc(row.name || 'Player') + (row.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    return '<div class="seat' + (mySeat() === name ? ' me' : '') + (mp.rs && mp.rs.turn === name && !b.winner ? ' turn' : '') +
      '">' + name.toUpperCase() + ' · ' + who + '</div>';
  }
  function mpStatus(b) {
    var rs = mp.rs;
    if (!ROOM) return [NEEDS_NEWER, 'warn'];
    if (!rs) return ['Setting up the board…', ''];
    var role = rs.me.role;
    if (b.winner === 'draw') return [(b.result || 'Draw') + '.', ''];
    if (b.winner) {
      var w = seatRow(b.winner);
      return [(b.result ? b.result + ' — ' : '') + (w.id && w.name ? w.name : b.winner.toUpperCase()) + ' wins.', mySeat() === b.winner ? 'good' : ''];
    }
    if (role === 'waiting') return ['Waiting for a seat to open…', ''];
    if (role === 'asking') return ['Asking the host if you can play…', ''];
    if (!mySeat()) return ['Watching.', ''];
    if (mpCanPlay()) return [rs.live ? 'Your turn (' + mySeat().toUpperCase() + ').' : rs.turn.toUpperCase() + ' to play.', ''];
    var t = seatRow(rs.turn);
    if (t.here === 'away') return ['Waiting for ' + (t.name || rs.turn.toUpperCase()) + ' to come back…', ''];
    if (!t.id) return ['Waiting for another player… press Invite (top bar) to bring a friend.', ''];
    return ['Waiting for ' + (t.name || rs.turn.toUpperCase()) + '…', ''];
  }
  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), rs = mp.rs;
    var s = boardToState(b);
    if (b.last) s.last = b.last;
    $('fSeats').innerHTML = seatHtml('x') + seatHtml('o');
    $('fQueue').textContent = rs && rs.line && rs.line.length
      ? 'Next in line: ' + rs.line.map(function (p) { return p.name || 'Player'; }).join(', ')
      : '';
    var st = mpStatus(b);
    setStatus($('fStatus'), mp.note && ROOM ? mp.note : st[0], st[1]);
    if (b.winner && mySeat()) { b.round = rs.round; maybeRecordMp(b, mySeat()); }
    var key = (b.cells || []).join(',');
    var filled = 0, prevFilled = 0, i;
    for (i = 0; i < 9; i++) if (b.cells && b.cells[i]) filled++;
    if (_mpCells) {
      var prev = _mpCells.split(',');
      for (i = 0; i < prev.length; i++) if (prev[i] !== '0') prevFilled++;
    }
    paint($('fBoard'), $('fBoardWin'), s, { instant: !_mpCells || filled < prevFilled });
    _mpCells = key;
    // Cells are buttons: only the person whose turn it is can press an empty one.
    var can = mpCanPlay();
    for (i = 0; i < 9; i++) if (!can) $('fBoard').children[i].disabled = true;
    $('fNew').hidden = !(ROOM && mySeat() && b.winner);
  }

  makeBoard($('fBoard'), function (r, c) { mpPlay(r, c); });

  // The game only, so the checks and a tester can compare copies.
  window['__tic-tac-toe'] = { state: function () {
    var b = mp.board;
    return { cells: b && b.cells ? b.cells.join('') : '', winner: b ? b.winner : null };
  } };

  window.addEventListener('resize', function () {
    if (!$('game').hidden && state.s) paint($('board'), $('boardWin'), state.s, { instant: true });
    if (!$('friend').hidden && mp.board) paint($('fBoard'), $('fBoardWin'), boardToState(mp.board), { instant: true });
  });

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) { cpuTok++; $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'On this device'); }
  });

  // The board arrives as data; the room's word arrives from gifos.room.
  if (mpDb) mpDb.subscribe(function (items) {
    var b = null, i;
    for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'board') b = items[i];
    mp.board = b;
    mpRender();
  });
  if (ROOM) gifos.room.subscribe(function (s) {
    mp.rs = s;
    // Somebody else is here: the room is what they see, without a mode tap. Not over a local game in progress.
    if (!mp.on && !mp.auto && s.live && !$('setup').hidden && !(state.s && !state.over)) { mp.auto = true; mpEnter(); return; }
    mpRender();
  });
  setChip('ready', 'On this device');
  if (!ROOM) { $('needsNewer').hidden = false; $('needsNewer').textContent = NEEDS_NEWER; }
  showStats();
  if (db) {
    db.get('stats').then(function (st) {
      if (!st) return;
      stats.win = st.win | 0; stats.draw = st.draw | 0; stats.loss = st.loss | 0;
      showStats();
    }).catch(function () {});
    db.get('game').then(function (g) {
      if (mp.on || !g || !g.cells || g.over) return;
      state.mode = g.mode || 'cpu';
      state.mark = g.mark || 'x';
      var s = T.fromCells(g.cells);
      if (!s.n) return;
      state.s = s; state.over = !!s.winner; state.hist = [];
      if (state.mode === 'cpu') {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('markSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-mark') === state.mark);
        });
      } else {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      whoNames();
      paint($('board'), $('boardWin'), state.s, { instant: true });
      localStatus();
      if (!state.over && state.mode === 'cpu' && T.colorName(state.s.turn) !== state.mark) cpuMove();
    }).catch(function () {});
  }
})();
