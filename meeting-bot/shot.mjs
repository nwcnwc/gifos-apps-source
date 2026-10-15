// Render screenshot.png (the store cover) from the real page with a stand-in
// gifos object: a RUN bot in two demo meetings, generic names only.
// Needs Playwright: PLAYWRIGHT_DIR=<dir with playwright> node meeting-bot/shot.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pwDir = process.env.PLAYWRIGHT_DIR || join(dir, '..', '..', 'gifos', 'node_modules', 'playwright');
const { chromium } = require(pwDir);

const read = (p) => readFileSync(join(dir, p), 'utf8');
const STUB = `
window.gifos = (function () {
  var subs = { tr: [], pe: [], ch: [], xf: [] };
  var n = 0;
  var rooms = { k3v9q2m8x4c7h1tz: 'Demo meeting', p8w2n6r4j9d3s5ya: 'Weekly sync' };
  function later(fn) { setTimeout(fn, 30); }
  return {
    launch: function () { return Promise.resolve(null); },
    db: function () { return { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); } }; },
    meet: {
      join: function (room) {
        var id = 'mt_' + (++n);
        var code = String(room).replace(/^.*v=/, '');
        later(function () {
          if (rooms[code]) {
            subs.pe.forEach(function (cb) { cb({ meetingId: id, people: [
              { id: 'b', name: 'Demo bot', bot: true, me: true },
              { id: 'a', name: 'Alice' }, { id: 'c', name: 'Bob' }] }); });
          }
        });
        return Promise.resolve({ meetingId: id, room: code, link: 'https://gifos.app/run.html#v=' + code });
      },
      leave: function () { return Promise.resolve({}); },
      startRecording: function () { return Promise.resolve({ ok: true }); },
      stopRecording: function () { return Promise.resolve({ ok: true }); },
      getRecording: function () { return Promise.resolve({}); },
      sendChat: function () { return Promise.resolve({ ok: true }); },
      transcribe: function () { return Promise.resolve({ ok: true }); },
      sendXfer: function () { return Promise.resolve({}); },
      onTranscriptLine: function (cb) { subs.tr.push(cb); },
      onParticipants: function (cb) { subs.pe.push(cb); },
      onChat: function (cb) { subs.ch.push(cb); },
      onXfer: function (cb) { subs.xf.push(cb); },
      _line: function (id, by, text) { subs.tr.forEach(function (cb) { cb({ meetingId: id, line: { by: by, text: text } }); }); }
    }
  };
})();
`;
const html = read('index.html')
  .replace('<script src="protocol.js"></script>', '<script>' + STUB + '</script><script>' + read('protocol.js') + '</script>')
  .replace('<script src="app.js"></script>', '<script>' + read('app.js') + '</script>');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // A localhost URL is a secure context, so crypto.subtle (the KDF) exists.
  await page.route('http://localhost/cover', (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://localhost/cover');
  await page.evaluate(async () => {
    const st = await window.MeetingBot.start({ mode: 'run', name: 'demo-bot', password: 'quiet-cedar-42', override: true,
      rules: 'https://gifos.app/run.html#v=k3v9q2m8x4c7h1tz\nhttps://gifos.app/run.html#v=p8w2n6r4j9d3s5ya' });
    const ids = st.meetings.map((m) => m.id);
    await window.MeetingBot.transcribe(ids[0], true);
    await window.MeetingBot.record(ids[0], true);
    await window.MeetingBot.transcribe(ids[1], true);
    window.gifos.meet._line(ids[0], 'Alice', 'Let us review the launch checklist.');
    window.gifos.meet._line(ids[0], 'Bob', 'The demo build is ready.');
    window.gifos.meet._line(ids[1], 'Alice', 'Notes from this week are in the shared folder.');
  });
  await page.waitForTimeout(300);
  const png = await page.screenshot({ fullPage: false });
  writeFileSync(join(dir, 'screenshot.png'), png);
  console.log('wrote ' + join(dir, 'screenshot.png') + ' (' + png.length + ' bytes)');
} finally {
  await browser.close();
}
