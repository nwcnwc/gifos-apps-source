// One Stroke — one line each. Invite is OS chrome. gifos.room seats the
// people; the mover writes the whole picture with gifos.room.move.
(function () {
  'use strict';
  var OS = window.OS;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var PLAY_MS = 900, HOLD_MS = 1400, ARRIVE_MS = 780;

  var color = OS.COLORS[2];
  var width = OS.WIDTHS[1];

  var solo = null;
  var saveDb = null;
  try { if (window.gifos) saveDb = gifos.db('save'); } catch (e) {}

  var pads = {};

  function setChip(cls, text) {
    $('chip').className = 'engine-chip' + (cls ? ' ' + cls : '');
    $('chipText').textContent = text;
  }
  function setStatus(el, text, cls) {
    el.className = 'statusline' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }
  function setControls(id, kind) {
    $(id).className = 'controls ' + kind;
  }

  function hideAll() {
    $('solo').hidden = true;
    $('friend').hidden = true;
  }

  // ---- paint ----
  function resizePad(canvas) {
    var wrap = canvas.parentNode;
    var cssW = wrap.clientWidth || 360;
    var cssH = wrap.clientHeight || cssW;
    if (cssH < 160) cssH = 160;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { cssW: cssW, cssH: cssH, dpr: dpr };
  }

  function ptsUntil(pts, frac) {
    if (!pts || pts.length < 2) return null;
    var t = frac == null ? 1 : frac;
    if (t <= 0) return null;
    if (t >= 1) return pts;
    var total = OS.pathLen(pts) || 1;
    var want = total * t;
    var out = [pts[0]], walked = 0, i, seg, u;
    for (i = 1; i < pts.length; i++) {
      seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (walked + seg >= want) {
        u = seg ? (want - walked) / seg : 0;
        out.push({
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u
        });
        return out;
      }
      out.push(pts[i]);
      walked += seg;
    }
    return out;
  }

  function strokePath(ctx, s, w, h, frac, wet) {
    var pts = ptsUntil(s && s.pts, frac);
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c || OS.COLORS[2];
    ctx.lineWidth = Math.max(2.2, (s.w || width) * Math.min(w, h));
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = wet ? 5 : 2.4;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    var i, mx, my;
    for (i = 1; i < pts.length - 1; i++) {
      mx = ((pts[i].x + pts[i + 1].x) / 2) * w;
      my = ((pts[i].y + pts[i + 1].y) / 2) * h;
      ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x * w, pts[pts.length - 1].y * h);
    ctx.stroke();
    ctx.restore();
  }

  function paintPaper(canvas, strokes, pending, playT) {
    var sz = resizePad(canvas);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
    var w = sz.cssW, h = sz.cssH;
    ctx.clearRect(0, 0, w, h);
    var list = OS.playback(strokes || []);
    var i, t;
    if (playT != null) {
      for (i = 0; i < list.length; i++) {
        t = playT - i;
        if (t <= 0) break;
        strokePath(ctx, list[i], w, h, t >= 1 ? 1 : t, false);
      }
      return;
    }
    for (i = 0; i < list.length; i++) strokePath(ctx, list[i], w, h, 1, false);
    if (pending && pending.pts && pending.pts.length >= 2) {
      strokePath(ctx, pending, w, h, 1, true);
    }
  }

  function playClock(strokes, t0, mode) {
    var n = (strokes || []).length;
    if (!n) return 0;
    var e, dur;
    if (mode === 'arrive') {
      dur = ARRIVE_MS;
      e = (nowMs() - t0) / dur;
      if (e >= 1) return n;
      return (n - 1) + Math.max(0, Math.min(1, e));
    }
    var total = n * PLAY_MS + HOLD_MS;
    e = (nowMs() - t0) % total;
    if (e >= n * PLAY_MS) return n;
    return e / PLAY_MS;
  }

  // ---- a pad (pointer → one pending stroke) ----
  function makePad(canvas, hooks) {
    var pending = null;
    var drawing = false;
    var last = null;
    var playOn = false;
    var playMode = 'loop';
    var playStart = 0;
    var raf = 0;
    var sent = false;

    function canDraw() { return !sent && hooks.canDraw && hooks.canDraw(); }
    function strokes() { return hooks.strokes ? hooks.strokes() : []; }

    function redraw() {
      var t = playOn ? playClock(strokes(), playStart, playMode) : null;
      if (playOn && playMode === 'arrive' && t >= (strokes() || []).length) {
        playOn = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        t = null;
      }
      paintPaper(canvas, strokes(), playOn ? null : pending, t);
      var paper = canvas.parentNode;
      if (paper) paper.classList.toggle('mine', !playOn && canDraw() && !pending);
    }

    function loop() {
      raf = 0;
      if (!playOn) return;
      redraw();
      if (playOn) raf = requestAnimationFrame(loop);
    }

    function ptOf(t, r) {
      return {
        x: (t.clientX - r.left) / (r.width || 1),
        y: (t.clientY - r.top) / (r.height || 1)
      };
    }

    function start(ev) {
      if (playOn) stopPlay();
      if (!canDraw()) return;
      if (pending && !drawing) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      var r = canvas.getBoundingClientRect();
      var p = ptOf(ev, r);
      drawing = true;
      pending = { pts: OS.compactPts([p]), c: color, w: width };
      last = p;
      redraw();
      if (hooks.onChange) hooks.onChange();
    }
    function move(ev) {
      if (!drawing || !pending) return;
      ev.preventDefault();
      var r = canvas.getBoundingClientRect();
      var extra = [], i, list;
      if (ev.getCoalescedEvents) {
        list = ev.getCoalescedEvents();
        for (i = 0; i < list.length; i++) extra.push(ptOf(list[i], r));
      } else {
        extra.push(ptOf(ev, r));
      }
      if (!extra.length) return;
      pending.pts = OS.compactPts(pending.pts.concat(extra));
      last = extra[extra.length - 1];
      pending.c = color;
      pending.w = width;
      redraw();
    }
    function end(ev) {
      if (!drawing || !pending) return;
      if (ev) ev.preventDefault();
      var r = canvas.getBoundingClientRect();
      var p = ev ? ptOf(ev, r) : last;
      if (p) pending.pts = OS.compactPts(pending.pts.concat([p]));
      drawing = false;
      if (!pending.pts || pending.pts.length < 2) pending = null;
      else {
        pending.c = color;
        pending.w = width;
      }
      redraw();
      if (hooks.onChange) hooks.onChange();
    }

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function stopPlay() {
      playOn = false;
      playMode = 'loop';
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      redraw();
    }

    return {
      redraw: redraw,
      pending: function () { return pending; },
      sent: function () { return sent; },
      markSent: function () { sent = true; if (hooks.onChange) hooks.onChange(); },
      clearPending: function () { pending = null; drawing = false; sent = false; redraw(); },
      restyle: function () {
        if (pending && !sent) { pending.c = color; pending.w = width; redraw(); }
      },
      undo: function () {
        if (drawing || sent) return false;
        if (!pending) return false;
        pending = null;
        redraw();
        if (hooks.onChange) hooks.onChange();
        return true;
      },
      play: function (mode) {
        if (playOn && playMode === (mode || 'loop')) { stopPlay(); return false; }
        playOn = true;
        playMode = mode || 'loop';
        playStart = nowMs();
        loop();
        return true;
      },
      playing: function () { return playOn && playMode === 'loop'; },
      stopPlay: stopPlay
    };
  }

  function paintInk(hostId) {
    var host = $(hostId);
    host.innerHTML = '';
    OS.COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('aria-label', 'ink');
      if (c === color) b.className = 'on';
      b.addEventListener('click', function () {
        color = c;
        paintInk('soloInk');
        paintInk('fInk');
        if (pads.solo) pads.solo.restyle();
        if (pads.f) pads.f.restyle();
      });
      host.appendChild(b);
    });
  }
  function paintWidths(hostId) {
    var host = $(hostId);
    host.innerHTML = '';
    var sizes = [8, 14, 22];
    OS.WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      var dot = document.createElement('i');
      dot.style.width = sizes[i] + 'px';
      dot.style.height = sizes[i] + 'px';
      b.appendChild(dot);
      if (w === width) b.className = 'on';
      b.addEventListener('click', function () {
        width = w;
        paintWidths('soloWidths');
        paintWidths('fWidths');
        if (pads.solo) pads.solo.restyle();
        if (pads.f) pads.f.restyle();
      });
      host.appendChild(b);
    });
  }
  paintInk('soloInk');
  paintInk('fInk');
  paintWidths('soloWidths');
  paintWidths('fWidths');

  // ---- solo ----
  function soloSave() {
    if (!saveDb || !solo) return;
    saveDb.put({
      id: 'doodle',
      strokes: solo.strokes,
      title: solo.title || '',
      seq: solo.seq,
      at: nowMs()
    }).catch(function () {});
  }

  function soloRefresh() {
    if ($('solo').hidden || !solo) return;
    var n = (solo.strokes || []).length;
    var pad = pads.solo;
    var pending = pad && pad.pending();
    var ready = pending && pending.pts && pending.pts.length >= 2;
    var hint = $('soloHint');
    if (pad && pad.playing()) {
      setStatus($('soloStatus'), 'The picture, arriving.', '');
      setChip('ready', 'Loop');
      hint.hidden = true;
      setControls('soloControls', 'play');
      $('soloPlay').textContent = 'Stop loop';
    } else if (ready) {
      setStatus($('soloStatus'), 'Undo, or send this stroke.', 'turn');
      setChip('turn', 'Your stroke');
      hint.hidden = true;
      setControls('soloControls', 'pending');
      $('soloPlay').textContent = 'Play loop';
    } else {
      setStatus($('soloStatus'), n ? 'Your turn. One more line.' : 'Your turn. One line.', 'turn');
      setChip('turn', 'Your turn');
      hint.hidden = n > 0;
      setControls('soloControls', n ? 'idle' : 'empty');
      $('soloPlay').textContent = 'Play loop';
    }
    $('soloStatus').style.visibility = hint.hidden ? '' : 'hidden';
    $('soloSend').disabled = !!(pad && pad.sent()) || !ready;
    $('soloUndo').disabled = !!(pad && pad.sent()) || !ready;
    if (pad) pad.redraw();
  }

  pads.solo = makePad($('soloPad'), {
    canDraw: function () { return !$('solo').hidden && solo && solo.phase === 'draw'; },
    strokes: function () { return solo ? solo.strokes : []; },
    onChange: soloRefresh
  });

  function openSolo(existing) {
    hideAll();
    $('solo').hidden = false;
    if (existing) {
      solo = OS.fresh(['local'], { names: { local: 'You' }, seq: existing.seq || 0 });
      solo.strokes = (existing.strokes || []).map(function (s, i) {
        return {
          n: s.n != null ? s.n : i,
          by: s.by || 'local',
          pts: s.pts,
          c: s.c,
          w: s.w
        };
      });
      solo.title = existing.title || '';
      solo.seq = existing.seq || solo.strokes.length;
    } else if (!solo) {
      solo = OS.fresh(['local'], { names: { local: 'You' } });
    }
    $('soloTitleIn').value = solo.title || '';
    if (pads.solo) {
      pads.solo.clearPending();
      pads.solo.stopPlay();
    }
    soloRefresh();
  }

  $('soloUndo').onclick = function () { pads.solo.undo(); };
  $('soloSend').onclick = function () {
    if (!solo) return;
    var p = pads.solo.pending();
    if (!p || !p.pts || p.pts.length < 2) return;
    var intent = { kind: 'stroke', seq: solo.seq, pts: p.pts, c: p.c, w: p.w };
    var next = OS.applyIntent(solo, 'local', intent);
    if (!next) return;
    solo = next;
    pads.solo.clearPending();
    pads.solo.play('arrive');
    soloSave();
    soloRefresh();
  };
  $('soloPlay').onclick = function () {
    var on = pads.solo.play('loop');
    $('soloPlay').textContent = on ? 'Stop loop' : 'Play loop';
    soloRefresh();
  };
  $('soloNew').onclick = function () {
    solo = OS.fresh(['local'], { names: { local: 'You' } });
    $('soloTitleIn').value = '';
    pads.solo.clearPending();
    pads.solo.stopPlay();
    $('soloPlay').textContent = 'Play loop';
    soloSave();
    soloRefresh();
  };
  $('soloTitleIn').addEventListener('change', function () {
    if (!solo) return;
    solo.title = OS.sanitizeTitle(this.value);
    soloSave();
    soloRefresh();
  });
  $('soloTitleForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('soloTitleIn').dispatchEvent(new Event('change'));
  });

  // ---- multiplayer ----
  // gifos.room seats up to eight people, keeps who is here and the line. Turns are "free" in the room because the
  // room cannot skip an open seat; the picture's own `turn` (a seat index) skips them. The picture is one record the
  // mover writes with gifos.room.move ('picture'). Votes are plain rows in 'room', one per person (their room id),
  // so two people voting at once never overwrite each other; only held seats count.
  var EN = { needsNewer: 'One Stroke needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var picDb = null;
  try { if (window.gifos) picDb = gifos.db('picture'); } catch (e) {}
  var mp = { on: false, rs: null, joined: false, picked: false, note: '', remote: null, picture: null, votes: {}, autoPlay: '', _seenN: -1, settled: '' };
  var _items = [];

  function curPic() { return mp.picture || OS.fresh(); }
  function seatList() { return (mp.rs && mp.rs.seats) || []; }
  function heldArr() { return seatList().map(function (x) { return !!x.id; }); }
  function heldIds() { return seatList().filter(function (x) { return x.id; }).map(function (x) { return x.id; }); }
  function myId() { return mp.rs && mp.rs.me ? mp.rs.me.id : null; }
  function mySeatIdx() {
    var r = mp.rs, i;
    if (!r || !r.me || !r.me.seat) return -1;
    for (i = 0; i < r.seats.length; i++) if (r.seats[i].seat === r.me.seat) return i;
    return -1;
  }
  function nameOfId(id) {
    var s = seatList(), i;
    for (i = 0; i < s.length; i++) if (s[i].id === id) return (s[i].name || 'Player') + (s[i].here === 'away' ? ' …' : '');
    return 'Player';
  }
  function bothHeld() { return heldIds().length >= 2; }
  function actorIdx() { return OS.actorIndex(curPic(), heldArr()); }
  function actorRow() { var i = actorIdx(); return i >= 0 ? seatList()[i] : null; }
  function myTurn() {
    var pic = curPic();
    return ROOM && mp.on && pic.phase === 'draw' && bothHeld() && mySeatIdx() >= 0 && actorIdx() === mySeatIdx();
  }
  function say(e) { mp.note = e && e.message ? e.message : ''; mpRender(); }
  function mpPut(rec, fresh) {
    mp.picture = rec;
    mpRender();
    var p = fresh ? gifos.room.newRound('picture', rec) : gifos.room.move('picture', rec);
    return p.catch(function (e) { mp.picture = mp.remote; pads.f.clearPending(); say(e); });
  }
  function voteKey(pic) { return (pic.round || 1) + ':' + pic.strokes.length; }
  // the votes of held seats for this vote: { id: title }
  function votesNow() {
    var pic = curPic(), key = voteKey(pic), held = heldIds(), out = {}, i, it;
    for (i = 0; i < _items.length; i++) {
      it = _items[i];
      if (it && it.key === key && held.indexOf(it.id) >= 0 && it.title) out[it.id] = it.title;
    }
    return out;
  }

  function oldNote() { $('roomNote').textContent = T('needsNewer'); $('roomNote').hidden = false; }
  $('solo').addEventListener('pointerdown', function () { mp.picked = true; });
  $('solo').addEventListener('click', function () { mp.picked = true; });
  $('soloFriends').onclick = function () { mp.picked = true; mpEnter(); };

  function mpEnter() {
    if (!ROOM) { oldNote(); return; }
    mp.on = true;
    hideAll();
    $('friend').hidden = false;
    $('soloFriends').hidden = true;
    $('fLeave').hidden = false;
    setChip('ready', 'A friend');
    pads.f.clearPending();
    pads.f.stopPlay();
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
    if (ROOM) { mp.joined = false; gifos.room.leave().catch(function () {}); }
    $('soloFriends').hidden = false;
    $('fLeave').hidden = true;
    openSolo(solo);
  }
  $('fLeave').onclick = mpLeave;

  // After every change of the room or the data: show it, play what arrived, and finish a vote that is complete.
  function mpAfter() {
    if (!mp.on) return;
    var pic = curPic(), me = myId();
    if (mp.picture && pic.strokes.length) {
      var last = pic.strokes[pic.strokes.length - 1];
      if (pads.f.sent() && last && last.by === me) { pads.f.clearPending(); pads.f.play('arrive'); }
      else if (last && last.by !== me && mp._seenN !== last.n && pic.phase === 'draw') { mp._seenN = last.n; pads.f.play('arrive'); }
    }
    if (pic.phase === 'vote' && mySeatIdx() >= 0) {
      var next = OS.settle(pic, votesNow(), heldIds());
      var key = voteKey(pic);
      if (next && mp.settled !== key) { mp.settled = key; mpPut(next); return; }
    }
    mpRender();
  }

  pads.f = makePad($('fPad'), {
    canDraw: function () { return mp.on && myTurn(); },
    strokes: function () { return curPic().strokes; },
    onChange: mpRender
  });

  function mpPlayStroke() {
    var pic = curPic();
    var p = pads.f.pending();
    if (!myTurn() || !p || p.pts.length < 2) return;
    var next = OS.addStroke(pic, mySeatIdx(), myId(), { pts: p.pts, c: p.c, w: p.w }, heldArr());
    if (!next) { pads.f.clearPending(); return; }
    pads.f.markSent();
    mpPut(next);
  }

  $('fUndo').onclick = function () { pads.f.undo(); };
  $('fSend').onclick = mpPlayStroke;
  // a smooth random line sent as your stroke, for a turn you would rather not draw
  $('fRandom').onclick = function () {
    if (!myTurn() || pads.f.sent()) return;
    var pts = OS.randomLine();
    var next = pts && OS.addStroke(curPic(), mySeatIdx(), myId(), { pts: pts, c: color, w: width }, heldArr());
    if (!next) return;
    pads.f.clearPending();
    pads.f.markSent();
    mpPut(next);
  };
  $('fPlay').onclick = function () {
    var on = pads.f.play('loop');
    $('fPlay').textContent = on ? 'Stop loop' : 'Play loop';
    mpRender();
  };
  $('fAgain').onclick = function () {
    var next = OS.another(curPic());
    if (!next || mySeatIdx() < 0) return;
    mpPut(next);
  };
  $('fNew').onclick = function () {
    var pic = curPic();
    if (mySeatIdx() < 0) return;
    pads.f.clearPending();
    mpPut(OS.fresh({ suggestions: pic.suggestions }), true);
  };

  function voteFor(title) {
    var pic = curPic();
    if (!ROOM || pic.phase !== 'vote' || mySeatIdx() < 0 || !mp.rs.me) return;
    title = OS.sanitizeTitle(title);
    if (!title) return;
    gifos.db('room').put({ id: myId(), key: voteKey(pic), title: title }).catch(function () {});
  }
  $('fVoteForm').addEventListener('submit', function (e) {
    e.preventDefault();
    voteFor($('fVoteIn').value);
  });

  function paintVotes(pic) {
    var box = $('fVoteList');
    box.innerHTML = '';
    var mine = votesNow()[myId()] || '';
    (pic.suggestions || OS.SUGGESTIONS).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      if (mine === t) b.className = 'on';
      b.addEventListener('click', function () { voteFor(t); });
      box.appendChild(b);
    });
  }

  function mpRender() {
    if (!mp.on) return;
    var pic = curPic(), status = $('fStatus'), r = mp.rs;
    var hint = $('fHint'), wait = $('fWait');
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to solo
    $('fLeave').hidden = !!(r && r.live);
    var seatIdx = mySeatIdx();
    var seat = seatIdx;
    var aIdx = actorIdx(), aRow = aIdx >= 0 ? seatList()[aIdx] : null;
    var waiting = (r && r.line) || [];
    var n = (pic.strokes || []).length;
    var both = bothHeld();
    $('fSeats').innerHTML = seatList().filter(function (x) { return x.id; }).map(function (x) {
      var mine = x.id === myId();
      var turn = both && pic.phase === 'draw' && aRow && aRow.id === x.id;
      var label = mine ? 'You' : esc((x.name || 'Player') + (x.here === 'away' ? ' …' : ''));
      return '<div class="seat' + (mine ? ' me' : '') + (turn ? ' turn' : '') + '">' + label + '</div>';
    }).join('') || '<div class="seat"><span class="open">open</span></div>';
    $('fQueue').textContent = waiting.length
      ? ('Watching: ' + waiting.map(function (p) { return p.name || 'Player'; }).join(', '))
      : '';
    $('fQueue').hidden = !waiting.length;
    var pending = pads.f.pending();
    var ready = pending && pending.pts && pending.pts.length >= 2;
    var mineNow = myTurn();
    $('fPaper').classList.toggle('locked', !mineNow);
    $('fPaper').classList.toggle('mine', mineNow && !ready && !pads.f.playing());
    $('fSend').disabled = !(mineNow && ready) || pads.f.sent();
    $('fUndo').disabled = !ready || pads.f.sent();
    $('fRandom').hidden = !(mineNow && !pads.f.sent());
    // colour and width are for the stroke you have drawn: pick them while it is still yours to change
    $('fInk').hidden = !(mineNow && ready && !pads.f.sent()); $('fWidths').hidden = $('fInk').hidden;
    $('fAgain').hidden = pic.phase !== 'play' || seat < 0;
    $('fNew').hidden = (pic.phase !== 'play' && pic.phase !== 'vote') || seat < 0;
    $('fVote').hidden = pic.phase !== 'vote' || seat < 0;

    hint.hidden = true;
    wait.hidden = true;

    $('friend').classList.toggle('waiting', !both);
    if (mp.note) {
      setStatus(status, mp.note, '');
    } else if (r && r.me && r.me.role === 'asking') {
      setStatus(status, 'Waiting for the host to let you in…', '');
      setChip('wait', 'Asking');
      setControls('fControls', n ? 'idle' : 'empty');
    } else if (!both) {
      status.innerHTML = 'Press <b>Invite</b> in the bar above. The people who open the link sit here.';
      setChip('wait', 'Waiting');
      wait.hidden = false;
      $('fWaitName').textContent = 'Invite is the studio';
      $('fWaitMsg').textContent = 'Send the link from the bar above. Everyone who opens it sits at the same page.';
      setControls('fControls', 'empty');
    } else if (pic.phase === 'vote') {
      paintVotes(pic);
      var myVote = votesNow()[myId()];
      if (seat < 0) setStatus(status, 'Spectating the vote.', '');
      else if (myVote) setStatus(status, 'You voted. Waiting for the others.', '');
      else setStatus(status, 'Name this picture.', 'turn');
      setChip('turn', 'Title');
      setControls('fControls', n ? 'idle' : 'empty');
    } else if (pic.phase === 'play') {
      var ttl = pic.title ? ('“' + pic.title + '”') : 'The picture';
      setStatus(status, ttl + ' — arriving, in order.', 'good');
      setChip('ready', pic.title || 'Loop');
      setControls('fControls', 'play');
      var pk = pic.round + ':' + n;
      if (mp.autoPlay !== pk) {
        mp.autoPlay = pk;
        if (!pads.f.playing()) {
          pads.f.play('loop');
          $('fPlay').textContent = 'Stop loop';
        }
      }
    } else if (seat < 0) {
      setStatus(status, 'Spectating.', '');
      setChip('wait', 'Watching');
      setControls('fControls', n ? 'idle' : 'empty');
    } else if (mineNow) {
      if (ready) {
        setStatus(status, 'Undo, or send this stroke.', 'turn');
        setChip('turn', 'Your stroke');
        setControls('fControls', 'pending');
      } else {
        setStatus(status, n ? 'Your turn. One line.' : 'Your turn. Draw one line.', 'turn');
        setChip('turn', 'Your turn');
        if (!n && !pads.f.playing()) {
          hint.hidden = false;
          hint.querySelector('b').textContent = 'Your turn. One line.';
          hint.querySelector('span').textContent = 'Lift, then send it. Nobody else may draw until you do.';
        }
        setControls('fControls', n ? 'idle' : 'empty');
      }
    } else if (aRow) {
      setStatus(status, 'Waiting for ' + (aRow.name || 'Player') + (aRow.here === 'away' ? ' (reconnecting)' : '') + '…');
      setChip('wait', aRow.name || 'Player');
      wait.hidden = false;
      $('fWaitName').textContent = aRow.name || 'Player';
      $('fWaitMsg').textContent = 'is drawing the next line';
      setControls('fControls', n ? 'idle' : 'empty');
    } else {
      setStatus(status, 'Waiting…');
      setControls('fControls', n ? 'idle' : 'empty');
    }
    if (pads.f.playing()) {
      $('fPlay').textContent = 'Stop loop';
      setControls('fControls', 'play');
      hint.hidden = true;
    } else {
      $('fPlay').textContent = 'Play loop';
    }
    status.style.visibility = (!hint.hidden || !wait.hidden) ? 'hidden' : '';
    pads.f.redraw();
  }

  if (ROOM) {
    if (picDb) picDb.subscribe(function (items) {
      var b = null, i;
      for (i = 0; i < (items || []).length; i++) if (items[i] && items[i].id === 'picture') b = items[i];
      mp.remote = b; mp.picture = b; mp.note = '';
      mpAfter();
    });
    gifos.db('room').subscribe(function (items) { _items = items || []; mpAfter(); });
    gifos.room.subscribe(function (s) {
      mp.rs = s; mp.note = '';   // a refusal's note goes with the next room state
      // with other people here the shared page is what you see; alone you start on the solo page
      if (!mp.on && !mp.picked && s.live && !$('solo').hidden && !(solo && solo.strokes && solo.strokes.length)) { mpEnter(); return; }
      if (mp.on) mpJoin();
      mpAfter();
    });
  } else {
    oldNote();
  }

  // Read-only, for the room kit: the shared picture only.
  window['__one-stroke'] = {
    state: function () {
      var p = mp.remote;
      return p ? { strokes: p.strokes.map(function (s) { return s.by + ':' + s.pts.length; }).join(','), phase: p.phase, round: p.round, title: p.title, turn: p.turn } : { strokes: '', phase: 'draw', round: 1, title: '', turn: 0 };
    }
  };

  window.addEventListener('resize', function () {
    if (!$('solo').hidden) pads.solo.redraw();
    if (!$('friend').hidden) pads.f.redraw();
  });

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('friend').hidden && !(mp.rs && mp.rs.live)) mpLeave();
  });

  setChip('turn', 'Your turn');
  if (saveDb) {
    saveDb.get('doodle').then(function (g) {
      if (g && g.strokes && g.strokes.length) openSolo(g);
      else openSolo(null);
    }).catch(function () { openSolo(null); });
  } else {
    openSolo(null);
  }
})();
