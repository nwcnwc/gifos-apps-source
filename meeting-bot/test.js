// Meeting Bot protocol: strength, KDF, and structured messages. The UI is exercised in the browser suite.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + extra : ''));
  if (!c) failures++;
};

const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
const listing = JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8'));
const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

check('manifest declares meet, remote, and Smartest speech', manifest.capabilities && manifest.capabilities.meet === true && manifest.capabilities.remote === true && Array.isArray(manifest.capabilities.ai) && manifest.capabilities.ai.indexOf('smartest') >= 0 && manifest.capabilities.ai.indexOf('tts') >= 0);
check('minBuild is the 0.9.23 build that ships Meet', manifest.minBuild === 2723);
check('no network capability', !manifest.capabilities.network && !manifest.capabilities.api);
check('launch keys for headless start', !!(manifest.launch && manifest.launch.mode && manifest.launch.name && manifest.launch.password));
check('listing names the app', listing.tagline && listing.categories && listing.categories.indexOf('Utilities') >= 0);
check('help covers both modes', /RUN/.test(help) && /CONTROL/.test(help) && help.length > 400);
check('app does not fetch or open a socket', !/\bfetch\s*\(/.test(app) && !/WebSocket/.test(app) && !/\beval\s*\(/.test(app));
check('page has the launch form and the control panel', /id="mode-run"/.test(html) && /id="mode-control"/.test(html) && /id="rules"/.test(html) && /id="ctrl"/.test(html));

const control = fs.readFileSync(path.join(APP, 'CONTROL.md'), 'utf8');
check('launch key start for headless runs', !!(manifest.launch && manifest.launch.start));
check('listing has cover art on disk', listing.cover === 'screenshot.png' && fs.statSync(path.join(APP, 'screenshot.png')).size > 1000);
const API = ['start', 'status', 'list', 'create', 'join', 'leave', 'end', 'record', 'transcribe', 'say', 'people', 'transcript', 'chatFile', 'recording', 'setVoice', 'interject', 'stopSpeaking', 'raiseHand', 'setMic', 'setCamera', 'meetingState', 'snapshot', 'watch'];
const apiBlock = (app.match(/window\.MeetingBot = \{([\s\S]*?)\};/) || [])[1] || '';
const missingApi = API.filter((k) => !new RegExp('\\b' + k + ':').test(apiBlock));
check('window.MeetingBot exposes the documented methods', missingApi.length === 0, missingApi.join(','));
check('contract version is 2', /version:\s*2/.test(apiBlock));
const undocumented = API.filter((k) => control.indexOf('`' + k + '(') < 0);
check('CONTROL.md documents every method', undocumented.length === 0, undocumented.join(','));
const OPS = ['list', 'status', 'create', 'join', 'leave', 'end', 'record', 'transcribe', 'say', 'people', 'transcript', 'chat', 'recording', 'set_voice', 'interject', 'stop_speaking', 'raise_hand', 'set_mic', 'set_camera', 'meeting_state', 'snapshot', 'watch'];
const unhandled = OPS.filter((op) => app.indexOf("msg.op === '" + op + "'") < 0);
check('the bot answers every documented remote op', unhandled.length === 0, unhandled.join(','));
check('the app frame does not load the host voice engine', !/host-voice\.js/.test(html));
check('voice.js does not fetch', !/\bfetch\s*\(/.test(fs.readFileSync(path.join(APP, 'voice.js'), 'utf8')));
check('operator page is in the app', /id="ops"/.test(html) && /id="ops-stop"/.test(html) && /class="spark"/.test(html) && /id="ops-speak"/.test(html) && /Smartest/.test(html) && !/id="voice-grok"/.test(html));
const opsUndoc = OPS.filter((op) => control.indexOf('`' + op + '`') < 0);
check('CONTROL.md documents every remote op', opsUndoc.length === 0, opsUndoc.join(','));
check('CONTROL.md says how to reach the app frame', /#appmount iframe/.test(control) && /\?run=meeting-bot/.test(control));

const sandbox = {
  console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise, Uint8Array, TextEncoder,
  crypto, atob, btoa
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'protocol.js'), 'utf8'), sandbox, { filename: 'protocol.js' });
const P = sandbox.BotProto;
check('protocol loaded', !!(P && P.strength && P.derive && P.encode && P.decode));

const weak = P.strength('bot', 'bot');
check('bot/bot is rejected', weak.ok === false, weak.reason);
check('short password is rejected', P.strength('harbor-maple', 'short').ok === false);
check('name equal to password is rejected', P.strength('harbor-maple', 'harbor-maple').ok === false);
let suggestion = P.suggest();
let guard = 0;
while (!P.strength(suggestion.name, suggestion.password).ok && guard++ < 8) suggestion = P.suggest();
check('a generated suggestion passes', P.strength(suggestion.name, suggestion.password).ok === true, JSON.stringify(suggestion));

const plain = 'join https://gifos.app/run.html#v=abc';
check('free-text join is not a protocol message', P.decode(plain) === null && P.looksLikeCommand(plain));
const encoded = P.encode({ role: 'controller', op: 'list', id: 'q1' });
const decoded = P.decode(encoded);
check('structured list round-trips with an explicit role', decoded && decoded.role === 'controller' && decoded.op === 'list' && decoded.v === 1);
check('a message without a role is ignored', P.decode('gb1 {"v":1,"op":"list"}') === null);
check('duplicate warning text is fixed', P.DUP.indexOf('already running') > 0 && P.DUP.indexOf('pick something unique') > 0);

function voiceUnits() {
  const voiceBox = { console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise };
  voiceBox.window = voiceBox;
  voiceBox.globalThis = voiceBox;
  vm.createContext(voiceBox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'voice.js'), 'utf8'), voiceBox, { filename: 'voice.js' });
  const V = voiceBox.BotVoice;
  const KEY = 'sk-test-SECRET-key-9f3a';
  const pub = V.publicSettings({ respond_to_command: true, speak: true, listen: true });
  check('public settings name Smartest and carry no engine', pub.text_role === 'smartest' && pub.speak === true && pub.listen === true && !pub.llm && !pub.tts && !pub.conversation_voice);
  let bad = '';
  try { V.publicSettings({ conversation_voice: 'grok', llm: { url: 'https://api.x.ai/v1', key: KEY } }); } catch (e) { bad = e.message; }
  check('engine settings are rejected without the key', /GifOS AI settings/.test(bad) && bad.indexOf(KEY) < 0);
  check('a command addressed to the bot is not conversation', V.isCommand('hey bot, join', 'harbor') && !V.isConversation('hey bot, join', 'harbor'));
  check('a question is conversation', V.isConversation('What should we do next?', 'harbor'));
  check('scrub removes the key', V.scrub('failed ' + KEY, KEY) === 'failed [redacted]');

  const hostBox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise,
    TextDecoder, AbortController, Uint8Array
  };
  hostBox.window = hostBox;
  hostBox.globalThis = hostBox;
  vm.createContext(hostBox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'host-voice.js'), 'utf8'), hostBox, { filename: 'host-voice.js' });
  return hostVoiceCase(hostBox.HostVoice, KEY);
}

function hostVoiceCase(HostVoice, KEY) {
  const seen = [];
  let releaseSecond;
  const gate = new Promise(function (res) { releaseSecond = res; });
  let reads = 0;
  const first = 'data: {"choices":[{"delta":{"content":"Hello there. "}}]}\n\n';
  const second = 'data: {"choices":[{"delta":{"content":"More follows."}}]}\n\ndata: [DONE]\n';
  const fetchImpl = function (url, opts) {
    seen.push({ url: url, opts: opts, body: JSON.parse(opts.body) });
    return Promise.resolve({
      ok: true,
      body: {
        getReader: function () {
          return { read: function () {
            reads += 1;
            if (reads === 1) return Promise.resolve({ done: false, value: first });
            if (reads === 2) return gate.then(function () { return { done: false, value: second }; });
            return Promise.resolve({ done: true });
          } };
        }
      }
    });
  };
  const ttsCalls = [];
  const engine = HostVoice.create({
    fetch: fetchImpl,
    tts: function (req) {
      ttsCalls.push(req);
      if (ttsCalls.length === 1) releaseSecond();
      return Promise.resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
    },
    play: function () { return Promise.resolve(); }
  });
  const handed = engine.setVoice({
    respond_to_command: true,
    conversation_voice: 'local',
    llm: { url: 'http://127.0.0.1:9/v1', model: 'local-model', key: KEY },
    tts: { app: 'offline-tts-kokoro', voice: 'af_heart' },
    stt: { url: 'https://stt.example.test/v1' }
  });
  check('host public settings omit the key and the captions URL', JSON.stringify(handed).indexOf(KEY) < 0 && !handed.stt.url && handed.tts.voice === 'af_heart');
  return engine.converse('What should we do next?').then(function (spoken) {
    check('the chat body is only model, messages, and stream', JSON.stringify(Object.keys(seen[0].body).sort()) === JSON.stringify(['messages', 'model', 'stream']));
    check('the key is only the bearer token', seen[0].opts.headers.authorization === 'Bearer ' + KEY && JSON.stringify(seen[0].body).indexOf(KEY) < 0);
    check('the first clause is spoken before the stream ends', ttsCalls[0] && ttsCalls[0].text === 'Hello there.' && ttsCalls[0].engine === 'kokoro' && ttsCalls[0].voice === 'af_heart');
    check('the rest of the stream is spoken too', spoken.spoken === true && /More follows/.test(spoken.text));
    const boom = HostVoice.create({
      fetch: function () { return Promise.reject(new Error('nope ' + KEY)); },
      tts: function () { return Promise.resolve({}); },
      play: function () { return Promise.resolve(); }
    });
    boom.setVoice({ conversation_voice: 'local', llm: { url: 'http://127.0.0.1:9/v1', model: 'm', key: KEY }, tts: { engine: 'kokoro', voice: 'af_heart' } });
    return boom.converse('Hello?').then(function () { check('a model error is scrubbed', false); }, function (e) {
      check('a model error is scrubbed', e.message.indexOf(KEY) < 0 && /\[redacted\]/.test(e.message));
    });
  }).then(function () {
    let aborted = false;
    let mark;
    const started = new Promise(function (res) { mark = res; });
    const cut = HostVoice.create({
      fetch: function (url, opts) {
        mark();
        return new Promise(function (resolve, reject) {
          opts.signal.addEventListener('abort', function () {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
      tts: function () { return Promise.resolve({ bytes: new Uint8Array([1]) }); },
      play: function () { return Promise.resolve(); },
      stop: function () { aborted = true; return Promise.resolve(); }
    });
    cut.setVoice({ conversation_voice: 'local', llm: { url: 'http://127.0.0.1:9/v1', model: 'm', key: KEY }, tts: { engine: 'kokoro', voice: 'af_heart' } });
    const pending = cut.converse('Please say something now.');
    return started.then(function () { return cut.interject('Excuse me.'); }).then(function (cutIn) {
      return pending.then(function (first) {
        check('interject interrupts the bot', aborted && cutIn.spoken === true && first.stopped === true, JSON.stringify({ aborted: aborted, cutIn: cutIn, first: first }));
      });
    });
  });
}

function el(id) {
  const node = {
    id: id || '', textContent: '', className: '', hidden: false, value: '', checked: false, disabled: false,
    type: '', placeholder: '', dataset: {}, children: [], attrs: {}, style: {}, onclick: null, _html: ''
  };
  node.classList = {
    toggle: function (name, on) {
      const parts = String(node.className || '').split(/\s+/).filter(Boolean).filter(function (p) { return p !== name; });
      const has = String(node.className || '').split(/\s+/).indexOf(name) >= 0;
      const next = on == null ? !has : !!on;
      if (next) parts.push(name);
      node.className = parts.join(' ');
    }
  };
  node.appendChild = function (child) { node.children.push(child); return child; };
  node.setAttribute = function (k, v) { node.attrs[k] = String(v); };
  node.getAttribute = function (k) { return node.attrs[k]; };
  node.querySelector = function (sel) {
    if (sel === 'b') {
      const b = el('b');
      node.appendChild(b);
      return b;
    }
    return null;
  };
  Object.defineProperty(node, 'innerHTML', {
    get: function () { return node._html; },
    set: function (v) { node._html = String(v); node.children = []; }
  });
  return node;
}

function appCase() {
  const KEY = 'sk-test-SECRET-key-9f3a';
  const TTS = 'https://tts.example.test/speak';
  const STT = 'https://stt.example.test/v1';
  const ids = {};
  const made = [];
  ['warn', 'suggest', 'phase', 'log', 'ignored', 'rules', 'ops-meetings', 'ops-commands', 'ops-speak', 'ops-listen', 'ops-providers', 'ops-ear', 'ops-tail', 'ops-chat', 'ops-cmds', 'ops-errors', 'ops-stop', 'ops-ai', 'runbox', 'ctrl', 'rules-label', 'mode-control', 'mode-run', 'run-meetings', 'override', 'bot-name', 'bot-pass', 'fill', 'start', 'list-go', 'create-go', 'join-go', 'join-link', 'ctrl-meetings', 'xfer'].forEach(function (id) {
    ids[id] = el(id);
  });
  ids['mode-run'].checked = true;
  const body = el('body');
  const subs = { tr: [], pe: [], ch: [], xf: [] };
  const calls = { chat: [], voice: [], interject: [], speak: [], tts: [], aiChat: [], hand: [], mic: [], cam: [], joins: [], watch: [], cc: [], setup: [] };
  let n = 0;
  let held = null;
  const box = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise, Uint8Array, TextEncoder, TextDecoder,
    crypto, setTimeout: function (fn) { fn(); return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    document: {
      body: body,
      getElementById: function (id) {
        if (!ids[id]) return null;
        return ids[id];
      },
      createElement: function () {
        const node = el('');
        made.push(node);
        const orig = node;
        return orig;
      }
    }
  };
  box.document.getElementById = function (id) {
    if (ids[id]) return ids[id];
    for (let i = 0; i < made.length; i++) if (made[i].id === id) return made[i];
    return null;
  };
  box.window = box;
  box.globalThis = box;
  box.gifos = {
    launch: function () { return Promise.resolve(null); },
    db: function () { return { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; },
    ai: {
      models: function () { return Promise.resolve({ available: ['smartest', 'tts', 'stt'] }); },
      chat: function (req) { calls.aiChat.push(req); return Promise.resolve({ text: 'A short answer.' }); },
      tts: function (req) { calls.tts.push(req); return Promise.resolve({ bytes: new Uint8Array([9, 8, 7, 6]).buffer, mime: 'audio/wav' }); }
    },
    aiSetup: function (role) { calls.setup.push(role); return Promise.resolve(); },
    meet: {
      join: function (room, password, name, opts) {
        const id = 'mt_' + (++n);
        calls.joins.push({ id: id, opts: opts || {}, room: room });
        return Promise.resolve({ meetingId: id, room: String(room), link: 'https://gifos.app/run.html#v=' + room });
      },
      leave: function () { return Promise.resolve({}); },
      startRecording: function () { return Promise.resolve({ ok: true }); },
      stopRecording: function () { return Promise.resolve({ ok: true }); },
      getRecording: function () { return Promise.resolve({}); },
      sendChat: function (id, text) { calls.chat.push({ id: id, text: text }); return Promise.resolve({ ok: true }); },
      transcribe: function (id, on) { calls.cc.push([id, !!on]); return Promise.resolve({ ok: true, cc: !!on }); },
      sendXfer: function () { return Promise.resolve({}); },
      speak: function (id, audio) {
        calls.speak.push({ id: id, text: audio && audio.text, mime: audio && audio.mime, n: audio && audio.bytes && audio.bytes.byteLength });
        if (held) return new Promise(function (res) { held.res = res; held.id = id; held.text = audio && audio.text; });
        return Promise.resolve({ spoken: true, text: audio && audio.text });
      },
      watch: function (id, on) { calls.watch.push([id, !!on]); return Promise.resolve({ id: id, watch: !!on }); },
      interject: function (id, text) {
        calls.interject.push({ id: id, text: text });
        return Promise.resolve({ spoken: true, text: text });
      },
      converse: function () { return Promise.resolve({ spoken: true, text: 'A short answer.' }); },
      stopSpeaking: function () { return Promise.resolve({ stopped: true }); },
      raiseHand: function (id, on) { calls.hand.push([id, on]); return Promise.resolve({ ok: true }); },
      setMic: function (id, on) { calls.mic.push([id, on]); return Promise.resolve({ ok: true }); },
      setCamera: function (id, on) { calls.cam.push([id, on]); return Promise.resolve({ ok: true }); },
      onTranscriptLine: function (cb) { subs.tr.push(cb); },
      onParticipants: function (cb) { subs.pe.push(cb); },
      onChat: function (cb) { subs.ch.push(cb); },
      onXfer: function (cb) { subs.xf.push(cb); }
    }
  };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(APP, 'protocol.js'), 'utf8'), box, { filename: 'protocol.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'voice.js'), 'utf8'), box, { filename: 'voice.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), box, { filename: 'app.js' });
  const Bot = box.MeetingBot;
  check('MeetingBot version is 2 and still accepts 1', Bot.version === 2 && Bot.compatibleWith(1) && Bot.compatibleWith(2));
  return Bot.start({ mode: 'run', name: 'harbor-maple', password: suggestion.password, override: true, rules: 'roomcode' }).then(function (st) {
    check('run mode lists the joined meeting', st.phase === 'run' && st.connected && st.meetings.length === 1, JSON.stringify(st.meetings));
    const id = st.meetings[0].id;
    return Bot.setVoice({
      conversation_voice: 'local',
      llm: { url: 'https://api.x.ai/v1', model: 'grok-4.20-0309-non-reasoning', key: KEY },
      tts: { engine: 'http', url: TTS, voice: 'af_heart' },
      stt: { url: STT }
    }).then(function () {
      check('engine settings are refused', false);
    }, function (e) {
      const blob = e.message + JSON.stringify(Bot.status());
      check('engine settings are refused without the key or the URLs', /GifOS AI settings/.test(e.message) && blob.indexOf(KEY) < 0 && blob.indexOf(TTS) < 0 && blob.indexOf(STT) < 0);
    }).then(function () {
      return Bot.setVoice({ respond_to_command: true, speak: true, listen: true });
    }).then(function (pub) {
      const blob = JSON.stringify(pub) + JSON.stringify(Bot.status()) + ids['ops-providers'].textContent;
      check('setVoice uses Smartest and stores no key', pub.text_role === 'smartest' && pub.speak === true && pub.listen === true && pub.respond_to_command === true && !pub.llm && !pub.tts && blob.indexOf(KEY) < 0 && calls.cc.some(function (c) { return c[0] === id && c[1] === true; }), blob);
      return Bot.say(id, 'hello in chat');
    }).then(function (said) {
      check('say posts chat and does not speak', said.sent === true && calls.chat.some(function (c) { return c.text === 'hello in chat'; }) && calls.speak.length === 0 && calls.tts.length === 0);
      return Bot.chatFile(id).then(function (chat) {
        return Bot.transcript(id).then(function (spoken) {
          check('the bot chat is saved in the chat file', chat.lines.some(function (l) { return l.by === 'harbor-maple' && l.text === 'hello in chat'; }) && chat.text.indexOf('harbor-maple: hello in chat') >= 0 && chat.name.indexOf('chat-') === 0, JSON.stringify(chat.lines));
          check('chat is not a spoken line', !spoken.lines.some(function (l) { return l.text === 'hello in chat'; }));
        });
      }).then(function () {
        held = {};
        const pending = Bot.interject(id, 'Speaking now.');
        check('interject shows speaking', Bot.status().speaking === true && ids['ops-ear'].textContent === 'Speaking');
        return new Promise(function (res) { setTimeout(res, 0); }).then(function () {
          return Bot.stopSpeaking(id);
        }).then(function () {
          held.res({ spoken: true, text: 'Speaking now.' });
          return pending.then(function () { check('a stopped interject rejects', false); }, function (e) {
            check('a stopped interject rejects', e.message === 'Stopped.');
          });
        }).then(function () {
          held = null;
          return Bot.interject(id, 'Speaking now.');
        }).then(function (spoken) {
          check('interject speaks with GifOS speech and no URL', spoken.spoken === true && spoken.id === id && calls.tts.some(function (t) { return t.text === 'Speaking now.'; }) && calls.speak.some(function (s) { return s.text === 'Speaking now.' && s.mime === 'audio/wav' && s.n > 0; }) && calls.interject.length === 0 && JSON.stringify(calls.speak).indexOf('http') < 0);
          return Bot.transcript(id).then(function (spokenLines) {
            check('interject writes the bot into the transcript', spokenLines.lines.some(function (l) { return l.by === 'harbor-maple' && l.text === 'Speaking now.'; }), JSON.stringify(spokenLines.lines));
          const heard = [];
          const off = Bot.onTranscript(function (ev) { heard.push(ev); });
          subs.tr.forEach(function (cb) {
            cb({ meetingId: id, line: { by: 'harbor-maple', text: 'Speaking now.' } });
            cb({ meetingId: id, line: { by: 'Ada', text: 'Speaking now.' } });
            cb({ meetingId: id, line: { by: 'Ada', text: 'What should we do next?' } });
          });
          return Bot.transcript(id).then(function (t) {
            const botLines = t.lines.filter(function (l) { return l.text === 'Speaking now.'; });
            check('the bot voice is in the transcript once, attributed to the bot', botLines.length === 1 && botLines[0].by === 'harbor-maple' && t.lines.some(function (l) { return l.by === 'Ada' && l.text === 'What should we do next?'; }), JSON.stringify(t.lines));
            check('the transcript event fires for other people and not a second copy of the bot', heard.length === 1 && heard[0].by === 'Ada' && heard[0].text === 'What should we do next?');
            off();
          function allText(node) {
            let s = node && node.textContent || '';
            ((node && node.children) || []).forEach(function (c) { s += ' ' + allText(c); });
            return s;
          }
          const tail = allText(ids['ops-tail']);
            check('the operator tail shows the bot and Ada', tail.indexOf('Speaking now.') >= 0 && tail.indexOf('harbor-maple') >= 0 && tail.indexOf('Ada') >= 0 && tail.indexOf('What should we do next?') >= 0, tail);
            return Bot.chatFile(id).then(function (chat) {
              check('spoken lines stay out of the chat file', !chat.lines.some(function (l) { return l.text === 'Speaking now.' || l.text === 'What should we do next?'; }), JSON.stringify(chat.lines));
              return Bot.watch(id, true);
            }).then(function (eye) {
              check('watch opens the bot-eye tile', eye.watch === true && calls.watch.some(function (w) { return w[0] === id && w[1] === true; }));
              return Bot.raiseHand(id, true);
            }).then(function (hand) {
              return Bot.setMic(id, true).then(function (mic) {
                return Bot.setCamera(id, false).then(function () {
                  return Bot.meetingState(id).then(function (state) {
                    return Bot.snapshot(id).then(function (shot) {
                      check('hand, mic, and camera are reported', hand.hand === true && mic.mic === true && state.hand === true && state.mic === true && state.camera === false && shot.hand === true && shot.people);
                      const before = calls.hand.length + calls.mic.length + calls.cam.length + calls.speak.length;
                      return Bot.snapshot(id).then(function () {
                        check('snapshot does not change the room', calls.hand.length + calls.mic.length + calls.cam.length + calls.speak.length === before);
                        const admin = calls.joins.filter(function (j) { return j.opts && j.opts.bot && j.opts.control; })[0];
                        subs.ch.forEach(function (cb) {
                          cb({ meetingId: admin.id, control: true, text: box.BotProto.encode({
                            role: 'controller', op: 'set_voice', id: 'q-voice',
                            conversation_voice: 'grok', respond_to_command: false,
                            llm: { url: 'https://api.x.ai/v1', model: 'm', key: KEY },
                            tts: { engine: 'http', url: TTS }, stt: { url: STT }
                          }) });
                        });
                        return new Promise(function (res) { setTimeout(res, 20); });
                      });
                    });
                  });
                });
              });
            });
          });
          });
        });
      });
    });
  }).then(function () {
    const reply = calls.chat.map(function (c) { return c.text; }).join('\n');
    check('the admin reply refuses engine settings and does not echo the key', reply.indexOf(KEY) < 0 && reply.indexOf(TTS) < 0 && reply.indexOf(STT) < 0 && /GifOS AI settings/.test(reply));
    check('conversation asks Smartest', calls.aiChat.some(function (c) { return c.model === 'smartest'; }));
  });
}

P.derive('harbor-maple', suggestion.password).then(function (a) {
  return P.derive('harbor-maple', suggestion.password).then(function (b) {
    return P.derive('harbor-maple', suggestion.password + 'x').then(function (c) {
      check('KDF room is stable and 32 hex chars', a.room === b.room && /^[a-f0-9]{32}$/.test(a.room), a.room);
      check('KDF password is stable and not the room', a.password === b.password && a.password !== a.room && /^[a-f0-9]{32}$/.test(a.password));
      check('a different password derives a different room', c.room !== a.room);
      return voiceUnits().then(appCase).then(function () {
        console.log(failures ? ('\n' + failures + ' FAILURE(S)') : '\nALL PASS');
        process.exit(failures ? 1 : 0);
      });
    });
  });
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
