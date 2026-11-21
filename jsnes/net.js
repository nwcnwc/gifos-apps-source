/*
 * jsnes — player two over a meeting (gifos.room).
 *
 * The seats (Pad 1, Pad 2) come from gifos.room; a third arrival waits in the
 * line and watches. Each seated person writes ONLY their own row in `pads`
 * (a button mask, keyed by their room id), and only when the mask changes. The
 * app's owner (gifos.info().owner) writes `session` (which cart, pause,
 * reset) and, for a dump they dropped, `cart` once; everybody else only reads
 * them. When the owner leaves, GifOS hands the app to the next copy, which then
 * owns those rows. Every copy runs the same ROM and feeds each other seated
 * person's mask to that person's pad. Rows of people with no seat are ignored.
 */
(function (root) {
  'use strict';

  var api = null;
  var ROOM = false;
  var rs = null;
  var joined = false;
  var me = { id: null, name: 'P1' };
  var owner = true;
  var rows = {};
  var lastMask = 0;
  var lastReset = 0;
  var lastPause = false;
  var lastHash = '';
  var sessRow = null;
  var onRoom = null;
  var onCart = null;
  var pendingCart = null;

  function db(n) { return api && api.db ? api.db(n) : null; }
  function now() { return Date.now(); }

  // My pad: 1 or 2 by seat; 0 when I only watch or wait. Without a room: pad 1.
  function myPad() {
    if (!ROOM || !rs || !rs.me) return 1;
    for (var i = 0; i < 2; i++) if (rs.seats[i] && rs.seats[i].id && rs.seats[i].id === rs.me.id) return i + 1;
    return 0;
  }

  function seatedOthers() {
    var out = [];
    if (!ROOM || !rs) return out;
    var mine = myPad();
    for (var i = 0; i < 2; i++) {
      var st = rs.seats[i];
      if (i + 1 === mine || !st || !st.id || st.here !== 'here') continue;
      out.push({ pad: i + 1, id: st.id, name: st.name || 'P' + (i + 1) });
    }
    return out;
  }

  function ingestPads(list) {
    rows = {};
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || !p.id || p.id === me.id) continue;
      rows[p.id] = p.mask | 0;
    }
    applyRemote();
    if (onRoom) onRoom(roster());
  }

  function ingestSession(list) {
    var rec = null, i;
    for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'ses') rec = list[i];
    sessRow = rec;
    if (!rec) return;
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

  // Every seated person other than me drives their own pad here; a pad whose person is gone is released.
  function applyRemote() {
    if (!root.Emu || !ROOM || !rs) return;
    var mine = myPad(), held = {}, o = seatedOthers(), i;
    for (i = 0; i < o.length; i++) {
      held[o[i].pad] = 1;
      root.Emu.applyMask(o[i].pad, rows[o[i].id] | 0);
    }
    for (var pad = 1; pad <= 2; pad++) if (pad !== mine && !held[pad]) root.Emu.applyMask(pad, 0);
  }

  function roster() {
    var list = [], mine = myPad();
    if (mine) list.push({ id: me.id, name: me.name, me: true, pad: mine });
    var o = seatedOthers();
    for (var i = 0; i < o.length; i++) list.push({ id: o[i].id, name: o[i].name, me: false, pad: o[i].pad });
    return list;
  }

  // My button mask: written when it changes, and only while I hold a pad with somebody to play with.
  function publish() {
    if (!ROOM || !rs || !rs.me || !myPad() || seatedOthers().length === 0) return;
    var mask = root.Emu ? root.Emu.localMask() : 0;
    if (mask === lastMask) return;
    lastMask = mask;
    var col = db('pads');
    if (!col) return;
    col.put({ id: me.id, mask: mask }).catch(function () {});
  }

  function publishSession(extra) {
    if (!ROOM || !me.id || !owner) return;
    var cart = root.Emu && root.Emu.cart();
    var rec = {
      id: 'ses',
      by: me.id,
      hash: cart ? cart.hash : '',
      name: cart ? cart.name : '',
      sample: cart ? !!cart.sample : false,
      sampleId: cart && cart.sample ? cart.id : '',
      paused: !!(root.Emu && root.Emu.paused()),
      resetN: lastReset
    };
    if (extra) for (var k in extra) rec[k] = extra[k];
    if (rec.resetN) lastReset = rec.resetN;
    lastPause = rec.paused;
    lastHash = rec.hash;
    var s0 = sessRow;
    if (s0 && s0.by === rec.by && s0.hash === rec.hash && !!s0.paused === rec.paused && (s0.resetN | 0) === (rec.resetN | 0)) return;   // nothing new to say
    var col = db('session');
    if (col) col.put(rec).catch(function () {});
  }

  function publishCart(bytes, meta) {
    if (!ROOM || !me.id || !owner) return;
    var col = db('cart');
    if (!col) return;
    col.put({
      id: 'cart',
      hash: meta.hash,
      name: meta.name,
      sample: !!meta.sample,
      sampleId: meta.sample ? meta.id : '',
      bytes: bytes
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

  function onRoomState(s) {
    rs = s;
    if (s && s.me) { me.id = s.me.id; me.name = s.me.name || 'P1'; }
    // Opening the game is asking to play, once; the room seats me, lines me up, or asks the host.
    if (!joined && s && s.me && s.me.role === 'watcher') { joined = true; api.room.join().catch(function () {}); }
    refreshOwner();
    applyRemote();
    if (onRoom) onRoom(roster());
  }

  // Who owns the app can change (the owner leaves, GifOS hands it on): a local read, no network.
  function refreshOwner() {
    if (!ROOM || !api.info) return;
    api.info().then(function (i) {
      var o = !!(i && i.owner);
      if (o !== owner) { owner = o; if (onRoom) onRoom(roster()); }
    }).catch(function () {});
  }

  function init() {
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0, old: false });
    ROOM = !!(api.room && api.room.subscribe);
    if (!ROOM) return Promise.resolve({ owner: true, others: 0, old: true });   // older GifOS: solo only, nothing shared
    var infoP = api.info ? api.info().then(function (i) {
      owner = !!(i && i.owner);
    }).catch(function () { owner = true; }) : Promise.resolve();
    return infoP.then(function () {
      db('pads').subscribe(ingestPads);
      db('session').subscribe(ingestSession);
      api.room.subscribe(onRoomState);
      return { owner: owner, others: 0, old: false };
    }).catch(function () {
      return { owner: true, others: 0, old: false };
    });
  }

  var ownerAt = 0;
  function beforeFrame() {
    if (!ROOM || !me.id) return;
    var t = now();
    if (t - ownerAt > 2000) { ownerAt = t; refreshOwner(); }
    publish();
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
    live: function () { return ROOM && !!rs && !!me.id; },
    count: function () { return roster().length; },
    others: function () { return seatedOthers().length; },
    myPad: myPad,
    refreshOwner: refreshOwner,
    seats: function () { return rs ? rs.seats.map(function (x) { return x.id || null; }) : []; },
    session: function () { return sessRow; },
    onRoom: function (fn) { onRoom = fn; },
    onCart: function (fn) { onCart = fn; },
    pendingCart: function () { return pendingCart; }
  };
})(window);
