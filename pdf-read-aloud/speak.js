/* Speak sentences through a Text → speech function.
 * Synthesis does not wait for playback. From the moment a source is ready,
 * clips are requested one at a time, as soon as the previous call returns,
 * for every remaining sentence and then any gap behind the playhead.
 * A clip that is already requested or still decoding is not requested again.
 * When the voice returns a clip that can be scheduled, it is armed at once
 * so the next sentence is already on the audio clock before this one ends.
 * Play, pause, resume, and seek wait for an in-flight request. It is sent
 * again only if the request failed, or the source was replaced.
 * A memory guard pauses that work. Pause and Stop leave the buffer alone.
 * Only "Stop preparing" halts synthesis. A new source discards the buffer.
 * The first bite of a reading is kept short so the voice starts sooner.
 * If the voice is missing or the call fails, the result is a message.
 * There is no second speaker and no silent success. */
(function (root) {
  'use strict';

  var INSTALL = 'Install Offline TTS from the store, then assign it to Text → speech in Settings.';
  var MAX_SENTENCES = 400;
  var MAX_BYTES = 200 * 1024 * 1024;

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

  function bufferLabel(info) {
    info = info || {};
    var prepared = info.prepared | 0;
    var total = info.total | 0;
    var ahead = info.ahead | 0;
    return 'Prepared ' + prepared + ' / ' + total + ' · ' + ahead + ' ready ahead';
  }

  var LEAD_MIN = 8;
  var LEAD_MAX = 12;
  var LEAD_TARGET = 10;

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
    var sentences = (opts.sentences || []).slice();
    var index = opts.index || 0;
    var speed = opts.speed == null ? 1 : opts.speed;
    var voice = opts.voice || '';
    var tts = opts.tts || null;
    var play = opts.play || null;
    var prepare = typeof opts.prepare === 'function' ? opts.prepare : null;
    var maxSentences = opts.maxSentences == null ? MAX_SENTENCES : (opts.maxSentences | 0);
    var maxBytes = opts.maxBytes == null ? MAX_BYTES : (opts.maxBytes | 0);
    if (!(maxSentences >= 1)) maxSentences = MAX_SENTENCES;
    if (!(maxBytes >= 1)) maxBytes = MAX_BYTES;
    var onIndex = typeof opts.onIndex === 'function' ? opts.onIndex : function () {};
    var onBuffer = typeof opts.onBuffer === 'function' ? opts.onBuffer : function () {};
    var preparing = opts.preparing !== false;
    var sourceId = opts.sourceId == null || opts.sourceId === '' ? '1' : String(opts.sourceId);
    var sourceGen = 0;
    var token = 0;
    var dead = false;
    var current = null;
    var currentItem = null;
    var playing = false;
    var paused = false;
    var playEpoch = 0;
    var runPromise = null;
    var runResolve = null;
    var settled = true;
    var fetching = false;
    var fault = null;
    var flight = Object.create(null);
    var waitOrd = 0;
    var cache = [];
    var cacheCount = 0;
    var cacheBytes = 0;
    var pendingCount = 0;
    var pendingBytes = 0;
    var leadSentence = 0;
    var chunks = [];
    var lastNotified = -1;
    var holdTimer = 0;

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

    function clampIndex(n) {
      if (!sentences.length) return 0;
      if (!(n >= 0)) return 0;
      if (n >= sentences.length) return sentences.length - 1;
      return n;
    }

    function notify(force) {
      if (!sentences.length) return;
      index = clampIndex(index);
      if (!force && index === lastNotified) return;
      lastNotified = index;
      try { onIndex(index, sentences[index]); }
      catch (e) { void e; }
    }

    function emitBuffer() {
      var info = stats();
      try { onBuffer(info); }
      catch (e) { void e; }
    }

    function recount() {
      var i;
      cacheCount = 0;
      cacheBytes = 0;
      for (i = 0; i < cache.length; i++) {
        if (!cache[i]) continue;
        cacheCount++;
        cacheBytes += cache[i].bytes || 0;
      }
    }

    function buildChunks(leadAt) {
      var out = [];
      var i;
      var p;
      for (i = 0; i < sentences.length; i++) {
        var text = sentenceText(sentences, i);
        if (i === leadAt) {
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

    function chunkFor(sentenceIndex) {
      var i;
      for (i = 0; i < chunks.length; i++) {
        if (chunks[i].index >= sentenceIndex) return i;
      }
      return chunks.length ? chunks.length - 1 : 0;
    }

    function stats() {
      var need = Object.create(null);
      var ready = Object.create(null);
      var i;
      for (i = 0; i < chunks.length; i++) {
        var ix = chunks[i].index;
        need[ix] = (need[ix] || 0) + 1;
        if (cache[i]) ready[ix] = (ready[ix] || 0) + 1;
      }
      var prepared = 0;
      var ahead = 0;
      for (i = 0; i < sentences.length; i++) {
        if (need[i] && ready[i] === need[i]) {
          prepared++;
          if (i > index) ahead++;
        }
      }
      return {
        prepared: prepared,
        total: sentences.length,
        ahead: ahead,
        bytes: cacheBytes + pendingBytes
      };
    }

    function overCap() {
      return (cacheCount + pendingCount) >= maxSentences || (cacheBytes + pendingBytes) >= maxBytes;
    }

    function dropPrep(prep) {
      try { if (prep && prep.drop) prep.drop(); }
      catch (e) { void e; }
    }

    function clearCache() {
      var i;
      for (i = 0; i < cache.length; i++) {
        if (cache[i]) dropPrep(cache[i].prep);
      }
      cache = [];
      cacheCount = 0;
      cacheBytes = 0;
      pendingCount = 0;
      pendingBytes = 0;
    }

    function resetClock() {
      var i;
      for (i = 0; i < cache.length; i++) {
        var p = cache[i] && cache[i].prep;
        if (p && typeof p.resetClock === 'function') {
          try { p.resetClock(); } catch (e) { void e; }
          return;
        }
      }
    }

    function restoreClock() {
      if (current && typeof current.restoreClock === 'function') {
        try { current.restoreClock(); } catch (e) { void e; }
      }
    }

    // Drop every armed clip. The epoch moves first so a late "ended" from a
    // clip we just stopped cannot start the next sentence.
    function silenceHandles() {
      playEpoch++;
      resetClock();
      var pending = [];
      var i;
      for (i = 0; i < cache.length; i++) {
        if (!cache[i] || !cache[i].handle) continue;
        pending.push(cache[i].handle);
        cache[i].handle = null;
        cache[i].ended = false;
      }
      current = null;
      currentItem = null;
      for (i = 0; i < pending.length; i++) {
        if (pending[i] && pending[i].stop) {
          try { pending[i].stop(); } catch (e) { void e; }
        }
      }
    }

    function haltHandle() {
      silenceHandles();
    }

    function pauseHandles() {
      var i;
      for (i = 0; i < cache.length; i++) {
        var h = cache[i] && cache[i].handle;
        if (h && h.pause) {
          try { h.pause(); } catch (e) { void e; }
        }
      }
      resetClock();
    }

    function ensureRun() {
      if (runPromise && !settled) return runPromise;
      settled = false;
      runPromise = new Promise(function (resolve) { runResolve = resolve; });
      return runPromise;
    }

    function settle(res) {
      if (settled) return;
      settled = true;
      playing = false;
      var fn = runResolve;
      runResolve = null;
      if (fn) fn(res);
    }

    function failPlayback(err, code) {
      playing = false;
      paused = false;
      playEpoch++;
      haltHandle();
      fault = err;
      fetching = false;
      settle(result({
        code: code || 'no-voice',
        error: true,
        message: installMessage(err),
        index: index
      }));
    }

    function finishOk() {
      playing = false;
      paused = false;
      current = null;
      currentItem = null;
      settle(result({ spoke: true, code: 'ok', index: index }));
    }

    function arm(audio) {
      if (typeof prepare !== 'function') {
        return {
          bytes: audio && audio.bytes && audio.bytes.byteLength || 0,
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
        if (p.bytes == null && audio && audio.bytes) p.bytes = audio.bytes.byteLength || 0;
        if (p.ready && typeof p.ready.then === 'function') {
          return p.ready.then(function () { return p; });
        }
        return p;
      }
      if (prep && typeof prep.then === 'function') return prep.then(finishArm);
      return finishArm(prep);
    }

    function sizeOf(audio, prep) {
      var n = 0;
      if (audio && audio.bytes && audio.bytes.byteLength) n = audio.bytes.byteLength;
      if (prep && typeof prep.bytes === 'number' && prep.bytes > n) n = prep.bytes;
      return n;
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

    function flightKey(chunk) {
      // Source plus sentence. The text keeps the two clips of a split
      // first sentence, and a rewritten sentence, from sharing one promise.
      return sourceId + ':' + sourceGen + ':' + chunk.index + ':' + chunk.text;
    }

    function inFlight(chunk) {
      return !!(chunk && flight[flightKey(chunk)]);
    }

    function sameChunk(chunk) {
      var now = chunks[chunk.ord];
      return !!(now && now.text === chunk.text && now.index === chunk.index);
    }

    function pickNext() {
      var start = (playing || paused) ? waitOrd : chunkFor(index);
      if (!(start >= 0)) start = 0;
      var i;
      for (i = start; i < chunks.length; i++) if (!cache[i] && !inFlight(chunks[i])) return chunks[i];
      for (i = 0; i < start; i++) if (!cache[i] && !inFlight(chunks[i])) return chunks[i];
      return null;
    }

    function oldestConsumed() {
      var i;
      for (i = 0; i < cache.length; i++) {
        if (!cache[i] || !cache[i].consumed) continue;
        if (cache[i] === currentItem) continue;
        if (i === waitOrd) continue;
        return i;
      }
      return null;
    }

    function relax() {
      if (!overCap()) {
        if (preparing) pump();
        return;
      }
      while (overCap()) {
        var ord = oldestConsumed();
        if (ord == null) break;
        dropPrep(cache[ord].prep);
        cache[ord] = null;
        recount();
      }
      emitBuffer();
      if (preparing) pump();
    }

    function callPlay(item) {
      var handle;
      try { handle = item.prep.play(); }
      catch (e) {
        failPlayback(e, 'playback');
        return null;
      }
      if (!handle || !handle.done || typeof handle.done.then !== 'function') {
        failPlayback(new Error('PLAYBACK: The audio did not play.'), 'playback');
        return null;
      }
      return handle;
    }

    function watchHandle(ord, handle, ep) {
      handle.done.then(function () {
        if (ep !== playEpoch || dead) return;
        if (!cache[ord] || cache[ord].handle !== handle) return;
        cache[ord].ended = true;
        if (!playing || paused) return;
        if (current === handle) onEnded(ord, handle);
      }, function (err) {
        if (ep !== playEpoch || dead) return;
        if (!cache[ord] || cache[ord].handle !== handle) return;
        current = null;
        currentItem = null;
        var playback = /^PLAYBACK:/.test(String(err && err.message || err));
        failPlayback(err, playback ? 'playback' : 'no-voice');
      });
    }

    function armAhead() {
      if (!playing || paused || !currentItem || !currentItem.prep || !currentItem.prep.schedules) return;
      var ord = currentItem.chunk.ord + 1;
      var ep = playEpoch;
      while (ord < chunks.length) {
        if (ep !== playEpoch || !playing || paused) return;
        var item = cache[ord];
        if (!item || !item.prep || !item.prep.schedules) break;
        if (!item.handle) {
          var handle = callPlay(item);
          if (!handle) return;
          item.handle = handle;
          item.ended = false;
          watchHandle(ord, handle, ep);
        }
        ord++;
      }
    }

    function adopt(ord) {
      var item = cache[ord];
      if (!item || !item.handle) return false;
      current = item.handle;
      currentItem = item;
      waitOrd = ord;
      index = item.chunk.index;
      notify(false);
      if (item.ended) onEnded(ord, item.handle);
      else armAhead();
      return true;
    }

    function onEnded(ord, handle) {
      var item = cache[ord];
      if (!item || item.handle !== handle || item.consumed) return;
      item.consumed = true;
      item.handle = null;
      if (current === handle) {
        current = null;
        currentItem = null;
      }
      var next = ord + 1;
      if (!playing || paused) {
        relax();
        return;
      }
      waitOrd = next;
      if (next >= chunks.length) {
        relax();
        finishOk();
        return;
      }
      relax();
      if (!playing || paused || current) return;
      var nxt = cache[next];
      if (nxt && nxt.handle) {
        adopt(next);
        return;
      }
      if (!startClip(next)) relax();
      else armAhead();
    }

    function maybePlayWaiting() {
      if (!playing || paused) return;
      if (!current) {
        if (!startClip(waitOrd)) return;
      }
      armAhead();
    }

    function startClip(ord) {
      waitOrd = ord;
      if (!playing || paused) return false;
      if (ord < 0 || ord >= chunks.length) return false;
      var item = cache[ord];
      if (!item || !item.prep) return false;
      if (item.handle) return adopt(ord);
      var handle = callPlay(item);
      if (!handle) return false;
      item.handle = handle;
      item.ended = false;
      var ep = playEpoch;
      current = handle;
      currentItem = item;
      index = item.chunk.index;
      notify(false);
      watchHandle(ord, handle, ep);
      return true;
    }

    function resumeHandles() {
      resetClock();
      if (!currentItem || !current) return;
      var i;
      for (i = currentItem.chunk.ord; i < cache.length; i++) {
        var item = cache[i];
        if (!item || !item.handle) break;
        if (item.ended) {
          onEnded(i, item.handle);
          return;
        }
        if (item.handle.resume) {
          try { item.handle.resume(); }
          catch (e) { failPlayback(e, 'playback'); return; }
        }
      }
      armAhead();
    }

    function remember(ticket, gen, chunk, audio, prep) {
      if (ticket !== token || gen !== sourceGen || dead || !sameChunk(chunk)) {
        dropPrep(prep);
        return;
      }
      if (cache[chunk.ord] && cache[chunk.ord] !== currentItem) dropPrep(cache[chunk.ord].prep);
      cache[chunk.ord] = {
        prep: prep,
        chunk: chunk,
        bytes: sizeOf(audio, prep),
        consumed: false
      };
      recount();
      emitBuffer();
      maybePlayWaiting();
    }

    function releaseReserve(ticket, gen, reserved) {
      if (ticket !== token || gen !== sourceGen || dead) return;
      pendingCount = Math.max(0, pendingCount - 1);
      pendingBytes = Math.max(0, pendingBytes - reserved);
    }

    function stillCurrent(ticket, gen) {
      return ticket === token && gen === sourceGen && !dead;
    }

    // One promise per source and sentence, from the voice call through decode.
    // A second play, seek, resume, or prefetch waits on it.
    function requestChunk(chunk) {
      var key = flightKey(chunk);
      if (flight[key]) return flight[key];
      var ticket = token;
      var gen = sourceGen;
      var settledJob = false;
      var resolve;
      var promise = new Promise(function (res) { resolve = res; });
      function finish(value) {
        if (settledJob) return;
        settledJob = true;
        if (flight[key] === promise) delete flight[key];
        resolve(value || null);
      }
      flight[key] = promise;
      fetchChunk(chunk).then(function (audio) {
        if (!stillCurrent(ticket, gen)) {
          finish(null);
          return;
        }
        fetching = false;
        var armed;
        try { armed = arm(audio); }
        catch (e) { armed = Promise.reject(e); }
        if (armed && typeof armed.then === 'function') {
          var reserved = sizeOf(audio, null);
          pendingCount++;
          pendingBytes += reserved;
          if (preparing && !fault) pump();
          armed.then(function (prep) {
            releaseReserve(ticket, gen, reserved);
            if (!stillCurrent(ticket, gen)) {
              dropPrep(prep);
              finish(null);
              return;
            }
            remember(ticket, gen, chunk, audio, prep);
            finish(prep);
            if (preparing && !fault) pump();
          }, function (err) {
            releaseReserve(ticket, gen, reserved);
            finish(null);
            if (!stillCurrent(ticket, gen)) return;
            fetching = false;
            failPlayback(err, /^PLAYBACK:/.test(String(err && err.message || err)) ? 'playback' : 'no-voice');
          });
          return;
        }
        remember(ticket, gen, chunk, audio, armed);
        finish(armed);
        if (preparing && !fault) pump();
      }, function (err) {
        finish(null);
        if (!stillCurrent(ticket, gen)) return;
        fetching = false;
        failPlayback(err, 'no-voice');
      });
      promise.catch(function () {});
      return promise;
    }

    function followFlight(ord) {
      var chunk = chunks[ord];
      if (!chunk) return;
      var pending = flight[flightKey(chunk)];
      if (!pending) return;
      var ep = playEpoch;
      var gen = sourceGen;
      pending.then(function () {
        if (gen !== sourceGen || ep !== playEpoch || dead) return;
        if (!playing || paused || current) return;
        if (waitOrd !== ord) return;
        if (!startClip(ord)) return;
        armAhead();
      }, function () {});
    }

    function pump() {
      if (dead || !preparing || fetching || fault || holdTimer) return;
      if (playing && !paused && current && typeof current.endingSoon === 'function') {
        var soon = false;
        try { soon = !!current.endingSoon(); } catch (e) { soon = false; }
        if (soon) {
          holdTimer = setTimeout(function () {
            holdTimer = 0;
            pump();
          }, 40);
          return;
        }
      }
      if (!chunks.length) return;
      if (overCap()) return;
      var chunk = pickNext();
      if (!chunk) return;
      if (inFlight(chunk)) {
        requestChunk(chunk);
        return;
      }
      fetching = true;
      requestChunk(chunk);
    }

    function invalidateExceptPlaying() {
      token++;
      fetching = false;
      pendingCount = 0;
      pendingBytes = 0;
      fault = null;
      // The speed or the voice changed, so an in-flight clip is the wrong request.
      flight = Object.create(null);
      var keep = currentItem;
      var i;
      for (i = 0; i < cache.length; i++) {
        if (!cache[i] || cache[i] === keep) continue;
        if (cache[i].handle && cache[i].handle.stop) {
          var old = cache[i].handle;
          cache[i].handle = null;
          try { old.stop(); } catch (e) { void e; }
        }
        dropPrep(cache[i].prep);
        cache[i] = null;
      }
      resetClock();
      restoreClock();
      recount();
      emitBuffer();
    }

    function retarget(next, replace) {
      sentences = (next || []).slice();
      index = clampIndex(index);
      if (replace) {
        token++;
        sourceGen++;
        flight = Object.create(null);
        fetching = false;
        pendingCount = 0;
        pendingBytes = 0;
        fault = null;
        playEpoch++;
        haltHandle();
        playing = false;
        paused = false;
        clearCache();
        leadSentence = index;
        lastNotified = -1;
        chunks = buildChunks(leadSentence);
        settle(result({ code: 'stopped', stopped: true, index: index }));
        emitBuffer();
        if (preparing) pump();
        return;
      }
      var nextChunks = buildChunks(leadSentence);
      var n = 0;
      while (n < chunks.length && n < nextChunks.length &&
        chunks[n].text === nextChunks[n].text && chunks[n].index === nextChunks[n].index) n++;
      var i;
      var playingOrd = currentItem ? currentItem.chunk.ord : -1;
      for (i = n; i < cache.length; i++) {
        if (!cache[i]) continue;
        if (cache[i] === currentItem) continue;
        dropPrep(cache[i].prep);
        cache[i] = null;
      }
      if (playingOrd >= n) {
        playEpoch++;
        haltHandle();
      }
      chunks = nextChunks;
      recount();
      index = clampIndex(index);
      emitBuffer();
      maybePlayWaiting();
      if (preparing) pump();
    }

    index = clampIndex(sentences.length ? index : 0);
    leadSentence = index;
    chunks = buildChunks(leadSentence);
    if (preparing && sentences.length) pump();

    return {
      play: function () {
        if (dead) return Promise.resolve(result({ code: 'stopped', stopped: true, index: index }));
        if (!sentences.length) {
          return Promise.resolve(result({
            code: 'no-text',
            message: 'This PDF has no text to read.'
          }));
        }
        if (fault && !cacheCount && !fetching) {
          return Promise.resolve(result({
            code: 'no-voice',
            error: true,
            message: installMessage(fault),
            index: index
          }));
        }
        if (paused && current && current.resume) {
          paused = false;
          playing = true;
          ensureRun();
          resumeHandles();
          if (preparing) pump();
          return runPromise;
        }
        paused = false;
        playing = true;
        ensureRun();
        if (!current) {
          waitOrd = chunkFor(index);
          if (!startClip(waitOrd)) followFlight(waitOrd);
          else armAhead();
        } else armAhead();
        if (preparing) pump();
        return runPromise;
      },
      pause: function () {
        if (paused) return;
        if (!playing && !current) return;
        paused = true;
        playing = false;
        pauseHandles();
      },
      stop: function () {
        if (dead) return;
        playing = false;
        paused = false;
        silenceHandles();
        index = 0;
        waitOrd = 0;
        notify(true);
        settle(result({ code: 'stopped', stopped: true, index: index }));
        if (preparing) pump();
      },
      stopPreparing: function () {
        preparing = false;
      },
      startPreparing: function () {
        if (dead) return;
        preparing = true;
        fault = null;
        pump();
      },
      preparing: function () { return preparing; },
      next: function () { return this.go(index + 1); },
      prev: function () { return this.go(index - 1); },
      go: function (i) {
        if (!sentences.length) {
          return Promise.resolve(result({ code: 'no-text', message: 'This PDF has no text to read.' }));
        }
        i = clampIndex(i);
        var wasPlaying = playing && !paused;
        index = i;
        if (current) silenceHandles();
        paused = false;
        notify(true);
        waitOrd = chunkFor(index);
        if (wasPlaying) {
          playing = true;
          ensureRun();
          if (!startClip(waitOrd)) followFlight(waitOrd);
          else armAhead();
        } else {
          playing = false;
        }
        if (preparing) pump();
        if (wasPlaying) return runPromise || Promise.resolve(result({ code: 'ok', index: index }));
        return Promise.resolve(result({ code: 'ok', index: index }));
      },
      goPage: function (page) {
        var want = page | 0;
        var n = sentences.length ? sentences.length - 1 : 0;
        var k;
        for (k = 0; k < sentences.length; k++) {
          if (sentencePage(sentences, k) >= want) { n = k; break; }
        }
        return this.go(n);
      },
      setSpeed: function (s) {
        var n = Number(s);
        if (!(n >= 0.25 && n <= 4) || n === speed) return;
        speed = n;
        invalidateExceptPlaying();
        if (preparing) pump();
      },
      setVoice: function (v) {
        var next = v || '';
        if (next === voice) return;
        voice = next;
        invalidateExceptPlaying();
        if (preparing) pump();
      },
      setIndex: function (i) {
        if (!sentences.length) { index = 0; waitOrd = 0; return; }
        index = clampIndex(i);
        if (!current) waitOrd = chunkFor(index);
        if (preparing) pump();
      },
      setSentences: function (next) {
        if (dead) return;
        retarget(next, false);
      },
      reset: function (next, at) {
        if (dead) return;
        index = at || 0;
        retarget(next, true);
      },
      close: function () {
        if (dead) return;
        dead = true;
        preparing = false;
        token++;
        sourceGen++;
        flight = Object.create(null);
        fetching = false;
        playing = false;
        paused = false;
        silenceHandles();
        clearCache();
        settle(result({ code: 'stopped', stopped: true, index: index }));
        emitBuffer();
      },
      stats: function () { return stats(); },
      label: function () { return bufferLabel(stats()); },
      index: function () { return index; },
      speed: function () { return speed; },
      playing: function () { return playing && !paused; },
      paused: function () { return paused; }
    };
  }

  root.PdfSpeak = {
    INSTALL: INSTALL,
    MAX_SENTENCES: MAX_SENTENCES,
    MAX_BYTES: MAX_BYTES,
    bufferLabel: bufferLabel,
    installMessage: installMessage,
    splitLead: splitLead,
    createReader: createReader
  };
})(typeof window !== 'undefined' ? window : this);
