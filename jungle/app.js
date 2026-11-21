// Jungle — animal chess. Computer is minimax on this device.
// A friend sits the other colour via gifos.room (seats and turns are the OS's). Invite is OS chrome.
(function () {
  'use strict';
  var J = window.JG;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var state = {
    mode: 'cpu', color: 'blue',
    s: null, hist: [], over: false, thinking: false, sel: null
  };
  var db = null;
  try { if (window.gifos) db = gifos.db('save'); } catch (e) {}

  function setChip(cls, text) {
    $('aiChip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('aiState').textContent = text;
  }
  function setTurn(el, text, cls) {
    el.className = 'turnpill' + (cls ? ' ' + cls : '');
    el.innerHTML = text;
  }
  function fillRankRow() {
    var el = $('rankRow');
    if (!el) return;
    el.innerHTML = '';
    var k, b;
    for (k = 8; k >= 1; k--) {
      b = document.createElement('span');
      b.className = 'rankchip';
      b.title = J.NAME[k] + ' · rank ' + k;
      b.innerHTML = J.GLYPH[k] + '<i>' + k + '</i>';
      el.appendChild(b);
    }
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
    $('cpuNote').textContent = state.color === 'blue'
      ? 'You play blue and go first. The computer plays red. It thinks on this device.'
      : 'You play red. The computer plays blue, and goes first.';
  });

  function makeBoard(el, onTap) {
    el.innerHTML = '';
    var r, c, sq, kind;
    for (r = 0; r < J.ROWS; r++) for (c = 0; c < J.COLS; c++) {
      sq = document.createElement('div');
      kind = J.squareKind(r, c);
      sq.className = 'square ' + kind + (((r + c) & 1) ? ' alt' : '');
      sq.setAttribute('data-r', String(r));
      sq.setAttribute('data-c', String(c));
      if (kind.indexOf('den') === 0) sq.title = 'Den';
      else if (kind.indexOf('trap') === 0) sq.title = 'Trap';
      else if (kind === 'water') sq.title = 'River';
      sq.addEventListener('click', function () {
        onTap(+this.getAttribute('data-r'), +this.getAttribute('data-c'));
      });
      el.appendChild(sq);
    }
  }

  function pieceEl(val, mine) {
    var d = document.createElement('div');
    var rk = J.rankOf(val);
    d.className = 'piece ' + (J.sideOf(val) === J.BLUE ? 'blue' : 'red') + (mine ? ' mine' : '');
    d.innerHTML = J.GLYPH[rk] + '<span class="rk">' + rk + '</span>';
    d.title = J.NAME[rk] + ' ' + rk;
    return d;
  }

  function paint(boardEl, s, opts) {
    opts = opts || {};
    if (!boardEl) return;
    boardEl.classList.toggle('flip', !!opts.flip);
    boardEl.classList.toggle('busy', !!opts.busy);
    var r, c, sq, val, key, legal = {}, cap = {}, from = {}, i, ms, m;
    var selected = opts.selected;
    var mineSide = 0;
    if (opts.hints && s && !s.winner) {
      ms = J.legalMoves(s);
      mineSide = s.turn;
      for (i = 0; i < ms.length; i++) from[ms[i].fr + ',' + ms[i].fc] = 1;
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
    for (r = 0; r < J.ROWS; r++) for (c = 0; c < J.COLS; c++) {
      sq = boardEl.children[r * J.COLS + c];
      if (!sq) continue;
      key = r + ',' + c;
      sq.className = 'square ' + J.squareKind(r, c) + (((r + c) & 1) ? ' alt' : '');
      if (s && s.last && ((s.last.fr === r && s.last.fc === c) || (s.last.tr === r && s.last.tc === c))) {
        sq.classList.add('last');
      }
      // only squares you can act on are buttons (movable pieces, and where the selected one may go)
      if (from[key] || legal[key]) { sq.setAttribute('role', 'button'); sq.tabIndex = 0; }
      else { sq.removeAttribute('role'); sq.removeAttribute('tabindex'); }
      if (legal[key]) {
        sq.classList.add('hint');
        if (cap[key]) sq.classList.add('cap');
      }
      while (sq.lastChild && sq.lastChild.classList && sq.lastChild.classList.contains('piece')) {
        sq.removeChild(sq.lastChild);
      }
      val = s ? s.map[r][c] : 0;
      if (!val) continue;
      var piece = pieceEl(val, !!(mineSide && J.sideOf(val) === mineSide && from[key]));
      if (selected && selected.r === r && selected.c === c) piece.classList.add('selected');
      sq.appendChild(piece);
    }
  }

  function takenHtml(s) {
    if (!s) return '';
    function missing(side) {
      var have = {}, r, c, p, out = [], k;
      for (r = 0; r < J.ROWS; r++) for (c = 0; c < J.COLS; c++) {
        p = s.map[r][c];
        if (p && J.sideOf(p) === side) have[J.rankOf(p)] = 1;
      }
      for (k = 8; k >= 1; k--) if (!have[k]) {
        out.push('<span class="lost" title="' + J.NAME[k] + '">' + J.GLYPH[k] + '</span>');
      }
      return out;
    }
    var b = missing(J.BLUE), rd = missing(J.RED);
    if (!b.length && !rd.length) return '';
    return '<span class="side blue">Blue</span> ' + (b.length ? b.join('') : '—') +
      '<span class="dot">·</span>' +
      '<span class="side red">Red</span> ' + (rd.length ? rd.join('') : '—');
  }
  function showTaken(el, s) {
    var html = takenHtml(s);
    if (!html) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = html;
  }

  function shouldFlip() {
    if (state.mode === 'cpu') return state.color === 'blue';
    return false;
  }
  function isHumanTurn() {
    if (!state.s || state.over || state.thinking) return false;
    if (state.mode === 'hotseat') return true;
    return J.colorName(state.s.turn) === state.color;
  }
  function localStatus() {
    if (!state.s) return;
    showTaken($('takenLine'), state.s);
    if (state.s.winner) {
      var you = state.mode === 'cpu' && state.s.winner === J.colorNum(state.color);
      var wname = J.colorName(state.s.winner);
      var msg = state.mode === 'hotseat'
        ? (wname.charAt(0).toUpperCase() + wname.slice(1) + ' wins')
        : (you ? 'You win' : 'The computer wins');
      setTurn($('turnPill'), msg, (you ? 'good ' : 'warn ') + wname);
      return;
    }
    if (state.thinking) {
      setTurn($('turnPill'), 'Computer is thinking…', 'think');
      return;
    }
    var t = J.colorName(state.s.turn);
    if (state.mode === 'hotseat') {
      setTurn($('turnPill'), t.charAt(0).toUpperCase() + t.slice(1) + ' to play · tap a piece', t);
    } else if (t === state.color) {
      setTurn($('turnPill'), 'Your turn · tap a piece', t);
    } else {
      setTurn($('turnPill'), 'Computer to play', t);
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
  function afterLocal() {
    paint($('board'), state.s, { hints: isHumanTurn(), selected: state.sel, flip: shouldFlip() });
    localStatus();
    saveLocal();
    if (!state.over && !state.thinking && state.mode === 'cpu' && J.colorName(state.s.turn) !== state.color) aiMove();
  }
  function applyLocal(fr, fc, tr, tc) {
    if (!state.s || state.over) return false;
    var ns = J.play(state.s, fr, fc, tr, tc);
    if (!ns) return false;
    state.hist.push({ fr: fr, fc: fc, tr: tr, tc: tc, color: state.s.turn });
    state.s = ns;
    state.sel = null;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    return true;
  }
  function playLocal(fr, fc, tr, tc) {
    if (!state.s || state.over) return false;
    if (state.mode === 'cpu' && state.thinking && J.colorName(state.s.turn) === state.color) return false;
    if (!applyLocal(fr, fc, tr, tc)) return false;
    afterLocal();
    return true;
  }
  function tapLocal(r, c) {
    if (!isHumanTurn()) return;
    var s = state.s;
    if (state.sel && (state.sel.r !== r || state.sel.c !== c)) {
      if (playLocal(state.sel.r, state.sel.c, r, c)) return;
    }
    if (J.sideOf(s.map[r][c]) === s.turn) {
      var has = J.legalMoves(s).some(function (m) { return m.fr === r && m.fc === c; });
      if (has) {
        state.sel = (state.sel && state.sel.r === r && state.sel.c === c) ? null : { r: r, c: c };
        paint($('board'), s, { hints: true, selected: state.sel, flip: shouldFlip() });
      }
    }
  }
  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu' || state.thinking) return;
    if (J.colorName(state.s.turn) === state.color) return;
    state.thinking = true;
    state.sel = null;
    setChip('thinking', 'Thinking…');
    localStatus();
    paint($('board'), state.s, { hints: false, flip: shouldFlip(), busy: true });
    // Paint the thinking chip, search in slices, hold the pill long enough
    // that the last-move flash is not invisible.
    var t0 = nowMs();
    requestAnimationFrame(function () {
      setTimeout(function () {
        if (!state.s || state.over || state.mode !== 'cpu') { state.thinking = false; return; }
        if (J.colorName(state.s.turn) === state.color) {
          state.thinking = false; setChip('ready', 'Ready'); afterLocal(); return;
        }
        var finish = function (move) {
          var wait = Math.max(0, 280 - (nowMs() - t0));
          setTimeout(function () {
            if (!state.s || state.over || state.mode !== 'cpu') { state.thinking = false; return; }
            if (!move || !applyLocal(move.fr, move.fc, move.tr, move.tc)) {
              state.thinking = false; setChip('ready', 'Ready'); localStatus();
              paint($('board'), state.s, { hints: isHumanTurn(), selected: state.sel, flip: shouldFlip() });
              return;
            }
            state.thinking = false;
            setChip('ready', 'Ready');
            afterLocal();
          }, wait);
        };
        if (J.aiMoveAsync) J.aiMoveAsync(state.s, finish);
        else finish(J.aiMove(state.s));
      }, 40);
    });
  }
  function undoLocal() {
    if (!state.hist.length || state.thinking) return;
    state.hist.pop();
    if (state.mode === 'cpu' && state.hist.length) state.hist.pop();
    state.s = J.replay(state.hist);
    state.over = !!state.s.winner;
    state.thinking = false;
    state.sel = null;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    afterLocal();
  }
  function newLocal() {
    state.s = J.fresh(); state.hist = []; state.over = false;
    state.thinking = false; state.sel = null;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    afterLocal();
  }

  makeBoard($('board'), tapLocal);
  $('startBtn').onclick = function () { picked = true; newLocal(); };
  $('newBtn').onclick = function () {
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;

  // ---- multiplayer: gifos.room ----
  // The room (manifest "room") owns who plays, who watches, whose turn it is, seat hold on reload and hand-off.
  // This app draws the board and writes the whole next board with gifos.room.move.
  var EN = { needsNewer: 'Jungle needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  var rs = null, joined = false, picked = false, note = '';
  var mp = { on: false, board: null, sel: null, sub: false };

  function freshBoard() {
    return { id: 'board', moves: [], turn: 'blue', winner: null, result: '', last: null, reds: 8, blues: 8 };
  }
  function seatOf(s, name) {
    var x = s && s.seats && s.seats.filter(function (q) { return q.seat === name; })[0];
    return x || { seat: name, id: null, name: '', here: 'open' };
  }
  function alone() { return !!rs && !rs.live; }
  function mySeat() { return rs && rs.me ? rs.me.seat : null; }
  // the colour whose move it is; alone, the one person plays whichever colour is on turn
  function canPlay() {
    var b = mp.board || freshBoard();
    if (!ROOM || !rs || b.winner) return false;
    if (alone()) return !!mySeat() && seatOf(rs, b.turn).here !== 'away';
    return !!rs.myTurn;
  }
  function viewSeat() { return alone() ? (mp.board || freshBoard()).turn : mySeat(); }
  function say(e) {
    note = e && e.message ? e.message : '';
    mpRender();
  }

  $('friendBtn').onclick = function () { picked = true; mpEnter(); };
  function mpEnter() {
    if (mp.on) return;
    mp.on = true; mp.sel = null;
    $('setup').hidden = true; $('game').hidden = true; $('friend').hidden = false;
    setChip('ready', 'A friend');
    if (!mpDb) { mpRender(); return; }
    if (!mp.sub) {
      mp.sub = true;
      mpDb.subscribe(function (items) {
        note = '';
        var b = null, i;
        for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'board') b = items[i];
        mp.board = b;
        mpRender();
      });
    }
    if (ROOM && rs && !joined && rs.me && rs.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    mpRender();
  }
  function mpLeave() {
    mp.on = false; picked = true;
    if (ROOM) { joined = false; gifos.room.leave().catch(function () {}); }
    $('friend').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  }
  $('fLeave').onclick = mpLeave;

  if (ROOM) {
    gifos.room.subscribe(function (s) {
      note = '';   // a refusal's note goes with the next room state
      rs = s;
      // with other people here, room play is what you see; alone you start on the menu
      if (!mp.on && !picked && s.live) { mpEnter(); return; }
      if (mp.on && !joined && s.me && s.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
      mpRender();
    });
  }

  function mpPlay(fr, fc, tr, tc) {
    var b = mp.board || freshBoard();
    if (!canPlay()) return false;
    var s = J.replay(b.moves || []);
    var ns = J.play(s, fr, fc, tr, tc);
    if (!ns) return false;
    var nb = {
      id: 'board', moves: (b.moves || []).concat([{ fr: fr, fc: fc, tr: tr, tc: tc }]),
      turn: b.turn, winner: null, result: '', last: { fr: fr, fc: fc, tr: tr, tc: tc },
      reds: ns.reds, blues: ns.blues
    };
    if (ns.winner) { nb.winner = J.colorName(ns.winner); nb.result = 'Den or last animal'; }
    else nb.turn = J.colorName(ns.turn);
    mp.board = nb; mp.sel = null; mpRender();
    gifos.room.move('board', nb).catch(say);
    return true;
  }
  $('fResign').onclick = function () {
    var b = mp.board || freshBoard();
    if (!canPlay() || b.winner) return;
    var nb = JSON.parse(JSON.stringify(b));
    nb.winner = b.turn === 'blue' ? 'red' : 'blue'; nb.result = 'Resigned';
    mp.board = nb; mpRender();
    gifos.room.move('board', nb).catch(say);
  };
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat()) return;
    gifos.room.newRound('board', freshBoard(), { first: 'blue' }).catch(say);
  };

  function mpRender() {
    if (!mp.on) return;
    var b = mp.board || freshBoard(), status = $('fStatus');
    var s = J.replay(b.moves || []);
    var seat = mySeat();
    if (!ROOM) {
      $('fSeats').innerHTML = '';
      $('fQueue').textContent = '';
      showTaken($('fTaken'), s);
      setTurn(status, esc(T('needsNewer')), 'warn');
      paint($('fBoard'), s, { hints: false });
      $('fResign').hidden = true; $('fNew').hidden = true;
      return;
    }
    var nameOf = function (name) {
      var x = seatOf(rs, name);
      return x.id ? esc(x.name || 'Player') + (x.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    };
    $('fSeats').innerHTML =
      '<div class="seat' + (seat === 'blue' ? ' me' : '') + (b.turn === 'blue' && !b.winner ? ' turn' : '') + '">Blue ' + nameOf('blue') + '</div>' +
      '<div class="seat red' + (seat === 'red' ? ' me' : '') + (b.turn === 'red' && !b.winner ? ' turn' : '') + '">Red ' + nameOf('red') + '</div>';
    var role = rs && rs.me ? rs.me.role : 'watcher';
    var wait = (rs && rs.line ? rs.line : []).map(function (p) { return p.name || 'Player'; });
    $('fQueue').textContent = note || (role === 'waiting' ? 'You are in line for a seat.' : role === 'asking' ? 'Waiting for the host to seat you.' :
      (wait.length ? 'In line: ' + wait.join(', ') : ''));
    showTaken($('fTaken'), s);
    var tx = seatOf(rs, b.turn);
    if (b.winner) {
      var wx = seatOf(rs, b.winner);
      setTurn(status, esc(b.result || 'Den or last animal') + ' — ' + (wx.id && wx.name ? esc(wx.name) : b.winner) + ' wins.', b.winner);
    } else if (canPlay()) {
      setTurn(status, (rs.live ? 'Your turn' : (b.turn.charAt(0).toUpperCase() + b.turn.slice(1) + ' to play')) + ' · tap a piece', b.turn);
    } else if (!seat) {
      setTurn(status, role === 'waiting' ? 'Waiting for a seat…' : 'Spectating', b.turn);
    } else if (tx.here === 'away') {
      setTurn(status, esc(tx.name || b.turn) + ' is reconnecting…', b.turn);
    } else if (!tx.id) {
      setTurn(status, 'Waiting for another player… press <b>Invite</b> (top bar) to bring a friend.', b.turn);
    } else {
      setTurn(status, 'Waiting for ' + esc(tx.name || b.turn) + '…', b.turn);
    }
    paint($('fBoard'), s, { hints: canPlay(), selected: mp.sel, flip: viewSeat() === 'blue' });
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('fLeave').hidden = !!rs.live;
    $('fResign').hidden = !(canPlay() && (b.moves || []).length && !b.winner);
    $('fNew').hidden = !(seat && (b.winner || (!rs.live && (b.moves || []).length)));
  }

  makeBoard($('fBoard'), function (r, c) {
    var b = mp.board || freshBoard();
    if (!canPlay()) return;
    var s = J.replay(b.moves || []);
    if (mp.sel && (mp.sel.r !== r || mp.sel.c !== c)) {
      if (mpPlay(mp.sel.r, mp.sel.c, r, c)) return;
    }
    if (J.sideOf(s.map[r][c]) === s.turn) {
      var has = J.legalMoves(s).some(function (m) { return m.fr === r && m.fc === c; });
      if (has) {
        mp.sel = (mp.sel && mp.sel.r === r && mp.sel.c === c) ? null : { r: r, c: c };
        mpRender();
      }
    }
  });

  // Read-only, for the room kit: the game only.
  window.__jungle = {
    state: function () {
      var b = mp.board;
      return { moves: b ? (b.moves || []).length : 0, turn: b ? b.turn : null, winner: b ? b.winner : null,
        map: b ? J.replay(b.moves || []).map.map(function (r) { return r.join(','); }).join('/') : '' };
    }
  };

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) { $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready'); }
  });

  setChip('ready', 'Ready');
  if (!ROOM) { $('oldNote').textContent = T('needsNewer'); $('oldNote').hidden = false; }
  fillRankRow();
  if (db) {
    db.get('game').then(function (g) {
      if (!g || !g.moves || !g.moves.length || g.over) return;
      state.mode = g.mode || 'cpu';
      state.color = g.color || 'blue';
      state.hist = g.moves.slice();
      state.s = J.replay(state.hist);
      state.over = !!state.s.winner;
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two players');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('colorSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-color') === state.color);
        });
        $('cpuNote').textContent = state.color === 'blue'
          ? 'You play blue and go first. The computer plays red. It thinks on this device.'
          : 'You play red. The computer plays blue, and goes first.';
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      afterLocal();
    }).catch(function () {});
  }
})();
