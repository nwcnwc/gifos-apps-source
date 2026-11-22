/* Invite shares the file tree as a pair editor. Last write wins per file.
 * Who is here is gifos.people(). Invite is OS chrome — this file only says to press it. */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Monaco Code needs a newer GifOS to pair-edit with friends. Reload the page to update. Solo works on this device.';

  var api = null, filesDb = null, cursorsDb = null;
  var me = { id: null, name: 'You' };
  var on = false, subscribed = false, owner = true;
  var lastAt = Object.create(null);
  var skip = Object.create(null);
  var roomPeople = [];
  var roomKey = '';
  var lastCursorSig = '';

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
  }

  function statusOf() {
    var names = peopleNames(), id, others = [];
    for (id in names) if (id !== me.id) others.push(names[id]);
    if (!PEOPLE) return NEEDS_NEWER;
    if (!on) return 'Press Invite in the bar above to pair-edit these files.';
    if (peopleCount() <= 1) return 'Waiting for a friend… Invite sends the link.';
    if (others.length === 1) return others[0] + ' is in this editor.';
    return others.length + ' friends in this editor.';
  }

  function publishFile(rec) {
    if (!on || !filesDb || !me.id || !rec || !PEOPLE) return;
    var row = {
      id: rec.id,
      name: rec.name,
      lang: rec.lang,
      text: rec.text,
      at: Date.now(),
      by: me.id,
      byName: me.name
    };
    lastAt[row.id] = row.at;
    skip[row.id] = true;
    filesDb.put(row).catch(function (e) {
      if (Mp.onStatus) Mp.onStatus(String((e && e.message) || e || 'Could not share.'), true);
    });
  }

  function publishCursor(fileId, line, col) {
    if (!on || !cursorsDb || !me.id || !PEOPLE) return;
    var row = {
      id: 'cur_' + me.id,
      fileId: fileId || '',
      line: line | 0,
      col: col | 0,
      name: me.name,
      at: Date.now()
    };
    var sig = JSON.stringify({ f: row.fileId, l: row.line, c: row.col, n: row.name });
    if (sig === lastCursorSig) return;
    lastCursorSig = sig;
    cursorsDb.put(row).catch(function () {});
  }

  function applyFiles(list) {
    var files = [];
    (list || []).forEach(function (r) {
      if (!r || r.id == null || !r.name) return;
      files.push(r);
    });
    if (Mp.onFiles) Mp.onFiles(files);
  }

  function applyCursors(list) {
    var live = [], names = peopleNames();
    (list || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (r.id.indexOf('cur_') !== 0 || r.id === 'cur_' + me.id) return;
      var pid = r.id.slice(4);
      if (!names[pid]) return;
      live.push(Object.assign({}, r, { name: names[pid] || r.name || 'Friend' }));
    });
    if (Mp.onCursors) Mp.onCursors(live);
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
    try {
      filesDb = filesDb || api.db('files');
      cursorsDb = cursorsDb || api.db('cursors');
    } catch (e) { return; }
    readRoom().then(function () {
      if (!me.id) return;
      on = true;
      if (!subscribed) {
        subscribed = true;
        filesDb.subscribe(applyFiles);
        cursorsDb.subscribe(applyCursors);
      }
      if (Mp.onStatus) Mp.onStatus(statusOf(), false);
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  var Mp = {
    watch: watch,
    publishFile: publishFile,
    publishCursor: publishCursor,
    beat: function () {},
    startBeat: function () {},
    remember: function (id, at) { if (id) lastAt[id] = at || Date.now(); },
    get me() { return me; },
    get owner() { return owner; },
    get live() { return on; },
    onFiles: null,
    onCursors: null,
    onStatus: null
  };
  root.MonacoMp = Mp;

  root['__monaco-code'] = {
    state: function () { return on ? { files: Object.keys(lastAt).length } : null; },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return on && owner && peopleCount() > 1; }
  };
})(typeof window !== 'undefined' ? window : this);
