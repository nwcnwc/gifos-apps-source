/* Voice rules for Meeting Bot. No network. Speech uses the GifOS AI
 * roles (Smartest, Text to speech). This file never returns a key or a URL. */
(function (root) {
  var TEXT_ROLE = 'smartest';

  function engineFields(s) {
    return !!(s && (s.conversation_voice != null || s.llm || s.tts || s.stt));
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

  // Said as soon as a person finishes talking to the bot, before the answer.
  var FILLER = 'One moment while I think about that.';
  // How long a filler of unknown format is given before the answer plays.
  var FILLER_MS = 2500;

  // Play time of a WAV in ms, from its fmt and data chunks. 0 when the bytes
  // are not a WAV this can read.
  function wavMs(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    var tag = function (at) { return String.fromCharCode(u[at], u[at + 1], u[at + 2], u[at + 3]); };
    if (u.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 0;
    var dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    var rate = 0;
    var at = 12;
    while (at + 8 <= u.length) {
      var size = dv.getUint32(at + 4, true);
      if (tag(at) === 'fmt ' && at + 20 <= u.length) rate = dv.getUint32(at + 16, true);
      if (tag(at) === 'data') return rate ? Math.round(Math.min(size, u.length - at - 8) * 1000 / rate) : 0;
      at += 8 + size + (size & 1);
    }
    return 0;
  }

  // Settings safe to resolve, log, and put on screen.
  // An engine name, a model URL, or a key is refused.
  function publicSettings(s) {
    s = s || {};
    if (engineFields(s)) throw new Error('Voice uses the GifOS AI settings (Smartest and Text to speech).');
    return {
      respond_to_command: !!s.respond_to_command,
      speak: !!s.speak,
      listen: !!s.listen,
      text_role: TEXT_ROLE
    };
  }

  root.BotVoice = {
    TEXT_ROLE: TEXT_ROLE,
    scrub: scrub,
    addressedToBot: addressedToBot,
    isCommand: isCommand,
    isConversation: isConversation,
    norm: norm,
    FILLER: FILLER,
    FILLER_MS: FILLER_MS,
    wavMs: wavMs,
    publicSettings: publicSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
