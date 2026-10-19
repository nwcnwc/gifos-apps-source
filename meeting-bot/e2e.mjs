// Headless check: join a meeting, switch voice, and confirm say stays chat
// while interject speaks. Saves the operator page before and after.
// Needs Playwright: PLAYWRIGHT_DIR=<its folder> or a resolvable 'playwright'.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || 'playwright');
const read = (p) => readFileSync(join(dir, p), 'utf8');
const outDir = join(dir, 'e2e');
mkdirSync(outDir, { recursive: true });

const STUB = `
window.__calls = { chat: [], speak: [], tts: [] };
window.__release = null;
window.__gate = false;
window.gifos = (function () {
  var subs = { tr: [], pe: [], ch: [], xf: [] };
  var n = 0;
  return {
    launch: function () { return Promise.resolve(null); },
    db: function () { return { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; },
    ai: {
      models: function () { return Promise.resolve({ available: ['smartest', 'tts', 'stt'] }); },
      chat: function () { return Promise.resolve({ text: 'A short answer.' }); },
      tts: function (req) {
        window.__calls.tts.push(req && req.text);
        return Promise.resolve({ bytes: new Uint8Array([9, 8, 7, 6]).buffer, mime: 'audio/wav' });
      }
    },
    aiSetup: function () { return Promise.resolve(); },
    meet: {
      join: function (room) {
        var id = 'mt_' + (++n);
        var code = String(room).replace(/^.*v=/, '');
        setTimeout(function () {
          if (code === 'k3v9q2m8x4c7h1tz') {
            subs.pe.forEach(function (cb) { cb({ meetingId: id, people: [
              { id: 'b', name: 'Demo bot', bot: true, me: true },
              { id: 'a', name: 'Ada' }] }); });
          }
        }, 20);
        return Promise.resolve({ meetingId: id, room: code, link: 'https://gifos.app/run.html#v=' + code });
      },
      leave: function () { return Promise.resolve({}); },
      startRecording: function () { return Promise.resolve({ ok: true }); },
      stopRecording: function () { return Promise.resolve({ ok: true }); },
      getRecording: function () { return Promise.resolve({}); },
      sendChat: function (id, text) { window.__calls.chat.push(text); return Promise.resolve({ ok: true }); },
      transcribe: function () { return Promise.resolve({ ok: true }); },
      sendXfer: function () { return Promise.resolve({}); },
      speak: function (id, audio) {
        window.__calls.speak.push(audio && audio.text);
        if (window.__gate) return new Promise(function (res) { window.__release = function () { res({ spoken: true, text: audio && audio.text }); }; });
        return Promise.resolve({ spoken: true, text: audio && audio.text });
      },
      watch: function (id, on) { return Promise.resolve({ id: id, watch: !!on }); },
      stopSpeaking: function () { return Promise.resolve({ stopped: true }); },
      raiseHand: function () { return Promise.resolve({ ok: true }); },
      setMic: function () { return Promise.resolve({ ok: true }); },
      setCamera: function () { return Promise.resolve({ ok: true }); },
      onTranscriptLine: function (cb) { subs.tr.push(cb); },
      onParticipants: function (cb) { subs.pe.push(cb); },
      onChat: function (cb) { subs.ch.push(cb); },
      onXfer: function (cb) { subs.xf.push(cb); },
      _line: function (id, by, text) { subs.tr.forEach(function (cb) { cb({ meetingId: id, line: { by: by, text: text, at: Date.now() } }); }); }
    }
  };
})();
`;

const html = read('index.html')
  .replace('<script src="protocol.js"></script>', '<script>' + STUB + '</script><script>' + read('protocol.js') + '</script>')
  .replace('<script src="voice.js"></script>', '<script>' + read('voice.js') + '</script>')
  .replace('<script src="app.js"></script>', '<script>' + read('app.js') + '</script>');

const browser = await chromium.launch({ headless: true });
const fails = [];
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (extra && !ok ? '  ' + extra : ''));
  if (!ok) fails.push(name);
};
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.route('http://localhost/e2e', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://localhost/e2e');
  const started = await page.evaluate(async () => {
    const st = await window.MeetingBot.start({
      mode: 'run', name: 'demo-bot', password: 'quiet-cedar-42', override: true,
      rules: 'https://gifos.app/run.html#v=k3v9q2m8x4c7h1tz'
    });
    return st;
  });
  check('joined one work meeting', started.phase === 'run' && started.meetings.length === 1, JSON.stringify(started.meetings));
  const id = started.meetings[0].id;
  await page.waitForFunction(() => document.body.innerText.indexOf('Ada') >= 0);
  const before = await page.locator('#ops').screenshot();
  writeFileSync(join(outDir, 'status-before.png'), before);
  const beforeState = await page.evaluate(() => ({
    commands: document.getElementById('ops-commands').textContent,
    speak: document.getElementById('ops-speak').getAttribute('aria-pressed'),
    listen: document.getElementById('ops-listen').getAttribute('aria-pressed'),
    ear: document.getElementById('ops-ear').textContent
  }));
  check('status starts quiet with commands off', beforeState.commands === 'Off' && beforeState.speak === 'false' && beforeState.listen === 'false' && beforeState.ear === 'Quiet', JSON.stringify(beforeState));

  await page.evaluate(async () => {
    await window.MeetingBot.setVoice({ respond_to_command: true, speak: true, listen: true });
  });
  const said = await page.evaluate(async (mid) => window.MeetingBot.say(mid, 'hello in chat'), id);
  const chats = await page.evaluate(() => window.__calls.chat.filter((t) => t === 'hello in chat').length);
  const spokeEarly = await page.evaluate(() => window.__calls.speak.length + window.__calls.tts.length);
  check('say stays chat', said.sent === true && chats === 1 && spokeEarly === 0);

  await page.evaluate(() => { window.__gate = true; });
  const pending = page.evaluate(async (mid) => window.MeetingBot.interject(mid, 'Speaking now.'), id);
  await page.waitForFunction(() => document.getElementById('ops-ear').textContent === 'Speaking');
  const after = await page.locator('#ops').screenshot();
  writeFileSync(join(outDir, 'status-after.png'), after);
  const afterState = await page.evaluate(() => ({
    commands: document.getElementById('ops-commands').getAttribute('aria-pressed'),
    speak: document.getElementById('ops-speak').getAttribute('aria-pressed'),
    providers: document.getElementById('ops-providers').textContent,
    ear: document.getElementById('ops-ear').textContent,
    stop: document.getElementById('ops-stop').disabled
  }));
  check('status shows Smartest, commands on, and speaking', afterState.commands === 'true' && afterState.speak === 'true' && afterState.providers.indexOf('Smartest') >= 0 && afterState.ear === 'Speaking' && afterState.stop === false, JSON.stringify(afterState));
  await page.evaluate(() => { window.__release(); });
  const spoken = await pending;
  check('interject resolves spoken', spoken && spoken.spoken === true && spoken.id === id);

  await page.evaluate((mid) => {
    window.gifos.meet._line(mid, 'demo-bot', 'Speaking now.');
    window.gifos.meet._line(mid, 'Ada', 'What should we do next?');
  }, id);
  const tail = await page.locator('#ops-tail').innerText();
  const lines = await page.evaluate(async (mid) => (await window.MeetingBot.transcript(mid)).lines.map((l) => l.by + ': ' + l.text), id);
  check('the bot voice is in the transcript, attributed to the bot', lines.indexOf('demo-bot: Speaking now.') >= 0 && lines.filter((l) => l === 'demo-bot: Speaking now.').length === 1 && lines.indexOf('Ada: What should we do next?') >= 0, JSON.stringify(lines));
  check('the operator tail shows the bot and Ada', tail.indexOf('Speaking now.') >= 0 && tail.indexOf('demo-bot') >= 0 && tail.indexOf('Ada') >= 0, tail);

  const hostJs = readFileSync(join(process.env.GIFOS_APP || '/tmp/gifos-app', 'js/meet-host.js'), 'utf8');
  const sessionHtml = `<!doctype html><html><head><style>
    body { margin: 0; background: #101018; color: #eceef8; font: 14px/1.4 system-ui, sans-serif; }
    .room { padding: 12px; }
    .who { display: flex; gap: 8px; }
    .person { flex: 1; background: #1c1c2e; border-radius: 8px; padding: 10px; min-height: 78px; }
    .person b { display: block; }
    .cap { margin-top: 10px; color: #9ecbff; }
    #mic, #cam, #flipcam { margin: 8px 8px 0 0; min-height: 32px; }
    body.bot-eyes #mic, body.bot-eyes #cam, body.bot-eyes #flipcam { display: none !important; }
  </style></head><body>
    <div class="room">
      <div class="who">
        <div class="person"><b>Ada</b><span>speaking</span></div>
        <div class="person"><b>Demo bot</b><span>bot</span></div>
      </div>
      <div class="cap">Ada: What should we do next?</div>
      <button id="mic" type="button">Mic</button>
      <button id="cam" type="button">Camera</button>
      <button id="flipcam" type="button">Flip</button>
    </div>
    <script>
      window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || d.ns !== 'gifos-meet') return;
        if (d.op === 'join') {
          parent.postMessage({ ns: 'gifos-meet', op: 'joined', room: d.room || 'room', link: 'https://gifos.app/run.html#v=' + (d.room || 'room') }, '*');
        } else if (d.op === 'watch') {
          document.body.classList.toggle('bot-eyes', !!d.on);
          parent.postMessage({ ns: 'gifos-meet', op: 'result', ref: d.ref, result: { on: !!d.on } }, '*');
        } else if (d.ref) {
          parent.postMessage({ ns: 'gifos-meet', op: 'result', ref: d.ref, result: { ok: true } }, '*');
        }
      });
      parent.postMessage({ ns: 'gifos-meet', op: 'ready' }, '*');
    </script>
  </body></html>`;
  const hostPage = `<!doctype html><meta charset="utf-8"><title>GifOS</title>
    <style>body { margin: 0; background: #101018; color: #eceef8; font: 16px/1.45 system-ui, sans-serif; } main { padding: 28px; }</style>
    <body><main><h1>GifOS</h1><p>Meeting Bot is in the room. The tile is watch and listen only.</p></main>
    <script>${hostJs.replace(/<\/script/gi, '<\\/script')}</script></body>`;
  const eye = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await eye.route('http://127.0.0.1:8765/run.html', (route) => route.fulfill({ contentType: 'text/html', body: sessionHtml }));
  await eye.route('http://127.0.0.1:8765/host', (route) => route.fulfill({ contentType: 'text/html', body: hostPage }));
  await eye.goto('http://127.0.0.1:8765/host');
  const watched = await eye.evaluate(async () => {
    const joined = await window.GifOS.meetHost.join({ room: 'k3v9q2m8x4c7h1tz', name: 'Demo bot', bot: true });
    const tile = await window.GifOS.meetHost.watch(joined.meetingId, true);
    const box = document.querySelector('[data-gifos-bot-eye]');
    const frame = document.querySelector('iframe[data-gifos-meet]');
    const stage = box && box.lastElementChild;
    const stageBox = stage ? stage.getBoundingClientRect() : null;
    const frameBox = frame ? frame.getBoundingClientRect() : null;
    const covers = !!(stageBox && frameBox && Math.abs(stageBox.left - frameBox.left) < 2 && Math.abs(stageBox.top - frameBox.top) < 2 && Math.abs(stageBox.width - frameBox.width) < 2 && Math.abs(stageBox.height - frameBox.height) < 2 && frameBox.width > 200);
    return {
      watch: tile && tile.watch,
      title: box ? box.innerText : '',
      pointer: frame ? frame.style.pointerEvents : '',
      covers: covers
    };
  });
  check('the host opens one watch-only tile', watched.watch === true && watched.title.indexOf("Through the bot's eyes") >= 0 && watched.title.indexOf('Watch and listen only') >= 0 && watched.pointer === 'none' && watched.covers === true, JSON.stringify(watched));
  const child = eye.frames().find((f) => f !== eye.mainFrame());
  const micHidden = child ? await child.locator('#mic').isHidden() : false;
  const camHidden = child ? await child.locator('#cam').isHidden() : false;
  check('the tile has no microphone or camera for the person watching', micHidden && camHidden);
  const tileShot = await eye.locator('[data-gifos-bot-eye]').screenshot();
  writeFileSync(join(outDir, 'bot-eye.png'), tileShot);
  const pageShot = await eye.screenshot();
  writeFileSync(join(outDir, 'bot-eye-page.png'), pageShot);
  console.log('screenshots: ' + join(outDir, 'status-before.png') + ' ' + join(outDir, 'status-after.png') + ' ' + join(outDir, 'bot-eye.png'));
} finally {
  await browser.close();
}
if (fails.length) {
  console.log('\n' + fails.length + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nALL PASS');
