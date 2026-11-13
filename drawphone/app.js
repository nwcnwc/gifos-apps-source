// Drawphone for meetings. Invite is OS chrome: this file never draws a share button.
// The players are the people with the app open: the meeting's people (or an app
// room's, after Invite). Nobody types a name and nobody presses Join.
//
// Writes (no lost writes: one writer per row):
//   'p:<id>'   each person's own row: heartbeat, name, and one pending act
//              (start a round, a Telephone turn, another word) keyed to the board
//              version it answers, plus this turn's guesses (Draw & guess).
//   'ink:<id>' each person's own drawing: the live pad (Draw & guess) or a sent
//              Telephone drawing.
//   'board'    written ONLY by the host (the lowest live id; putBoard / isHost).
//              Anyone can ask for a round (intent on their own row); the host
//              applies intents and moves the clock. Scores live on the board,
//              so every seat shows the same numbers.
// Finished Telephone rounds live in gifos.db('save') (id: 'archive') — the file is the archive.
(function () {
  'use strict';
  var DP = window.DP, GG = DP.GG;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  };
  var COLORS = ['#111111', '#e85c40', '#3d7ea6', '#3a9a5b', '#e0b03a', '#8b5a2b', '#7b4ea3', '#fffdf6'];
  var SEAT_HUE = ['#e85c40', '#3d7ea6', '#3a9a5b', '#e0b03a', '#7b4ea3', '#3aa8a0'];
  var BEAT = 3000, LIVE = 10000, TICK = 400, INK_MS = 350, REFRESH = 5000, GRACE = 2500;

  // ---- words on screen (five catalogs ride in the GIF: i18n/<lang>.json) ----
  // English rides in the GIF as i18n-en.js too, for a GifOS older than app catalogs.
  function fmtEn(msg, p) {
    p = p || {};
    return String(msg).replace(/\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g, function (m, k, body) {
      var n = +p[k], one = /one \{([^{}]*)\}/.exec(body), other = /other \{([^{}]*)\}/.exec(body);
      return ((n === 1 && one) ? one[1] : (other ? other[1] : '')).replace(/#/g, String(n));
    }).replace(/\{(\w+)\}/g, function (m, k) { return p[k] == null ? m : String(p[k]); });
  }
  function T(k, p) {
    var v = k;
    try { if (window.gifos && gifos.i18n) v = gifos.i18n.t(k, p); } catch (e) {}
    if ((v === k || !v) && window.DP_EN && window.DP_EN[k]) v = fmtEn(window.DP_EN[k], p);
    return v;
  }
  function lang() {
    try { if (window.gifos && gifos.locale) return gifos.locale().language || 'en'; } catch (e) {}
    return (navigator.language || 'en').split('-')[0];
  }
  function applyI18n() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (e) {
      var k = e.getAttribute('data-i18n'), v = T(k);
      if (v && v !== k) e.textContent = v;
    });
    $('wordIn').placeholder = T('chain.placeholder');
    $('guessIn').placeholder = T('gg.placeholder');
  }

  var saveDb = null, db = null;
  try { if (window.gifos) saveDb = gifos.db('save'); } catch (e) {}
  try { if (window.gifos) db = gifos.db('room'); } catch (e) {}

  var me = { id: 'local', name: '' }, since = now();
  var rows = {}, seen = {}, lastTs = {};
  var board = null, boardSeenAt = {}, deadlineV = -1, deadline = 0;
  var myAct = null, myGs = { key: '', list: [] };
  var choice = { game: 'guess', ms: 60000 };
  var ggPad = null, pad = null, inkSig = '', inkKey = '', viewSig = '';
  var lastPaintKey = '';
  var viewChain = 0, revealStep = 0, archive = [], archiveBoard = null, mode = 'room';
  var noteTimer = 0, autoSent = '';

  function setChip(cls, text) {
    $('chip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('chipState').textContent = text;
  }

  // ---- who is here: heartbeats seen moving on THIS page (two clocks that disagree still agree) ----
  function people() {
    var t = now(), out = [], id, r, uid;
    for (id in rows) {
      if (id.indexOf('p:') !== 0) continue;
      r = rows[id]; uid = r.uid;
      if (!uid) continue;
      if (lastTs[uid] !== r.ts) { seen[uid] = (uid in lastTs) ? t : Math.min(t, +r.ts || 0); lastTs[uid] = r.ts; }
      if (uid === me.id || t - (seen[uid] || 0) < LIVE) out.push({ id: uid, name: r.name || '', since: +r.since || 0, row: r });
    }
    if (!out.some(function (p) { return p.id === me.id; })) out.push({ id: me.id, name: me.name, since: since, row: myRow() });
    out.sort(function (a, b) { return (a.since - b.since) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    return out;
  }
  function liveIds(ps) { return (ps || people()).map(function (p) { return p.id; }); }
  function isHost(ps) {
    var ids = liveIds(ps).slice().sort();
    return ids[0] === me.id;
  }
  function nameOf(id) {
    if (id === me.id) return me.name || T('you');
    var r = rows['p:' + id];
    if (r && r.name) return r.name;
    if (board && board.names && board.names[id]) return board.names[id];
    return T('someone');
  }

  // ---- my rows ----
  function myRow() { return { id: 'p:' + me.id, uid: me.id, name: me.name, since: since, ts: now(), act: myAct, gs: myGs }; }
  function beat() {
    if (!db || me.id === 'local') return;
    var r = myRow(); rows[r.id] = r;
    db.put(r).catch(function () {});
  }
  function act(a) { myAct = a; beat(); tick(); }
  function putInk(key, strokes) {
    if (!db) return;
    var r = { id: 'ink:' + me.id, uid: me.id, key: key, s: strokes };
    rows[r.id] = r;
    db.put(r).catch(function () {});
  }
  function putBoard(b) {
    b.host = me.id;
    b.names = b.names || {};
    people().forEach(function (p) { if (p.name) b.names[p.id] = p.name; });
    board = b;
    observeBoard();
    if (db) db.put(b).catch(function () {});
  }

  // The clock: a board says how many ms were left when it was written; each page counts from when it first saw that version.
  function observeBoard() {
    if (!board) return;
    var v = board.v | 0;
    if (deadlineV !== v) {
      deadlineV = v;
      var left = board.game === 'chain' ? board.left : (board.turn ? board.turn.left : 0);
      deadline = left ? now() + left : 0;
    }
  }
  function msLeft() { return deadline ? Math.max(0, deadline - now()) : 0; }

  // ---- the host: apply everyone's intents, keep the clock ----
  var lastRefresh = 0;
  function hostStep(ps) {
    var ids = liveIds(ps), b = board, nb = null, i, p, a;
    // a request to start (from anyone, the host included) answers the board version it saw
    for (i = 0; i < ps.length && !nb; i++) {
      p = ps[i]; a = p.row && p.row.act;
      if (!a || a.kind !== 'start' || (a.v | 0) !== ((b && b.v) | 0)) continue;
      if (b && !(b.phase === 'over' || b.phase === 'results')) continue;
      nb = startRound(a, ps, b);
    }
    if (nb) { putBoard(nb); return; }
    if (!b) return;
    if (b.game === 'guess') nb = hostGuess(b, ps, ids);
    else if (b.game === 'chain') nb = hostChain(b, ps, ids);
    if (nb) { putBoard(nb); return; }
    // a new host takes the board over (the clock as this page counts it); during a turn the host
    // re-states the time left now and then, so a late joiner's clock is right too
    var running = b.phase === 'draw' || b.phase === 'play';
    if (b.host !== me.id || (running && now() - lastRefresh > REFRESH && msLeft() > 1000)) {
      lastRefresh = now();
      nb = JSON.parse(JSON.stringify(b)); nb.v = (nb.v | 0) + 1;
      if (nb.game === 'chain') nb.left = msLeft(); else if (nb.turn) nb.turn.left = msLeft();
      putBoard(nb);
    }
  }
  function startRound(a, ps, prev) {
    var players = ps.map(function (p) { return { id: p.id, name: p.name }; });
    var v = ((prev && prev.v) | 0) + 1;
    if (a.game === 'chain') {
      if (players.length < DP.MIN) return null;
      var t = DP.start(players, { host: me.id });
      t.game = 'chain'; t.v = v; t.ms = GG.DRAW_MS.indexOf(a.ms) >= 0 ? a.ms : 60000;
      t.left = turnMs(t); t.v0 = v;
      if (prev && prev.totals) { t.totals = prev.totals; t.drawn = prev.drawn; t.round = prev.round; }
      return t;
    }
    var gprev = prev && prev.game === 'guess' ? prev : (prev ? { v: prev.v, totals: prev.totals, drawn: prev.drawn, names: prev.names, round: prev.round } : null);
    var g = GG.startRound(gprev, players, { ms: a.ms, host: me.id });
    if (g) g.v = Math.max(g.v, v);
    return g;
  }
  function turnMs(t) { return DP.expectedKind(t) === 'draw' ? (t.ms || 60000) : Math.max(20000, Math.round((t.ms || 60000) / 2)); }

  function hostGuess(b, ps, ids) {
    var nb, i, p, a;
    if (b.phase === 'draw') {
      var key = b.turn.key, gs = {};
      for (i = 0; i < ps.length; i++) {
        p = ps[i];
        if (p.row && p.row.gs && p.row.gs.key === key) gs[p.id] = p.row.gs.list.map(function (x) { return x.t; });
        a = p.row && p.row.act;
        if (a && a.kind === 'reword' && a.key === key && p.id === b.turn.drawer) {
          nb = GG.reword(b);
          if (nb) return nb;
        }
      }
      nb = GG.applyGuesses(b, gs, ids);
      if (nb) return nb;
      if (ids.indexOf(b.turn.drawer) < 0 || msLeft() <= 0 || GG.allIn(b, ids)) return GG.timeUp(b);
      return null;
    }
    if (b.phase === 'reveal' && msLeft() <= 0) return GG.afterReveal(b, ids);
    return null;
  }

  function hostChain(b, ps, ids) {
    if (b.phase !== 'play') return null;
    var intents = {}, i, p, a, ink;
    for (i = 0; i < ps.length; i++) {
      p = ps[i]; a = p.row && p.row.act;
      if (!a || a.seq !== b.seq) continue;
      if (a.kind === 'draw') {
        ink = rows['ink:' + p.id];
        if (!ink || ink.key !== 't' + b.v0 + '.' + b.seq) continue;
        intents[p.id] = { kind: 'draw', seq: b.seq, strokes: ink.s };
      } else if (a.kind === 'word') intents[p.id] = { kind: 'word', seq: b.seq, word: a.word };
    }
    // someone who left, or who ran out of time, is skipped so the chain goes on
    var late = msLeft() <= 0 && deadline && now() - deadline > GRACE;
    DP.actors(b).forEach(function (id) {
      if (!intents[id] && (ids.indexOf(id) < 0 || late)) intents[id] = { skip: true, seq: b.seq };
    });
    var nb = DP.applyIntents(b, intents);
    if (!nb) return null;
    nb.game = 'chain'; nb.v = (b.v | 0) + 1; nb.v0 = b.v0; nb.ms = b.ms;
    nb.left = nb.phase === 'play' ? turnMs(nb) : 0;
    return nb;
  }

  // ---- one loop for everyone ----
  function tick() {
    if (me.id === 'local') return;
    var ps = people();
    observeBoard();
    if (isHost(ps)) hostStep(ps);
    if (board && board.game === 'chain' && !board.v0) board.v0 = board.v; // older board: key ink by its first version
    // my pending act is done once the board moved past what it answered
    if (myAct && myAct.kind === 'start' && board && (board.v | 0) > (myAct.v | 0)) { myAct = null; beat(); }
    if (myAct && board && board.game === 'chain' && myAct.seq != null && myAct.seq !== board.seq) { myAct = null; beat(); }
    if (myAct && myAct.kind === 'reword' && (!board || !board.turn || board.turn.key !== myAct.key)) { myAct = null; beat(); }
    if (board && board.game === 'guess' && board.turn && myGs.key && myGs.key !== board.turn.key) { myGs = { key: '', list: [] }; beat(); }
    pumpInk();
    render(ps);
  }

  // The drawer's pad goes out a few times a second while they draw.
  function pumpInk() {
    if (!board || board.game !== 'guess' || board.phase !== 'draw' || board.turn.drawer !== me.id || !ggPad) return;
    var key = board.turn.key;
    if (inkKey !== key) { inkKey = key; ggPad.clear(); inkSig = ''; putInk(key, []); }
    var s = ggPad.getStrokes();
    if (ggPad._cur) s = s.concat([ggPad._cur]);
    var sig = s.length + ':' + (s.length ? s[s.length - 1].p.length : 0);
    if (sig === inkSig) return;
    var t = now();
    if (pumpInk.at && t - pumpInk.at < INK_MS) return;
    pumpInk.at = t; inkSig = sig;
    putInk(key, DP.capInk(s));
  }

  // ---- render ----
  function hideAll() { $('lobby').hidden = true; $('gg').hidden = true; $('play').hidden = true; }
  function render(ps) {
    if (mode === 'archive') return;
    ps = ps || people();
    if (!board || (board.game !== 'guess' && board.game !== 'chain')) { renderLobby(ps); return; }
    if (board.game === 'guess') renderGuess(ps);
    else renderChain(ps);
  }

  function renderLobby(ps) {
    hideAll(); document.body.className = '';
    $('lobby').hidden = false;
    var n = ps.length;
    $('peopleHead').textContent = T('lobby.people', { n: n });
    $('lobbySeats').innerHTML = ps.map(function (p, i) {
      return '<div class="seat' + (p.id === me.id ? ' me' : '') + '" style="border-color:' + SEAT_HUE[i % SEAT_HUE.length] + '">' + esc(p.id === me.id ? T('you.named', { name: p.name || T('you') }) : (p.name || T('someone'))) + '</div>';
    }).join('');
    $('gameNote').textContent = choice.game === 'guess' ? T('game.guess.note') : T('game.chain.note');
    var can = n >= GG.MIN;
    var asked = myAct && myAct.kind === 'start';
    $('startBtn').disabled = !can || !!asked;
    $('lobbyHint').textContent = !can ? T('lobby.alone') : (asked ? T('lobby.starting') : T('lobby.anyone'));
    setChip('ready', T('chip.here', { n: n }));
    paintArchive();
  }

  function fitSquare(slot, wrap) {
    var w = slot.clientWidth || 0, h = slot.clientHeight || 0;
    var s = Math.floor(Math.min(w, h || w));
    if (s < 140) s = Math.max(140, Math.min(w || 140, 280));
    wrap.style.width = s + 'px'; wrap.style.height = s + 'px';
    return s;
  }

  function ensureGgPad() {
    if (ggPad) return ggPad;
    ggPad = new window.DrawPad($('ggPad'));
    buildColors($('ggColors'), function () { return ggPad; });
    Array.prototype.forEach.call(document.querySelectorAll('#ggTools [data-w]'), function (b) {
      b.onclick = function () {
        ggPad.width = parseInt(b.getAttribute('data-w'), 10);
        Array.prototype.forEach.call(document.querySelectorAll('#ggTools [data-w]'), function (x) { x.classList.toggle('on', x === b); });
      };
    });
    $('ggUndo').onclick = function () { ggPad.undo(); };
    $('ggClear').onclick = function () { ggPad.clear(); };
    return ggPad;
  }
  function buildColors(box, getPad) {
    box.innerHTML = '';
    COLORS.forEach(function (c, i) {
      var sw = document.createElement('button');
      sw.type = 'button'; sw.className = 'swatch' + (i === 0 ? ' on' : '');
      sw.style.background = c; sw.setAttribute('data-c', c);
      sw.setAttribute('aria-label', i === COLORS.length - 1 ? T('pad.eraser') : T('pad.colour'));
      box.appendChild(sw);
    });
    box.addEventListener('click', function (e) {
      var t = e.target.closest('.swatch'); if (!t) return;
      Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('on'); });
      t.classList.add('on'); getPad().color = t.getAttribute('data-c');
    });
  }
  function paintView(strokes) {
    var c = $('ggView'), w = c.clientWidth || 300, dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(w * dpr); }
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    window.paintStrokes(ctx, strokes || [], w, w);
  }

  function renderGuess(ps) {
    var b = board, t = b.turn, ids = liveIds(ps);
    hideAll(); $('gg').hidden = false;
    var playing = b.players.indexOf(me.id) >= 0;
    var drawer = t && t.drawer === me.id;
    document.body.className = 'on-game';
    var over = b.phase === 'over';
    $('ggOver').hidden = !over;
    $('ggSlot').hidden = over; $('ggBar').hidden = over;
    $('ggRound').textContent = over ? T('gg.roundOver', { n: b.round }) : T('gg.round', { n: b.round, i: b.ti + 1, k: b.drawers.length });
    var left = msLeft();
    $('ggClock').textContent = b.phase === 'draw' ? Math.ceil(left / 1000) + ' s' : '';
    $('ggBarFill').style.width = b.phase === 'draw' && b.ms ? Math.round(100 * left / b.ms) + '%' : '0%';
    $('ggBar').classList.toggle('low', b.phase === 'draw' && left < 10000);
    var hits = {}; if (t) t.hits.forEach(function (h) { hits[h.id] = h; });
    if (over) {
      $('ggRole').textContent = ''; $('ggWord').textContent = '';
      $('ggTools').hidden = true; $('ggGuess').hidden = true; $('ggFeed').innerHTML = '';
      $('overTitle').textContent = T('gg.overTitle');
      $('standings').innerHTML = GG.standings(b).filter(function (s) { return b.players.indexOf(s.id) >= 0 || s.total; }).map(function (s, i) {
        return '<li class="' + (s.id === me.id ? 'me' : '') + '"><span class="rk">' + (i + 1) + '</span><span class="nm">' + esc(s.id === me.id ? T('you') : (b.names[s.id] || T('someone'))) + '</span><span class="pt">+' + s.round + '</span><span class="tot">' + T('gg.total', { n: s.total }) + '</span></li>';
      }).join('');
      var asked = myAct && myAct.kind === 'start';
      $('nextRoundBtn').disabled = ps.length < GG.MIN || !!asked;
      $('otherGameBtn').disabled = ps.length < GG.MIN || !!asked;
      setChip('ready', T('chip.here', { n: ps.length }));
      $('ggScores').innerHTML = '';
      return;
    }
    // the word (drawer) or its shape (guessers), and who draws
    var word = t ? DP.wordIn(t.word, lang()) : '';
    if (b.phase === 'reveal') {
      $('ggRole').textContent = T('gg.wasWord');
      $('ggWord').textContent = word;
    } else if (drawer) {
      $('ggRole').textContent = T('gg.youDraw');
      $('ggWord').textContent = word;
    } else {
      $('ggRole').textContent = T('gg.isDrawing', { name: nameOf(t.drawer) });
      $('ggWord').textContent = hits[me.id] ? word : GG.blanks(word);
    }
    // the pad (drawer) or the drawing (everyone else)
    fitSquare($('ggSlot'), $('ggWrap'));
    var drawing = drawer && b.phase === 'draw';
    $('ggPad').hidden = !drawing; $('ggView').hidden = drawing;
    $('ggTools').hidden = !drawing;
    if (drawing) {
      ensureGgPad(); ggPad.enabled = true;
      if (lastPaintKey !== 'pad' + $('ggWrap').style.width) { lastPaintKey = 'pad' + $('ggWrap').style.width; ggPad.resize(); }
      $('rewordBtn').hidden = t.rewords >= 1 || t.hits.length > 0 || (myAct && myAct.kind === 'reword');
    } else {
      var ink = rows['ink:' + t.drawer];
      var strokes = ink && ink.key === t.key ? ink.s : (drawer && ggPad && inkKey === t.key ? ggPad.getStrokes() : []);
      var sig = t.key + ':' + (strokes || []).length + ':' + (strokes && strokes.length ? strokes[strokes.length - 1].p.length : 0) + ':' + $('ggWrap').style.width;
      if (sig !== viewSig) { viewSig = sig; paintView(strokes); }
    }
    // the reveal card over the drawing
    $('ggReveal').hidden = b.phase !== 'reveal';
    if (b.phase === 'reveal') {
      $('ggReveal').innerHTML = '<p class="big">' + esc(word) + '</p>' + (t.hits.length
        ? '<ul>' + t.hits.map(function (h) { return '<li>' + esc(nameOf(h.id)) + ' <b>+' + h.pts + '</b></li>'; }).join('') +
          '<li>' + esc(nameOf(t.drawer)) + ' ' + esc(T('gg.drew')) + ' <b>+' + (t.drawerPts | 0) + '</b></li></ul>'
        : '<p>' + esc(T('gg.nobody')) + '</p>');
    }
    // guessing
    var canGuess = playing && !drawer && b.phase === 'draw' && !hits[me.id];
    $('ggGuess').hidden = !(playing && !drawer && b.phase === 'draw');
    $('guessIn').disabled = !canGuess; $('guessBtn').disabled = !canGuess;
    $('guessIn').placeholder = hits[me.id] ? T('gg.gotIt') : T('gg.placeholder');
    // the feed: wrong guesses as they come, right ones as "got it"
    var lines = [];
    if (t) {
      ps.forEach(function (p) {
        var g = p.row && p.row.gs;
        if (!g || g.key !== t.key || p.id === t.drawer) return;
        g.list.forEach(function (x) { if (!GG.isHit(t.word, x.t)) lines.push({ at: x.at, html: '<b>' + esc(nameOf(p.id)) + '</b> ' + esc(x.t) }); });
      });
      t.hits.forEach(function (h, i) { lines.push({ at: 1e15 + i, html: '<span class="hit">' + esc(T('gg.someoneGot', { name: nameOf(h.id) })) + ' +' + h.pts + '</span>' }); });
    }
    lines.sort(function (x, y) { return x.at - y.at; });
    $('ggFeed').innerHTML = lines.slice(-5).map(function (l) { return '<li>' + l.html + '</li>'; }).join('');
    if (!playing) $('ggFeed').innerHTML += '<li class="sub">' + esc(T('gg.nextRound')) + '</li>';
    // standings strip
    $('ggScores').innerHTML = GG.standings(b).filter(function (s) { return b.players.indexOf(s.id) >= 0; }).map(function (s) {
      return '<span class="sc' + (s.id === me.id ? ' me' : '') + (hits[s.id] ? ' hit' : '') + (t && s.id === t.drawer ? ' dr' : '') + '">' + esc(s.id === me.id ? T('you') : (b.names[s.id] || T('someone'))) + ' <b>' + s.round + '</b></span>';
    }).join('');
    setChip(b.phase === 'draw' ? 'wait' : 'ready', b.phase === 'draw' ? T('chip.drawing') : T('chip.reveal'));
    void ids;
  }

  $('ggGuess').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('guessIn').value.replace(/^\s+|\s+$/g, '').slice(0, 40);
    if (!v || !board || !board.turn || board.phase !== 'draw') return;
    if (myGs.key !== board.turn.key) myGs = { key: board.turn.key, list: [] };
    if (myGs.list.length >= 30) return;
    myGs.list.push({ t: v, at: now() });
    $('guessIn').value = '';
    beat(); tick();
  });
  $('rewordBtn').onclick = function () {
    if (board && board.turn && board.turn.drawer === me.id) act({ kind: 'reword', key: board.turn.key });
  };
  function askStart(game) {
    var b = board;
    act({ kind: 'start', game: game, ms: choice.ms, v: (b && b.v) | 0 });
  }
  $('startBtn').onclick = function () { askStart(choice.game); };
  $('nextRoundBtn').onclick = function () { askStart('guess'); };
  $('otherGameBtn').onclick = function () { askStart('chain'); };
  $('againBtn').onclick = function () { askStart('chain'); };
  $('otherGameBtn2').onclick = function () { askStart('guess'); };
  $('gameSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
    choice.game = b.getAttribute('data-game'); render();
  });
  $('timeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
    choice.ms = parseInt(b.getAttribute('data-ms'), 10);
  });

  // ---------------------------------------------------------------- Telephone ----
  function note(msg) {
    var el = $('playNote');
    el.hidden = !msg; el.textContent = msg || '';
    if (noteTimer) clearTimeout(noteTimer);
    if (msg) noteTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }
  function ensurePad() {
    if (pad) { layoutPad(); return pad; }
    pad = new window.DrawPad($('pad'));
    buildColors($('colors'), function () { return pad; });
    $('undoBtn').onclick = function () { pad.undo(); };
    $('redoBtn').onclick = function () { pad.redo(); };
    $('clearBtn').onclick = function () { pad.clear(); };
    ['w3', 'w7', 'w14'].forEach(function (id) {
      $(id).onclick = function () {
        pad.width = parseInt($(id).getAttribute('data-w'), 10);
        ['w3', 'w7', 'w14'].forEach(function (x) { $(x).classList.toggle('on', x === id); });
      };
    });
    layoutPad();
    return pad;
  }
  function layoutPad() { if ($('drawPane').hidden) return; fitSquare($('padSlot'), $('padWrap')); if (pad) pad.resize(); }
  function paintCanvas(canvas, strokes) {
    var w = canvas.clientWidth || 320, dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr);
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    window.paintStrokes(ctx, strokes || [], w, w);
  }
  function linkWord(L) { return L && L.wi != null && L.wi >= 0 ? DP.wordIn(L.wi, lang()) : (L && L.word) || ''; }
  function chainName(b, id) { return id === me.id ? T('you') : ((b.names && b.names[id]) || nameOf(id)); }

  var chainKey = '';
  function renderChain(ps) {
    var b = board;
    hideAll(); $('play').hidden = false;
    if (b.phase === 'results') { renderResultsScreen(b, ps); return; }
    var inRound = b.order.indexOf(me.id) >= 0;
    var prompt = inRound ? DP.promptFor(b, me.id) : null;
    var sent = !!(myAct && myAct.seq === b.seq);
    var left = msLeft();
    $('playClock').textContent = Math.ceil(left / 1000) + ' s';
    $('playCount').textContent = T('chain.turn', { i: b.turn + 1, k: b.turns });
    $('resultsPane').hidden = true;
    var key = [b.v0, b.seq, sent ? 1 : 0, inRound ? 1 : 0].join('|');
    if (prompt && !sent) {
      // out of time: send what is there (a blank page or an empty guess is skipped by the host)
      if (left <= 1200 && deadline && autoSent !== key) { autoSent = key; if (prompt.kind === 'word') submitWord(true); else submitDraw(true); return; }
      if (chainKey === key) { layoutPad(); return; }
      chainKey = key;
      $('waitPane').hidden = true;
      var last = prompt.last;
      $('fromLine').hidden = true;
      if (prompt.kind === 'word') {
        document.body.className = 'on-guess';
        $('wordPane').hidden = false; $('drawPane').hidden = true;
        if (last && last.type === 'draw') {
          $('playTitle').textContent = T('chain.whatIsThis');
          $('playStatus').textContent = '';
          $('guessArtWrap').hidden = false;
          if (last.by) { $('fromLine').hidden = false; $('fromLine').textContent = T('chain.drewThis', { name: chainName(b, last.by) }); }
          setTimeout(function () { fitSquare($('guessSlot'), $('guessArtWrap')); paintCanvas($('guessArt'), last.skip ? [] : last.strokes); }, 30);
        } else {
          $('playTitle').textContent = T('chain.whatToDraw');
          $('playStatus').textContent = T('chain.wordHint');
          $('guessArtWrap').hidden = true;
        }
        $('wordIn').value = '';
      } else {
        document.body.className = 'on-draw';
        $('drawPane').hidden = false; $('wordPane').hidden = true;
        ensurePad(); pad.clear(); pad.enabled = true;
        $('playTitle').textContent = T('chain.pleaseDraw');
        $('drawPrompt').textContent = last && !last.skip ? linkWord(last) : T('chain.anything');
        if (last && last.by) { $('fromLine').hidden = false; $('fromLine').textContent = T('chain.wroteThat', { name: chainName(b, last.by) }); }
        setTimeout(layoutPad, 30); setTimeout(layoutPad, 180);
      }
      return;
    }
    chainKey = key;
    document.body.className = '';
    $('wordPane').hidden = true; $('drawPane').hidden = true; $('waitPane').hidden = false;
    $('playTitle').textContent = inRound ? T('chain.waiting') : T('chain.watching');
    $('playStatus').textContent = inRound ? '' : T('chain.nextRound');
    var waitIds = DP.actors(b).filter(function (id) {
      var r = rows['p:' + id], a = r && r.act;
      return !(a && a.seq === b.seq) && !(id === me.id && sent);
    });
    $('waitLead').textContent = waitIds.length ? T('chain.stillWaiting', { names: waitIds.map(function (id) { return chainName(b, id); }).join(', ') }) : T('chain.allIn');
    $('waitList').innerHTML = '';
    setChip('wait', T('chip.waiting'));
  }
  function submitWord(auto) {
    var b = board; if (!b || b.game !== 'chain' || b.phase !== 'play') return;
    var w = $('wordIn').value.replace(/^\s+|\s+$/g, '').slice(0, 80);
    if (!w && !auto) { note(T('chain.writeFirst')); return; }
    if (!w) return;
    act({ kind: 'word', seq: b.seq, word: w });
  }
  function submitDraw(auto) {
    var b = board; if (!b || b.game !== 'chain' || b.phase !== 'play') return;
    ensurePad();
    if (pad.blank()) { if (!auto) note(T('chain.drawFirst')); return; }
    putInk('t' + b.v0 + '.' + b.seq, DP.capStrokes(pad.getStrokes()));
    act({ kind: 'draw', seq: b.seq });
  }
  $('wordSend').onclick = function () { submitWord(false); };
  $('wordIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submitWord(false); } });
  $('drawSend').onclick = function () { submitDraw(false); };

  function renderResultsScreen(b, ps) {
    document.body.className = 'on-results';
    $('wordPane').hidden = true; $('drawPane').hidden = true; $('waitPane').hidden = true;
    $('resultsPane').hidden = false;
    $('playTitle').textContent = mode === 'archive' ? T('archive.one') : T('chain.results');
    $('playStatus').textContent = ''; $('playCount').textContent = ''; $('playClock').textContent = '';
    if (mode !== 'archive') rememberRound(b);
    var key = 'res|' + b.v0 + '|' + viewChain + '|' + revealStep + '|' + mode + '|' + (myAct && myAct.kind === 'start' ? 1 : 0) + '|' + (ps ? ps.length : 0);
    if (chainKey === key) return;
    chainKey = key;
    renderResults(b, viewChain, ps);
    setChip('ready', T('chip.results'));
  }
  function renderResults(b, idx, ps) {
    var chains = b.chains || [];
    if (idx < 0 || idx >= chains.length) idx = 0;
    viewChain = idx;
    $('chainNav').innerHTML = chains.map(function (c, i) {
      var first = c.links && c.links[0] ? linkWord(c.links[0]) : '';
      return '<button type="button" class="' + (i === idx ? 'on' : '') + '" data-i="' + i + '">' + esc((i + 1) + '. ' + (first || T('chain.chain'))) + '</button>';
    }).join('');
    var chain = chains[idx], view = $('chainView');
    view.innerHTML = '';
    if (!chain) return;
    $('presentLine').textContent = T('chain.present', { name: chainName(b, chain.owner) });
    var links = chain.links || [], shown = Math.max(0, Math.min(revealStep, links.length)), i, L, step, who;
    for (i = 0; i < shown; i++) {
      L = links[i];
      step = document.createElement('div'); step.className = 'step';
      if (L.seed) who = T('chain.firstWord');
      else if (L.skip) who = T('chain.skipped', { name: chainName(b, L.by) });
      else if (i === 0 && L.type === 'word') who = T('chain.wanted', { name: chainName(b, L.by) });
      else if (L.type === 'draw') who = T('chain.drew', { name: chainName(b, L.by) });
      else who = T('chain.thought', { name: chainName(b, L.by) });
      if (L.type === 'word' || L.skip) {
        step.innerHTML = '<h4>' + esc(who) + '</h4>' + (L.skip ? '' : '<p class="word">' + esc(linkWord(L)) + '</p>');
        view.appendChild(step);
      } else {
        step.innerHTML = '<h4>' + esc(who) + '</h4>';
        var cv = document.createElement('canvas'); cv.width = 400; cv.height = 400;
        step.appendChild(cv); view.appendChild(step); paintCanvas(cv, L.strokes);
      }
    }
    var allIn = shown >= links.length;
    $('wentFrom').hidden = !allIn;
    if (allIn) {
      var first = links[0] ? linkWord(links[0]) : '';
      $('wentFrom').innerHTML = '<h4>' + esc(T('chain.startedWith')) + '</h4><p>' + esc(first || '—') + '</p><h4>' + esc(T('chain.endedWith')) + '</h4><p>' + esc(DP.lastWord(chain) || '—') + '</p>';
    }
    var nxt = $('revealNext');
    if (!allIn) { nxt.hidden = false; nxt.textContent = shown === 0 ? T('chain.showFirst') : (links[shown].type === 'draw' ? T('chain.showDrawing') : T('chain.showGuess')); }
    else if (idx < chains.length - 1) { nxt.hidden = false; nxt.textContent = T('chain.nextChain'); }
    else nxt.hidden = true;
    var live = mode !== 'archive';
    var asked = myAct && myAct.kind === 'start';
    var n = ps ? ps.length : 0;
    $('againBtn').hidden = !live; $('otherGameBtn2').hidden = !live; $('archiveBack').hidden = live;
    $('againBtn').disabled = !!asked || n < DP.MIN; $('otherGameBtn2').disabled = !!asked || n < GG.MIN;
  }
  function currentChainBoard() { return mode === 'archive' ? archiveBoard : board; }
  $('chainNav').addEventListener('click', function (e) {
    var bt = e.target.closest('button'); if (!bt) return;
    viewChain = parseInt(bt.getAttribute('data-i'), 10); revealStep = 0; chainKey = '';
    var b = currentChainBoard(); if (b) renderResultsScreen(b, people());
  });
  $('revealNext').onclick = function () {
    var b = currentChainBoard(); if (!b) return;
    var chain = (b.chains || [])[viewChain], n = chain && chain.links ? chain.links.length : 0;
    if (revealStep < n) revealStep += 1;
    else if (viewChain < (b.chains || []).length - 1) { viewChain += 1; revealStep = 0; }
    chainKey = '';
    renderResultsScreen(b, people());
  };
  $('chainView').addEventListener('click', function () { if (!$('revealNext').hidden) $('revealNext').click(); });

  // ---- archive (Telephone rounds in the file) ----
  function rememberRound(b) {
    if (!b || b.phase !== 'results') return;
    var at = b.startedAt || 0;
    if (archive.some(function (r) { return r.at === at; })) return;
    archive.unshift({ at: at, names: b.names || {}, chains: b.chains || [], wordFirst: !!b.wordFirst, order: b.order || [] });
    if (archive.length > 8) archive = archive.slice(0, 8);
    if (saveDb) saveDb.put({ id: 'archive', rounds: archive }).catch(function () {});
  }
  function paintArchive() {
    var box = $('archiveBox'), list = $('archiveList');
    if (!archive.length) { box.hidden = true; return; }
    box.hidden = false;
    list.innerHTML = archive.map(function (r, i) {
      var bits = (r.chains || []).slice(0, 2).map(function (c) { return (linkWord(c.links && c.links[0]) || '?') + ' → ' + (DP.lastWord(c) || '?'); });
      var when = ''; try { when = new Date(r.at).toLocaleString(lang()); } catch (e) {}
      return '<li><button type="button" class="linkish" data-i="' + i + '">' + esc(bits.join(', ') + ((r.chains || []).length > 2 ? ' …' : '')) + '</button><span class="sub">' + esc(when) + '</span></li>';
    }).join('');
  }
  $('archiveList').addEventListener('click', function (e) {
    var bt = e.target.closest('button'); if (!bt) return;
    var r = archive[parseInt(bt.getAttribute('data-i'), 10)]; if (!r) return;
    archiveBoard = { id: 'board', game: 'chain', phase: 'results', chains: r.chains, names: r.names, order: r.order, startedAt: r.at, v0: -1 };
    mode = 'archive'; viewChain = 0; revealStep = 0; chainKey = '';
    hideAll(); $('play').hidden = false;
    renderResultsScreen(archiveBoard, people());
  });
  $('archiveBack').onclick = function () { mode = 'room'; chainKey = ''; render(); };
  function loadArchive() {
    if (!saveDb) return;
    saveDb.get('archive').then(function (row) { archive = (row && row.rounds) || []; }).catch(function () {});
  }

  // ---- boot: sit down at once ----
  window.addEventListener('resize', function () { lastPaintKey = ''; viewSig = ''; chainKey = ''; layoutPad(); render(); });
  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (mode === 'archive') { mode = 'room'; chainKey = ''; render(); }
  });
  if (window.gifos && gifos.onLocaleChange) gifos.onLocaleChange(function () { applyI18n(); chainKey = ''; viewSig = ''; render(); });
  window.addEventListener('pagehide', function () {
    if (db && me.id !== 'local') { db.delete('p:' + me.id).catch(function () {}); }
  });

  function onRows(items) {
    var next = {}, i, it, nb = null;
    for (i = 0; i < (items || []).length; i++) {
      it = items[i];
      if (!it || !it.id) continue;
      if (it.id === 'board') { nb = it; continue; }
      next[it.id] = it;
    }
    // my own rows: what I wrote last is the truth for me
    if (rows['p:' + me.id]) next['p:' + me.id] = rows['p:' + me.id];
    if (rows['ink:' + me.id]) next['ink:' + me.id] = rows['ink:' + me.id];
    rows = next;
    if (nb && (!board || (nb.v | 0) >= (board.v | 0) || nb.host !== board.host)) {
      if (!board || nb.v !== board.v) { board = nb; observeBoard(); }
    }
    if (!nb && board && board.host !== me.id) board = null;
    tick();
  }

  // Read-only view for tests and support (meet.js appeval): what this page believes.
  window.__drawphone = {
    state: function () {
      var ps = people();
      return { me: me.id, host: isHost(ps), people: ps.map(function (p) { return p.id; }), board: board ? JSON.parse(JSON.stringify(board)) : null,
        msLeft: msLeft(), ink: Object.keys(rows).filter(function (k) { return k.indexOf('ink:') === 0; }).map(function (k) { return { id: rows[k].uid, key: rows[k].key, n: (rows[k].s || []).length }; }) };
    }
  };

  setChip('wait', '…');
  var ready = (window.gifos && gifos.i18n) ? gifos.i18n.load().catch(function () {}) : Promise.resolve();
  ready.then(function () {
    applyI18n();
    $('lobbyHint').textContent = '';
    return window.gifos ? gifos.me() : { id: 'local', name: '' };
  }).then(function (id) {
    me.id = (id && id.id) || 'local'; me.name = (id && id.name) || '';
    if (window.gifos && gifos.onIdentity) gifos.onIdentity(function (x) { if (x && x.name && x.name !== me.name) { me.name = x.name; beat(); } });
    loadArchive();
    if (!db) { setChip('', T('chip.noStorage')); renderLobby(people()); return; }
    db.subscribe(onRows);
    beat();
    setInterval(beat, BEAT);
    setInterval(tick, TICK);
    tick();
  }).catch(function (e) { setChip('', String(e && e.message || e)); });
  // Telling someone to press Invite (in the bar above the app, never a button in here) is in the catalogs: lobby.alone.
})();
