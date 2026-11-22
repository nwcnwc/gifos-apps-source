/* Shared garden. Invite is OS chrome — this file never draws that button.
 *
 * garden  (read-write)  one plot: the level and the CSS everyone is typing
 * players (read-write)  one row per gardener; nobody writes anybody else's
 *
 * Last write to the plot wins. A remote level change loads that bed; a
 * remote CSS change fills the editor unless this tab typed more recently.
 * Who is here is gifos.people(). The app owner hosts the shared plot.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Grid Garden needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var CODE_MS = 180;

  var api = null;
  var me = { id: null, name: 'You' };
  var others = {};
  var lastPlot = null;
  var lastRows = [];
  var localEditAt = 0;
  var lastPublishedCode = '';
  var lastPublishedLevel = -1;
  var codeTimer = 0;
  var peopleTimer = 0;
  var ready = false;

  function now() { return Date.now(); }
  function db(n) { return api.db(n); }
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') n++;
    }
    return n;
  }

  function liveOthers() {
    var names = peopleNames(), out = [], id;
    for (id in others) {
      if (!Object.prototype.hasOwnProperty.call(names, id)) continue;
      out.push(others[id]);
    }
    return out;
  }

  function paint() {
    var bar = $('friend-bar');
    if (!bar) return;
    if (!PEOPLE) {
      bar.hidden = false;
      var st0 = $('friend-status');
      if (st0) st0.textContent = NEEDS_NEWER;
      return;
    }
    var list = liveOthers();
    var status = $('friend-status');
    var names = $('friend-names');
    if (!list.length) {
      bar.hidden = false;
      status.innerHTML = 'Press <b>Invite</b> in the bar above to share this garden.';
      names.textContent = '';
      document.body.classList.remove('together');
      return;
    }
    document.body.classList.add('together');
    bar.hidden = false;
    var who = list.map(function (p) { return p.name || 'Friend'; });
    status.textContent = who.length === 1
      ? (who[0] + ' is in this garden — same bed, same CSS.')
      : (who.length + ' gardeners on this plot.');
    names.innerHTML = list.map(function (p) {
      var tag = (p.solved | 0) + '/' + ((root.levels && root.levels.length) || 28);
      return '<li>' + esc(p.name || 'Friend') + ' <span>' + tag + '</span></li>';
    }).join('');
  }

  function snapshot() {
    var g = root.game;
    return {
      id: me.id,
      level: g ? g.level : 0,
      solved: g && g.solved ? g.solved.length : 0
    };
  }

  function publishMe() {
    if (!PEOPLE || !api || !me.id) return;
    if (peopleCount() < 2) return;
    db('players').put(snapshot()).catch(function () {});
  }

  function publishPlot(force) {
    if (!PEOPLE || !api || !me.id) return;
    var g = root.game;
    if (!g) return;
    var codeEl = $('code');
    var code = codeEl ? codeEl.value : '';
    if (!force && code === lastPublishedCode && g.level === lastPublishedLevel) return;
    lastPublishedCode = code;
    lastPublishedLevel = g.level;
    db('garden').put({
      id: 'plot',
      level: g.level,
      code: code,
      by: me.id
    }).catch(function () {});
  }

  function applyPlot(rec) {
    if (!rec || rec.by === me.id) return;
    var g = root.game;
    if (!g) return;
    if (typeof rec.level === 'number' && rec.level !== g.level && rec.level >= 0) {
      g.skipPersist = true;
      g.goTo(rec.level, { remote: true, silent: true, code: rec.code || '' });
      g.skipPersist = false;
      lastPublishedLevel = rec.level;
      lastPublishedCode = rec.code || '';
      return;
    }
    if (typeof rec.code === 'string' && rec.code !== ( $('code') && $('code').value)) {
      if (localEditAt && lastPlot && lastPlot.t && lastPlot.t < localEditAt) return;
      g.setCode(rec.code, { remote: true });
      lastPublishedCode = rec.code;
    }
  }

  function ingestPlayers(list) {
    lastRows = list || [];
    var names = peopleNames(), seen = {};
    lastRows.forEach(function (p) {
      if (!p || !p.id || p.id === me.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || 'Friend',
        level: p.level | 0,
        solved: p.solved | 0
      };
    });
    for (var id in others) {
      if (!seen[id]) delete others[id];
    }
    paint();
  }

  function ingestGarden(list) {
    var rec = null;
    (list || []).forEach(function (r) { if (r && r.id === 'plot') rec = r; });
    lastPlot = rec;
    if (rec) applyPlot(rec);
  }

  function onLocalCode() {
    localEditAt = now();
    if (codeTimer) clearTimeout(codeTimer);
    codeTimer = setTimeout(function () { publishPlot(true); }, CODE_MS);
  }

  function onLocalLevel() {
    localEditAt = now();
    publishPlot(true);
    publishMe();
  }

  function readRoom() {
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      var wasOwner = owner;
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (!wasOwner && owner && roomRead && peopleCount() > 1) {
        // New owner hosts the plot after hand-off (P2).
        publishPlot(true);
        publishMe();
      }
      if (key !== roomKey) {
        roomKey = key;
        ingestPlayers(lastRows);
      }
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) {
      paint();
      return Promise.resolve();
    }
    if (!PEOPLE) {
      paint();
      return Promise.resolve();
    }
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      db('players').subscribe(function (list) { ingestPlayers(list || []); });
      db('garden').subscribe(function (list) { ingestGarden(list || []); });
      ready = true;
      publishMe();
      publishPlot(true);
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
      paint();
    }).catch(function () { paint(); });
  }

  root.GardenNet = {
    init: init,
    onLocalCode: onLocalCode,
    onLocalLevel: onLocalLevel,
    publishPlot: publishPlot,
    live: function () { return liveOthers().length > 0; },
    me: function () { return me; },
    owner: function () { return owner; }
  };

  root['__grid-garden'] = {
    state: function () {
      if (!lastPlot) return null;
      return { level: lastPlot.level | 0 };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      if (me.id && names[me.id]) out.push(me.id);
      for (id in others) if (names[id]) out.push(id);
      return out;
    },
    amHost: function () {
      return ready && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'gg-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
