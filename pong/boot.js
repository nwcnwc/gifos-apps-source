/*
 * Pong — GifOS shell around Jake Gordon's canvas Pong.
 *
 * vendor/game.js and vendor/pong.js are the unmodified upstream. Everything
 * GifOS-specific lives here: no PNG menu, Web Audio instead of wav files,
 * touch, juice on the court, and two-device play over gifos.db.
 *
 * MULTIPLAYER (gifos.room). Invite is OS chrome — this app never draws a
 * share button. The seats (Left, Right) come from gifos.room; the line waits.
 * Each seated player writes ONLY their own paddle row, and only while the
 * paddle moves. The app's owner (gifos.info().owner) simulates the ball and
 * writes the 'world' row; the other copy paints it. When the owner leaves,
 * GifOS hands the app to the next copy, which takes over the simulation. An
 * empty seat is played by the CPU. Rows are written only when something changes.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 20;
  var OWNER_POLL = 2;   // seconds of game loop between local info() reads (no network)
  var EN = { needsNewer: 'Pong needs a newer GifOS to play together. Reload the page to update.' };
  var KEY = Game.KEY;
  var W = 87, S = 83;

  var COARSE = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
  var NARROW = Math.min(root.innerWidth || 0, root.innerHeight || 0) <= 520;
  var IS_TOUCH = ((navigator.maxTouchPoints || 0) > 0 && COARSE) ||
    ((navigator.maxTouchPoints || 0) > 0 && NARROW);

  var api = root.gifos || null;
  var ROOM = !!(api && api.room && api.room.subscribe);
  var me = { id: 'local', name: 'You' };
  var owner = true;
  var rs = null, joined = false, ownerAcc = 0, goN = 0, lastWrote = null, wasPlaying = false, moved = false;
  var rows = {};          // paddle rows by person id (only seated people count)
  var lastGo = {};
  var world = null, worldAt = 0;
  var opponent = null;
  var hadOpponent = false;
  var acc = 0;
  var pong = null;
  var actx = null;
  var soundOn = true;
  var dragging = false;
  var dragPaddle = null;
  var lastDragY = null;
  var netReady = !ROOM;
  var wins = 0;
  var lastDx = 0;
  var lastScores = [0, 0];
  var juice = { hit: null, t: 0, goal: 0, trail: [] };

  var court = document.getElementById('court');
  var canvas = document.getElementById('game');
  var leftName = document.getElementById('leftName');
  var rightName = document.getElementById('rightName');
  var hint = document.getElementById('hint');
  var note = document.getElementById('note');
  var soundBtn = document.getElementById('soundBtn');
  var pads = document.getElementById('pads');
  var bestEl = document.getElementById('best');

  if (IS_TOUCH) document.body.classList.add('touch');

  function clamp(n, a, b) { return n < a ? a : n > b ? b : n; }
  function db(n) { return api && api.db ? api.db(n) : null; }
  function now() { return Date.now(); }
  function isMp() { return !!opponent; }
  // My side: 0 left, 1 right, -1 not seated (watching or in line). Local play (no room yet) is always left.
  function mySide() {
    if (!ROOM || !rs || !rs.me) return 0;
    for (var i = 0; i < 2; i++) if (rs.seats[i] && rs.seats[i].id && rs.seats[i].id === rs.me.id) return i;
    return -1;
  }
  function spectating() { return ROOM && !!rs && mySide() < 0; }
  function myPaddle() { return mySide() === 1 ? pong.rightPaddle : pong.leftPaddle; }
  function otherPaddle() { return mySide() === 1 ? pong.leftPaddle : pong.rightPaddle; }
  // The CPU stands in only on the simulating copy; it plays the side nobody holds.
  function armCpu(g) {
    var o = mySide() === 1 ? g.leftPaddle : g.rightPaddle;
    o.setAuto(true, g.level(1));
    (o === g.leftPaddle ? g.rightPaddle : g.leftPaddle).setAuto(false);
  }

  /* ------------------------------------------------------------------ */
  /* sounds — original loads wav files we do not ship; square-wave beeps */
  /* ------------------------------------------------------------------ */

  function resumeAudio() {
    try {
      if (!actx) {
        var AC = root.AudioContext || root.webkitAudioContext;
        if (AC) actx = new AC();
      }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }

  function beep(freq, dur, vol) {
    if (!actx || !soundOn) return;
    try {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.07, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (e) {}
  }

  function markHit(side) {
    juice.hit = side;
    juice.t = now();
  }

  Pong.Sounds.initialize = function (g) { this.game = g; };
  Pong.Sounds.play = function (name) {
    if (!this.game.cfg.sound) return;
    resumeAudio();
    if (name === 'ping') { beep(880, 0.07); markHit('L'); }
    else if (name === 'pong') { beep(440, 0.07); markHit('R'); }
    else if (name === 'wall') beep(220, 0.05);
    else if (name === 'goal') {
      juice.goal = now();
      beep(330, 0.1, 0.09);
      setTimeout(function () { beep(196, 0.16, 0.09); }, 90);
      setTimeout(function () { beep(130, 0.22, 0.07); }, 200);
    }
  };
  Pong.Sounds.ping = function () { this.play('ping'); };
  Pong.Sounds.pong = function () { this.play('pong'); };
  Pong.Sounds.wall = function () { this.play('wall'); };
  Pong.Sounds.goal = function () { this.play('goal'); };

  /* ------------------------------------------------------------------ */
  /* menu — original draws press1.png / press2.png / winner.png          */
  /* ------------------------------------------------------------------ */

  Pong.Images = [];
  Pong.Menu.initialize = function (g) { this.pong = g; this.winner = null; };
  Pong.Menu.declareWinner = function (playerNo) { this.winner = playerNo; };
  Pong.Menu.draw = function (ctx) {
    var g = this.pong;
    var cy = g.height * 0.62;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    function plate(x, y, w, h) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }
    if (this.winner === 0 || this.winner === 1) {
      var wx = this.winner === 0 ? g.width * 0.25 : g.width * 0.75;
      plate(wx, cy, 200, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px monospace';
      ctx.fillText('WINNER', wx, cy);
    } else {
      plate(g.width / 2, cy, 300, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('TAP TO PLAY', g.width / 2, cy);
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------------ */
  /* start the original game                                             */
  /* ------------------------------------------------------------------ */

  pong = Game.start('game', Pong, {
    sound: true,
    stats: false,
    footprints: false,
    predictions: false
  });
  if (!pong) return;

  var origUpdate = pong.update;
  var origDraw = pong.draw;
  var origGoal = pong.goal;

  pong.goal = function (playerNo) {
    origGoal.call(this, playerNo);
    if (!isMp() && playerNo === 0 && this.menu && this.menu.winner === 0) {
      wins += 1;
      saveRecord();
      setBest();
    }
  };

  pong.update = function (dt) {
    pollOwner(dt);
    if (spectating()) watchUpdate(this);
    else if (isMp() && !owner) guestUpdate(this, dt);
    else {
      if (isMp() && owner && opponent && opponent.y != null) {
        var o = otherPaddle();
        o.setAuto(false);
        o.setdir(0);
        o.setpos(o.x, clamp(opponent.y, o.minY, o.maxY));
      }
      origUpdate.call(this, dt);
    }
    if (this.playing) {
      juice.trail.push({ x: this.ball.x, y: this.ball.y, r: this.ball.radius });
      if (juice.trail.length > 10) juice.trail.shift();
    } else {
      juice.trail.length = 0;
    }
    publish(this, dt);
  };

  pong.draw = function (ctx) {
    paintTrail(ctx);
    origDraw.call(this, ctx);
    paintJuice(ctx, this);
  };

  pong.onkeydown = function (code) {
    resumeAudio();
    if (spectating()) return;
    if (!this.playing) {
      if (code === KEY.ONE || code === KEY.SPACE || code === KEY.RETURN) {
        startPlay();
        return;
      }
      if (localOnly() && code === KEY.TWO) { this.startDoublePlayer(); setHint(); setNames(); return; }
      if (localOnly() && code === KEY.ZERO) { this.startDemo(); setHint(); setNames(); return; }
    }
    if (code === KEY.ESC) { this.stop(false); setHint(); setNames(); return; }
    steer(this, code, true);
  };

  pong.onkeyup = function (code) {
    steer(this, code, false);
  };

  // Two people on one device (P/L keys): only when nobody shares the game.
  function localOnly() { return !isMp() && owner && mySide() === 0 && !(rs && rs.live); }

  function steer(g, code, down) {
    moved = true;
    var left = mySide() !== 1;
    var fn;
    if (left) {
      if (!g.leftPaddle.auto) {
        if (code === KEY.Q || code === KEY.UP || code === W) fn = down ? 'moveUp' : 'stopMovingUp';
        else if (code === KEY.A || code === KEY.DOWN || code === S) fn = down ? 'moveDown' : 'stopMovingDown';
        if (fn) g.leftPaddle[fn]();
      }
      if (localOnly() && !g.rightPaddle.auto) {
        if (down) {
          if (code === KEY.P) g.rightPaddle.moveUp();
          else if (code === KEY.L) g.rightPaddle.moveDown();
        } else {
          if (code === KEY.P) g.rightPaddle.stopMovingUp();
          else if (code === KEY.L) g.rightPaddle.stopMovingDown();
        }
      }
    } else if (!g.rightPaddle.auto) {
      if (code === KEY.P || code === KEY.Q || code === KEY.UP || code === W) fn = down ? 'moveUp' : 'stopMovingUp';
      else if (code === KEY.L || code === KEY.A || code === KEY.DOWN || code === S) fn = down ? 'moveDown' : 'stopMovingDown';
      if (fn) g.rightPaddle[fn]();
    }
  }

  function startPlay() {
    if (pong.playing || spectating()) return;
    if (isMp() && !owner) { goN += 1; putPaddle(true); return; }   // the owner serves: ask with a counter on my own row
    if (isMp()) pong.startDoublePlayer();
    else { pong.startSinglePlayer(); if (mySide() === 1) armCpu(pong); }
    pong.menu.winner = null;
    lastDx = pong.ball.dx;
    lastScores = [0, 0];
    juice.trail.length = 0;
    setHint();
    setNames();
  }

  /* ------------------------------------------------------------------ */
  /* juice — trail, paddle punch, goal flash. Court stays the original.  */
  /* ------------------------------------------------------------------ */

  function paintTrail(ctx) {
    var n = juice.trail.length;
    if (n < 2) return;
    for (var i = 0; i < n - 1; i++) {
      var p = juice.trail[i];
      var a = (i / n) * 0.28;
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
  }

  function paintJuice(ctx, g) {
    var t = now();
    if (juice.hit && t - juice.t < 140) {
      var pad = juice.hit === 'L' ? g.leftPaddle : g.rightPaddle;
      var a = 1 - (t - juice.t) / 140;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * a).toFixed(3) + ')';
      ctx.fillRect(pad.x - 3, pad.y - 3, pad.width + 6, pad.height + 6);
    }
    if (juice.goal && t - juice.goal < 280) {
      var ga = 1 - (t - juice.goal) / 280;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.18 * ga).toFixed(3) + ')';
      ctx.fillRect(0, 0, g.width, g.height);
    }
  }

  /* ------------------------------------------------------------------ */
  /* guest: paint host ball, move own paddle, never simulate a goal      */
  /* ------------------------------------------------------------------ */

  function paintWorld(g) {
    var w = world;
    if (!w) return;
    if (w.bx != null) {
      var age = Math.max(0, Math.min(0.12, (now() - worldAt) / 1000));
      g.ball.setpos(w.bx + (w.bdx || 0) * age, w.by + (w.bdy || 0) * age);
      g.ball.setdir(w.bdx || 0, w.bdy || 0);
    }
    if (w.sl != null) g.scores[0] = w.sl;
    if (w.sr != null) g.scores[1] = w.sr;
    if (g.ball.dx && lastDx && g.ball.dx * lastDx < 0) {
      markHit(g.ball.dx > 0 ? 'L' : 'R');
      resumeAudio();
      beep(g.ball.dx > 0 ? 880 : 440, 0.07);
    }
    if ((g.scores[0] !== lastScores[0] || g.scores[1] !== lastScores[1]) && (g.scores[0] + g.scores[1]) > (lastScores[0] + lastScores[1])) {
      juice.goal = now();
      resumeAudio();
      beep(330, 0.1, 0.09);
      setTimeout(function () { beep(196, 0.16, 0.09); }, 90);
    }
    lastDx = g.ball.dx;
    lastScores = [g.scores[0], g.scores[1]];
    if (w.playing) {
      if (!g.playing) {
        g.playing = true;
        g.menu.winner = null;
        g.runner.hideCursor();
      }
    } else if (g.playing) {
      if (w.win === 0 || w.win === 1) g.menu.declareWinner(w.win);
      g.playing = false;
      g.runner.showCursor();
    }
  }

  function guestUpdate(g, dt) {
    myPaddle().update(dt, g.ball);
    if (opponent && opponent.y != null) {
      var o = otherPaddle();
      o.setAuto(false);
      o.setdir(0);
      o.setpos(o.x, clamp(opponent.y, o.minY, o.maxY));
    }
    paintWorld(g);
  }

  // Not seated: paint both paddles from their rows and the ball from the world row.
  function watchUpdate(g) {
    var ps = [g.leftPaddle, g.rightPaddle];
    for (var i = 0; i < 2; i++) {
      var st = rs.seats[i], r = st && st.id ? rows[st.id] : null;
      if (r && r.y != null) {
        ps[i].setAuto(false);
        ps[i].setdir(0);
        ps[i].setpos(ps[i].x, clamp(r.y, ps[i].minY, ps[i].maxY));
      }
    }
    paintWorld(g);
  }

  /* ------------------------------------------------------------------ */
  /* net — gifos.room seats; each seated player owns one paddle row;      */
  /* the app's owner simulates and owns the 'world' row                   */
  /* ------------------------------------------------------------------ */

  // The one other seated person who is here, with their paddle row.
  function findOpponent() {
    var sd = mySide();
    if (!ROOM || !rs || sd < 0) return null;
    var st = rs.seats[1 - sd];
    if (!st || !st.id || st.here !== 'here') return null;
    var r = rows[st.id] || {};
    return { id: st.id, name: st.name || 'Friend', y: r.y != null ? r.y : null, go: r.go | 0 };
  }

  function refresh() {
    opponent = findOpponent();
    if (opponent && owner && pong && !pong.playing && lastGo[opponent.id] != null && opponent.go !== lastGo[opponent.id]) {
      lastGo[opponent.id] = opponent.go;
      startPlay();   // the other seat asked to serve
    }
    if (opponent) lastGo[opponent.id] = opponent.go;
    maybeSwitchMode();
  }

  function ingestPaddles(list) {
    rows = {};
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      rows[p.id] = { y: p.y, go: p.go | 0 };
    }
    // Only seated people count: a row whose id holds no seat is ignored (see findOpponent / watchUpdate).
    refresh();
  }

  function ingestWorld(list) {
    var w = null;
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'world') w = list[i];
    if (w && (!world || w.n !== world.n)) worldAt = now();
    world = w;
  }

  function maybeSwitchMode() {
    if (!pong) return;
    var want = isMp();
    if (want && !hadOpponent) {
      hadOpponent = true;
      if (owner) {
        pong.scores = [0, 0];
        pong.menu.winner = null;
        if (pong.playing) {
          pong.leftPaddle.setAuto(false);
          pong.rightPaddle.setAuto(false);
          pong.ball.reset();
        }
      }
    } else if (!want && hadOpponent) {
      hadOpponent = false;
      if (owner && pong.playing) armCpu(pong);   // an empty seat: the CPU stands in
    }
    setNames();
    setHint();
    layoutPads();
  }

  // My paddle row: only while I am seated with somebody to play, only when it changed (or to ask for a serve).
  function putPaddle(force) {
    var paddles = db('paddles');
    if (!netReady || !paddles || !rs || !rs.me || mySide() < 0 || !isMp()) return;
    var y = Math.round(myPaddle().y);
    var sig = y + ':' + goN;
    if (!force && (!moved || sig === lastWrote)) return;
    lastWrote = sig;
    paddles.put({ id: rs.me.id, y: y, go: goN }).catch(function () {});
  }

  var worldN = 0;
  function publish(g, dt) {
    if (!netReady || !isMp()) return;
    acc += dt;
    if (acc < 1 / PUBLISH_HZ) return;
    acc = 0;
    putPaddle(false);
    if (!owner) return;
    var worlds = db('world');
    if (!worlds) return;
    var w = {
      id: 'world',
      bx: Math.round(g.ball.x * 10) / 10,
      by: Math.round(g.ball.y * 10) / 10,
      bdx: Math.round(g.ball.dx),
      bdy: Math.round(g.ball.dy),
      sl: g.scores[0],
      sr: g.scores[1],
      playing: g.playing ? 1 : 0,
      win: (g.menu && (g.menu.winner === 0 || g.menu.winner === 1)) ? g.menu.winner : null
    };
    // While the ball moves it is a new row every tick; a game that just stopped is written once; idle writes nothing.
    if (g.playing) wasPlaying = true;
    else if (wasPlaying) wasPlaying = false;
    else return;
    w.n = ++worldN;
    worlds.put(w).catch(function () {});
  }

  // Who owns the app can change (the owner leaves, GifOS hands it on): a local read, no network.
  function pollOwner(dt) {
    if (!ROOM || !api.info) return;
    ownerAcc += dt;
    if (ownerAcc < OWNER_POLL) return;
    ownerAcc = 0;
    readOwner();
  }
  function readOwner() {
    api.info().then(function (i) {
      var o = !!(i && i.owner);
      if (o !== owner) { owner = o; refresh(); }
    }).catch(function () {});
  }

  function onRoom(s) {
    rs = s;
    if (s && s.me) { me.id = s.me.id; me.name = s.me.name || 'You'; }
    // Opening the game is asking to play, once; the room seats me, lines me up, or asks the host.
    if (!joined && s && s.me && s.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    readOwner();
    refresh();
  }

  function bootNet() {
    if (!ROOM) { note.textContent = EN.needsNewer; note.hidden = false; return; }
    var ready = api.info ? api.info().then(function (i) { owner = !!(i && i.owner); }).catch(function () {}) : Promise.resolve();
    ready.then(function () {
      netReady = true;
      db('paddles').subscribe(ingestPaddles);
      db('world').subscribe(ingestWorld);
      gifos.room.subscribe(onRoom);
      setNames();
      layoutPads();
    });
  }

  /* ------------------------------------------------------------------ */
  /* touch: drag the court; paddle follows and carries english           */
  /* ------------------------------------------------------------------ */

  function canvasPos(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (canvas.width / r.width),
      y: (ev.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function paddleForPointer(pos) {
    var half = pong.width / 2;
    if (isMp() || mySide() === 1) return myPaddle();
    if (pong.rightPaddle && !pong.rightPaddle.auto) {
      return pos.x < half ? pong.leftPaddle : pong.rightPaddle;
    }
    return pong.leftPaddle;
  }

  function pointerToPaddle(ev) {
    if (!pong || spectating()) return;
    var pos = canvasPos(ev);
    moved = true;
    var paddle = dragPaddle || paddleForPointer(pos);
    if (isMp()) {
      if (mySide() === 0 && pos.x > pong.width / 2 && !dragPaddle) return;
      if (mySide() === 1 && pos.x < pong.width / 2 && !dragPaddle) return;
    }
    var y = pos.y - paddle.height / 2;
    var prev = paddle.y;
    paddle.setpos(paddle.x, clamp(y, paddle.minY, paddle.maxY));
    var dy = paddle.y - prev;
    if (dy < -0.8) { paddle.up = 1; paddle.down = 0; }
    else if (dy > 0.8) { paddle.up = 0; paddle.down = 1; }
    else { paddle.setdir(0); }
    lastDragY = paddle.y;
    dragPaddle = paddle;
  }

  hint.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    resumeAudio();
    startPlay();
  });

  function kickoff() {
    resumeAudio();
    if (!pong.playing) startPlay();
  }
  court.addEventListener('click', kickoff);
  court.addEventListener('touchstart', function (ev) {
    kickoff();
    if (ev.touches && ev.touches[0]) {
      dragging = true;
      dragPaddle = null;
      pointerToPaddle(ev.touches[0]);
    }
    ev.preventDefault();
  }, { passive: false });
  court.addEventListener('pointerdown', function (ev) {
    kickoff();
    dragging = true;
    dragPaddle = null;
    try { court.setPointerCapture(ev.pointerId); } catch (e) {}
    pointerToPaddle(ev);
    ev.preventDefault();
  }, { passive: false });

  court.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    pointerToPaddle(ev);
    ev.preventDefault();
  }, { passive: false });

  function endDrag(ev) {
    dragging = false;
    if (dragPaddle) dragPaddle.setdir(0);
    dragPaddle = null;
    try { court.releasePointerCapture(ev.pointerId); } catch (e) {}
  }
  court.addEventListener('pointerup', endDrag);
  court.addEventListener('pointercancel', endDrag);

  function bindPad(btn) {
    var dir = btn.getAttribute('data-dir');
    function go() {
      resumeAudio();
      if (spectating()) return;
      moved = true;
      if (!pong.playing) startPlay();
      var paddle = myPaddle();
      if (dir === 'up') paddle.moveUp();
      else paddle.moveDown();
    }
    function stop() {
      var paddle = myPaddle();
      if (dir === 'up') paddle.stopMovingUp();
      else paddle.stopMovingDown();
    }
    btn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
      go();
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
  }
  var padBtns = pads.querySelectorAll('button');
  for (var i = 0; i < padBtns.length; i++) bindPad(padBtns[i]);

  function layoutPads() {
    if (!IS_TOUCH) { pads.hidden = true; return; }
    pads.hidden = false;
    for (var k = 0; k < padBtns.length; k++) padBtns[k].disabled = spectating();
  }

  /* ------------------------------------------------------------------ */
  /* chrome                                                              */
  /* ------------------------------------------------------------------ */

  function seatName(i) {
    var st = rs && rs.seats && rs.seats[i];
    if (st && st.id) return rs.me && st.id === rs.me.id ? (me.name || 'You') : (st.name || 'Friend');
    return null;
  }

  function setNames() {
    if (!ROOM || !rs) {
      leftName.textContent = me.name || 'You';
      rightName.textContent = pong && pong.playing && pong.rightPaddle && !pong.rightPaddle.auto ? 'P2' : 'CPU';
      return;
    }
    // An empty seat is the CPU on the copy that simulates; otherwise it is open.
    var empty = owner && !spectating() ? 'CPU' : 'Open';
    leftName.textContent = seatName(0) || empty;
    rightName.textContent = seatName(1) || empty;
  }

  function setHint() {
    if (!pong) return;
    if (ROOM && rs && rs.me && rs.me.role === 'waiting') hint.textContent = 'You are next in line';
    else if (ROOM && rs && rs.me && rs.me.role === 'asking') hint.textContent = 'Waiting for the host to seat you';
    else if (spectating()) hint.textContent = 'Watching';
    else if (isMp()) {
      hint.textContent = pong.playing ? (mySide() === 1 ? 'You are right · drag your paddle' : 'You are left · drag your paddle')
        : (owner ? 'Tap to serve' : 'Tap to ask ' + (opponent.name || 'the host') + ' to serve');
    } else if (pong.playing) {
      hint.textContent = IS_TOUCH ? 'Drag to move · first to 9' : 'Q/A left  ·  P/L right  ·  Esc to quit';
    } else {
      hint.textContent = IS_TOUCH ? 'Tap to play · drag your paddle' : 'Press 1 or tap  ·  Q/A left  ·  P/L right';
    }
  }

  function setBest() {
    bestEl.textContent = wins > 0 ? (wins === 1 ? '1 win' : wins + ' wins') : '';
  }

  function saveRecord() {
    var prefs = db('prefs');
    if (prefs) prefs.put({ id: 'record', wins: wins, on: soundOn }).catch(function () {});
  }

  function setSound(on) {
    soundOn = !!on;
    if (pong) pong.enableSound(soundOn);
    soundBtn.classList.toggle('off', !soundOn);
    soundBtn.textContent = soundOn ? '♪' : '×';
    var prefs = db('prefs');
    if (prefs) prefs.put({ id: 'sound', on: soundOn }).catch(function () {});
  }
  soundBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    setSound(!soundOn);
  });

  var prefs = db('prefs');
  if (prefs && prefs.get) {
    Promise.resolve(prefs.get('sound')).then(function (r) {
      if (r && r.on === false) setSound(false);
    }).catch(function () {});
    Promise.resolve(prefs.get('record')).then(function (r) {
      if (r && typeof r.wins === 'number' && r.wins > 0) {
        wins = r.wins | 0;
        setBest();
      }
    }).catch(function () {});
  }

  // Low-rate shared state only (who is seated, the score) so copies can be compared.
  root.__pong = {
    state: function () {
      return {
        seats: rs ? rs.seats.map(function (x) { return x.id || null; }) : [],
        score: world ? [world.sl | 0, world.sr | 0] : [0, 0]
      };
    }
  };

  layoutPads();
  setNames();
  setHint();
  setBest();
  bootNet();
})(window);
