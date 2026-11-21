// One Stroke rules. A picture is an ordered stack of strokes. Each seat
// may add exactly one stroke per round; the room (gifos.room) says who sits
// where, the mover writes the whole picture. Classic script — no import/export.
(function (root) {
  'use strict';

  var MAX_PTS = 192;
  var MAX_SEATS = 8;
  var MAX_TITLE = 40;
  var COLORS = ['#f4efe6', '#e85d4c', '#f4c95d', '#6dce7a', '#6eb5ff', '#c9a0ff', '#ff8ad4'];
  var WIDTHS = [0.012, 0.022, 0.038];
  var SUGGESTIONS = [
    'A secret',
    'Two cats',
    'The weather',
    'A map',
    'Untitled',
    'After dark',
    'Something we made',
    'A small storm'
  ];

  function clone(p) {
    return JSON.parse(JSON.stringify(p));
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function clamp01(n) {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function legalPts(pts) {
    if (!pts || !pts.length || pts.length < 2 || pts.length > MAX_PTS) return null;
    var out = [], i, p, x, y, last, dx, dy;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
      x = clamp01(round3(p.x));
      y = clamp01(round3(p.y));
      last = out[out.length - 1];
      if (last) {
        dx = x - last.x;
        dy = y - last.y;
        if (dx * dx + dy * dy < 1e-10 && i !== pts.length - 1) continue;
      }
      out.push({ x: x, y: y });
    }
    return out.length >= 2 ? out : null;
  }

  function legalStroke(intent) {
    if (!intent) return null;
    if (COLORS.indexOf(intent.c) < 0) return null;
    if (WIDTHS.indexOf(intent.w) < 0) return null;
    var pts = legalPts(intent.pts);
    if (!pts) return null;
    return { pts: pts, c: intent.c, w: intent.w };
  }

  function sanitizeTitle(s) {
    if (typeof s !== 'string') return '';
    var t = s.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();
    if (t.length > MAX_TITLE) t = t.slice(0, MAX_TITLE).trim();
    return t;
  }

  // The picture is the one record a seated player writes with gifos.room.move. It names no people: seats come
  // from the room. `turn` is a seat INDEX; the actor is the first held seat at or after it (open seats are skipped).
  function fresh(opts) {
    opts = opts || {};
    return {
      id: 'picture',
      strokes: [],
      roundStart: 0,
      turn: 0,
      phase: 'draw',
      round: 1,
      title: '',
      suggestions: (opts.suggestions || SUGGESTIONS).slice(),
      startedAt: opts.now || 0
    };
  }

  // held: one entry per seat, truthy when somebody holds it
  function actorIndex(pic, held) {
    if (!pic || pic.phase !== 'draw' || !held || !held.length) return -1;
    var n = held.length, i, j;
    for (i = 0; i < n; i++) {
      j = (pic.turn + i) % n;
      if (held[j]) return j;
    }
    return -1;
  }

  function drewThisRound(pic, playerId) {
    var i;
    for (i = pic.roundStart || 0; i < pic.strokes.length; i++) {
      if (pic.strokes[i] && pic.strokes[i].by === playerId) return true;
    }
    return false;
  }

  // The next picture after seat `seat` (held by playerId) draws one stroke, or null when it is not legal.
  // The round ends (the vote starts) when nobody holds a later seat.
  function addStroke(pic, seat, playerId, intent, held) {
    if (!pic || pic.phase !== 'draw') return null;
    if (actorIndex(pic, held) !== seat) return null;
    if (drewThisRound(pic, playerId)) return null;
    var s = legalStroke(intent);
    if (!s) return null;
    var next = clone(pic), later = false, i;
    next.strokes = pic.strokes.concat([{ n: pic.strokes.length, by: playerId, pts: s.pts, c: s.c, w: s.w }]);
    next.turn = seat + 1;
    for (i = seat + 1; i < held.length; i++) if (held[i]) later = true;
    if (!later) { next.phase = 'vote'; next.turn = 0; }
    return next;
  }

  // The title the votes pick: most votes; ties go to a suggestion (in list order), then to the earlier word.
  // votes: { playerId: title } of held players only
  function winningTitle(votes, order, suggestions) {
    var counts = {}, i, id, t, best = '', bestN = 0;
    suggestions = suggestions || SUGGESTIONS;
    for (i = 0; i < order.length; i++) {
      id = order[i];
      t = votes[id];
      if (!t) continue;
      counts[t] = (counts[t] || 0) + 1;
    }
    function prefer(a, b) {
      var ia = suggestions.indexOf(a);
      var ib = suggestions.indexOf(b);
      if (ia >= 0 && ib < 0) return true;
      if (ia < 0 && ib >= 0) return false;
      if (ia >= 0 && ib >= 0) return ia < ib;
      return a < b;
    }
    for (t in counts) {
      if (!Object.prototype.hasOwnProperty.call(counts, t)) continue;
      if (counts[t] > bestN || (counts[t] === bestN && prefer(t, best))) {
        bestN = counts[t];
        best = t;
      }
    }
    return best || 'Untitled';
  }

  // The vote is over when every held seat has voted. Returns the next picture, or null while someone has not.
  function settle(pic, votes, order) {
    if (!pic || pic.phase !== 'vote' || !order.length) return null;
    var i;
    for (i = 0; i < order.length; i++) if (!votes[order[i]]) return null;
    var next = clone(pic);
    next.title = winningTitle(votes, order, pic.suggestions);
    next.phase = 'play';
    return next;
  }

  function another(pic) {
    if (!pic || pic.phase !== 'play') return null;
    var next = clone(pic);
    next.phase = 'draw';
    next.turn = 0;
    next.round = (pic.round || 1) + 1;
    next.roundStart = next.strokes.length;
    return next;
  }

  // A smooth random line (for a player who would rather not draw), in 0..1.
  function randomLine(rand) {
    rand = rand || Math.random;
    var pts = [], n = 24, i, x0 = 0.15 + rand() * 0.2, y0 = 0.15 + rand() * 0.7, x1 = 0.65 + rand() * 0.2, y1 = 0.15 + rand() * 0.7, bend = (rand() - 0.5) * 0.5, t;
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * bend });
    }
    return legalPts(pts);
  }

  function playback(picOrStrokes) {
    var list = Array.isArray(picOrStrokes)
      ? picOrStrokes
      : ((picOrStrokes && picOrStrokes.strokes) || []);
    return list.slice().sort(function (a, b) {
      var na = (a && a.n != null) ? a.n : 0;
      var nb = (b && b.n != null) ? b.n : 0;
      if (na !== nb) return na - nb;
      return 0;
    });
  }

  function pathLen(pts) {
    var n = 0, i;
    for (i = 1; i < (pts || []).length; i++) {
      n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return n;
  }

  function compactPts(pts) {
    var out = [], i, p, x, y, last, dx, dy;
    for (i = 0; i < (pts || []).length && out.length < MAX_PTS; i++) {
      p = pts[i];
      if (!p) continue;
      x = clamp01(round3(+p.x));
      y = clamp01(round3(+p.y));
      last = out[out.length - 1];
      if (last) {
        dx = x - last.x;
        dy = y - last.y;
        if (dx * dx + dy * dy < 0.000018 && i !== pts.length - 1) continue;
      }
      out.push({ x: x, y: y });
    }
    return out;
  }

  root.OS = {
    MAX_PTS: MAX_PTS,
    MAX_SEATS: MAX_SEATS,
    MAX_TITLE: MAX_TITLE,
    COLORS: COLORS,
    WIDTHS: WIDTHS,
    SUGGESTIONS: SUGGESTIONS,
    fresh: fresh,
    legalPts: legalPts,
    legalStroke: legalStroke,
    sanitizeTitle: sanitizeTitle,
    drewThisRound: drewThisRound,
    actorIndex: actorIndex,
    addStroke: addStroke,
    settle: settle,
    another: another,
    randomLine: randomLine,
    playback: playback,
    compactPts: compactPts,
    pathLen: pathLen,
    winningTitle: winningTitle
  };
})(typeof window !== 'undefined' ? window : this);
