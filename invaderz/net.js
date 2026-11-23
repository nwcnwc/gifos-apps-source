/*
 * InvaderZ — extra cannons over a meeting.
 *
 * Who is here is gifos.people(); the app owner hosts the swarm. Invite is OS chrome.
 * Each cannon owns one `players` row. The owner alone writes `world`. Publish only
 * when the pose/claims change — no idle keep-alive (kit K3).
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 8;
  var WORLD_HZ = 8;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'InvaderZ needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var CLAIM_RING = 8;
  var CLAIM_TTL = 12000;

  var api = null;
  var me = { id: null, name: 'Cannon' };
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var seq = 0;
  var claims = [];
  var lastPublished = 0;
  var lastPubSig = '';
  var lastWorld = 0;
  var lastWorldSig = '';
  var onRoster = null;
  var honored = {};
  var worldSeq = 0;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r1(n) { return Math.round(n * 10) / 10; }

  function tintFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    var hue = h % 360;
    return 'hsl(' + hue + ', 70%, 32%)';
  }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Cannon';
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
      if (mine) { me.id = mine.id; me.name = mine.name || 'Cannon'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onRoster) onRoster(roster());
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
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 2500);
        db('players').subscribe(function (list) {
          ingestPlayers(list || []);
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

  function ingestPlayers(list) {
    var t = now(), seen = {}, names = peopleNames();
    var pending = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.id) continue;
      if (p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      if (p.claims && p.claims.length) {
        for (var c = 0; c < p.claims.length; c++) {
          pending.push({ from: p.id, i: p.claims[c].i, n: p.claims[c].n });
        }
      }
      var cur = others[p.id];
      others[p.id] = {
        id: p.id, name: names[p.id] || p.name || 'Cannon',
        x: p.x, y: p.y, shooting: !!p.sh,
        bx: p.bx, by: p.by,
        kills: p.kills | 0,
        stamp: p.t, t: t,
        color: tintFor(p.id),
        prev: cur ? { x: cur.x, y: cur.y, bx: cur.bx, by: cur.by, t: cur.t } : null
      };
    }
    for (var id in others) {
      if (!seen[id] || !names[id]) delete others[id];
    }
    if (owner) honorClaims(pending);
    if (onRoster) onRoster(roster());
  }

  function honorClaims(pending) {
    var G = root.InvaderZ;
    if (!G || !G.sim) return;
    for (var i = 0; i < pending.length; i++) {
      var cl = pending[i];
      var key = cl.from + ':' + cl.n;
      if (honored[key]) continue;
      honored[key] = now();
      G.honor(cl.i);
    }
    var cutoff = now() - CLAIM_TTL;
    for (var k in honored) if (honored[k] < cutoff) delete honored[k];
  }

  function ingestWorld(list) {
    var rec = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'world') rec = list[i];
    }
    var G = root.InvaderZ;
    if (!G || owner) return;
    if (!rec) return;
    worldSeq = rec.seq | 0;
    G.importWorld(rec);
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, bx: o.bx, by: o.by };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var x = o.prev.x + (o.x - o.prev.x) * a;
    var y = o.y;
    var bx = o.bx, by = o.by;
    if (o.shooting && o.prev.bx != null && o.bx != null) {
      bx = o.prev.bx + (o.bx - o.prev.bx) * a;
      by = o.prev.by + (o.by - o.prev.by) * a;
    }
    return { x: x, y: y, bx: bx, by: by };
  }

  function claim(idx) {
    if (!api || !me.id || !PEOPLE || idx < 0) return;
    claims.push({ i: idx, n: ++seq });
    if (claims.length > CLAIM_RING) claims.shift();
    publish(true);
  }

  function publish(force) {
    if (!api || !me.id || !PEOPLE) return;
    if (typeof player === 'undefined' || !player) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var G = root.InvaderZ;
    var row = {
      id: me.id,
      x: r1(player.x), y: r1(player.y),
      sh: player.isShooting ? 1 : 0,
      bx: player.isShooting ? r1(player.bullet.x) : null,
      by: player.isShooting ? r1(player.bullet.y) : null,
      kills: G ? G.kills : 0,
      claims: claims.slice()
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function publishWorld(force) {
    if (!api || !me.id || !owner || !PEOPLE) return;
    var G = root.InvaderZ;
    if (!G) return;
    var t = now();
    if (!force && t - lastWorld < 1000 / WORLD_HZ) return;
    var snap = G.exportWorld();
    snap.id = 'world';
    snap.by = me.id;
    var sig = JSON.stringify(snap);
    if (!force && sig === lastWorldSig) return;
    lastWorldSig = sig;
    lastWorld = t;
    worldSeq = (worldSeq | 0) + 1;
    snap.seq = worldSeq;
    snap.t = t;
    db('world').put(snap).catch(function () {});
  }

  function tick() {
    if (!api || !me.id || !PEOPLE) return;
    var G = root.InvaderZ;
    if (!G || typeof player === 'undefined' || !player) return;
    // Write only while the cannon acts (golden: no idle keep-alive).
    var moving = !!(player.isMovingLeft || player.isMovingRight || player.isShooting);
    if (moving) publish(false);
    // Host publishes while acting; also once when over flips (sig dedupes).
    if (owner && G.sim && (moving || G.over)) publishWorld(false);
  }

  function drawCannons(ctx) {
    var G = root.InvaderZ;
    if (!G) return;
    var s = 4;
    for (var id in others) {
      var o = others[id];
      var p = poseOf(o);
      var shape = (typeof player !== 'undefined' && player && player.shape) || [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1];
      G.drawShape(ctx, shape, p.x, p.y == null ? (h / 4 - 4) : p.y, s, o.color);
      if (o.shooting && p.bx != null && p.by != null) {
        ctx.fillStyle = o.color;
        ctx.fillRect(p.bx * s, p.by * s, 3, 3);
      }
      ctx.save();
      ctx.font = '9px "Courier New", Courier, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = o.color;
      ctx.fillText(o.name, (p.x + 2) * s, (p.y == null ? (h / 4 - 4) : p.y) * s - 8);
      ctx.restore();
    }
  }

  function roster() {
    var G = root.InvaderZ;
    var names = peopleNames();
    var list = [{
      id: me.id, name: me.name, me: true,
      kills: G ? G.kills : 0
    }];
    for (var id in others) {
      var o = others[id];
      list.push({ id: o.id, name: names[o.id] || o.name, me: false, kills: o.kills });
    }
    list.sort(function (a, b) { return (b.kills - a.kills) || a.name.localeCompare(b.name); });
    return list;
  }

  function countOthers() {
    var n = 0;
    for (var k in others) n++;
    return n;
  }

  root.Net = {
    init: init,
    tick: tick,
    publish: publish,
    publishWorld: publishWorld,
    claim: claim,
    roster: roster,
    others: function () { return others; },
    me: function () { return me; },
    owner: function () { return owner; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    live: function () { return PEOPLE && !!me.id; },
    drawCannons: drawCannons,
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__invaderz'] = {
    state: function () {
      // over from the last shared world row (host force-publishes on over).
      var G = root.InvaderZ;
      if (!G) return null;
      return { over: G.over ? 1 : 0 };
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
    _n.id = 'invaderz-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
