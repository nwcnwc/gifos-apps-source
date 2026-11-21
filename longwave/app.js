// Longwave. A psychic sees the mark and gives a clue; a guesser places the
// needle. Invite is OS chrome — this file never draws a share button.
//
// Online, gifos.room seats two people and passes the turn; the mover writes
// the whole board record with gifos.room.move (see the multiplayer section).
(function () {
  'use strict';
  var LW = window.LW;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  };

  var db = null;
  try { if (window.gifos) db = gifos.db('lw'); } catch (e) {}
  var best = 0;
  var mode = 'setup'; // setup | hotseat | mp
  var canSlide = false;
  var dragging = false;
  var savedHot = null;

  function setChip(cls, text) {
    $('chip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('chipState').textContent = text;
  }
  function setStatus(text, cls) {
    $('status').className = 'statusline' + (cls ? ' ' + cls : '');
    $('status').textContent = text || '';
  }
  function setTurn(who, detail, kind) {
    $('turnWho').textContent = who || '';
    $('turnDo').textContent = detail || '';
    $('turnBanner').className = 'turnbanner' + (kind ? ' ' + kind : '');
  }
  function showStats() {
    $('statsLine').textContent = best ? ('Best cooperative score ' + best) : '';
  }
  function saveBest(n) {
    if (n > best) {
      best = n;
      if (db) db.put({ id: 'stats', best: best }).catch(function () {});
      showStats();
    }
  }

  function tickPct(v) { return ((v | 0) / LW.MAX) * 100; }
  function placeWedges(t) {
    t = t | 0;
    var el = $('wedges');
    el.style.left = (((t - 2.5) / LW.MAX) * 100) + '%';
    el.style.width = ((5 / LW.MAX) * 100) + '%';
  }
  function paintPips(left, total) {
    var n = LW.TURNS, used = n - (left | 0), i, html = '';
    for (i = 0; i < n; i++) html += '<span class="' + (i < used ? 'gone' : 'left') + '"></span>';
    $('pips').innerHTML = html;
    $('scoreNum').textContent = String(total | 0);
  }
  function paintSeats(a, b) {
    function cell(s) {
      var name = s.open ? '<span class="open">open</span>'
        : (s.me ? 'You' : esc(s.name || ''));
      return '<div class="seat' + (s.me ? ' me' : '') + (s.on ? ' turn' : '') + '">' +
        '<span class="role">' + esc(s.label) + '</span>' +
        (name ? '<span class="who">' + name + '</span>' : '') +
        '</div>';
    }
    $('seats').innerHTML = cell(a) + cell(b);
  }
  function showReveal(raw, last) {
    var el = $('revealScore');
    el.hidden = false;
    if (raw === 4) {
      el.className = 'reveal-score bull';
      $('revealPts').textContent = '+' + last;
      $('revealWhy').textContent = 'Dead on — you keep the card';
    } else if (last) {
      el.className = 'reveal-score hit';
      $('revealPts').textContent = '+' + last;
      $('revealWhy').textContent = raw === 3 ? 'Close' : 'In the zone';
    } else {
      el.className = 'reveal-score miss';
      $('revealPts').textContent = '0';
      $('revealWhy').textContent = 'Miss';
    }
  }
  function hideReveal() { $('revealScore').hidden = true; }

  function paintSpectrum(card, opts) {
    opts = opts || {};
    card = card || ['Left', 'Right'];
    var cols = LW.poleColors(card[0]);
    $('poleL').textContent = card[0];
    $('poleR').textContent = card[1];
    $('poleL').style.background = cols.left;
    $('poleR').style.background = cols.right;
    $('rail').style.background = 'linear-gradient(90deg, ' + cols.left + ' 0%, ' + cols.right + ' 100%)';

    var showT = opts.target != null && opts.target !== false;
    var showG = opts.guess != null && opts.guess !== false;
    var showB = !!(opts.bands || opts.aim) && (showT || opts.target === 0);
    if (opts.aim && opts.target == null) showB = false;
    if ((opts.bands || opts.aim) && opts.target != null && opts.target !== false) showB = true;
    $('wedges').hidden = !showB;
    if (showB) {
      placeWedges(opts.target | 0);
      $('wedges').className = 'wedges' + (opts.aim ? ' aim' : ' reveal');
    }
    // Wedges ARE the mark — a gold ring on top of the 4 eats the label.
    $('targetMark').hidden = !showT || !!showB;
    if (showT) $('targetMark').style.left = tickPct(opts.target) + '%';
    $('needle').hidden = !showG;
    if (showG) $('needle').style.left = tickPct(opts.guess) + '%';
    canSlide = !!opts.slide;
    $('railWrap').classList.toggle('can-slide', canSlide);
    $('railWrap').style.cursor = canSlide ? 'grab' : 'default';
  }

  function posFromEvent(e) {
    var r = $('rail').getBoundingClientRect();
    var pt = e;
    if (e.touches && e.touches[0]) pt = e.touches[0];
    else if (e.changedTouches && e.changedTouches[0]) pt = e.changedTouches[0];
    var x = pt.clientX - r.left;
    var t = r.width ? x / r.width : 0.5;
    return Math.max(0, Math.min(LW.MAX, Math.round(t * LW.MAX)));
  }
  function needleTo(v) {
    $('needle').hidden = false;
    $('needle').style.left = tickPct(v) + '%';
  }
  function onSlide(v) {
    if (!canSlide) return;
    if (mode === 'hotseat') {
      L.guess = v;
      needleTo(v);
    } else if (mode === 'mp') {
      mpSlide(v);
    }
  }
  (function bindRail() {
    var wrap = $('railWrap');
    wrap.addEventListener('pointerdown', function (e) {
      if (!canSlide) return;
      dragging = true;
      wrap.classList.add('sliding');
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      onSlide(posFromEvent(e));
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!dragging || !canSlide) return;
      onSlide(posFromEvent(e));
    });
    function up() {
      dragging = false;
      wrap.classList.remove('sliding');
    }
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
  })();

  (function buildTicks() {
    var el = $('ticks'), i, s;
    el.innerHTML = '';
    for (i = 0; i <= LW.MAX; i++) {
      s = document.createElement('i');
      s.style.left = (i / LW.MAX * 100) + '%';
      if (i === 0 || i === 10 || i === LW.MAX) s.className = 'maj';
      el.appendChild(s);
    }
  })();

  function setActions(btns) {
    var el = $('actions'), i, b;
    el.innerHTML = '';
    for (i = 0; i < btns.length; i++) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = btns[i].primary ? 'primary' : (btns[i].quiet ? 'ghost quiet' : 'ghost');
      if (btns[i].wide) b.className += ' wide';
      b.textContent = btns[i].label;
      b.disabled = !!btns[i].off;
      b.addEventListener('click', btns[i].fn);
      el.appendChild(b);
    }
  }

  function showClueRead(who, text) {
    $('clueWrite').hidden = true;
    $('clueRead').hidden = false;
    $('clueRead').innerHTML =
      (who ? '<span class="who">' + esc(who) + '</span>' : '') +
      '<span class="said">' + esc(text || '') + '</span>';
  }
  function showClueWrite(value) {
    $('clueRead').hidden = true;
    $('clueWrite').hidden = false;
    if (value != null) $('clueInput').value = value;
  }
  function hideClue() {
    $('clueRead').hidden = true;
    $('clueWrite').hidden = true;
  }

  // ---- hotseat ----
  var L = null;
  function freshLocal() {
    return {
      seed: LW.randomSeed(), index: 0, target: LW.randomTarget(),
      clue: '', guess: 10, phase: 'clue', total: 0, left: LW.TURNS, last: 0, raw: 0
    };
  }
  function cardOf(g) { return LW.cardAt(g.seed, g.index); }
  function validHot(g) {
    return g && typeof g.seed === 'string' && typeof g.phase === 'string' &&
      g.left != null && g.target != null && g.phase !== 'done';
  }
  function persistLocal() {
    if (!db || !L) return;
    db.put({ id: 'hotseat', game: L, at: nowMs() }).catch(function () {});
  }

  function paintLocal() {
    if (!L) return;
    var card = cardOf(L);
    $('playTitle').textContent = 'Two here';
    paintPips(L.left, L.total);
    $('queue').textContent = '';
    $('pass').hidden = L.phase !== 'pass';
    hideReveal();

    if (L.phase === 'clue') {
      $('play').className = 'play hotseat role-psychic';
      paintSeats(
        { label: 'Psychic', name: 'You', me: true, on: true },
        { label: 'Guesser', name: 'Waiting', me: false, on: false }
      );
      paintSpectrum(card, { target: L.target, aim: true, slide: false });
      showClueWrite();
      setTurn('You are the psychic', 'Look at the 4. Give a clue that lives there.', 'mine');
      setStatus('');
      setChip('ready', 'Psychic');
      setActions([
        { label: 'Give clue', primary: true, fn: localClue },
        { label: 'Skip this card', quiet: true, fn: localRedraw }
      ]);
    } else if (L.phase === 'pass') {
      $('play').className = 'play hotseat';
      paintSeats(
        { label: 'Psychic', me: false, on: false },
        { label: 'Guesser', me: false, on: true }
      );
      paintSpectrum(card, { slide: false });
      hideClue();
      setTurn('Hand it over', 'The guesser takes the device. The mark is hidden.', 'wait');
      setStatus('');
      setChip('wait', 'Pass');
      setActions([]);
    } else if (L.phase === 'guess') {
      $('play').className = 'play hotseat role-guesser';
      paintSeats(
        { label: 'Psychic', me: false, on: false },
        { label: 'Guesser', name: 'You', me: true, on: true }
      );
      paintSpectrum(card, { guess: L.guess, slide: true });
      showClueRead('The clue', L.clue);
      setTurn('You are the guesser', 'Slide the needle to where the clue belongs.', 'mine');
      setStatus('');
      setChip('ready', 'Guesser');
      setActions([{ label: 'Lock the needle', primary: true, fn: localLock }]);
    } else if (L.phase === 'score') {
      $('play').className = 'play hotseat role-guesser';
      paintSeats(
        { label: 'Psychic', me: false, on: false },
        { label: 'Guesser', me: false, on: false }
      );
      paintSpectrum(card, { target: L.target, guess: L.guess, bands: true, slide: false });
      showClueRead('The clue', L.clue);
      showReveal(L.raw, L.last);
      setTurn('The mark', L.raw === 4 ? 'Dead on.' : (L.last ? 'See where you landed.' : 'Outside the zone.'), 'score');
      setStatus('');
      setChip('ready', 'Score');
      setActions([{ label: L.left ? 'Next card' : 'See total', primary: true, fn: localNext }]);
    } else {
      $('play').className = 'play hotseat role-guesser';
      paintSeats(
        { label: 'Psychic', me: false, on: false },
        { label: 'Guesser', me: false, on: false }
      );
      paintSpectrum(card, { target: L.target, guess: L.guess, bands: true, slide: false });
      showClueRead('The clue', L.clue);
      showReveal(L.raw, L.last);
      setTurn('Game complete', 'You scored ' + L.total + '.', 'score');
      setStatus('');
      setChip('ready', 'Done');
      setActions([{ label: 'Play again', primary: true, fn: localAgain }]);
    }
  }

  function localRedraw() {
    if (!L || L.phase !== 'clue') return;
    L.index++;
    L.target = LW.randomTarget();
    L.clue = '';
    $('clueInput').value = '';
    persistLocal();
    paintLocal();
  }
  function localClue() {
    if (!L || L.phase !== 'clue') return;
    var t = ($('clueInput').value || '').replace(/^\s+|\s+$/g, '');
    if (!t) { setStatus('Write a clue first.', 'warn'); return; }
    L.clue = t;
    L.phase = 'pass';
    L.guess = 10;
    persistLocal();
    paintLocal();
  }
  function localLock() {
    if (!L || L.phase !== 'guess') return;
    L.raw = LW.score(L.target, L.guess);
    L.last = LW.coopPoints(L.raw);
    L.total += L.last;
    if (!LW.coopBonus(L.raw)) L.left--;
    L.phase = 'score';
    saveBest(L.total);
    persistLocal();
    paintLocal();
  }
  function localNext() {
    if (!L || L.phase !== 'score') return;
    if (L.left <= 0) { L.phase = 'done'; persistLocal(); paintLocal(); return; }
    L.index++;
    L.target = LW.randomTarget();
    L.clue = '';
    L.guess = 10;
    L.raw = 0;
    L.last = 0;
    L.phase = 'clue';
    $('clueInput').value = '';
    persistLocal();
    paintLocal();
  }
  function localAgain() {
    L = freshLocal();
    $('clueInput').value = '';
    persistLocal();
    paintLocal();
  }

  function enterHotseat(game) {
    mode = 'hotseat';
    $('leaveBtn').hidden = false;
    L = game || freshLocal();
    $('setup').hidden = true;
    $('play').hidden = false;
    if (!game) $('clueInput').value = '';
    paintLocal();
  }
  $('hotseatBtn').onclick = function () { enterHotseat(null); persistLocal(); };
  $('continueBtn').onclick = function () {
    if (!savedHot) return;
    enterHotseat(savedHot);
  };
  $('passOk').onclick = function () {
    if (!L || L.phase !== 'pass') return;
    L.phase = 'guess';
    persistLocal();
    paintLocal();
  };

  // ---- multiplayer ----
  // gifos.room seats two people and passes the turn (turns "order": the moves alternate psychic, guesser,
  // psychic ...). The public board is one record the mover writes with gifos.room.move ('lw-mp'). The mark
  // stays on the psychic's own page (private 'lw' row) until the psychic's page reveals it after the lock.
  // The live needle while the guesser slides is plain shared data ('lw-needle'), not a move.
  var SLIDE_MS = 80;
  var EN = { needsNewer: 'Longwave needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var mpDb = null, needleDb = null;
  try { if (window.gifos) { mpDb = gifos.db('lw-mp'); needleDb = gifos.db('lw-needle'); } } catch (e) {}
  var mp = { on: false, rs: null, joined: false, picked: false, note: '', board: null, needle: null, deal: null, nextFor: -1, revKey: '', myGuess: 10 };
  var slideAt = 0;
  var FRESH = { id: 'board', phase: 'clue', round: 1, seed: 1, cardIndex: 0, clue: '', guess: 10, target: null, psy: -1, raw: 0, last: 0, total: 0, left: LW.TURNS, lost: false };

  function curBoard() { return mp.board || FRESH; }
  function myIdx() { var r = mp.rs; return r && r.me && r.me.seat ? (+r.me.seat) - 1 : -1; }
  function turnIdx() { var r = mp.rs; return r && r.turn ? (+r.turn) - 1 : -1; }
  function seatRow(i) { var r = mp.rs; return r && r.seats ? r.seats[i] : null; }
  function bothHeld() { var a = seatRow(0), b = seatRow(1); return !!(a && a.id && b && b.id); }
  function nameOf(i) { var x = seatRow(i); return x && x.id ? (x.name || 'Player') + (x.here === 'away' ? ' …' : '') : ''; }
  // the psychic of this round: the seat to act while a clue is due, otherwise the one the clue move recorded
  function psyIdx(b) { return b.phase === 'clue' ? turnIdx() : (b.psy | 0); }
  function canAct() {
    var r = mp.rs, b = curBoard();
    if (!ROOM || !r || !r.myTurn || !bothHeld() || b.phase === 'done') return false;
    var o = seatRow(1 - myIdx());
    return !!o && o.here !== 'away';
  }
  function say(e) { mp.note = e && e.message ? e.message : ''; mpRender(); }
  function mpPut(rec, fresh) {
    mp.board = rec; mpRender();
    var p = fresh ? gifos.room.newRound('lw-mp', rec) : gifos.room.move('lw-mp', rec);
    return p.catch(function (e) { mp.board = mp.remote || null; say(e); });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  $('hotseatBtn').addEventListener('click', function () { mp.picked = true; });
  $('continueBtn').addEventListener('click', function () { mp.picked = true; });
  function mpEnter() {
    if (!ROOM) { oldNote(); return; }
    mode = 'mp'; mp.on = true;
    L = null;
    $('setup').hidden = true; $('play').hidden = false; $('pass').hidden = true;
    $('playTitle').textContent = 'Play a friend';
    setChip('wait', 'A friend');
    mpJoin();
    mpRender();
  }
  // opening the game is asking to play, once; the room seats, lines up, or asks the host
  function mpJoin() {
    var r = mp.rs;
    if (ROOM && r && !mp.joined && r.me && r.me.role === 'watcher') { mp.joined = true; gifos.room.join().catch(function () {}); }
  }
  function mpLeave() {
    mp.on = false; mp.picked = true;
    mode = 'setup';
    if (ROOM) { mp.joined = false; gifos.room.leave().catch(function () {}); }
    $('play').hidden = true; $('pass').hidden = true; $('setup').hidden = false;
    setChip('ready', 'Ready');
    refreshContinue();
  }
  $('friendBtn').onclick = function () { mp.picked = true; mpEnter(); };
  $('leaveBtn').onclick = function () {
    if (mode === 'mp') mpLeave();
    else {
      persistLocal();
      L = null; mode = 'setup';
      $('play').hidden = true; $('pass').hidden = true; $('setup').hidden = false;
      setChip('ready', 'Ready');
      refreshContinue();
    }
  };

  if (ROOM) {
    if (mpDb) mpDb.subscribe(function (items) {
      var b = null, i;
      for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'board') b = items[i];
      mp.remote = b; mp.board = b; mp.note = '';
      mpAfter();
    });
    if (needleDb) needleDb.subscribe(function (items) {
      var n = null, i;
      for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'needle') n = items[i];
      mp.needle = n; if (mp.on) mpRender();
    });
    gifos.room.subscribe(function (s) {
      mp.rs = s; mp.note = '';   // a refusal's note goes with the next room state
      // with other people here the shared game is what you see; alone you start on the menu
      if (mode !== 'mp' && !mp.picked && s.live && !$('setup').hidden) { mpEnter(); return; }
      if (mode === 'mp') mpJoin();
      mpAfter();
    });
  } else {
    oldNote();
  }
  function oldNote() { $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false; }
  function mpAfter() { if (mode !== 'mp') return; mpMaybeReveal(); mpRender(); }

  // ---- the psychic's side ----
  // The round the next clue will carry: the board's round, one more after a scored card.
  function nextRound(b) { return b.phase === 'score' ? (b.round | 0) + 1 : (b.round | 0); }
  function ensureDeal(b) {
    var rd = nextRound(b);
    if (!mp.deal || mp.deal.round !== rd) mp.deal = { round: rd, seed: LW.randomSeed(), cardIndex: 0, target: LW.randomTarget() };
    return mp.deal;
  }
  function sendClue(text) {
    var b = curBoard(), d = ensureDeal(b);
    if (!canAct() || (b.phase !== 'clue' && b.phase !== 'score')) return;
    var n = clone(b);
    n.phase = 'guess'; n.round = d.round; n.seed = d.seed; n.cardIndex = d.cardIndex;
    n.clue = text; n.guess = 10; n.target = null; n.psy = myIdx(); n.raw = 0; n.last = 0; n.lost = false;
    mp.myGuess = 10;
    // the mark goes to this page's private row before the move; the room never sees it until the reveal
    var go = function () { mpPut(n); };
    if (db) db.put({ id: 'secret', round: d.round, seed: d.seed, cardIndex: d.cardIndex, target: d.target }).then(go, go);
    else go();
  }
  // after the guesser locks, the psychic's page reveals the mark and scores (the psychic holds the turn)
  function mpMaybeReveal() {
    var b = curBoard();
    if (b.phase !== 'locked' || !canAct() || myIdx() !== (b.psy | 0)) return;
    var key = b.round + ':' + b.cardIndex + ':' + b.guess;
    if (mp.revKey === key) return;
    mp.revKey = key;
    var finish = function (row) {
      var cb = curBoard();
      if (cb.phase !== 'locked' || !canAct()) return;
      var n = clone(cb);
      if (row && row.round === cb.round && row.cardIndex === cb.cardIndex && row.seed === cb.seed) {
        n.target = row.target;
        n.raw = LW.score(row.target, cb.guess);
        n.last = LW.coopPoints(n.raw);
        n.total = (cb.total | 0) + n.last;
        if (!LW.coopBonus(n.raw)) n.left = Math.max(0, (cb.left | 0) - 1);
        n.lost = false;
      } else {
        // this page no longer has the mark (the seat changed hands or the page was cleared): the card is void
        n.target = null; n.raw = 0; n.last = 0; n.lost = true;
      }
      n.phase = (n.left | 0) <= 0 ? 'done' : 'score';
      mpPut(n);
    };
    if (db) db.get('secret').then(finish, function () { finish(null); }); else finish(null);
  }

  function mpSlide(v) {
    var b = curBoard();
    if (!canAct() || b.phase !== 'guess' || myIdx() === (b.psy | 0)) return;
    mp.myGuess = v;
    needleTo(v);
    var t = nowMs();
    if (t - slideAt < SLIDE_MS) return;
    slideAt = t;
    if (needleDb) needleDb.put({ id: 'needle', key: b.round + ':' + b.cardIndex, v: v }).catch(function () {});
  }
  function lockNeedle() {
    var b = curBoard();
    if (!canAct() || b.phase !== 'guess') return;
    var n = clone(b);
    n.phase = 'locked'; n.guess = mp.myGuess | 0;
    mpPut(n);
  }
  function playAgain() {
    if (!ROOM || myIdx() < 0) return;
    var n = clone(FRESH);
    n.seed = LW.randomSeed();
    mp.deal = null;
    mpPut(n, true);
  }
  function sayClue() {
    var t = ($('clueInput').value || '').replace(/^\s+|\s+$/g, '');
    sendClue(t);
  }

  function mpRender() {
    if (mode !== 'mp') return;
    var b = curBoard(), r = mp.rs;
    $('playTitle').textContent = 'Play a friend';
    $('pass').hidden = true;
    hideReveal();
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('leaveBtn').hidden = !!(r && r.live);
    var me = myIdx(), t = turnIdx(), psy = psyIdx(b), gue = psy < 0 ? -1 : 1 - psy;
    var role = me < 0 ? null : (me === psy ? 'psychic' : 'guesser');
    var pName = nameOf(psy) || 'the psychic', gName = nameOf(gue) || 'the guesser';
    paintSeats(
      { label: 'Psychic', name: pName, me: role === 'psychic', on: b.phase === 'clue' || b.phase === 'locked', open: !nameOf(psy) },
      { label: 'Guesser', name: gName, me: role === 'guesser', on: b.phase === 'guess', open: !nameOf(gue) }
    );
    var line = r && r.line ? r.line : [];
    $('queue').textContent = line.length ? ('Watching: ' + line.map(function (p) { return p.name || 'Player'; }).join(', ')) : '';
    paintPips(b.left, b.total || 0);
    var card = LW.cardAt(b.seed, b.cardIndex);
    var key = b.round + ':' + b.cardIndex;
    var actor = canAct();
    var dealing = actor && (b.phase === 'clue' || (b.phase === 'score' && mp.nextFor === b.round));
    var d = dealing ? ensureDeal(b) : null;
    if (d) card = LW.cardAt(d.seed, d.cardIndex);
    if (b.phase === 'clue' && !d) card = LW.cardAt(b.seed, b.cardIndex);
    var revealed = b.phase === 'score' || b.phase === 'done';
    var needleV = (mp.needle && mp.needle.key === key) ? mp.needle.v : 10;
    if (role === 'guesser' && b.phase === 'guess') needleV = mp.myGuess;
    paintSpectrum(card, {
      target: d ? d.target : (revealed ? b.target : null),
      guess: (b.phase === 'guess') ? needleV : ((b.phase === 'locked' || revealed) ? b.guess : null),
      bands: revealed && b.target != null,
      aim: !!d,
      slide: actor && role === 'guesser' && b.phase === 'guess'
    });
    var cr = $('clueRead');
    if (!ROOM) { setStatus(T('needsNewer'), 'warn'); }
    if (!bothHeld()) {
      hideClue(); $('play').className = 'play';
      if (r && r.me && r.me.role === 'asking') setTurn('Waiting for the host', 'The host lets you in.', 'wait');
      else setTurn('Waiting for a friend', 'Press Invite in the bar above the app. The link is the room.', 'wait');
      setStatus(mp.note || (!ROOM ? T('needsNewer') : ''), mp.note ? 'warn' : '');
      setChip('wait', 'A friend'); setActions([]);
      return;
    }
    setStatus(mp.note, mp.note ? 'warn' : '');
    if (!dealing && (b.phase === 'clue' || b.phase === 'score')) {
      // clue due (or a scored card still on screen)
      if (b.phase === 'score') {
        $('play').className = 'play role-guesser';
        showClueRead(nameOf(b.psy | 0) + '\'s clue', b.clue);
        showReveal(b.raw, b.last);
        setTurn(b.lost ? 'Card lost' : 'The mark', b.lost ? 'The mark did not survive. No points either way.' : (b.raw === 4 ? 'Dead on.' : (b.last ? 'See where you landed.' : 'Outside the zone.')), 'score');
        setChip('ready', 'Score');
        saveBest(b.total | 0);
        setActions(actor ? [{ label: 'Next card', primary: true, fn: function () { mp.nextFor = b.round; mpRender(); } }] : []);
      } else {
        $('play').className = 'play';
        hideClue();
        setTurn('Waiting for ' + pName, 'They are looking at the mark and thinking of a clue.', 'wait');
        setChip('wait', role === 'guesser' ? 'Guesser' : 'Watching');
        setActions([]);
      }
    } else if (dealing) {
      if (actor) {
        $('play').className = 'play role-psychic';
        showClueWrite();
        setTurn('You are the psychic', 'Look at the 4. Give a clue that lives there, or say it out loud.', 'mine');
        setChip('ready', 'Psychic');
        setActions([
          { label: 'Give clue', primary: true, fn: sayClue },
          { label: 'Skip this card', quiet: true, fn: function () { var dd = ensureDeal(curBoard()); dd.cardIndex += 1; dd.target = LW.randomTarget(); mpRender(); } }
        ]);
      } else {
        $('play').className = 'play'; hideClue();
        setTurn('Waiting for ' + pName, 'They are looking at the mark and thinking of a clue.', 'wait');
        setChip('wait', role === 'guesser' ? 'Guesser' : 'Watching');
        setActions([]);
      }
    } else if (b.phase === 'guess') {
      showClueRead(pName + '\'s clue', b.clue || '(said out loud)');
      $('play').className = 'play role-guesser';
      if (actor) {
        setTurn('You are the guesser', 'Slide the needle to where the clue belongs.', 'mine');
        setChip('ready', 'Guesser');
        setActions([{ label: 'Lock the needle', primary: true, fn: lockNeedle }]);
      } else {
        setTurn(gName + ' is guessing', 'Watch the needle. Stay quiet about the mark.', 'wait');
        setChip('wait', role === 'psychic' ? 'Psychic' : 'Watching');
        setActions([]);
      }
    } else if (b.phase === 'locked') {
      showClueRead(pName + '\'s clue', b.clue || '(said out loud)');
      $('play').className = 'play role-guesser';
      setTurn('Needle locked', 'Revealing the mark…', 'wait');
      setChip('wait', 'Locked');
      setActions([]);
    } else if (b.phase === 'done') {
      $('play').className = 'play role-guesser';
      showClueRead(pName + '\'s clue', b.clue || '(said out loud)');
      if (!b.lost) showReveal(b.raw, b.last);
      setTurn('Game complete', 'You scored ' + (b.total | 0) + '.', 'score');
      setChip('ready', 'Done');
      saveBest(b.total | 0);
      setActions(me >= 0 ? [{ label: 'Play again', primary: true, fn: playAgain }] : []);
    }
  }

  // Read-only, for the room kit: the shared game only.
  window.__longwave = {
    state: function () {
      var b = mp.remote;
      return b ? { phase: b.phase, round: b.round, clue: b.clue, guess: b.guess, total: b.total, left: b.left, target: b.target } : { phase: 'clue' };
    }
  };

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (mode === 'mp') { if (!(mp.rs && mp.rs.live)) mpLeave(); }
    else if (mode === 'hotseat') $('leaveBtn').click();
  });

  $('clueInput').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (mode === 'hotseat' && L && L.phase === 'clue') localClue();
    else if (mode === 'mp' && canAct() && (curBoard().phase === 'clue' || curBoard().phase === 'score')) sayClue();
  });

  function refreshContinue() {
    var btn = $('continueBtn');
    if (savedHot && validHot(savedHot)) btn.hidden = false;
    else btn.hidden = true;
  }

  setChip('ready', 'Ready');
  showStats();
  if (db) {
    db.get('stats').then(function (st) {
      if (!st) return;
      best = st.best | 0;
      showStats();
    }).catch(function () {});
    db.get('hotseat').then(function (row) {
      if (row && validHot(row.game)) {
        savedHot = row.game;
        refreshContinue();
      }
    }).catch(function () {});
  }
})();
