/*
 * Air Hockey — GifOS shell around MortimerGoro's AirHockeyWebGL.
 *
 * vendor/* is the unmodified upstream (three r66, box2dweb, the table,
 * paddles, puck, ice, physics, AI). Everything GifOS-specific lives here:
 * no dat.GUI, loaders that do not XHR (the sandbox blocks it), Web Audio
 * fallback, touch, and two-device play over gifos.db.
 *
 * MULTIPLAYER (gifos.room). Invite is OS chrome — this app never draws a
 * share button. The seats (Near, Far) come from gifos.room; the line waits.
 * Each seated player writes only their own paddle row, and only while they
 * move it. The app's owner (gifos.info().owner) simulates the puck and writes
 * the 'world' row when it changes; the other copy paints it. When the owner
 * leaves, GifOS hands the app to the next copy, which takes the simulation
 * over. An empty Far seat is the CPU.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 20;
  var OWNER_POLL = 2;   // seconds of frames between local info() reads (no network)
  var EN = { needsNewer: 'Air Hockey needs a newer GifOS to play together. Reload the page to update.' };

  var api = root.gifos || null;
  var ROOM = !!(api && api.room && api.room.subscribe);
  var me = { id: 'local', name: 'You' };
  var owner = true;
  var rs = null, joined = false, ownerAcc = 0, moved = false, lastWrote = null, lastWorldSig = null, worldN = 0;
  var rows = {};          // paddle rows by person id
  var world = null, worldAt = 0;
  var opponent = null;
  var hadOpponent = false;
  var acc = 0;
  var netReady = !ROOM;
  var origUpdate = null;
  var soundOn = true;
  var actx = null;
  var gameScene = null;
  var renderer = null;
  var canvas = null;
  var projector = null;

  var hint = document.getElementById('hint');
  var note = document.getElementById('note');
  var soundBtn = document.getElementById('soundBtn');
  var scoreA = document.getElementById('playerA_score');
  var scoreB = document.getElementById('playerB_score');

  function clamp(n, a, b) { return n < a ? a : n > b ? b : n; }
  function db(n) { return api && api.db ? api.db(n) : null; }
  function now() { return Date.now(); }
  function isMp() { return !!opponent; }
  // My side: 0 near (player A), 1 far (player B), -1 not seated. Local play (no room yet) is near.
  function mySide() {
    if (!ROOM || !rs || !rs.me) return 0;
    for (var i = 0; i < 2; i++) if (rs.seats[i] && rs.seats[i].id && rs.seats[i].id === rs.me.id) return i;
    return -1;
  }
  function spectating() { return ROOM && !!rs && mySide() < 0; }
  function round(n) { return Math.round(n * 1000) / 1000; }

  /* ------------------------------------------------------------------ */
  /* loaders — CSP connect-src is none; XHR/Image src paths never fire   */
  /* ------------------------------------------------------------------ */

  function patchLoaders() {
    THREE.ImageUtils.loadTexture = function (url, mapping, onLoad) {
      var img = document.querySelector('img[data-src="' + url + '"]');
      var texture = new THREE.Texture(img || undefined, mapping);
      function apply() {
        if (img) texture.image = img;
        texture.needsUpdate = true;
        if (onLoad) onLoad(texture);
      }
      if (img && img.complete && img.naturalWidth) apply();
      else if (img) img.addEventListener('load', apply);
      else apply();
      return texture;
    };

    THREE.OBJMTLLoader.prototype.load = function (url, mtlurl, onLoad) {
      var files = root.HOCKEY_FILES || {};
      var objText = files[url];
      var mtlText = files[mtlurl];
      if (objText == null || mtlText == null) {
        throw new Error('missing model ' + url + ' / ' + mtlurl);
      }
      var scope = this;
      var mtlLoader = new THREE.MTLLoader(url.substr(0, url.lastIndexOf('/') + 1));
      var materials = mtlLoader.parse(mtlText);
      materials.preload();
      var object = scope.parse(objText);
      object.traverse(function (obj) {
        if (obj instanceof THREE.Mesh && obj.material && obj.material.name) {
          var mat = materials.create(obj.material.name);
          if (mat) obj.material = mat;
        }
      });
      /* Deliver ASYNCHRONOUSLY, like the XHR loader this replaces. hockey.js
         writes `var me = this` AFTER its loadModels() call, so a synchronous
         callback reaches modelsLoaded while `me` is still undefined — the
         scene then never gets physics, AI, or the PLAYING state, and the app
         is a black screen with a score bar. */
      setTimeout(function () { onLoad(object); }, 0);
    };
  }

  /* ------------------------------------------------------------------ */
  /* sounds — original Audio() src paths cannot load; use the hidden     */
  /* <audio> tags (rewritten to data URLs) and a beep if they fail       */
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

  function beep(freq, dur) {
    if (!actx || !soundOn) return;
    try {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.08, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g); g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + dur);
    } catch (e) {}
  }

  function playEl(el, volume, fallback) {
    if (!soundOn || !el) { if (fallback) fallback(); return; }
    try {
      var a = el.cloneNode(true);
      a.volume = volume || 0.5;
      var p = a.play();
      if (p && p.catch) p.catch(function () { if (fallback) fallback(); });
    } catch (e) { if (fallback) fallback(); }
  }

  Hockey.Audio.init = function (model) {
    this.model = model;
    this.hitSounds = [document.getElementById('aud-hit1'), document.getElementById('aud-hit2')];
    this.edgeSounds = [document.getElementById('aud-edge1'), document.getElementById('aud-edge2')];
    this.goalSounds = [document.getElementById('aud-goal1')];
  };
  Hockey.Audio.playRandomSound = function (target, volume) {
    if (!this.model || !this.model.soundEnabled || !target || !target.length) return;
    var el = target[Math.floor(Math.random() * target.length)];
    playEl(el, volume, function () {
      if (target === Hockey.Audio.hitSounds) beep(520, 0.06);
      else if (target === Hockey.Audio.edgeSounds) beep(240, 0.05);
      else beep(330, 0.12);
    });
  };
  Hockey.Audio.playHitSound = function (volume) { this.playRandomSound(this.hitSounds, volume); };
  Hockey.Audio.playGoalSound = function (volume) { this.playRandomSound(this.goalSounds, volume); };
  Hockey.Audio.playEdgeSound = function (volume) { this.playRandomSound(this.edgeSounds, volume); };

  Hockey.GameModel.prototype.createGUI = function () {};

  /* Upstream AI.js references an undeclared `paddle` when defending the
     goal mouth. Same function, that identifier is myPos. */
  Hockey.AI.prototype.play = function () {
    var model = this.model;
    var myPos = model.playerB.paddle.position;
    var tableSize = model.tableSize;
    var paddleRadius = model.playerB.radius;
    var targetPuck = null;
    var bestHeuristic = 0;
    var targetPos = new THREE.Vector3(0, 0, 0);

    for (var i = 0; i < model.pucks.length; ++i) {
      var puck = model.pucks[i];
      var score = this.heuristic(puck);
      if (score > 0 && score > bestHeuristic) {
        targetPuck = puck;
        bestHeuristic = score;
      }
    }

    if (targetPuck) {
      var puckPos = targetPuck.mesh.position;
      targetPos.set(puckPos.x, tableSize.height, puckPos.z - paddleRadius * 0.9 - targetPuck.radius * 0.9);
    } else {
      targetPos.set(0, tableSize.height, -tableSize.depth * 0.4);
    }

    targetPos.x = Math.max(-tableSize.width / 2 + paddleRadius, targetPos.x);
    targetPos.x = Math.min(tableSize.width / 2 - paddleRadius, targetPos.x);
    targetPos.z = Math.min(0, targetPos.z);
    targetPos.z = Math.max(-tableSize.depth / 2 + paddleRadius, targetPos.z);

    if (targetPos.z + paddleRadius < (-tableSize.depth * (0.5 - model.goalSize.depth))
        && Math.abs(myPos.x) < tableSize.width * model.goalSize.width * 0.5 + paddleRadius) {
      myPos.z = -tableSize.depth * (0.5 - model.goalSize.depth) + paddleRadius;
    }

    var diffX = Math.abs(targetPos.x - myPos.x);
    var diffZ = Math.abs(targetPos.z - myPos.z);
    var speed = 0.1 + 0.9 * model.difficulty;
    var speedX = tableSize.width * 0.03 * speed;
    var speedZ = tableSize.depth * 0.03 * speed;
    myPos.x += Math.min(diffX, speedX) * (myPos.x > targetPos.x ? -1 : 1);
    myPos.z += Math.min(diffZ, speedZ) * (myPos.z > targetPos.z ? -1 : 1);
  };

  /* ------------------------------------------------------------------ */
  /* start the original scene                                            */
  /* ------------------------------------------------------------------ */

  function whenImages(fn) {
    var imgs = [document.getElementById('tex-floor'), document.getElementById('tex-surface')];
    var left = imgs.length;
    function one() { if (--left <= 0) fn(); }
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) one();
      else {
        imgs[i].addEventListener('load', one);
        imgs[i].addEventListener('error', one);
      }
    }
  }

  function init() {
    patchLoaders();
    projector = new THREE.Projector();

    canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas });
    renderer.setClearColor(0x000000);
    document.getElementById('container').appendChild(canvas);

    var model = new Hockey.GameModel();
    model.numPucks = 1;
    model.soundEnabled = soundOn;
    gameScene = new Hockey.GameScene(renderer, model);

    origUpdate = Hockey.GameScene.prototype.update;
    Hockey.GameScene.prototype.update = function () {
      if (this.model.state === Hockey.GameModel.STATES.LOADING) return;
      if (!this.model.playerA || !this.model.playerA.paddle) return;
      var sd = mySide();
      if (spectating()) { watchUpdate(this); return; }
      if (owner || !isMp()) {
        if (sd === 1) { farSimUpdate(this); return; }
        if (isMp() && opponent && opponent.x != null && this.model.playerB.paddle) {
          this.model.playerB.paddle.position.x = opponent.x;
          this.model.playerB.paddle.position.z = opponent.z;
          this.model.playerB.paddle.position.y = this.model.tableSize.height;
        }
        if (isMp()) {
          var ai = this.ai;
          this.ai = { play: function () {} };
          try { origUpdate.call(this); } catch (e) {}
          this.ai = ai;
          return;
        }
        try { origUpdate.call(this); } catch (e) {}
        return;
      }
      if (sd === 1) { guestUpdate(this); return; }
      nearGuestUpdate(this);
    };

    Hockey.GameScene.prototype.updateScores = function () {
      paintScores();
    };

    fit();
    window.addEventListener('resize', fit);

    canvas.addEventListener('pointerdown', function (ev) {
      resumeAudio();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      if (gameScene && !spectating()) { moved = true; gameScene.processInput(ev.clientX, ev.clientY); }
      ev.preventDefault();
    }, { passive: false });
    canvas.addEventListener('pointermove', function (ev) {
      if (gameScene && !spectating()) { moved = true; gameScene.processInput(ev.clientX, ev.clientY); }
      ev.preventDefault();
    }, { passive: false });

    var last = now();
    function frame() {
      var t = now();
      var dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (gameScene) gameScene.render();
      pollOwner(dt);
      publish(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setHint();
    paintScores();
  }

  function fit() {
    if (!renderer || !canvas) return;
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    renderer.setSize(canvas.width, canvas.height);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (gameScene && gameScene.camera) {
      gameScene.camera.aspect = w / h;
      gameScene.camera.updateProjectionMatrix();
    }
  }

  /* ------------------------------------------------------------------ */
  /* the far end: camera turned round, my paddle is player B             */
  /* ------------------------------------------------------------------ */

  function farView(scene) {
    var model = scene.model;
    var tableSize = model.tableSize;
    if (!tableSize || !tableSize.width || !model.playerB.paddle) return false;

    var camera = scene.camera;
    var cy = 2.5 + tableSize.height;
    camera.position.set(0, cy, -tableSize.depth);
    camera.lookAt(new THREE.Vector3(0, tableSize.height, 0));

    var px = (scene.input.x / window.innerWidth) * 2 - 1;
    var py = -(scene.input.y / window.innerHeight) * 2 + 1;
    var vector = new THREE.Vector3(px, py, 0.5);
    projector.unprojectVector(vector, camera);
    var ray = new THREE.Ray(camera.position.clone(), vector.sub(camera.position).normalize());
    var intersect = ray.intersectPlane(scene.inputPlane);

    var paddle = model.playerB.paddle;
    var paddleRadius = model.playerB.radius;
    if (intersect) {
      paddle.position.x = Math.max(-tableSize.width / 2 + paddleRadius, Math.min(tableSize.width / 2 - paddleRadius, intersect.x));
      paddle.position.z = Math.min(0, intersect.z);
      paddle.position.z = Math.max(-tableSize.depth / 2 + paddleRadius, paddle.position.z);
      paddle.position.y = tableSize.height;
      if (paddle.position.z - paddleRadius < (-tableSize.depth * (0.5 - model.goalSize.depth))
          && Math.abs(paddle.position.x) < tableSize.width * model.goalSize.width * 0.5 + paddleRadius) {
        paddle.position.z = -tableSize.depth * (0.5 - model.goalSize.depth) + paddleRadius;
      }
    }
    return true;
  }

  function setPaddle(p, x, z, h) {
    if (!p || x == null) return;
    p.position.x = x;
    p.position.z = z;
    p.position.y = h;
  }

  function paintWorld(scene) {
    var model = scene.model, w = world;
    if (!w) return;
    if (w.pucks && model.pucks) {
      var age = Math.max(0, Math.min(0.12, (now() - worldAt) / 1000));
      for (var i = 0; i < model.pucks.length && i < w.pucks.length; i++) {
        var src = w.pucks[i];
        var dst = model.pucks[i];
        if (!dst || !dst.mesh) continue;
        dst.mesh.position.x = src.x + (src.vx || 0) * age;
        dst.mesh.position.z = src.z + (src.vz || 0) * age;
        dst.active = !!src.on;
        dst.mesh.traverse(function (o) { o.visible = !!src.on; });
      }
    }
    if (w.sa != null) model.playerA.score = w.sa;
    if (w.sb != null) model.playerB.score = w.sb;
    paintScores();
  }

  // The owner sits at the far end: the original update only knows the near end, so run the far end here.
  function farSimUpdate(scene) {
    var model = scene.model;
    if (!farView(scene)) return;
    if (opponent) setPaddle(model.playerA.paddle, opponent.x, opponent.z, model.tableSize.height);
    if (model.state === Hockey.GameModel.STATES.PLAYING && scene.simulation) {
      try { scene.simulation.updatePaddles(); scene.simulation.simulate(); } catch (e) {}
    }
  }

  // Far end, not the owner: paint the owner's puck and the near paddle, move my own paddle.
  function guestUpdate(scene) {
    var model = scene.model;
    if (!farView(scene)) return;
    if (opponent) setPaddle(model.playerA.paddle, opponent.x, opponent.z, model.tableSize.height);
    paintWorld(scene);
  }

  // Near end, not the owner: the original update with the simulation held (RESTING), then paint.
  function nearGuestUpdate(scene) {
    var model = scene.model, st = model.state;
    model.state = Hockey.GameModel.STATES.RESTING;
    try { origUpdate.call(scene); } catch (e) {}
    model.state = st;
    if (opponent) setPaddle(model.playerB.paddle, opponent.x, opponent.z, model.tableSize.height);
    paintWorld(scene);
  }

  // Not seated: both paddles from their rows, the puck from the world row.
  function watchUpdate(scene) {
    var model = scene.model, st = model.state;
    model.state = Hockey.GameModel.STATES.RESTING;
    try { origUpdate.call(scene); } catch (e) {}
    model.state = st;
    for (var i = 0; i < 2; i++) {
      var seat = rs.seats[i], r = seat && seat.id ? rows[seat.id] : null;
      if (r) setPaddle((i === 0 ? model.playerA : model.playerB).paddle, r.x, r.z, model.tableSize.height);
    }
    paintWorld(scene);
  }

  /* ------------------------------------------------------------------ */
  /* net — gifos.room seats; each seated player owns one paddle row;      */
  /* the app's owner simulates and owns the 'world' row                   */
  /* ------------------------------------------------------------------ */

  function findOpponent() {
    var sd = mySide();
    if (!ROOM || !rs || sd < 0) return null;
    var st = rs.seats[1 - sd];
    if (!st || !st.id || st.here !== 'here') return null;
    var r = rows[st.id] || {};
    return { id: st.id, name: st.name || 'Friend', x: r.x, z: r.z };
  }

  function refresh() {
    opponent = findOpponent();
    maybeSwitchMode();
  }

  function ingestPaddles(list) {
    rows = {};
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      rows[p.id] = { x: p.x, z: p.z };   // used only for ids that hold a seat (findOpponent / watchUpdate)
    }
    refresh();
  }

  function ingestWorld(list) {
    var w = null;
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'world') w = list[i];
    if (w && (!world || w.n !== world.n)) worldAt = now();
    world = w;
  }

  function maybeSwitchMode() {
    var want = isMp();
    if (want && !hadOpponent) {
      hadOpponent = true;
      if (owner && gameScene && gameScene.model) {
        gameScene.model.playerA.score = 0;
        gameScene.model.playerB.score = 0;
        if (gameScene.prepareToServe) gameScene.prepareToServe();
      }
    } else if (!want && hadOpponent) {
      hadOpponent = false;
    }
    setHint();
    paintScores();
  }

  function myPaddle() {
    if (!gameScene || !gameScene.model) return null;
    return mySide() === 1 ? gameScene.model.playerB.paddle : gameScene.model.playerA.paddle;
  }

  // Both writes happen only while someone is playing: my paddle row once I have moved and it changed, the world
  // row when the puck or score changed. Nothing is written while the table is still.
  function publish(dt) {
    if (!netReady || !isMp() || !rs || !rs.me || mySide() < 0) return;
    if (!gameScene || !gameScene.model || gameScene.model.state === Hockey.GameModel.STATES.LOADING) return;
    acc += dt;
    if (acc < 1 / PUBLISH_HZ) return;
    acc = 0;
    var paddle = myPaddle();
    var paddles = db('paddles');
    if (paddle && paddles && moved) {
      var x = round(paddle.position.x), z = round(paddle.position.z);
      var psig = x + ':' + z;
      if (psig !== lastWrote) {
        lastWrote = psig;
        paddles.put({ id: rs.me.id, x: x, z: z }).catch(function () {});
      }
    }
    if (!owner) { lastWorldSig = null; return; }
    var worlds = db('world');
    if (!worlds) return;
    var w = { id: 'world', sa: gameScene.model.playerA.score, sb: gameScene.model.playerB.score, pucks: [] };
    var list = gameScene.model.pucks || [];
    for (var i = 0; i < list.length; i++) {
      var puck = list[i];
      var v = gameScene.simulation ? gameScene.simulation.getPuckVelocity(puck.mesh) : { x: 0, y: 0 };
      w.pucks.push({
        x: round(puck.mesh.position.x),
        z: round(puck.mesh.position.z),
        vx: round(v.x || 0),
        vz: round(v.y || 0),
        on: puck.active ? 1 : 0
      });
    }
    var sig = JSON.stringify([w.sa, w.sb, w.pucks]);
    var first = lastWorldSig === null;
    var same = sig === lastWorldSig;
    lastWorldSig = sig;
    if (first || same) return;   // the first look is only a baseline: a still table writes nothing
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
      if (o === owner) return;
      owner = o;
      lastWorldSig = null;
      // Handed the app: the puck bodies take the painted positions and this copy simulates from here.
      if (o && gameScene && gameScene.simulation) { try { gameScene.simulation.updatePucks(); } catch (e) {} }
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
    if (!ROOM) { note.textContent = EN.needsNewer; note.hidden = false; return; }
    var ready = api.info ? api.info().then(function (i) { owner = !!(i && i.owner); }).catch(function () {}) : Promise.resolve();
    ready.then(function () {
      netReady = true;
      db('paddles').subscribe(ingestPaddles);
      db('world').subscribe(ingestWorld);
      gifos.room.subscribe(onRoom);
      setHint();
      paintScores();
    });
  }

  /* ------------------------------------------------------------------ */
  /* chrome                                                              */
  /* ------------------------------------------------------------------ */

  function seatLabel(i) {
    var st = rs && rs.seats && rs.seats[i];
    if (st && st.id) return rs.me && st.id === rs.me.id ? (me.name || 'You') : (st.name || 'Friend');
    return null;
  }

  function paintScores() {
    if (!gameScene || !gameScene.model) return;
    var a = gameScene.model.playerA.score || 0;
    var b = gameScene.model.playerB.score || 0;
    var left, right;
    if (!ROOM || !rs) { left = me.name || 'You'; right = 'CPU'; }
    else {
      left = seatLabel(0) || 'Open';
      // The CPU plays the far end, on the copy that simulates, when nobody holds it.
      right = seatLabel(1) || ((owner || !isMp()) && mySide() === 0 ? 'CPU' : 'Open');
    }
    scoreA.textContent = left + ': ' + a;
    scoreB.textContent = right + ': ' + b;
  }

  function setHint() {
    if (ROOM && rs && rs.me && rs.me.role === 'waiting') hint.textContent = 'You are next in line';
    else if (ROOM && rs && rs.me && rs.me.role === 'asking') hint.textContent = 'Waiting for the host to seat you';
    else if (spectating()) hint.textContent = 'Watching';
    else if (isMp()) {
      hint.textContent = mySide() === 1 ? 'You are the far end · drag your paddle' : 'You are this end · drag your paddle';
    } else {
      hint.textContent = 'Drag your paddle · Press Invite for a friend';
    }
  }

  function setSound(on) {
    soundOn = !!on;
    if (gameScene && gameScene.model) gameScene.model.soundEnabled = soundOn;
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

  // Low-rate shared state only (who is seated, the score) so copies can be compared.
  root['__air-hockey'] = {
    state: function () {
      return {
        seats: rs ? rs.seats.map(function (x) { return x.id || null; }) : [],
        score: world ? [world.sa | 0, world.sb | 0] : [0, 0]
      };
    }
  };

  setHint();
  bootNet();
  whenImages(init);
})(window);
