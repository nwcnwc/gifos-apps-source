// Drawphone chain rules. No server. Host applies intents; players only
// publish their own turn. Telephone: word → drawing → guess → drawing → …
(function (root) {
  'use strict';
  var DP = root.DP || (root.DP = {});
  DP.MIN = 2;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  DP.pickWord = function (rng) {
    var list = DP.WORDS || ['cat'];
    rng = rng || Math.random;
    return list[(rng() * list.length) | 0];
  };

  DP.MAX_TURNS = 6; // a meeting of 30 still finishes a round in a few minutes
  // A pack word as the first link: wi lets each person read it in their own language.
  function seedLink(rng) {
    var n = (DP.PACK || []).length, wi = n ? ((rng() * n) | 0) : -1;
    return wi >= 0 ? { type: 'word', by: null, word: DP.PACK[wi][0], wi: wi, seed: true } : { type: 'word', by: null, word: DP.pickWord(rng), seed: true };
  }

  DP.turnsWanted = function (n, wordFirst) {
    var T = Math.min(n | 0, DP.MAX_TURNS);
    if (T < 1) T = 1;
    if (wordFirst) {
      if (T % 2 === 0) T++;
      if (T < 3) T = 3;
    } else {
      if (T % 2 === 1) T++;
      if (T < 2) T = 2;
    }
    return T;
  };

  DP.expectedKind = function (b) {
    if (!b) return 'word';
    if (b.wordFirst) return (b.turn % 2 === 0) ? 'word' : 'draw';
    return (b.turn % 2 === 0) ? 'draw' : 'word';
  };

  DP.actorOn = function (b, chainIndex) {
    if (!b || !b.order || !b.chains || !b.chains[chainIndex]) return null;
    var n = b.order.length, owner = b.chains[chainIndex].owner, i, idx = -1;
    for (i = 0; i < n; i++) if (b.order[i] === owner) idx = i;
    if (idx < 0) return null;
    return b.order[(idx + (b.turn | 0)) % n];
  };

  DP.actors = function (b) {
    var seen = {}, out = [], i, id;
    if (!b || !b.chains) return out;
    for (i = 0; i < b.chains.length; i++) {
      id = DP.actorOn(b, i);
      if (id && !seen[id]) { seen[id] = 1; out.push(id); }
    }
    return out;
  };

  DP.promptFor = function (b, playerId) {
    if (!b || b.phase !== 'play') return null;
    var i, actor, chain, last;
    for (i = 0; i < b.chains.length; i++) {
      actor = DP.actorOn(b, i);
      if (actor !== playerId) continue;
      chain = b.chains[i];
      last = chain.links.length ? chain.links[chain.links.length - 1] : null;
      return {
        chain: i,
        kind: DP.expectedKind(b),
        last: last,
        turn: b.turn,
        turns: b.turns
      };
    }
    return null;
  };

  function capStrokes(strokes) {
    if (!strokes || !strokes.length) return [];
    var out = [], i, s, p, j, n;
    for (i = 0; i < strokes.length && out.length < 250; i++) {
      s = strokes[i];
      if (!s || !s.p || !s.p.length) continue;
      p = [];
      n = s.p.length;
      if (n > 600) n = 600;
      for (j = 0; j < n; j++) p.push(s.p[j] | 0);
      if (p.length >= 2) {
        out.push({
          c: String(s.c || '#111111').slice(0, 16),
          w: Math.min(24, Math.max(1, s.w | 0)),
          p: p
        });
      }
    }
    return out;
  }

  DP.capStrokes = capStrokes;
  // The live pad of Draw & guess goes out several times a second: keep it small
  // (at most ~6000 numbers) by thinning the points of long strokes.
  DP.capInk = function (strokes) {
    var out = capStrokes(strokes), total = 0, i, s, step, p, j;
    for (i = 0; i < out.length; i++) total += out[i].p.length;
    if (total <= 6000) return out;
    step = Math.ceil(total / 6000);
    for (i = 0; i < out.length; i++) {
      s = out[i]; if (s.p.length <= 8) continue;
      p = [];
      for (j = 0; j < s.p.length; j += 2 * step) p.push(s.p[j], s.p[j + 1]);
      p.push(s.p[s.p.length - 2], s.p[s.p.length - 1]);
      s.p = p;
    }
    return out;
  };

  DP.start = function (people, opts) {
    opts = opts || {};
    var wordFirst = !!opts.wordFirst;
    var rng = opts.rng || Math.random;
    var ids = [], names = {}, i, j, t, p;
    for (i = 0; i < people.length; i++) {
      p = people[i];
      if (!p || !p.id) continue;
      ids.push(p.id);
      names[p.id] = p.name || 'Player';
    }
    for (i = ids.length - 1; i > 0; i--) {
      j = (rng() * (i + 1)) | 0;
      t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    }
    var T = DP.turnsWanted(ids.length, wordFirst);
    var chains = [];
    for (i = 0; i < ids.length; i++) {
      chains.push({
        id: i,
        owner: ids[i],
        links: wordFirst ? [] : [seedLink(rng)]
      });
    }
    var host = opts.host || ids.slice().sort()[0];
    return {
      id: 'board',
      phase: 'play',
      wordFirst: wordFirst,
      turn: 0,
      turns: T,
      seq: 1,
      order: ids,
      chains: chains,
      names: names,
      host: host,
      startedAt: Date.now ? Date.now() : 0
    };
  };

  DP.applyIntents = function (board, intentsById) {
    if (!board || board.phase !== 'play') return null;
    var need = DP.actors(board);
    var kind = DP.expectedKind(board);
    var i, id, intent, word;
    if (!need.length) return null;
    for (i = 0; i < need.length; i++) {
      intent = intentsById[need[i]];
      if (intent && intent.skip && intent.seq === board.seq) continue;
      if (!intent || intent.seq !== board.seq || intent.kind !== kind) return null;
      if (kind === 'word') {
        word = intent.word ? String(intent.word).replace(/^\s+|\s+$/g, '') : '';
        if (!word) return null;
      } else {
        if (!intent.strokes || !intent.strokes.length) return null;
      }
    }
    var next = clone(board);
    for (i = 0; i < next.chains.length; i++) {
      id = DP.actorOn(board, i);
      intent = intentsById[id];
      var link = { type: kind, by: id };
      if (intent.skip) link.skip = true;
      else if (kind === 'word') link.word = String(intent.word).replace(/^\s+|\s+$/g, '').slice(0, 80);
      else link.strokes = capStrokes(intent.strokes);
      next.chains[i].links.push(link);
    }
    next.turn = (next.turn | 0) + 1;
    next.seq = (next.seq | 0) + 1;
    if (next.turn >= next.turns) next.phase = 'results';
    return next;
  };

  DP.firstWord = function (chain) {
    var i, L;
    if (!chain || !chain.links) return '';
    for (i = 0; i < chain.links.length; i++) {
      L = chain.links[i];
      if (L && L.type === 'word' && L.word) return L.word;
    }
    return '';
  };

  DP.lastWord = function (chain) {
    var i, L;
    if (!chain || !chain.links) return '';
    for (i = chain.links.length - 1; i >= 0; i--) {
      L = chain.links[i];
      if (L && L.type === 'word' && L.word) return L.word;
    }
    return '';
  };

  // ---------------------------------------------------------------- Draw & guess ----
  // One person draws, everyone else guesses. The host (lowest live id) is the only
  // writer of the board; everyone else writes their own row (guesses, the drawer's ink,
  // a request to start). Pure functions: the board in, a new board out (or null).
  var GG = DP.GG = {};
  GG.MIN = 2;
  GG.TURNS = 3;          // drawers per round: 3 turns of ~1 minute is a 2-3 minute round
  GG.REVEAL_MS = 6000;   // the word stays up this long before the next turn
  GG.DRAW_MS = [45000, 60000, 80000];

  // A guess and a word compare without case, accents, spaces, punctuation or a leading article.
  GG.norm = function (s) {
    s = String(s == null ? '' : s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/ё/g, 'е');
    s = s.replace(/^\s*(a|an|the|der|die|das|ein|eine|el|la|los|las|un|una)\s+/, '');
    return s.replace(/[\s\-_.,!?;:'"()\[\]{}\u3000\u3001\u3002\uff01\uff1f]+/g, '');
  };
  GG.isHit = function (wordIdx, guess) {
    var w = DP.PACK && DP.PACK[wordIdx], g = GG.norm(guess), i, n;
    if (!w || !g) return false;
    for (i = 0; i < w.length; i++) {
      n = GG.norm(w[i]);
      if (!n) continue;
      if (g === n) return true;
      if (i === 0 && (g === n + 's' || g === n + 'es' || g + 's' === n)) return true; // cat/cats, socks/sock
    }
    return false;
  };
  // Points: the first right guess 10, then 8, 6, then 5 each; the drawer 3 for each, at most 12.
  GG.guessPts = function (rank) { return Math.max(5, 10 - 2 * rank); };
  GG.drawerPts = function (hits) { return Math.min(12, 3 * hits); };

  function pickWord(rng, used) {
    var n = (DP.PACK || []).length, i, k;
    if (!n) return 0;
    for (k = 0; k < 20; k++) { i = (rng() * n) | 0; if (!used || used.indexOf(i) < 0) return i; }
    return (rng() * n) | 0;
  }
  GG.pickWord = pickWord;

  // A new round: the people here now play it (late comers play the next one). Drawers are
  // the ones who drew least so far, in seat order, so over rounds everyone gets a go.
  GG.startRound = function (prev, people, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random, now = opts.now || 0;
    var ids = people.map(function (p) { return p.id; });
    if (ids.length < GG.MIN) return null;
    var names = {}, totals = {}, drawn = {}, i;
    if (prev && prev.totals) for (i in prev.totals) totals[i] = prev.totals[i];
    if (prev && prev.drawn) for (i in prev.drawn) drawn[i] = prev.drawn[i];
    if (prev && prev.names) for (i in prev.names) names[i] = prev.names[i];
    people.forEach(function (p) { names[p.id] = p.name || names[p.id] || ''; if (!totals[p.id]) totals[p.id] = 0; });
    var order = ids.slice().sort(function (a, b) { return ((drawn[a] | 0) - (drawn[b] | 0)) || (ids.indexOf(a) - ids.indexOf(b)); });
    var drawers = order.slice(0, Math.min(GG.TURNS, ids.length));
    var ms = GG.DRAW_MS.indexOf(opts.ms) >= 0 ? opts.ms : GG.DRAW_MS[1];
    var b = {
      id: 'board', game: 'guess', phase: 'draw', v: ((prev && prev.v) | 0) + 1,
      round: ((prev && prev.round) | 0) + 1, players: ids, drawers: drawers, ti: 0, ms: ms,
      names: names, totals: totals, drawn: drawn, scores: {}, used: [], host: opts.host || null
    };
    ids.forEach(function (id) { b.scores[id] = 0; });
    return GG.openTurn(b, rng, now);
  };
  GG.openTurn = function (b, rng, now) {
    var d = b.drawers[b.ti];
    var w = pickWord(rng || Math.random, b.used);
    b.used = (b.used || []).concat([w]).slice(-60);
    b.phase = 'draw';
    b.turn = { key: b.round + '.' + b.ti + '.' + (b.v | 0), drawer: d, word: w, hits: [], left: b.ms, rewords: 0 };
    b.drawn[d] = (b.drawn[d] | 0) + 1;
    return b;
  };
  function copy(b) { return JSON.parse(JSON.stringify(b)); }
  // Guesses from every row: { id: [text, ...] } for this turn. Returns a new board when someone got it.
  GG.applyGuesses = function (B, guessesById, live) {
    if (!B || B.phase !== 'draw' || !B.turn) return null;
    var b = null, id, list, i;
    var hit = {}; B.turn.hits.forEach(function (h) { hit[h.id] = 1; });
    var ids = Object.keys(guessesById).sort();
    for (var k = 0; k < ids.length; k++) {
      id = ids[k];
      if (hit[id] || id === B.turn.drawer || B.players.indexOf(id) < 0) continue;
      list = guessesById[id] || [];
      for (i = 0; i < list.length; i++) {
        if (GG.isHit(B.turn.word, list[i])) {
          if (!b) b = copy(B);
          var rank = b.turn.hits.length, pts = GG.guessPts(rank);
          b.turn.hits.push({ id: id, pts: pts });
          b.scores[id] = (b.scores[id] | 0) + pts;
          b.totals[id] = (b.totals[id] | 0) + pts;
          hit[id] = 1;
          break;
        }
      }
    }
    if (!b) return null;
    b.v = (b.v | 0) + 1;
    if (GG.allIn(b, live)) return GG.closeTurn(b);
    return b;
  };
  // Everyone still here who can guess has guessed it.
  GG.allIn = function (b, live) {
    var hit = {}; b.turn.hits.forEach(function (h) { hit[h.id] = 1; });
    var left = b.players.filter(function (id) { return id !== b.turn.drawer && (!live || live.indexOf(id) >= 0) && !hit[id]; });
    return left.length === 0;
  };
  GG.closeTurn = function (B) {
    var b = B.phase === 'draw' ? B : copy(B);
    var d = b.turn.drawer, dp = GG.drawerPts(b.turn.hits.length);
    b.turn.drawerPts = dp;
    b.scores[d] = (b.scores[d] | 0) + dp;
    b.totals[d] = (b.totals[d] | 0) + dp;
    b.phase = 'reveal';
    b.turn.left = GG.REVEAL_MS;
    return b;
  };
  // Time is up (or the drawer left): close the turn.
  GG.timeUp = function (B) {
    if (!B || B.phase !== 'draw') return null;
    var b = copy(B); b.v = (b.v | 0) + 1;
    return GG.closeTurn(b);
  };
  // After the reveal: the next drawer still here, or the round is over.
  GG.afterReveal = function (B, live, rng, now) {
    if (!B || B.phase !== 'reveal') return null;
    var b = copy(B); b.v = (b.v | 0) + 1;
    for (b.ti = b.ti + 1; b.ti < b.drawers.length; b.ti++) {
      if (!live || live.indexOf(b.drawers[b.ti]) >= 0) return GG.openTurn(b, rng, now);
    }
    b.phase = 'over';
    b.turn = null;
    return b;
  };
  // The drawer asks for another word (once a turn); the clock starts again.
  GG.reword = function (B, rng) {
    if (!B || B.phase !== 'draw' || B.turn.rewords >= 1 || B.turn.hits.length) return null;
    var b = copy(B); b.v = (b.v | 0) + 1;
    var w = pickWord(rng || Math.random, b.used);
    b.used = b.used.concat([w]).slice(-60);
    b.turn.word = w; b.turn.rewords = 1; b.turn.left = b.ms;
    b.turn.key = b.round + '.' + b.ti + '.' + b.v;
    return b;
  };
  // Standings: [{id, name, round, total}] best first; ties by name.
  GG.standings = function (b) {
    var ids = Object.keys((b && b.totals) || {});
    return ids.map(function (id) { return { id: id, name: (b.names && b.names[id]) || '', round: (b.scores && b.scores[id]) | 0, total: b.totals[id] | 0 }; })
      .sort(function (x, y) { return (y.round - x.round) || (y.total - x.total) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0); });
  };
  // Blanks for the guessers: the word's shape in their language (letters as _, spaces kept).
  GG.blanks = function (word) {
    return Array.prototype.map.call(String(word || ''), function (c) { return /\s/.test(c) ? '   ' : '_'; }).join(' ').replace(/ {4,}/g, '   ');
  };
})(typeof window !== 'undefined' ? window : this);
