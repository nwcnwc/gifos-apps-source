/*
 * Pool — GifOS shell around henshmi's Classic Pool Game.
 *
 * vendor/* is the unmodified upstream (physics, 8-ball rules, stick, AI).
 * Everything GifOS-specific lives here: HTML menu, Web Audio, touch pull-back
 * aim with a ghost ball, a portrait table that fills the phone, and two-device
 * turns over gifos.db.
 *
 * MULTIPLAYER (gifos.room). Invite is OS chrome — this app never draws a
 * share button. The seats (Player 1, Player 2) come from gifos.room; the line
 * waits. Turns are 'free' in the room because a pool turn is decided by the
 * physics (potting keeps the turn, a foul gives ball in hand), which only the
 * simulation knows: the table row carries whose turn it is. The app's owner
 * (gifos.info().owner) simulates the balls and writes the 'table' row when it
 * changes. The other seat writes only its own row in 'shots', and only when it
 * shoots (or places the white after a foul); the owner applies it and deletes
 * it. When the owner leaves, GifOS hands the app to the next copy, which takes
 * the simulation over. Rows are written only when something changes.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 20;
  var OWNER_POLL = 2000;   // ms between local info() reads, taken inside the frame loop (no network)
  var EN = { needsNewer: 'Pool needs a newer GifOS to play together. Reload the page to update.' };
  var PULL_DEAD = 28;
  var PULL_SCALE = 3.6;
  var MIN_SHOT = 7;

  var COARSE = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
  var NARROW = Math.min(root.innerWidth || 0, root.innerHeight || 0) <= 520;
  var IS_TOUCH = ((navigator.maxTouchPoints || 0) > 0 && COARSE) ||
    ((navigator.maxTouchPoints || 0) > 0 && NARROW);

  var api = root.gifos || null;
  var ROOM = !!(api && api.room && api.room.subscribe);
  var me = { id: 'local', name: 'You' };
  var owner = true;
  var rs = null, joined = false, ownerAt = 0, lastTableSig = null, tableN = 0, shotCount = 0, lastWrote = '';
  var rows = {};          // 'shots' rows by person id (only the seated opponent's counts)
  var world = null;       // the owner's 'table' row
  var opponent = null;
  var hadOpponent = false;
  var acc = 0;
  var netReady = !ROOM;
  var soundOn = true;
  var actx = null;
  var pulling = false;
  var placing = false;
  var held = false;
  var aimed = false;
  var loopGen = 0;
  var localLock = false;
  var pendingShot = null;
  var pendingPlace = null;
  var menuOn = true;
  var bannerTimer = 0;

  var menu = document.getElementById('menu');
  var hint = document.getElementById('hint');
  var names0 = document.getElementById('name0');
  var names1 = document.getElementById('name1');
  var p0 = document.getElementById('p0');
  var p1 = document.getElementById('p1');
  var chip0 = document.getElementById('chip0');
  var chip1 = document.getElementById('chip1');
  var sc0 = document.getElementById('sc0');
  var sc1 = document.getElementById('sc1');
  var soundBtn = document.getElementById('soundBtn');
  var powerBar = document.getElementById('power');
  var powerFill = document.getElementById('powerFill');
  var diff = document.getElementById('diff');
  var menuStatus = document.getElementById('menuStatus');
  var bannerEl = document.getElementById('banner');

  if (IS_TOUCH) document.body.classList.add('touch');

  function clamp(n, a, b) { return n < a ? a : n > b ? b : n; }
  function db(n) { return api && api.db ? api.db(n) : null; }
  function now() { return Date.now(); }
  // My seat: 0 or 1, -1 when I only watch or wait. Local play (no room yet) is seat 0.
  function mySide() {
    if (!ROOM || !rs || !rs.me) return 0;
    for (var i = 0; i < 2; i++) if (rs.seats[i] && rs.seats[i].id && rs.seats[i].id === rs.me.id) return i;
    return -1;
  }
  function watching() { return ROOM && !!rs && mySide() < 0 && !!(rs.seats[0].id && rs.seats[1].id); }
  function isMp() { return !!opponent || watching(); }
  // This copy paints the owner's table instead of simulating (not the owner, or not seated).
  function guestPath() { return isMp() && (!owner || mySide() < 0); }
  function myTurn() {
    if (!Game.policy) return true;
    if (!isMp()) return !AI_ON || Game.policy.turn !== AI_PLAYER_NUM;
    return Game.policy.turn === mySide();
  }
  function isPortrait() {
    return (window.innerHeight || 0) > (window.innerWidth || 0) + 24;
  }

  /* ------------------------------------------------------------------ */
  /* sounds — original loads wav/mp3 we do not ship; short Web Audio     */
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

  function tone(freq, dur, type, vol) {
    if (!actx || !soundOn) return;
    try {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (e) {}
  }

  function playKind(kind, vol) {
    resumeAudio();
    vol = vol == null ? 1 : vol;
    if (kind === 'strike') tone(90, 0.12, 'sine', 0.12 * vol);
    else if (kind === 'collide') tone(420, 0.05, 'triangle', 0.07 * vol);
    else if (kind === 'hole') { tone(220, 0.18, 'sine', 0.1 * vol); setTimeout(function () { tone(140, 0.22, 'sine', 0.08 * vol); }, 80); }
    else if (kind === 'side') tone(180, 0.04, 'square', 0.04 * vol);
  }

  function pad(kind) {
    return {
      volume: 1,
      currentTime: 0,
      cloneNode: function () { return pad(kind); },
      play: function () { playKind(kind, this.volume); return Promise.resolve(); },
      pause: function () {}
    };
  }

  sounds.side = pad('side');
  sounds.ballsCollide = pad('collide');
  sounds.strike = pad('strike');
  sounds.hole = pad('hole');
  sounds.jazzTune = pad('silence');
  sounds.fadeOut = function () {};

  /* ------------------------------------------------------------------ */
  /* assets from the static <img> tags (runtime rewrites those srcs)     */
  /* ------------------------------------------------------------------ */

  Game.loadAssets = function () {
    var map = {
      background: 'spr-bg',
      ball: 'spr-ball',
      redBall: 'spr-red',
      yellowBall: 'spr-yellow',
      blackBall: 'spr-black',
      stick: 'spr-stick'
    };
    Game.spritesStillLoading = 0;
    Object.keys(map).forEach(function (key) {
      var img = document.getElementById(map[key]);
      sprites[key] = img;
      if (img && !img.complete) {
        Game.spritesStillLoading += 1;
        img.onload = function () { Game.spritesStillLoading -= 1; };
        img.onerror = function () { Game.spritesStillLoading -= 1; };
      }
    });
  };

  Game.initMenus = function () {};

  Game.assetLoadingLoop = function () {
    if (Game.spritesStillLoading > 0) requestAnimationFrame(Game.assetLoadingLoop);
    else {
      Game.initialize();
      showMenu();
    }
  };

  Game.handleInput = function () {
    if (Keyboard.down(Keys.escape)) goMenu();
  };

  GamePolicy.prototype.drawScores = function () {
    this.players[0].matchScore.drawLines(this.players[0].color);
    this.players[1].matchScore.drawLines(this.players[1].color);
  };

  var origShoot = Stick.prototype.shoot;
  var origOutcome = GamePolicy.prototype.updateTurnOutcome;
  var origHole = GamePolicy.prototype.handleBallInHole;

  GamePolicy.prototype.handleBallInHole = function (ball) {
    origHole.call(this, ball);
    if (ball.color === Color.black) showBanner(this.foul ? 'Early black' : 'Black in', 1600);
    else if (ball.color === Color.white) showBanner('White in', 1200);
  };

  GamePolicy.prototype.updateTurnOutcome = function () {
    if (this.turnPlayed && this.won) {
      var we = isMp() ? (this.turn === mySide()) : (!AI_ON || this.turn !== AI_PLAYER_NUM);
      if (!this.foul) showBanner(we ? 'You win' : (AI_ON ? 'Computer wins' : 'Player ' + (this.turn + 1) + ' wins'), 2400);
      else showBanner(we ? 'Foul on the black' : 'They take it', 2200);
    } else if (this.turnPlayed && this.foul) {
      showBanner('Foul — ball in hand', 1400);
    }
    origOutcome.call(this);
  };

  Stick.prototype.handleInput = function () {
    if (AI_ON && Game.policy.turn === AI_PLAYER_NUM) return;
    if (Game.policy.turnPlayed || localLock) return;
    if (isMp() && !myTurn()) return;
    if (Game.policy.foul) return;
    if (Game.gameWorld.ballsMoving()) return;

    if (Keyboard.down(Keys.W) && KEYBOARD_INPUT_ON) {
      if (this.power < 75) {
        this.origin.x += 2;
        this.power += 1.2;
      }
    }
    if (Keyboard.down(Keys.S) && KEYBOARD_INPUT_ON) {
      if (this.power > 0) {
        this.origin.x -= 2;
        this.power -= 1.2;
      }
    }

    if (pulling) {
      var ball = Game.gameWorld.whiteBall.position;
      var dx = ball.x - Mouse.position.x;
      var dy = ball.y - Mouse.position.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > PULL_DEAD) {
        this.rotation = Math.atan2(dy, dx);
        this.power = clamp((dist - PULL_DEAD) / PULL_SCALE, 0, 75);
        this.origin.x = 970 + this.power * (2 / 1.2);
        aimed = true;
      }
      return;
    }

    if (this.power > 0 && Mouse.left.pressed) {
      fire(this);
      return;
    }
    if (this.trackMouse && aimed) {
      var opposite = Mouse.position.y - this.position.y;
      var adjacent = Mouse.position.x - this.position.x;
      this.rotation = Math.atan2(opposite, adjacent);
    }
  };

  function fire(stick) {
    if (!stick || stick.power < MIN_SHOT) return;
    if (guestPath()) {
      if (localLock || mySide() < 0) return;
      localLock = true;
      pendingShot = { n: world ? world.sc | 0 : 0, power: stick.power, rotation: stick.rotation };
      stick.shooting = true;
      Game.policy.turnPlayed = true;
      stick.origin = stick.shotOrigin.copy();
      Game.gameWorld.whiteBall.moving = true;
      setTimeout(function () { stick.visible = false; }, 500);
      playKind('strike', clamp(stick.power / 10, 0, 1));
      putMine();
      return;
    }
    shotCount += 1;
    origShoot.call(stick, stick.power, stick.rotation);
  }

  function canPlaceAt(pos) {
    if (Game.policy.isOutsideBorder(pos, Game.gameWorld.whiteBall.origin)) return false;
    if (Game.policy.isInsideHole(pos)) return false;
    var i, b, balls = Game.gameWorld.balls;
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b === Game.gameWorld.whiteBall || b.inHole) continue;
      if (pos.distanceFrom(b.position) < BALL_SIZE) return false;
    }
    return true;
  }

  function finishPlace(pos) {
    if (!canPlaceAt(pos)) return false;
    if (guestPath()) {
      if (mySide() < 0) return false;
      pendingPlace = { n: world ? world.sc | 0 : 0, x: pos.x, y: pos.y };
      Game.gameWorld.whiteBall.position = pos.copy();
      putMine();
      return true;
    }
    KEYBOARD_INPUT_ON = true;
    Keyboard.reset();
    Mouse.reset();
    Game.gameWorld.whiteBall.position = pos.copy();
    Game.gameWorld.whiteBall.inHole = false;
    Game.gameWorld.whiteBall.visible = true;
    Game.policy.foul = false;
    Game.gameWorld.stick.position = Game.gameWorld.whiteBall.position;
    Game.gameWorld.stick.visible = true;
    return true;
  }

  GameWorld.prototype.ballInHand = function () {
    if (AI_ON && Game.policy.turn === AI_PLAYER_NUM) return;
    if (isMp() && !myTurn()) return;
    KEYBOARD_INPUT_ON = false;
    this.stick.visible = false;
    if (Mouse.left.down) {
      this.whiteBall.position = Mouse.position.copy();
      this.whiteBall.visible = true;
      placing = true;
    } else if (placing) {
      placing = false;
      finishPlace(Mouse.position.copy());
    } else if (!IS_TOUCH) {
      this.whiteBall.position = Mouse.position.copy();
      this.whiteBall.visible = true;
    }
  };

  GameWorld.prototype.whiteBallOverlapsBalls = function () {
    var ballsOverlap = false;
    for (var i = 0; i < this.balls.length; i++) {
      if (this.whiteBall !== this.balls[i] && !this.balls[i].inHole) {
        if (this.whiteBall.position.distanceFrom(this.balls[i].position) < BALL_SIZE) {
          ballsOverlap = true;
        }
      }
    }
    return ballsOverlap;
  };

  /* ------------------------------------------------------------------ */
  /* main loop — host simulates; guest paints the host snapshot          */
  /* ------------------------------------------------------------------ */

  function rayHitBall(ox, oy, ang) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var bestT = 1e9, best = null, i, b, px, py, proj, dist2, off, t;
    var balls = Game.gameWorld.balls;
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      if (b === Game.gameWorld.whiteBall || b.inHole || !b.visible) continue;
      px = b.position.x - ox;
      py = b.position.y - oy;
      proj = px * dx + py * dy;
      if (proj <= 1) continue;
      dist2 = px * px + py * py - proj * proj;
      if (dist2 >= BALL_SIZE * BALL_SIZE) continue;
      off = Math.sqrt(BALL_SIZE * BALL_SIZE - dist2);
      t = proj - off;
      if (t > 1 && t < bestT) { bestT = t; best = b; }
    }
    return best ? { ball: best, t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, dx: dx, dy: dy } : null;
  }

  function rayCushion(ox, oy, ang) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var rad = BALL_SIZE / 2;
    var minX = BORDER_SIZE + rad, maxX = Game.size.x - BORDER_SIZE - rad;
    var minY = BORDER_SIZE + rad, maxY = Game.size.y - BORDER_SIZE - rad;
    var t = 1e9;
    if (dx > 0.001) t = Math.min(t, (maxX - ox) / dx);
    if (dx < -0.001) t = Math.min(t, (minX - ox) / dx);
    if (dy > 0.001) t = Math.min(t, (maxY - oy) / dy);
    if (dy < -0.001) t = Math.min(t, (minY - oy) / dy);
    if (t < 1) t = 1;
    return { t: t, x: ox + dx * t, y: oy + dy * t };
  }

  function drawGhost(ctx, x, y, rgb, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, BALL_SIZE / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawAimGuide() {
    var world = Game.gameWorld, stick, ctx, scale, ball, hit, cush, i, nx, ny, len, ox, oy;
    if (!world || !world.stick || !world.stick.visible) return;
    stick = world.stick;
    if (!myTurn() || (world.ballsMoving && world.ballsMoving())) return;
    if (Game.policy && Game.policy.foul) return;
    ctx = Canvas2D._canvasContext;
    scale = Canvas2D.scale;
    ball = world.whiteBall;
    ctx.save();
    ctx.scale(scale.x, scale.y);
    if (ctx.setLineDash) ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ox = ball.position.x;
    oy = ball.position.y;
    hit = rayHitBall(ox, oy, stick.rotation);
    cush = rayCushion(ox, oy, stick.rotation);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    if (hit && hit.t < cush.t) {
      ctx.lineTo(hit.x, hit.y);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      drawGhost(ctx, hit.x, hit.y, '255,255,255', 0.7);
      nx = hit.ball.position.x - hit.x;
      ny = hit.ball.position.y - hit.y;
      len = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= len; ny /= len;
      ctx.beginPath();
      if (ctx.setLineDash) ctx.setLineDash([7, 6]);
      ctx.strokeStyle = 'rgba(255,255,210,0.5)';
      ctx.moveTo(hit.ball.position.x, hit.ball.position.y);
      ctx.lineTo(hit.ball.position.x + nx * 90, hit.ball.position.y + ny * 90);
      ctx.stroke();
      drawGhost(ctx, hit.ball.position.x + nx * 38, hit.ball.position.y + ny * 38, '255,255,210', 0.45);
    } else {
      ctx.lineTo(cush.x, cush.y);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
      drawGhost(ctx, cush.x, cush.y, '255,255,255', 0.45);
    }
    ctx.restore();
  }

  function setPowerUi() {
    var p = Game.gameWorld && Game.gameWorld.stick ? Game.gameWorld.stick.power : 0;
    if (p > 1 && myTurn() && !(Game.gameWorld && Game.gameWorld.ballsMoving())) {
      powerBar.classList.add('on');
      powerFill.style.width = clamp(p / 75, 0, 1) * 100 + '%';
    } else {
      powerBar.classList.remove('on');
    }
  }

  Game.mainLoop = function () {
    var gen = loopGen;
    function frame() {
      if (gen !== loopGen || GAME_STOPPED || menuOn) return;
      if (DISPLAY) {
        if (guestPath()) guestTick();
        else {
          maybeApplyRemote();
          Game.gameWorld.handleInput(DELTA);
          Game.gameWorld.update(DELTA);
          Canvas2D.clear();
          Game.gameWorld.draw();
          drawAimGuide();
          Mouse.reset();
          Game.handleInput();
          publish();
          pollOwner();
        }
        setPowerUi();
        setHint();
        setNames();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  Game.startNewGame = function () {
    Canvas2D._canvas.style.cursor = 'auto';
    loopGen += 1;
    GAME_STOPPED = false;
    menuOn = false;
    localLock = false;
    pendingShot = null;
    pendingPlace = null;
    aimed = false;
    pulling = false;
    placing = false;
    Game.gameWorld = new GameWorld();
    Game.policy = new GamePolicy();
    Game.gameWorld.stick.rotation = 0;
    AI.init(Game.gameWorld, Game.policy);
    if (AI_ON && AI_PLAYER_NUM === 0) AI.startSession();
    hideMenu();
    shotCount = 0;
    lastTableSig = null;   // a new table: the next look is compared with the stored one (see publish)
    Game.mainLoop();
  };

  function goMenu() {
    loopGen += 1;
    GAME_STOPPED = true;
    menuOn = true;
    AI_ON = false;
    showMenu();
  }

  /* ------------------------------------------------------------------ */
  /* guest: paint host balls, aim locally, never simulate a shot         */
  /* ------------------------------------------------------------------ */

  function applyHost(h) {
    if (!h || !Game.gameWorld) return;
    var balls = Game.gameWorld.balls, i, p;
    if (h.balls) {
      for (i = 0; i < h.balls.length && i < balls.length; i++) {
        p = h.balls[i];
        balls[i].position.x = p[0];
        balls[i].position.y = p[1];
        balls[i].visible = !!p[2];
        balls[i].inHole = !!p[3];
        balls[i].moving = !!p[4];
        balls[i].velocity = Vector2.zero;
      }
    }
    var pol = Game.policy;
    if (pendingShot && (h.sc | 0) > pendingShot.n) pendingShot = null;     // the owner took my shot
    if (pendingPlace && (h.sc | 0) > pendingPlace.n || (pendingPlace && !h.foul)) pendingPlace = null;
    pol.turn = h.turn | 0;
    pol.foul = !!h.foul;
    pol.turnPlayed = !!h.tp;
    pol.won = !!h.won;
    pol.scored = !!h.scored;
    pol.firstCollision = h.fc !== 0;
    if (h.p0m != null) pol.players[0].matchScore.value = h.p0m;
    if (h.p1m != null) pol.players[1].matchScore.value = h.p1m;
    if (h.p0t != null) pol.players[0].totalScore.value = h.p0t;
    if (h.p1t != null) pol.players[1].totalScore.value = h.p1t;
    pol.players[0].color = h.p0c || undefined;
    pol.players[1].color = h.p1c || undefined;
    var aiming = myTurn() && !h.moving && !pol.turnPlayed;
    if (!aiming) {
      Game.gameWorld.stick.rotation = h.sr || 0;
      Game.gameWorld.stick.power = h.sp || 0;
      Game.gameWorld.stick.visible = h.sv !== 0;
      Game.gameWorld.stick.position.x = Game.gameWorld.whiteBall.position.x;
      Game.gameWorld.stick.position.y = Game.gameWorld.whiteBall.position.y;
      if (!h.moving) localLock = false;
    } else {
      Game.gameWorld.stick.position.x = Game.gameWorld.whiteBall.position.x;
      Game.gameWorld.stick.position.y = Game.gameWorld.whiteBall.position.y;
      if (!Game.policy.foul) Game.gameWorld.stick.visible = true;
    }
  }

  function guestTick() {
    if (world) applyHost(world);
    if (myTurn() && Game.policy && !Game.policy.turnPlayed && !(world && world.moving)) {
      Game.gameWorld.handleInput(DELTA);
      if (Game.policy.foul) Game.gameWorld.ballInHand();
    }
    Canvas2D.clear();
    Game.gameWorld.draw();
    drawAimGuide();
    Mouse.reset();
    Game.handleInput();
  }

  // The owner applies what the other seat asked for: a shot or the white's new place, when it is that seat's turn.
  function maybeApplyRemote() {
    if (!isMp() || !owner || !opponent || !Game.gameWorld || mySide() < 0) return;
    if (Game.gameWorld.ballsMoving()) return;
    if (Game.policy.turn !== 1 - mySide()) return;
    var row = rows[opponent.id], done = false;
    if (!row) return;
    if (Game.policy.foul && row.place && row.place.n === shotCount) {
      done = finishPlace(new Vector2(row.place.x, row.place.y));
    } else if (!Game.policy.foul && row.shot && row.shot.n === shotCount && !Game.policy.turnPlayed) {
      shotCount += 1;
      origShoot.call(Game.gameWorld.stick, row.shot.power, row.shot.rotation);
      done = true;
    }
    if (done) {
      delete rows[opponent.id];
      var shots = db('shots');
      if (shots && shots.delete) shots.delete(opponent.id).catch(function () {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* net — gifos.room seats; the other seat writes one row, only when it  */
  /* acts; the app's owner simulates and owns the 'table' row             */
  /* ------------------------------------------------------------------ */

  function packBalls() {
    var balls = Game.gameWorld.balls, out = [], i, b;
    for (i = 0; i < balls.length; i++) {
      b = balls[i];
      out.push([
        Math.round(b.position.x),
        Math.round(b.position.y),
        b.visible ? 1 : 0,
        b.inHole ? 1 : 0,
        b.moving ? 1 : 0
      ]);
    }
    return out;
  }

  function findOpponent() {
    var sd = mySide();
    if (!ROOM || !rs || sd < 0) return null;
    var st = rs.seats[1 - sd];
    if (!st || !st.id || st.here !== 'here') return null;
    return { id: st.id, name: st.name || 'Friend' };
  }

  function refresh() {
    opponent = findOpponent();
    maybeSwitchMode();
  }

  function ingestShots(list) {
    rows = {};
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      rows[p.id] = { shot: p.shot || null, place: p.place || null };   // only the seated opponent's row is ever read
    }
  }

  function ingestTable(list) {
    var w = null;
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'table') w = list[i];
    world = w;
  }

  function maybeSwitchMode() {
    var want = isMp();
    if (want && !hadOpponent) {
      hadOpponent = true;
      AI_ON = false;
      pendingShot = null;
      pendingPlace = null;
      Game.startNewGame();
      menuStatus.textContent = '';
    } else if (!want && hadOpponent) {
      hadOpponent = false;
      goMenu();
      menuStatus.textContent = 'Friend left.';
    }
    setNames();
    setHint();
  }

  // The other seat's row: written only by an action (a shot, the white placed), never on a timer.
  function putMine() {
    var shots = db('shots');
    if (!netReady || !shots || !rs || !rs.me || mySide() < 0 || !isMp()) return;
    var rec = { id: rs.me.id };
    if (pendingShot) rec.shot = pendingShot;
    if (pendingPlace) rec.place = pendingPlace;
    shots.put(rec).catch(function () {});
  }

  // The owner's table row, written only when the table or the stick changed (20 Hz at most). A look at a still
  // table writes nothing, unless the stored row is of another game (then it is replaced once).
  function publish() {
    if (!netReady || !isMp() || !owner || mySide() < 0 || !Game.gameWorld) return;
    var tables = db('table');
    if (!tables) return;
    acc += DELTA;
    if (acc < 1 / PUBLISH_HZ) return;
    acc = 0;
    var pol = Game.policy, stick = Game.gameWorld.stick;
    var rec = {
      id: 'table',
      balls: packBalls(),
      turn: pol.turn,
      foul: pol.foul ? 1 : 0,
      tp: pol.turnPlayed ? 1 : 0,
      won: pol.won ? 1 : 0,
      scored: pol.scored ? 1 : 0,
      fc: pol.firstCollision ? 1 : 0,
      p0m: pol.players[0].matchScore.value,
      p1m: pol.players[1].matchScore.value,
      p0t: pol.players[0].totalScore.value,
      p1t: pol.players[1].totalScore.value,
      p0c: pol.players[0].color || '',
      p1c: pol.players[1].color || '',
      sr: Math.round(stick.rotation * 1000) / 1000,
      sp: Math.round(stick.power * 10) / 10,
      sv: stick.visible ? 1 : 0,
      moving: Game.gameWorld.ballsMoving() ? 1 : 0,
      sc: shotCount
    };
    var sig = JSON.stringify(rec);
    var first = lastTableSig === null;
    if (sig === lastTableSig) return;
    lastTableSig = sig;
    if (first && (!world || world.sig === sig)) { return; }   // nothing stored, or the same table: no write
    rec.sig = sig;
    rec.n = ++tableN;
    tables.put(rec).catch(function () {});
  }

  // Who owns the app can change (the owner leaves, GifOS hands it on): a local read, no network.
  function pollOwner() {
    if (!ROOM || !api.info) return;
    var t = now();
    if (t - ownerAt < OWNER_POLL) return;
    ownerAt = t;
    readOwner();
  }
  function readOwner() {
    api.info().then(function (i) {
      var o = !!(i && i.owner);
      if (o === owner) return;
      owner = o;
      lastTableSig = null;
      // Handed the app: the table painted so far is the game; the balls stand still and the original rules take over.
      if (o && Game.gameWorld) {
        shotCount = world ? world.sc | 0 : shotCount;
        var balls = Game.gameWorld.balls;
        for (var k = 0; k < balls.length; k++) { balls[k].moving = false; balls[k].velocity = Vector2.zero; }
        localLock = false;
      }
      refresh();
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
    if (!ROOM) { menuStatus.textContent = EN.needsNewer; return; }
    var ready = api.info ? api.info().then(function (i) { owner = !!(i && i.owner); }).catch(function () {}) : Promise.resolve();
    ready.then(function () {
      netReady = true;
      db('shots').subscribe(ingestShots);
      db('table').subscribe(ingestTable);
      gifos.room.subscribe(onRoom);
      setNames();
    });
  }

  /* ------------------------------------------------------------------ */
  /* pointer — pull back to aim; drag the white after a foul             */
  /* ------------------------------------------------------------------ */

  function pointerToGame(ev) {
    var c = Canvas2D._canvas;
    if (!c) return;
    var cw = c.width, ch = c.height;
    if (!cw || !ch) return;
    var lx, ly;
    if (document.body.classList.contains('portrait')) {
      var cx = (window.innerWidth || 0) / 2;
      var cy = (window.innerHeight || 0) / 2;
      lx = (cy - ev.clientY) + cw / 2;
      ly = (ev.clientX - cx) + ch / 2;
    } else {
      var r = c.getBoundingClientRect();
      lx = ev.clientX - r.left;
      ly = ev.clientY - r.top;
    }
    Mouse._position = new Vector2(lx / cw * Game.size.x, ly / ch * Game.size.y);
  }

  function installResize() {
    function resize() {
      var gameCanvas = Canvas2D._canvas;
      var gameArea = Canvas2D._div;
      if (!gameCanvas || !gameArea || !Game.size) return;
      var portrait = isPortrait();
      document.body.classList.toggle('portrait', portrait);
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      var availW = portrait ? vh : vw;
      var availH = portrait ? vw : vh;
      var widthToHeight = Game.size.x / Game.size.y;
      var newWidth = availW, newHeight = availH;
      var newWidthToHeight = newWidth / Math.max(1, newHeight);
      if (newWidthToHeight > widthToHeight) newWidth = newHeight * widthToHeight;
      else newHeight = newWidth / widthToHeight;
      gameArea.style.width = newWidth + 'px';
      gameArea.style.height = newHeight + 'px';
      gameArea.style.margin = '0';
      gameCanvas.width = newWidth;
      gameCanvas.height = newHeight;
      Canvas2D._canvasOffset = Vector2.zero;
    }
    Canvas2D.resize = resize;
    window.onresize = resize;
    resize();
  }

  function bindPointer() {
    var canvas = Canvas2D._canvas;
    document.onmousemove = null;
    document.onmousedown = null;
    document.onmouseup = null;

    function pt(ev) {
      if (ev.touches && ev.touches[0]) return ev.touches[0];
      if (ev.changedTouches && ev.changedTouches[0]) return ev.changedTouches[0];
      return ev;
    }
    function isUi(ev) {
      var t = ev.target;
      return t && t.closest && t.closest('#menuCard, #soundBtn, #diff, button');
    }
    function down(ev) {
      if (held) return;
      if (menuOn) return;
      if (isUi(ev)) return;
      var p = pt(ev);
      resumeAudio();
      pointerToGame(p);
      Mouse._left.down = true;
      Mouse._left.pressed = true;
      pulling = !!(Game.gameWorld && Game.policy && !Game.policy.foul && myTurn() &&
                   !Game.gameWorld.ballsMoving() && !menuOn);
      placing = !!(Game.gameWorld && Game.policy && Game.policy.foul && myTurn() && !menuOn);
      aimed = true;
      held = true;
      try {
        if (ev.pointerId != null && canvas && canvas.setPointerCapture) {
          canvas.setPointerCapture(ev.pointerId);
        }
      } catch (e) {}
      if (ev.cancelable && ev.preventDefault) ev.preventDefault();
    }
    function move(ev) {
      if (menuOn) return;
      var p = pt(ev);
      pointerToGame(p);
      if (held) aimed = true;
      if (held && ev.cancelable && ev.preventDefault) ev.preventDefault();
    }
    function up(ev) {
      if (!held) return;
      held = false;
      var p = pt(ev);
      pointerToGame(p);
      if (pulling && Game.gameWorld && Game.gameWorld.stick.power >= MIN_SHOT) {
        fire(Game.gameWorld.stick);
      } else if (pulling && Game.gameWorld && Game.gameWorld.stick) {
        Game.gameWorld.stick.power = 0;
        Game.gameWorld.stick.origin = new Vector2(970, 11);
      }
      pulling = false;
      Mouse._left.down = false;
      Mouse.reset();
    }
    document.addEventListener('pointerdown', down, { passive: false });
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.addEventListener('touchstart', down, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up, { passive: false });
  }

  document.addEventListener('keydown', function (e) {
    resumeAudio();
    if (e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S' || e.key === 'Escape') {
      e.preventDefault();
    }
  });

  /* ------------------------------------------------------------------ */
  /* chrome                                                              */
  /* ------------------------------------------------------------------ */

  function colorWord(c) {
    if (c === Color.red) return 'red';
    if (c === Color.yellow) return 'yellow';
    return '';
  }

  function paintChip(el, color) {
    el.classList.remove('red', 'yellow');
    if (color === Color.red) el.classList.add('red');
    else if (color === Color.yellow) el.classList.add('yellow');
  }

  function seatName(i) {
    var st = rs && rs.seats && rs.seats[i];
    if (st && st.id) return rs.me && st.id === rs.me.id ? (me.name || 'You') : (st.name || 'Friend');
    return i === 0 ? 'Player 1' : 'Player 2';
  }

  function setNames() {
    var n0, n1, turn = Game.policy ? Game.policy.turn : 0;
    if (isMp()) {
      n0 = seatName(0);
      n1 = seatName(1);
    } else {
      n0 = me.name || 'You';
      n1 = AI_ON ? 'Computer' : 'Player 2';
    }
    names0.textContent = n0;
    names1.textContent = n1;
    p0.classList.toggle('on', turn === 0);
    p1.classList.toggle('on', turn === 1);
    if (Game.policy) {
      paintChip(chip0, Game.policy.players[0].color);
      paintChip(chip1, Game.policy.players[1].color);
      sc0.textContent = Game.policy.players[0].matchScore.value ? String(Game.policy.players[0].matchScore.value) : '';
      sc1.textContent = Game.policy.players[1].matchScore.value ? String(Game.policy.players[1].matchScore.value) : '';
    }
  }

  function setHint() {
    if (!Game.gameWorld || menuOn) return;
    if (isMp() && !myTurn()) {
      hint.textContent = mySide() < 0 ? 'Watching' : (Game.gameWorld.ballsMoving() ? 'Balls moving…' : 'Their turn');
      return;
    }
    if (Game.policy && Game.policy.foul && myTurn()) {
      hint.textContent = IS_TOUCH ? 'Drag the white, then let go' : 'Move the white, then click to place';
      return;
    }
    if (Game.gameWorld.ballsMoving()) {
      hint.textContent = 'Balls moving…';
      return;
    }
    var col = Game.policy && Game.policy.players[Game.policy.turn] && colorWord(Game.policy.players[Game.policy.turn].color);
    var who = col ? ('You are ' + col + '. ') : '';
    hint.textContent = who + (IS_TOUCH ? 'Pull back to aim · let go to shoot' : 'Pull back to aim · let go to shoot');
  }

  function showBanner(text, ms) {
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { bannerEl.hidden = true; }, ms || 1400);
  }

  function showMenu() {
    menu.hidden = false;
    menuOn = true;
    GAME_STOPPED = true;
    document.getElementById('hud').hidden = true;
    if (bannerEl) bannerEl.hidden = true;
  }
  function hideMenu() {
    menu.hidden = true;
    menuOn = false;
    document.getElementById('hud').hidden = false;
  }

  document.getElementById('btnCpu').addEventListener('click', function () {
    diff.hidden = !diff.hidden;
  });
  diff.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    AI_ON = true;
    AI_PLAYER_NUM = 1;
    TRAIN_ITER = parseInt(b.getAttribute('data-iter'), 10) || 50;
    Game.startNewGame();
  });
  document.getElementById('btnHot').addEventListener('click', function () {
    AI_ON = false;
    Game.startNewGame();
  });

  function setSound(on) {
    soundOn = !!on;
    SOUND_ON = soundOn;
    Game.sound = soundOn;
    soundBtn.classList.toggle('off', !soundOn);
    soundBtn.textContent = soundOn ? '♪' : '×';
    var prefs = db('prefs');
    if (prefs) prefs.put({ id: 'sound', on: soundOn }).catch(function () {});
  }
  soundBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    resumeAudio();
    setSound(!soundOn);
  });

  var prefs = db('prefs');
  if (prefs && prefs.get) {
    Promise.resolve(prefs.get('sound')).then(function (r) {
      if (r && r.on === false) setSound(false);
    }).catch(function () {});
  }

  if (api && api.onBack) {
    api.onBack(function () { goMenu(); });
  }

  Game.sound = true;
  SOUND_ON = true;
  AI_ON = false;
  GAME_STOPPED = true;

  Game.start('gameArea', 'screen', 1500, 825);
  installResize();
  bindPointer();
  // Low-rate shared state only (who is seated, the score) so copies can be compared.
  root.__pool = {
    state: function () {
      return {
        seats: rs ? rs.seats.map(function (x) { return x.id || null; }) : [],
        score: world ? [world.p0m | 0, world.p1m | 0] : [0, 0]
      };
    }
  };

  setNames();
  bootNet();
})(window);
