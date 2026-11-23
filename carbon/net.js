/*
 * Invite shares the live snippet + theme. Last write wins on one row.
 * Who is here is gifos.people(). Invite is OS chrome — this file never
 * draws that button. Nobody writes a who_ heartbeat row.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Carbon needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null, room = null, me = { id: null, name: 'You' };
  var on = false, subscribed = false, owner = true;
  var lastAt = 0, lastBy = '';
  var skip = false;
  var roomPeople = [], roomKey = '', lastList = [];

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function statusOf() {
    var names = peopleNames(), id, others = [];
    for (id in names) if (id !== me.id) others.push(names[id]);
    if (!on) return 'Press Invite in the bar above to let a friend edit this snippet with you.';
    if (others.length === 0) return 'Waiting for a friend… Invite sends the link. They get this snippet.';
    if (others.length === 1) return others[0] + ' is on this snippet.';
    return others.length + ' friends on this snippet.';
  }

  function snapshot() {
    var s = Mp.getState ? Mp.getState() : {};
    return {
      id: 'live',
      at: Date.now(),
      by: me.id,
      code: s.code || '',
      theme: s.theme,
      language: s.language,
      bg: s.bg,
      padding: s.padding,
      dropShadow: s.dropShadow,
      windowControls: s.windowControls,
      windowTheme: s.windowTheme,
      lineNumbers: s.lineNumbers,
      fontSize: s.fontSize,
      width: s.width,
      autoWidth: s.autoWidth,
      title: s.title || '',
      scale: s.scale
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var row = snapshot();
    lastAt = row.at;
    lastBy = row.by;
    skip = true;
    room.put(row).catch(function (e) {
      if (Mp.onStatus) Mp.onStatus(String((e && e.message) || e || 'Could not share.'), true);
    });
  }

  function applyList(list) {
    lastList = list || [];
    var live = null;
    (list || []).forEach(function (r) { if (r && r.id === 'live') live = r; });
    if (live && live.at && live.at > lastAt && live.by && live.by !== me.id) {
      lastAt = live.at;
      lastBy = live.by;
      if (Mp.onRemote) Mp.onRemote(live);
    }
    if (Mp.onStatus) Mp.onStatus(statusOf(), false);
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
      owner = !!info.owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (Mp.onStatus) Mp.onStatus(statusOf(), false);
      }
    }, function () {});
  }

  function watch() {
    api = root.gifos;
    if (!api || !api.db) {
      if (Mp.onStatus) Mp.onStatus(statusOf(), false);
      return;
    }
    if (!PEOPLE) {
      if (Mp.onStatus) Mp.onStatus(NEEDS_NEWER, true);
      return;
    }
    try { room = room || api.db('room'); } catch (e) { return; }
    readRoom().then(function () {
      on = true;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(function (list) {
          if (skip) skip = false;
          applyList(list);
        });
      }
      if (owner) publish();
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  var Mp = {
    watch: watch,
    publish: publish,
    beat: function () { /* presence is gifos.people(); no who_ heartbeat */ },
    get owner() { return owner; },
    get live() { return on; },
    getState: null,
    onRemote: null,
    onStatus: null
  };
  root.CarbonMp = Mp;

  root['__carbon'] = {
    state: function () {
      var live = null, i;
      for (i = 0; i < lastList.length; i++) if (lastList[i] && lastList[i].id === 'live') live = lastList[i];
      if (!live) return on ? { code: '' } : null;
      return { at: live.at | 0, n: (live.code || '').length | 0, theme: live.theme || '' };
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      var n = 0, id, names = peopleNames();
      for (id in names) n++;
      return on && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'carbon-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(typeof window !== 'undefined' ? window : this);
