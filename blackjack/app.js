// Blackjack table. gifos.room seats the people; the dealer is the app owner's browser.
// Chips live in the file. The sample API stays behind.
(function () {
  'use strict';
  var BJ = window.BJ;
  var $ = function (id) { return document.getElementById(id); };
  var chips = BJ.START;
  var saveDb = null, roomDb = null;
  var EN = { needsNewer: 'Blackjack needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var rs = null, joined = false;
  var owner = false;      // this copy is the app's owner: it deals (the OS hands it on when the owner leaves)
  var local = null;
  var hostTable = null;
  var items = [];
  var lastSettled = null;
  var handSeq = 0;

  try {
    if (window.gifos) {
      saveDb = gifos.db('save');
      roomDb = gifos.db('room');
    }
  } catch (e) {}

  function nowMs() { return Date.now ? Date.now() : 0; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  }
  function myId() { return rs && rs.me && rs.me.id ? rs.me.id : 'local'; }
  // people at the table: the seats the room holds
  function peopleNow() {
    var out = [];
    ((rs && rs.seats) || []).forEach(function (x) { if (x.id) out.push({ id: x.id, name: x.name || 'player', here: x.here }); });
    return out;
  }
  // others are in the room: the shared table; alone the table is mine
  function shared() { return !!(ROOM && rs && rs.live); }
  function tableRec(list) {
    var i, it;
    for (i = 0; i < (list || []).length; i++) {
      it = list[i];
      if (it && it.kind === 'table') return it;
    }
    return null;
  }
  function amHost() { return !shared() || owner; }
  function tabNow() {
    if (shared() && hostTable && owner) return hostTable;
    if (shared()) {
      var rec = tableRec(items);
      if (rec && rec.phase) return rec;
    }
    return local;
  }

  function paintHand(el, hand, hideHole) {
    el.innerHTML = '';
    (hand || []).forEach(function (c, i) {
      var d = document.createElement('div');
      var hide = hideHole && i === 1;
      d.className = 'card' + (hide ? ' back' : (BJ.RED[c.suit] ? ' red' : ''));
      if (!hide) {
        d.innerHTML = '<span class="tl">' + BJ.label(c) + '</span><span class="c">' + BJ.GLYPH[c.suit] + '</span>';
      }
      el.appendChild(d);
    });
  }
  function showChips() { $('chips').textContent = String(chips); }
  function persistChips() {
    if (!saveDb) return;
    saveDb.put({ id: 'last', chips: chips, settled: lastSettled }).catch(function () {});
  }
  function persistShoe(tab) {
    if (!saveDb || !tab || (shared() && !owner)) return;
    saveDb.put({
      id: 'shoe',
      handId: tab.handId,
      shoe: tab.shoe,
      dealer: tab.dealer,
      hands: tab.hands,
      phase: tab.phase,
      stake: tab.stake,
      msg: tab.msg
    }).catch(function () {});
  }

  function setButtons(tab) {
    var phase = tab ? tab.phase : 'idle';
    var host = amHost();
    var mine = tab ? BJ.activeHand(tab, myId()) : null;
    var myTurn = !!(tab && phase === 'play' && mine);
    var broke = !BJ.canDeal(chips, BJ.STAKE);
    $('deal').hidden = phase === 'play' || !host || broke;
    $('hit').hidden = !myTurn;
    $('stand').hidden = !myTurn;
    $('double').hidden = !(myTurn && BJ.canDouble(tab, myId(), chips));
    $('split').hidden = !(myTurn && BJ.canSplit(tab, myId(), chips));
    $('refill').hidden = !(broke && phase !== 'play');
  }

  function paintMine(tab) {
    var mine = tab ? BJ.myHands(tab, myId()) : [];
    var box = $('pHands');
    box.innerHTML = '';
    if (!mine.length) {
      var row = document.createElement('div');
      row.className = 'hand';
      row.innerHTML = '<h2>You <span>~</span></h2>';
      var cards = document.createElement('div');
      cards.className = 'cards';
      row.appendChild(cards);
      box.appendChild(row);
      return;
    }
    var acting = tab.phase === 'play' ? BJ.activeHand(tab, myId()) : null;
    mine.forEach(function (h, i) {
      var row = document.createElement('div');
      row.className = 'hand' + (acting && acting === h ? ' on' : '');
      var lab = mine.length > 1 ? 'You · ' + (i + 1) : 'You';
      if (h.doubled) lab += ' · double';
      if (h.stood && !h.bust && tab.phase === 'play') lab += ' · stand';
      if (h.bust) lab += ' · bust';
      var tot = BJ.totalLabel(h.cards);
      row.innerHTML = '<h2>' + esc(lab) + ' <span>' + tot + '</span></h2>';
      var cards = document.createElement('div');
      cards.className = 'cards';
      paintHand(cards, h.cards, false);
      row.appendChild(cards);
      box.appendChild(row);
    });
  }

  function paintSeats(tab, people) {
    var box = $('seats');
    box.innerHTML = '';
    (people || []).forEach(function (p) {
      if (p.id === myId()) return;
      var hs = tab ? BJ.myHands(tab, p.id) : [];
      var row = document.createElement('div');
      var acting = tab && tab.phase === 'play' && BJ.activeHand(tab, p.id);
      row.className = 'seat' + (acting ? ' on' : '');
      var name = (p.name || 'player') + (p.here === 'away' ? ' …' : '') + (hs[0] && hs[0].stood && tab && tab.phase === 'play' ? ' · stand' : '');
      row.innerHTML = '<div class="name">' + esc(name) + '</div>';
      hs.forEach(function (h) {
        var cards = document.createElement('div');
        cards.className = 'cards';
        paintHand(cards, h.cards || [], false);
        row.appendChild(cards);
        if (h.cards && h.cards.length) {
          var t = document.createElement('div');
          t.className = 'tot';
          t.textContent = h.bust ? 'bust' : BJ.totalLabel(h.cards);
          row.appendChild(t);
        }
      });
      box.appendChild(row);
    });
    var who = $('who');
    if (!ROOM) {
      who.hidden = false;
      who.textContent = T('needsNewer');
    } else if (!shared() || !people || people.length < 2) {
      who.textContent = '';
      who.hidden = true;
    } else {
      who.hidden = false;
      who.textContent = people.map(function (p) {
        return (p.name || 'player') + (p.id === myId() ? ' (you)' : '') + (p.here === 'away' ? ' …' : '');
      }).join(' · ');
    }
  }

  function render() {
    var tab = tabNow();
    var people = peopleNow();
    var hide = !!(tab && tab.phase === 'play');
    paintHand($('dCards'), tab ? tab.dealer : [], hide);
    if (!tab || !tab.dealer || !tab.dealer.length) {
      $('dTotal').textContent = '~';
    } else if (hide) {
      $('dTotal').textContent = BJ.totalLabel([tab.dealer[0]]);
    } else {
      $('dTotal').textContent = BJ.totalLabel(tab.dealer);
    }
    paintMine(tab);
    paintSeats(tab, people);
    setButtons(tab);
    var hasCards = !!(tab && tab.dealer && tab.dealer.length);
    var idle = $('feltIdle');
    if (idle) idle.hidden = hasCards;
    if ($('dealer')) $('dealer').hidden = !hasCards;
    if ($('pHands')) $('pHands').hidden = !hasCards;
    var msg = $('msg');
    if (!tab) {
      if (shared() && !amHost()) msg.textContent = 'Waiting for the host to deal.';
      else if (!BJ.canDeal(chips, BJ.STAKE)) msg.textContent = 'You are out of chips. Restock 200 and deal again.';
      else msg.textContent = 'Deal when you are ready.';
    } else if (tab.phase === 'play') {
      var mine = BJ.activeHand(tab, myId());
      if (mine) {
        if (BJ.canSplit(tab, myId(), chips)) msg.textContent = 'Hit, stand, double, or split.';
        else if (BJ.canDouble(tab, myId(), chips)) msg.textContent = 'Hit, stand, or double.';
        else msg.textContent = 'Hit or stand.';
      } else if (shared()) msg.textContent = 'Waiting on the table.';
      else msg.textContent = 'Hit or stand.';
    } else {
      msg.textContent = tab.msg || '';
    }
    showChips();
  }

  function settleFrom(tab) {
    if (!tab || tab.phase !== 'done') return;
    if (tab.handId === lastSettled) return;
    if (!BJ.myHands(tab, myId()).length) return;
    lastSettled = tab.handId;
    var net = BJ.netFor(tab, myId());
    chips = BJ.applyDeltas(chips, [net]);
    showChips();
    persistChips();
  }

  function myName() { return (rs && rs.me && rs.me.name) || 'you'; }
  function startLocal() {
    if (!BJ.canDeal(chips, BJ.STAKE)) {
      $('msg').textContent = 'You are out of chips. Restock 200 and deal again.';
      render();
      return;
    }
    handSeq += 1;
    local = BJ.createTable({
      players: [{ id: myId(), name: myName() }],
      stake: BJ.STAKE,
      handId: handSeq
    });
    if (local.phase === 'done') settleFrom(local);
    render();
  }

  function dealTable() {
    if (!BJ.canDeal(chips, BJ.STAKE) || !owner) return;
    var seats = peopleNow().filter(function (p) { return p.here === 'here'; });
    if (!seats.length) return;
    handSeq += 1;
    hostTable = BJ.createTable({
      players: seats.map(function (p) { return { id: p.id, name: p.name || 'player' }; }),
      stake: BJ.STAKE,
      handId: 'h' + nowMs() + '-' + handSeq
    });
    hostTable.seen = {};
    local = null;
    persistShoe(hostTable);
    putTable(hostTable);
    if (hostTable.phase === 'done') settleFrom(hostTable);
    render();
  }

  // A player's action is that player's own row (id = the room id), written only when they act.
  function putAct(rec) {
    if (!roomDb || !ROOM) return;
    roomDb.put(rec).catch(function () {});
  }
  function actRow() {
    var i, it;
    for (i = 0; i < items.length; i++) { it = items[i]; if (it && it.kind === 'act' && it.id === myId()) return it; }
    return null;
  }
  function putTable(tab) {
    if (!roomDb || !shared() || !owner) return;
    var pub = BJ.publicTable(tab) || {};
    pub.id = 'table';
    pub.kind = 'table';
    roomDb.put(pub).catch(function () {});
  }

  function act(action) {
    var tab = tabNow();
    if (shared()) {
      if (tab && owner && tab === hostTable) {
        BJ.applyAction(tab, myId(), action, chips);
        persistShoe(tab);
        putTable(tab);
        if (tab.phase === 'done') settleFrom(tab);
        render();
      } else if (tab) {
        var old = actRow();
        putAct({ id: myId(), kind: 'act', action: action, seq: (old && old.seq ? old.seq : 0) + 1, hand: tab.handId });
      }
      return;
    }
    if (!local) return;
    BJ.applyAction(local, myId(), action, chips);
    if (local.phase === 'done') settleFrom(local);
    render();
  }

  $('deal').onclick = function () {
    if (shared()) {
      if (!owner) { $('msg').textContent = 'The host deals.'; return; }
      dealTable();
      return;
    }
    startLocal();
  };
  $('hit').onclick = function () { act('hit'); };
  $('stand').onclick = function () { act('stand'); };
  $('double').onclick = function () { act('double'); };
  $('split').onclick = function () { act('split'); };
  $('refill').onclick = function () {
    chips = chips + BJ.REFILL;
    showChips();
    persistChips();
    $('msg').textContent = 'Fresh pile. 200 chips.';
    render();
  };

  // The owner runs the dealer: it carries the public table over when the app changed hands,
  // applies each seated player's action row once, and stands the hands of people who left.
  function dealerWork() {
    if (!shared() || !owner) return;
    var rec = tableRec(items), changed = false, seated = {};
    peopleNow().forEach(function (p) { seated[p.id] = p; });
    if (rec && rec.phase === 'play' && (!hostTable || hostTable.handId !== rec.handId)) {
      // the app was handed on mid-hand: rebuild the shoe from the cards not on the table
      var out = {};
      (rec.dealer || []).forEach(function (c) { out[c.value + c.suit] = 1; });
      (rec.hands || []).forEach(function (h) { (h.cards || []).forEach(function (c) { out[c.value + c.suit] = 1; }); });
      var rest = BJ.makeDeck().filter(function (c) { return !out[c.value + c.suit]; });
      hostTable = {
        handId: rec.handId, phase: 'play', dealer: rec.dealer, hands: rec.hands, stake: rec.stake || BJ.STAKE,
        msg: rec.msg, shoe: BJ.shuffle(rest), seen: rec.seen || {}
      };
      local = null;
    }
    if (!hostTable || hostTable.phase !== 'play') return;
    items.forEach(function (it) {
      if (!it || it.kind !== 'act' || it.id === myId() || !seated[it.id]) return;
      if (it.hand !== hostTable.handId || !(it.seq > (hostTable.seen[it.id] || 0))) return;
      hostTable.seen[it.id] = it.seq;
      BJ.applyAction(hostTable, it.id, it.action, 1e9);
      changed = true;
    });
    // a hand whose player no longer holds a seat is stood, so the table is never stuck on someone gone
    (hostTable.hands || []).forEach(function (h) {
      if (hostTable.phase === 'play' && !seated[h.pid] && !h.stood && !h.bust) { h.stood = true; BJ.finishIfDone(hostTable); changed = true; }
    });
    if (changed) { persistShoe(hostTable); putTable(hostTable); }
    if (hostTable.phase === 'done') settleFrom(hostTable);
  }
  function onRoom(list) {
    items = list || [];
    dealerWork();
    var rec = tableRec(items);
    if (shared() && !owner && rec && rec.phase === 'done') settleFrom(rec);
    render();
  }
  function onState(s) {
    rs = s;
    if (!joined && s.me && s.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    if (gifos.info) gifos.info().then(function (i) {
      var o = !!(i && i.owner);
      if (o !== owner) { owner = o; dealerWork(); render(); }
    }).catch(function () {});
    dealerWork();
    render();
  }

  document.addEventListener('keydown', function (e) {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var k = e.key;
    if ((k === 'Enter' || k === ' ') && !$('deal').hidden) {
      e.preventDefault();
      $('deal').click();
    } else if ((k === 'h' || k === 'H') && !$('hit').hidden) {
      e.preventDefault();
      $('hit').click();
    } else if ((k === 's' || k === 'S') && !$('stand').hidden) {
      e.preventDefault();
      $('stand').click();
    } else if ((k === 'd' || k === 'D') && !$('double').hidden) {
      e.preventDefault();
      $('double').click();
    } else if ((k === 'p' || k === 'P') && !$('split').hidden) {
      e.preventDefault();
      $('split').click();
    }
  });

  async function boot() {
    if (window.gifos) {
      try {
        var info = await gifos.info();
        owner = !!(info && info.owner);
      } catch (e) {}
    }
    if (saveDb) {
      try {
        var rec = await saveDb.get('last');
        if (rec && typeof rec.chips === 'number' && rec.chips >= 0) chips = rec.chips;
        if (rec && rec.settled != null) lastSettled = rec.settled;
      } catch (e) {}
      try {
        var sh = await saveDb.get('shoe');
        if (owner && sh && sh.phase === 'play' && sh.shoe && sh.dealer) {
          hostTable = {
            handId: sh.handId, phase: sh.phase, dealer: sh.dealer,
            shoe: sh.shoe, hands: sh.hands, stake: sh.stake || BJ.STAKE, msg: sh.msg, seen: sh.seen || {}
          };
          local = null;
        }
      } catch (e) {}
    }
    showChips();
    if (ROOM) {
      if (roomDb) roomDb.subscribe(onRoom);
      gifos.room.subscribe(onState);
    }
    render();
  }
  window.__blackjack = {
    // the shared table only (never the shoe)
    state: function () {
      var t = tableRec(items);
      return t ? { handId: t.handId, phase: t.phase, dealer: t.dealer, hands: t.hands, stake: t.stake } : { handId: null, phase: 'idle' };
    }
  };
  boot();
})();
