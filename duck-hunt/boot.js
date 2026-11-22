/*
 * Duck Hunt — GifOS shell. Best score in the file. Invite is OS chrome.
 * Two devices that open the same invite each have a zapper; the pond board
 * is the room. Who is here is gifos.people(). Replay must never assign
 * window.location (srcdoc).
 */
(function (root) {
  'use strict';
  var NEEDS_NEWER = 'Pond Hunt needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var prefs = { best: 0, last: 0 };
  var db = null;
  var roomDb = null;
  var me = { id: 'solo', name: '' };
  var pond = [];
  var saveTimer = 0;
  var lastPub = 0;

  function paint(id, text) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }
  function paintBest() {
    var t = prefs.best ? ('Best ' + prefs.best) : '';
    if (prefs.last && prefs.last !== prefs.best) t += (t ? ' · ' : '') + 'Last ' + prefs.last;
    paint('best', t);
    paint('best-live', t);
  }
  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'someone';
    }
    return m;
  }
  function livePond() {
    var names = peopleNames(), out = [];
    (pond || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, r.id)) return;
      out.push({
        id: r.id,
        name: names[r.id] || r.name || 'someone',
        best: r.best | 0,
        last: r.last | 0
      });
    });
    return out;
  }
  function paintPond() {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('pond');
    if (!el) return;
    var rows = livePond();
    el.hidden = rows.length < 2;
    if (rows.length < 2) { el.textContent = ''; return; }
    rows.sort(function (a, b) { return (b.best | 0) - (a.best | 0); });
    el.textContent = rows.map(function (r) {
      var n = r.name || 'someone';
      return n + ' ' + (r.best | 0);
    }).join(' · ');
    var tally = document.getElementById('tally');
    if (tally) {
      tally.hidden = false;
      tally.textContent = rows.length + ' at the pond';
    }
    var gateRoom = document.getElementById('gate-room');
    if (gateRoom) {
      gateRoom.textContent = PEOPLE
        ? (rows.length + ' at the pond. Scores stay on each device — the board is the room.')
        : NEEDS_NEWER;
    }
  }

  function persist() {
    if (!db) return;
    db.put({ id: 'save', best: prefs.best | 0, last: prefs.last | 0 }).catch(function () {});
  }
  function publish(force) {
    if (!PEOPLE || !roomDb || !me.id || me.id === 'solo') return;
    var names = peopleNames(), n = 0, id;
    for (id in names) n++;
    if (n < 2) return;
    var t = Date.now();
    if (!force && t - lastPub < 80) return;
    lastPub = t;
    roomDb.put({
      id: me.id,
      best: prefs.best | 0,
      last: prefs.last | 0
    }).catch(function () {});
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = (root.setTimeout || setTimeout)(function () {
      saveTimer = 0;
      persist();
      publish();
    }, 200);
  }

  function onScore(n) {
    n = n | 0;
    prefs.last = n;
    if (n > prefs.best) prefs.best = n;
    paintBest();
    scheduleSave();
  }
  function onEnd(won, score) {
    if (score != null) onScore(score);
    persist();
    publish(true);
  }
  function replay() {
    var g = root.__DHGame;
    if (g) {
      try { g.paused = true; } catch (e) {}
      try {
        if (g.renderer && g.renderer.canvas && g.renderer.canvas.remove) g.renderer.canvas.remove();
      } catch (e) {}
    }
    root.__DHGame = null;
    if (typeof document !== 'undefined') {
      var canvases = document.querySelectorAll('canvas');
      var i;
      for (i = 0; i < canvases.length; i++) {
        try { canvases[i].remove(); } catch (e) {}
      }
      document.body.classList.remove('play');
      var gate = document.getElementById('gate');
      if (gate) gate.hidden = false;
      var hud = document.getElementById('hud');
      if (hud) hud.hidden = true;
    }
    paintBest();
  }
  function noop() {}

  function callGame(name) {
    var g = root.__DHGame;
    if (g && typeof g[name] === 'function') g[name]();
  }

  root.DHSave = {
    prefs: prefs,
    onScore: onScore,
    onEnd: onEnd,
    replay: replay,
    noop: noop,
    persist: persist,
    mute: function () { callGame('mute'); },
    pause: function () { callGame('pause'); }
  };

  if (typeof document === 'undefined') return;

  try { if (root.gifos) db = gifos.db('save'); } catch (e) {}
  try { if (root.gifos && PEOPLE) roomDb = gifos.db('room'); } catch (e) {}

  function start() {
    document.getElementById('gate').hidden = true;
    document.body.classList.add('play');
    var hud = document.getElementById('hud');
    if (hud) hud.hidden = false;
    if (typeof root.DuckHuntStart === 'function') root.DuckHuntStart();
    else console.error('DuckHuntStart missing');
  }

  var go = document.getElementById('gate-go');
  if (go) go.addEventListener('click', start);
  var muteBtn = document.getElementById('btn-mute');
  if (muteBtn) muteBtn.addEventListener('click', function () { callGame('mute'); });
  var pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) pauseBtn.addEventListener('click', function () { callGame('pause'); });
  paintBest();

  function load() {
    if (!db) return Promise.resolve();
    return db.get('save').then(function (row) {
      if (!row) return;
      if (row.best != null) prefs.best = row.best | 0;
      if (row.last != null) prefs.last = row.last | 0;
    }).catch(function () {});
  }
  load().then(function () {
    paintBest();
    if (go) go.disabled = false;
  });

  function readRoom() {
    if (!PEOPLE || !root.gifos) return Promise.resolve();
    return Promise.all([
      gifos.people(),
      gifos.info ? gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || ''; }
      if (key !== roomKey) {
        roomKey = key;
        paintPond();
        publish();
      }
    }, function () {});
  }

  if (roomDb) {
    try {
      roomDb.subscribe(function (rows) {
        pond = rows || [];
        paintPond();
      });
    } catch (e) {}
  }
  if (PEOPLE) {
    readRoom().then(function () { publish(); });
    setInterval(readRoom, PEOPLE_MS);
  } else {
    var gateRoom = document.getElementById('gate-room');
    if (gateRoom) gateRoom.textContent = NEEDS_NEWER;
  }

  root['__duck-hunt'] = {
    state: function () { return null; },
    people: function () {
      return livePond().map(function (r) { return r.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'dh-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

  if (root.gifos && gifos.onBack) {
    gifos.onBack(function () {
      var gate = document.getElementById('gate');
      if (gate && !gate.hidden) return false;
      replay();
      return true;
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
