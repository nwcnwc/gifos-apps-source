/* Extra people walking. Each player writes only THEIR row.
 * Who is here is gifos.people(). Pose publishes only when it changes.
 * Invite is OS chrome — this file never draws a share button. */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'Mykonos needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 250;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var PUBLISH_HZ = 6;
  var W = root.MykWorld;

  var api = null;
  var me = { id: null, name: 'You' };
  var others = {};
  var lastPublished = 0;
  var lastPubSig = '';
  var onRoster = null;
  var roomPeople = [];
  var owner = false;
  var roomRead = false;
  var peopleTimer = 0;

  function db(n) { return api.db(n); }
  function now() { return Date.now(); }
  function r2(n) { return Math.round(n * 100) / 100; }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function spawnFor(id) {
    var spots = [
      [5.5, 7.5], [6.5, 7.5], [5.5, 6.5], [11.5, 7.5], [7.5, 5.5], [7.5, 11.5]
    ];
    var h = 0, i;
    id = String(id || '');
    for (i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
    return spots[h % spots.length];
  }

  function readRoom() {
    if (!PEOPLE || !api) return Promise.resolve();
    return Promise.all([
      api.people(),
      api.info ? api.info() : Promise.resolve({})
    ]).then(function (r) {
      var ppl = (r[0] || []).filter(function (p) { return p && p.id; });
      var info = r[1] || {};
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      paint();
      if (onRoster) onRoster(roster());
    }, function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve(null);
    if (!PEOPLE) return Promise.resolve(null);
    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      var sp = spawnFor(me.id);
      if (root.Myk.setPose) root.Myk.setPose(sp[0], sp[1]);
      var settled = false;
      if (!peopleTimer) peopleTimer = setInterval(readRoom, PEOPLE_MS);
      return new Promise(function (resolve) {
        var done = function (list) { if (!settled) { settled = true; resolve(list || []); } };
        setTimeout(function () { done([]); }, 2500);
        db('players').subscribe(function (list) {
          ingest(list || []);
          done(list || []);
        });
      });
    }).catch(function () { return null; });
  }

  function poseOf(o) {
    if (!o.prev) return { x: o.x, y: o.y, yaw: o.yaw };
    var span = Math.max(60, o.t - o.prev.t);
    var a = Math.min(1, Math.max(0, (now() - (1000 / PUBLISH_HZ) - o.prev.t) / span));
    var dy = ((o.yaw - o.prev.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      x: o.prev.x + (o.x - o.prev.x) * a,
      y: o.prev.y + (o.y - o.prev.y) * a,
      yaw: o.prev.yaw + dy * a
    };
  }

  function ingest(list) {
    var t = now(), seen = {}, i, p, cur, moved;
    var names = peopleNames();
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) continue;
      seen[p.id] = 1;
      cur = others[p.id];
      moved = !cur || cur.x !== p.x || cur.y !== p.y || cur.stamp !== p.t;
      others[p.id] = {
        id: p.id,
        name: names[p.id] || p.name || 'Friend',
        x: p.x, y: p.y, yaw: p.yaw || 0, mv: p.mv || 0,
        tint: W.tintFor(p.id),
        stamp: p.t, seen: moved ? t : (cur ? cur.seen : t), t: t,
        prev: cur ? { x: cur.x, y: cur.y, yaw: cur.yaw, t: cur.t } : null
      };
    }
    for (var id in others) {
      if (!seen[id] || !Object.prototype.hasOwnProperty.call(names, id)) delete others[id];
    }
    paint();
    if (onRoster) onRoster(roster());
  }

  function paint() {
    var list = [], id, p, o;
    for (id in others) {
      o = others[id];
      p = poseOf(o);
      list.push({
        id: o.id, name: o.name, x: p.x, y: p.y, yaw: p.yaw,
        mv: o.mv, tint: o.tint
      });
    }
    if (root.Myk && root.Myk.setOthers) root.Myk.setOthers(list);
  }

  function publish(force) {
    if (!PEOPLE || !api || !me.id) return;
    var t = now();
    if (!force && t - lastPublished < 1000 / PUBLISH_HZ) return;
    var po = root.Myk.pose();
    if (!po) return;
    var row = {
      id: me.id,
      x: r2(po.x), y: r2(po.y), yaw: r2(po.yaw),
      mv: po.mv ? 1 : 0
    };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPublished = t;
    row.t = t;
    db('players').put(row).catch(function () {});
  }

  function tick() {
    if (!PEOPLE || !api || !me.id) return;
    paint();
    publish(false);
  }

  function roster() {
    var names = peopleNames(), list = [], id;
    if (me.id && names[me.id]) list.push({ id: me.id, name: me.name, me: true });
    for (id in others) list.push({ id: id, name: others[id].name, me: false });
    return list;
  }

  function countOthers() {
    var n = 0, k;
    for (k in others) n++;
    return n;
  }

  root.MykMp = {
    init: init,
    tick: tick,
    publish: publish,
    roster: roster,
    me: function () { return me; },
    live: function () { return PEOPLE && !!me.id && countOthers() > 0; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    onRoster: function (fn) { onRoster = fn; }
  };

  root['__mykonos'] = {
    state: function () {
      return PEOPLE && me.id ? { x: 1 } : null;
    },
    people: function () {
      if (api && PEOPLE) readRoom();
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () {
      if (api && PEOPLE) readRoom();
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return PEOPLE && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'mykonos-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
