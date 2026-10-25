/* Speak sentences through a Text → speech function.
 * While one sentence plays, the next few are synthesized into a small buffer
 * so the following one can start the moment this one ends.
 * Requests go out one at a time and do not wait for playback.
 * The first bite of a reading is kept short so the voice starts sooner.
 * Stop, pause, and a move to another sentence drop anything still in flight.
 * If the voice is missing or the call fails, the result is a message.
 * There is no second speaker and no silent success. */
(function (root) {
  'use strict';

  var INSTALL = 'Install Offline TTS from the store, then assign it to Text → speech in Settings.';
  var LOOKAHEAD = 4;
  var LEAD_MIN = 8;
  var LEAD_MAX = 12;
  var LEAD_TARGET = 10;

  function installMessage(err) {
    var detail = '';
    if (err && err.message) detail = String(err.message);
    else if (err) detail = String(err);
    detail = detail.replace(/\s+/g, ' ').trim();
    if (detail.length > 300) detail = detail.slice(0, 300);
    if (/^PLAYBACK:/.test(detail)) {
      var rest = detail.replace(/^PLAYBACK:\s*/, '').trim();
      return rest || 'The audio did not play.';
    }
    if (!detail || /NOT_CONFIGURED/i.test(detail) || detail === 'missing') return INSTALL;
    return INSTALL + ' ' + detail;
  }

  function sentenceText(sentences, i) {
    var s = sentences[i];
    if (s && s.text != null) return String(s.text);
    return s == null ? '' : String(s);
  }

  function sentencePage(sentences, i) {
    var s = sentences[i];
    if (s && s.page != null) return s.page;
    return 1;
  }

  function splitLead(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    var words = t ? t.split(' ') : [];
    if (words.length <= LEAD_MAX) return [t];
    var best = 0;
    var bestDist = 1000;
    var i;
    for (i = LEAD_MIN; i <= LEAD_MAX && i < words.length; i++) {
      if (/,/.test(words[i - 1])) {
        var dist = Math.abs(i - LEAD_TARGET);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
    }
    var cut = best || LEAD_TARGET;
    if (cut < 1 || cut >= words.length) return [t];
    return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
  }

  function createReader(opts) {
    opts = opts || {};
    var sentences = opts.sentences || [];
    var index = opts.index || 0;
    var speed = opts.speed == null ? 1 : opts.speed;
    var voice = opts.voice || '';
    var tts = opts.tts || null;
    var play = opts.play || null;
    var prepare = typeof opts.prepare === 'function' ? opts.prepare : null;
    var ahead = opts.lookahead == null ? LOOKAHEAD : (opts.lookahead | 0);
    if (!(ahead >= 1)) ahead = LOOKAHEAD;
    var onIndex = typeof opts.onIndex === 'function' ? opts.onIndex : function () {};
    var gen = 0;
    var token = 0;
    var current = null;
    var playing = false;
    var paused = false;
    var alive = false;
    var runPromise = null;
    var active = null;
    var queued = [];
    var slots = 0;
    var fetching = false;
    var nextToFetch = 0;
    var chunks = [];
    var clip = null;
    var fault = null;
    var started = false;

    function result(extra) {
      var out = {
        spoke: false,
        fallback: false,
        code: 'ok',
        message: '',
        index: index,
        stopped: false,
        error: false
      };
      var k;
      for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      out.fallback = false;
      return out;
    }

    function stopHandle() {
      var h = current;
      current = null;
      if (h && h.stop) {
        try { h.stop(); } catch (e) { void e; }
      }
    }

    function dropQueued() {
      var i;
      var list = queued;
      queued = [];
      for (i = 0; i < list.length; i++) {
        try {
          if (list[i].prep && list[i].prep.drop) list[i].prep.drop();
        } catch (e) { void e; }
      }
    }

    function clampIndex(n) {
      if (!sentences.length) return 0;
      if (!(n >= 0)) return 0;
      if (n >= sentences.length) return sentences.length - 1;
      return n;
    }

    function buildChunks(start) {
      var out = [];
      var i;
      var p;
      for (i = start; i < sentences.length; i++) {
        var text = sentenceText(sentences, i);
        if (out.length === 0) {
          var parts = splitLead(text);
          for (p = 0; p < parts.length; p++) {
            out.push({ text: parts[p], index: i, ord: out.length });
          }
        } else {
          out.push({ text: text, index: i, ord: out.length });
        }
      }
      return out;
    }

    function fetchChunk(chunk) {
      var req = { text: chunk.text, voice: voice, speed: speed };
      if (typeof tts !== 'function') {
        return Promise.reject(new Error('NOT_CONFIGURED:ai:tts'));
      }
      var pendingCall;
      try { pendingCall = tts(req); }
      catch (e) { return Promise.reject(e); }
      return Promise.resolve(pendingCall).then(function (r) {
        if (!r || r.bytes == null) {
          var why = r && r.message ? r.message : 'The voice returned nothing.';
          throw new Error(why);
        }
        return { bytes: r.bytes, mime: r.mime || 'audio/mpeg', text: req.text, index: chunk.index };
      });
    }

    function arm(audio) {
      if (typeof prepare !== 'function') {
        return {
          play: function () { return typeof play === 'function' ? play(audio) : null; },
          drop: function () {}
        };
      }
      var prep;
      try { prep = prepare(audio); }
      catch (e) { return Promise.reject(e); }
      function finishArm(p) {
        if (!p || typeof p.play !== 'function') {
          return Promise.reject(new Error('PLAYBACK: The audio did not play.'));
        }
        if (p.ready && typeof p.ready.then === 'function') {
          return p.ready.then(function () { return p; });
        }
        return p;
      }
      if (prep && typeof prep.then === 'function') return prep.then(finishArm);
      return finishArm(prep);
    }

    function settleActive(my, res) {
      if (!active || active.my !== my) return;
      var done = active;
      active = null;
      alive = false;
      done.settle(res);
    }

    function failWith(my, err, code) {
      if (my !== gen) return;
      playing = false;
      paused = false;
      stopHandle();
      clip = null;
      token++;
      dropQueued();
      fetching = false;
      slots = 0;
      settleActive(my, result({
        code: code || 'no-voice',
        error: true,
        message: installMessage(err),
        index: index
      }));
    }

    function kick(my) {
      if (my !== gen || paused) return;
      if (clip) return;
      if (!queued.length) {
        if (fault && !fetching) {
          var err = fault;
          fault = null;
          failWith(my, err, 'no-voice');
          return;
        }
        if (!fetching && started && nextToFetch >= chunks.length) {
          playing = false;
          paused = false;
          settleActive(my, result({ spoke: true, code: 'ok', index: index }));
        }
        return;
      }
      var item = queued.shift();
      if (slots > 0) slots--;
      clip = item;
      index = item.chunk.index;
      try { onIndex(index, sentences[index]); }
      catch (e2) { void e2; }
      var handle;
      try { handle = item.prep.play(); }
      catch (e) {
        clip = null;
        failWith(my, e, 'playback');
        return;
      }
      if (!handle || !handle.done || typeof handle.done.then !== 'function') {
        clip = null;
        failWith(my, new Error('PLAYBACK: The audio did not play.'), 'playback');
        return;
      }
      current = handle;
      started = true;
      pump(my);
      handle.done.then(function () {
        if (my !== gen) return;
        if (clip !== item) return;
        if (current === handle) current = null;
        clip = null;
        kick(my);
      }, function (err) {
        if (my !== gen) return;
        if (current === handle) current = null;
        if (clip === item) clip = null;
        var playback = /^PLAYBACK:/.test(String(err && err.message || err));
        failWith(my, err, playback ? 'playback' : 'no-voice');
      });
    }

    function acceptPrep(my, ticket, prep) {
      if (ticket !== token || my !== gen) {
        try { if (prep && prep.drop) prep.drop(); } catch (e) { void e; }
        return;
      }
      fetching = false;
      queued.push({ prep: prep, chunk: prep.chunk });
      kick(my);
      pump(my);
    }

    function pump(my) {
      if (my !== gen || paused || fetching || fault) return;
      if (slots >= ahead) return;
      if (nextToFetch >= chunks.length) return;
      fetching = true;
      slots++;
      var ticket = token;
      var chunk = chunks[nextToFetch++];
      fetchChunk(chunk).then(function (audio) {
        if (ticket !== token || my !== gen) return;
        var armed = arm(audio);
        if (armed && typeof armed.then === 'function') {
          armed.then(function (prep) {
            prep.chunk = chunk;
            acceptPrep(my, ticket, prep);
          }, function (err) {
            if (ticket !== token || my !== gen) return;
            fetching = false;
            if (slots > 0) slots--;
            fault = err;
            kick(my);
          });
          return;
        }
        armed.chunk = chunk;
        acceptPrep(my, ticket, armed);
      }, function (err) {
        if (ticket !== token || my !== gen) return;
        fetching = false;
        if (slots > 0) slots--;
        fault = err;
        kick(my);
      });
    }

    function runFrom(start) {
      if (active) active.settle(result({ code: 'stopped', stopped: true, index: index }));
      active = null;
      alive = false;
      gen++;
      token++;
      dropQueued();
      stopHandle();
      clip = null;
      fetching = false;
      slots = 0;
      fault = null;
      started = false;
      paused = false;
      var my = gen;
      if (!sentences.length) {
        playing = false;
        return Promise.resolve(result({
          code: 'no-text',
          message: 'This PDF has no text to read.'
        }));
      }
      index = clampIndex(start);
      chunks = buildChunks(index);
      nextToFetch = 0;
      playing = true;
      var resolveRun;
      var settled = false;
      runPromise = new Promise(function (resolve) { resolveRun = resolve; });
      function settle(res) {
        if (settled) return;
        settled = true;
        if (active && active.my === my) {
          active = null;
          alive = false;
        }
        resolveRun(res);
      }
      active = { my: my, settle: settle };
      alive = true;
      pump(my);
      return runPromise;
    }

    function cancelSession(code, stopped) {
      if (active) active.settle(result({ code: code, stopped: !!stopped, index: index }));
      active = null;
      alive = false;
      gen++;
      token++;
      dropQueued();
      stopHandle();
      clip = null;
      fetching = false;
      slots = 0;
      fault = null;
      playing = false;
      paused = false;
    }

    function moveTo(n, keepPlaying) {
      if (!sentences.length) {
        return Promise.resolve(result({ code: 'no-text', message: 'This PDF has no text to read.' }));
      }
      n = clampIndex(n);
      if (keepPlaying && playing && !paused) return runFrom(n);
      var was = playing || paused;
      cancelSession(was ? 'stopped' : 'ok', was);
      index = n;
      try { onIndex(index, sentences[index]); }
      catch (e) { void e; }
      return Promise.resolve(result({ code: was ? 'stopped' : 'ok', stopped: was, index: index }));
    }

    function refillFromHere() {
      token++;
      dropQueued();
      fetching = false;
      slots = 0;
      fault = null;
      if (clip) nextToFetch = clip.chunk.ord + 1;
      else nextToFetch = 0;
    }

    return {
      play: function () {
        if (paused && alive) {
          paused = false;
          playing = true;
          if (current && current.resume) current.resume();
          if (active) {
            pump(active.my);
            kick(active.my);
          }
          return runPromise || Promise.resolve(result({ code: 'ok', resumed: true }));
        }
        return runFrom(index);
      },
      pause: function () {
        if (!playing || paused) return;
        paused = true;
        refillFromHere();
        if (current && current.pause) current.pause();
      },
      stop: function () {
        cancelSession('stopped', true);
      },
      next: function () { return moveTo(index + 1, true); },
      prev: function () { return moveTo(index - 1, true); },
      go: function (i) { return moveTo(i, true); },
      goPage: function (page) {
        var want = page | 0;
        var n = sentences.length ? sentences.length - 1 : 0;
        var k;
        for (k = 0; k < sentences.length; k++) {
          if (sentencePage(sentences, k) >= want) { n = k; break; }
        }
        return moveTo(n, true);
      },
      setSpeed: function (s) {
        var n = Number(s);
        if (!(n >= 0.25 && n <= 4) || n === speed) return;
        speed = n;
        if (playing && !paused && alive && active) refillFromHere();
        if (playing && !paused && active) pump(active.my);
      },
      setVoice: function (v) {
        var next = v || '';
        if (next === voice) return;
        voice = next;
        if (playing && !paused && alive && active) {
          refillFromHere();
          pump(active.my);
        }
      },
      setIndex: function (i) {
        index = clampIndex(i);
      },
      index: function () { return index; },
      speed: function () { return speed; },
      playing: function () { return playing && !paused; },
      paused: function () { return paused; }
    };
  }

  root.PdfSpeak = {
    INSTALL: INSTALL,
    LOOKAHEAD: LOOKAHEAD,
    installMessage: installMessage,
    splitLead: splitLead,
    createReader: createReader
  };
})(typeof window !== 'undefined' ? window : this);
