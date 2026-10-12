/* Speak sentences through a Text → speech function.
 * The next sentence is fetched while the current one plays.
 * Nothing is fetched two ahead: a provider that speaks slowly would queue
 * a long silence in front of the first sound.
 * If the voice is missing or the call fails, the result is a message.
 * There is no second speaker and no silent success. */
(function (root) {
  'use strict';

  var INSTALL = 'Install Offline TTS from the store, then assign it to Text → speech in Settings.';

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

  function createReader(opts) {
    opts = opts || {};
    var sentences = opts.sentences || [];
    var index = opts.index || 0;
    var speed = opts.speed == null ? 1 : opts.speed;
    var voice = opts.voice || '';
    var tts = opts.tts || null;
    var play = opts.play || null;
    var onIndex = typeof opts.onIndex === 'function' ? opts.onIndex : function () {};
    var gen = 0;
    var current = null;
    var playing = false;
    var paused = false;
    var runPromise = null;

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

    function fetchAt(i) {
      var req = { text: sentenceText(sentences, i), voice: voice, speed: speed };
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
        return { bytes: r.bytes, mime: r.mime || 'audio/mpeg', text: req.text, index: i };
      });
    }

    function runFrom(start) {
      var my = ++gen;
      stopHandle();
      paused = false;
      if (!sentences.length) {
        playing = false;
        return Promise.resolve(result({
          code: 'no-text',
          message: 'This PDF has no text to read.'
        }));
      }
      var i = start;
      if (!(i >= 0)) i = 0;
      if (i >= sentences.length) i = sentences.length - 1;
      index = i;
      playing = true;
      var pending = fetchAt(i);
      runPromise = null;

      function step() {
        if (my !== gen) return Promise.resolve(result({ code: 'stopped', stopped: true }));
        var cur = i;
        return pending.then(function (audio) {
          if (my !== gen) return result({ code: 'stopped', stopped: true });
          index = cur;
          onIndex(cur, sentences[cur]);
          if (typeof play !== 'function') {
            playing = false;
            return result({
              code: 'no-voice',
              error: true,
              message: installMessage(new Error('NOT_CONFIGURED:ai:tts'))
            });
          }
          var handle = play(audio);
          if (!handle || !handle.done || typeof handle.done.then !== 'function') {
            playing = false;
            return result({
              code: 'playback',
              error: true,
              message: installMessage(new Error('PLAYBACK: The audio did not play.'))
            });
          }
          current = handle;
          if (paused && handle.pause) handle.pause();
          // Start the next bite only after this one is in the speaker.
          // The fetch runs while handle.done is still pending.
          if (cur + 1 < sentences.length) pending = fetchAt(cur + 1);
          else pending = null;
          return handle.done.then(function () {
            if (my !== gen) return result({ code: 'stopped', stopped: true });
            if (current === handle) current = null;
            if (!pending) {
              playing = false;
              paused = false;
              index = cur;
              return result({ spoke: true, code: 'ok', index: cur });
            }
            i = cur + 1;
            index = i;
            return step();
          }, function (err) {
            if (my !== gen) return result({ code: 'stopped', stopped: true });
            playing = false;
            stopHandle();
            return result({
              code: /^PLAYBACK:/.test(String(err && err.message || err)) ? 'playback' : 'no-voice',
              error: true,
              message: installMessage(err),
              index: cur
            });
          });
        }).catch(function (err) {
          if (my !== gen) return result({ code: 'stopped', stopped: true });
          playing = false;
          stopHandle();
          return result({
            code: 'no-voice',
            error: true,
            message: installMessage(err),
            index: cur
          });
        });
      }
      runPromise = step();
      return runPromise;
    }

    function moveTo(n, keepPlaying) {
      if (!sentences.length) return Promise.resolve(result({ code: 'no-text', message: 'This PDF has no text to read.' }));
      if (n < 0) n = 0;
      if (n >= sentences.length) n = sentences.length - 1;
      if (keepPlaying && playing && !paused) return runFrom(n);
      var was = playing;
      gen++;
      stopHandle();
      playing = false;
      paused = false;
      index = n;
      onIndex(index, sentences[index]);
      return Promise.resolve(result({ code: was ? 'stopped' : 'ok', stopped: was, index: index }));
    }

    return {
      play: function () {
        if (paused && current && current.resume) {
          paused = false;
          playing = true;
          current.resume();
          return runPromise || Promise.resolve(result({ code: 'ok', resumed: true }));
        }
        return runFrom(index);
      },
      pause: function () {
        if (!playing || !current) {
          paused = !!playing;
          return;
        }
        paused = true;
        if (current.pause) current.pause();
      },
      stop: function () {
        gen++;
        stopHandle();
        playing = false;
        paused = false;
      },
      next: function () { return moveTo(index + 1, true); },
      prev: function () { return moveTo(index - 1, true); },
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
        if (n >= 0.25 && n <= 4) speed = n;
      },
      setVoice: function (v) { voice = v || ''; },
      setIndex: function (i) {
        if (!sentences.length) { index = 0; return; }
        if (i < 0) index = 0;
        else if (i >= sentences.length) index = sentences.length - 1;
        else index = i;
      },
      index: function () { return index; },
      speed: function () { return speed; },
      playing: function () { return playing && !paused; },
      paused: function () { return paused; }
    };
  }

  root.PdfSpeak = {
    INSTALL: INSTALL,
    installMessage: installMessage,
    createReader: createReader
  };
})(typeof window !== 'undefined' ? window : this);
