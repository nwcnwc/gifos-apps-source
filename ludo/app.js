// Ludo — four seats. Invite is OS chrome. The file is the save.
// Online, gifos.room seats people (Red, Green, Yellow, Blue in join order) and
// keeps who is here; the board is the whole game record the mover writes.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var L = window.LUDO;
  var saveDb = null, roomDb = null;
  var EN = { needsNewer: 'Ludo needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var mode = 'local';
  var mySeat = 0;
  var game = L.fresh(4);
  var nPlayers = 4;
  var rs = null, joined = false, picked = false, note = '', advKey = '';
  var stash = null;
  var rgame = null;   // the shared game record's game, as the room data last said

  try {
    if (window.gifos) {
      saveDb = gifos.db('save');
      roomDb = gifos.db('game');
    }
  } catch (e) {}

  function setChip(cls, text) {
    $('chip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('chipText').textContent = text;
  }
  function persist() {
    if (!saveDb || mode !== 'local') return;
    saveDb.put({ id: 'save', game: game, n: nPlayers }).catch(function () {});
  }
  // ---- the room's word ----
  function held() { return [0, 1, 2, 3].map(function (p) { var x = rs && rs.seats && rs.seats[p]; return !!(x && x.id); }); }
  function heldCount() { return held().filter(Boolean).length; }
  // The game as the table stands: only held seats play.
  function shown() {
    var g = L.clone(rgame || L.fresh(4));
    g.playing = held();
    return g;
  }
  function myIndex() {
    var i = -1, p;
    if (rs && rs.me && rs.me.seat) for (p = 0; p < 4; p++) if (L.NAMES[p] === rs.me.seat) i = p;
    return i;
  }
  function say(e) {
    note = e && e.message ? e.message : '';
    paintBoard();
  }
  function put(g, fresh) {
    var rec = { id: 'game', game: g };
    if (fresh) return gifos.room.newRound('game', rec, { first: 'Red' }).catch(say);
    return gifos.room.move('game', rec).catch(function (e) { rgame = null; say(e); });
  }

  function paintRoster() {
    var el = $('roster');
    if (!el) return;
    if (mode !== 'mp') { el.innerHTML = ''; return; }
    var html = '', p, x;
    for (p = 0; p < 4; p++) {
      x = rs && rs.seats && rs.seats[p] ? rs.seats[p] : { id: null, name: '', here: 'open' };
      var who = x.id ? (x.name || 'Player') + (x.here === 'away' ? ' …' : '') : 'open';
      var mine = p === mySeat;
      html += '<li class="' + L.COLORS[p] + (mine ? ' me' : '') + (game.turn === p && game.winner < 0 && x.id ? ' turn' : '') + '">'
        + '<span class="swatch"></span>' + L.NAMES[p] + ' — ' + (mine ? 'you' : who) + '</li>';
    }
    el.innerHTML = html;
  }

  function paintBoard() {
    if (mode === 'mp' && ROOM) { game = shown(); mySeat = myIndex(); }
    var el = $('board');
    if (el.children.length !== 225) {
      el.innerHTML = '';
      var r, c, d;
      for (r = 0; r < 15; r++) for (c = 0; c < 15; c++) {
        d = document.createElement('div');
        d.className = 'sq';
        d.setAttribute('data-r', String(r));
        d.setAttribute('data-c', String(c));
        el.appendChild(d);
      }
    }
    var i, p, t, cell, kind;
    for (i = 0; i < 225; i++) {
      el.children[i].className = 'sq';
      el.children[i].innerHTML = '';
    }
    function at(r, c) { return el.children[r * 15 + c]; }
    function paintPath(list, cls) {
      for (i = 0; i < list.length; i++) at(list[i].r, list[i].c).classList.add(cls);
    }
    paintPath(L.LOOP, 'path');
    for (p = 0; p < 4; p++) paintPath(L.HOME[p], L.COLORS[p]);
    for (r = 9; r <= 14; r++) for (c = 0; c <= 5; c++) at(r, c).classList.add('red', 'yard');
    for (r = 0; r <= 5; r++) for (c = 0; c <= 5; c++) at(r, c).classList.add('green', 'yard');
    for (r = 0; r <= 5; r++) for (c = 9; c <= 14; c++) at(r, c).classList.add('yellow', 'yard');
    for (r = 9; r <= 14; r++) for (c = 9; c <= 14; c++) at(r, c).classList.add('blue', 'yard');
    at(7, 7).classList.add('home');
    for (p = 0; p < 4; p++) {
      if (!game.playing[p]) continue;
      for (t = 0; t < 4; t++) {
        cell = L.cellOf(p, game.tokens[p][t], t);
        kind = document.createElement('button');
        kind.type = 'button';
        kind.className = 'tok ' + L.COLORS[p];
        kind.setAttribute('data-p', String(p));
        kind.setAttribute('data-t', String(t));
        at(cell.r, cell.c).appendChild(kind);
      }
    }
    var legal = game.rolled ? L.moves(game) : [];
    for (i = 0; i < legal.length; i++) {
      var btn = el.querySelector('[data-p="' + game.turn + '"][data-t="' + legal[i].t + '"]');
      if (btn) btn.classList.add('lit');
    }
    // only a token you can move now is a live button
    var toks = el.querySelectorAll('.tok'), k;
    for (k = 0; k < toks.length; k++) toks[k].disabled = !(toks[k].classList.contains('lit') && canAct());
    $('status').textContent = game.log || (L.NAMES[game.turn] + ' to play');
    if (mode === 'mp') {
      if (!ROOM) $('status').textContent = T('needsNewer');
      else if (heldCount() < 2) $('status').textContent = 'Waiting for another player… press Invite (top bar) to bring a friend.';
      else if (note) $('status').textContent = note;
    }
    $('die').textContent = game.die ? String(game.die) : '·';
    var myTurn = canAct();
    $('rollBtn').disabled = !myTurn || !!game.rolled || game.winner >= 0;
    $('die').disabled = $('rollBtn').disabled;
    document.body.className = 'play ' + L.COLORS[game.turn];
    if (game.winner >= 0) {
      setChip('win', L.NAMES[game.winner] + ' wins');
      $('status').textContent = L.NAMES[game.winner] + ' got all four home.';
    } else if (mode === 'mp' && !ROOM) {
      setChip('play', 'Read only');
    } else if (mode === 'mp' && mySeat >= 0) {
      var label = L.NAMES[mySeat];
      if (myTurn) setChip('play', 'You (' + label + ') — ' + (game.rolled ? 'pick a token' : 'roll'));
      else setChip('play', L.NAMES[game.turn] + (game.rolled ? ' — picking' : ' — rolling'));
    } else {
      setChip('play', L.NAMES[game.turn] + (game.rolled ? ' — pick a token' : ' — roll'));
    }
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('backBtn').hidden = mode === 'mp' && !!rs && rs.live;
    paintRoster();
  }

  function canAct() {
    if (game.winner >= 0) return false;
    if (mode === 'local') return true;
    if (!ROOM || heldCount() < 2) return false;
    var x = rs.seats[game.turn];
    return mySeat === game.turn && mySeat >= 0 && !!x && x.here !== 'away';
  }

  function doRoll() {
    if (!canAct() || game.rolled) return;
    if (mode === 'mp') {
      game = L.roll(game);
      rgame = game;
      paintBoard(); put(game);
      return;
    }
    game = L.roll(game);
    paintBoard(); persist();
  }
  function doMove(t) {
    if (!canAct() || !game.rolled) return;
    if (mode === 'mp') {
      var legal = L.moves(game), ok = false, i;
      for (i = 0; i < legal.length; i++) if (legal[i].t === t) ok = true;
      if (!ok) return;
      game = L.apply(game, t);
      rgame = game;
      paintBoard(); put(game);
      return;
    }
    game = L.apply(game, t);
    paintBoard(); persist();
  }
  function doNew() {
    if (mode === 'mp') {
      if (!ROOM || mySeat < 0) return;
      var g = L.fresh(4);
      g.playing = held();
      rgame = g;
      put(g, true);
      return;
    }
    game = L.fresh(nPlayers);
    paintBoard(); persist();
  }

  $('rollBtn').onclick = doRoll;
  $('die').onclick = doRoll;
  $('board').onclick = function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute('data-p') == null) return;
    if (+t.getAttribute('data-p') !== game.turn) return;
    doMove(+t.getAttribute('data-t'));
  };
  $('newBtn').onclick = doNew;

  function show(id) {
    $('home').hidden = id !== 'home';
    $('play').hidden = id !== 'play';
  }
  $('nSeg').onclick = function (ev) {
    var b = ev.target.closest ? ev.target.closest('button') : ev.target;
    if (!b || !b.getAttribute('data-n')) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.remove('on'); });
    b.classList.add('on');
    nPlayers = +b.getAttribute('data-n');
  };
  $('soloBtn').onclick = function () {
    picked = true;
    leaveMp();
    mode = 'local';
    game = L.fresh(nPlayers);
    mySeat = 0;
    show('play');
    paintBoard(); persist();
  };
  $('contBtn').onclick = function () {
    picked = true;
    leaveMp();
    mode = 'local';
    mySeat = 0;
    show('play');
    paintBoard();
  };
  $('friendBtn').onclick = function () {
    picked = true;
    if (!roomDb) {
      $('homeErr').hidden = false;
      $('homeErr').textContent = 'Play with friends needs the room. You can still play on this device.';
      return;
    }
    mpEnter();
  };
  $('backBtn').onclick = function () { picked = true; leaveMp(); show('home'); };

  function leaveMp() {
    if (mode !== 'mp') return;
    mode = 'local';
    if (stash) { game = stash.game; nPlayers = stash.n; stash = null; }
    // with others here the room is how you go; leaving the table frees your colour for the next in line
    if (ROOM) { joined = false; gifos.room.leave().catch(function () {}); }
  }

  function mpEnter() {
    if (mode === 'local') stash = { game: game, n: nPlayers };
    mode = 'mp';
    nPlayers = 4;
    mySeat = myIndex();
    game = shown();
    show('play');
    setChip('play', ROOM ? 'Four seats' : 'Read only');
    if (ROOM && rs && !joined && rs.me && rs.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    paintBoard();
  }

  // The shared game record. Empty seats are skipped: when the colour on turn is open, the first seated player
  // moves the turn on (the room itself does not pass over an open seat).
  function onItems(items) {
    note = '';
    var b = null, i;
    for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'game') b = items[i];
    rgame = b && b.game ? b.game : null;
    advance();
    if (mode === 'mp') paintBoard();
  }
  function advance() {
    if (mode !== 'mp' || !ROOM || !rs || heldCount() < 2) return;
    var g = shown(), me = myIndex(), first = held().indexOf(true);
    if (g.winner >= 0 || me < 0 || me !== first || g.playing[g.turn]) return;
    var key = JSON.stringify([rs.round, g.turn, g.tokens, g.playing]);
    if (key === advKey) return;
    advKey = key;
    L.nextTurn(g);
    rgame = g;
    put(g);
  }

  function onBack() {
    if (!$('play').hidden) { show('home'); return true; }
    return true;
  }

  function boot() {
    setChip('ready', 'Four seats');
    if (!L) {
      $('homeErr').hidden = false;
      $('homeErr').textContent = 'The board did not load.';
      return;
    }
    if (window.gifos && gifos.onBack) gifos.onBack(onBack);
    if (saveDb) {
      saveDb.get('save').then(function (row) {
        if (row && row.game) {
          game = row.game;
          nPlayers = row.n || 4;
          $('contBtn').hidden = false;
        }
      }).catch(function () {});
    }
    if (!ROOM) { $('homeErr').hidden = false; $('homeErr').textContent = T('needsNewer'); }
    if (roomDb) roomDb.subscribe(onItems);
    if (ROOM) {
      gifos.room.subscribe(function (s) {
        note = '';   // a refusal's note goes with the next room state
        rs = s;
        // with other people here, room play is what you see; alone you start on the menu
        if (mode !== 'mp' && !picked && s.live) { mpEnter(); return; }
        if (mode === 'mp' && !joined && s.me && s.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
        advance();
        if (mode === 'mp') paintBoard();
      });
    }
  }
  boot();

  // Read-only, for the room kit: the game only.
  window.__ludo = {
    state: function () {
      var g = rgame;
      return g ? { turn: g.turn, die: g.die, rolled: g.rolled, winner: g.winner, tokens: JSON.stringify(g.tokens) } : { turn: null };
    }
  };
  window.LudoApp = {
    canAct: canAct,
    get game() { return game; }, get seats() { return rs ? rs.seats : []; }, get mode() { return mode; }
  };
})();
