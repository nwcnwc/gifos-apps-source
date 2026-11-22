/*
 * Invite: guests watch the host's chapter and the same tournament.
 *
 * The host (app owner) writes one row on `play` (read-only for guests).
 * Guests never write it. Commands are numbered so a late join catches the
 * latest chapter and the latest sandbox knobs, then follows start/step/reset
 * from there. Who is here is gifos.people().
 *
 * Tournament noise and the Random player use TRUST.seed so two people who
 * press Start together see the same winners.
 */
(function (root) {
  'use strict';

  var NEEDS_NEWER = 'The Evolution of Trust needs a newer GifOS to play with friends. Reload the page to update. Solo works on this device.';
  var PEOPLE_MS = 2000;
  var PEOPLE = !!(root.gifos && root.gifos.people);
  var roomPeople = [];
  var roomKey = '';
  var roomRead = false;

  var api = null;
  var me = { id: null, name: '' };
  var owner = true;
  var applying = false;
  var seq = 0;
  var lastSeen = 0;
  var playRec = null;
  var chapters = [];
  var watchers = 0;
  var onCount = null;
  var hostHooked = false;
  var peopleTimer = 0;

  function db(n) { return api.db(n); }

  function peopleNames() {
    var m = {}, i, p;
    for (i = 0; i < roomPeople.length; i++) {
      p = roomPeople[i];
      if (p && p.id && p.here !== 'gone') m[p.id] = p.name || 'Friend';
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

  function banner(n) {
    var el = document.getElementById('watch-banner');
    if (!el) return;
    if (n < 2) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = owner
      ? (n - 1) + (n === 2 ? ' friend is watching' : ' friends are watching')
      : 'Watching the same tournament';
  }

  function currentChapter() {
    var s = root.slideshow;
    if (!s || !s.currentSlide) return '';
    return s.currentSlide.id || '';
  }

  function sandboxSnapshot() {
    var pop = {};
    var list = root.Tournament && Tournament.INITIAL_AGENTS;
    if (list) {
      for (var i = 0; i < list.length; i++) pop[list[i].strategy] = list[i].count;
    }
    return {
      payoffs: root.PD ? JSON.parse(JSON.stringify(PD.PAYOFFS)) : null,
      noise: root.PD ? PD.NOISE : 0,
      selection: root.Tournament ? Tournament.SELECTION : 5,
      turns: root.Tournament ? Tournament.NUM_TURNS : 10,
      pop: pop
    };
  }

  function applySandbox(snap) {
    if (!snap) return;
    var was = applying;
    applying = true;
    try {
      if (snap.payoffs && root.PD) {
        PD.PAYOFFS = JSON.parse(JSON.stringify(snap.payoffs));
        publish('pd/editPayoffs/P', [PD.PAYOFFS.P]);
        publish('pd/editPayoffs/S', [PD.PAYOFFS.S]);
        publish('pd/editPayoffs/R', [PD.PAYOFFS.R]);
        publish('pd/editPayoffs/T', [PD.PAYOFFS.T]);
      }
      if (snap.noise != null) publish('rules/noise', [snap.noise]);
      if (snap.selection != null) publish('rules/evolution', [snap.selection]);
      if (snap.turns != null) publish('rules/turns', [snap.turns]);
      if (snap.pop) {
        for (var k in snap.pop) {
          if (Object.prototype.hasOwnProperty.call(snap.pop, k)) {
            publish('sandbox/pop/' + k, [snap.pop[k]]);
          }
        }
      }
    } catch (e) {}
    applying = was;
  }

  function publishPlay(extra) {
    if (!PEOPLE || !api || !me.id || !owner) return;
    seq++;
    var rec = {
      id: 'play',
      by: me.id,
      n: seq,
      chapter: currentChapter(),
      seed: extra && extra.seed != null ? extra.seed : 0,
      cmd: extra && extra.cmd || '',
      sandbox: sandboxSnapshot()
    };
    db('play').put(rec).catch(function () {});
  }

  function applyPlay(rec) {
    if (!rec || owner) return;
    if (rec.n && rec.n <= lastSeen) return;
    lastSeen = rec.n || lastSeen;
    applying = true;
    try {
      if (rec.seed) root.TRUST.seed(rec.seed);
      applySandbox(rec.sandbox);
      if (rec.chapter && rec.chapter !== currentChapter() && rec.chapter !== 'intro') {
        publish('slideshow/scratch', [rec.chapter]);
      }
      if (rec.cmd === 'start') publish('tournament/autoplay/start');
      else if (rec.cmd === 'stop') publish('tournament/autoplay/stop');
      else if (rec.cmd === 'step') publish('tournament/step');
      else if (rec.cmd === 'reset') publish('tournament/reset');
    } catch (e) {}
    applying = false;
  }

  function ingestPlay(list) {
    var rec = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === 'play') rec = list[i];
    }
    playRec = rec;
    if (rec) {
      if (owner && rec.n && rec.n > seq) seq = rec.n;
      applyPlay(rec);
    }
  }

  function refreshWatchers() {
    watchers = peopleCount();
    banner(watchers);
    if (onCount) onCount(watchers);
  }

  function hookHost() {
    if (hostHooked || !owner) return;
    hostHooked = true;
    function send(cmd) {
      if (applying) return;
      var seed = 0;
      if (cmd === 'start' || cmd === 'step' || cmd === 'reset') {
        seed = ((Date.now() ^ (me.id.length * 2654435761)) >>> 0) || 1;
        root.TRUST.seed(seed);
      }
      publishPlay({ cmd: cmd, seed: seed });
    }
    subscribe('tournament/autoplay/start', function () { send('start'); });
    subscribe('tournament/autoplay/stop', function () { send('stop'); });
    subscribe('tournament/step', function () { send('step'); });
    subscribe('tournament/reset', function () { send('reset'); });
    subscribe('payoffs/onchange', function () { if (!applying) publishPlay({ cmd: '' }); });
    subscribe('rules/noise', function () { if (!applying) publishPlay({ cmd: '' }); });
    subscribe('rules/evolution', function () { if (!applying) publishPlay({ cmd: '' }); });
    subscribe('rules/turns', function () { if (!applying) publishPlay({ cmd: '' }); });
    var pops = ['tft', 'all_d', 'all_c', 'grudge', 'prober', 'tf2t', 'pavlov', 'random'];
    for (var i = 0; i < pops.length; i++) {
      (function (k) {
        subscribe('sandbox/pop/' + k, function () { if (!applying) publishPlay({ cmd: '' }); });
      })(pops[i]);
    }
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
      var wasOwner = owner;
      roomPeople = ppl;
      owner = !!info.owner;
      roomRead = true;
      var mine = null, i;
      for (i = 0; i < ppl.length; i++) if (ppl[i].me) mine = ppl[i];
      if (mine) { me.id = mine.id; me.name = mine.name || ''; }
      document.body.classList.toggle('watching', !owner);
      if (!wasOwner && owner && roomRead) {
        // New owner must host after hand-off (P2).
        hookHost();
        publishPlay({ cmd: '' });
      }
      if (key !== roomKey) {
        roomKey = key;
        refreshWatchers();
      }
    }, function () {});
  }

  function init(opts) {
    chapters = (opts && opts.chapters) || [];
    api = root.gifos;
    if (!api || !api.db) return Promise.resolve({ owner: true, others: 0 });
    if (!PEOPLE) {
      return Promise.resolve({ owner: true, others: 0, needsNewer: true });
    }

    return readRoom().then(function () {
      if (!me.id) me.id = 'local';
      var settled = false;
      return new Promise(function (resolve) {
        var done = function () {
          if (settled) return;
          settled = true;
          hookHost();
          if (peopleTimer) clearInterval(peopleTimer);
          peopleTimer = setInterval(readRoom, PEOPLE_MS);
          document.body.classList.toggle('watching', !owner);
          refreshWatchers();
          resolve({ owner: owner, others: Math.max(0, watchers - 1) });
        };
        setTimeout(done, 2500);
        db('play').subscribe(function (list) { ingestPlay(list || []); done(); });
      });
    }).catch(function () {
      return { owner: true, others: 0 };
    });
  }

  root.Net = {
    init: init,
    onSlide: function (id) {
      if (!owner || applying || !id) return;
      publishPlay({ cmd: '' });
    },
    owner: function () { return owner; },
    live: function () { return !!api && !!me.id && PEOPLE; },
    count: function () { return watchers; }
  };

  root['__evolution-of-trust'] = {
    state: function () {
      // Shared play row only — local chapter can race ahead of the put (K8).
      if (!playRec) return null;
      return { n: playRec.n | 0, chapter: playRec.chapter || '' };
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

  if (!PEOPLE) {
    var _n = document.createElement('p');
    _n.id = 'eot-needs';
    _n.textContent = NEEDS_NEWER;
    if (document.body) document.body.appendChild(_n);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(_n); });
  }
})(window);
