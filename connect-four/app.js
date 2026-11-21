// Connect Four — drop a disc, connect four. Computer is kenrick95's c4 AI.
// A friend sits the other colour on a shared board. Invite is OS chrome.
(function () {
  'use strict';
  var C = window.C4;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var state = {
    mode: 'cpu', s: null, hist: [], over: false, thinking: false,
    hover: -1, dropping: false, pulse: 0, cover: false
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

  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    state.mode = b.getAttribute('data-mode');
    var cpu = state.mode === 'cpu';
    $('cpuNote').hidden = !cpu;
    $('hotseatNote').hidden = cpu;
  });

  // ---- canvas ----
  // Rail above the grid holds the preview disc. Extra canvas height (phone)
  // is still the column's hit target — not just the hole.
  function layout(cssW, cssH) {
    var padX = Math.min(cssW * 0.03, 14);
    var padBot = Math.min(cssH * 0.025, 10);
    // rail is 2.2R (preview disc), not 2.2×width-based R — a wide canvas
    // used to steal height and shrink the grid.
    var maxR = Math.min(
      Math.max(80, cssW - 2 * padX) / (3 * C.COLUMNS + 1),
      Math.max(80, cssH - padBot) / (3 * C.ROWS + 1 + 2.2)
    );
    var R = Math.max(8, maxR);
    var boardW = (3 * C.COLUMNS + 1) * R;
    var boardH = (3 * C.ROWS + 1) * R;
    var rail = 2.2 * R;
    var leftover = cssH - padBot - boardH - rail;
    var y0 = rail + Math.max(0, leftover * 0.12);
    return {
      radius: R,
      x0: (cssW - boardW) / 2,
      y0: y0,
      x1: (cssW - boardW) / 2 + boardW,
      y1: y0 + boardH
    };
  }
  function cellCenter(g, r, c) {
    return {
      x: 3 * g.radius * c + g.x0 + 2 * g.radius,
      y: 3 * g.radius * r + g.y0 + 2 * g.radius
    };
  }
  function resizeCanvas(canvas) {
    var cssW = canvas.clientWidth || 448;
    var cssH = canvas.clientHeight || Math.round(cssW * 6 / 7);
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { cssW: cssW, cssH: cssH };
  }
  function disc(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.08, x, y, r);
    if (color === C.P1) { g.addColorStop(0, '#ff8a7a'); g.addColorStop(1, C.COLOR1); }
    else { g.addColorStop(0, '#6ea4ff'); g.addColorStop(1, C.COLOR2); }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.28, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
  }
  function dropY(t, fromY, toY) {
    var fallEnd = 0.72;
    if (t <= fallEnd) {
      var u = t / fallEnd;
      return fromY + (toY - fromY) * (u * u);
    }
    var b = (t - fallEnd) / (1 - fallEnd);
    var amp = (toY - fromY) * 0.1;
    return toY - Math.sin(b * Math.PI) * amp;
  }
  function paint(canvas, s, opts) {
    opts = opts || {};
    var sz = resizeCanvas(canvas);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    var W = sz.cssW, H = sz.cssH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(0, 0, W, H);
    var g = layout(W, H);
    var skip = opts.drop ? (opts.drop.r + ',' + opts.drop.c) : '';
    var r, c, p, col;
    if (s) {
      for (r = 0; r < C.ROWS; r++) for (c = 0; c < C.COLUMNS; c++) {
        col = s.map[r][c];
        if (!col) continue;
        if (skip === r + ',' + c) continue;
        p = cellCenter(g, r, c);
        disc(ctx, p.x, p.y, g.radius * 0.92, col);
      }
      if (opts.drop) {
        p = cellCenter(g, opts.drop.r, opts.drop.c);
        var fromY = g.y0 - g.radius * 1.15;
        disc(ctx, p.x, dropY(opts.drop.t, fromY, p.y), g.radius * 0.92, opts.drop.color);
      }
    }
    // mask with holes — discs show through the plastic
    ctx.save();
    ctx.fillStyle = C.MASK;
    ctx.beginPath();
    var rr = Math.min(14, g.radius * 0.7);
    if (ctx.roundRect) ctx.roundRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, rr);
    else ctx.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
    for (r = 0; r < C.ROWS; r++) for (c = 0; c < C.COLUMNS; c++) {
      p = cellCenter(g, r, c);
      ctx.moveTo(p.x + g.radius, p.y);
      ctx.arc(p.x, p.y, g.radius, 0, Math.PI * 2, true);
    }
    ctx.fill('evenodd');
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = Math.max(1, g.radius * 0.07);
    for (r = 0; r < C.ROWS; r++) for (c = 0; c < C.COLUMNS; c++) {
      p = cellCenter(g, r, c);
      ctx.beginPath(); ctx.arc(p.x, p.y, g.radius * 0.98, 0, Math.PI * 2); ctx.stroke();
    }
    if (opts.hover >= 0 && s && !s.winner && C.canDrop(s, opts.hover) && !opts.drop) {
      var hoverColor = opts.hoverColor || s.turn;
      p = cellCenter(g, 0, opts.hover);
      ctx.fillStyle = hoverColor === C.P1 ? 'rgba(239,69,59,.14)' : 'rgba(0,89,255,.14)';
      ctx.fillRect(g.x0 + opts.hover * (g.x1 - g.x0) / C.COLUMNS, g.y0,
        (g.x1 - g.x0) / C.COLUMNS, g.y1 - g.y0);
      ctx.globalAlpha = 0.95;
      disc(ctx, p.x, g.y0 - g.radius * 1.12, g.radius * 0.92, hoverColor);
      ctx.globalAlpha = 1;
    }
    if (s && s.winLine && !opts.drop) {
      var pulse = 0.5 + 0.5 * Math.sin((opts.pulse || nowMs()) / 260);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 214, 70, ' + (0.78 + 0.22 * pulse) + ')';
      ctx.lineWidth = Math.max(5, g.radius * (0.28 + 0.1 * pulse));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      s.winLine.forEach(function (pt, i) {
        p = cellCenter(g, pt.r, pt.c);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.lineWidth = Math.max(3, g.radius * 0.16);
      s.winLine.forEach(function (pt) {
        p = cellCenter(g, pt.r, pt.c);
        ctx.beginPath();
        ctx.arc(p.x, p.y, g.radius * (1.04 + 0.08 * pulse), 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }
  }
  function hitColumn(canvas, ev) {
    var rect = canvas.getBoundingClientRect();
    var t = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0]
          : (ev.touches && ev.touches[0] ? ev.touches[0] : ev);
    var x = t.clientX - rect.left;
    var g = layout(rect.width, rect.height);
    var colW = (g.x1 - g.x0) / C.COLUMNS;
    var col = Math.floor((x - g.x0) / colW);
    if (x < g.x0) col = 0;
    if (x >= g.x1) col = C.COLUMNS - 1;
    if (col < 0 || col >= C.COLUMNS) return -1;
    return col;
  }

  function animateDrop(canvas, s, col, done) {
    if (!s || !s.last || s.last.c !== col) { done(); return; }
    var row = s.last.r, color = s.map[row][col];
    var t0 = nowMs();
    var duration = 95 + row * 62 + 170;
    state.dropping = true;
    function frame() {
      var t = Math.min(1, (nowMs() - t0) / duration);
      paint(canvas, s, { drop: { r: row, c: col, t: t, color: color }, hover: -1 });
      if (t < 1) requestAnimationFrame(frame);
      else { state.dropping = false; paint(canvas, s, { hover: -1 }); done(); }
    }
    requestAnimationFrame(frame);
  }

  var pulseOn = false;
  function pulseLoop() {
    if (!pulseOn) return;
    var local = !$('game').hidden && state.s && state.s.winLine;
    var friend = !$('friend').hidden && mp.board;
    if (local) paint($('board'), state.s, { hover: -1, pulse: nowMs() });
    else if (friend) {
      var fs = C.replay(mp.board.moves || []);
      if (fs.winLine) paint($('fBoard'), fs, { hover: -1, pulse: nowMs() });
      else { pulseOn = false; return; }
    } else { pulseOn = false; return; }
    requestAnimationFrame(pulseLoop);
  }
  function startPulse() {
    if (pulseOn) return;
    pulseOn = true;
    requestAnimationFrame(pulseLoop);
  }

  // ---- local game ----
  function isHumanTurn() {
    if (!state.s || state.over || state.thinking || state.dropping) return false;
    if (state.mode === 'hotseat') return true;
    return state.s.turn === C.P1;
  }
  function paintTurn() {
    var red = $('whoRed'), blue = $('whoBlue');
    if (!red || !blue) return;
    $('whoRedName').textContent = state.mode === 'cpu' ? 'You' : 'Red';
    $('whoBlueName').textContent = state.mode === 'cpu' ? 'Computer' : 'Blue';
    var s = state.s;
    var redOn = false, blueOn = false;
    if (s && s.winner && s.winner !== C.DRAW) {
      redOn = s.winner === C.P1;
      blueOn = s.winner === C.P2;
    } else if (s && !s.winner) {
      if (state.thinking) { redOn = false; blueOn = true; }
      else {
        redOn = s.turn === C.P1;
        blueOn = s.turn === C.P2;
      }
    }
    red.className = 'who red' + (redOn ? (s && s.winner ? ' on win' : ' on') : '');
    blue.className = 'who blue' + (blueOn ? (s && s.winner ? ' on win' : ' on') : '');
  }
  function paintBanner() {
    var el = $('banner');
    if (!el) return;
    if (!state.s || !state.s.winner) { el.hidden = true; return; }
    el.hidden = false;
    if (state.s.winner === C.DRAW) {
      el.className = 'banner'; el.textContent = 'Draw — the board is full'; return;
    }
    if (state.mode === 'hotseat') {
      el.className = 'banner good';
      el.textContent = (state.s.winner === C.P1 ? 'Red' : 'Blue') + ' wins';
      return;
    }
    var you = state.s.winner === C.P1;
    el.className = 'banner ' + (you ? 'good' : 'bad');
    el.textContent = you ? 'You win — four in a row' : 'The computer wins';
  }
  function localStatus() {
    if (!state.s) return;
    paintTurn();
    paintBanner();
    if (state.s.winner === C.DRAW) { setStatus($('statusLine'), 'Draw — the board is full.', ''); return; }
    if (state.s.winner) {
      var you = state.mode === 'cpu' && state.s.winner === C.P1;
      var msg = state.mode === 'hotseat'
        ? (C.colorName(state.s.winner).charAt(0).toUpperCase() + C.colorName(state.s.winner).slice(1) + ' wins.')
        : (you ? 'You win.' : 'The computer wins.');
      setStatus($('statusLine'), msg, you ? 'good' : 'warn');
      return;
    }
    if (state.thinking) { setStatus($('statusLine'), 'Computer is thinking…', ''); return; }
    if (state.mode === 'hotseat') {
      var t = C.colorName(state.s.turn);
      setStatus($('statusLine'), t.charAt(0).toUpperCase() + t.slice(1) + ' to play. Tap a column.', '');
    } else {
      setStatus($('statusLine'), state.s.turn === C.P1 ? 'Your turn. Tap a column.' : 'Computer to play.', '');
    }
  }
  function saveLocal() {
    if (!db || state.cover) return;
    db.put({
      id: 'game', mode: state.mode, moves: state.hist.slice(),
      over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function afterLocal() {
    paint($('board'), state.s, { hover: isHumanTurn() ? state.hover : -1 });
    localStatus();
    saveLocal();
    if (state.s && state.s.winLine) startPulse();
    if (!state.over && state.mode === 'cpu' && state.s.turn === C.P2) aiMove();
  }
  function playLocal(col) {
    if (!state.s || state.over || state.dropping) return false;
    if (state.mode === 'cpu' && state.thinking && state.s.turn === C.P1) return false;
    if (!C.canDrop(state.s, col)) return false;
    var ns = C.drop(state.s, col);
    if (!ns) return false;
    state.hist.push(col);
    state.s = ns;
    state.hover = -1;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    animateDrop($('board'), state.s, col, afterLocal);
    return true;
  }
  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu') return;
    state.thinking = true;
    setChip('thinking', 'Thinking…');
    localStatus();
    setTimeout(function () {
      if (!state.s || state.over || state.mode !== 'cpu') { state.thinking = false; return; }
      var col = C.aiColumn(state.s.map, C.P2);
      state.thinking = false;
      setChip('ready', 'Ready');
      playLocal(col);
    }, 50);
  }
  function undoLocal() {
    if (!state.hist.length || state.dropping) return;
    if (state.over) state.hist.pop();
    else if (state.mode === 'cpu') {
      state.hist.pop();
      if (state.hist.length) state.hist.pop();
    } else state.hist.pop();
    state.s = C.replay(state.hist);
    state.over = !!state.s.winner;
    state.thinking = false;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    paint($('board'), state.s);
    localStatus();
    saveLocal();
    if (state.s && state.s.winLine) startPulse();
    if (!state.over && state.mode === 'cpu' && state.s.turn === C.P2) aiMove();
  }
  function newLocal() {
    state.s = C.fresh(); state.hist = []; state.over = false; state.hover = -1;
    state.thinking = false; state.dropping = false; state.cover = false;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    paint($('board'), state.s);
    localStatus();
    saveLocal();
    requestAnimationFrame(function () {
      if (state.s && !$('game').hidden) paint($('board'), state.s, { hover: state.hover });
    });
  }

  $('startBtn').onclick = function () { newLocal(); };
  $('newBtn').onclick = function () {
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;

  function bindBoard(canvas, canPlay, onPlay, hoverOf) {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      var col = hitColumn(canvas, e); if (col < 0) return;
      if (canPlay()) onPlay(col);
    });
    canvas.addEventListener('pointermove', function (e) {
      var col = hitColumn(canvas, e);
      if (hoverOf) hoverOf(col);
      else {
        state.hover = col;
        if (canPlay() && state.s) paint(canvas, state.s, { hover: col, hoverColor: state.s.turn });
      }
    });
    canvas.addEventListener('pointerleave', function () {
      if (hoverOf) hoverOf(-1);
      else { state.hover = -1; if (state.s) paint(canvas, state.s, { hover: -1 }); }
    });
  }
  bindBoard($('board'), isHumanTurn, function (col) { return playLocal(col); });

  window.addEventListener('keydown', function (e) {
    if ($('game').hidden) return;
    var n = e.key ? e.key.charCodeAt(0) - 49 : -1;
    if (n >= 0 && n < C.COLUMNS && isHumanTurn()) playLocal(n);
  });

  // ---- multiplayer ----
  // Who sits, whose turn it is, who is here and who waits is gifos.room's (manifest "room"). This app draws the
  // board and makes moves: the mover writes the whole next board with gifos.room.move.
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var NEEDS_NEWER = 'Connect Four needs a newer GifOS to play together. Reload the page to update.';
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  var mp = { on: false, rs: null, board: null, hover: -1, seen: -1, auto: false, note: '' };

  function freshBoard() {
    return { id: 'board', moves: [], winner: null, result: '', last: null, seq: 0 };
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

  $('friendBtn').onclick = mpEnter;
  function mpEnter() {
    mp.on = true; mp.seen = -1;
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

  function mpPlay(col) {
    if (!mpCanPlay()) return false;
    var prev = mp.board, b = curBoard();
    var ns = C.drop(C.replay(b.moves || []), col);
    if (!ns) return false;
    var nb = { id: 'board', moves: (b.moves || []).concat([col]), winner: null, result: '', last: { r: ns.last.r, c: col }, seq: (b.seq || 0) + 1 };
    if (ns.winner === C.DRAW) { nb.winner = 'draw'; nb.result = 'Draw'; }
    else if (ns.winner) { nb.winner = C.colorName(ns.winner); nb.result = 'Four in a row'; }
    mp.board = nb; mpRender();
    gifos.room.move('board', nb).catch(function (e) { mp.board = prev; mpSay(e); });
    return true;
  }
  $('fResign').onclick = function () {
    if (!mpCanPlay() || !(curBoard().moves || []).length) return;
    var prev = mp.board, b = curBoard();
    var nb = { id: 'board', moves: b.moves, winner: mp.rs.turn === 'red' ? 'blue' : 'red', result: 'Resigned', last: null, seq: (b.seq || 0) + 1 };
    mp.board = nb; mpRender();
    gifos.room.move('board', nb).catch(function (e) { mp.board = prev; mpSay(e); });
  };
  // A finished game: anyone seated may start the next one (red goes first).
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat() || !curBoard().winner) return;
    gifos.room.newRound('board', freshBoard(), { first: 'red' }).catch(mpSay);
  };

  function mpPaintBoard(s, canPlay) {
    paint($('fBoard'), s, {
      hover: canPlay ? mp.hover : -1,
      hoverColor: mp.rs ? C.colorNum(mp.rs.turn) : 0
    });
    if (s.winLine) startPulse();
  }
  function seatHtml(name) {
    var row = seatRow(name), mine = mySeat() === name, b = curBoard();
    var who = row.id ? esc(row.name || 'Player') + (row.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    return '<div class="seat' + (name === 'blue' ? ' blue' : '') + (mine ? ' me' : '') +
      (mp.rs && mp.rs.turn === name && !b.winner ? ' turn' : '') + '"><i class="disc ' + name + '" aria-hidden="true"></i>' + who + '</div>';
  }
  function mpStatus(b) {
    var rs = mp.rs;
    if (!ROOM) return [NEEDS_NEWER, 'warn'];
    if (!rs) return ['Setting up the board…', ''];
    var role = rs.me.role;
    if (b.winner === 'draw') return [(b.result || 'Draw') + ' — the board is full.', ''];
    if (b.winner) {
      var w = seatRow(b.winner);
      return [(b.result ? b.result + ' — ' : '') + (w.id && w.name ? w.name : b.winner) + ' wins.', mySeat() === b.winner ? 'good' : ''];
    }
    if (role === 'waiting') return ['Waiting for a seat to open…', ''];
    if (role === 'asking') return ['Asking the host if you can play…', ''];
    if (!mySeat()) return ['Watching.', ''];
    if (mpCanPlay()) return [rs.live ? 'Your turn. Tap a column.' : (rs.turn === 'red' ? 'Red' : 'Blue') + ' to play. Tap a column.', ''];
    var t = seatRow(rs.turn);
    if (t.here === 'away') return ['Waiting for ' + (t.name || rs.turn) + ' to come back…', ''];
    if (!t.id) return ['Waiting for another player… press Invite (top bar) to bring a friend.', ''];
    return ['Waiting for ' + (t.name || rs.turn) + '…', ''];
  }
  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), s = C.replay(b.moves || []), rs = mp.rs;
    $('fSeats').innerHTML = seatHtml('red') + seatHtml('blue');
    $('fQueue').textContent = rs && rs.line && rs.line.length
      ? 'Next in line: ' + rs.line.map(function (p) { return p.name || 'Player'; }).join(', ')
      : (mp.note || '');
    var st = mpStatus(b);
    setStatus($('fStatus'), mp.note && ROOM ? mp.note : st[0], st[1]);
    var can = mpCanPlay();
    Array.prototype.forEach.call($('fCols').children, function (btn, c) {
      var off = !can || !C.canDrop(s, c);
      btn.disabled = off; btn.setAttribute('aria-disabled', off ? 'true' : 'false');
    });
    var seq = b.seq || 0, prev = mp.seen;
    mp.seen = seq;
    if (prev >= 0 && seq > prev && b.last && !state.dropping) {
      animateDrop($('fBoard'), s, b.last.c, function () { mpPaintBoard(s, mpCanPlay()); });
    } else {
      mpPaintBoard(s, can);
    }
    $('fResign').hidden = !(can && (b.moves || []).length);
    $('fNew').hidden = !(ROOM && mySeat() && b.winner);
  }

  // The columns are real buttons over the canvas: reachable by keyboard and screen readers, and they hold the hover.
  (function () {
    var wrap = $('fCols'), c;
    function mk(col) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'colbtn'; btn.disabled = true;
      btn.setAttribute('aria-label', 'Drop in column ' + (col + 1));
      btn.addEventListener('click', function () { mpPlay(col); });
      btn.addEventListener('pointerenter', function () { mp.hover = col; mpRender(); });
      btn.addEventListener('pointerleave', function () { mp.hover = -1; mpRender(); });
      return btn;
    }
    for (c = 0; c < C.COLUMNS; c++) wrap.appendChild(mk(c));
  })();
  window.addEventListener('keydown', function (e) {
    if ($('friend').hidden) return;
    var n = e.key ? e.key.charCodeAt(0) - 49 : -1;
    if (n >= 0 && n < C.COLUMNS) mpPlay(n);
  });

  // The game only, so the checks and a tester can compare copies.
  window['__connect-four'] = { state: function () {
    var b = mp.board;
    return { moves: b && b.moves ? b.moves.join(',') : '', winner: b ? b.winner : null };
  } };

  window.addEventListener('resize', function () {
    if (!$('game').hidden && state.s) paint($('board'), state.s, { hover: state.hover });
    if (!$('friend').hidden && mp.board) paint($('fBoard'), C.replay(mp.board.moves || []), { hover: mp.hover });
  });

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) { $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready'); }
  });

  C.coverShot = function () {
    document.body.classList.add('cover');
    state.cover = true;
    state.mode = 'cpu';
    state.hist = C.COVER_MOVES.concat([0]);
    state.s = C.replay(state.hist);
    state.over = true;
    state.thinking = false;
    state.dropping = false;
    state.hover = -1;
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    setChip('ready', 'Ready');
    localStatus();
    setStatus($('statusLine'), '', '');
    paint($('board'), state.s, { hover: -1, pulse: nowMs() });
    startPulse();
    requestAnimationFrame(function () {
      if (state.s) paint($('board'), state.s, { hover: -1, pulse: nowMs() });
    });
  };

  // The board arrives as data; the room's word arrives from gifos.room.
  if (mpDb) mpDb.subscribe(function (items) {
    var b = null, i;
    for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'board') b = items[i];
    mp.board = b;
    mpRender();
  });
  if (ROOM) gifos.room.subscribe(function (s) {
    mp.rs = s;
    // Somebody else is here: the room is what they see, without a mode tap. Not over a local game in progress,
    // and not after this person left it on purpose.
    if (!mp.on && !mp.auto && s.live && !$('setup').hidden && !(state.s && !state.over)) { mp.auto = true; mpEnter(); return; }
    mpRender();
  });

  setChip('ready', 'Ready');
  if (!ROOM) { $('needsNewer').hidden = false; $('needsNewer').textContent = NEEDS_NEWER; }
  if (db) {
    db.get('game').then(function (g) {
      if (state.cover || mp.on) return;
      if (!g || !g.moves || !g.moves.length || g.over) return;
      state.mode = g.mode || 'cpu';
      state.hist = g.moves.slice();
      state.s = C.replay(state.hist);
      state.over = !!state.s.winner;
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two players');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      paint($('board'), state.s);
      localStatus();
      if (state.s && state.s.winLine) startPulse();
      if (!state.over && state.mode === 'cpu' && state.s.turn === C.P2) aiMove();
    }).catch(function () {});
  }
})();
