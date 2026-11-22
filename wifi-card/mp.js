/* Optional meeting: the same card, on everyone else's screen.
 * Each person writes THEIR own row. Nobody writes anybody else's row.
 * The app owner hosts the live card (else lowest id). Who is here is
 * gifos.people(). Invite is OS chrome. */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'WiFi Card needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);

  var api = null;
  var room = null;
  var me = { id: null, name: 'You' };
  var on = false;
  var subscribed = false;
  var lastList = [];
  var guest = false;
  var lastPub = 0;
  var roomPeople = [];
  var roomKey = '';
  var owner = false;
  var roomRead = false;

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
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
    }
    return m;
  }

  function live(list) {
    var names = peopleNames(), out = [];
    (list || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!Object.prototype.hasOwnProperty.call(names, p.id)) return;
      out.push(Object.assign({}, p, { name: names[p.id] || p.name || 'Friend' }));
    });
    return out;
  }

  function hostOf(players) {
    if (!players.length) return null;
    var i, a = null;
    if (owner && me.id) {
      for (i = 0; i < players.length; i++) if (players[i].id === me.id) { a = players[i]; break; }
    }
    if (a) return a;
    a = players[0];
    for (i = 1; i < players.length; i++) {
      if (players[i].id < a.id) a = players[i];
    }
    return a;
  }

  function snapshot() {
    var card = Mp.getCard ? Mp.getCard() : {};
    return {
      id: me.id,
      ssid: card.ssid || '',
      password: card.password || '',
      encryptionMode: card.encryptionMode || 'WPA',
      eapMethod: card.eapMethod || 'PWD',
      eapIdentity: card.eapIdentity || '',
      hidePassword: !!card.hidePassword,
      hiddenSSID: !!card.hiddenSSID,
      portrait: !!card.portrait,
      hideTip: !!card.hideTip
    };
  }

  function publish() {
    if (!on || !room || !me.id || !PEOPLE) return;
    var t = now();
    if (t - lastPub < 80) return;
    lastPub = t;
    room.put(snapshot()).catch(function () {});
  }

  function statusOf(players) {
    var others = players.filter(function (p) { return p.id !== me.id; });
    if (!others.length) {
      return 'Press Invite (top bar) to show this card in a meeting. Nothing is uploaded on its own.';
    }
    if (guest) {
      var h = hostOf(players);
      var who = h && h.id !== me.id ? (h.name || 'a friend') : 'a friend';
      return 'Showing the same card from ' + who + '. Point a phone at it.';
    }
    if (others.length === 1) {
      return 'Showing this card in the meeting — ' + (others[0].name || 'a friend') + ' can see it.';
    }
    return 'Showing this card in the meeting — ' + others.length + ' people can see it.';
  }

  function applyHost(players) {
    var h = hostOf(players);
    var wasGuest = guest;
    guest = !!(h && me.id && h.id !== me.id);
    if (guest && h) {
      if (Mp.onRemote) Mp.onRemote(h);
    } else if (wasGuest && !guest) {
      if (Mp.onHost) Mp.onHost();
    }
    document.body.classList.toggle('guest', guest);
    if (Mp.onStatus) Mp.onStatus(statusOf(players), guest, othersCount(players));
  }

  function othersCount(players) {
    return players.filter(function (p) { return p.id !== me.id; }).length;
  }

  function onRoom(list) {
    lastList = list || [];
    if (!on) return;
    applyHost(live(lastList));
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
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || 'You'; }
      if (key !== roomKey) {
        roomKey = key;
        if (on) applyHost(live(lastList));
      }
    }, function () {});
  }

  function watch() {
    api = root.gifos;
    if (!api || !api.db) {
      if (Mp.onStatus) {
        Mp.onStatus('Press Invite (top bar) to show this card in a meeting. Nothing is uploaded on its own.', false, 0);
      }
      return;
    }
    if (!PEOPLE) {
      if (Mp.onStatus) Mp.onStatus(NEEDS_NEWER, false, 0);
      return;
    }
    room = room || api.db('room');
    readRoom().then(function () {
      on = true;
      if (!subscribed) {
        subscribed = true;
        room.subscribe(onRoom);
      }
      publish();
      applyHost(live(lastList));
      setInterval(readRoom, PEOPLE_MS);
    }).catch(function () {});
  }

  var Mp = {
    watch: watch,
    publish: publish,
    get guest() { return guest; },
    esc: esc,
    getCard: null,
    onRemote: null,
    onHost: null,
    onStatus: null
  };

  root.WifiMp = Mp;

  root['__wifi-card'] = {
    state: function () {
      var h = hostOf(live(lastList));
      if (!h) return null;
      return { ssid: h.ssid || '' };
    },
    people: function () {
      return live(lastList).map(function (p) { return p.id; });
    },
    amHost: function () {
      var n = 0, i, p;
      for (i = 0; i < roomPeople.length; i++) {
        p = roomPeople[i];
        if (p && p.id && p.here !== 'gone') n++;
      }
      return on && owner && n > 1;
    }
  };

  if (!PEOPLE && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    var _n = document.createElement('p');
    _n.id = 'wifi-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
