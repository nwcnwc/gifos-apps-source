/* Play together: one shared table + mapping. App owner hosts the chart
 * (else lowest id). Who is here is gifos.people(). Invite is OS chrome.
 * Nobody writes anybody else's row. */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'RAWGraphs needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var MAX = 80000;
  var api = null, room = null, me = { id: null, name: 'You' };
  var on = false, subscribed = false, declined = false;
  var round = 1, usedRound = 0, usedKey = '', lastList = [], lastPub = 0;
  var roomPeople = [], roomKey = '', owner = false, roomRead = false;
  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
  };

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }
  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Friend' }));
    });
    return out;
  }
  function keyOf(p) {
    return String(p.round || 1) + '\x1f' + String(p.csv || '') + '\x1f' + String(p.chartId || '') + '\x1f' + JSON.stringify(p.mapping || {});
  }
  function adopted(list) {
    var players = live(list);
    if (!players.length) return null;
    var maxR = 0;
    players.forEach(function (p) { if ((p.round || 1) > maxR) maxR = p.round || 1; });
    var cand = players.filter(function (p) { return (p.round || 1) === maxR && p.csv != null; });
    if (!cand.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < cand.length; i++) if (cand[i].id === me.id) { a = cand[i]; break; }
    }
    if (!a) {
      cand.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      a = cand[0];
    }
    return a;
  }
  function snapshot() {
    var s = root.RawApp ? root.RawApp.snapshot() : {};
    return {
      id: me.id,
      round: round,
      csv: String(s.csv || '').slice(0, MAX),
      nameTag: s.name,
      chartId: s.chartId,
      mapping: s.mapping
    };
  }
  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }
  function applyWorld(p) {
    usedRound = p.round || 1;
    usedKey = keyOf(p);
    round = usedRound;
    if (root.RawApp && root.RawApp.applyRemote) {
      root.RawApp.applyRemote({ csv: p.csv, name: p.nameTag, chartId: p.chartId, mapping: p.mapping });
    }
    lastPub = 0;
    publish();
  }
  function renderMp() {
    if (!on) return;
    var players = live(lastList);
    var html = '';
    players.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    players.forEach(function (p) {
      html += '<li class="' + (p.id === me.id ? 'me' : '') + '"><span class="name">' +
        (p.id === me.id ? 'You' : esc(p.name || 'Friend')) + '</span><span class="meta">chart</span></li>';
    });
    var scores = $('friend-scores');
    if (scores) scores.innerHTML = html || '<li><span class="name">Just you so far</span></li>';
    var others = players.filter(function (p) { return p.id !== me.id; });
    var status = $('friend-status');
    if (!status) return;
    if (!others.length) status.textContent = 'Waiting for a friend… Invite sends the link. They get this table and this mapping.';
    else status.textContent = others.length === 1 ? (others[0].name || 'Friend') + ' is on this chart.' : others.length + ' friends on this chart.';
  }
  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var ad = adopted(lastList);
    if (ad && keyOf(ad) !== usedKey) applyWorld(ad);
    renderMp();
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
      roomPeople = ppl;
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (handed && !on && !declined) {
        var n = 0, id, names = peopleNames();
        for (id in names) if (id !== me.id) n++;
        if (n > 0) enter();
      } else if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else maybeEnterFromPeople();
      }
    }, function () {});
  }
  function maybeEnterFromPeople() {
    if (on || declined || !PEOPLE) return;
    var names = peopleNames(), id, n = 0;
    for (id in names) { if (id !== me.id) n++; }
    if (n > 0) enter();
  }
  function watch() {
    api = root.gifos;
    if (!api || !api.db || !PEOPLE) return;
    room = room || api.db('room');
    readRoom().then(function () {
      if (subscribed) return;
      subscribed = true;
      room.subscribe(function (list) {
        lastList = list || [];
        if (on) { onRoom(lastList); return; }
        if (declined) return;
        maybeEnterFromPeople();
      });
      setInterval(readRoom, PEOPLE_MS);
      maybeEnterFromPeople();
    }).catch(function () {});
  }
  function enter() {
    api = root.gifos;
    if (!api || !api.db) {
      if ($('friend-bar')) $('friend-bar').hidden = false;
      if ($('friend-status')) $('friend-status').textContent = 'Play together needs a GifOS room.';
      return true;
    }
    if (!PEOPLE) {
      if ($('friend-bar')) $('friend-bar').hidden = false;
      if ($('friend-status')) $('friend-status').textContent = NEEDS_NEWER;
      return true;
    }
    if (on) return true;
    declined = false;
    room = room || api.db('room');
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      document.body.classList.add('friend');
      if ($('friend-bar')) $('friend-bar').hidden = false;
      if ($('shareBtn')) $('shareBtn').hidden = true;
      round = 1; usedRound = 0; usedKey = '';
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      lastPub = 0; publish();
    }).catch(function () {});
    return true;
  }
  function leave() {
    on = false;
    declined = true;
    document.body.classList.remove('friend');
    if ($('friend-bar')) $('friend-bar').hidden = true;
    if ($('shareBtn')) $('shareBtn').hidden = false;
    if (room && me.id) room.delete(me.id).catch(function () {});
  }
  if ($('leaveBtn')) $('leaveBtn').addEventListener('click', leave);

  root.RawMp = {
    enter: enter,
    onChange: function () {
      if (!on) return;
      round += 1;
      lastPub = 0;
      publish();
    }
  };
  root['__rawgraphs'] = {
    state: function () {
      var ad = adopted(lastList);
      if (ad) return { round: ad.round | 0, chartId: ad.chartId || '' };
      return on ? { round: (usedRound || round || 0) | 0 } : null;
    },
    people: function () { return live(lastList).map(function (p) { return p.id; }); },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return on && owner && n > 1;
    }
  };
  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'rg-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
  }
}(typeof window !== 'undefined' ? window : globalThis));
