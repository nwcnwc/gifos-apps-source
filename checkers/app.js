// Checkers — jump, crown a king. Computer is stroibot's random-legal AI.
// A friend sits the other colour on a shared board. Invite is OS chrome.
(function () {
  'use strict';
  var C = window.CK;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var state = {
    mode: 'cpu', color: 'white',
    s: null, hist: [], over: false, thinking: false, sel: null
  };
  var aiGen = 0;
  var db = null;
  try { if (window.gifos) db = gifos.db('save'); } catch (e) {}

  function setChip(cls, text) {
    $('aiChip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('aiState').textContent = text;
  }
  function setStatus(el, text, cls) {
    el.className = 'turnpill' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }
  function setScore(el, s) {
    if (!el || !s) return;
    var turn = s.winner ? '' : C.colorName(s.turn);
    el.innerHTML = '<span class="wht' + (turn === 'white' ? ' on' : '') + '">○ ' + s.whites + '</span>' +
      '<span class="blk' + (turn === 'black' ? ' on' : '') + '">● ' + s.blacks + '</span>';
  }
  function shouldFlip() {
    return state.mode === 'cpu' && state.color === 'black';
  }
  function cancelAi() {
    aiGen++;
    state.thinking = false;
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
    $('cpuNote').textContent = state.color === 'white'
      ? 'You play white and go first. The computer plays black. It thinks on this device.'
      : 'You play black. The computer plays white, and goes first.';
  });

  function makeBoard(el, onTap) {
    el.innerHTML = '';
    var r, c, sq;
    for (r = 0; r < C.SIZE; r++) for (c = 0; c < C.SIZE; c++) {
      sq = document.createElement('div');
      sq.className = 'square' + (C.isDark(r, c) ? ' dark' : ' light');
      sq.setAttribute('data-r', String(r));
      sq.setAttribute('data-c', String(c));
      sq.addEventListener('click', function () {
        onTap(+this.getAttribute('data-r'), +this.getAttribute('data-c'));
      });
      el.appendChild(sq);
    }
  }

  function paint(boardEl, s, opts) {
    opts = opts || {};
    if (!boardEl) return;
    boardEl.classList.toggle('flip', !!opts.flip);
    boardEl.classList.toggle('busy', !!opts.busy);
    var r, c, sq, piece, val, key, legal = {}, cap = {}, must = {}, i, ms, m;
    var selected = opts.selected;
    if (opts.hints && s && !s.winner) {
      ms = C.legalMoves(s);
      for (i = 0; i < ms.length; i++) {
        if (ms[i].capture) must[ms[i].fr + ',' + ms[i].fc] = 1;
      }
      if (selected) {
        for (i = 0; i < ms.length; i++) {
          m = ms[i];
          if (m.fr === selected.r && m.fc === selected.c) {
            legal[m.tr + ',' + m.tc] = 1;
            if (m.capture) cap[m.tr + ',' + m.tc] = 1;
          }
        }
      }
    }
    for (r = 0; r < C.SIZE; r++) for (c = 0; c < C.SIZE; c++) {
      sq = boardEl.children[r * C.SIZE + c];
      if (!sq) continue;
      key = r + ',' + c;
      sq.className = 'square' + (C.isDark(r, c) ? ' dark' : ' light');
      if (s && s.last && ((s.last.fr === r && s.last.fc === c) || (s.last.tr === r && s.last.tc === c))) {
        sq.classList.add('last');
      }
      if (s && s.last && s.last.capture && s.last.capture.r === r && s.last.capture.c === c) {
        sq.classList.add('took');
      }
      if (legal[key]) {
        sq.classList.add('hint');
        if (cap[key]) sq.classList.add('cap');
      }
      sq.innerHTML = '';
      val = s ? s.map[r][c] : 0;
      if (!val) continue;
      piece = document.createElement('div');
      piece.className = 'piece ' + (C.owner(val) === C.BLACK ? 'black' : 'white');
      if (C.isKing(val)) piece.classList.add('king');
      if (selected && selected.r === r && selected.c === c) piece.classList.add('selected');
      if (must[key] && !(selected && selected.r === r && selected.c === c)) piece.classList.add('must');
      sq.appendChild(piece);
    }
  }

  function pulseMust(boardEl) {
    if (!boardEl) return;
    var nodes = boardEl.querySelectorAll('.piece.must, .piece.selected');
    Array.prototype.forEach.call(nodes, function (p) {
      p.classList.remove('nudge');
      void p.offsetWidth;
      p.classList.add('nudge');
    });
  }

  function isHumanTurn() {
    if (!state.s || state.over || state.thinking) return false;
    if (state.mode === 'hotseat') return true;
    return C.colorName(state.s.turn) === state.color;
  }
  function localOpts(extra) {
    extra = extra || {};
    if (extra.hints === undefined) extra.hints = isHumanTurn();
    if (extra.selected === undefined) extra.selected = state.sel;
    extra.flip = shouldFlip();
    if (extra.busy === undefined) extra.busy = !!state.thinking;
    return extra;
  }
  function localStatus() {
    if (!state.s) return;
    setScore($('scoreLine'), state.s);
    if (state.s.winner) {
      var you = state.mode === 'cpu' && state.s.winner === C.colorNum(state.color);
      var msg = state.mode === 'hotseat'
        ? (C.colorName(state.s.winner).charAt(0).toUpperCase() + C.colorName(state.s.winner).slice(1) + ' wins.')
        : (you ? 'You win.' : 'The computer wins.');
      setStatus($('statusLine'), msg, you ? 'good' : 'warn');
      return;
    }
    if (state.thinking) { setStatus($('statusLine'), 'Computer is thinking…', 'think'); return; }
    var must = C.legalMoves(state.s).some(function (m) { return m.capture; });
    var jump = must ? (state.s.locked ? 'Keep jumping. ' : 'You must jump. ') : '';
    var side = C.colorName(state.s.turn);
    var cls = must ? 'must' : side;
    if (state.mode === 'hotseat') {
      setStatus($('statusLine'), jump + side.charAt(0).toUpperCase() + side.slice(1) + ' to play. Tap a piece, then a square.', cls);
    } else {
      setStatus($('statusLine'), jump + (side === state.color
        ? 'Your turn. Tap a piece, then a square.' : 'Computer to play.'), cls);
    }
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', mode: state.mode, color: state.color,
      moves: state.hist.map(function (m) { return { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }; }),
      over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function autoSelect() {
    if (!state.s || state.over || !isHumanTurn()) { state.sel = null; return; }
    if (state.s.locked) { state.sel = { r: state.s.locked.r, c: state.s.locked.c }; return; }
    var ms = C.legalMoves(state.s), keys = {}, i, k, only = null, n = 0;
    for (i = 0; i < ms.length; i++) {
      k = ms[i].fr + ',' + ms[i].fc;
      if (!keys[k]) { keys[k] = 1; n++; only = { r: ms[i].fr, c: ms[i].fc }; }
    }
    if (n === 1) state.sel = only;
    else if (state.sel && !keys[state.sel.r + ',' + state.sel.c]) state.sel = null;
  }
  function afterLocal() {
    autoSelect();
    paint($('board'), state.s, localOpts());
    localStatus();
    saveLocal();
    if (!state.over && !state.thinking && state.mode === 'cpu' && C.colorName(state.s.turn) !== state.color) aiMove();
  }
  function applyLocal(fr, fc, tr, tc) {
    if (!state.s || state.over) return false;
    var ns = C.play(state.s, fr, fc, tr, tc);
    if (!ns) return false;
    state.hist.push({ fr: fr, fc: fc, tr: tr, tc: tc, color: state.s.turn });
    state.s = ns;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    return true;
  }
  function playLocal(fr, fc, tr, tc) {
    if (!state.s || state.over) return false;
    if (state.mode === 'cpu' && state.thinking) return false;
    if (!applyLocal(fr, fc, tr, tc)) return false;
    afterLocal();
    return true;
  }
  function tapLocal(r, c) {
    if (!isHumanTurn()) return;
    var s = state.s;
    if (state.sel && (state.sel.r !== r || state.sel.c !== c)) {
      if (playLocal(state.sel.r, state.sel.c, r, c)) return;
      pulseMust($('board'));
    }
    if (s.locked) {
      state.sel = { r: s.locked.r, c: s.locked.c };
      paint($('board'), s, localOpts({ hints: true, selected: state.sel }));
      if (state.sel.r !== r || state.sel.c !== c) pulseMust($('board'));
      return;
    }
    if (C.owner(s.map[r][c]) === s.turn) {
      var ms = C.legalMoves(s), has = false, keys = {}, i, n = 0;
      for (i = 0; i < ms.length; i++) {
        if (ms[i].fr === r && ms[i].fc === c) has = true;
        if (!keys[ms[i].fr + ',' + ms[i].fc]) { keys[ms[i].fr + ',' + ms[i].fc] = 1; n++; }
      }
      if (has) {
        var same = state.sel && state.sel.r === r && state.sel.c === c;
        if (same && n > 1 && !s.locked) state.sel = null;
        else state.sel = { r: r, c: c };
        paint($('board'), s, localOpts({ hints: true, selected: state.sel }));
      } else {
        pulseMust($('board'));
      }
    } else {
      pulseMust($('board'));
    }
  }
  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu' || state.thinking) return;
    if (C.colorName(state.s.turn) === state.color) return;
    var gen = ++aiGen;
    state.thinking = true;
    state.sel = null;
    setChip('thinking', 'Thinking…');
    localStatus();
    paint($('board'), state.s, localOpts({ hints: false, selected: null, busy: true }));
    var dog = setTimeout(function () {
      if (gen !== aiGen) return;
      state.thinking = false;
      setChip('ready', 'Ready');
      afterLocal();
    }, 2500);
    function finish(retry) {
      if (gen !== aiGen) return;
      clearTimeout(dog);
      state.thinking = false;
      setChip('ready', 'Ready');
      if (retry) afterLocal();
      else {
        localStatus();
        paint($('board'), state.s, localOpts({ hints: isHumanTurn(), busy: false }));
      }
    }
    setTimeout(function step() {
      if (gen !== aiGen) return;
      if (!state.s || state.over || state.mode !== 'cpu') { finish(false); return; }
      if (C.colorName(state.s.turn) === state.color) { finish(true); return; }
      var move = null;
      try { move = C.aiMove(state.s); } catch (e) { finish(false); return; }
      if (!move || !applyLocal(move.fr, move.fc, move.tr, move.tc)) { finish(false); return; }
      paint($('board'), state.s, localOpts({ hints: false, selected: null, busy: true }));
      if (state.s.locked && C.colorName(state.s.turn) !== state.color) {
        setTimeout(step, 280);
        return;
      }
      finish(true);
    }, 220);
  }
  function popTurn(hist) {
    if (!hist.length) return;
    var color = hist[hist.length - 1].color;
    while (hist.length && hist[hist.length - 1].color === color) hist.pop();
  }
  function undoLocal() {
    if (!state.hist.length) return;
    cancelAi();
    popTurn(state.hist);
    if (state.mode === 'cpu' && state.hist.length) popTurn(state.hist);
    state.s = C.replay(state.hist);
    state.over = !!state.s.winner;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    afterLocal();
  }
  function newLocal() {
    cancelAi();
    state.s = C.fresh(); state.hist = []; state.over = false;
    state.sel = null;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    afterLocal();
  }

  makeBoard($('board'), tapLocal);
  $('startBtn').onclick = function () { newLocal(); };
  $('newBtn').onclick = function () {
    cancelAi();
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;

  // ---- multiplayer ----
  // Who sits, whose turn it is, who is here and who waits is gifos.room's (manifest "room"). This app draws the
  // board and makes moves: the mover writes the whole next board with gifos.room.move.
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var NEEDS_NEWER = 'Checkers needs a newer GifOS to play together. Reload the page to update.';
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  var mp = { on: false, rs: null, board: null, sel: null, auto: false, note: '' };

  function freshBoard() {
    return { id: 'board', moves: [], winner: null, result: '', last: null, seq: 0, whites: 20, blacks: 20 };
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
    mp.on = true; mp.sel = null;
    $('setup').hidden = true; $('game').hidden = true; $('friend').hidden = false;
    setChip('ready', 'A friend');
    // Opening the game is asking to play; the room seats, lines up, or asks the host.
    if (ROOM && mp.rs && mp.rs.me && mp.rs.me.role === 'watcher') gifos.room.join().catch(function () {});
    mpRender();
  }
  function mpLeave() {
    mp.on = false;
    if (ROOM) gifos.room.leave().catch(function () {});
    $('friend').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  }
  $('fLeave').onclick = mpLeave;

  function mpSend(prev, nb, keep) {
    mp.board = nb; mpRender();
    gifos.room.move('board', nb, keep ? { keep: true } : undefined).catch(function (e) { mp.board = prev; mp.sel = null; mpSay(e); });
  }
  // The refusal note stays until the next room state, board change or tap.
  function mpPlay(fr, fc, tr, tc) {
    mp.note = '';
    if (!mpCanPlay()) return false;
    var prev = mp.board, b = curBoard();
    var ns = C.play(C.replay(b.moves || []), fr, fc, tr, tc);
    if (!ns) return false;
    var nb = {
      id: 'board', moves: (b.moves || []).concat([{ fr: fr, fc: fc, tr: tr, tc: tc }]), winner: null, result: '',
      last: { fr: fr, fc: fc, tr: tr, tc: tc }, seq: (b.seq || 0) + 1, whites: ns.whites, blacks: ns.blacks
    };
    if (ns.winner) { nb.winner = C.colorName(ns.winner); nb.result = 'No pieces left'; }
    // A jump that can continue keeps the turn with the mover.
    mpSend(prev, nb, !!ns.locked && !nb.winner);
    return true;
  }
  $('fResign').onclick = function () {
    if (!mpCanPlay() || !(curBoard().moves || []).length) return;
    var prev = mp.board, b = curBoard();
    mpSend(prev, {
      id: 'board', moves: b.moves, winner: mp.rs.turn === 'white' ? 'black' : 'white', result: 'Resigned',
      last: null, seq: (b.seq || 0) + 1, whites: b.whites, blacks: b.blacks
    }, false);
  };
  // A finished game: anyone seated may start the next one (white goes first).
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat() || !curBoard().winner) return;
    gifos.room.newRound('board', freshBoard(), { first: 'white' }).catch(mpSay);
  };

  function mpSelOf(s, can) {
    if (!can || !s || s.winner) return null;
    if (s.locked) return { r: s.locked.r, c: s.locked.c };
    return mp.sel;
  }
  function seatHtml(name, mark) {
    var row = seatRow(name), b = curBoard();
    var who = row.id ? esc(row.name || 'Player') + (row.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    return '<div class="seat' + (mySeat() === name ? ' me' : '') + (mp.rs && mp.rs.turn === name && !b.winner ? ' turn' : '') +
      '">' + mark + ' ' + who + '</div>';
  }
  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), rs = mp.rs, status = $('fStatus'), seat = mySeat();
    var s = C.replay(b.moves || []);
    var can = mpCanPlay();
    $('fSeats').innerHTML = seatHtml('white', '○') + seatHtml('black', '●');
    $('fQueue').textContent = rs && rs.line && rs.line.length
      ? 'Next in line: ' + rs.line.map(function (p) { return p.name || 'Player'; }).join(', ')
      : '';
    setScore($('fScore'), s);
    var txt, cls = '';
    if (!ROOM) { txt = NEEDS_NEWER; }
    else if (!rs) { txt = 'Setting up the board…'; }
    else if (b.winner) {
      var w = seatRow(b.winner);
      txt = b.winner === 'draw' ? (b.result || 'Draw') + '.' : (b.result ? b.result + ' — ' : '') + (w.id && w.name ? w.name : b.winner) + ' wins.';
      cls = b.winner === 'draw' ? '' : 'good';
    } else if (rs.me.role === 'waiting') { txt = 'Waiting for a seat to open…'; }
    else if (rs.me.role === 'asking') { txt = 'Asking the host if you can play…'; }
    else if (!seat) { txt = 'Watching.'; }
    else if (can) {
      var must = C.legalMoves(s).some(function (m) { return m.capture; });
      cls = must ? 'must' : rs.turn;
      txt = (must ? (s.locked ? 'Keep jumping. ' : 'You must jump. ') : '') + (rs.live ? 'Your turn.' : (rs.turn === 'white' ? 'White' : 'Black') + ' to play.') + ' Tap a piece, then a square.';
    } else {
      var t = seatRow(rs.turn);
      cls = rs.turn;
      if (t.here === 'away') txt = 'Waiting for ' + (t.name || rs.turn) + ' to come back…';
      else if (!t.id) { txt = 'Waiting for another player… press Invite (top bar) to bring a friend.'; cls = ''; }
      else txt = 'Waiting for ' + (t.name || rs.turn) + '…';
    }
    status.className = 'turnpill' + (cls ? ' ' + cls : '');
    status.textContent = mp.note && ROOM ? mp.note : txt;
    if (!can) mp.sel = null;
    if (can && s.locked) mp.sel = { r: s.locked.r, c: s.locked.c };
    paint($('fBoard'), s, { hints: can, selected: mpSelOf(s, can), flip: seat === 'black' });
    // Squares are buttons: only a piece that can move, or a square the selected piece can reach, is live.
    var live = {};
    if (can && !s.winner) C.legalMoves(s).forEach(function (m) {
      if (!mp.sel) { live[m.fr + ',' + m.fc] = 1; return; }
      // a piece is picked: it (to put it back) and the squares it can reach
      if (m.fr === mp.sel.r && m.fc === mp.sel.c) { live[m.fr + ',' + m.fc] = 1; live[m.tr + ',' + m.tc] = 1; }
    });
    Array.prototype.forEach.call($('fBoard').children, function (sq) {
      sq.setAttribute('aria-disabled', live[sq.getAttribute('data-r') + ',' + sq.getAttribute('data-c')] ? 'false' : 'true');
    });
    $('fResign').hidden = !(can && (b.moves || []).length);
    $('fNew').hidden = !(ROOM && seat && b.winner);
  }

  makeBoard($('fBoard'), function (r, c) {
    if (!mpCanPlay()) return;
    var s = C.replay(curBoard().moves || []);
    if (mp.sel && (mp.sel.r !== r || mp.sel.c !== c)) {
      if (mpPlay(mp.sel.r, mp.sel.c, r, c)) { mp.sel = null; return; }
      pulseMust($('fBoard'));
    }
    if (s.locked) { mp.sel = { r: s.locked.r, c: s.locked.c }; mpRender(); return; }
    if (C.owner(s.map[r][c]) === s.turn) {
      var ms = C.legalMoves(s), has = false, keys = {}, i, n = 0;
      for (i = 0; i < ms.length; i++) {
        if (ms[i].fr === r && ms[i].fc === c) has = true;
        if (!keys[ms[i].fr + ',' + ms[i].fc]) { keys[ms[i].fr + ',' + ms[i].fc] = 1; n++; }
      }
      if (has) {
        var same = mp.sel && mp.sel.r === r && mp.sel.c === c;
        if (same && n > 1 && !s.locked) mp.sel = null;
        else mp.sel = { r: r, c: c };
        mpRender();
      } else {
        pulseMust($('fBoard'));
      }
    } else {
      pulseMust($('fBoard'));
    }
  });
  Array.prototype.forEach.call($('fBoard').children, function (sq) {
    sq.setAttribute('role', 'button'); sq.setAttribute('tabindex', '0'); sq.setAttribute('aria-disabled', 'true');
    sq.setAttribute('aria-label', 'Row ' + (+sq.getAttribute('data-r') + 1) + ', column ' + (+sq.getAttribute('data-c') + 1));
  });

  // The game only, so the checks and a tester can compare copies.
  window['__checkers'] = { state: function () {
    var b = mp.board;
    return { moves: b && b.moves ? b.moves.map(function (m) { return m.fr + '' + m.fc + m.tr + m.tc; }).join(',') : '', winner: b ? b.winner : null };
  } };

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) {
      cancelAi();
      $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
    }
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
      state.color = g.color || 'white';
      state.hist = g.moves.slice();
      state.s = C.replay(state.hist);
      state.over = !!state.s.winner;
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two players');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('colorSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-color') === state.color);
        });
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      afterLocal();
    }).catch(function () {});
  }
})();
