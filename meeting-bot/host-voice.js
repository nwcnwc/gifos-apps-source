/* Local and Grok voice for the GifOS host page.
 * The Meeting Bot app frame cannot fetch. This file runs on the host,
 * which already owns the meeting session. It streams an OpenAI-compatible
 * chat model (no tools) and speaks with Kokoro, or hands speech to Grok Voice.
 * The key stays here. Public results never include it. */
(function (root) {
  function scrub(text, secret) {
    var s = String(text == null ? '' : text);
    var key = String(secret || '');
    if (!key) return s;
    return s.split(key).join('[redacted]');
  }

  function normalizeVoice(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) s = 'none';
    if (s !== 'none' && s !== 'grok' && s !== 'local') throw new Error('conversation_voice must be none, grok, or local.');
    return s;
  }

  function storeTts(tts) {
    if (!tts) return null;
    var engine = String(tts.engine || '').trim().toLowerCase();
    if (!engine) engine = tts.url ? 'http' : 'kokoro';
    if (engine === 'none') return { engine: 'none' };
    if (engine === 'http') return { engine: 'http', url: String(tts.url || ''), voice: String(tts.voice || '') };
    return {
      engine: 'kokoro',
      app: String(tts.app || 'offline-tts-kokoro'),
      voice: String(tts.voice || 'af_heart')
    };
  }

  function publicOf(settings) {
    var out = {
      respond_to_command: !!settings.respond_to_command,
      conversation_voice: settings.conversation_voice
    };
    if (settings.conversation_voice === 'local' && settings.llm) {
      out.llm = { url: settings.llm.url || '', model: settings.llm.model || '' };
    }
    if (settings.conversation_voice === 'local' && settings.tts) {
      if (settings.tts.engine === 'http') out.tts = { engine: 'http' };
      else if (settings.tts.engine === 'none') out.tts = { engine: 'none' };
      else out.tts = { engine: 'kokoro', app: settings.tts.app || 'offline-tts-kokoro', voice: settings.tts.voice || 'af_heart' };
    }
    if (settings.stt && settings.stt.url) out.stt = { configured: true };
    return out;
  }

  function pullClauses(buf) {
    var clauses = [];
    var rest = buf;
    var m;
    while ((m = rest.match(/^([\s\S]*?[.!?])(?:\s+|$)/))) {
      var clause = m[1].trim();
      if (clause) clauses.push(clause);
      rest = rest.slice(m[0].length);
    }
    return { clauses: clauses, rest: rest };
  }

  function decodeChunk(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(value);
    return String(value);
  }

  function createHostVoice(opts) {
    opts = opts || {};
    var fetchImpl = opts.fetch;
    var tts = opts.tts;
    var play = opts.play || function () { return Promise.resolve(); };
    var stopPlay = opts.stop || function () { return Promise.resolve(); };
    var grok = opts.grok;
    var settings = { respond_to_command: false, conversation_voice: 'none', llm: null };
    var gen = 0;
    var abort = null;

    function keyNow() { return (settings.llm && settings.llm.key) || ''; }

    function scrubAll(text) {
      var s = scrub(text, keyNow());
      if (settings.tts && settings.tts.url) s = scrub(s, settings.tts.url);
      if (settings.stt && settings.stt.url) s = scrub(s, settings.stt.url);
      return s;
    }

    function fail(err) {
      var msg = scrubAll(err && err.message ? err.message : err);
      var e = new Error(msg || 'The voice failed.');
      e.name = err && err.name || 'Error';
      throw e;
    }

    function setVoice(next) {
      next = next || {};
      if (next.conversation_voice != null) settings.conversation_voice = normalizeVoice(next.conversation_voice);
      if (next.respond_to_command != null) settings.respond_to_command = !!next.respond_to_command;
      if (settings.conversation_voice !== 'local') {
        settings.llm = null;
        settings.tts = null;
      } else {
        if (next.llm) {
          settings.llm = {
            url: String(next.llm.url || ''),
            model: String(next.llm.model || ''),
            key: String(next.llm.key || '')
          };
        }
        if (next.tts) settings.tts = storeTts(next.tts);
      }
      if (next.stt) settings.stt = next.stt.url ? { url: String(next.stt.url) } : null;
      return publicOf(settings);
    }

    function interrupt() {
      gen += 1;
      if (abort) {
        try { abort.abort(); } catch (e) {}
        abort = null;
      }
      return Promise.resolve().then(function () { return stopPlay(); }).then(function () {}, function () {});
    }

    function utter(clause, myGen) {
      var engine = (settings.tts && settings.tts.engine) || 'kokoro';
      if (engine === 'none') return Promise.reject(new Error('Speech is turned off.'));
      if (engine === 'http') {
        if (!fetchImpl || !settings.tts.url) return Promise.reject(new Error('The speech stand-in is not available on this page.'));
        return Promise.resolve().then(function () {
          return fetchImpl(settings.tts.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: clause, voice: settings.tts.voice || '' })
          });
        }).then(function (res) {
          if (!res || res.ok === false) throw new Error('The speech stand-in returned ' + ((res && res.status) || 'an error') + '.');
          if (myGen !== gen) return;
          var mime = 'audio/wav';
          try { if (res.headers && res.headers.get) mime = res.headers.get('content-type') || mime; } catch (e) {}
          var body = res.arrayBuffer ? res.arrayBuffer() : (res.bytes || null);
          return Promise.resolve(body).then(function (bytes) {
            if (myGen !== gen) return;
            return play({ bytes: bytes, mime: mime }, clause);
          });
        });
      }
      if (!tts) return Promise.reject(new Error('Kokoro is not available on this computer.'));
      return Promise.resolve().then(function () {
        return tts({
          text: clause,
          engine: 'kokoro',
          app: (settings.tts && settings.tts.app) || 'offline-tts-kokoro',
          voice: (settings.tts && settings.tts.voice) || 'af_heart'
        });
      }).then(function (audio) {
        if (myGen !== gen) return;
        return play(audio, clause);
      });
    }

    function speakKokoro(text, myGen) {
      var chain = Promise.resolve();
      var parts = pullClauses(String(text || '').trim() + ' ').clauses;
      if (!parts.length && String(text || '').trim()) parts = [String(text).trim()];
      parts.forEach(function (clause) {
        chain = chain.then(function () {
          if (myGen !== gen) return;
          return utter(clause, myGen);
        });
      });
      return chain.then(function () { return { spoken: myGen === gen, text: String(text || '').trim() }; });
    }

    function speakGrok(text, myGen) {
      if (!grok) return Promise.reject(new Error('Grok Voice is not available on this meeting page.'));
      return Promise.resolve().then(function () { return grok(String(text || '')); }).then(function () {
        return { spoken: myGen === gen, text: String(text || '').trim() };
      });
    }

    function speakNow(text) {
      var myGen = gen;
      if (settings.conversation_voice === 'grok') return speakGrok(text, myGen);
      return speakKokoro(text, myGen);
    }

    function interject(text) {
      var line = String(text || '').trim();
      if (!line) return Promise.reject(new Error('Nothing to say.'));
      return interrupt().then(function () {
        var myGen = gen;
        return speakNow(line).then(function (r) {
          if (myGen !== gen) return { spoken: false, stopped: true, text: line };
          return { spoken: true, text: line, via: settings.conversation_voice === 'grok' ? 'grok' : 'kokoro' };
        });
      }).catch(function (e) { fail(e); });
    }

    function readStream(res, onDelta, signal) {
      var body = res.body;
      if (!body || !body.getReader) {
        return Promise.resolve().then(function () { return res.text ? res.text() : ''; }).then(function (raw) {
          String(raw || '').split('\n').forEach(function (line) { takeLine(line, onDelta); });
        });
      }
      var reader = body.getReader();
      var buf = '';
      function step() {
        if (signal.aborted) return Promise.resolve();
        return reader.read().then(function (r) {
          if (r.done || signal.aborted) return;
          buf += decodeChunk(r.value);
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) { takeLine(line, onDelta); });
          return step();
        });
      }
      return step();
    }

    function takeLine(line, onDelta) {
      var s = String(line || '').trim();
      if (s.indexOf('data:') !== 0) return;
      var data = s.slice(5).trim();
      if (!data || data === '[DONE]') return;
      var json;
      try { json = JSON.parse(data); } catch (e) { return; }
      var delta = json && json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
      if (delta) onDelta(String(delta));
    }

    function streamLocal(prompt, myGen) {
      if (!settings.llm) return Promise.reject(new Error('Local voice needs a model URL and a model name.'));
      if (!fetchImpl) return Promise.reject(new Error('This page cannot reach the language model.'));
      var controller = typeof AbortController === 'function' ? new AbortController() : { abort: function () {}, signal: { aborted: false } };
      abort = controller;
      var base = String(settings.llm.url || '').replace(/\/+$/, '');
      var model = String(settings.llm.model || '');
      if (!base && settings.llm.key) base = 'https://api.x.ai/v1';
      if (!model && base.indexOf('api.x.ai') >= 0) model = 'grok-4.20-0309-non-reasoning';
      if (!base || !model) return Promise.reject(new Error('Local voice needs a model URL and a model name.'));
      var messages = [
        { role: 'system', content: 'You are speaking aloud in a meeting. Answer in one or two short sentences. No markdown.' },
        { role: 'user', content: String(prompt || '') }
      ];
      var payload = { model: model, messages: messages, stream: true };
      var held = '';
      var chain = Promise.resolve();
      var spoken = [];
      function enqueue(clause) {
        spoken.push(clause);
        chain = chain.then(function () {
          if (myGen !== gen) return;
          return utter(clause, myGen);
        });
      }
      return Promise.resolve().then(function () {
        return fetchImpl(base + '/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + (settings.llm.key || '')
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      }).then(function (res) {
        if (!res || res.ok === false) throw new Error('The language model returned ' + ((res && res.status) || 'an error') + '.');
        return readStream(res, function (delta) {
          if (myGen !== gen) return;
          held += delta;
          var pulled = pullClauses(held);
          held = pulled.rest;
          pulled.clauses.forEach(enqueue);
        }, controller.signal);
      }).then(function () {
        if (myGen !== gen) return { spoken: false, stopped: true, text: spoken.join(' ') };
        var tail = held.trim();
        if (tail) enqueue(tail);
        return chain.then(function () {
          return { spoken: spoken.length > 0 && myGen === gen, text: spoken.join(' '), clauses: spoken.slice() };
        });
      }).catch(function (e) {
        if (controller.signal && controller.signal.aborted) return { spoken: false, stopped: true, text: spoken.join(' ') };
        if (e && e.name === 'AbortError') return { spoken: false, stopped: true, text: spoken.join(' ') };
        fail(e);
      });
    }

    function converse(prompt) {
      if (settings.conversation_voice === 'none') return Promise.resolve({ spoken: false, quiet: true });
      var myGen = gen;
      if (settings.conversation_voice === 'grok') {
        return speakGrok(prompt, myGen).catch(function (e) { fail(e); });
      }
      return streamLocal(prompt, myGen);
    }

    return {
      setVoice: setVoice,
      interject: interject,
      converse: converse,
      interrupt: interrupt,
      publicSettings: function () { return publicOf(settings); }
    };
  }

  root.HostVoice = { create: createHostVoice, pullClauses: pullClauses, scrub: scrub };
})(typeof window !== 'undefined' ? window : globalThis);
