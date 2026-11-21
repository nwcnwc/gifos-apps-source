// Reversi — flip a line, get more of your colour. Computer is Berson's MCTS.
// A friend sits the other colour on a shared board; seats and turns come from gifos.room. Invite is OS chrome.
(function () {
  'use strict';
  var R = window.RV;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var FLIP_MS = 560, SWAP_AT = 270, STAGGER = 42;
  var state = {
    mode: 'cpu', color: 'black',
    s: null, hist: [], over: false, thinking: false, animating: false
  };
  var db = null;
  try { if (window.gifos) db = gifos.db('save'); } catch (e) {}

  function setChip(cls, text) {
    $('aiChip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('aiState').textContent = text;
  }
  function setStatus(el, text, cls) {
    el.className = 'statusline' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }
  function setScore(el, s, turnOn) {
    if (!el || !s) return;
    var bOn = !!(turnOn && !s.winner && s.turn === R.BLACK);
    var wOn = !!(turnOn && !s.winner && s.turn === R.WHITE);
    el.innerHTML =
      '<div class="sc blk' + (bOn ? ' on' : '') + '"><i class="d"></i><b>' + s.blacks + '</b></div>' +
      '<div class="sc wht' + (wOn ? ' on' : '') + '"><i class="d"></i><b>' + s.whites + '</b></div>';
  }

  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    state.mode = b.getAttribute('data-mode');
    var cpu = state.mode === 'cpu';
    $('cpuOpts').hidden = !cpu;
    $('hotseatNote').hidden = cpu;
  });
  $('colorSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    state.color = b.getAttribute('data-color');
    $('cpuNote').textContent = state.color === 'black'
      ? 'You place black. The computer places white. It thinks on this device.'
      : 'You place white. The computer places black, and goes first.';
  });

  function squareAt(boardEl, r, c) {
    return boardEl.children[r * R.SIZE + c];
  }
  function diskAt(boardEl, r, c) {
    var sq = squareAt(boardEl, r, c);
    return sq ? sq.querySelector('.disk') : null;
  }
  function paint(boardEl, s, opts) {
    opts = opts || {};
    if (!boardEl) return;
    var r, c, sq, disk, hint, num, col, key, legal = {};
    var hintColor = opts.hintColor || (s ? s.turn : R.BLACK);
    if (opts.hints && s && !s.winner) {
      R.availableMoves(s.map, hintColor).forEach(function (m) { legal[m.r + ',' + m.c] = 1; });
    }
    for (r = 0; r < R.SIZE; r++) for (c = 0; c < R.SIZE; c++) {
      sq = squareAt(boardEl, r, c);
      if (!sq) continue;
      disk = sq.querySelector('.disk');
      hint = sq.querySelector('.hint');
      num = sq.querySelector('.num');
      if (disk) {
        disk.classList.add('snap');
        disk.classList.remove('black', 'white', 'visible', 'flipping');
        col = s ? s.map[r][c] : 0;
        if (col === R.BLACK) disk.classList.add('black', 'visible');
        else if (col === R.WHITE) disk.classList.add('white', 'visible');
      }
      key = r + ',' + c;
      if (hint) hint.className = 'hint' + (legal[key] ? (hintColor === R.BLACK ? ' show-b' : ' show-w') : '');
      sq.classList.toggle('last', !!(s && s.last && s.last.r === r && s.last.c === c && !opts.noLast));
      if (num && !opts.keepNums) num.textContent = '';
    }
    void boardEl.offsetWidth;
    for (r = 0; r < R.SIZE; r++) for (c = 0; c < R.SIZE; c++) {
      disk = diskAt(boardEl, r, c);
      if (disk) disk.classList.remove('snap');
    }
  }
  function animatePlace(boardEl, prev, ns, done) {
    paint(boardEl, prev, { hints: false, noLast: true });
    if (!ns || !ns.last) { paint(boardEl, ns); if (done) done(); return; }
    var sq = squareAt(boardEl, ns.last.r, ns.last.c);
    var placed = diskAt(boardEl, ns.last.r, ns.last.c);
    if (sq) sq.classList.add('last');
    if (placed) {
      placed.classList.add('snap');
      placed.classList.add(ns.last.color === R.BLACK ? 'black' : 'white', 'visible');
      void placed.offsetWidth;
      placed.classList.remove('snap');
    }
    var rest = (ns.flipped || []).slice(1);
    if (!rest.length) { if (done) done(); return; }
    var left = rest.length, finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (done) done();
    }
    rest.forEach(function (d, i) {
      var disk = diskAt(boardEl, d.r, d.c);
      if (!disk) { left--; if (left <= 0) finish(); return; }
      var toBlack = ns.map[d.r][d.c] === R.BLACK;
      setTimeout(function () {
        disk.classList.add('flipping');
        setTimeout(function () {
          disk.classList.toggle('black', toBlack);
          disk.classList.toggle('white', !toBlack);
        }, SWAP_AT);
        disk.addEventListener('animationend', function () {
          disk.classList.remove('flipping');
          left--;
          if (left <= 0) finish();
        }, { once: true });
      }, i * STAGGER);
    });
    setTimeout(finish, FLIP_MS + 80 + rest.length * STAGGER);
  }
  function countOut(boardEl, s) {
    if (!boardEl || !s) return;
    var order = [], r, c;
    for (r = 0; r < R.SIZE; r++) for (c = 0; c < R.SIZE; c++) {
      if (s.map[r][c]) order.push({ r: r, c: c, color: s.map[r][c] });
    }
    var i = 0, b = 0, w = 0;
    function step() {
      if (i >= order.length) return;
      var cell = order[i++];
      if (cell.color === R.BLACK) b++; else w++;
      var sq = squareAt(boardEl, cell.r, cell.c);
      var num = sq && sq.querySelector('.num');
      if (num) num.textContent = String(cell.color === R.BLACK ? b : w);
      setTimeout(step, 42);
    }
    setTimeout(step, 180);
  }
  function makeBoard(el, onPlay, evt) {
    el.innerHTML = '';
    var r, c, sq, disk, hint, num;
    for (r = 0; r < R.SIZE; r++) for (c = 0; c < R.SIZE; c++) {
      sq = document.createElement('div');
      sq.className = 'square';
      sq.setAttribute('data-r', String(r));
      sq.setAttribute('data-c', String(c));
      hint = document.createElement('i'); hint.className = 'hint';
      disk = document.createElement('div'); disk.className = 'disk';
      num = document.createElement('span'); num.className = 'num';
      sq.appendChild(hint);
      sq.appendChild(disk);
      sq.appendChild(num);
      sq.addEventListener(evt || 'pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this.getAttribute('aria-disabled') === 'true') return;
        onPlay(+this.getAttribute('data-r'), +this.getAttribute('data-c'));
      });
      el.appendChild(sq);
    }
  }

  function isHumanTurn() {
    if (!state.s || state.over || state.thinking || state.animating) return false;
    if (state.mode === 'hotseat') return true;
    return R.colorName(state.s.turn) === state.color;
  }
  function localStatus() {
    if (!state.s) return;
    setScore($('scoreLine'), state.s, true);
    if (state.s.winner === R.DRAW) {
      setStatus($('statusLine'), 'Draw — ' + state.s.blacks + ' apiece.', '');
      return;
    }
    if (state.s.winner) {
      var you = state.mode === 'cpu' && state.s.winner === R.colorNum(state.color);
      var msg = state.mode === 'hotseat'
        ? (R.colorName(state.s.winner).charAt(0).toUpperCase() + R.colorName(state.s.winner).slice(1) +
           ' wins, ' + state.s.blacks + '–' + state.s.whites + '.')
        : (you ? 'You win, ' + state.s.blacks + '–' + state.s.whites + '.'
               : 'The computer wins, ' + state.s.blacks + '–' + state.s.whites + '.');
      setStatus($('statusLine'), msg, you ? 'good' : 'warn');
      return;
    }
    if (state.thinking) { setStatus($('statusLine'), 'Computer is thinking…', ''); return; }
    var pass = state.s.passed ? 'No move for the other side. ' : '';
    if (state.mode === 'hotseat') {
      var t = R.colorName(state.s.turn);
      setStatus($('statusLine'), pass + t.charAt(0).toUpperCase() + t.slice(1) + ' to play. Tap a dotted square.', '');
    } else {
      setStatus($('statusLine'), pass + (R.colorName(state.s.turn) === state.color
        ? 'Your turn. Tap a dotted square.' : 'Computer to play.'), '');
    }
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', mode: state.mode, color: state.color,
      moves: state.hist.map(function (m) { return { r: m.r, c: m.c }; }),
      over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function afterLocal() {
    state.animating = false;
    paint($('board'), state.s, { hints: isHumanTurn(), hintColor: state.s ? state.s.turn : R.BLACK });
    localStatus();
    saveLocal();
    if (state.s && state.s.winner) countOut($('board'), state.s);
    if (!state.over && state.mode === 'cpu' && R.colorName(state.s.turn) !== state.color) aiMove();
  }
  function playLocal(r, c) {
    if (!state.s || state.over || state.animating) return false;
    if (state.mode === 'cpu' && state.thinking && R.colorName(state.s.turn) === state.color) return false;
    var prev = state.s;
    var ns = R.place(state.s, r, c);
    if (!ns) return false;
    state.hist.push({ r: r, c: c });
    state.s = ns;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    state.animating = true;
    animatePlace($('board'), prev, ns, afterLocal);
    return true;
  }
  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu') return;
    if (R.colorName(state.s.turn) === state.color) return;
    state.thinking = true;
    setChip('thinking', 'Thinking…');
    localStatus();
    paint($('board'), state.s, { hints: false });
    setTimeout(function () {
      if (!state.s || state.over || state.mode !== 'cpu') { state.thinking = false; return; }
      var move;
      if (state.s.n === 0) {
        var book = R.OPENING;
        move = book[Math.trunc(Math.random() * book.length)];
      } else {
        move = R.aiMove(state.s.map, state.s.turn, R.TIME_LIMIT);
      }
      state.thinking = false;
      setChip('ready', 'Computer');
      if (!move) { localStatus(); return; }
      playLocal(move.r, move.c);
    }, 50);
  }
  function undoLocal() {
    if (!state.hist.length || state.animating) return;
    if (state.over) state.hist.pop();
    else if (state.mode === 'cpu') {
      state.hist.pop();
      if (state.hist.length) state.hist.pop();
    } else state.hist.pop();
    state.s = R.replay(state.hist);
    state.over = !!state.s.winner;
    state.thinking = false;
    setChip('ready', state.mode === 'cpu' ? 'Computer' : 'Two here');
    paint($('board'), state.s, { hints: isHumanTurn(), hintColor: state.s.turn });
    localStatus();
    saveLocal();
    if (!state.over && state.mode === 'cpu' && R.colorName(state.s.turn) !== state.color) aiMove();
  }
  function newLocal() {
    state.s = R.fresh(); state.hist = []; state.over = false;
    state.thinking = false; state.animating = false;
    setChip('ready', state.mode === 'cpu' ? 'Computer' : 'Two here');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    paint($('board'), state.s, { hints: isHumanTurn(), hintColor: state.s.turn });
    localStatus();
    saveLocal();
    if (state.mode === 'cpu' && state.color === 'white') aiMove();
  }

  makeBoard($('board'), function (r, c) { if (isHumanTurn()) playLocal(r, c); });
  $('startBtn').onclick = function () { newLocal(); };
  $('newBtn').onclick = function () {
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;

  // ---- multiplayer ----
  // Who sits, whose turn it is, who is here and who waits is gifos.room's (manifest "room"). This app draws the
  // board and makes moves: the mover writes the whole next board with gifos.room.move.
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var NEEDS_NEWER = 'Reversi needs a newer GifOS to play together. Reload the page to update.';
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  var mp = { on: false, rs: null, board: null, auto: false, note: '' };
  var _mpSeqPaint = -1;

  function freshBoard() {
    return {
      id: 'board', moves: [], winner: null, result: '', last: null, seq: 0,
      blacks: 2, whites: 2, passed: false
    };
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
  }

  $('friendBtn').onclick = mpEnter;
  function mpEnter() {
    mp.on = true; _mpSeqPaint = -1;
    $('setup').hidden = true; $('game').hidden = true; $('friend').hidden = false;
    setChip('ready', 'A friend');
    // Opening the game is asking to play; the room seats, lines up, or asks the host.
    if (ROOM && mp.rs && mp.rs.me && mp.rs.me.role === 'watcher') gifos.room.join().catch(function () {});
    mpRender(true);
  }
  function mpLeave() {
    mp.on = false;
    if (ROOM) gifos.room.leave().catch(function () {});
    $('friend').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  }
  $('fLeave').onclick = mpLeave;

  function mpSend(prev, nb, keep) {
    mp.board = nb; mpRender();
    gifos.room.move('board', nb, keep ? { keep: true } : undefined).catch(function (e) { mp.board = prev; mpSay(e); });
  }
  // The refusal note stays until the next room state, board change or tap.
  function mpPlay(r, c) {
    mp.note = '';
    if (!mpCanPlay()) return false;
    var prev = mp.board, b = curBoard();
    var ns = R.place(R.replay(b.moves || []), r, c);
    if (!ns) return false;
    var nb = {
      id: 'board', moves: (b.moves || []).concat([{ r: r, c: c }]), winner: null, result: '',
      last: { r: r, c: c }, seq: (b.seq || 0) + 1, blacks: ns.blacks, whites: ns.whites, passed: !!ns.passed
    };
    if (ns.winner === R.DRAW) { nb.winner = 'draw'; nb.result = 'Draw'; }
    else if (ns.winner) { nb.winner = R.colorName(ns.winner); nb.result = 'Most discs'; }
    // The other side has no move: the turn stays with the mover.
    mpSend(prev, nb, !!ns.passed && !nb.winner);
    return true;
  }
  $('fResign').onclick = function () {
    if (!mpCanPlay() || !(curBoard().moves || []).length) return;
    var prev = mp.board, b = curBoard();
    mpSend(prev, {
      id: 'board', moves: b.moves, winner: mp.rs.turn === 'black' ? 'white' : 'black', result: 'Resigned',
      last: null, seq: (b.seq || 0) + 1, blacks: b.blacks, whites: b.whites, passed: false
    }, false);
  };
  // A finished game: anyone seated may start the next one (black goes first).
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat() || !curBoard().winner) return;
    gifos.room.newRound('board', freshBoard(), { first: 'black' }).catch(mpSay);
  };

  function seatHtml(name, label) {
    var row = seatRow(name), b = curBoard();
    var who = row.id ? esc(row.name || 'Player') + (row.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    return '<div class="seat' + (mySeat() === name ? ' me' : '') + (mp.rs && mp.rs.turn === name && !b.winner ? ' turn' : '') +
      '">' + label + ' · ' + who + '</div>';
  }
  function mpStatus(b) {
    var rs = mp.rs;
    if (!ROOM) return [NEEDS_NEWER, 'warn'];
    if (!rs) return ['Setting up the board…', ''];
    var role = rs.me.role;
    if (b.winner === 'draw') return [(b.result || 'Draw') + '.', ''];
    if (b.winner) {
      var w = seatRow(b.winner);
      return [(b.result ? b.result + ' — ' : '') + (w.id && w.name ? w.name : b.winner) + ' wins.', mySeat() === b.winner ? 'good' : ''];
    }
    if (role === 'waiting') return ['Waiting for a seat to open…', ''];
    if (role === 'asking') return ['Asking the host if you can play…', ''];
    if (!mySeat()) return ['Watching.', ''];
    if (mpCanPlay()) return [(b.passed ? 'No move for the other side. ' : '') + (rs.live ? 'Your turn.' : (rs.turn === 'black' ? 'Black' : 'White') + ' to play.') + ' Tap a dotted square.', ''];
    var t = seatRow(rs.turn);
    if (t.here === 'away') return ['Waiting for ' + (t.name || rs.turn) + ' to come back…', ''];
    if (!t.id) return ['Waiting for another player… press Invite (top bar) to bring a friend.', ''];
    return ['Waiting for ' + (t.name || rs.turn) + '…', ''];
  }
  function mpRender(snap) {
    if (!mp.on) return;
    var b = curBoard(), rs = mp.rs;
    var s = R.replay(b.moves || []);
    $('fSeats').innerHTML = seatHtml('black', 'Black') + seatHtml('white', 'White');
    $('fQueue').textContent = rs && rs.line && rs.line.length
      ? 'Next in line: ' + rs.line.map(function (p) { return p.name || 'Player'; }).join(', ')
      : '';
    setScore($('fScore'), s, !b.winner);
    var st = mpStatus(b);
    setStatus($('fStatus'), mp.note && ROOM ? mp.note : st[0], st[1]);
    var can = mpCanPlay();
    var seq = b.seq || 0;
    var hints = can;
    var hintColor = rs && rs.turn ? R.colorNum(rs.turn) : s.turn;
    if (snap || seq === _mpSeqPaint || !s.last || seq === 0) {
      paint($('fBoard'), s, { hints: hints, hintColor: hintColor });
      _mpSeqPaint = seq;
    } else {
      var prev = R.replay((b.moves || []).slice(0, -1));
      _mpSeqPaint = seq;
      animatePlace($('fBoard'), prev, s, function () {
        paint($('fBoard'), s, { hints: hints, hintColor: hintColor });
      });
    }
    // Squares are buttons: only a legal square on your own turn is live.
    var legal = {};
    if (can && !s.winner) R.availableMoves(s.map, hintColor).forEach(function (m) { legal[m.r + ',' + m.c] = 1; });
    Array.prototype.forEach.call($('fBoard').children, function (sq) {
      var off = !legal[sq.getAttribute('data-r') + ',' + sq.getAttribute('data-c')];
      sq.setAttribute('aria-disabled', off ? 'true' : 'false');
    });
    $('fResign').hidden = !(can && (b.moves || []).length);
    $('fNew').hidden = !(ROOM && mySeat() && b.winner);
  }

  makeBoard($('fBoard'), function (r, c) { mpPlay(r, c); }, 'click');
  Array.prototype.forEach.call($('fBoard').children, function (sq) {
    sq.setAttribute('role', 'button'); sq.setAttribute('tabindex', '0'); sq.setAttribute('aria-disabled', 'true');
    sq.setAttribute('aria-label', 'Row ' + (+sq.getAttribute('data-r') + 1) + ', column ' + (+sq.getAttribute('data-c') + 1));
  });

  // The game only, so the checks and a tester can compare copies.
  window['__reversi'] = { state: function () {
    var b = mp.board;
    return { moves: b && b.moves ? b.moves.map(function (m) { return m.r + '' + m.c; }).join(',') : '', winner: b ? b.winner : null };
  } };

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) { $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready'); }
  });

  // The board arrives as data; the room's word arrives from gifos.room.
  if (mpDb) mpDb.subscribe(function (items) {
    var b = null, i;
    for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'board') b = items[i];
    mp.board = b;
    mp.note = '';
    mpRender();
  });
  if (ROOM) gifos.room.subscribe(function (s) {
    mp.rs = s; mp.note = '';
    // Somebody else is here: the room is what they see, without a mode tap. Not over a local game in progress.
    if (!mp.on && !mp.auto && s.live && !$('setup').hidden && !(state.s && !state.over)) { mp.auto = true; mpEnter(); return; }
    mpRender();
  });
  setChip('ready', 'Ready');
  if (!ROOM) { $('needsNewer').hidden = false; $('needsNewer').textContent = NEEDS_NEWER; }
  if (db) {
    db.get('game').then(function (g) {
      if (mp.on || !g || !g.moves || !g.moves.length || g.over) return;
      state.mode = g.mode || 'cpu';
      state.color = g.color || 'black';
      state.hist = g.moves.slice();
      state.s = R.replay(state.hist);
      state.over = !!state.s.winner;
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two here');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('colorSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-color') === state.color);
        });
        setChip('ready', 'Computer');
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      paint($('board'), state.s, { hints: isHumanTurn(), hintColor: state.s.turn });
      localStatus();
      if (!state.over && state.mode === 'cpu' && R.colorName(state.s.turn) !== state.color) aiMove();
    }).catch(function () {});
  }
})();
