/*
 * Matter Sandbox — one room, one world.
 *
 * Host simulates. Guests send taps and drags on THEIR own row. The host
 * writes `world` (read-only). Nobody writes anybody else's row.
 */
(function (root) {
  'use strict';

  var WORLD_HZ = 10;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'Matter Sandbox needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'You' };
  var owner = false;
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;
  var lastWorldSig = '';
  var worldSeq = 0;
  var others = {};
  var lastWorld = 0;
  var lastPub = 0;
  var cmdN = 0;
  var applied = {};
  var pending = null;
  var drag = null;
  var cursor = { x: 400, y: 300 };
  var onRoster = null;
  var lastList = [];
  var roomy = false;

  function now() { return Date.now(); }
  function db(n) { return api.db(n); }

  function tintFor(id) {
    var h = 0;
    for (var i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 70%, 64%)';
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
  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!names[p.id]) return;
      out.push(p);
    });
    return out;
  }

  function countOthers() {
    var n = 0;
    for (var k in others) n++;
    return n;
  }

  function ingestWorld(list) {
    var rec = null;
    for (var i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i].id === 'world') rec = list[i];
    }
    if (!rec || !rec.scene) return;
    if (owner) return;
    root.MSPhysics.applyPoses(rec.scene);
  }

  function honor(p) {
    if (!owner || !p || p.id === me.id) return;
    if (p.cmd && p.cmd.n != null) {
      var key = p.id + ':' + p.cmd.n;
      if (!applied[key]) {
        applied[key] = now();
        var c = p.cmd;
        var Phys = root.MSPhysics;
        if (c.op === 'box') Phys.addBox(c.x, c.y);
        else if (c.op === 'ball') Phys.addBall(c.x, c.y);
        else if (c.op === 'ragdoll') Phys.addRagdoll(c.x, c.y);
        else if (c.op === 'stack') Phys.addStack(c.x, c.y);
        else if (c.op === 'reset') Phys.resetArena();
        else if (c.op === 'grav' && typeof c.g === 'number') {
          Phys.setGravity(c.g);
          if (root.MSUI) root.MSUI.setGravity(c.g, true);
        }
      }
    }
    if (p.drag && p.drag.sid) {
      root.MSPhysics.setRemoteDrag(p.id, p.drag.sid, p.drag.x, p.drag.y);
    } else {
      root.MSPhysics.setRemoteDrag(p.id, null);
    }
  }

  function ingestPlayers(list) {
    lastList = list || [];
    var players = live(lastList);
    var names = peopleNames();
    var seen = {};
    var prev = others;
    others = {};
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.id === me.id) continue;
      seen[p.id] = 1;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        color: tintFor(p.id),
        x: p.px, y: p.py,
        tool: p.tool
      };
      honor(p);
    }
    for (var id in prev) {
      if (!seen[id]) root.MSPhysics.setRemoteDrag(id, null);
    }
    if (onRoster) onRoster(roster());
    pushCursors();
  }

  function pushCursors() {
    if (!root.MSUI) return;
    var list = [];
    for (var id in others) {
      var o = others[id];
      if (o.x == null || o.y == null) continue;
      list.push({ x: o.x, y: o.y, name: o.name, color: o.color });
    }
    root.MSUI.setCursors(list);
  }

  function snapshot() {
    var row = {
      id: me.id,
      tool: root.MSUI ? root.MSUI.tool() : 'grab',
      px: Math.round(cursor.x),
      py: Math.round(cursor.y)
    };
    if (pending) row.cmd = pending;
    if (drag) row.drag = drag;
    return row;
  }

  function publishPlayer(force) {
    if (!PEOPLE || !api || !me.id) return;
    // Only write on force (a real action) — no idle cursor heartbeat (K3).
    if (!force) return;
    lastPub = now();
    db('players').put(snapshot()).catch(function () {});
  }

  function publishWorld(force) {
    if (!PEOPLE || !api || !me.id || !owner) return;
    if (!roomy && !force) return;
    var t = now();
    if (!force && t - lastWorld < 1000 / WORLD_HZ) return;
    var scene = root.MSPhysics.exportScene();
    var sig = JSON.stringify(scene);
    if (!force && sig === lastWorldSig) return;
    lastWorldSig = sig;
    lastWorld = t;
    worldSeq = (worldSeq | 0) + 1;
    db('world').put({
      id: 'world',
      by: me.id,
      scene: scene,
      seq: worldSeq
    }).catch(function () {});
  }

  function onLocalAction(a) {
    if (!a) return;
    if (a.x != null) cursor.x = a.x;
    if (a.y != null) cursor.y = a.y;
    if (a.op === 'cursor' || a.op === 'move' || a.op === 'down' || a.op === 'up') {
      if (a.op === 'up') drag = null;
      publishPlayer(true);
      return;
    }
    if (a.op === 'drag') {
      drag = { sid: a.sid, x: a.x, y: a.y };
      publishPlayer(true);
      return;
    }
    if (a.op === 'undrag') {
      drag = null;
      publishPlayer(true);
      return;
    }
    if (a.op === 'tool') {
      publishPlayer(true);
      return;
    }
    pending = { n: ++cmdN, op: a.op, x: a.x, y: a.y, g: a.g };
    publishPlayer(true);
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
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        roomy = peopleCount() > 1 || !owner;
      }
    }, function () {});
  }

  function init() {
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
          roomy = peopleCount() > 1 || !owner;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2200);
        db('players').subscribe(function (list) {
          ingestPlayers(list || []);
          var was = roomy;
          roomy = peopleCount() > 1 || !owner;
          if (owner && roomy && !was) publishWorld(true);
          done();
        });
        db('world').subscribe(function (list) {
          ingestWorld(list || []);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function tick() {
    if (!PEOPLE || !api || !me.id) return;
    // No idle player puts. World only when the scene changes.
    if (owner) publishWorld(false);
    pushCursors();
  }

  function roster() {
    var list = [{ id: me.id, name: me.name, me: true }];
    for (var id in others) list.push({ id: id, name: others[id].name, me: false });
    list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return list;
  }

  root.MSNet = {
    init: init,
    tick: tick,
    onAction: onLocalAction,
    onRoster: function (fn) { onRoster = fn; },
    roster: roster,
    me: function () { return me; },
    owner: function () { return owner; },
    live: function () { return PEOPLE && !!api && !!me.id && (countOthers() > 0 || !owner); },
    count: function () { return countOthers() + (me.id ? 1 : 0); }
  };

  root['__matter-sandbox'] = {
    state: function () {
      return worldSeq ? { seq: worldSeq | 0 } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      if (me.id && names[me.id]) out.push(me.id);
      for (id in others) if (names[id]) out.push(id);
      return out;
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1;
    }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'ms-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

})(window);
