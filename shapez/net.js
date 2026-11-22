/*
 * Co-op factory. Each builder writes only their own cursor row. Buildings
 * live in `cells` (read-write). The app owner writes hub progress on `world`
 * and a compact item snapshot on `flow` so guests see the same belts.
 * Who is here is gifos.people(). Invite is OS chrome — this file never
 * draws that button.
 */
(function (root) {
  'use strict';

  var FLOW_MS = 180;
  var CUR_MS = 120;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Shapez needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'You' };
  var owner = true;
  var simHost = true;
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var lastFlow = 0;
  var lastCur = 0;
  var lastWorld = 0;
  var lastWorldSig = '';
  var lastFlowSig = '';
  var lastCurSig = '';
  var onRoster = null;
  var game = null;
  var applying = false;
  var worldLoaded = false;
  var pendingPuts = {};
  var pendingDels = {};
  var worldSeq = 0;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }

  function tint(id) {
    var h = 0, i;
    id = String(id || '');
    for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 70%, 48%)';
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'friend';
    }
    return m;
  }

  function peopleCount() {
    var n = 0, id, names = peopleNames();
    for (id in names) n++;
    return n;
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
      simHost = owner;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        paintRoster();
      }
    }, function () {});
  }

  function paintRoster() {
    var names = peopleNames();
    var roster = [{ id: me.id, name: me.name, me: true }];
    var id;
    for (id in others) {
      roster.push({
        id: id,
        name: names[id] || others[id].name,
        me: false,
        x: others[id].x, y: others[id].y,
        color: others[id].color
      });
    }
    if (root.SZUI) {
      root.SZUI.setCursors(roster);
      root.SZUI.paintRoster(roster);
    }
    if (onRoster) onRoster(roster);
  }

  function init(g) {
    game = g;
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });
    return readRoom().then(function () {
      if (!me.id) return { owner: owner, others: 0 };
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2200);
        db('cells').subscribe(function (list) {
          ingestCells(list || []);
          done();
        });
        db('world').subscribe(function (list) {
          ingestWorld(list || []);
        });
        db('flow').subscribe(function (list) {
          ingestFlow(list || []);
        });
        db('cursors').subscribe(function (list) {
          ingestCursors(list || []);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function ingestCells(list) {
    if (!game) return;
    var map = {}, seen = {}, i, rec, id, t = now();
    list = list || [];
    for (i = 0; i < list.length; i++) {
      rec = list[i];
      if (!rec || !rec.id) continue;
      seen[rec.id] = 1;
      if (pendingDels[rec.id]) continue;
      map[rec.id] = rec;
      if (pendingPuts[rec.id] && pendingPuts[rec.id].k === rec.k && ((pendingPuts[rec.id].r & 3) === (rec.r & 3))) {
        delete pendingPuts[rec.id];
      }
    }
    for (id in pendingPuts) {
      if (t - pendingPuts[id].t > 8000) { delete pendingPuts[id]; continue; }
      map[id] = pendingPuts[id];
    }
    for (id in pendingDels) {
      if (t - pendingDels[id] > 8000) { delete pendingDels[id]; continue; }
      if (!seen[id]) delete pendingDels[id];
    }
    applying = true;
    game.replaceCells(Object.keys(map).map(function (k) { return map[k]; }));
    applying = false;
    if (root.SZUI) root.SZUI.paintTools();
  }

  function ingestWorld(list) {
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'world') rec = list[i];
    }
    if (!rec || !game) return;
    worldSeq = rec.t | 0;
    if (simHost && worldLoaded) return;
    worldLoaded = true;
    if (rec.level != null) game.level = rec.level | 0;
    if (rec.delivered != null) game.delivered = rec.delivered | 0;
    if (rec.seed) game.seed = rec.seed;
    game.ensureUnlocks();
    if (game.level > 0) game.hint = '';
    if (root.SZUI) root.SZUI.paintTools();
  }

  function ingestFlow(list) {
    if (simHost || !game) return;
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'flow') rec = list[i];
    }
    if (!rec) return;
    game.importItems(rec.items || []);
  }

  function ingestCursors(list) {
    var names = peopleNames(), seen = {}, i, p;
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'friend',
        x: p.x, y: p.y,
        color: tint(p.id)
      };
    }
    for (i in others) {
      if (!seen[i] || !names[i]) delete others[i];
    }
    paintRoster();
  }

  function putCell(x, y, kind, rot) {
    if (!api || !me.id || !PEOPLE || applying) return;
    var rec = { id: x + ',' + y, k: kind, r: rot & 3, by: me.id, t: now() };
    pendingPuts[rec.id] = rec;
    delete pendingDels[rec.id];
    db('cells').put(rec).catch(function () {});
  }

  function delCell(x, y) {
    if (!api || !me.id || !PEOPLE || applying) return;
    var id = x + ',' + y;
    pendingDels[id] = now();
    delete pendingPuts[id];
    db('cells').delete(id).catch(function () {});
  }

  function publishWorld(force) {
    if (!api || !me.id || !simHost || !PEOPLE || !game) return;
    var t = now();
    if (!force && t - lastWorld < 400) return;
    var row = {
      id: 'world',
      by: me.id,
      seed: game.seed,
      level: game.level,
      delivered: game.delivered
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastWorldSig) return;
    lastWorldSig = sig;
    lastWorld = t;
    row.t = t;
    worldSeq = t;
    db('world').put(row).catch(function () {});
  }

  function publishFlow(force) {
    if (!api || !me.id || !simHost || !PEOPLE || !game) return;
    var t = now();
    if (!force && t - lastFlow < FLOW_MS) return;
    var items = game.exportItems();
    var sig = JSON.stringify(items);
    if (!force && sig === lastFlowSig) return;
    lastFlowSig = sig;
    lastFlow = t;
    db('flow').put({
      id: 'flow',
      items: items,
      t: t
    }).catch(function () {});
  }

  function publishCursor(hover, force) {
    if (!api || !me.id || !PEOPLE || !hover) return;
    var t = now();
    if (!force && t - lastCur < CUR_MS) return;
    var row = {
      id: me.id,
      x: hover.x, y: hover.y, tool: game ? game.tool : ''
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastCurSig) return;
    lastCurSig = sig;
    lastCur = t;
    db('cursors').put(row).catch(function () {});
  }

  function tick(hover) {
    if (!api || !me.id || !PEOPLE) return;
    if (simHost) {
      if (game && game.dirty) {
        game.dirty = false;
        publishWorld(true);
      } else {
        publishWorld(false);
      }
      publishFlow(false);
    }
    publishCursor(hover, false);
  }

  function resetWorld() {
    var list, i, xy;
    if (game) {
      list = game.exportCells();
      game.reset();
      if (api && me.id && PEOPLE) {
        for (i = 0; i < list.length; i++) {
          xy = String(list[i].id).split(',');
          delCell(+xy[0], +xy[1]);
        }
        publishWorld(true);
        publishFlow(true);
      }
    }
  }

  function countOthers() {
    var n = 0, k;
    for (k in others) n++;
    return n;
  }

  root.SZNet = {
    init: init,
    tick: tick,
    putCell: putCell,
    delCell: delCell,
    publishWorld: publishWorld,
    resetWorld: resetWorld,
    me: function () { return me; },
    owner: function () { return owner; },
    simHost: function () { return simHost; },
    live: function () { return PEOPLE && !!me.id; },
    others: function () { return others; },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__shapez'] = {
    state: function () {
      if (!PEOPLE) return null;
      if (game) return { level: game.level | 0, delivered: game.delivered | 0, seed: game.seed || '' };
      return worldSeq ? { t: worldSeq | 0 } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'shapez-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
