// Share a pattern over Invite.
//
// Who is here is gifos.people(); the app owner hosts the kit row. Each player
// writes ops on THEIR own row. Nobody writes anybody else's row. Patterns in
// gifos.db('patterns') stay private — this file never touches them except to
// freeze a copy on enter and restore it on leave.
// Invite is OS chrome. This file never draws an Invite button.
(function (root) {
  'use strict';

  var IO = root.IO808;
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var NEEDS_NEWER = 'IO-808 needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PUB_MS = 180;

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var peopleTimer = 0;
  var pubTimer = 0;
  var lastList = [];
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;
  var myN = 0;
  var pending = [];
  var lastKit = null;
  var lastPacked = '';

  var $ = function (id) { return document.getElementById(id); };
  var now = function () { return Date.now(); };
  var esc = function (s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  };

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

  function legalNum(n, lo, hi) {
    return typeof n === 'number' && n === n && n >= lo && n <= hi;
  }
  function legalInst(inst) {
    if (!inst || typeof inst !== 'object') return false;
    var id;
    for (id = 0; id < 12; id++) {
      var s = inst[id] || inst[String(id)];
      if (!s || typeof s !== 'object') return false;
      if (!legalNum(s.level, 0, 100)) return false;
    }
    return true;
  }
  function legalPacked(p) {
    return p && typeof p.bits === 'string' && p.bits.length === 192 && /^[0-9a-f]+$/.test(p.bits) &&
      legalNum(p.pattern, 0, 15) && legalNum(p.first, 0, 16) && legalNum(p.second, 0, 16);
  }
  function legalKit(row) {
    return row && legalPacked(row.packed) && legalInst(row.instrumentState) &&
      legalNum(row.tempo, 30, 300) && legalNum(row.masterVolume, 0, 100);
  }

  function packStr(row) {
    try {
      return (row.packed && row.packed.bits || '') + '|' + row.tempo + '|' + row.fineTempo + '|' +
        row.masterVolume + '|' + row.selectedPattern + '|' + row.basicVariationPosition + '|' +
        row.currentPart + '|' + row.currentVariation + '|' + row.selectedInstrumentTrack;
    } catch (e) { return ''; }
  }

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id || p.id === 'kit') return;
      if (!names[p.id]) return;
      out.push(p);
    });
    return out;
  }
  function isHost() { return PEOPLE && owner; }
  function kitOf(list) {
    var i;
    for (i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === 'kit') return list[i];
    return null;
  }

  function localKit() {
    var s = IO.Machine.shareKit();
    s.id = 'kit';
    s.host = me.id;
    s.seq = (lastKit && lastKit.seq) || 0;
    s.applied = (lastKit && lastKit.applied) || {};
    return s;
  }

  function snapshot(extra) {
    var row = {
      id: me.id,
      n: myN,
      pending: pending.slice()
    };
    if (extra) {
      if (extra.pending) row.pending = extra.pending;
      if (extra.kit) row.kit = extra.kit;
    }
    return row;
  }

  function publish() {
    if (!PEOPLE || !on || !room || !me.id) return;
    if (!myN && !pending.length) return;
    room.put(snapshot()).catch(function () {});
  }
  function schedulePublish() {
    if (pubTimer) return;
    pubTimer = setTimeout(function () {
      pubTimer = 0;
      publish();
    }, PUB_MS);
  }

  function putKit(c) {
    if (!PEOPLE || !owner) return;
    lastKit = c;
    room.put(c).catch(function () {});
  }

  function applyShared(row) {
    if (!legalKit(row) || !IO.Machine) return;
    var packed = packStr(row);
    if (packed === lastPacked) return;
    lastPacked = packed;
    IO.Machine.applyKit({
      instrumentState: row.instrumentState,
      masterVolume: row.masterVolume,
      tempo: row.tempo,
      fineTempo: row.fineTempo,
      selectedPattern: row.selectedPattern,
      selectedInstrumentTrack: row.selectedInstrumentTrack,
      basicVariationPosition: row.basicVariationPosition,
      currentPart: row.currentPart,
      currentVariation: row.currentVariation
    }, { silent: true });
    if (IO.Machine.unpackPattern) IO.Machine.unpackPattern(row.packed);
    IO.Machine.render();
  }

  function dropSpent(kit) {
    if (!kit || !kit.applied) return;
    var keep = kit.applied[me.id] || 0;
    pending = pending.filter(function (op) { return op.n > keep; });
  }

  function reconcile(kit, people) {
    var next = {
      id: 'kit',
      host: me.id,
      seq: (kit.seq || 0),
      applied: {},
      instrumentState: kit.instrumentState,
      packed: kit.packed,
      masterVolume: kit.masterVolume,
      tempo: kit.tempo,
      fineTempo: kit.fineTempo,
      selectedPattern: kit.selectedPattern,
      selectedInstrumentTrack: kit.selectedInstrumentTrack,
      basicVariationPosition: kit.basicVariationPosition,
      currentPart: kit.currentPart,
      currentVariation: kit.currentVariation
    };
    Object.keys(kit.applied || {}).forEach(function (k) { next.applied[k] = kit.applied[k]; });
    var dirty = false;
    people.forEach(function (p) {
      var last = next.applied[p.id] || 0;
      var ops = (p.pending || []).slice().sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
      ops.forEach(function (op) {
        if (!op || (op.n || 0) <= last) return;
        last = op.n;
        if (op.t === 'kit' && legalKit(op.kit)) {
          next.instrumentState = op.kit.instrumentState;
          next.packed = op.kit.packed;
          next.masterVolume = op.kit.masterVolume;
          next.tempo = op.kit.tempo;
          next.fineTempo = op.kit.fineTempo;
          next.selectedPattern = op.kit.selectedPattern;
          next.selectedInstrumentTrack = op.kit.selectedInstrumentTrack;
          next.basicVariationPosition = op.kit.basicVariationPosition;
          next.currentPart = op.kit.currentPart;
          next.currentVariation = op.kit.currentVariation;
          dirty = true;
        }
      });
      next.applied[p.id] = last;
    });
    if (dirty) next.seq = (kit.seq || 0) + 1;
    var same = packStr(next) === packStr(kit) && JSON.stringify(next.applied) === JSON.stringify(kit.applied);
    return same ? null : next;
  }

  function pushOp(op) {
    myN += 1;
    op.n = myN;
    pending.push(op);
    if (pending.length > 64) pending = pending.slice(-48);
    schedulePublish();
  }

  function render() {
    if (!on) return;
    var people = live(lastList);
    var names = peopleNames();
    var status = $('friend-status');
    var roster = $('friend-roster');
    var html = '';
    people.sort(function (a, b) {
      var an = names[a.id] || '', bn = names[b.id] || '';
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    people.forEach(function (p) {
      var mine = p.id === me.id;
      html += '<li class="' + (mine ? 'me' : '') + '"><span class="name">' +
        (mine ? 'You' : esc(names[p.id] || 'Player')) + '</span></li>';
    });
    roster.innerHTML = html || '<li>Just you so far</li>';
    var others = people.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      status.textContent = 'Waiting for a friend… press Invite (GifOS menu) to send the link. They get this pattern.';
    } else {
      status.textContent = 'Same pattern. ' + others.length + ' with you.';
    }
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    var people = live(lastList);
    var kit = kitOf(lastList);
    if (!kit) {
      // Host only seeds the kit after someone has acted (pending ops) — quiet for K3.
      if (isHost() && pending.length) putKit(localKit());
      render();
      return;
    }
    lastKit = kit;
    if (isHost()) {
      var next = reconcile(kit, people);
      if (next) {
        putKit(next);
        kit = next;
      }
    }
    dropSpent(kit);
    applyShared(kit);
    render();
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
      if (handed && !on) enter(true);
      else if (key !== roomKey) {
        roomKey = key;
        if (on) onRoom(lastList);
        else if (peopleCount() > 1) enter(false);
      }
    }, function () {});
  }

  function enter(fromHand) {
    api = root.gifos;
    if (!api || !api.db) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = 'Sharing a pattern needs a GifOS room.';
      return;
    }
    if (!PEOPLE) {
      $('friend-bar').hidden = false;
      $('friend-status').textContent = NEEDS_NEWER;
      return;
    }
    room = api.db('room');
    readRoom().then(function () {
      on = true;
      pending = [];
      myN = 0;
      lastPacked = '';
      lastKit = null;
      if (IO.Machine.flushSave) IO.Machine.flushSave();
      IO.Machine.setSharing(true);
      document.body.classList.add('together');
      $('friend-bar').hidden = false;
      $('shareBtn').hidden = true;
      $('friend-hint').textContent = 'Press Invite (GifOS menu) to send the link. They get this pattern.';
      // Do not pushOp/publish on enter — write only when the pattern changes (K3).
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      } else {
        onRoom(lastList);
      }
      if (peopleTimer) clearInterval(peopleTimer);
      peopleTimer = setInterval(readRoom, PEOPLE_MS);
      render();
    }).catch(function () {});
  }

  function leave() {
    on = false;
    pending = [];
    IO.Machine.setSharing(false);
    document.body.classList.remove('together');
    $('friend-bar').hidden = true;
    $('shareBtn').hidden = false;
    if (peopleTimer) { clearInterval(peopleTimer); peopleTimer = 0; }
    if (pubTimer) { clearTimeout(pubTimer); pubTimer = 0; }
    if (room && me.id) room.delete(me.id).catch(function () {});
    if (IO.Machine.restoreSave) IO.Machine.restoreSave();
  }

  function onKit() {
    if (!on) return;
    pushOp({ t: 'kit', kit: IO.Machine.shareKit() });
  }

  IO.Mp = {
    enter: enter,
    leave: leave,
    isOn: function () { return on; },
    isHost: isHost,
    onStep: function () { onKit(); },
    onKnob: function () { onKit(); },
    onTempo: function () { onKit(); },
    onKit: onKit
  };

  root['__io-808'] = {
    state: function () {
      var k = lastKit || kitOf(lastList);
      return k ? { seq: k.seq | 0 } : null;
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      return PEOPLE && owner && peopleCount() > 1 && on;
    }
  };

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'io808-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  } else {
    // Boot room watch so auto-enter / hand-off work without a button tap.
    api = root.gifos;
    if (api && api.db) {
      room = api.db('room');
      readRoom().then(function () {
        if (peopleTimer) clearInterval(peopleTimer);
        peopleTimer = setInterval(readRoom, PEOPLE_MS);
      });
    }
  }

  if ($('shareBtn')) {
    if (!PEOPLE) { $('shareBtn').disabled = true; $('shareBtn').title = NEEDS_NEWER; }
    $('shareBtn').addEventListener('click', function (e) { e.preventDefault(); enter(true); });
  }
  $('leaveBtn').addEventListener('click', function (e) { e.preventDefault(); leave(); });
})(window);
