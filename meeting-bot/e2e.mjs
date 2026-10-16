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
window.__calls = { chat: [], interject: [] };
window.__release = null;
window.__gate = false;
window.gifos = (function () {
  var subs = { tr: [], pe: [], ch: [], xf: [] };
  var n = 0;
  return {
    launch: function () { return Promise.resolve(null); },
    db: function () { return { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; },
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
      setVoice: function () { return Promise.resolve({ ok: true }); },
      interject: function (id, text) {
        window.__calls.interject.push(text);
        if (window.__gate) return new Promise(function (res) { window.__release = function () { res({ spoken: true, text: text }); }; });
        return Promise.resolve({ spoken: true, text: text });
      },
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
    voice: document.getElementById('voice-none').getAttribute('aria-pressed'),
    ear: document.getElementById('ops-ear').textContent
  }));
  check('status starts quiet with commands off', beforeState.commands === 'Off' && beforeState.voice === 'true' && beforeState.ear === 'Quiet', JSON.stringify(beforeState));

  await page.evaluate(async () => {
    await window.MeetingBot.setVoice({ respond_to_command: true, conversation_voice: 'grok' });
  });
  const said = await page.evaluate(async (mid) => window.MeetingBot.say(mid, 'hello in chat'), id);
  const chats = await page.evaluate(() => window.__calls.chat.filter((t) => t === 'hello in chat').length);
  const spokeEarly = await page.evaluate(() => window.__calls.interject.length);
  check('say stays chat', said.sent === true && chats === 1 && spokeEarly === 0);

  await page.evaluate(() => { window.__gate = true; });
  const pending = page.evaluate(async (mid) => window.MeetingBot.interject(mid, 'Speaking now.'), id);
  await page.waitForFunction(() => document.getElementById('ops-ear').textContent === 'Speaking');
  const after = await page.locator('#ops').screenshot();
  writeFileSync(join(outDir, 'status-after.png'), after);
  const afterState = await page.evaluate(() => ({
    commands: document.getElementById('ops-commands').getAttribute('aria-pressed'),
    grok: document.getElementById('voice-grok').getAttribute('aria-pressed'),
    ear: document.getElementById('ops-ear').textContent,
    stop: document.getElementById('ops-stop').disabled
  }));
  check('status shows Grok, commands on, and speaking', afterState.commands === 'true' && afterState.grok === 'true' && afterState.ear === 'Speaking' && afterState.stop === false, JSON.stringify(afterState));
  await page.evaluate(() => { window.__release(); });
  const spoken = await pending;
  check('interject resolves spoken', spoken && spoken.spoken === true && spoken.id === id);

  await page.evaluate((mid) => {
    window.gifos.meet._line(mid, 'demo-bot', 'Speaking now.');
    window.gifos.meet._line(mid, 'Ada', 'What should we do next?');
  }, id);
  const tail = await page.locator('#ops-tail').innerText();
  const lines = await page.evaluate(async (mid) => (await window.MeetingBot.transcript(mid)).lines.map((l) => l.by + ': ' + l.text), id);
  check('the bot voice stays out of the transcript', lines.indexOf('demo-bot: Speaking now.') < 0 && lines.indexOf('Ada: What should we do next?') >= 0, JSON.stringify(lines));
  check('the operator tail shows Ada only', tail.indexOf('Speaking now.') < 0 && tail.indexOf('Ada') >= 0, tail);
  console.log('screenshots: ' + join(outDir, 'status-before.png') + ' ' + join(outDir, 'status-after.png'));
} finally {
  await browser.close();
}
if (fails.length) {
  console.log('\n' + fails.length + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nALL PASS');
