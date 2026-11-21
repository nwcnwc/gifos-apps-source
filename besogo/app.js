// BesoGo — a Go board. Engine and display are yewang's BesoGo (MIT),
// running on this device. A friend sits the other colour via gifos.room.
// Invite is OS chrome — this file never draws a share button.
//
// Seats and turns come from gifos.room; the mover writes the whole next board.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
  };
  var BLACK = -1, WHITE = 1;
  var colorNum = function (name) { return name === 'white' ? WHITE : BLACK; };
  var colorName = function (n) { return n === WHITE ? 'white' : 'black'; };

  var state = { size: 19, hist: [], over: false, result: '' };
  var localEditor = null;
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

  $('sizeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    state.size = parseInt(b.getAttribute('data-size'), 10) || 19;
  });

  // Replay a move list onto a fresh tree. Returns the last node (or root).
  function replay(size, hist) {
    var root = besogo.makeGameRoot(size, size);
    var node = root, i, child, color;
    for (i = 0; i < hist.length; i++) {
      child = node.makeChild();
      color = colorNum(hist[i].color);
      if (!child.playMove(hist[i].x, hist[i].y, color, false)) return null;
      node.addChild(child);
      node = child;
    }
    return node;
  }
  function legalPlace(size, hist, x, y, seat) {
    var node = replay(size, hist);
    if (!node) return false;
    if (colorName(node.nextMove()) !== seat) return false;
    var child = node.makeChild();
    return !!child.playMove(x, y, colorNum(seat), false);
  }
  function twoPasses(hist) {
    if (hist.length < 2) return false;
    var a = hist[hist.length - 1], b = hist[hist.length - 2];
    return a.x === 0 && a.y === 0 && b.x === 0 && b.y === 0;
  }
  function capsOf(node) {
    if (!node) return { black: 0, white: 0 };
    return { black: node.blackCaps || 0, white: node.whiteCaps || 0 };
  }
  function turnOf(hist) {
    if (!hist.length) return 'black';
    return hist[hist.length - 1].color === 'black' ? 'white' : 'black';
  }

  // Tap on the SVG is a click. On a phone the delayed click is flaky, so
  // a touchend synthesises one click and cancels the later ghost.
  function enableTouchPlace(container) {
    var last = 0;
    container.addEventListener('touchend', function (e) {
      if (!e.changedTouches || !e.changedTouches.length) return;
      var t = e.changedTouches[0];
      var el = document.elementFromPoint(t.clientX, t.clientY);
      if (!el || !container.contains(el)) return;
      last = nowMs();
      e.preventDefault();
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
        clientX: t.clientX, clientY: t.clientY
      }));
    }, { passive: false });
    container.addEventListener('click', function (e) {
      if (last && nowMs() - last < 500) {
        last = 0;
        // The synthetic click from touchend is the one we want; a leftover
        // browser click arriving later is dropped by the timestamp. This
        // listener only exists to eat that leftover — BesoGo binds click
        // on the rects themselves, so we do not stopPropagation here.
        void e;
      }
    }, true);
  }

  function mountBoard(el, size, onPlace) {
    el.innerHTML = '';
    besogo.create(el, {
      size: String(size),
      panels: '',
      tool: 'auto',
      coord: 'none',
      resize: 'auto',
      orient: 'landscape',
      nowheel: true,
      nokeys: true,
      shadows: true
    });
    var editor = el.besogoEditor;
    var orig = editor.click;
    editor.click = function (i, j) {
      onPlace(i, j);
    };
    enableTouchPlace(el);
    return { editor: editor, orig: orig };
  }
  function loadHist(editor, size, hist) {
    var node = replay(size, hist);
    if (!node) return;
    var root = node;
    while (root.parent) root = root.parent;
    editor.loadRoot(root);
    if (hist.length) editor.nextNode(-1);
  }

  // ---- local (two here) ----
  function localCapsText() {
    var node = localEditor ? localEditor.getCurrent() : null;
    var c = capsOf(node);
    return 'Taken · black ' + c.black + ' · white ' + c.white;
  }
  function localStatus() {
    if (state.over) {
      if (state.result === 'Both passed') {
        setStatus($('statusLine'), 'Both passed — the game is over.', '');
      } else {
        setStatus($('statusLine'), state.result || 'Game over.', '');
      }
    } else {
      var t = turnOf(state.hist);
      setStatus($('statusLine'), (t === 'black' ? 'Black' : 'White') + ' to play.', '');
    }
    $('localBlack').className = 'seat' + (!state.over && turnOf(state.hist) === 'black' ? ' turn' : '');
    $('localWhite').className = 'seat' + (!state.over && turnOf(state.hist) === 'white' ? ' turn' : '');
    $('localCaps').textContent = localCapsText();
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', size: state.size,
      hist: state.hist.slice(),
      over: state.over, result: state.result, at: nowMs()
    }).catch(function () {});
  }
  function playLocal(x, y) {
    if (state.over) return false;
    var seat = turnOf(state.hist);
    if (!legalPlace(state.size, state.hist, x, y, seat)) return false;
    state.hist.push({ x: x, y: y, color: seat });
    if (twoPasses(state.hist)) { state.over = true; state.result = 'Both passed'; }
    if (localEditor) loadHist(localEditor, state.size, state.hist);
    localStatus();
    saveLocal();
    return true;
  }
  function undoLocal() {
    if (!state.hist.length) return;
    state.hist.pop();
    state.over = false;
    state.result = '';
    if (localEditor) loadHist(localEditor, state.size, state.hist);
    localStatus();
    saveLocal();
  }
  function newLocal() {
    state.hist = []; state.over = false; state.result = '';
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    setChip('ready', 'Two here');
    var mounted = mountBoard($('board'), state.size, function (i, j) { playLocal(i, j); });
    localEditor = mounted.editor;
    localStatus();
    saveLocal();
  }

  $('startBtn').onclick = function () { picked = true; newLocal(); };
  $('newBtn').onclick = function () {
    localEditor = null;
    $('board').innerHTML = '';
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
  };
  $('undoBtn').onclick = undoLocal;
  $('passBtn').onclick = function () { playLocal(0, 0); };

  // ---- multiplayer: gifos.room ----
  // The room (manifest "room") owns who plays, who watches, whose turn it is, seat hold on reload and hand-off.
  // This app draws the board and writes the whole next board with gifos.room.move.
  var EN = { needsNewer: 'BesoGo needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var mpDb = null, askDb = null;
  try { if (window.gifos) mpDb = gifos.db('board'); } catch (e) {}
  try { if (window.gifos && ROOM) askDb = gifos.db('undo'); } catch (e) {}
  var rs = null, joined = false, picked = false, note = '', ask = null;
  var mp = { on: false, board: null, sub: false, editor: null, shown: '' };

  function freshBoard(size) {
    return { id: 'board', size: size || state.size, hist: [], turn: 'black', winner: null, result: '' };
  }
  function curBoard() { return mp.board || freshBoard(); }
  function seatOf(s, name) {
    var x = s && s.seats && s.seats.filter(function (q) { return q.seat === name; })[0];
    return x || { seat: name, id: null, name: '', here: 'open' };
  }
  function alone() { return !!rs && !rs.live; }
  function mySeat() { return rs && rs.me ? rs.me.seat : null; }
  // alone, the one person plays whichever colour is on turn
  function canPlay() {
    var b = curBoard();
    if (!ROOM || !rs || b.winner) return false;
    if (alone()) return !!mySeat() && seatOf(rs, b.turn).here !== 'away';
    return !!rs.myTurn;
  }
  function say(e) {
    note = e && e.message ? e.message : '';
    mpRender();
  }

  $('friendBtn').onclick = function () { picked = true; mpEnter(); };
  function mpEnter() {
    if (mp.on) return;
    mp.on = true; mp.editor = null; mp.shown = '';
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
      if (askDb) askDb.subscribe(function (items) {
        ask = null;
        for (var i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'undo') ask = items[i];
        mpRender();
      });
    }
    if (ROOM && rs && !joined && rs.me && rs.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    mpRender();
  }
  function mpLeave() {
    mp.on = false; picked = true;
    if (ROOM) { joined = false; gifos.room.leave().catch(function () {}); }
    mp.editor = null; mp.shown = '';
    $('fBoard').innerHTML = '';
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

  function mpPlay(x, y) {
    var b = curBoard();
    if (!canPlay()) return false;
    if (!legalPlace(b.size, b.hist || [], x, y, b.turn)) return false;
    var hist = (b.hist || []).concat([{ x: x, y: y, color: b.turn }]);
    var nb = { id: 'board', size: b.size, hist: hist, turn: turnOf(hist), winner: null, result: '' };
    if (twoPasses(hist)) { nb.winner = 'draw'; nb.result = 'Both passed'; }
    mp.board = nb; mpRender();
    if (askDb && ask) askDb.delete('undo').catch(function () {});
    gifos.room.move('board', nb).catch(say);
    return true;
  }
  $('fPass').onclick = function () { mpPlay(0, 0); };
  // Take back a stone: the owner of the last stone asks, the other player (on turn) agrees and the stone comes off.
  // Alone, one person plays both colours, so it just comes off.
  $('fUndo').onclick = function () {
    var b = curBoard(), hist = b.hist || [], seat = mySeat();
    if (!ROOM || !seat || !hist.length) return;
    var req = ask && ask.len === hist.length && ask.round === rs.round ? ask : null;
    if (canPlay() && (alone() || (req && req.by !== rs.me.id))) {
      var nh = hist.slice(0, -1);
      var nb = { id: 'board', size: b.size, hist: nh, turn: turnOf(nh), winner: null, result: '' };
      mp.board = nb; mpRender();
      if (askDb && ask) askDb.delete('undo').catch(function () {});
      gifos.room.move('board', nb).catch(say);
    } else if (req && req.by === rs.me.id) {
      askDb.delete('undo').catch(function () {});
    } else if (askDb && hist[hist.length - 1].color === seat) {
      askDb.put({ id: 'undo', by: rs.me.id, name: rs.me.name, len: hist.length, round: rs.round }).catch(say);
    }
  };
  // Resign: on your turn, the game goes to the other colour.
  $('fResign').onclick = function () {
    var b = curBoard();
    if (!canPlay() || b.winner) return;
    var nb = JSON.parse(JSON.stringify(b));
    nb.winner = b.turn === 'black' ? 'white' : 'black'; nb.result = 'Resigned';
    mp.board = nb; mpRender();
    gifos.room.move('board', nb).catch(say);
  };
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat()) return;
    if (askDb && ask) askDb.delete('undo').catch(function () {});
    gifos.room.newRound('board', freshBoard(state.size), { first: 'black' }).catch(say);
  };

  function mpEnsureBoard(b) {
    var key = b.size + ':' + (b.hist || []).map(function (m) { return m.x + '.' + m.y + m.color.charAt(0); }).join(',');
    if (mp.editor && mp.shown === key) return;
    if (!mp.editor || mp.shown.split(':')[0] !== String(b.size)) {
      var mounted = mountBoard($('fBoard'), b.size, function (i, j) { mpPlay(i, j); });
      mp.editor = mounted.editor;
    }
    loadHist(mp.editor, b.size, b.hist || []);
    mp.shown = key;
  }

  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), status = $('fStatus');
    var seat = mySeat();
    if (!ROOM) {
      $('fSeats').innerHTML = ''; $('fQueue').textContent = '';
      status.textContent = T('needsNewer'); status.className = 'statusline warn';
      if (b.hist) mpEnsureBoard(b);
      $('fPass').hidden = $('fUndo').hidden = $('fResign').hidden = $('fNew').hidden = true;
      return;
    }
    status.className = 'statusline';
    var nameOf = function (name) {
      var x = seatOf(rs, name);
      return x.id ? esc(x.name || 'Player') + (x.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    };
    $('fSeats').innerHTML =
      '<div class="seat' + (seat === 'black' ? ' me' : '') + (b.turn === 'black' && !b.winner ? ' turn' : '') + '">● ' + nameOf('black') + '</div>' +
      '<div class="seat' + (seat === 'white' ? ' me' : '') + (b.turn === 'white' && !b.winner ? ' turn' : '') + '">○ ' + nameOf('white') + '</div>';
    var role = rs.me ? rs.me.role : 'watcher';
    var wait = (rs.line || []).map(function (p) { return p.name || 'Player'; });
    $('fQueue').textContent = note || (role === 'waiting' ? 'You are in line for a seat.' : role === 'asking' ? 'Waiting for the host to seat you.' :
      (wait.length ? 'In line: ' + wait.join(', ') : ''));
    var tx = seatOf(rs, b.turn), hist = b.hist || [];
    var req = ask && ask.len === hist.length && ask.round === rs.round ? ask : null;
    if (b.winner) {
      var wx = seatOf(rs, b.winner);
      status.innerHTML = b.winner === 'draw' ? esc(b.result || 'Both passed')
        : esc(b.result || 'Game over') + ' — ' + (wx.id && wx.name ? esc(wx.name) : b.winner) + ' wins.';
    } else if (req && req.by !== rs.me.id && canPlay()) {
      status.textContent = (req.name || 'The other player') + ' wants to take back a stone. Press Undo if you agree.';
    } else if (canPlay()) {
      status.textContent = rs.live ? 'Your turn (' + b.turn + ').' : b.turn.charAt(0).toUpperCase() + b.turn.slice(1) + ' to play.';
    } else if (!seat) {
      status.textContent = role === 'waiting' ? 'Waiting for a seat…' : 'Spectating.';
    } else if (tx.here === 'away') {
      status.textContent = (tx.name || b.turn) + ' is reconnecting…';
    } else if (!tx.id) {
      status.innerHTML = 'Waiting for another player… press <b>Invite</b> (top bar) to bring a friend.';
    } else {
      status.textContent = 'Waiting for ' + (tx.name || b.turn) + '…';
    }
    var node = replay(b.size, hist);
    var c = capsOf(node);
    $('fCaps').textContent = 'Taken · black ' + c.black + ' · white ' + c.white;
    mpEnsureBoard(b);
    var playing = !!(seat && !b.winner);
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('fLeave').hidden = !!rs.live;
    $('fPass').hidden = !canPlay();
    $('fUndo').hidden = !(playing && hist.length && (alone() || (req ? true : hist[hist.length - 1].color === seat)));
    $('fUndo').textContent = req && req.by === rs.me.id ? '↶ Cancel take-back' : '↶ Undo';
    $('fResign').hidden = !(canPlay() && hist.length);
    $('fNew').hidden = !(seat && (b.winner || (!rs.live && hist.length)));
  }

  // Read-only, for the room kit: the game only.
  window.__besogo = {
    state: function () {
      var b = mp.board;
      return { size: b ? b.size : 0, turn: b ? b.turn : null, winner: b ? b.winner : null,
        hist: b ? (b.hist || []).map(function (m) { return m.x + '.' + m.y + m.color.charAt(0); }).join(',') : '' };
    }
  };

  window.addEventListener('resize', function () {
    // BesoGo's own auto-resizer listens too; nothing extra to do.
  });

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) {
      localEditor = null;
      $('board').innerHTML = '';
      $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
    }
  });

  setChip('ready', 'Ready');
  if (!ROOM) { $('oldNote').textContent = T('needsNewer'); $('oldNote').hidden = false; }
  if (db) {
    db.get('game').then(function (g) {
      if (!g || !g.hist || !g.hist.length || g.over) return;
      state.size = g.size || 19;
      state.hist = g.hist;
      state.over = !!g.over;
      state.result = g.result || '';
      Array.prototype.forEach.call($('sizeSeg').children, function (c) {
        c.classList.toggle('on', parseInt(c.getAttribute('data-size'), 10) === state.size);
      });
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      setChip('ready', 'Two here');
      var mounted = mountBoard($('board'), state.size, function (i, j) { playLocal(i, j); });
      localEditor = mounted.editor;
      loadHist(localEditor, state.size, state.hist);
      localStatus();
    }).catch(function () {});
  }
})();
