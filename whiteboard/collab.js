// Whiteboard collaboration: Excalidraw elements to and from the room.
//
// THE RULE THAT MAKES EVERY PAGE AGREE
// Every element carries a version and a versionNonce (Excalidraw's own). Of two
// copies of one element the higher version wins; on a tie the lower nonce wins.
// The rule does not care in which order copies arrive, or how often.
//
// WHO WRITES WHAT
// The room (gifos.db) stores whole records and its newest arrival wins, so two
// pages writing ONE record can lose a write. Here a page only ever writes rows
// of its own: id = <actor>/<element id>, where <actor> is the person's id plus a
// random tag for this page load. The merge happens on every page, from all the
// rows, by the rule above. A page deletes its own row once somebody's newer
// copy of that element has replaced it, so the room holds about one row per
// element.
//
// WHEN A WRITE COUNTS AS SHARED
// The page that shared the app holds the real copy and signs it. A write from
// any other page is a request. It is never called shared from this page's own
// copy of the room:
//   1. db.settled(id) answers from the sharer's signed state. false means the
//      write never arrived, so the row is sent again, for as long as it takes.
//   2. Every update from the room is checked against this page's own rows. A
//      row of mine that is missing or older than what I sent means the sharer's
//      state went back (a lost write, a sharer that came back with an old
//      copy). It is sent again.
// A row is whole and idempotent: sending it twice costs bytes, never state.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.WB = root.WB || {}).Collab = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FLUSH_MS = 150;      // writes are batched this long
  var FLUSH_BUSY_MS = 400; // ...and this long when many elements move at once
  var BUSY_ROWS = 20;
  var RETRY_MS = 3000;     // a refused or lost write waits this long before the next send
  var BEAT_MS = 3000;      // presence heartbeat
  var STALE_MS = 10000;    // no heartbeat for this long: gone
  var POINTER_MS = 400;    // a moving pointer is sent at most this often
  var POINTER_MAX = 12;    // more people than this: no pointer traffic at all
  var HEAL_MS = 1500;      // how long a winner may be missing from the room before a page that has it sends it
  var MAX_EL_BYTES = 400000;
  var TYPES = { rectangle: 1, diamond: 1, ellipse: 1, arrow: 1, line: 1, freedraw: 1, text: 1, frame: 1, magicframe: 1, image: 1, embeddable: 1, iframe: 1, selection: 0 };

  function newer(a, b) {
    if (a.version !== b.version) return a.version > b.version;
    return a.versionNonce < b.versionNonce;
  }
  function keyOf(e) { return e.version + ':' + e.versionNonce; }

  // An element from the room is somebody else's bytes: take only what is shaped like one.
  function legal(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
    if (typeof e.id !== 'string' || !e.id || e.id.length > 64) return false;
    if (typeof e.version !== 'number' || e.version !== Math.floor(e.version) || e.version < 1 || e.version > 1e12) return false;
    if (typeof e.versionNonce !== 'number' || !isFinite(e.versionNonce)) return false;
    if (typeof e.type !== 'string' || !TYPES[e.type]) return false;
    if (typeof e.x !== 'number' || typeof e.y !== 'number' || !isFinite(e.x) || !isFinite(e.y)) return false;
    return true;
  }

  function Board(actor) {
    this.actor = String(actor || 'local');
    this.best = Object.create(null);   // element id -> { el, mine }   the winner so far
    this.mine = Object.create(null);   // element id -> { el, dirty, sent, ok, gone }   my rows
    this.seen = Object.create(null);   // foreign row id -> key already merged
    this.rev = 0;
  }
  Board.prototype.rowId = function (elId) { return this.actor + '/' + elId; };

  // The scene changed on this page. Elements that beat the winner so far become
  // mine to publish. `hold` names elements still being drawn or typed: they are
  // left alone until they are finished, so a stroke is sent once, whole.
  // Returns { marked: n, stale: [ids whose scene copy lost to the room] }.
  Board.prototype.local = function (elements, hold) {
    var marked = 0, stale = [];
    for (var i = 0; i < elements.length; i++) {
      var e = elements[i], b = this.best[e.id];
      if (b && b.el.version === e.version && b.el.versionNonce === e.versionNonce) continue;
      if (hold && hold[e.id]) continue;
      if (!b && e.isDeleted) continue;                  // made and thrown away before anyone saw it
      if (b && !newer(e, b.el)) { stale.push(e.id); continue; }
      if (!legal(e)) continue;
      var copy = Object.assign({}, e);                  // the engine edits its elements in place; keep what was true now
      this.best[e.id] = { el: copy, mine: true };
      var m = this.mine[e.id] || (this.mine[e.id] = { el: null, dirty: false, sent: '', ok: '', gone: false });
      m.el = copy; m.dirty = true; m.gone = false;
      marked++; this.rev++;
    }
    return { marked: marked, stale: stale };
  };

  // Rows from the room. Returns the elements whose winner changed (to put on the scene).
  Board.prototype.ingest = function (rows) {
    var apply = [], prefix = this.actor + '/';
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      if (!r || typeof r.id !== 'string' || r.id.indexOf(prefix) === 0) continue;
      var e = r.e;
      if (!legal(e)) continue;
      if (typeof r.a !== 'string' || r.id !== r.a + '/' + e.id) continue;
      var k = keyOf(e);
      if (this.seen[r.id] === k) continue;
      this.seen[r.id] = k;
      var b = this.best[e.id];
      if (b && !newer(e, b.el)) continue;
      this.best[e.id] = { el: e, mine: false };
      apply.push(e); this.rev++;
      var m = this.mine[e.id];
      if (m && !m.gone) { m.gone = true; m.dirty = true; } // my copy lost: my row has nothing left to say
    }
    return apply;
  };

  // The room no longer holds the winner of an element (its writer left and the
  // sharer's state went back). This page still has it, so this page publishes it.
  Board.prototype.adopt = function (id) {
    var b = this.best[id]; if (!b) return false;
    b.mine = true;
    var m = this.mine[id] || (this.mine[id] = { el: null, dirty: false, sent: '', ok: '', gone: false });
    m.el = b.el; m.dirty = true; m.gone = false;
    return true;
  };

  Board.prototype.elements = function () {
    var out = [];
    for (var id in this.best) out.push(this.best[id].el);
    return out;
  };
  Board.prototype.get = function (id) { var b = this.best[id]; return b ? b.el : null; };
  // A stable picture of the board, to ask "do we all see the same thing".
  Board.prototype.digest = function () {
    var ids = Object.keys(this.best).sort(), out = [];
    for (var i = 0; i < ids.length; i++) { var e = this.best[ids[i]].el; out.push(ids[i] + '@' + e.version + ':' + e.versionNonce + (e.isDeleted ? 'x' : '')); }
    return out.join(',');
  };
  Board.prototype.hash = function () {
    var s = this.digest(), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16) + '/' + Object.keys(this.best).length;
  };

  // ---- the room --------------------------------------------------------------
  function sync(opt) {
    var api = opt.api, board = opt.board, me = opt.me || { id: 'local', name: '' };
    var now = opt.now || function () { return Date.now(); };
    var setT = opt.setTimer || function (f, ms) { return setTimeout(f, ms); };
    var clearT = opt.clearTimer || function (h) { clearTimeout(h); };
    var onApply = opt.onApply || function () {};
    var onPeople = opt.onPeople || function () {};
    var onStatus = opt.onStatus || function () {};

    var els = api.db('els'), pres = api.db('pres');
    var hasSettled = typeof els.settled === 'function';
    var flushTimer = 0, retryTimer = 0, beatTimer = 0, pointerTimer = 0, stopped = false;
    var refused = false, pointer = null, pointerAt = 0, extra = null;
    var seenAt = Object.create(null), people = [], presRows = [];
    var stats = { puts: 0, dels: 0, resent: 0, bytes: 0, maxBytes: 0, healed: 0 };
    var lastRows = [], healTimer = 0, healJitter = 0;
    for (var hj = 0; hj < board.actor.length; hj++) healJitter = (healJitter * 31 + board.actor.charCodeAt(hj)) % 3000;

    function pending() {
      var n = 0;
      for (var id in board.mine) { var m = board.mine[id]; if (m.dirty || (m.sent && m.ok !== m.sent)) n++; }
      return n;
    }
    function status() { var n = pending(); onStatus({ pending: n, refused: refused }); return n; }
    function later() { if (!retryTimer && !stopped) retryTimer = setT(function () { retryTimer = 0; flush(); }, RETRY_MS); }

    function send(elId, m) {
      var id = board.rowId(elId), gone = m.gone, k = gone ? 'gone' : keyOf(m.el), p;
      m.dirty = false; m.sent = k;
      try {
        if (gone) { stats.dels++; p = els.delete(id); }
        else {
          var row = { id: id, a: board.actor, e: m.el }, size = JSON.stringify(row).length;
          if (size > MAX_EL_BYTES) { m.ok = k; return; } // too big to share; it stays on this page
          stats.puts++; stats.bytes += size; if (size > stats.maxBytes) stats.maxBytes = size;
          p = els.put(row);
        }
      } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(function () {
        refused = false;
        if (!hasSettled) {
          // An older room has no settled(): send the row once more, then trust it.
          // The row check in onRows still catches a state that went back.
          if (m.again !== k) { m.again = k; setT(function () { if (!stopped && m.sent === k && !m.dirty) { stats.resent++; m.dirty = true; flush(); } }, RETRY_MS); }
          else if (m.sent === k) m.ok = k;
          status();
          return null;
        }
        return els.settled(id).then(function (ok) {
          if (m.sent !== k) return;                       // a newer copy is already on its way
          if (ok === false) { stats.resent++; m.dirty = true; later(); }
          else { m.ok = k; if (gone && !m.dirty) delete board.mine[elId]; }
          status();
        });
      }).catch(function () {
        // refused (the sharer is away, or the room is read-only right now): keep it, try again
        refused = true; if (m.sent === k) m.dirty = true; later(); status();
      });
    }

    function flush() {
      if (flushTimer) { clearT(flushTimer); flushTimer = 0; }
      if (stopped) return;
      for (var id in board.mine) if (board.mine[id].dirty) send(id, board.mine[id]);
      status();
    }
    // The app calls this after board.local() marked something.
    function touch() {
      if (flushTimer || stopped) return;
      var n = 0;
      for (var id in board.mine) if (board.mine[id].dirty) n++;
      if (!n) return;
      status();
      flushTimer = setT(function () { flushTimer = 0; flush(); }, n > BUSY_ROWS ? FLUSH_BUSY_MS : FLUSH_MS);
    }

    function onRows(rows) {
      if (stopped) return;
      rows = rows || [];
      var apply = board.ingest(rows);
      // My rows, as the room holds them now.
      var have = Object.create(null), prefix = board.actor + '/';
      for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r && typeof r.id === 'string' && r.id.indexOf(prefix) === 0) have[r.id] = r; }
      var back = false;
      // A row of mine that I no longer stand behind (my copy lost and I took the row away,
      // yet it is in the room again: a late copy of the old write, or a sharer that came
      // back with an old state). Take it away again, so the room keeps one row per element.
      for (var rowId in have) {
        var ghost = rowId.slice(prefix.length);
        if (!board.mine[ghost]) { board.mine[ghost] = { el: null, dirty: true, sent: '', ok: '', gone: true }; back = true; }
      }
      for (var elId in board.mine) {
        var m = board.mine[elId];
        if (m.dirty || !m.sent) continue;
        var got = have[board.rowId(elId)];
        var wrong = m.gone ? !!got : (!got || !got.e || keyOf(got.e) !== keyOf(m.el));
        if (wrong) { m.dirty = true; m.ok = ''; stats.resent++; back = true; }
      }
      if (back || apply.length) touch();
      if (apply.length) onApply(apply);
      lastRows = rows;
      if (!healTimer && missing(rows).length) healTimer = setT(heal, HEAL_MS + healJitter);
    }

    // Winners this page holds that no row in the room carries any more.
    function missing(rows) {
      var has = Object.create(null), out = [];
      for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r && r.e && typeof r.e.id === 'string') has[r.e.id + '@' + keyOf(r.e)] = 1; }
      for (var id in board.best) {
        var m = board.mine[id];
        if (m && !m.gone) continue;                      // mine to send; the checks above cover it
        if (!has[id + '@' + keyOf(board.best[id].el)]) out.push(id);
      }
      return out;
    }
    // Wait a little (a different little on every page) so one page heals it, not all of them.
    function heal() {
      healTimer = 0;
      if (stopped) return;
      var ids = missing(lastRows), n = 0;
      for (var i = 0; i < ids.length; i++) if (board.adopt(ids[i])) n++;
      if (n) { stats.healed += n; touch(); }
    }

    // ---- who is here -----------------------------------------------------------
    function presRow() {
      var row = { id: board.actor, pid: me.id, name: me.name || '', at: now() };
      if (pointer) { row.x = pointer.x; row.y = pointer.y; }
      if (extra) for (var k in extra) row[k] = extra[k];
      return row;
    }
    function beat() {
      if (stopped) return;
      try { Promise.resolve(pres.put(presRow())).catch(function () {}); } catch (e) {}
    }
    function onPres(rows) {
      if (stopped) return;
      presRows = rows || [];
      var t = now(), out = [];
      presRows.forEach(function (p) {
        if (!p || typeof p.id !== 'string' || p.id.length > 200) return;
        var s = seenAt[p.id];
        if (!s || s.at !== p.at) s = seenAt[p.id] = { at: p.at, seen: t };
        if (t - s.seen > STALE_MS) return;
        out.push({ id: p.id, pid: String(p.pid || p.id), name: String(p.name || '').slice(0, 60), me: p.id === board.actor,
                   x: typeof p.x === 'number' && isFinite(p.x) ? p.x : null, y: typeof p.y === 'number' && isFinite(p.y) ? p.y : null });
      });
      out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      people = out;
      onPeople(out);
    }
    function setPointer(x, y) {
      pointer = (x == null) ? null : { x: Math.round(x), y: Math.round(y) };
      if (people.length > POINTER_MAX || people.length < 2) return;
      var wait = POINTER_MS - (now() - pointerAt);
      if (wait <= 0) { pointerAt = now(); beat(); }
      else if (!pointerTimer) pointerTimer = setT(function () { pointerTimer = 0; pointerAt = now(); beat(); }, wait);
    }

    function start() {
      els.subscribe(onRows);
      pres.subscribe(onPres);
      beat();
      (function loop() { beatTimer = setT(function () { beat(); onPres(presRows); loop(); }, BEAT_MS); })();
    }
    function stop() {
      flush();
      stopped = true;
      [flushTimer, retryTimer, beatTimer, pointerTimer, healTimer].forEach(function (h) { if (h) clearT(h); });
      try { Promise.resolve(pres.delete(board.actor)).catch(function () {}); } catch (e) {}
    }

    return { start: start, stop: stop, touch: touch, flush: flush, setPointer: setPointer,
             setExtra: function (o) { extra = o; }, setName: function (n) { me.name = n || me.name; beat(); },
             pending: pending, people: function () { return people; }, stats: stats };
  }

  return { Board: Board, sync: sync, newer: newer, legal: legal, keyOf: keyOf, STALE_MS: STALE_MS };
});
