/*
 * Shared fire. Host simulates; guests see the same State and send clicks.
 * Nobody writes anybody else's presence row.
 */
(function (root) {
  'use strict';
  var NEEDS_NEWER = "A Dark Room needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.";
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

  var api = null;
  var me = { id: 'local', name: '' };
  var isOwner = true;
  var live = false;
  var seq = 0;
  var applying = false;
  var lastApplied = {};
  var lastPublish = 0;
  var roster = [];
  var onRoster = null;

  function db(n) {
    try { return api && api.db ? api.db(n) : null; } catch (e) { return null; }
  }

  function now() { return Date.now(); }

  function countOthers() {
    var n = 0, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id !== me.id && p.here !== 'gone') n++;
    }
    return n;
  }

  function paintBadge() {
    var el = document.getElementById('adr-room');
    if (!el) return;
    var n = countOthers();
    if (!live || n < 1) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = n === 1 ? 'two at the fire' : (n + 1) + ' at the fire';
  }

  function snapshot() {
    try { return JSON.stringify(root.State || {}); } catch (e) { return '{}'; }
  }

  function refreshView() {
    try {
      if (root.Room && Room.updateStoresView) Room.updateStoresView();
      if (root.Room && Room.updateButton) Room.updateButton();
      if (root.Room && Room.updateBuildButtons) Room.updateBuildButtons();
      if (root.Room && Room.updateIncomeView) Room.updateIncomeView();
      if (root.Outside && Outside.updateVillage) Outside.updateVillage();
      if (root.Path && Path.updateOutfitting) Path.updateOutfitting();
    } catch (e) {}
    if (root.Outside && $SM && $SM.get('stores.wood') !== undefined && !Outside.tab) {
      try { Outside.init(); } catch (e) {}
    }
    if (root.Path && $SM && $SM.get('stores.compass', true) > 0 && !Path.tab) {
      try { Path.init(); } catch (e) {}
    }
    if (root.Fabricator && $SM && $SM.get('features.location.fabricator') && !Fabricator.tab) {
      try { Fabricator.init(); } catch (e) {}
    }
    if (root.Ship && $SM && $SM.get('features.location.spaceShip') && !Ship.tab) {
      try { Ship.init(); } catch (e) {}
    }
  }

  function hydrate(payload) {
    var next;
    try { next = JSON.parse(payload); } catch (e) { return; }
    if (!next || typeof next !== 'object') return;
    applying = true;
    root.State = next;
    try { localStorage.gameState = payload; } catch (e) {}
    refreshView();
    applying = false;
  }

  function publishState(force) {
    // No shared fire without gifos.people — solo save stays on the private collection.
    if (!PEOPLE || !isOwner || applying) return;
    var fire = db('fire');
    if (!fire) return;
    var t = now();
    if (!force && t - lastPublish < 800) return;
    lastPublish = t;
    seq++;
    fire.put({
      id: 'state',
      payload: snapshot(),
      seq: seq,
      by: me.id,
      at: t
    }).catch(function () {});
  }

  function sendClick(id) {
    if (!id) return;
    var actions = db('actions');
    if (!actions) return;
    actions.put({
      id: 'a_' + me.id,
      btn: id,
      seq: (lastApplied.self | 0) + 1,
      by: me.id,
      at: now()
    }).then(function () {
      lastApplied.self = (lastApplied.self | 0) + 1;
    }).catch(function () {});
  }

  function applyClick(id) {
    if (!id) return;
    var el = document.getElementById(id);
    if (!el || el.classList.contains('disabled')) return;
    try { $(el).click(); } catch (e) {}
  }

  function syncRoster() {
    roster = roomPeople;
    paintBadge();
    live = countOthers() > 0 || !isOwner;
    if (onRoster) onRoster(roster);
  }

  function ingestFire(list) {
    var i, row;
    if (isOwner) return;
    for (i = 0; i < (list || []).length; i++) {
      row = list[i];
      if (row && row.id === 'state' && row.payload && (row.seq | 0) > seq) {
        seq = row.seq | 0;
        hydrate(row.payload);
      }
    }
  }

  function ingestActions(list) {
    var i, row, key;
    if (!isOwner) return;
    for (i = 0; i < (list || []).length; i++) {
      row = list[i];
      if (!row || !row.btn || row.by === me.id) continue;
      key = row.id + ':' + (row.seq | 0);
      if (lastApplied[key]) continue;
      lastApplied[key] = true;
      applyClick(row.btn);
    }
  }

  function interceptClicks() {
    document.addEventListener('click', function (e) {
      if (isOwner) return;
      var t = e.target;
      while (t && t !== document.body) {
        if (t.classList && t.classList.contains('button') && t.id) {
          e.stopImmediatePropagation();
          e.preventDefault();
          sendClick(t.id);
          return;
        }
        t = t.parentNode;
      }
    }, true);
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
      roomKey = key;
      roomPeople = ppl;
      var handed = !owner && !!info.owner && roomRead;
      owner = !!info.owner;
      isOwner = owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || ''; }
      syncRoster();
      // Handed the app while others are here: this copy hosts the fire now.
      if (handed && roomPeople.length > 1) { live = true; }
    }, function () {});
  }

  root.Net = {
    init: function () {
      api = root.gifos;
      if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
      if (!PEOPLE) {
        return Promise.resolve({ owner: true, others: 0 });
      }
      interceptClicks();
      var settled = false;
      return readRoom().then(function () {
        return new Promise(function (resolve) {
          var done = function () {
            if (settled) return;
            settled = true;
            live = countOthers() > 0 || !isOwner;
            paintBadge();
            resolve({ owner: isOwner, others: countOthers() });
          };
          setTimeout(done, 2200);
          setInterval(readRoom, PEOPLE_MS);
          done();
          var fire = db('fire');
          if (fire && fire.subscribe) fire.subscribe(ingestFire);
          var actions = db('actions');
          if (actions && actions.subscribe) actions.subscribe(ingestActions);
        });
      });
    },
    live: function () { return (!isOwner) || countOthers() > 0; },
    owner: function () { return isOwner; },
    applying: function () { return applying; },
    publish: function (force) { publishState(force); },
    me: function () { return me; },
    onRoster: function (cb) { onRoster = cb; if (cb) cb(roster); }
  };
  root['__a-dark-room'] = {
    state: function () { return { seq: seq }; },
    people: function () {
      return roomPeople.filter(function (p) { return p && p.id && p.here !== 'gone'; }).map(function (p) { return p.id; });
    },
    amHost: function () { return isOwner && live; }
  };
  if (!PEOPLE) {
    var _need = document.getElementById("adr-room");
    if (_need) { _need.hidden = false; _need.textContent = NEEDS_NEWER; }
  }
})(window);
