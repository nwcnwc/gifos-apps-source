/*
 * TIC-80 — the desk over a meeting.
 *
 * The only channel is a replicated collection. Each peer writes ONLY
 * their own row in `pads`. Anyone may put a cart on `desk` (filename +
 * bytes). The app owner writes `session` (whose cart is loaded). Guests
 * never put() session. A cart you save or drop shows up for them.
 * Who is here is gifos.people(). Publish pads only when the mask changes.
 */
(function (root) {
  'use strict';

  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'TIC-80 needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var api = null;
  var me = { id: null, name: 'P1' };
  var owner = true;
  var others = {};
  var roomPeople = [];
  var roomKey = '';
  var lastMask = -1;
  var deskSeen = {};
  var onRoom = null;
  var onDesk = null;
  var maskNow = 0;
  var sessionCart = '';

  function db(n) { return api && api.db ? api.db(n) : null; }
  function now() { return Date.now(); }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'P2';
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
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'P1'; }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        if (onRoom) onRoom(roster());
      }
    }, function () {});
  }

  function roster() {
    var names = peopleNames();
    var list = [{ id: me.id, name: me.name, me: true }], id;
    for (id in others) list.push({ id: id, name: names[id] || others[id].name, me: false });
    return list;
  }

  function ingestPads(list) {
    var names = peopleNames(), seen = {}, i, p;
    for (i = 0; i < (list || []).length; i++) {
      p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      if (!names[p.id]) continue;
      seen[p.id] = 1;
      others[p.id] = { id: p.id, name: names[p.id] || p.name || 'P2', mask: p.mask | 0 };
    }
    for (i in others) if (!seen[i] || !names[i]) delete others[i];
    if (onRoom) onRoom(roster());
  }

  function ingestDesk(list) {
    var i, r, b, name;
    for (i = 0; i < (list || []).length; i++) {
      r = list[i];
      if (!r || !r.id || r.by === me.id) continue;
      if (deskSeen[r.id] === r.t) continue;
      deskSeen[r.id] = r.t;
      b = root.TicFS && root.TicFS.bytesOf(r.bytes);
      if (!b) continue;
      name = r.id;
      if (root.TicFS) root.TicFS.putCart(name, b);
      if (onDesk) onDesk(name, b);
    }
  }

  function publishPad(force) {
    var col = db('pads');
    if (!col || !me.id || !PEOPLE) return;
    if (!force && maskNow === lastMask) return;
    lastMask = maskNow;
    col.put({ id: me.id, mask: maskNow | 0 }).catch(function () {});
  }

  function publishCart(name, bytes) {
    var col = db('desk');
    if (!col || !name || !bytes || !PEOPLE) return;
    var t = now();
    deskSeen[name] = t;
    col.put({
      id: name, name: name, by: me.id,
      bytes: root.TicFS ? root.TicFS.b64(bytes) : null,
      t: t
    }).catch(function () {});
  }

  function publishSession(cart) {
    var col = db('session');
    if (!col || !owner || !PEOPLE) return;
    sessionCart = cart || '';
    col.put({ id: 'ses', by: me.id, cart: sessionCart, t: now() }).catch(function () {});
  }

  function setMask(m) { maskNow = m | 0; publishPad(false); }

  function start(gifos, who, isOwner, hooks) {
    api = gifos;
    if (who && who.id) { me.id = who.id; me.name = who.name || me.name; }
    owner = !!isOwner;
    onRoom = hooks && hooks.onRoom;
    onDesk = hooks && hooks.onDesk;
    if (!PEOPLE) return;
    var pads = db('pads'), desk = db('desk'), ses = db('session');
    readRoom().then(function () {
      if (pads && pads.subscribe) pads.subscribe(function (list) { ingestPads(list); });
      if (desk && desk.subscribe) desk.subscribe(function (list) { ingestDesk(list); });
      if (ses && ses.subscribe) ses.subscribe(function (list) {
        var i, r;
        for (i = 0; i < (list || []).length; i++) {
          r = list[i];
          if (r && r.id === 'ses') sessionCart = r.cart || '';
        }
      });
      publishPad(true);
      setInterval(readRoom, PEOPLE_MS);
    });
  }

  root.TicNet = {
    start: start,
    setMask: setMask,
    publishCart: publishCart,
    publishSession: publishSession,
    roster: roster
  };

  root['__tic80'] = {
    state: function () {
      return PEOPLE ? { cart: sessionCart || '' } : null;
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
    _n.id = 'tic80-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
