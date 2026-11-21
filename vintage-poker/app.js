// Vintage Poker — gifos.room seats the people; the app owner's browser is the dealer.
// Their game server stays behind. Each player writes ONLY their own act row, and only when they act.
(function () {
  'use strict';
  var PK = window.PK;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch];
    });
  };

  var EN = { needsNewer: 'Vintage Poker needs a newer GifOS to play together. Reload the page to update.' };
  var T = function (k) {
    var v = window.gifos && gifos.i18n && gifos.i18n.t ? gifos.i18n.t(k) : k;
    return v === k && EN.hasOwnProperty(k) ? EN[k] : v;
  };
  var ROOM = !!(window.gifos && gifos.room && gifos.room.subscribe);
  var rs = null, joined = false;
  var view = 'home';
  var chips = PK.START;
  var saveDb = null, roomDb = null;
  var owner = false;   // the app's owner deals; GifOS hands the app on when they leave
  var me = { id: 'local', name: 'You' };
  var local = null;
  var botTimer = 0;

  try {
    if (window.gifos) {
      saveDb = gifos.db('save');
      roomDb = gifos.db('room');
    }
  } catch (e) {}

  function show(id) {
    view = id;
    ['home', 'lobby', 'play'].forEach(function (k) { $(k).hidden = k !== id; });
    document.body.classList.toggle('play-on', id === 'play');
  }
  function showChips() { $('chips').textContent = String(chips); }
  function persistChips() {
    if (!saveDb) return;
    saveDb.put({ id: 'last', chips: chips }).catch(function () {});
  }
  function bankFromSeat(t, id) {
    var i = PK.seatById(t, id);
    if (i < 0) return chips;
    return t.seats[i].stack;
  }
  function saveBank(t) {
    if (!t) return;
    if (t.phase !== 'showdown' && t.phase !== 'idle') return;
    var n = bankFromSeat(t, me.id);
    if (typeof n === 'number') { chips = n; persistChips(); showChips(); }
  }

  function paintCard(c, hide) {
    var d = document.createElement('div');
    if (!c || !c.r) {
      d.className = 'pcard ghost';
      return d;
    }
    if (hide) { d.className = 'pcard back'; return d; }
    d.className = 'pcard' + (PK.RED[c.s] ? ' red' : '');
    d.innerHTML = '<span class="tl">' + PK.label(c) + '</span><span class="c">' + PK.GLYPH[c.s] + '</span>';
    return d;
  }
  function paintBoard(el, cards) {
    el.innerHTML = '';
    var i;
    for (i = 0; i < 5; i++) el.appendChild(paintCard(cards && cards[i], false));
  }
  function paintHole(el, cards, hideAll) {
    el.innerHTML = '';
    if (!cards || !cards.length) {
      el.appendChild(paintCard(null));
      el.appendChild(paintCard(null));
      return;
    }
    cards.forEach(function (c) { el.appendChild(paintCard(c, hideAll)); });
  }

  function seatEl(s, t) {
    var d = document.createElement('div');
    var toAct = t && t.toAct;
    var won = t && t.winners && t.winners.some(function (w) { return w.i === s.i; });
    d.className = 'seat' + (s.i === toAct ? ' on' : '') + (s.id === me.id ? ' me' : '') + (!s.id ? ' empty' : '') + (won ? ' win' : '');
    if (!s.id) {
      d.innerHTML = '<div class="name">Empty seat</div>';
      return d;
    }
    var tags = [];
    if (t && s.i === t.dealer) tags.push('D');
    if (s.lastAction) tags.push(s.lastAction);
    else if (s.folded) tags.push('fold');
    else if (s.allIn) tags.push('all-in');
    var hole = '';
    if (t && t.phase === 'showdown' && s.hand && s.hand.length && s.hand[0] && s.hand[0].r) {
      hole = '<div class="mini">' + s.hand.map(function (c) { return PK.label(c); }).join(' ') + '</div>';
    }
    d.innerHTML = '<div class="name">' + esc(s.name || 'Player') +
      (s.isBot ? ' <span class="tag">bot</span>' : '') +
      (s.id === me.id && s.name !== 'You' ? ' <span class="tag">you</span>' : '') + '</div>' +
      '<div class="meta">' + s.stack + ' chips' + (s.bet ? ' · bet ' + s.bet : '') + '</div>' +
      (tags.length ? '<div class="tag">' + tags.join(' · ') + '</div>' : '') +
      hole;
    return d;
  }

  function paintSeats(t) {
    var el = $('seats');
    el.innerHTML = '';
    var seats = (t && t.seats) || [];
    var live = 0, i, s;
    for (i = 0; i < seats.length; i++) {
      s = seats[i];
      if (s && s.id) { el.appendChild(seatEl(s, t)); live++; }
    }
    if (live < PK.MAX) {
      var empty = document.createElement('div');
      empty.className = 'seat empty';
      empty.innerHTML = '<div class="name">' + (PK.MAX - live) + ' empty seat' + (PK.MAX - live === 1 ? '' : 's') + '</div>';
      el.appendChild(empty);
    }
    if (!live) {
      var none = document.createElement('div');
      none.className = 'seat empty';
      none.innerHTML = '<div class="name">Empty table</div><div class="meta">Waiting for someone to sit.</div>';
      el.innerHTML = '';
      el.appendChild(none);
    }
  }

  function setAct(t, mySeat) {
    var idle = !t || t.phase === 'idle' || t.phase === 'showdown';
    var mine = mySeat >= 0 && t && PK.canAct(t, mySeat);
    var L = mine ? PK.legal(t, mySeat) : null;
    var hostDeal = idle && (!mp.on || owner);
    var seatedHere = seated().filter(function (p) { return p.here === 'here'; }).length;
    if (mp.on && idle && seatedHere < 2) hostDeal = false;
    $('dealBtn').hidden = !hostDeal;
    $('foldBtn').hidden = !mine;
    $('checkBtn').hidden = !(mine && L.check);
    $('callBtn').hidden = !(mine && L.toCall > 0);
    $('raiseBtn').hidden = !(mine && L.raiseTo);
    $('raiseRow').hidden = !(mine && L.raiseTo);
    if (mine && L.toCall > 0) $('callBtn').textContent = 'Call ' + L.call;
    else $('callBtn').textContent = 'Call';
    if (mine && L.raiseTo) {
      $('raiseRange').min = L.minRaiseTo;
      $('raiseRange').max = L.raiseTo;
      $('raiseRange').value = L.minRaiseTo;
      $('raiseAmt').textContent = String(L.minRaiseTo);
      $('raiseMin').onclick = function () { setRaise(L.minRaiseTo); };
      $('raisePot').onclick = function () { setRaise(Math.min(L.raiseTo, Math.max(L.minRaiseTo, (t.pot || 0) + L.toCall))); };
      $('raiseAll').onclick = function () { setRaise(L.raiseTo); };
    }
    var wait = $('waitPill');
    if (!mine && !idle && t && t.toAct != null && t.seats[t.toAct]) {
      wait.hidden = false;
      wait.textContent = (t.seats[t.toAct].name || 'Player') + ' to act.';
    } else {
      wait.hidden = true;
    }
    if (mine) $('legalHint').textContent = L && L.toCall > 0 ? ('Your turn — ' + L.call + ' to call.') : 'Your turn.';
    else if (idle) $('legalHint').textContent = '';
    else $('legalHint').textContent = '';
    var broke = mySeat >= 0 && t && t.seats[mySeat] && t.seats[mySeat].stack < PK.BB;
    $('topupBtn').hidden = !(idle && broke);
  }
  function setRaise(n) {
    n = n | 0;
    $('raiseRange').value = String(n);
    $('raiseAmt').textContent = String(n);
  }

  var shownT = null;   // the table as this copy last drew it (its hand number stamps my act row)
  function renderTable(t, viewerId) {
    if (!t) return;
    shownT = t;
    $('pot').textContent = t.phase === 'showdown' ? 'Showdown' : ('Pot ' + t.pot + (t.phase && t.phase !== 'idle' ? ' · ' + t.phase : ''));
    paintBoard($('board'), t.board);
    paintSeats(t);
    var si = PK.seatById(t, viewerId);
    var hole = si >= 0 ? t.seats[si].hand : [];
    paintHole($('hole'), hole);
    $('playStatus').textContent = t.msg || '';
    if (si >= 0) {
      $('chips').textContent = String(t.seats[si].stack);
    }
    setAct(t, si);
  }

  function stopBots() {
    if (botTimer) { clearTimeout(botTimer); botTimer = 0; }
  }
  function kickBots() {
    stopBots();
    if (!local) return;
    if (local.phase === 'idle' || local.phase === 'showdown') return;
    var s = local.seats[local.toAct];
    if (!s || !s.isBot) return;
    botTimer = setTimeout(function () {
      botTimer = 0;
      if (!local) return;
      var seat = local.seats[local.toAct];
      if (!seat || !seat.isBot) return;
      var a = PK.botKind(local, seat.i);
      if (!a) return;
      PK.applyAction(local, seat.i, a.kind, a.amount);
      afterLocal();
    }, 450);
  }
  function afterLocal() {
    renderTable(local, me.id);
    saveBank(local);
    kickBots();
  }

  function startLocal() {
    mp.on = false;
    local = PK.newTable();
    if (chips < PK.BB) { chips = PK.START; persistChips(); }
    PK.sit(local, me.id, me.name || 'You', chips, false);
    PK.sit(local, 'bot-ada', 'Ada', PK.START, true);
    PK.sit(local, 'bot-chip', 'Chip', PK.START, true);
    PK.startHand(local);
    show('play');
    afterLocal();
  }
  $('soloBtn').onclick = startLocal;

  $('dealBtn').onclick = function () {
    if (local) {
      if (chips < PK.BB) { chips = PK.START; persistChips(); showChips(); }
      var si = PK.seatById(local, me.id);
      if (si >= 0 && local.seats[si].stack < PK.BB) PK.rebuy(local, me.id, PK.START);
      PK.startHand(local);
      afterLocal();
      return;
    }
    if (mp.on && owner) hostDeal();
  };
  $('topupBtn').onclick = function () {
    chips = PK.START;
    persistChips();
    showChips();
    if (local) {
      PK.rebuy(local, me.id, PK.START);
      afterLocal();
    }
    if (mp.on) putAct({});
  };
  $('foldBtn').onclick = function () { doAct('fold'); };
  $('checkBtn').onclick = function () { doAct('check'); };
  $('callBtn').onclick = function () { doAct('call'); };
  $('raiseBtn').onclick = function () { doAct('raise', parseInt($('raiseRange').value, 10)); };
  $('raiseRange').oninput = function () { $('raiseAmt').textContent = this.value; };

  function doAct(kind, amount) {
    if (local) {
      var si = PK.seatById(local, me.id);
      if (si < 0) return;
      PK.applyAction(local, si, kind, amount);
      afterLocal();
      return;
    }
    if (!mp.on || !myId() || !shownT) return;
    if (owner && table) {
      var hs = PK.seatById(table, myId());
      if (hs >= 0 && PK.canAct(table, hs)) {
        PK.applyAction(table, hs, kind, amount);
        putTable(table);
        renderTable(table, myId());
        saveBank(table);
      }
      return;
    }
    putAct({ act: kind, amt: amount || 0, hand: shownT.handNo });
  }

  // ---- multiplayer ----
  var mp = { on: false };
  var _items = [];
  var table = null;
  var seenAct = {};   // the owner's own tally for this hand; the public table carries it across a hand-off

  function myId() { return rs && rs.me && rs.me.id ? rs.me.id : null; }
  function myName() { return (rs && rs.me && rs.me.name) || 'Player'; }
  // the people at the table: the seats the room holds
  function seated() {
    var out = [];
    ((rs && rs.seats) || []).forEach(function (x) { if (x.id) out.push({ id: x.id, name: x.name || 'Player', here: x.here }); });
    return out;
  }
  function isHost() { return owner; }
  function tableRec(items) {
    var i, it;
    for (i = 0; i < (items || []).length; i++) {
      it = items[i];
      if (it && it.kind === 'table') return it;
    }
    return null;
  }
  function rowOf(id) {
    var i, it;
    for (i = 0; i < _items.length; i++) { it = _items[i]; if (it && it.kind === 'act' && it.id === id) return it; }
    return null;
  }

  // My own row, written only when I act (an action or a top-up), keyed by my room id.
  function putAct(extra) {
    var id = myId();
    if (!roomDb || !id) return;
    var old = rowOf(id);
    var row = { id: id, kind: 'act', chips: chips, seq: (old && old.seq ? old.seq : 0) + 1 };
    if (old && old.hand != null) row.hand = old.hand;
    if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k]; });
    // a local view of my own row so the next write counts on from it
    var k2 = -1, q;
    for (q = 0; q < _items.length; q++) if (_items[q] && _items[q].id === id && _items[q].kind === 'act') k2 = q;
    if (k2 >= 0) _items[k2] = row; else _items.push(row);
    roomDb.put(row).catch(function () {});
  }

  function putTable(t) {
    var id = myId();
    if (!roomDb || !id || !owner) return;
    // the hole cards are in the shared table: they were before this change (no private channel to one person)
    var pub = PK.publicTable(t, null, true);
    roomDb.put({ id: 'table', kind: 'table', t: pub, seen: seenAct }).catch(function () {});
  }

  function hydrate(pub) {
    var t = PK.newTable();
    if (!pub) return t;
    t.phase = pub.phase; t.board = pub.board || []; t.pot = pub.pot || 0;
    t.toAct = pub.toAct; t.dealer = pub.dealer || 0; t.streetBet = pub.streetBet || 0;
    t.minRaise = pub.minRaise || PK.BB; t.winners = pub.winners || [];
    t.msg = pub.msg || ''; t.handNo = pub.handNo || 0;
    (pub.seats || []).forEach(function (s, i) {
      var d = t.seats[i];
      if (!d || !s) return;
      d.id = s.id; d.name = s.name; d.stack = s.stack; d.bet = s.bet;
      d.folded = !!s.folded; d.allIn = !!s.allIn; d.sittingOut = !!s.sittingOut;
      d.lastAction = s.lastAction; d.isBot = !!s.isBot;
      d.hand = (s.hand || []).map(function (c) { return c && c.r ? PK.cloneCard(c) : { r: 0, s: 's' }; });
    });
    return t;
  }

  function hostDeal() {
    var people = seated().filter(function (p) { return p.here === 'here'; });
    if (!owner) return;
    if (people.length < 2) {
      $('lobbyStatus').textContent = 'Waiting for another player. Press Invite in the GifOS menu and send friends the link.';
      $('lobbyEmpty').hidden = false;
      return;
    }
    table = table ? hydrate(PK.publicTable(table, null, true)) : PK.newTable();
    var stacks = {};
    table.seats.forEach(function (s) { if (s.id) stacks[s.id] = s.stack; });
    table.seats = PK.newTable().seats;
    people.forEach(function (p) {
      var row = rowOf(p.id);
      var buy = stacks[p.id] != null ? stacks[p.id] : (row && row.chips ? row.chips : PK.START);
      if (buy < PK.BB) buy = (row && row.chips >= PK.BB) ? row.chips : PK.START;
      PK.sit(table, p.id, p.name, buy, false);
    });
    seenAct = {};
    if (!PK.startHand(table)) return;
    putTable(table);
    show('play');
    renderTable(table, myId());
  }

  // The owner takes the table over when the app was handed on mid-hand: the public table holds every hand,
  // so the deck is whatever is left.
  function adoptTable(rec) {
    var t = hydrate(rec.t), out = {}, i, s;
    (t.board || []).forEach(function (c) { if (c && c.r) out[c.r + c.s] = 1; });
    t.seats.forEach(function (x) { (x.hand || []).forEach(function (c) { if (c && c.r) out[c.r + c.s] = 1; }); });
    t.deck = PK.shuffle(PK.makeDeck().filter(function (c) { return !out[c.r + c.s]; }));
    for (i = 0; i < t.seats.length; i++) {
      s = t.seats[i];
      s.contrib = s.contrib || 0;
      s.acted = !!s.acted;
    }
    seenAct = JSON.parse(JSON.stringify(rec.seen || {}));
    return t;
  }

  // Owner only: apply each seated player's act row once, and fold the hands of people who left.
  function hostIngest() {
    if (!owner || !mp.on) return;
    var rec = tableRec(_items);
    if (rec && rec.t && rec.t.phase !== 'idle' && rec.t.phase !== 'showdown' && (!table || table.handNo !== rec.t.handNo)) table = adoptTable(rec);
    if (!table || table.phase === 'idle' || table.phase === 'showdown') return;
    var here = {}, changed = false, i, p, si;
    seated().forEach(function (x) { here[x.id] = 1; });
    for (i = 0; i < _items.length; i++) {
      p = _items[i];
      if (!p || p.kind !== 'act' || p.id === myId() || !here[p.id] || !p.act) continue;
      if (p.hand !== table.handNo || !(p.seq > (seenAct[p.id] || 0))) continue;
      si = PK.seatById(table, p.id);
      seenAct[p.id] = p.seq;
      if (si < 0 || !PK.canAct(table, si)) { changed = true; continue; }
      PK.applyAction(table, si, p.act, p.amt);
      changed = true;
    }
    // somebody the room no longer seats is out of the hand: their turn is a fold, otherwise they just stop counting
    for (si = 0; si < table.seats.length; si++) {
      var st = table.seats[si];
      if (!st.id || st.isBot || here[st.id] || table.phase === 'showdown' || st.folded) continue;
      if (PK.canAct(table, si)) PK.applyAction(table, si, 'fold');
      else { st.folded = true; st.lastAction = 'left'; }
      changed = true;
    }
    if (changed) putTable(table);
  }

  function renderLobby(people) {
    var ul = $('lobbyList');
    ul.innerHTML = '';
    if (!people.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Empty table — nobody is seated yet.';
      ul.appendChild(empty);
    } else {
      people.forEach(function (p) {
        var li = document.createElement('li');
        li.textContent = (p.name || 'Player') + (p.id === myId() ? ' (you)' : '') + (p.here === 'away' ? ' …' : '');
        ul.appendChild(li);
      });
    }
    var host = isHost();
    var n = people.length;
    $('dealLobby').hidden = !(host && n >= 2);
    $('lobbyEmpty').hidden = n >= 2;
    if (!ROOM) {
      $('lobbyStatus').textContent = T('needsNewer');
      $('dealLobby').hidden = true;
      $('lobbyEmpty').hidden = true;
    } else if (n < 2) {
      $('lobbyStatus').textContent = 'Waiting for another player. Press Invite in the GifOS menu and send friends the link.';
    } else {
      $('lobbyStatus').textContent = host
        ? (n + ' seated. Deal when you are ready.')
        : 'Waiting for the host to deal.';
    }
  }

  function visForMe(pub) {
    var vis = JSON.parse(JSON.stringify(pub || {}));
    (vis.seats || []).forEach(function (s) {
      if (s && s.id !== myId() && vis.phase !== 'showdown' && s.hand && s.hand.length) {
        s.hand = [{}, {}];
      }
    });
    return vis;
  }

  function onRoom(list) {
    _items = list || [];
    if (!mp.on) return;
    var rec = tableRec(_items);
    if (view === 'lobby') renderLobby(seated());
    hostIngest();
    if (rec && rec.t) {
      var vis = visForMe(rec.t);
      if (view !== 'play' && vis.phase && vis.phase !== 'idle') show('play');
      if (view === 'play') {
        var fake = hydrate(vis);
        renderTable(fake, myId());
        if (vis.phase === 'showdown' || vis.phase === 'idle') {
          var mine = (vis.seats || []).filter(function (s) { return s.id === myId(); })[0];
          if (mine && typeof mine.stack === 'number' && mine.stack !== chips) {
            chips = mine.stack;
            persistChips();
            showChips();
          }
        }
      }
    }
  }

  // The room's word: who sits, who is here, and whether this copy is the owner (the dealer).
  function onState(st) {
    rs = st;
    if (mp.on && !joined && st.me && st.me.role === 'watcher') { joined = true; gifos.room.join().catch(function () {}); }
    // others are in the room: open straight on the shared game
    if (st.live && !mp.on) mpEnter();
    if (gifos.info) gifos.info().then(function (inf) {
      var o = !!(inf && inf.owner);
      if (o !== owner) { owner = o; if (!o) table = null; onRoom(_items); }
    }).catch(function () {});
    chrome();
    if (mp.on) { if (view === 'lobby') renderLobby(seated()); hostIngest(); }
  }
  // with others here the room (top-bar back, OS leave) is how you go; alone you may go back
  function chrome() {
    var others = !!(rs && rs.live);
    $('lobbyLeave').hidden = others && mp.on;
    $('playLeave').hidden = others && mp.on;
  }

  function mpEnter() {
    if (!ROOM) return;
    mp.on = true;
    local = null;
    stopBots();
    show('lobby');
    renderLobby(seated());
    chrome();
    if (rs && rs.me && rs.me.role === 'watcher' && !joined) { joined = true; gifos.room.join().catch(function () {}); }
    onRoom(_items);
  }
  $('friendBtn').onclick = mpEnter;
  $('dealLobby').onclick = function () { if (owner) hostDeal(); };

  function leave() {
    stopBots();
    mp.on = false;
    local = null;
    table = null;
    show('home');
    chrome();
  }
  $('lobbyLeave').onclick = leave;
  $('playLeave').onclick = function () {
    if (local) { leave(); return; }
    show('lobby');
    renderLobby(seated());
  };

  if (window.gifos && gifos.onBack) {
    gifos.onBack(function () {
      if (view === 'play') { $('playLeave').onclick(); return true; }
      if (view === 'lobby') { leave(); return true; }
      return false;
    });
  }

  window['__vintage-poker'] = {
    // the shared table only: no hole cards, no deck
    state: function () {
      var rec = tableRec(_items), t = rec && rec.t;
      if (!t) return { phase: 'idle', handNo: 0, seats: [] };
      return {
        phase: t.phase, handNo: t.handNo, board: (t.board || []).slice(), pot: t.pot, toAct: t.toAct, dealer: t.dealer,
        seats: (t.seats || []).filter(function (x) { return x && x.id; }).map(function (x) {
          return { id: x.id, stack: x.stack, bet: x.bet, folded: !!x.folded, allIn: !!x.allIn };
        })
      };
    }
  };

  function boot() {
    var p = Promise.resolve();
    if (window.gifos && gifos.info) {
      p = gifos.info().then(function (inf) { owner = !!(inf && inf.owner); }).catch(function () {});
    }
    p.then(function () {
      if (!saveDb) { showChips(); return; }
      return saveDb.get('last').then(function (rec) {
        if (rec && rec.chips > 0) chips = rec.chips | 0;
        showChips();
      }).catch(function () { showChips(); });
    }).then(function () {
      if (!ROOM) {
        $('friendBtn').disabled = true;
        $('roomNote').hidden = false;
        $('roomNote').textContent = T('needsNewer');
        return;
      }
      if (roomDb) roomDb.subscribe(onRoom);
      gifos.room.subscribe(onState);
    });
  }
  boot();
})();
