/*
 * wv-mp.js — two people, one map.
 *
 * Press Invite on the app bar and whoever opens the link is looking at the
 * SAME Earth: same place, same day, same layer stack, live, with their pointer
 * on it. NASA's Worldview can hand you a URL; this is the other thing — the
 * map moves under both of you while you are talking about it.
 *
 * Who is here is gifos.people(). `session` carries the view the room is
 * looking at; `cursors` carries one small record per person, written only
 * when the pointer moves. No idle heartbeat.
 */
(function () {
  'use strict';

  var U = window.WVUtil;
  var D = window.WVData;
  var M = window.WVMap;

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(window.gifos && window.gifos.people);
  var NEEDS_NEWER = 'Worldview needs a newer GifOS to share the map. Reload the page to update. Solo works on this device.';

  var MP = {};
  var app = null, state = null;
  var sessionDb = null, cursorsDb = null;
  var me = { id: 'local', name: '' };
  var follow = true;
  var lastPush = 0, pushTimer = 0;
  var lastCursor = 0;
  var lastCursorSig = '';
  var lastSessionSig = '';
  var roomPeople = [];
  var roomKey = '';
  var chip = null, applying = false;

  var owner = true;
  var COLOURS = ['#57d9a3', '#ffb454', '#ff8fa3', '#b39dff', '#4cc2ff', '#ffe066'];
  function colourFor(id) {
    var n = 0;
    for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) & 0xffff;
    return COLOURS[n % COLOURS.length];
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Someone';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function activeOthers() {
    var names = peopleNames(), n = 0, id;
    for (id in names) if (id !== me.id) n++;
    return n;
  }

  function readRoom() {
    if (!PEOPLE || !window.gifos) return Promise.resolve();
    return Promise.all([
      gifos.people(),
      gifos.info ? gifos.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      var key = JSON.stringify(ppl.map(function (p) { return [p.id, p.name, p.here]; })) + (info.owner ? '|o' : '');
      var prev = roomKey;
      roomPeople = ppl;
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || ''; }
      if (key !== prev) {
        roomKey = key;
        paintChip();
        if (owner && activeOthers()) {
          MP.push(true);
          [2000, 6000].forEach(function (ms) {
            setTimeout(function () { if (activeOthers()) MP.push(true); }, ms);
          });
        }
      }
    }, function () {});
  }

  MP.init = function (a) {
    app = a;
    state = a.state;
    if (!window.gifos || !gifos.db) return;
    if (!PEOPLE) return;
    sessionDb = gifos.db('session');
    cursorsDb = gifos.db('cursors');
    readRoom().then(function () {
      setInterval(readRoom, PEOPLE_MS);
    });

    sessionDb.subscribe(function (recs) {
      var rec = recs.filter(function (r) { return r.id === 'view'; })[0];
      if (!rec || rec.by === me.id) return;
      if (!follow) { paintChip(); return; }
      applying = true;
      if (rec.layers && rec.layers.length) {
        state.layers = rec.layers.map(function (r) { return { id: r.id, on: r.on, opacity: r.opacity }; })
          .filter(function (r) { return D.layer(r.id); });
      }
      if (rec.date) state.date = rec.date;
      if (rec.view) M.setView(rec.view);
      window.WVUI.renderAll();
      M.invalidate();
      applying = false;
    });

    cursorsDb.subscribe(function (recs) {
      var names = peopleNames();
      var list = [];
      recs.forEach(function (r) {
        if (!r || r.id === me.id) return;
        if (!names[r.id]) return;
        list.push({ lon: r.lon, lat: r.lat, name: names[r.id] || r.name || 'Someone', colour: colourFor(r.id) });
      });
      M.furniture.cursors = list;
      M.invalidate();
      paintChip();
    });
  };

  function paintChip() {
    var n = activeOthers();
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip together';
      chip.addEventListener('click', function () {
        follow = !follow;
        paintChip();
        window.WVUI.toast(follow ? 'Following the room again' : 'Looking around on your own — the room will not move your map');
        if (follow) MP.push(true);
      });
      var right = document.querySelector('.top-right');
      if (right) right.insertBefore(chip, right.firstChild);
    }
    chip.hidden = n === 0;
    chip.innerHTML = '<span class="dot" style="background:' + (follow ? '#57d9a3' : '#ffb454') + '"></span>' +
      '<span class="lbl">' + (follow ? 'Together' : 'On your own') + (n > 1 ? ' · ' + n : '') + '</span>';
    chip.title = follow
      ? 'Everyone here sees the same view — tap to look around on your own'
      : 'You are moving on your own — tap to rejoin the room';
  }

  MP.moved = function () { MP.push(); };

  MP.push = function (force) {
    if (!sessionDb || applying || !PEOPLE) return;
    if (!force && owner && !activeOthers()) return;
    var now = Date.now();
    clearTimeout(pushTimer);
    var wait = Math.max(0, 400 - (now - lastPush));
    pushTimer = setTimeout(function () {
      lastPush = Date.now();
      var v = M.view;
      var row = {
        id: 'view',
        by: me.id,
        byName: me.name || '',
        date: state.date,
        view: { lon: v.lon, lat: v.lat, res: v.res },
        layers: state.layers.map(function (r) { return { id: r.id, on: r.on, opacity: r.opacity }; })
      };
      var sig = JSON.stringify(row);
      if (!force && sig === lastSessionSig) return;
      lastSessionSig = sig;
      row.at = Date.now();
      sessionDb.put(row).catch(function (e) {
        var msg = String(e && e.message || e);
        if (msg && !/read-only/i.test(msg)) window.WVUI.toast(msg, true);
      });
    }, wait);
  };

  MP.cursor = function (world) {
    if (!cursorsDb || !PEOPLE || (owner && !activeOthers())) return;
    var now = Date.now();
    if (now - lastCursor < 140) return;
    var row = {
      id: me.id,
      lon: U.wrapLon(world.lon), lat: world.lat
    };
    var sig = JSON.stringify(row);
    if (sig === lastCursorSig) return;
    lastCursorSig = sig;
    lastCursor = now;
    row.name = me.name || '';
    row.at = now;
    cursorsDb.put(row).catch(function () {});
  };

  MP.debug = function () {
    return { owner: owner, me: me.id, follow: follow, others: activeOthers() };
  };

  window.WVMP = MP;

  window['__worldview'] = {
    state: function () {
      if (!PEOPLE || !me.id || me.id === 'local') return null;
      return { follow: follow ? 1 : 0, date: state && state.date ? String(state.date) : '' };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return PEOPLE && owner && peopleCount() > 1; }
  };
})();
