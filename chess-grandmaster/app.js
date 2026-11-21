// Chess Grandmaster — play a full-strength Stockfish (NNUE) that runs entirely
// on your device, offline, inside the GifOS sandbox. Pick a level from club
// player to full engine, and watch the live win/draw/loss read as it thinks.
(function () {
  const C = window.GM.Chess;
  const GLYPH = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };

  // Strength ladder. Below top, we cap Stockfish's calibrated Elo; the top rung
  // is the unshackled engine — objectively stronger than any human alive.
  const LEVELS = [
    { name: 'Beginner', elo: 1320, note: 'Just learning — blunders like a new player.' },
    { name: 'Casual', elo: 1500, note: 'Knows the pieces, misses tactics.' },
    { name: 'Club player', elo: 1750, note: 'Solid amateur. Punishes loose moves.' },
    { name: 'Strong club', elo: 2000, note: 'Sharp tactics, real endgame technique.' },
    { name: 'Expert', elo: 2250, note: 'Very few free gifts. Bring a plan.' },
    { name: 'Master', elo: 2500, note: 'Master strength. Precise and unforgiving.' },
    { name: 'Grandmaster', elo: 2850, note: 'GM level. You will need to be perfect.' },
    { name: 'Stockfish (full)', elo: null, skill: 20, note: 'The engine at full strength. Unbeatable.' },
  ];

  const $ = (id) => document.getElementById(id);
  const board = $('board'), statusLine = $('statusLine');
  const engineChip = $('engineChip'), engineState = $('engineState');

  const state = {
    s: null, hist: [], uci: [],
    playerColor: 'w', orient: 'w', levelIx: 3, movetime: 800,
    coach: true, recorded: false, startedAt: 0,
    over: false, result: '', lastMove: null, sel: null, legalFromSel: [],
    hint: null, thinking: false, token: 0,
    evalWhite: 0, mate: null, wdlWhite: null, pv: [],
  };
  let review = null; // an independent replay session: { game, hist, ix, orient }
  const nowMs = () => (window.Date ? Date.now() : 0);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const engine = new window.GM.Engine();
  let db = null; try { db = window.gifos ? gifos.db('chess-gm') : null; } catch (e) {}

  // ---- boot the engine ----
  (function populateLevels() {
    LEVELS.forEach((l, i) => { const o = document.createElement('option'); o.value = i; o.textContent = l.name + (l.elo ? ' · ~' + l.elo : ' · max'); $('levelSel').appendChild(o); });
    $('levelSel').value = state.levelIx;
    $('lvlNote').textContent = LEVELS[state.levelIx].note;
  })();
  $('levelSel').onchange = function () { state.levelIx = +this.value; $('lvlNote').textContent = LEVELS[state.levelIx].note; };
  $('timeSel').onchange = function () { state.movetime = +this.value; };
  $('sideSeg').addEventListener('click', function (e) {
    const b = e.target.closest('button'); if (!b) return;
    Array.from(this.children).forEach((c) => c.classList.remove('on')); b.classList.add('on');
    state.playerColor = b.dataset.side;
  });

  engine.start().then(function () {
    setChip('ready', 'Stockfish ready');
    window.GM.engine = engine; window.GM.engineReady = true; // shared with friend-mode commentary
    $('startBtn').disabled = false; $('startBtn').textContent = 'Start game';
    // Resume a saved game if one exists.
    if (db) db.get('game').then(function (g) { if (g && g.uci) resume(g); }).catch(function () {});
  }).catch(function (err) {
    setChip('', 'Engine failed'); $('startBtn').textContent = 'Engine unavailable';
    statusLine.textContent = 'Could not start the engine: ' + (err && err.message || err);
  });

  function setChip(cls, text) { engineChip.className = 'engine-chip' + (cls ? ' ' + cls : ''); engineState.textContent = text; }

  // ---- start / resume ----
  $('startBtn').onclick = function () { newGame(); };
  $('newBtn').onclick = function () { $('game').hidden = true; $('setup').hidden = false; };
  $('resignBtn').onclick = function () { if (state.over) return; endGame('You resigned. ' + (state.playerColor === 'w' ? 'Black' : 'White') + ' wins.', 'warn', 'loss'); };
  $('undoBtn').onclick = takeBack;
  $('hintBtn').onclick = showHint;
  $('coachChk').onchange = function () { state.coach = this.checked; };
  $('coachBtn').onclick = function () { state.coach = !state.coach; $('coachChk').checked = state.coach; applyCoach(); };
  $('historyBtn').onclick = openHistory;

  // Show/hide all the coaching surfaces (eval bar, W/D/L, best line, Hint).
  function applyCoach() {
    const on = state.coach;
    $('evalWrap').hidden = !on;
    $('wdl').hidden = !on;
    $('bestLine').style.display = on ? '' : 'none';
    $('hintBtn').style.display = on ? '' : 'none';
    $('coachBtn').textContent = on ? '👁 Coaching: on' : '👁 Coaching: off';
    if (on) { if (!state.over && state.s && state.s.turn === state.playerColor) evalNow(); }
    else { state.hint = null; renderBoard(); }
  }

  function newGame() {
    let pc = state.playerColor; if (pc === 'r') pc = Math.random() < 0.5 ? 'w' : 'b';
    state.playerColor = pc; state.orient = pc;
    state.coach = $('coachChk').checked;
    state.s = C.fresh(); state.hist = [state.s]; state.uci = [];
    state.over = false; state.recorded = false; state.result = ''; state.lastMove = null; state.sel = null;
    state.hint = null; state.evalWhite = 0; state.mate = null; state.wdlWhite = null; state.pv = [];
    state.startedAt = nowMs(); state.token++;
    $('setup').hidden = true; $('history').hidden = true; $('review').hidden = true; $('game').hidden = false;
    engine.newGame();
    engine.configure(LEVELS[state.levelIx].elo != null ? { elo: LEVELS[state.levelIx].elo } : { skill: LEVELS[state.levelIx].skill });
    render(); applyCoach(); save();
    if (state.s.turn !== state.playerColor) engineMove(); else evalNow();
  }

  function resume(g) {
    try {
      state.playerColor = g.playerColor || 'w'; state.orient = state.playerColor;
      state.levelIx = g.levelIx != null ? g.levelIx : state.levelIx; state.movetime = g.movetime || state.movetime;
      $('levelSel').value = state.levelIx; $('lvlNote').textContent = LEVELS[state.levelIx].note; $('timeSel').value = state.movetime;
      let s = C.fresh(); const hist = [s];
      for (const u of g.uci) { const mv = C.uciToMove(s, u); if (!mv) break; s = C.make(s, mv); hist.push(s); }
      state.s = s; state.hist = hist; state.uci = g.uci.slice(); state.over = !!g.over; state.result = g.result || '';
      state.recorded = !!g.over; state.startedAt = g.startedAt || nowMs();
      state.lastMove = lastMoveFromUci(state.uci[state.uci.length - 1]);
      state.token++;
      engine.newGame();
      engine.configure(LEVELS[state.levelIx].elo != null ? { elo: LEVELS[state.levelIx].elo } : { skill: LEVELS[state.levelIx].skill });
      $('setup').hidden = true; $('game').hidden = false;
      render(); applyCoach();
      if (!state.over) { if (state.s.turn !== state.playerColor) engineMove(); else evalNow(); }
      statusLine.textContent = state.over ? state.result : (state.s.turn === state.playerColor ? 'Your move.' : 'Stockfish is thinking…');
    } catch (e) {}
  }

  function lastMoveFromUci(u) { if (!u) return null; const f = 'abcdefgh'.indexOf(u[0]), fy = 8 - +u[1], t = 'abcdefgh'.indexOf(u[2]), ty = 8 - +u[3]; return { from: [f, fy], to: [t, ty] }; }

  // ---- the engine's move ----
  function engineMove() {
    if (state.over) return;
    const tok = state.token; setThinking(true);
    engine.search(C.toFEN(state.s), { movetime: state.movetime }, function (info) {
      if (tok === state.token) { applyEval(info, state.s.turn); renderEvalOnly(); }
    }).then(function (r) {
      if (tok !== state.token) return;
      applyEval(r, state.s.turn);
      const mv = r.bestmove && C.uciToMove(state.s, r.bestmove);
      setThinking(false);
      if (!mv) { checkEnd(); return; }
      pushMove(mv); render(); save();
      if (!checkEnd()) evalNow();
    }).catch(function () { if (tok === state.token) setThinking(false); });
  }

  // A short, non-committal search while it's the human's turn: keeps the eval
  // bar and probabilities live. It does NOT populate the on-board hint — a hint
  // only ever appears when the player presses Hint. Skipped entirely when
  // coaching is off (no eval, no probabilities, no wasted search).
  function evalNow() {
    if (!state.coach || state.over || state.s.turn !== state.playerColor) return;
    const tok = state.token;
    engine.search(C.toFEN(state.s), { movetime: Math.min(500, state.movetime) }, function (info) {
      if (tok === state.token) { applyEval(info, state.s.turn); renderEvalOnly(); }
    }).then(function (r) {
      if (tok !== state.token) return;
      applyEval(r, state.s.turn);
      renderEvalOnly();
    }).catch(function () {});
  }

  // Convert a search result (side-to-move relative) to White's perspective.
  function applyEval(info, sideToMove) {
    const sgn = sideToMove === 'w' ? 1 : -1;
    if (info.mate != null) { state.mate = sgn * info.mate; state.evalWhite = sgn * (info.mate > 0 ? 100 : -100); }
    else if (info.score != null) { state.mate = null; state.evalWhite = sgn * info.score / 100; }
    if (info.wdl) state.wdlWhite = sideToMove === 'w' ? info.wdl : [info.wdl[2], info.wdl[1], info.wdl[0]];
    if (info.pv && info.pv.length) state.pv = info.pv.slice(0, 6);
  }

  // ---- moves ----
  function pushMove(mv) {
    state.s = C.make(state.s, mv); state.hist.push(state.s); state.uci.push(C.moveToUci(mv));
    state.lastMove = { from: mv.from, to: mv.to }; state.sel = null; state.hint = null;
  }

  function takeBack() {
    if (state.thinking || state.over) return;
    // remove the engine's reply + your move, so it's your turn again
    let removed = 0;
    while (state.uci.length && removed < 2) {
      state.uci.pop(); state.hist.pop(); removed++;
      if (state.hist[state.hist.length - 1] && state.hist[state.hist.length - 1].turn === state.playerColor) break;
    }
    state.s = state.hist[state.hist.length - 1] || C.fresh();
    state.over = false; state.result = ''; state.sel = null; state.hint = null;
    state.lastMove = lastMoveFromUci(state.uci[state.uci.length - 1]);
    state.token++;
    render(); save(); evalNow();
  }

  function checkEnd() {
    const st = C.status(state.s);
    if (st === 'checkmate') { const winner = state.s.turn === 'w' ? 'Black' : 'White'; const won = isPlayerWinner(winner); endGame('Checkmate — ' + winner + ' wins.', won ? 'good' : 'warn', won ? 'win' : 'loss'); return true; }
    if (st === 'stalemate') { endGame('Stalemate — it’s a draw.', '', 'draw'); return true; }
    if (state.s.half >= 100) { endGame('Draw by the fifty-move rule.', '', 'draw'); return true; }
    return false;
  }
  function isPlayerWinner(winner) { return (winner === 'White') === (state.playerColor === 'w'); }

  function endGame(msg, cls, code) {
    state.over = true; state.result = msg; state.token++; setThinking(false);
    statusLine.className = 'statusline' + (cls ? ' ' + cls : ''); statusLine.textContent = msg;
    recordGame(code || 'draw');
    render(); save();
  }

  // ---- game history (each finished game saved as its own db record) ----
  function recordGame(code) {
    if (!db || state.recorded || !state.uci.length) return;
    state.recorded = true;
    const lvl = LEVELS[state.levelIx];
    db.put({
      id: 'game_' + nowMs() + '_' + Math.random().toString(36).slice(2, 6),
      kind: 'history', when: state.startedAt || nowMs(),
      opponent: 'Stockfish · ' + lvl.name, mode: 'solo',
      playerColor: state.playerColor, levelIx: state.levelIx,
      result: code, resultText: state.result, moves: state.uci.slice(),
    }).catch(function () {});
  }

  function setThinking(on) {
    state.thinking = on;
    if (on) { setChip('thinking', 'Stockfish is thinking…'); }
    else if (engineChip.className.indexOf('thinking') > -1 || engineState.textContent.indexOf('thinking') > -1) setChip('ready', 'Stockfish ready');
    $('hintBtn').disabled = on; $('undoBtn').disabled = on;
    if (!state.over) statusLine.className = 'statusline';
    if (!state.over) statusLine.textContent = on ? 'Stockfish is thinking…' : (state.s && state.s.turn === state.playerColor ? (C.inCheck(state.s, state.playerColor === 'w') ? 'You’re in check.' : 'Your move.') : '');
  }

  // ---- board rendering ----
  //
  // A BOARD IS BUILT ONCE AND PAINTED IN PLACE. It used to be `innerHTML = ''`
  // plus 64 fresh divs on every render, and the multiplayer board renders on
  // the PRESENCE BEAT (HB_MS = 3000, and each peer's own beat lands here too,
  // so about two full rebuilds every three seconds) — not only when the
  // position changes. That means every square is a different DOM node twice a
  // second: on a loaded phone a finger that goes down just before a rebuild is
  // lifted over a node that no longer exists, and the move is silently lost.
  //
  // It cost the release gate too: Playwright will not click an element that has
  // not been stable across two consecutive animation frames, so e2e-chess-mp
  // came up RED TWICE on 2026-08-11 with `frame.click: Timeout 30000ms` on the
  // very first move — measured identical on the shipped 0.9.6 tree, so it was
  // never a regression, it was this. The suite works around it; this removes
  // the reason for the workaround.
  //
  // Reusing the nodes also means a tap handler cannot be a fresh closure over
  // (x, y): the handler reads the square's CURRENT coordinates, which is what
  // lets the board flip for Black without replacing a single node.
  function boardCells(el, onTap, tag) {
    if (el._cells && el._cells.length === 64 && el.firstChild) return el._cells;
    el.innerHTML = '';
    const cells = [];
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement(tag || 'div');
      if (tag === 'button') sq.type = 'button';
      // the piece is a TEXT NODE, not textContent: setting textContent would
      // wipe the marker and coordinate spans that live in the same square
      sq._glyph = document.createTextNode('');
      sq._mark = document.createElement('span');   // '' = no ring, no dot
      sq._rc = document.createElement('span'); sq._rc.className = 'coord r';
      sq._fc = document.createElement('span'); sq._fc.className = 'coord f';
      sq.appendChild(sq._glyph); sq.appendChild(sq._mark); sq.appendChild(sq._rc); sq.appendChild(sq._fc);
      sq.onclick = function () { onTap(sq._x, sq._y); };
      el.appendChild(sq); cells.push(sq);
    }
    el._cells = cells;
    return cells;
  }
  // innerHTML, but only when it changed. Compared against what we LAST SET, not
  // against el.innerHTML, which the browser has normalised and would never match.
  function setHtml(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
  // Write only what differs. A no-op render must touch nothing at all, or the
  // browser still recalculates style for 64 elements twice a second.
  function paintSq(sq, x, y, cls, glyph, mark, rank, file) {
    sq._x = x; sq._y = y;
    if (sq.className !== cls) sq.className = cls;
    if (sq._glyph.nodeValue !== glyph) sq._glyph.nodeValue = glyph;
    if (sq._mark.className !== mark) sq._mark.className = mark;
    if (sq._rc.textContent !== rank) sq._rc.textContent = rank;
    if (sq._fc.textContent !== file) sq._fc.textContent = file;
  }
  function bxy(r, c) { return state.orient === 'w' ? [c, r] : [7 - c, 7 - r]; }

  function render() { renderBoard(); renderEvalOnly(); renderMoves(); }

  function renderBoard() {
    const s = state.s; if (!s) return;
    const cells = boardCells(board, onSquare);
    const chkKing = (C.status(s) === 'check' || C.status(s) === 'checkmate') ? kingSq(s.board, s.turn === 'w') : null;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const [x, y] = bxy(r, c);
      const p = s.board[y * 8 + x];
      let cls = 'sq ' + (((x + y) % 2) ? 'd' : 'l');
      if (p !== '.') cls += (p >= 'A' && p <= 'Z') ? ' pw' : ' pb';
      if (state.lastMove && ((state.lastMove.from[0] === x && state.lastMove.from[1] === y) || (state.lastMove.to[0] === x && state.lastMove.to[1] === y))) cls += ' last';
      if (state.sel && state.sel[0] === x && state.sel[1] === y) cls += ' sel';
      if (state.hint && state.hint.from[0] === x && state.hint.from[1] === y) cls += ' hintf';
      if (state.hint && state.hint.to[0] === x && state.hint.to[1] === y) cls += ' hintt';
      if (chkKing && chkKing[0] === x && chkKing[1] === y) cls += ' chk';
      const legal = state.legalFromSel.some((m) => m.to[0] === x && m.to[1] === y);
      paintSq(cells[r * 8 + c], x, y, cls, p === '.' ? '' : GLYPH[p.toLowerCase()],
        legal ? (p !== '.' ? 'ring' : 'dotm') : '',
        c === 0 ? String(8 - y) : '', r === 7 ? 'abcdefgh'[x] : '');
    }
  }
  function kingSq(bd, w) { const i = bd.indexOf(w ? 'K' : 'k'); return i < 0 ? null : [i % 8, (i / 8) | 0]; }

  function renderEvalOnly() {
    // eval bar: map White-relative eval to a 0..100 split with a soft sigmoid
    let wPct, dPct, bPct;
    if (state.wdlWhite) { const t = state.wdlWhite[0] + state.wdlWhite[1] + state.wdlWhite[2] || 1; wPct = state.wdlWhite[0] / t * 100; dPct = state.wdlWhite[1] / t * 100; bPct = state.wdlWhite[2] / t * 100; }
    else { const adv = 1 / (1 + Math.exp(-state.evalWhite / 2.5)); wPct = adv * 100; dPct = 0; bPct = 100 - wPct; }
    const bar = $('evalBar'); bar.querySelector('.w').style.width = wPct + '%'; bar.querySelector('.d').style.width = dPct + '%'; bar.querySelector('.b').style.width = bPct + '%';
    $('evalNum').textContent = state.mate != null ? ('M' + Math.abs(state.mate)) : (state.evalWhite >= 0 ? '+' : '') + state.evalWhite.toFixed(1);
    $('pw').textContent = state.wdlWhite ? Math.round(state.wdlWhite[0] / 10) + '%' : '–';
    $('pd').textContent = state.wdlWhite ? Math.round(state.wdlWhite[1] / 10) + '%' : '–';
    $('pb').textContent = state.wdlWhite ? Math.round(state.wdlWhite[2] / 10) + '%' : '–';
    $('bestLine').textContent = state.pv.length ? 'Best line: ' + state.pv.join(' ') : '';
  }

  function renderMoves() {
    const el = $('moveList'); el.innerHTML = '';
    for (let i = 0; i < state.uci.length; i += 2) {
      const n = document.createElement('span'); n.className = 'n'; n.textContent = (i / 2 + 1) + '.'; el.appendChild(n);
      const w = document.createElement('span'); w.className = 'mv'; w.textContent = state.uci[i]; el.appendChild(w);
      if (state.uci[i + 1]) { const b = document.createElement('span'); b.className = 'mv'; b.textContent = state.uci[i + 1]; el.appendChild(b); }
    }
    el.scrollTop = el.scrollHeight;
  }

  // ---- interaction ----
  function onSquare(x, y) {
    if (state.over || state.thinking) return;
    if (state.s.turn !== state.playerColor) return;
    const legal = C.legal(state.s);
    if (state.sel) {
      const opts = legal.filter((m) => m.from[0] === state.sel[0] && m.from[1] === state.sel[1] && m.to[0] === x && m.to[1] === y);
      if (opts.length) { chooseAndPlay(opts); return; }
      state.sel = null; state.legalFromSel = [];
    }
    const p = state.s.board[y * 8 + x];
    if (p !== '.' && ((state.playerColor === 'w') === (p >= 'A' && p <= 'Z'))) {
      state.sel = [x, y]; state.legalFromSel = legal.filter((m) => m.from[0] === x && m.from[1] === y);
    } else { state.sel = null; state.legalFromSel = []; }
    renderBoard();
  }

  function chooseAndPlay(opts) {
    if (opts.length === 1) { play(opts[0]); return; }
    // promotion: several moves share from/to, differ by promo piece
    const box = $('promoChoices'); box.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(function (pr) {
      const mv = opts.find((m) => m.promo === pr); if (!mv) return;
      const b = document.createElement('button'); b.textContent = GLYPH[pr];
      b.className = state.playerColor === 'w' ? 'pw' : 'pb';
      b.onclick = function () { $('promo').hidden = true; play(mv); };
      box.appendChild(b);
    });
    $('promo').hidden = false;
  }

  function play(mv) {
    state.legalFromSel = []; pushMove(mv); render(); save();
    if (!checkEnd()) engineMove();
  }

  function showHint() {
    if (state.over || state.thinking || state.s.turn !== state.playerColor) return;
    if (state.hint) { renderBoard(); return; }
    const tok = state.token; $('hintBtn').disabled = true; statusLine.textContent = 'Looking for your best move…';
    engine.search(C.toFEN(state.s), { movetime: Math.max(600, state.movetime) }, null).then(function (r) {
      if (tok !== state.token) return;
      applyEval(r, state.s.turn);
      state.hint = r.bestmove ? lastMoveFromUci(r.bestmove) : null;
      $('hintBtn').disabled = false; statusLine.textContent = 'Your move.'; render();
    }).catch(function () { $('hintBtn').disabled = false; });
  }

  // ---- persistence ----
  function save() {
    if (!db) return;
    db.put({ id: 'game', uci: state.uci, playerColor: state.playerColor, levelIx: state.levelIx, movetime: state.movetime, over: state.over, result: state.result }).catch(function () {});
  }

  // ---- history list ----
  const RESULT = { win: ['Win', 'win'], loss: ['Loss', 'loss'], draw: ['Draw', 'draw'] };
  function fmtDate(ts) { try { const d = new Date(ts); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }

  function openHistory() {
    $('setup').hidden = true; $('game').hidden = true; $('review').hidden = true; $('history').hidden = false;
    const el = $('histList'); el.innerHTML = '<p class="lvlnote">Loading…</p>';
    if (!db) { el.innerHTML = '<p class="lvlnote">No storage available.</p>'; return; }
    db.getAll().then(function (items) {
      const games = (items || []).filter(function (x) { return x && x.kind === 'history'; }).sort(function (a, b) { return b.when - a.when; });
      if (!games.length) { el.innerHTML = '<p class="lvlnote">No games yet. Finish a game and it lands here — then you can replay it move by move.</p>'; return; }
      el.innerHTML = '';
      games.forEach(function (g) {
        const meta = RESULT[g.result] || ['Done', ''];
        const row = document.createElement('div'); row.className = 'hrow';
        const info = document.createElement('div'); info.className = 'hinfo';
        info.innerHTML = '<div class="hopp"><span class="badge ' + meta[1] + '">' + meta[0] + '</span> ' + esc(g.opponent) + '</div>' +
          '<div class="hmeta">' + (g.playerColor === 'w' ? '♔ White' : '♚ Black') + ' · ' + Math.ceil(g.moves.length / 2) + ' moves · ' + fmtDate(g.when) + '</div>';
        info.onclick = function () { openReview(g); };
        const del = document.createElement('button'); del.className = 'hdel'; del.textContent = '✕'; del.title = 'Delete this game';
        del.onclick = function (ev) { ev.stopPropagation(); db.delete(g.id).then(openHistory).catch(openHistory); };
        row.appendChild(info); row.appendChild(del); el.appendChild(row);
      });
    }).catch(function () { el.innerHTML = '<p class="lvlnote">Could not load history.</p>'; });
  }
  $('histBack').onclick = function () { $('history').hidden = true; $('setup').hidden = false; };

  // ---- replay / review a finished game ----
  function drawStatic(container, s, orient, lastMove) {
    container.innerHTML = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const x = orient === 'w' ? c : 7 - c, y = orient === 'w' ? r : 7 - r;
      const sq = document.createElement('div'); sq.className = 'sq ' + (((x + y) % 2) ? 'd' : 'l');
      const p = s.board[y * 8 + x];
      if (p !== '.') { sq.textContent = GLYPH[p.toLowerCase()]; sq.classList.add(p >= 'A' && p <= 'Z' ? 'pw' : 'pb'); }
      if (lastMove && ((lastMove.from[0] === x && lastMove.from[1] === y) || (lastMove.to[0] === x && lastMove.to[1] === y))) sq.classList.add('last');
      if (c === 0) { const rc = document.createElement('span'); rc.className = 'coord r'; rc.textContent = 8 - y; sq.appendChild(rc); }
      if (r === 7) { const fc = document.createElement('span'); fc.className = 'coord f'; fc.textContent = 'abcdefgh'[x]; sq.appendChild(fc); }
      container.appendChild(sq);
    }
  }

  function openReview(g) {
    const hist = [C.fresh()]; let s = hist[0];
    for (const u of g.moves) { const mv = C.uciToMove(s, u); if (!mv) break; s = C.make(s, mv); hist.push(s); }
    review = { game: g, hist: hist, ix: hist.length - 1, orient: g.playerColor || 'w' };
    $('history').hidden = true; $('setup').hidden = true; $('game').hidden = true; $('review').hidden = false;
    const meta = RESULT[g.result] || ['Done', ''];
    $('revTitle').innerHTML = '<span class="badge ' + meta[1] + '">' + meta[0] + '</span> vs ' + esc(g.opponent);
    renderReview();
  }

  function renderReview() {
    if (!review) return;
    const s = review.hist[review.ix];
    const lm = review.ix > 0 ? lastMoveFromUci(review.game.moves[review.ix - 1]) : null;
    drawStatic($('revBoard'), s, review.orient, lm);
    $('revCount').textContent = review.ix + ' / ' + (review.hist.length - 1);
    const el = $('revMoves'); el.innerHTML = ''; const mv = review.game.moves;
    for (let i = 0; i < mv.length; i += 2) {
      const n = document.createElement('span'); n.className = 'n'; n.textContent = (i / 2 + 1) + '.'; el.appendChild(n);
      [i, i + 1].forEach(function (j) {
        if (mv[j] === undefined) return;
        const w = document.createElement('span'); w.className = 'mv' + (j === review.ix - 1 ? ' cur' : ''); w.textContent = mv[j];
        w.onclick = function () { review.ix = j + 1; renderReview(); };
        el.appendChild(w);
      });
    }
    const cur = el.querySelector('.mv.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function revGo(ix) { if (!review) return; review.ix = Math.max(0, Math.min(review.hist.length - 1, ix)); renderReview(); }
  $('revFirst').onclick = function () { revGo(0); };
  $('revPrev').onclick = function () { revGo(review.ix - 1); };
  $('revNext').onclick = function () { revGo(review.ix + 1); };
  $('revLast').onclick = function () { revGo(review.hist.length - 1); };
  $('revBack').onclick = function () { $('review').hidden = true; openHistory(); };

  // ============================================================================
  // Play a friend. gifos.room seats two people (White, Black), lines the rest
  // up, keeps who is here, and passes the turn. The board is one record the
  // mover writes with gifos.room.move ('cgm-mp'). The line replaces the old
  // queue: when a game ends and people are waiting, the loser steps out of the
  // seat (and back to the end of the line), the next in line sits down, and a
  // seated player presses Next game. Stockfish is NOT a player and gives no
  // hints, but either player can flip a shared "commentary" toggle ('cgm-cmt',
  // plain shared data, not a move): after each move the mover's engine reacts
  // to the position ("Nice move!", "Ouch.") — flavour only, never the move.
  const EN = { needsNewer: 'Chess Grandmaster needs a newer GifOS to play together. Reload the page to update.' };
  const T = function (k) {
    const v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  const ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  let mpDb = null, cmtDb = null;
  try { if (window.gifos) { mpDb = gifos.db('cgm-mp'); cmtDb = gifos.db('cgm-cmt'); } } catch (e) {}
  // rs = the room's word, remote = the last board the data said, game = what we show (remote, or our own move until the echo)
  const mp = { on: false, rs: null, joined: false, picked: false, note: '', remote: null, game: null, cmt: null, sel: [], legalSel: [], commenting: false, yielded: '' };

  function freshMpGame() { return { state: C.fresh(), moves: [], lastMove: null, winner: null, result: '', endedAt: 0, no: 1, startedAt: 0 }; }
  const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  function curGame() { return mp.game || freshMpGame(); }
  function seatRow(c) { const r = mp.rs; return r && r.seats ? r.seats[c === 'w' ? 0 : 1] : null; }
  function heldBoth() { const a = seatRow('w'), b = seatRow('b'); return !!(a && a.id && b && b.id); }
  function mySeat2() { const r = mp.rs; return !r || !r.me ? null : (r.me.seat === 'White' ? 'w' : r.me.seat === 'Black' ? 'b' : null); }
  // my move: the room says it is my turn, both seats are held, and the other player is not away
  function canMove() {
    const r = mp.rs, c = mySeat2(), g = curGame();
    if (!ROOM || !r || !c || g.winner || !r.myTurn || !heldBoth() || g.state.turn !== c) return false;
    const o = seatRow(c === 'w' ? 'b' : 'w');
    return !!o && o.here !== 'away';
  }
  function say(e) { mp.note = e && e.message ? e.message : ''; mpRender(); }
  function mpPut(g, fresh) {
    const rec = { id: 'm', game: g };
    mp.game = g; mpRender();
    const p = fresh ? gifos.room.newRound('cgm-mp', rec, { first: 'White' }) : gifos.room.move('cgm-mp', rec);
    return p.catch(function (e) { mp.game = mp.remote; say(e); });
  }

  $('startBtn').addEventListener('click', function () { mp.picked = true; });
  $('historyBtn').addEventListener('click', function () { mp.picked = true; });
  $('friendBtn').onclick = function () { mp.picked = true; mpEnter(); };
  function mpEnter() {
    if (!ROOM) { $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false; return; }
    mp.on = true;
    $('setup').hidden = true; $('game').hidden = true; $('history').hidden = true; $('review').hidden = true; $('friend').hidden = false;
    mpJoin();
    mpRender();
  }
  // opening the game is asking to play, once; the room seats, lines up, or asks the host
  function mpJoin() {
    const r = mp.rs;
    if (ROOM && r && !mp.joined && r.me && r.me.role === 'watcher') { mp.joined = true; gifos.room.join().catch(function () {}); }
  }
  function mpLeave() {
    mp.on = false; mp.picked = true;
    if (ROOM) { mp.joined = false; gifos.room.leave().catch(function () {}); }
    $('friend').hidden = true; $('setup').hidden = false;
  }
  $('fLeave').onclick = mpLeave;
  $('fNext').onclick = function () { const g = curGame(); const n = freshMpGame(); n.no = (g.no || 1) + 1; if (ROOM && mySeat2()) mpPut(n, true); };

  // after a finished game the loser gives the seat to the next in line (a draw keeps both seats)
  function mpYield() {
    const r = mp.rs, c = mySeat2(), g = curGame();
    if (!ROOM || !r || !c || (g.winner !== 'w' && g.winner !== 'b') || g.winner === c || !(r.line && r.line.length)) return;
    const key = r.round + ':' + g.moves.length;
    if (mp.yielded === key) return;
    mp.yielded = key;
    gifos.room.leave().then(function () { return gifos.room.join(); }).catch(function () {});
  }

  if (ROOM) {
    if (mpDb) mpDb.subscribe(function (items) {
      let b = null;
      (items || []).forEach(function (x) { if (x && x.id === 'm') b = x; });
      mp.remote = b && b.game ? b.game : null; mp.game = mp.remote; mp.note = '';
      mpYield(); mpRender();
    });
    if (cmtDb) cmtDb.subscribe(function (items) {
      let c = null;
      (items || []).forEach(function (x) { if (x && x.id === 'c') c = x; });
      mp.cmt = c; mpRender();
    });
    gifos.room.subscribe(function (s) {
      mp.rs = s; mp.note = '';   // a refusal's note goes with the next room state
      // with other people here the shared game is what you see; alone you start on the menu
      if (!mp.on && !mp.picked && s.live && !$('setup').hidden) { mpEnter(); return; }
      if (mp.on) mpJoin();
      mpYield(); mpRender();
    });
  } else {
    $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false;
  }

  // ---- moves ----
  function mpChooseAndPlay(opts) {
    if (opts.length === 1) { mpPlay(opts[0]); return; }
    const box = $('promoChoices'); box.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach(function (pr) {
      const mv = opts.find(function (o) { return o.promo === pr; }); if (!mv) return;
      const b = document.createElement('button'); b.type = 'button'; b.textContent = GLYPH[pr]; b.className = mySeat2() === 'w' ? 'pw' : 'pb';
      b.onclick = function () { $('promo').hidden = true; mpPlay(mv); }; box.appendChild(b);
    });
    $('promo').hidden = false;
  }
  function mpPlay(mv) {
    if (!canMove()) return;
    const g = clone(curGame()); const ns = C.make(g.state, mv);
    g.state = ns; g.moves.push(C.moveToUci(mv)); g.lastMove = { from: mv.from, to: mv.to };
    const st = C.status(ns);
    if (st === 'checkmate') { g.winner = ns.turn === 'w' ? 'b' : 'w'; g.result = 'Checkmate'; g.endedAt = nowMs(); }
    else if (st === 'stalemate') { g.winner = 'draw'; g.result = 'Stalemate'; g.endedAt = nowMs(); }
    else if (ns.half >= 100) { g.winner = 'draw'; g.result = 'Fifty-move draw'; g.endedAt = nowMs(); }
    mp.sel = []; mp.legalSel = [];
    mpPut(g);
    if (mp.cmt && mp.cmt.on) mpComment(g);
  }
  function mpOnSquare(x, y) {
    mp.note = '';
    const g = curGame(); const seat = mySeat2();
    if (!canMove()) return;
    const legal = C.legal(g.state);
    if (mp.sel.length && mp.sel[0] === x && mp.sel[1] === y) { mp.sel = []; mp.legalSel = []; mpRender(); return; }
    if (mp.sel.length) {
      const opts = legal.filter(function (m) { return m.from[0] === mp.sel[0] && m.from[1] === mp.sel[1] && m.to[0] === x && m.to[1] === y; });
      if (opts.length) { mpChooseAndPlay(opts); return; }
      mp.sel = []; mp.legalSel = [];
    }
    const p = g.state.board[y * 8 + x];
    if (p !== '.' && ((seat === 'w') === (p >= 'A' && p <= 'Z'))) { mp.sel = [x, y]; mp.legalSel = legal.filter(function (m) { return m.from[0] === x && m.from[1] === y; }); }
    else { mp.sel = []; mp.legalSel = []; }
    mpRender();
  }
  // resigning is a move: only on your own turn (the room passes the turn)
  $('fResign').onclick = function () {
    const seat = mySeat2(); if (!seat || !canMove() || !curGame().moves.length) return;
    const g = clone(curGame());
    g.winner = seat === 'w' ? 'b' : 'w'; g.result = 'Resigned'; g.endedAt = nowMs(); mpPut(g);
  };
  $('fComment').onchange = function () {
    if (!ROOM || !cmtDb || !mySeat2()) { this.checked = !!(mp.cmt && mp.cmt.on); return; }
    cmtDb.put({ id: 'c', on: this.checked, text: '', at: 0, ts: 0 }).catch(function () {});
  };

  // Stockfish reacts to the move just played (flavour only — never the move).
  function mpComment(g) {
    if (!(window.GM.engine && window.GM.engineReady) || mp.commenting || !cmtDb) return;
    mp.commenting = true; const at = g.moves.length;
    window.GM.engine.search(C.toFEN(g.state), { movetime: 350 }, null).then(function (r) {
      mp.commenting = false; if (curGame().moves.length !== at) return;
      let e = r.mate != null ? (r.mate > 0 ? 100 : -100) : (r.score || 0) / 100;
      const moverE = -e; // flip to the mover's perspective
      let text;
      if (r.mate != null) text = r.mate > 0 ? 'Careful — mate is coming 😱' : 'Mating attack! 🔥';
      else if (moverE >= 3) text = 'Crushing! 🔥';
      else if (moverE >= 1) text = 'Nice move! 😎';
      else if (moverE > -1) text = 'Solid. 🙂';
      else if (moverE > -3) text = 'Risky… 🤔';
      else text = 'Ouch. 😬';
      cmtDb.put({ id: 'c', on: true, text: text, at: at, ts: nowMs() }).catch(function () {});
    }).catch(function () { mp.commenting = false; });
  }

  // ---- render ----
  function mpRender() {
    if (!mp.on) return;
    // A RENDER COUNTER, on purpose: renders must advance while the board's DOM
    // nodes do not churn (e2e-chess-mp reads this next to a MutationObserver).
    window.__cgmRenders = (window.__cgmRenders || 0) + 1;
    const r = mp.rs, seats = $('fSeats'), status = $('fStatus');
    const g = curGame(), mine = mySeat2();
    const nm = function (c) { const x = seatRow(c); return x && x.id ? esc(x.name || 'Player') + (x.here === 'away' ? ' …' : '') : '<span class="open">open</span>'; };
    // write markup only when it differs, so a state that changed nothing changes nothing
    setHtml(seats,
      '<div class="seat' + (mine === 'w' ? ' me' : '') + (g.state.turn === 'w' && !g.winner ? ' turn' : '') + '">⚪ ' + nm('w') + '</div>' +
      '<div class="seat' + (mine === 'b' ? ' me' : '') + (g.state.turn === 'b' && !g.winner ? ' turn' : '') + '">⚫ ' + nm('b') + '</div>');
    const line = r && r.line ? r.line : [];
    setHtml($('fQueue'), line.length ? 'In line: ' + line.map(function (x) { return esc(x.name || 'Player'); }).join(', ') : '');
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('fLeave').hidden = !!(r && r.live);
    const cmt = mp.cmt;
    $('fComment').checked = !!(cmt && cmt.on);
    document.querySelector('.ftoggle').style.opacity = mine ? '1' : '.5';
    $('fCommentBox').textContent = (cmt && cmt.on && cmt.at === g.moves.length && nowMs() - (cmt.ts || 0) < 12000) ? cmt.text : '';

    if (!ROOM) status.textContent = T('needsNewer');
    else if (mp.note) status.textContent = mp.note;
    else if (r && r.me && r.me.role === 'asking') status.textContent = 'Waiting for the host to let you in…';
    else if (!heldBoth()) status.innerHTML = 'Waiting for another player… press <b>Invite</b> (top bar) to bring a friend.';
    else if (g.winner) { const w = g.winner === 'draw' ? '' : nm(g.winner); status.innerHTML = g.winner === 'draw' ? esc(g.result) + ' — a draw.' : esc(g.result) + ' — ' + w + ' wins.'; }
    else if (!mine) { const pos = line.findIndex(function (x) { return r.me && x.id === r.me.id; }); status.textContent = 'Spectating' + (pos >= 0 ? ' — you\'re #' + (pos + 1) + ' in line.' : '.'); }
    else if (g.state.turn === mine) status.textContent = C.inCheck(g.state, mine === 'w') ? 'Your move — you\'re in check.' : 'Your move (' + (mine === 'w' ? 'White' : 'Black') + ').';
    else status.innerHTML = 'Waiting for ' + nm(g.state.turn) + '…';

    // board
    const can = canMove();
    const orient = mine === 'b' ? 'b' : 'w', s = g.state, sel = mp.sel, legalSel = mp.legalSel || [];
    const chk = (C.status(s) === 'check' || C.status(s) === 'checkmate') ? (function () { const i = s.board.indexOf(s.turn === 'w' ? 'K' : 'k'); return i < 0 ? null : [i % 8, (i / 8) | 0]; })() : null;
    const cells = boardCells($('fBoard'), mpOnSquare, 'button');
    const movable = {};
    if (can) C.legal(s).forEach(function (m) { movable[m.from[1] * 8 + m.from[0]] = true; });
    for (let rr = 0; rr < 8; rr++) for (let c = 0; c < 8; c++) {
      const x = orient === 'w' ? c : 7 - c, y = orient === 'w' ? rr : 7 - rr;
      const p = s.board[y * 8 + x];
      let cls = 'sq ' + (((x + y) % 2) ? 'd' : 'l');
      if (p !== '.') cls += (p >= 'A' && p <= 'Z') ? ' pw' : ' pb';
      if (g.lastMove && ((g.lastMove.from[0] === x && g.lastMove.from[1] === y) || (g.lastMove.to[0] === x && g.lastMove.to[1] === y))) cls += ' last';
      if (sel.length && sel[0] === x && sel[1] === y) cls += ' sel';
      if (chk && chk[0] === x && chk[1] === y) cls += ' chk';
      const legal = legalSel.some(function (m) { return m.to[0] === x && m.to[1] === y; });
      const cell = cells[rr * 8 + c];
      paintSq(cell, x, y, cls, p === '.' ? '' : GLYPH[p.toLowerCase()],
        legal ? (p !== '.' ? 'ring' : 'dotm') : '',
        c === 0 ? String(8 - y) : '', rr === 7 ? 'abcdefgh'[x] : '');
      // only a square you can act on now is a live button: your own piece, or a target of the selected one
      // before a pick: your pieces that can move; after a pick: that piece (tap again to drop it) and its targets
      const own = p !== '.' && ((mine === 'w') === (p >= 'A' && p <= 'Z'));
      const pickable = sel.length ? (sel[0] === x && sel[1] === y) : (own && movable[y * 8 + x]);
      const dis = !(can && (pickable || legal));
      if (cell.disabled !== dis) cell.disabled = dis;
    }
    // The move list is rebuilt only when a move actually lands (so a spectator can look back at move 3).
    const ml = $('fMoves');
    if (ml._n !== g.moves.length) {
      ml._n = g.moves.length; ml.innerHTML = '';
      for (let i = 0; i < g.moves.length; i += 2) { const n = document.createElement('span'); n.className = 'n'; n.textContent = (i / 2 + 1) + '.'; ml.appendChild(n); [i, i + 1].forEach(function (j) { if (g.moves[j] === undefined) return; const w = document.createElement('span'); w.className = 'mv'; w.textContent = g.moves[j]; ml.appendChild(w); }); }
      ml.scrollTop = ml.scrollHeight;
    }
    $('fResign').style.display = (mine && !g.winner && g.moves.length) ? '' : 'none';
    $('fResign').disabled = !can;
    $('fNext').style.display = (mine && g.winner && heldBoth()) ? '' : 'none';
  }

  // Read-only, for the room kit: the shared game only.
  window['__chess-grandmaster'] = {
    state: function () { const g = mp.remote; return g ? { moves: g.moves.join(' '), winner: g.winner || '' } : { moves: '', winner: '' }; }
  };

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('review').hidden) { $('review').hidden = true; openHistory(); }
    else if (!$('history').hidden) { $('history').hidden = true; $('setup').hidden = false; }
    else if (!$('friend').hidden) { if (!(mp.rs && mp.rs.live)) mpLeave(); }
    else if (!$('game').hidden) { $('game').hidden = true; $('setup').hidden = false; }
  });
})();
