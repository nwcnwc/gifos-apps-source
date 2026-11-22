/*
 * jsnes — player two over a meeting.
 *
 * The only channel is a replicated collection. Each peer writes ONLY
 * their own row in `pads` (a button mask). The host writes `session`
 * (which cart, pause, reset) and, for a dump they dropped, `cart` once.
 * Guests never put() those. Both run the same ROM; the host is pad 1,
 * the first guest is pad 2. A third arrival watches.
 * Who is here is gifos.people(). Publish only when the pad mask changes.
 */
(function (root) {
  'use strict';

  var PUBLISH_HZ = 24;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'jsnes needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';

  var api = null;
  var me = { id: null, name: 'P1' };
  var owner = true;
  var others = {};
  var guestId = null;
  var lastPub = 0;
  var lastMask = -1;
  var lastReset = 0;
  var lastPause = false;
  var lastHash = '';
  var hostId = null;
  var onRoom = null;
  var onCart = null;
  var pendingCart = null;
  var roomPeople = [];
  var roomKey = '';
  var lastPubSig = '';

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

  function countOthers() {
    var n = 0, id;
    for (id in others) n++;
    return n;
  }

  function pickGuest() {
    var best = null, id;
    for (id in others) {
      if (!best || id < best.id) best = others[id];
    }
    guestId = best ? best.id : null;
    return guestId;
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
      if (mine) { me.id = mine.id; me.name = mine.name || (owner ? 'P1' : 'P2'); }
      if (key !== roomKey) {
        roomKey = key;
        var names = peopleNames(), id;
        for (id in others) if (!names[id]) delete others[id];
        pickGuest();
        applyRemote();
        if (onRoom) onRoom(roster());
      }
    }, function () {});
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
    pickGuest();
    applyRemote();
    if (onRoom) onRoom(roster());
  }

  function ingestSession(list) {
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'ses') rec = list[i];
    if (!rec) return;
    if (rec.by) hostId = rec.by;
    if (owner) return;
    if (rec.resetN && rec.resetN !== lastReset) {
      lastReset = rec.resetN;
      if (root.Emu) root.Emu.reset();
    }
    if (!!rec.paused !== lastPause) {
      lastPause = !!rec.paused;
      if (root.Emu) root.Emu.setPaused(lastPause);
    }
    if (rec.hash && rec.hash !== lastHash) {
      lastHash = rec.hash;
      pendingCart = rec;
      if (onCart) onCart(rec);
    }
  }

  function applyRemote() {
    if (!root.Emu) return;
    if (owner) {
      var g = guestId && others[guestId];
      if (g) root.Emu.applyMask(2, g.mask);
      return;
    }
    var h = (hostId && others[hostId]) || null;
    if (!h) {
      for (var id in others) { h = others[id]; break; }
    }
    if (h) root.Emu.applyMask(1, h.mask);
  }

  function roster() {
    var list = [{ id: me.id, name: me.name, me: true, pad: owner ? 1 : 2 }];
    var id;
    for (id in others) {
      list.push({
        id: id, name: others[id].name, me: false,
        pad: owner ? (id === guestId ? 2 : 0) : 1
      });
    }
    return list;
  }

  function publish(force) {
    if (!api || !me.id || !PEOPLE) return;
    var t = now();
    var mask = root.Emu ? root.Emu.localMask() : 0;
    if (!force && t - lastPub < 1000 / PUBLISH_HZ && mask === lastMask) return;
    var row = { id: me.id, mask: mask };
    var sig = JSON.stringify(row);
    if (!force && sig === lastPubSig) return;
    lastPubSig = sig;
    lastPub = t;
    lastMask = mask;
    var col = db('pads');
    if (!col) return;
    row.name = me.name;
    row.t = t;
    col.put(row).catch(function () {});
  }

  function publishSession(extra) {
    if (!api || !me.id || !owner || !PEOPLE) return;
    var cart = root.Emu && root.Emu.cart();
    var rec = {
      id: 'ses',
      by: me.id,
      hash: cart ? cart.hash : '',
      name: cart ? cart.name : '',
      sample: cart ? !!cart.sample : false,
      sampleId: cart && cart.sample ? cart.id : '',
      paused: !!(root.Emu && root.Emu.paused()),
      resetN: lastReset,
      t: now()
    };
    if (extra) for (var k in extra) rec[k] = extra[k];
    if (rec.resetN) lastReset = rec.resetN;
    lastPause = rec.paused;
    lastHash = rec.hash;
    var col = db('session');
    if (col) col.put(rec).catch(function () {});
  }

  function publishCart(bytes, meta) {
    if (!api || !me.id || !owner || !PEOPLE) return;
    var col = db('cart');
    if (!col) return;
    col.put({
      id: 'cart',
      hash: meta.hash,
      name: meta.name,
      sample: !!meta.sample,
      sampleId: meta.sample ? meta.id : '',
      bytes: bytes,
      t: now()
    }).catch(function () {});
  }

  function fetchCart() {
    var col = db('cart');
    if (!col) return Promise.resolve(null);
    return col.get('cart').catch(function () { return null; });
  }

  function bumpReset() {
    lastReset = (lastReset | 0) + 1;
    publishSession({ resetN: lastReset });
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) return Promise.resolve({ owner: true, others: 0 });
    return readRoom().then(function () {
      if (!me.id) return { owner: true, others: 0 };
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          resolve({ owner: owner, others: countOthers() });
        };
        setTimeout(done, 1800);
        db('pads').subscribe(function (list) {
          ingestPads(list || []);
          done();
        });
        db('session').subscribe(function (list) {
          ingestSession(list || []);
        });
        setInterval(readRoom, PEOPLE_MS);
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  function beforeFrame() {
    if (!api || !me.id || !PEOPLE) return;
    publish(false);
    applyRemote();
  }

  root.Net = {
    init: init,
    beforeFrame: beforeFrame,
    publish: publish,
    publishSession: publishSession,
    publishCart: publishCart,
    fetchCart: fetchCart,
    bumpReset: bumpReset,
    roster: roster,
    me: function () { return me; },
    owner: function () { return owner; },
    live: function () { return !!api && !!me.id && PEOPLE; },
    count: function () { return countOthers() + (me.id ? 1 : 0); },
    others: function () { return countOthers(); },
    guestId: function () { return guestId; },
    onRoom: function (fn) { onRoom = fn; },
    onCart: function (fn) { onCart = fn; },
    pendingCart: function () { return pendingCart; }
  };

  root['__jsnes'] = {
    state: function () {
      return me.id ? { hash: lastHash || '', paused: lastPause ? 1 : 0, resetN: lastReset | 0 } : null;
    },
    people: function () {
      var names = peopleNames(), out = [], id;
      for (id in names) out.push(id);
      return out;
    },
    amHost: function () { return !!me.id && owner && peopleCount() > 1; }
  };
})(window);
