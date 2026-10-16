/* Voice rules for Meeting Bot. No network. The key never appears in a
 * value this file returns. */
(function (root) {
  var VOICES = ['none', 'grok', 'local'];

  function normalizeVoice(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) s = 'none';
    if (VOICES.indexOf(s) < 0) throw new Error('conversation_voice must be none, grok, or local.');
    return s;
  }

  function scrub(text, secret) {
    var s = String(text == null ? '' : text);
    var key = String(secret || '');
    if (!key) return s;
    return s.split(key).join('[redacted]');
  }

  function addressedToBot(text, name) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return false;
    var n = String(name || '').trim().toLowerCase();
    if (n && t.indexOf(n) >= 0) return true;
    return /^(hey |ok |hi |hello )?bot\b/.test(t);
  }

  // A command is aimed at the bot. Ordinary talk is not.
  function isCommand(text, name) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (addressedToBot(t, name)) return true;
    if (/^(join|leave|list|record|transcribe|status|send)\b/i.test(t)) return true;
    if (/^\s*[\/!]/.test(t)) return true;
    return false;
  }

  // Conversation is room talk the voice may answer. Commands are separate.
  function isConversation(text, name) {
    var t = String(text || '').trim();
    if (!t || isCommand(t, name)) return false;
    if (/\?\s*$/.test(t)) return true;
    return t.length >= 24;
  }

  function norm(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Kokoro, an HTTP stand-in, or off. The stand-in URL is never copied out.
  function publicTts(tts) {
    if (!tts) return null;
    var engine = String(tts.engine || '').trim().toLowerCase();
    if (!engine) engine = tts.url ? 'http' : 'kokoro';
    if (engine === 'none') return { engine: 'none' };
    if (engine === 'http') return { engine: 'http' };
    if (engine !== 'kokoro' && engine !== 'auto') throw new Error('tts.engine must be kokoro, http, or none.');
    return {
      engine: 'kokoro',
      app: String(tts.app || 'offline-tts-kokoro'),
      voice: String(tts.voice || 'af_heart')
    };
  }

  // Settings safe to resolve, log, and put on screen.
  // llm.key, tts.url, and stt.url are dropped.
  function publicSettings(s) {
    s = s || {};
    var voice = 'none';
    try { voice = normalizeVoice(s.conversation_voice); } catch (e) { voice = 'none'; }
    var out = {
      respond_to_command: !!(s.respond_to_command),
      conversation_voice: voice
    };
    if (voice === 'local' && s.llm && (s.llm.url || s.llm.model)) {
      out.llm = { url: String(s.llm.url || ''), model: String(s.llm.model || '') };
    }
    if (voice === 'local' && s.tts) out.tts = publicTts(s.tts);
    if (s.stt && (s.stt.url || s.stt.configured)) out.stt = { configured: true };
    return out;
  }

  root.BotVoice = {
    VOICES: VOICES,
    normalizeVoice: normalizeVoice,
    scrub: scrub,
    addressedToBot: addressedToBot,
    isCommand: isCommand,
    isConversation: isConversation,
    norm: norm,
    publicTts: publicTts,
    publicSettings: publicSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
