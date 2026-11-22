/*
 * Extra adventurers. Invite is OS chrome — this file never draws a share
 * button. Host simulates the dungeon; guests send input and paint the
 * snapshot. Each player writes ONLY their own row.
 */
(function (root) {
  'use strict';

  var api = root.gifos || null;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'JS Gauntlet needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var me = { id: 'local', name: 'You' };
  var owner = false;
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;
  var others = {};
  var held = {};
  var lastPub = 0;
  var lastSelfSig = '';
  var world = null;
  var worldSeq = 0;
  var TYPES = ['WARRIOR', 'VALKYRIE', 'WIZARD', 'ELF'];
  var joining = false;
  var nuked = {};

  function now() { return Date.now(); }
  function db(n) { return api && api.db ? api.db(n) : null; }
  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Player';
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
    var list = [], id, o, names = peopleNames();
    for (id in others) {
      o = others[id];
      if (o && names[id]) list.push(o);
    }
    return list;
  }

  function typeOf(p) {
    return p && p.type && p.type.name ? p.type.name.toUpperCase() : null;
  }

  function status(msg) {
    var el = document.getElementById('room-status');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
  }

  function taken() {
    var g = root.game, have = [], i, o, t;
    if (g && g.player) {
      t = typeOf(g.player);
      if (t) have.push(t);
    }
    if (g && g.party) {
      for (i = 0; i < g.party.length; i++) {
        t = typeOf(g.party[i]);
        if (t && have.indexOf(t) < 0) have.push(t);
      }
    }
    var live = liveOthers();
    for (i = 0; i < live.length; i++) {
      o = live[i];
      if (o.type && have.indexOf(o.type) < 0) have.push(o.type);
    }
    if (!owner && world && world.p) {
      for (i = 0; i < world.p.length; i++) {
        t = world.p[i] && world.p[i].t;
        if (t && have.indexOf(t) < 0) have.push(t);
      }
    }
    return have;
  }

  function freeType() {
    var have = taken(), i;
    for (i = 0; i < TYPES.length; i++) {
      if (have.indexOf(TYPES[i]) < 0) return TYPES[i];
    }
    return null;
  }

  function paintTaken() {
    var have = taken(), i, id, node, g = root.game, mine = g && g.player ? typeOf(g.player) : null;
    for (i = 0; i < TYPES.length; i++) {
      id = TYPES[i].toLowerCase();
      node = document.getElementById(id);
      if (!node) continue;
      if (have.indexOf(TYPES[i]) >= 0 && TYPES[i] !== mine) node.classList.add('taken');
      else node.classList.remove('taken');
    }
  }

  function findParty(g, id) {
    var i;
    g.party = g.party || [];
    for (i = 0; i < g.party.length; i++) {
      if (g.party[i].netId === id) return g.party[i];
    }
    return null;
  }

  function spawnParty(g, id, typeName, slot) {
    if (!root.GauntletPlayer || !root.GAUNTLET_TYPES || !root.GAUNTLET_TYPES[typeName]) return null;
    var p = new root.GauntletPlayer();
    p.netId = id;
    p.slot = slot;
    p.join(root.GAUNTLET_TYPES[typeName]);
    if (g.map) p.onStartLevel(g.map);
    g.party.push(p);
    return p;
  }

  function ensureParty(g) {
    if (!g || !owner || !root.GauntletPlayer || !root.GAUNTLET_TYPES) return;
    g.party = g.party || [];
    var live = liveOthers(), i, o, found, keep = {}, slot;
    for (i = 0; i < live.length; i++) {
      o = live[i];
      if (!o.type || !root.GAUNTLET_TYPES[o.type]) continue;
      keep[o.id] = true;
      found = findParty(g, o.id);
      if (!found) {
        slot = g.party.length + 1;
        found = spawnParty(g, o.id, o.type, slot);
        if (!found) continue;
      }
      found.moveLeft(!!o.l);
      found.moveRight(!!o.r);
      found.moveUp(!!o.u);
      found.moveDown(!!o.d);
      found.fire(!!o.f);
      if (o.n && !nuked[o.id]) {
        found.nuke();
        nuked[o.id] = true;
      }
      if (!o.n) nuked[o.id] = false;
    }
    g.party = g.party.filter(function (p) { return keep[p.netId]; });
  }

  function snapEnt(e) {
    if (!e || !e.type || e.player) return null;
    return [e.x | 0, e.y | 0, e.type.sx | 0, e.type.sy | 0, e.frame | 0];
  }

  function publish(g) {
    if (!PEOPLE || !owner || !g || !g.map) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    ensureParty(g);
    var d = db('world');
    if (!d) return;
    var folks = g.allPlayers(), i, p, plist = [], ents = [], e;
    for (i = 0; i < folks.length; i++) {
      p = folks[i];
      if (!p) continue;
      plist.push({
        id: p.netId || me.id,
        t: typeOf(p),
        x: p.x | 0, y: p.y | 0, d: p.dir | 0,
        h: Math.round(p.health), s: p.score | 0,
        k: p.keys | 0, o: p.potions | 0,
        fr: p.frame | 0, dead: !!p.dead
      });
    }
    for (i = 0; i < g.map.entities.length; i++) {
      e = snapEnt(g.map.entities[i]);
      if (e) ents.push(e);
    }
    worldSeq = (worldSeq | 0) + 1;
    d.put({
      id: 'world', n: g.map.nlevel, p: plist, e: ents, seq: worldSeq
    }).catch(function () {});
  }

  function dummy(sx, sy, x, y, fr) {
    return {
      active: true,
      type: { sx: sx, sy: sy },
      x: x, y: y, frame: fr, dx: 0, dy: 0
    };
  }

  function syncVisuals(g) {
    if (!g || !world || !world.p) return;
    g.party = g.party || [];
    var i, e, found, keep = {}, slot;
    for (i = 0; i < world.p.length; i++) {
      e = world.p[i];
      if (!e || e.id === me.id || !e.t) continue;
      keep[e.id] = true;
      found = findParty(g, e.id);
      if (!found) {
        slot = g.party.length + 1;
        found = spawnParty(g, e.id, e.t, slot);
        if (!found) continue;
      }
      found.x = e.x; found.y = e.y; found.dir = e.d;
      found.health = e.h; found.score = e.s;
      found.keys = e.k; found.potions = e.o;
      found.frame = e.fr; found.dead = !!e.dead;
    }
    g.party = g.party.filter(function (p) { return keep[p.netId]; });
  }

  function applyWorld(g) {
    if (!g || !world || !g.map) return;
    if (typeof world.n === 'number' && g.map.nlevel !== world.n && g.load) {
      g.load(world.n);
      return;
    }
    var ents = [], i, e;
    if (world.e) {
      for (i = 0; i < world.e.length; i++) {
        e = world.e[i];
        ents.push(dummy(e[2], e[3], e[0], e[1], e[4]));
      }
    }
    g.map.entities = ents;
    if (world.p) {
      for (i = 0; i < world.p.length; i++) {
        e = world.p[i];
        if (e.id === me.id && g.player) {
          g.player.x = e.x; g.player.y = e.y; g.player.dir = e.d;
          g.player.health = e.h; g.player.score = e.s;
          g.player.keys = e.k; g.player.potions = e.o;
          g.player.frame = e.fr; g.player.dead = !!e.dead;
        }
      }
    }
    syncVisuals(g);
    if (g.viewport && g.player) g.viewport.update(0, g.player, g.map, g.viewport);
  }

  function maybeJoin() {
    if (owner || joining) return;
    var g = root.game;
    if (!g || !world) return;
    if (g.current !== 'menu') return;
    var T = root.GAUNTLET_TYPES;
    var t = freeType();
    if (!t || !T || !T[t] || !g.start) {
      status('Watching — all four classes are taken.');
      return;
    }
    joining = true;
    status('');
    try { g.start(T[t], world.n); }
    catch (err) { joining = false; }
  }

  function writeSelf(force) {
    if (!PEOPLE || !me.id) return;
    var d = db('players');
    if (!d) return;
    var g = root.game;
    var rec = {
      id: me.id,
      type: g && g.player ? typeOf(g.player) : null,
      l: !!held.left, r: !!held.right, u: !!held.up,
      d: !!held.down,
      f: !!held.fire, n: !!held.potion
    };
    var sig = JSON.stringify(rec);
    if (!force && sig === lastSelfSig) {
      maybeJoin();
      paintTaken();
      return;
    }
    lastSelfSig = sig;
    d.put(rec).catch(function () {});
    held.potion = false;
    maybeJoin();
    paintTaken();
  }

  function onPlayers(rows) {
    var names = peopleNames();
    others = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.id === me.id) continue;
      if (!names[r.id]) continue;
      others[r.id] = r;
    }
    paintTaken();
    maybeJoin();
  }

  function onWorld(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id === 'world') world = rows[i];
    }
    maybeJoin();
  }

  function refreshBoard(g) {
    if (!g || !g.scoreboard) return;
    var folks = g.allPlayers ? g.allPlayers() : [g.player];
    for (var i = 0; i < folks.length; i++) {
      if (folks[i] && folks[i] !== g.player) g.scoreboard.refreshPlayer(folks[i]);
    }
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
      var handed = !owner && !!info.owner && roomRead;
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey || handed) {
        roomKey = key;
        if (handed) status('');
        else if (!owner) status('Waiting for the host to start the dungeon.');
        paintTaken();
      }
    }, function () {});
  }

  function init() {
    if (!api) return;
    if (!PEOPLE) {
      status(NEEDS_NEWER);
      return;
    }
    readRoom().then(function () {
      var pd = db('players'), wd = db('world');
      if (pd && pd.subscribe) pd.subscribe(onPlayers);
      if (wd && wd.subscribe) wd.subscribe(onWorld);
      if (!owner) status('Waiting for the host to start the dungeon.');
      // Poll input; writeSelf skips when unchanged (kit K3).
      setInterval(function () { writeSelf(false); }, 100);
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function (err) {
      status((err && err.message) || 'Could not join the room.');
    });
  }

  root.GauntletNet = {
    init: init,
    publish: publish,
    applyWorld: applyWorld,
    ensureParty: ensureParty,
    maybeJoin: maybeJoin,
    refreshBoard: refreshBoard,
    guestWatching: function () {
      return !owner && !!world && !!(root.game && root.game.map);
    },
    noteInput: function (h) { held = h || held; writeSelf(true); },
    freeType: freeType,
    taken: taken,
    isOwner: function () { return owner; },
    _setIdentity: function (id, isOwner) { me = { id: id, name: id }; owner = !!isOwner; },
    _setOthers: onPlayers,
    _setWorld: function (row) { world = row; maybeJoin(); }
  };

  function bindKey(c, on) {
    if (c === 37 || c === 65) held.left = on;
    else if (c === 39 || c === 68) held.right = on;
    else if (c === 38 || c === 87) held.up = on;
    else if (c === 40 || c === 83) held.down = on;
    else if (c === 32) held.fire = on;
    else if (c === 13 && on) held.potion = true;
  }
  document.addEventListener('keydown', function (ev) { bindKey(ev.keyCode, true); });
  document.addEventListener('keyup', function (ev) { bindKey(ev.keyCode, false); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);

  root['__js-gauntlet'] = {
    state: function () {
      return world ? { n: world.n | 0, seq: world.seq | 0 } : null;
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
    _n.id = 'jsg-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }

})(window);
