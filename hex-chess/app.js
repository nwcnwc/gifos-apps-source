// Hex Chess — Gliński board. Computer thinks here. A friend sits the other colour via gifos.room.
// Invite is OS chrome. Seats and turns come from gifos.room; the mover writes the whole next board.
(function () {
  'use strict';
  var C = window.HEX;
  var $ = function (id) { return document.getElementById(id); };
  var nowMs = function () { return Date.now ? Date.now() : 0; };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var HEX_FILL = ['#f3d5a0', '#d18a32', '#7a4316'];
  var HEX_HI = ['#fbe7c2', '#e0a04a', '#8e5220'];
  var HEX_STROKE = 'rgba(40, 18, 6, .55)';
  var state = {
    mode: 'cpu', color: 'white',
    s: null, hist: [], over: false, thinking: false, sel: null, flip: false,
    lastSan: ''
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
    $('cpuNote').textContent = state.color === 'white'
      ? 'You play white and go first. The computer plays black. It thinks on this device.'
      : 'You play black. The computer plays white, and goes first.';
  });

  function layout(cssW, cssH) {
    var halfW = 1.5 * C.N + 1.55;
    var halfH = Math.sqrt(3) * (C.N + 1.05);
    var pad = Math.max(8, Math.min(cssW, cssH) * 0.02);
    var size = Math.min((cssW - 2 * pad) / (2 * halfW),
                        (cssH - 2 * pad) / (2 * halfH));
    return { size: size, cx: cssW / 2, cy: cssH / 2 };
  }
  function screenOf(g, q, r, flip) {
    if (flip) { q = -q; r = -r; }
    var p = C.pixel(q, r, g.size);
    return { x: g.cx + p.x, y: g.cy - p.y };
  }
  function hexPath(ctx, x, y, size) {
    var i, a;
    ctx.beginPath();
    for (i = 0; i < 6; i++) {
      a = Math.PI / 3 * i;
      if (i === 0) ctx.moveTo(x + size * Math.cos(a), y + size * Math.sin(a));
      else ctx.lineTo(x + size * Math.cos(a), y + size * Math.sin(a));
    }
    ctx.closePath();
  }
  function resizeCanvas(canvas) {
    var cssW = canvas.clientWidth || 448;
    var cssH = canvas.clientHeight || Math.round(cssW * 700 / 640);
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { cssW: cssW, cssH: cssH };
  }
  function hitHex(canvas, ev, flip) {
    var rect = canvas.getBoundingClientRect();
    var t = ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0]
          : (ev.touches && ev.touches[0] ? ev.touches[0] : ev);
    var x = t.clientX - rect.left, y = t.clientY - rect.top;
    var g = layout(rect.width, rect.height);
    var lx = x - g.cx, ly = g.cy - y;
    var h = C.atPixel(lx, ly, g.size);
    if (!h) return null;
    if (flip) return { q: -h.q, r: -h.r };
    return h;
  }

  function piecePath(ctx, t) {
    ctx.beginPath();
    if (t === C.P) {
      ctx.moveTo(-6.2, 8.6); ctx.lineTo(6.2, 8.6); ctx.lineTo(5.2, 6.6);
      ctx.quadraticCurveTo(3.2, 5.2, 3.0, 2.4);
      ctx.quadraticCurveTo(5.2, 0.6, 3.4, -1.2);
      ctx.quadraticCurveTo(2.2, -4.8, 0, -5.4);
      ctx.quadraticCurveTo(-2.2, -4.8, -3.4, -1.2);
      ctx.quadraticCurveTo(-5.2, 0.6, -3.0, 2.4);
      ctx.quadraticCurveTo(-3.2, 5.2, -5.2, 6.6);
      ctx.closePath();
    } else if (t === C.ROOK) {
      ctx.moveTo(-7.2, 8.8); ctx.lineTo(7.2, 8.8); ctx.lineTo(6.0, 6.4);
      ctx.lineTo(6.0, 1.6); ctx.lineTo(7.4, 1.6); ctx.lineTo(7.4, -5.8);
      ctx.lineTo(4.6, -5.8); ctx.lineTo(4.6, -3.6); ctx.lineTo(1.6, -3.6);
      ctx.lineTo(1.6, -5.8); ctx.lineTo(-1.6, -5.8); ctx.lineTo(-1.6, -3.6);
      ctx.lineTo(-4.6, -3.6); ctx.lineTo(-4.6, -5.8); ctx.lineTo(-7.4, -5.8);
      ctx.lineTo(-7.4, 1.6); ctx.lineTo(-6.0, 1.6); ctx.lineTo(-6.0, 6.4);
      ctx.closePath();
    } else if (t === C.NIGHT) {
      ctx.moveTo(-6.8, 8.8); ctx.lineTo(6.2, 8.8); ctx.lineTo(5.0, 6.6);
      ctx.lineTo(3.2, 4.4); ctx.lineTo(3.4, 1.0);
      ctx.lineTo(7.6, -0.8); ctx.lineTo(8.6, -3.0); ctx.lineTo(6.2, -2.6);
      ctx.lineTo(5.0, -5.2); ctx.lineTo(3.0, -9.0); ctx.lineTo(0.6, -8.4);
      ctx.lineTo(1.4, -5.6); ctx.lineTo(-1.6, -6.2);
      ctx.lineTo(-4.2, -3.0); ctx.lineTo(-6.2, 0.2);
      ctx.lineTo(-6.8, 3.4); ctx.lineTo(-5.4, 6.4);
      ctx.closePath();
    } else if (t === C.BISHOP) {
      ctx.moveTo(-6.2, 8.8); ctx.lineTo(6.2, 8.8); ctx.lineTo(5.0, 6.8);
      ctx.lineTo(3.4, 6.8); ctx.quadraticCurveTo(3.6, 3.2, 3.0, 0.6);
      ctx.quadraticCurveTo(5.4, -2.8, 2.2, -6.6);
      ctx.arc(0, -7.6, 2.4, 0.9, Math.PI - 0.9, true);
      ctx.quadraticCurveTo(-5.4, -2.8, -3.0, 0.6);
      ctx.quadraticCurveTo(-3.6, 3.2, -3.4, 6.8);
      ctx.lineTo(-5.0, 6.8);
      ctx.closePath();
    } else if (t === C.QUEEN) {
      ctx.moveTo(-7.0, 8.8); ctx.lineTo(7.0, 8.8); ctx.lineTo(5.6, 6.4);
      ctx.lineTo(6.2, 2.2);
      ctx.lineTo(8.2, -4.6); ctx.lineTo(4.4, -1.8);
      ctx.lineTo(2.6, -7.6); ctx.lineTo(0, -2.4);
      ctx.lineTo(-2.6, -7.6); ctx.lineTo(-4.4, -1.8);
      ctx.lineTo(-8.2, -4.6); ctx.lineTo(-6.2, 2.2);
      ctx.lineTo(-5.6, 6.4); ctx.closePath();
    } else {
      ctx.moveTo(-7.0, 8.8); ctx.lineTo(7.0, 8.8); ctx.lineTo(5.6, 6.4);
      ctx.lineTo(5.4, 2.8); ctx.lineTo(7.2, 2.8); ctx.lineTo(7.2, 0.6);
      ctx.lineTo(5.4, 0.6); ctx.lineTo(5.4, -1.4); ctx.lineTo(2.2, -1.4);
      ctx.lineTo(2.2, -4.6); ctx.lineTo(4.0, -4.6); ctx.lineTo(4.0, -6.6);
      ctx.lineTo(2.2, -6.6); ctx.lineTo(2.2, -8.6); ctx.lineTo(-2.2, -8.6);
      ctx.lineTo(-2.2, -6.6); ctx.lineTo(-4.0, -6.6); ctx.lineTo(-4.0, -4.6);
      ctx.lineTo(-2.2, -4.6); ctx.lineTo(-2.2, -1.4); ctx.lineTo(-5.4, -1.4);
      ctx.lineTo(-5.4, 0.6); ctx.lineTo(-7.2, 0.6); ctx.lineTo(-7.2, 2.8);
      ctx.lineTo(-5.4, 2.8); ctx.lineTo(-5.6, 6.4); ctx.closePath();
    }
  }
  function drawPiece(ctx, x, y, piece, hexR) {
    var t = C.ptype(piece), w = piece > 0, s = hexR * 0.95;
    ctx.save();
    ctx.translate(x, y + hexR * 0.08);
    ctx.scale(s / 20, s / 20);
    piecePath(ctx, t);
    ctx.fillStyle = w ? '#f7f1e2' : '#16161c';
    ctx.strokeStyle = w ? 'rgba(48, 28, 10, .82)' : 'rgba(236, 220, 190, .92)';
    ctx.lineWidth = w ? 1.2 : 1.45;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fill();
    ctx.stroke();
    if (t === C.BISHOP) {
      ctx.beginPath();
      ctx.moveTo(-1.1, -1.2); ctx.lineTo(1.1, -4.8);
      ctx.moveTo(-1.6, -3.4); ctx.lineTo(1.8, -2.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function paint(canvas, s, opts) {
    opts = opts || {};
    var sz = resizeCanvas(canvas);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    var W = sz.cssW, H = sz.cssH, flip = !!opts.flip;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(0, 0, W, H);
    var g = layout(W, H);
    var hexR = g.size * 0.98;
    var legal = {}, caps = {}, i, m, k, h, p, piece, last, sel, col, pt, grd;
    if (opts.hints && s && !s.winner && opts.selected) {
      m = C.legalMoves(s);
      for (i = 0; i < m.length; i++) {
        if (m[i].fq === opts.selected.q && m[i].fr === opts.selected.r) {
          legal[C.key(m[i].tq, m[i].tr)] = 1;
          if (m[i].cap || m[i].ep) caps[C.key(m[i].tq, m[i].tr)] = 1;
        }
      }
    }
    for (i = 0; i < C.HEXES.length; i++) {
      h = C.HEXES[i];
      pt = screenOf(g, h.q, h.r, flip);
      col = C.hexColor(h.q, h.r);
      hexPath(ctx, pt.x, pt.y, hexR);
      grd = ctx.createLinearGradient(pt.x, pt.y - hexR, pt.x, pt.y + hexR);
      grd.addColorStop(0, HEX_HI[col]);
      grd.addColorStop(1, HEX_FILL[col]);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = HEX_STROKE;
      ctx.lineWidth = Math.max(0.7, g.size * 0.035);
      ctx.stroke();
    }
    if (s && s.last) {
      last = s.last;
      [[last.fq, last.fr], [last.tq, last.tr]].forEach(function (pr) {
        pt = screenOf(g, pr[0], pr[1], flip);
        hexPath(ctx, pt.x, pt.y, hexR * 0.94);
        ctx.fillStyle = 'rgba(232, 197, 71, .42)';
        ctx.fill();
      });
    }
    // file letters along the viewer's near edge; ranks on the left rim
    ctx.font = '600 ' + Math.max(9, Math.round(g.size * 0.32)) + 'px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(240, 228, 200, .72)';
    var leftFile = flip ? C.N : -C.N;
    for (i = 0; i < C.HEXES.length; i++) {
      h = C.HEXES[i];
      var south = !C.inBoard(h.q, h.r + (flip ? 1 : -1));
      pt = screenOf(g, h.q, h.r, flip);
      if (south) ctx.fillText(C.FILES[h.q + C.N], pt.x, pt.y + hexR * 1.32);
      if (h.q === leftFile) ctx.fillText(String(C.rankOf(h.q, h.r)), pt.x - hexR * 1.22, pt.y);
      else if ((!flip && h.r === C.N && h.q < 0) || (flip && h.r === -C.N && h.q > 0)) {
        ctx.fillText(String(C.rankOf(h.q, h.r)), pt.x - hexR * 1.18, pt.y);
      }
    }
    for (k in legal) {
      if (!Object.prototype.hasOwnProperty.call(legal, k)) continue;
      p = k.split(',');
      pt = screenOf(g, +p[0], +p[1], flip);
      if (caps[k]) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, hexR * 0.72, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 236, 170, .95)';
        ctx.lineWidth = Math.max(2.4, g.size * 0.09);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, Math.max(6.5, hexR * 0.30), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 226, 140, .92)';
        ctx.fill();
      }
    }
    sel = opts.selected;
    if (s) {
      for (k in s.pieces) {
        piece = s.pieces[k];
        if (!piece) continue;
        p = k.split(',');
        pt = screenOf(g, +p[0], +p[1], flip);
        if (sel && sel.q === +p[0] && sel.r === +p[1]) {
          hexPath(ctx, pt.x, pt.y, hexR * 0.96);
          ctx.strokeStyle = '#1ccdd3';
          ctx.lineWidth = Math.max(2.4, g.size * 0.09);
          ctx.stroke();
        }
        drawPiece(ctx, pt.x, pt.y, piece, hexR);
      }
    }
    if (s && (s.check || s.result === 'checkmate')) {
      var kingSide = s.result === 'checkmate'
        ? (s.winner === C.WHITE ? C.BLACK : C.WHITE)
        : s.turn;
      var king = C.findKing(s.pieces, kingSide);
      if (king) {
        pt = screenOf(g, king.q, king.r, flip);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, hexR * 0.82, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 72, 64, .96)';
        ctx.lineWidth = Math.max(3, g.size * 0.12);
        ctx.stroke();
      }
    }
  }

  function paintCaps(el, s) {
    if (!el || !s) return;
    var miss = C.missingGlyphs(s.pieces), html = '', i, ch, n;
    html += '<span class="capw">';
    for (i = 0; i < miss.w.length; i++) {
      ch = miss.w.charAt(i);
      n = ({ P: C.P, N: C.NIGHT, B: C.BISHOP, R: C.ROOK, Q: C.QUEEN })[ch];
      html += C.pieceGlyph(C.pack(C.BLACK, n));
    }
    html += '</span><span class="capb">';
    for (i = 0; i < miss.b.length; i++) {
      ch = miss.b.charAt(i);
      n = ({ P: C.P, N: C.NIGHT, B: C.BISHOP, R: C.ROOK, Q: C.QUEEN })[ch];
      html += C.pieceGlyph(C.pack(C.WHITE, n));
    }
    html += '</span>';
    el.innerHTML = html;
  }
  function paintTurn(s, mode, youColor, thinking) {
    var w = $('whoWhite'), b = $('whoBlack');
    if (!w || !b) return;
    var wName = mode === 'cpu' ? (youColor === 'white' ? 'You' : 'Computer') : 'White';
    var bName = mode === 'cpu' ? (youColor === 'black' ? 'You' : 'Computer') : 'Black';
    w.textContent = '♔ ' + wName;
    b.textContent = '♚ ' + bName;
    var turn = s && !s.winner && !thinking ? C.colorName(s.turn) : '';
    w.className = 'who' + (turn === 'white' ? ' on' : '');
    b.className = 'who' + (turn === 'black' ? ' on' : '');
  }
  function paintBanner(s, mode, youColor) {
    var el = $('banner');
    if (!el) return;
    if (!s) { el.hidden = true; return; }
    if (s.result === 'checkmate') {
      var you = mode === 'cpu' && s.winner === C.colorNum(youColor);
      el.hidden = false;
      el.className = 'banner ' + (you ? 'good' : 'bad');
      el.textContent = you ? 'Checkmate — you win' : (mode === 'hotseat'
        ? (C.colorName(s.winner) === 'white' ? 'Checkmate — White wins' : 'Checkmate — Black wins')
        : 'Checkmate — the computer wins');
      return;
    }
    if (s.result === 'stalemate') {
      el.hidden = false;
      el.className = 'banner';
      el.textContent = resultText(s, mode, youColor);
      return;
    }
    if (s.check) {
      el.hidden = false;
      el.className = 'banner check';
      el.textContent = 'Check';
      return;
    }
    el.hidden = true;
  }

  function isHumanTurn() {
    if (!state.s || state.over || state.thinking) return false;
    if (state.mode === 'hotseat') return true;
    return C.colorName(state.s.turn) === state.color;
  }
  function resultText(s, mode, youColor) {
    if (!s.winner) return '';
    var side = C.colorName(s.winner);
    var name = side.charAt(0).toUpperCase() + side.slice(1);
    if (s.result === 'stalemate') {
      return mode === 'hotseat'
        ? ('Stalemate — ' + name + ' scores.')
        : (s.winner === C.colorNum(youColor) ? 'Stalemate — you score.' : 'Stalemate — the computer scores.');
    }
    if (mode === 'hotseat') return 'Checkmate — ' + name + ' wins.';
    return s.winner === C.colorNum(youColor) ? 'Checkmate — you win.' : 'Checkmate — the computer wins.';
  }
  function localStatus() {
    if (!state.s) return;
    paintTurn(state.s, state.mode, state.color, state.thinking);
    paintBanner(state.s, state.mode, state.color);
    paintCaps($('caps'), state.s);
    if (state.s.winner) {
      var you = state.mode === 'cpu' && state.s.winner === C.colorNum(state.color);
      setStatus($('statusLine'), resultText(state.s, state.mode, state.color), you ? 'good' : 'warn');
      return;
    }
    if (state.thinking) { setStatus($('statusLine'), 'Computer is thinking…', ''); return; }
    var who, last = state.lastSan ? state.lastSan + '. ' : '';
    if (state.mode === 'hotseat') {
      who = C.colorName(state.s.turn);
      who = who.charAt(0).toUpperCase() + who.slice(1);
      setStatus($('statusLine'), last + who + ' to play.', '');
    } else if (C.colorName(state.s.turn) === state.color) {
      setStatus($('statusLine'), last + 'Your turn.', '');
    } else {
      setStatus($('statusLine'), last + 'Computer to play.', '');
    }
  }
  function saveLocal() {
    if (!db) return;
    db.put({
      id: 'game', mode: state.mode, color: state.color,
      moves: state.hist.map(function (m) {
        return { fq: m.fq, fr: m.fr, tq: m.tq, tr: m.tr, promo: m.promo || 0 };
      }),
      lastSan: state.lastSan || '',
      over: state.over, at: nowMs()
    }).catch(function () {});
  }
  function afterLocal() {
    paint($('board'), state.s, { hints: isHumanTurn(), selected: state.sel, flip: state.flip });
    localStatus();
    saveLocal();
    if (!state.over && !state.thinking && state.mode === 'cpu' && C.colorName(state.s.turn) !== state.color) aiMove();
  }
  function applyLocal(fq, fr, tq, tr, promo) {
    if (!state.s || state.over) return false;
    var m = { fq: fq, fr: fr, tq: tq, tr: tr, promo: promo || 0 };
    var ns = C.play(state.s, fq, fr, tq, tr, promo || 0);
    if (!ns) return false;
    state.lastSan = C.san(state.s, m);
    state.hist.push({ fq: fq, fr: fr, tq: tq, tr: tr, promo: promo || 0, color: state.s.turn });
    state.s = ns;
    state.sel = null;
    if (ns.winner) { state.over = true; state.thinking = false; setChip('ready', 'Ready'); }
    return true;
  }

  var pendingPromo = null;
  function askPromo(color, done) {
    var box = $('promo'), row = $('promoRow');
    var types = [C.QUEEN, C.ROOK, C.BISHOP, C.NIGHT];
    row.innerHTML = '';
    types.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = C.pieceGlyph(C.pack(color, t));
      b.onclick = function () { box.hidden = true; done(t); };
      row.appendChild(b);
    });
    box.hidden = false;
  }
  function playLocal(fq, fr, tq, tr) {
    if (!state.s || state.over) return false;
    if (state.mode === 'cpu' && state.thinking && C.colorName(state.s.turn) === state.color) return false;
    var legal = C.legalMoves(state.s), i, m, needs = false, opts = [];
    for (i = 0; i < legal.length; i++) {
      m = legal[i];
      if (m.fq === fq && m.fr === fr && m.tq === tq && m.tr === tr) {
        opts.push(m);
        if (m.promo) needs = true;
      }
    }
    if (!opts.length) return false;
    if (needs) {
      pendingPromo = { fq: fq, fr: fr, tq: tq, tr: tr };
      askPromo(state.s.turn, function (t) {
        pendingPromo = null;
        if (applyLocal(fq, fr, tq, tr, t)) afterLocal();
      });
      return true;
    }
    if (!applyLocal(fq, fr, tq, tr, 0)) return false;
    afterLocal();
    return true;
  }
  function tapLocal(h) {
    if (!h || !isHumanTurn()) return;
    var s = state.s, k;
    if (state.sel && (state.sel.q !== h.q || state.sel.r !== h.r)) {
      if (playLocal(state.sel.q, state.sel.r, h.q, h.r)) return;
    }
    k = s.pieces[C.key(h.q, h.r)];
    if (k && C.owner(k) === s.turn) {
      var has = C.legalMoves(s).some(function (m) { return m.fq === h.q && m.fr === h.r; });
      if (has) {
        state.sel = (state.sel && state.sel.q === h.q && state.sel.r === h.r) ? null : { q: h.q, r: h.r };
        paint($('board'), s, { hints: true, selected: state.sel, flip: state.flip });
      }
    }
  }
  function aiMove() {
    if (!state.s || state.over || state.mode !== 'cpu' || state.thinking) return;
    if (C.colorName(state.s.turn) === state.color) return;
    state.thinking = true;
    state.sel = null;
    setChip('thinking', 'Thinking…');
    localStatus();
    paint($('board'), state.s, { hints: false, flip: state.flip });
    var startAt = nowMs();
    var snapshot = state.s;
    setTimeout(function () {
      if (!state.s || state.s !== snapshot || state.over || state.mode !== 'cpu') {
        state.thinking = false; return;
      }
      if (C.colorName(state.s.turn) === state.color) {
        state.thinking = false; setChip('ready', 'Ready'); afterLocal(); return;
      }
      var move = C.aiMove(state.s, 120);
      var wait = Math.max(0, 320 - (nowMs() - startAt));
      setTimeout(function () {
        if (!state.s || state.s !== snapshot || state.over || state.mode !== 'cpu') {
          state.thinking = false; return;
        }
        state.thinking = false;
        setChip('ready', 'Ready');
        if (!move || !applyLocal(move.fq, move.fr, move.tq, move.tr, move.promo || 0)) {
          localStatus(); paint($('board'), state.s, { hints: isHumanTurn(), selected: state.sel, flip: state.flip });
          return;
        }
        afterLocal();
      }, wait);
    }, 40);
  }
  function undoLocal() {
    if (!state.hist.length || state.thinking) return;
    state.hist.pop();
    if (state.mode === 'cpu' && state.hist.length) state.hist.pop();
    state.s = C.replay(state.hist);
    state.over = !!state.s.winner;
    state.thinking = false;
    state.sel = null;
    state.lastSan = state.s.last ? C.san(C.replay(state.hist.slice(0, -1)), {
      fq: state.s.last.fq, fr: state.s.last.fr, tq: state.s.last.tq, tr: state.s.last.tr,
      promo: state.s.last.promo, cap: state.s.last.cap, ep: state.s.last.ep
    }) : '';
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    afterLocal();
  }
  function newLocal() {
    state.s = C.fresh(); state.hist = []; state.over = false;
    state.thinking = false; state.sel = null; state.lastSan = '';
    state.flip = state.mode === 'cpu' && state.color === 'black';
    setChip('ready', state.mode === 'cpu' ? 'Ready' : 'Two players');
    $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
    afterLocal();
  }

  $('startBtn').onclick = function () { picked = true; newLocal(); };
  $('newBtn').onclick = function () {
    $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready');
    if ($('banner')) $('banner').hidden = true;
  };
  $('undoBtn').onclick = undoLocal;
  $('board').addEventListener('click', function (e) {
    tapLocal(hitHex(this, e, state.flip));
  });

  // ---- multiplayer: gifos.room ----
  // The room (manifest "room") owns who plays, who watches, whose turn it is, seat hold on reload and hand-off.
  // This app draws the board and writes the whole next board with gifos.room.move.
  var EN = { needsNewer: 'Hex Chess needs a newer GifOS to play together. Reload the page to update.' };
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
    return { id: 'board', moves: [], turn: 'white', winner: null, result: '', last: null };
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
  function viewSeat() { return alone() ? curBoard().turn : mySeat(); }
  function say(e) {
    note = e && e.message ? e.message : '';
    mpRender();
    setTimeout(function () { note = ''; mpRender(); }, 2500);
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
      rs = s;
      // with other people here, room play is what you see; alone you start on the menu
      if (!mp.on && !picked && s.live) { mpEnter(); return; }
      if (mp.on && !joined && s.me && s.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
      mpRender();
    });
  }

  function mpPlay(fq, fr, tq, tr, promo) {
    var b = curBoard();
    if (!canPlay()) return false;
    var s = C.replay(b.moves || []);
    var ns = C.play(s, fq, fr, tq, tr, promo || 0);
    if (!ns) return false;
    var nb = {
      id: 'board', moves: (b.moves || []).concat([{ fq: fq, fr: fr, tq: tq, tr: tr, promo: promo || 0 }]),
      turn: b.turn, winner: null, result: '', last: { fq: fq, fr: fr, tq: tq, tr: tr }
    };
    if (ns.winner) { nb.winner = C.colorName(ns.winner); nb.result = ns.result === 'stalemate' ? 'Stalemate' : 'Checkmate'; }
    else nb.turn = C.colorName(ns.turn);
    mp.board = nb; mp.sel = null; mpRender();
    gifos.room.move('board', nb).catch(say);
    return true;
  }
  $('fResign').onclick = function () {
    var b = curBoard();
    if (!canPlay() || b.winner) return;
    var nb = JSON.parse(JSON.stringify(b));
    nb.winner = b.turn === 'white' ? 'black' : 'white'; nb.result = 'Resigned';
    mp.board = nb; mpRender();
    gifos.room.move('board', nb).catch(say);
  };
  $('fNew').onclick = function () {
    if (!ROOM || !mySeat()) return;
    gifos.room.newRound('board', freshBoard(), { first: 'white' }).catch(say);
  };

  function mpTry(fq, fr, tq, tr) {
    var b = curBoard();
    if (!canPlay()) return false;
    var s = C.replay(b.moves || []);
    var legal = C.legalMoves(s), i, m, needs = false, found = false;
    for (i = 0; i < legal.length; i++) {
      m = legal[i];
      if (m.fq === fq && m.fr === fr && m.tq === tq && m.tr === tr) {
        found = true;
        if (m.promo) needs = true;
      }
    }
    if (!found) return false;
    if (needs) {
      askPromo(s.turn, function (t) { mpPlay(fq, fr, tq, tr, t); });
      return true;
    }
    return mpPlay(fq, fr, tq, tr, 0);
  }

  // Tap or key on a hex of the shared board.
  function mpHex(h) {
    var b = curBoard();
    if (!h || !canPlay()) return;
    var s = C.replay(b.moves || []);
    if (mp.sel && (mp.sel.q !== h.q || mp.sel.r !== h.r)) {
      if (mpTry(mp.sel.q, mp.sel.r, h.q, h.r)) { mp.sel = null; mpRender(); return; }
    }
    var piece = s.pieces[C.key(h.q, h.r)];
    if (piece && C.owner(piece) === s.turn) {
      var has = C.legalMoves(s).some(function (m) { return m.fq === h.q && m.fr === h.r; });
      if (has) {
        mp.sel = (mp.sel && mp.sel.q === h.q && mp.sel.r === h.r) ? null : { q: h.q, r: h.r };
        mpRender();
      }
    }
  }
  $('fBoard').addEventListener('click', function (e) {
    if (!canPlay()) return;
    mpHex(hitHex(this, e, viewSeat() === 'black'));
  });

  // Hexes you can act on (a piece that can move, where the selected piece may go) are real buttons over the canvas:
  // keyboard and screen readers play the board too.
  function mpHits(s, flip) {
    var box = $('fHits'), cv = $('fBoard');
    box.innerHTML = '';
    if (!canPlay()) return;
    var g = layout(cv.clientWidth || 448, cv.clientHeight || Math.round((cv.clientWidth || 448) * 700 / 640));
    var spots = {}, ms = C.legalMoves(s), i, m;
    for (i = 0; i < ms.length; i++) {
      m = ms[i];
      if (!mp.sel) spots[C.key(m.fq, m.fr)] = { q: m.fq, r: m.fr, t: 'Move this piece' };
      else if (m.fq === mp.sel.q && m.fr === mp.sel.r) spots[C.key(m.tq, m.tr)] = { q: m.tq, r: m.tr, t: 'Move here' };
    }
    if (mp.sel) spots[C.key(mp.sel.q, mp.sel.r)] = { q: mp.sel.q, r: mp.sel.r, t: 'Unselect' };
    Object.keys(spots).forEach(function (k) {
      var sp = spots[k], pt = screenOf(g, sp.q, sp.r, flip), b = document.createElement('button');
      b.type = 'button'; b.className = 'hit'; b.setAttribute('aria-label', sp.t + ' ' + sp.q + ',' + sp.r);
      b.style.left = (cv.offsetLeft + pt.x - g.size * 0.8) + 'px';
      b.style.top = (cv.offsetTop + pt.y - g.size * 0.8) + 'px';
      b.style.width = b.style.height = (g.size * 1.6) + 'px';
      b.onclick = function (e) { e.stopPropagation(); mpHex({ q: sp.q, r: sp.r }); };
      box.appendChild(b);
    });
  }

  function mpRender() {
    if (!mp.on) return;
    var b = curBoard(), status = $('fStatus');
    var s = C.replay(b.moves || []);
    var seat = mySeat();
    if (!ROOM) {
      $('fSeats').innerHTML = ''; $('fQueue').textContent = '';
      status.textContent = T('needsNewer'); status.className = 'statusline warn';
      paint($('fBoard'), s, { hints: false, flip: false });
      $('fHits').innerHTML = ''; $('fResign').hidden = true; $('fNew').hidden = true;
      return;
    }
    status.className = 'statusline';
    var nameOf = function (name) {
      var x = seatOf(rs, name);
      return x.id ? esc(x.name || 'Player') + (x.here === 'away' ? ' …' : '') : '<span class="open">open</span>';
    };
    $('fSeats').innerHTML =
      '<div class="seat' + (seat === 'white' ? ' me' : '') + (b.turn === 'white' && !b.winner ? ' turn' : '') + '">♔ ' + nameOf('white') + '</div>' +
      '<div class="seat' + (seat === 'black' ? ' me' : '') + (b.turn === 'black' && !b.winner ? ' turn' : '') + '">♚ ' + nameOf('black') + '</div>';
    var role = rs && rs.me ? rs.me.role : 'watcher';
    var wait = (rs && rs.line ? rs.line : []).map(function (p) { return p.name || 'Player'; });
    $('fQueue').textContent = note || (role === 'waiting' ? 'You are in line for a seat.' : role === 'asking' ? 'Waiting for the host to seat you.' :
      (wait.length ? 'In line: ' + wait.join(', ') : ''));
    var tx = seatOf(rs, b.turn);
    if (b.winner) {
      var wx = seatOf(rs, b.winner);
      status.innerHTML = esc(b.result || 'Checkmate') + ' — ' + (wx.id && wx.name ? esc(wx.name) : b.winner) + ' wins.';
    } else if (canPlay()) {
      status.textContent = (s.check ? 'Check. ' : '') + (rs.live ? 'Your turn.' : (b.turn.charAt(0).toUpperCase() + b.turn.slice(1) + ' to play.'));
    } else if (!seat) {
      status.textContent = role === 'waiting' ? 'Waiting for a seat…' : 'Spectating.';
    } else if (tx.here === 'away') {
      status.textContent = (tx.name || b.turn) + ' is reconnecting…';
    } else if (!tx.id) {
      status.innerHTML = 'Waiting for another player… press <b>Invite</b> (top bar) to bring a friend.';
    } else {
      status.textContent = (s.check ? 'Check. ' : '') + 'Waiting for ' + (tx.name || b.turn) + '…';
    }
    var flip = viewSeat() === 'black';
    paint($('fBoard'), s, { hints: canPlay(), selected: mp.sel, flip: flip });
    mpHits(s, flip);
    // with others here the room (top-bar back, OS leave) is how you go; alone you may return to the menu
    $('fLeave').hidden = !!rs.live;
    $('fResign').hidden = !(canPlay() && (b.moves || []).length && !b.winner);
    $('fNew').hidden = !(seat && (b.winner || (!rs.live && (b.moves || []).length)));
  }

  // Read-only, for the room kit: the game only.
  window['__hex-chess'] = {
    state: function () {
      var b = mp.board;
      return { moves: b ? (b.moves || []).length : 0, turn: b ? b.turn : null, winner: b ? b.winner : null,
        last: b && b.moves && b.moves.length ? JSON.stringify(b.moves[b.moves.length - 1]) : '' };
    }
  };

  window.addEventListener('resize', function () {
    if (!$('game').hidden && state.s) paint($('board'), state.s, { hints: isHumanTurn(), selected: state.sel, flip: state.flip });
    if (!$('friend').hidden && mp.board) mpRender();
  });

  if (window.gifos && gifos.onBack) gifos.onBack(function () {
    if (!$('promo').hidden) { $('promo').hidden = true; return; }
    if (!$('friend').hidden) mpLeave();
    else if (!$('game').hidden) { $('game').hidden = true; $('setup').hidden = false; setChip('ready', 'Ready'); }
  });

  setChip('ready', 'Ready');
  if (!ROOM) { $('oldNote').textContent = T('needsNewer'); $('oldNote').hidden = false; }
  if (db) {
    db.get('game').then(function (g) {
      if (!g || !g.moves || !g.moves.length || g.over) return;
      state.mode = g.mode || 'cpu';
      state.color = g.color || 'white';
      state.hist = g.moves.slice();
      state.s = C.replay(state.hist);
      state.over = !!state.s.winner;
      state.lastSan = g.lastSan || '';
      state.flip = state.mode === 'cpu' && state.color === 'black';
      if (state.mode === 'hotseat') {
        $('modeSeg').querySelector('[data-mode="hotseat"]').click();
        setChip('ready', 'Two players');
      } else {
        $('modeSeg').querySelector('[data-mode="cpu"]').click();
        Array.prototype.forEach.call($('colorSeg').children, function (c) {
          c.classList.toggle('on', c.getAttribute('data-color') === state.color);
        });
      }
      $('setup').hidden = true; $('friend').hidden = true; $('game').hidden = false;
      afterLocal();
    }).catch(function () {});
  }
})();
