// Thinktank — place, move, rotate. Destroy the other base.
// Computer thinks on this device. A friend sits the other colour.
// Invite is OS chrome.
(function () {
  'use strict';
  var T = window.TT;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  function glyph(token) {
    var a = 'fill="currentColor"';
    if (token === T.BLOCKER) {
      return '<svg viewBox="0 0 24 24"><path ' + a + ' d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>';
    }
    if (token === T.TANK_U) {
      return '<svg viewBox="0 0 24 24"><rect ' + a + ' x="8" y="12" width="8" height="9" rx="1"/><path ' + a + ' d="M12 2l7 11H5z"/></svg>';
    }
    if (token === T.TANK_D) {
      return '<svg viewBox="0 0 24 24"><rect ' + a + ' x="8" y="3" width="8" height="9" rx="1"/><path ' + a + ' d="M12 22L5 11h14z"/></svg>';
    }
    if (token === T.TANK_L) {
      return '<svg viewBox="0 0 24 24"><rect ' + a + ' x="12" y="8" width="9" height="8" rx="1"/><path ' + a + ' d="M2 12l11-7v14z"/></svg>';
    }
    if (token === T.TANK_R) {
      return '<svg viewBox="0 0 24 24"><rect ' + a + ' x="3" y="8" width="9" height="8" rx="1"/><path ' + a + ' d="M22 12L11 5v14z"/></svg>';
    }
    if (token === T.INF_O) {
      return '<svg viewBox="0 0 24 24"><path ' + a + ' d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/></svg>';
    }
    if (token === T.INF_X) {
      return '<svg viewBox="0 0 24 24"><path ' + a + ' d="M5.5 3.5L12 10l6.5-6.5 2 2L14 12l6.5 6.5-2 2L12 14l-6.5 6.5-2-2L10 12 3.5 5.5z"/></svg>';
    }
    if (token === T.MINE) {
      return '<svg viewBox="0 0 24 24"><circle ' + a + ' cx="12" cy="13" r="7"/><path ' + a + ' d="M11 2h2v4h-2zM4.2 6.1l1.4-1.4 2.8 2.8-1.4 1.4zM17 4.7l1.4 1.4-2.8 2.8-1.4-1.4z"/></svg>';
    }
    if (token === T.BASE) {
      return '<svg viewBox="0 0 24 24"><path ' + a + ' d="M3 11l9-8 9 8v10h-7v-6H10v6H3z"/></svg>';
    }
    return '';
  }

  var state = {
    mode: 'cpu', color: 'red',
    s: null, hist: [], over: false, thinking: false,
    selToken: null, selIndex: -1
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
    $('cpuOpts').hidden = !cpu;
    $('hotseatNote').hidden = cpu;
  });
  $('colorSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    state.color = b.getAttribute('data-color');
    $('cpuNote').textContent = state.color === 'red'
      ? 'You play red and go first. The computer plays blue. It thinks on this device.'
      : 'You play blue. The computer plays red, and goes first.';
  });

  function makeBoard(el, onTap) {
    el.innerHTML = '';
    var i, sq;
    for (i = 0; i < T.SIZE; i++) {
      sq = document.createElement('div');
      sq.setAttribute('data-i', String(i));
      sq.addEventListener('click', function () {
        onTap(+this.getAttribute('data-i'));
      });
      el.appendChild(sq);
    }
  }

  function legalMaps(s, selToken, selIndex) {
    var place = {}, rot = {}, list, i;
    if (!s || s.winner) return { place: place, rot: rot };
    if (selIndex >= 0) {
      list = T.possibleMovements(s.cells, s.turn, selIndex);
      for (i = 0; i < list.length; i++) place[list[i]] = 1;
    } else if (selToken) {
      list = T.possiblePlacements(s.cells, s.hands[s.turn], s.turn, selToken);
      for (i = 0; i < list.length; i++) place[list[i]] = 1;
      if (T.isTank(selToken)) {
        list = T.possibleRotations(s.cells, s.turn, selToken);
        for (i = 0; i < list.length; i++) rot[list[i]] = 1;
      }
    }
    return { place: place, rot: rot };
  }

  function shooterIndex(s, opts) {
    var i = -1;
    if (opts.fireFrom >= 0) i = opts.fireFrom;
    else if (opts.selected >= 0 && s && s.cells[opts.selected] && T.isTank(s.cells[opts.selected].token)) {
      i = opts.selected;
    } else if (s && s.last) {
      if ((s.last.k === 'place' || s.last.k === 'rotate') && s.last.i >= 0) i = s.last.i;
      else if (s.last.k === 'move' && s.last.d >= 0) i = s.last.d;
    }
    if (i < 0 || !s || !s.cells[i] || !T.isTank(s.cells[i].token)) return -1;
    return i;
  }

  function paint(boardEl, s, opts) {
    opts = opts || {};
    if (!boardEl) return;
    var i, sq, p, cls, maps, fire, k, dest, src, shooter;
    var selected = opts.selected;
    var selToken = opts.selToken;
    maps = opts.hints ? legalMaps(s, selToken, selected) : { place: {}, rot: {} };
    src = shooterIndex(s, opts);
    shooter = src >= 0 ? s.cells[src].player : null;
    fire = {};
    dest = src >= 0 ? T.fireLine(s.cells, src) : [];
    for (k = 0; k < dest.length; k++) fire[dest[k]] = 1;
    boardEl.classList.toggle('coach', !!(opts.coach && s && !s.n && opts.hints && !selToken && !(selected >= 0)));
    for (i = 0; i < T.SIZE; i++) {
      sq = boardEl.children[i];
      if (!sq) continue;
      cls = 'cell';
      if (T.isRedHome(i)) cls += ' home-red';
      else if (T.isBlueHome(i)) cls += ' home-blue';
      else if (T.isRedSpawn(i)) cls += ' spawn-red';
      else if (T.isBlueSpawn(i)) cls += ' spawn-blue';
      if (maps.place[i]) cls += ' hint';
      if (maps.rot[i]) cls += ' turnhint';
      if (selected === i) cls += ' sel';
      if (s && s.last) {
        if ((s.last.k === 'place' || s.last.k === 'rotate') && s.last.i === i) cls += ' last';
        if (s.last.k === 'move' && (s.last.s === i || s.last.d === i)) cls += ' last';
      }
      p = s ? s.cells[i] : null;
      if (fire[i]) {
        cls += ' fire';
        if (src >= 0) {
          var tok = s.cells[src].token;
          cls += (tok === T.TANK_U || tok === T.TANK_D) ? ' fire-v' : ' fire-h';
        }
        if (p && shooter && p.player !== shooter) cls += ' hot';
      }
      sq.className = cls;
      if (!p) { sq.innerHTML = ''; continue; }
      sq.innerHTML = '<div class="piece ' + p.player + '">' + glyph(p.token) + '</div>';
    }
  }

  function tokBtn(player, token, n, label, on, enabled, group) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tok ' + player + (on ? ' on' : '') + (!enabled || n === 0 ? ' dim' : '');
    btn.disabled = !enabled || n === 0;
    btn.setAttribute('data-t', token);
    if (group) btn.setAttribute('data-g', group);
    btn.innerHTML = glyph(token) + '<span class="lab">' + label + '</span><span class="n">' + n + '</span>';
    btn.title = label;
    return btn;
  }

  function paintHand(el, s, player, selToken, enabled) {
    if (!el) return;
    el.innerHTML = '';
    if (!s) return;
    var hand = s.hands[player] || [];
    var tanks = T.tankCount(hand);
    var face = T.isTank(selToken) ? selToken : T.preferFacing(player);
    el.appendChild(tokBtn(player, T.BLOCKER, T.handCount(hand, T.BLOCKER), 'Shield', selToken === T.BLOCKER, enabled, ''));
    el.appendChild(tokBtn(player, face, tanks, 'Tank', T.isTank(selToken), enabled, 'tank'));
    el.appendChild(tokBtn(player, T.INF_O, T.handCount(hand, T.INF_O), 'Infil +', selToken === T.INF_O, enabled, ''));
    el.appendChild(tokBtn(player, T.INF_X, T.handCount(hand, T.INF_X), 'Infil ×', selToken === T.INF_X, enabled, ''));
    el.appendChild(tokBtn(player, T.MINE, T.handCount(hand, T.MINE), 'Mine', selToken === T.MINE, enabled, ''));
    el.classList.toggle('nudge', !!(enabled && !selToken && s.n === 0));
  }

  function paintFaces(el, s, player, selToken, selIndex, enabled) {
    if (!el) return;
    var show = !!(enabled && s && (T.isTank(selToken) || (selIndex >= 0 && s.cells[selIndex] && T.isTank(s.cells[selIndex].token))));
    el.hidden = !show;
    if (!show) { el.innerHTML = ''; return; }
    var cur = T.isTank(selToken) ? selToken : (s.cells[selIndex] ? s.cells[selIndex].token : T.preferFacing(player));
    var faces = [T.TANK_U, T.TANK_R, T.TANK_D, T.TANK_L];
    var words = ['Up', 'Right', 'Down', 'Left'];
    var i, btn;
    el.innerHTML = '';
    for (i = 0; i < faces.length; i++) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'face ' + player + (cur === faces[i] ? ' on' : '');
      btn.setAttribute('data-t', faces[i]);
      btn.innerHTML = glyph(faces[i]) + '<span>' + words[i] + '</span>';
      el.appendChild(btn);
    }
  }

  function lastLog(s) {
    if (!s || !s.events || !s.events.length) return '';
    var e = s.events[s.events.length - 1];
    var who = e.player === T.RED ? 'Red' : 'Blue';
    var verb = e.kind === 'place' ? 'placed' : e.kind === 'move' ? 'moved'
      : e.kind === 'rotate' ? 'turned' : e.kind === 'shoot' ? 'shot'
      : e.kind === 'capture' ? 'captured' : e.kind === 'explode' ? 'blew up' : e.kind;
    if (T.isTank(e.token)) {
      if (e.kind === 'rotate') return who + ' turned a tank to face ' + T.faceWord(e.token) + '.';
      if (e.kind === 'place') return who + ' placed a tank facing ' + T.faceWord(e.token) + '.';
      return who + ' ' + verb + ' a tank.';
    }
    return who + ' ' + verb + ' a ' + T.shortName(e.token).toLowerCase() + '.';
  }

  function isHumanTurn() {
    if (!state.s || state.over || state.thinking) return false;
    if (state.mode === 'hotseat') return true;
    return state.s.turn === state.color;
  }

  function setTurnBar(el, text, cls) {
    if (!el) return;
    el.className = 'turnbar' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }

  function coachFor(s, mode, color, selToken, selIndex, thinking, over) {
    if (!s) return { bar: 'Ready', barCls: '', line: '', lineCls: '', chip: 'Ready', chipCls: 'ready' };
    var turnName = s.turn === T.RED ? 'Red' : 'Blue';
    var you = mode === 'cpu' && s.turn === color;
    if (s.winner || over) {
      var winYou = mode === 'cpu' && s.winner === color;
      var msg = mode === 'hotseat'
        ? (s.winner === T.RED ? 'Red destroyed the blue base.' : 'Blue destroyed the red base.')
        : (winYou ? 'You destroyed their base.' : 'The computer destroyed your base.');
      return {
        bar: winYou || (mode === 'hotseat' && s.winner) ? (s.winner === T.RED ? 'Red wins' : 'Blue wins') : (winYou ? 'You win' : 'Computer wins'),
        barCls: winYou ? 'good' : 'warn',
        line: msg, lineCls: winYou ? 'good' : 'warn',
        chip: 'Over', chipCls: winYou ? 'ready' : 'thinking'
      };
    }
    if (thinking) {
      return { bar: 'Computer', barCls: 'wait', line: 'Computer is thinking…', lineCls: '', chip: 'Thinking…', chipCls: 'thinking' };
    }
    if (mode === 'cpu' && !you) {
      return { bar: 'Computer to play', barCls: s.turn, line: 'Waiting on the computer.', lineCls: '', chip: 'Computer', chipCls: 'thinking' };
    }
    var bar = mode === 'hotseat' ? (turnName + ' to play') : 'Your turn — ' + turnName;
    if (selIndex >= 0 && s.cells[selIndex]) {
      var p = s.cells[selIndex];
      if (T.isTank(p.token)) {
        return { bar: bar, barCls: s.turn, line: 'Gold: move this tank. Or tap a facing below to turn it — it shoots the way it points.', lineCls: '', chip: bar, chipCls: 'turn' };
      }
      return { bar: bar, barCls: s.turn, line: 'Tap a gold square to move this ' + T.shortName(p.token).toLowerCase() + '.', lineCls: '', chip: bar, chipCls: 'turn' };
    }
    if (selToken) {
      if (T.isTank(selToken)) {
        return { bar: bar, barCls: s.turn, line: 'Gold around your home: place this tank facing ' + T.faceWord(selToken) + '. Cyan: turn a tank already out this way.', lineCls: '', chip: bar, chipCls: 'turn' };
      }
      return { bar: bar, barCls: s.turn, line: 'Tap a gold square around your home to place this ' + T.shortName(selToken).toLowerCase() + '. ' + T.blurb(selToken), lineCls: '', chip: bar, chipCls: 'turn' };
    }
    if (!s.n) {
      return { bar: bar, barCls: s.turn, line: 'Tap a piece below, then a gold square around your home. Destroy the other house to win.', lineCls: '', chip: bar, chipCls: 'turn' };
    }
    return { bar: bar, barCls: s.turn, line: 'Place a piece, move one already out, or turn a tank. One action.', lineCls: '', chip: bar, chipCls: 'turn' };
  }

  function localStatus() {
    if (!state.s) return;
    $('logLine').textContent = lastLog(state.s);
    var c = coachFor(state.s, state.mode, state.color, isHumanTurn() ? state.selToken : null, isHumanTurn() ? state.selIndex : -1, state.thinking, state.over);
    setTurnBar($('turnBar'), c.bar, c.barCls);
    setStatus($('statusLine'), c.line, c.lineCls);
    setChip(c.chipCls, c.chip);
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', mode: state.mode, color: state.color,
      moves: state.hist.slice(), over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function handPlayer() {
    if (!state.s) return T.RED;
    if (state.mode === 'cpu') return state.color;
    return state.s.turn;
  }
  function afterLocal() {
    var human = isHumanTurn();
    paint($('board'), state.s, {
      hints: human,
      coach: human,
      selToken: human ? state.selToken : null,
      selected: human ? state.selIndex : -1,
      fireFrom: -1
    });
    paintHand($('hand'), state.s, handPlayer(), human ? state.selToken : null, human);
    paintFaces($('faces'), state.s, handPlayer(), human ? state.selToken : null, human ? state.selIndex : -1, human);
    localStatus();
    saveLocal();
    if (!state.over && !state.thinking && state.mode === 'cpu' && state.s.turn !== state.color) aiMove();
  }
  function applyLocal(act) {
    if (!state.s || state.over) return false;
    var ns = T.play(state.s, act);
    if (!ns) return false;
    state.hist.push({ k: act.k, t: act.t, i: act.i, s: act.s, d: act.d });
    state.s = ns;
    state.selToken = null;
    state.selIndex = -1;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    return true;
  }
  function playLocal(act) {
    if (!state.s || state.over) return false;
    if (state.mode === 'cpu' && state.thinking && state.s.turn === state.color) return false;
    if (!applyLocal(act)) return false;
    afterLocal();
    return true;
  }
  function tapLocal(i) {
    if (!isHumanTurn()) return;
    var s = state.s, p = s.cells[i];
    if (state.selToken && T.canRotate(s.cells, s.turn, state.selToken, i)) {
      playLocal({ k: 'rotate', t: state.selToken, i: i });
      return;
    }
    if (p && p.player === s.turn && i !== state.selIndex) {
      state.selIndex = i;
      state.selToken = T.isTank(p.token) ? p.token : null;
      afterLocal();
      return;
    }
    if (state.selToken && T.canPlace(s.cells, s.hands[s.turn], s.turn, state.selToken, i)) {
      playLocal({ k: 'place', t: state.selToken, i: i });
      return;
    }
    if (state.selIndex >= 0 && T.canMove(s.cells, s.turn, state.selIndex, i)) {
      playLocal({ k: 'move', s: state.selIndex, d: i });
      return;
    }
    state.selToken = null;
    state.selIndex = -1;
    afterLocal();
  }
  function pickToken(t, group) {
    if (!isHumanTurn()) return;
    if (state.selIndex >= 0 && T.isTank(t) && T.canRotate(state.s.cells, state.s.turn, t, state.selIndex)) {
      playLocal({ k: 'rotate', t: t, i: state.selIndex });
      return;
    }
    if (group === 'tank') {
      if (T.isTank(state.selToken)) {
        state.selToken = null;
      } else {
        state.selToken = T.preferFacing(state.s.turn);
      }
      state.selIndex = -1;
    } else {
      state.selToken = state.selToken === t ? null : t;
      state.selIndex = -1;
    }
    afterLocal();
  }
  function pickFace(t) {
    if (!isHumanTurn()) return;
    if (state.selIndex >= 0 && T.canRotate(state.s.cells, state.s.turn, t, state.selIndex)) {
      playLocal({ k: 'rotate', t: t, i: state.selIndex });
      return;
    }
    state.selToken = t;
    state.selIndex = -1;
    afterLocal();
  }
  $('hand').addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]'); if (!b) return;
    pickToken(b.getAttribute('data-t'), b.getAttribute('data-g') || '');
  });
  $('faces').addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]'); if (!b) return;
    pickFace(b.getAttribute('data-t'));
  });

  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu' || state.thinking) return;
    if (state.s.turn === state.color) return;
    state.thinking = true;
    state.selToken = null; state.selIndex = -1;
    localStatus();
    paint($('board'), state.s, { hints: false, coach: false, selected: -1, selToken: null, fireFrom: -1 });
    paintHand($('hand'), state.s, state.color, null, false);
    paintFaces($('faces'), state.s, state.color, null, -1, false);
    setTimeout(function () {
      if (!state.s || state.over || state.mode !== 'cpu') { state.thinking = false; return; }
      if (state.s.turn === state.color) {
        state.thinking = false; setChip('ready', 'Ready'); afterLocal(); return;
      }
      var act = T.aiMove(state.s);
      state.thinking = false;
      setChip('ready', 'Ready');
      if (!act || !applyLocal(act)) { localStatus(); return; }
      afterLocal();
    }, 140);
  }
  function undoLocal() {
    if (!state.hist.length || state.thinking) return;
    state.hist.pop();
    if (state.mode === 'cpu' && state.hist.length) state.hist.pop();
    state.s = T.replay(state.hist);
    state.over = !!state.s.winner;
    state.thinking = false;
    state.selToken = null; state.selIndex = -1;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    afterLocal();
  }
  function newLocal() {
    state.s = T.fresh(); state.hist = []; state.over = false;
    state.thinking = false; state.selToken = null; state.selIndex = -1;
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    afterLocal();
  }

  makeBoard($('board'), tapLocal);
  $('startBtn').onclick = function () { newLocal(); };
  $('newBtn').onclick = function () {
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;

  // ---- multiplayer ----
  // Who sits, whose turn it is, who is here and who waits is gifos.room's (manifest "room"). This app draws the
  // board and makes moves: the mover writes the whole next board with gifos.room.move.
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var NEEDS_NEWER = 'Thinktank needs a newer GifOS to play together. Reload the page to update.';
  var mpDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  var mp = { on: false, rs: null, board: null, selToken: null, selIndex: -1, auto: false, note: '' };

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
  }
  function mpState() { return T.replay(curBoard().moves || []); }

  $('friendBtn').onclick = mpEnter;
  function mpEnter() {
    mp.on = true; mp.selToken = null; mp.selIndex = -1;
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

  function compactAct(act) {
    return { k: act.k, t: act.t, i: act.i, s: act.s, d: act.d };
  }
  function mpSend(prev, nb) {
    mp.board = nb; mp.selToken = null; mp.selIndex = -1; mpRender();
    gifos.room.move('board', nb).catch(function (e) { mp.board = prev; mpSay(e); });
  }
  // The refusal note stays until the next room state, board change or tap.
  function mpPlay(act) {
    mp.note = '';
    if (!mpCanPlay()) return false;
    var prev = mp.board, b = curBoard();
    var ns = T.play(T.replay(b.moves || []), act);
    if (!ns) return false;
    var nb = { id: 'board', moves: (b.moves || []).concat([compactAct(act)]), winner: null, result: '', last: ns.last, seq: (b.seq || 0) + 1 };
    if (ns.winner) { nb.winner = ns.winner; nb.result = 'Base destroyed'; }
    mpSend(prev, nb);
    return true;
  }
  $('fResign').onclick = function () {
    if (!mpCanPlay() || !(curBoard().moves || []).length) return;
    var prev = mp.board, b = curBoard();
    mpSend(prev, { id: 'board', moves: b.moves, winner: mp.rs.turn === 'red' ? 'blue' : 'red', result: 'Resigned', last: null, seq: (b.seq || 0) + 1 });
  };
  // A finished game: anyone seated may start the next one (red goes first).
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat() || !curBoard().winner) return;
    gifos.room.newRound('board', freshBoard(), { first: 'red' }).catch(mpSay);
  };

  function seatHtml(name, label) {
    var row = seatRow(name), b = curBoard();
    var who = row.id ? esc(row.name || 'Player') + (row.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    return '<div class="seat ' + name + (mySeat() === name ? ' me' : '') + (mp.rs && mp.rs.turn === name && !b.winner ? ' turn' : '') +
      '">' + label + ' ' + who + '</div>';
  }
  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), rs = mp.rs, status = $('fStatus'), seat = mySeat();
    var s = mpState();
    var mine = mpCanPlay();
    if (!mine) { mp.selToken = null; mp.selIndex = -1; }
    $('fSeats').innerHTML = seatHtml('red', 'Red') + seatHtml('blue', 'Blue');
    $('fQueue').textContent = rs && rs.line && rs.line.length
      ? 'Next in line: ' + rs.line.map(function (p) { return p.name || 'Player'; }).join(', ')
      : '';
    $('fLog').textContent = lastLog(s);
    var turnName = rs && rs.turn === 'blue' ? 'Blue' : 'Red';
    var coach = coachFor(s, 'hotseat', seat, mine ? mp.selToken : null, mine ? mp.selIndex : -1, false, !!b.winner);
    var txt, bar = null, barCls = 'wait', cls = '';
    if (!ROOM) { txt = NEEDS_NEWER; bar = 'Needs a newer GifOS'; cls = 'warn'; }
    else if (!rs) { txt = 'Setting up the board…'; bar = 'Waiting'; }
    else if (b.winner) {
      var w = seatRow(b.winner);
      txt = (b.result ? b.result + ' — ' : '') + (w.id && w.name ? w.name : b.winner) + ' wins.';
      bar = coach.bar; barCls = coach.barCls;
    } else if (rs.me.role === 'waiting') { txt = 'Waiting for a seat to open…'; bar = 'In line'; }
    else if (rs.me.role === 'asking') { txt = 'Asking the host if you can play…'; bar = 'Asking'; }
    else if (!seat) { txt = 'Watching. ' + turnName + ' to play.'; bar = turnName + ' to play'; barCls = rs.turn; }
    else if (mine) { txt = coach.line; bar = 'Your turn — ' + turnName; barCls = rs.turn; }
    else {
      var t = seatRow(rs.turn);
      if (t.here === 'away') txt = 'Waiting for ' + (t.name || turnName) + ' to come back…';
      else if (!t.id) txt = 'Waiting for another player… press Invite (top bar) to bring a friend.';
      else txt = 'Waiting for ' + (t.name || turnName) + '…';
      bar = t.id ? 'Waiting for ' + turnName : 'Waiting for a friend';
    }
    status.className = 'statusline' + (cls ? ' ' + cls : '');
    status.textContent = mp.note && ROOM ? mp.note : txt;
    setTurnBar($('fTurnBar'), bar, barCls);
    paint($('fBoard'), s, {
      hints: mine,
      coach: mine,
      selToken: mine ? mp.selToken : null,
      selected: mine ? mp.selIndex : -1,
      fireFrom: -1
    });
    paintHand($('fHand'), s, (rs && rs.turn) || s.turn, mine ? mp.selToken : null, mine);
    paintFaces($('fFaces'), s, (rs && rs.turn) || s.turn, mine ? mp.selToken : null, mine ? mp.selIndex : -1, mine);
    // Squares are buttons: only a piece you may pick, or a square the picked piece can reach, is live.
    var maps = mine ? legalMaps(s, mp.selToken, mp.selIndex) : { place: {}, rot: {} };
    Array.prototype.forEach.call($('fBoard').children, function (sq) {
      var i = +sq.getAttribute('data-i'), p = s.cells[i];
      var on = mine && (maps.place[i] || maps.rot[i] || (p && p.player === s.turn));
      sq.setAttribute('aria-disabled', on ? 'false' : 'true');
    });
    $('fResign').hidden = !(mine && (b.moves || []).length);
    $('fNew').hidden = !(ROOM && seat && b.winner);
  }

  makeBoard($('fBoard'), function (i) {
    if (!mpCanPlay()) return;
    var s = mpState();
    var p = s.cells[i];
    if (mp.selToken && T.canRotate(s.cells, s.turn, mp.selToken, i)) {
      mpPlay({ k: 'rotate', t: mp.selToken, i: i });
      return;
    }
    if (p && p.player === s.turn && i !== mp.selIndex) {
      mp.selIndex = i;
      mp.selToken = T.isTank(p.token) ? p.token : null;
      mpRender();
      return;
    }
    if (mp.selToken && T.canPlace(s.cells, s.hands[s.turn], s.turn, mp.selToken, i)) {
      mpPlay({ k: 'place', t: mp.selToken, i: i });
      return;
    }
    if (mp.selIndex >= 0 && T.canMove(s.cells, s.turn, mp.selIndex, i)) {
      mpPlay({ k: 'move', s: mp.selIndex, d: i });
      return;
    }
    mp.selToken = null;
    mp.selIndex = -1;
    mpRender();
  });
  Array.prototype.forEach.call($('fBoard').children, function (sq) {
    sq.setAttribute('role', 'button'); sq.setAttribute('tabindex', '0'); sq.setAttribute('aria-disabled', 'true');
    sq.setAttribute('aria-label', 'Square ' + (+sq.getAttribute('data-i') + 1));
  });
  $('fHand').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-t]'); if (!btn) return;
    if (!mpCanPlay()) return;
    var t = btn.getAttribute('data-t');
    var g = btn.getAttribute('data-g') || '';
    var s = mpState();
    if (mp.selIndex >= 0 && T.isTank(t) && T.canRotate(s.cells, s.turn, t, mp.selIndex)) {
      mpPlay({ k: 'rotate', t: t, i: mp.selIndex });
      return;
    }
    if (g === 'tank') {
      mp.selToken = T.isTank(mp.selToken) ? null : T.preferFacing(s.turn);
      mp.selIndex = -1;
    } else {
      mp.selToken = mp.selToken === t ? null : t;
      mp.selIndex = -1;
    }
    mpRender();
  });
  $('fFaces').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-t]'); if (!btn) return;
    if (!mpCanPlay()) return;
    var t = btn.getAttribute('data-t');
    var s = mpState();
    if (mp.selIndex >= 0 && T.canRotate(s.cells, s.turn, t, mp.selIndex)) {
      mpPlay({ k: 'rotate', t: t, i: mp.selIndex });
      return;
    }
    mp.selToken = t;
    mp.selIndex = -1;
    mpRender();
  });

  // The game only, so the checks and a tester can compare copies.
  window['__thinktank'] = { state: function () {
    var b = mp.board;
    return { moves: b && b.moves ? JSON.stringify(b.moves) : '', winner: b ? b.winner : null };
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
      state.color = g.color || 'red';
      state.hist = g.moves.slice();
      state.s = T.replay(state.hist);
      state.over = !!state.s.winner;
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two players');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('colorSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-color') === state.color);
        });
        $('cpuNote').textContent = state.color === 'red'
          ? 'You play red and go first. The computer plays blue. It thinks on this device.'
          : 'You play blue. The computer plays red, and goes first.';
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      afterLocal();
    }).catch(function () {});
  }
})();
