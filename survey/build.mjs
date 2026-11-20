// Pack survey/ into the site app file.
// Uses the same codec the GifOS desktop uses.
//
// Run:  node survey/build.mjs
import { surveyIcon, screenshotPng } from './icon.mjs';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

// Node 18's CompressionStream rejects 'deflate-raw'. Buffer and deflate at flush.
{
  const Orig = globalThis.CompressionStream;
  globalThis.CompressionStream = class CompressionStream {
    constructor(format) {
      if (format !== 'deflate-raw') {
        if (Orig) return new Orig(format);
        throw new TypeError('unsupported format ' + format);
      }
      const chunks = [];
      const ts = new TransformStream({
        transform(chunk) { chunks.push(Buffer.from(chunk)); },
        flush(controller) {
          controller.enqueue(new Uint8Array(deflateRawSync(Buffer.concat(chunks))));
        },
      });
      this.readable = ts.readable;
      this.writable = ts.writable;
    }
  };
}
await import('../../gifos-app/js/gifos-gif.js');

const dir = dirname(fileURLToPath(import.meta.url));
const gif = globalThis.GifOS.gif;
const read = (p) => readFileSync(join(dir, p), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const listing = JSON.parse(read('listing.json'));
const SCRIPTS = ['logic.js', 'app.js'];

const files = {
  'manifest.json': JSON.stringify(manifest),
  'index.html': read('index.html'),
  'style.css': read('style.css'),
  'logic.js': read('logic.js'),
  'app.js': read('app.js'),
};
{
  const help = read('help.md').trim();
  if (help.length < 400) throw new Error('help.md is missing or shorter than 400 chars');
  files['help.md'] = help;
}

const html = files['index.html'];
for (const s of SCRIPTS) {
  if (!html.includes('src="' + s + '"')) throw new Error('index.html does not load ' + s);
}
if (!html.includes('href="style.css"')) throw new Error('index.html does not load style.css');
if (/type=["']module["']/.test(html)) {
  throw new Error('index.html uses type=module — the runtime drops that, so the app would never boot.');
}
if (!manifest.capabilities || manifest.capabilities.db !== true || manifest.capabilities.multiplayer !== true) {
  throw new Error('manifest must declare capabilities.db and capabilities.multiplayer');
}
if (manifest.capabilities.wasm) throw new Error('do not declare wasm');
if (manifest.capabilities.network) throw new Error('survey has no network path');
if (manifest.capabilities.pointer) throw new Error('do not declare pointer');
if (manifest.capabilities.stage) throw new Error('do not declare stage');
if (!Number.isInteger(manifest.minBuild) || manifest.minBuild !== 947) throw new Error('minBuild must be 947');
if (manifest.appId !== 'survey') throw new Error('appId must be survey');
for (const name of ['survey', 'votes', 'presence']) {
  if (!manifest.data || !manifest.data[name] || manifest.data[name].visibility !== 'read-write') {
    throw new Error('manifest.data.' + name + ' must be read-write');
  }
}
const lead = manifest.lead || [];
if (lead.length !== 1 || lead[0].collection !== 'survey' || lead[0].id !== 'current') {
  throw new Error('lead must be the survey record only');
}
if (html.includes('id="invite"') || />\s*Invite\s*</.test(html)) {
  throw new Error('Invite is OS chrome — this app must not draw a share button');
}
if (!listing.author || listing.author.name !== 'GifOS') throw new Error('listing.author must be GifOS');
if (listing.basedOn) throw new Error('listing must not have basedOn — this is first-party');
if (listing.porter) throw new Error('listing must not have porter — this is first-party');
if (listing.license !== 'MIT') throw new Error('listing.license must be MIT');
if (!listing.categories || listing.categories[0] !== 'Productivity') throw new Error('listing.categories must start with Productivity');
for (const tag of ['survey', 'poll', 'vote', 'meeting', 'multiplayer', 'offline']) {
  if (!listing.tags || listing.tags.indexOf(tag) < 0) throw new Error('listing.tags must include ' + tag);
}
if (listing.releaseDate !== '2026-11-19') throw new Error('listing.releaseDate must be 2026-11-19');
if (listing.homepage !== 'https://github.com/nwcnwc/gifos-apps-source/tree/main/survey') {
  throw new Error('listing.homepage must be the survey tree');
}
if (listing.cover !== 'screenshot.png') throw new Error('listing.cover must be screenshot.png');
if (!listing.tagline || listing.tagline.length > 120) throw new Error('tagline is missing or over 120 chars');
for (const bad of ['gifos.db', 'WASM', 'sandbox', 'connect-src', 'gifos.fetch', 'CORS', 'COOP', 'Argon2', 'CDN', 'Node']) {
  if (JSON.stringify(listing).includes(bad)) throw new Error('listing.json mentions ' + bad + ' — keep it non-technical');
}
if (!html.includes('Start survey') && !files['app.js'].includes('Start survey')) {
  throw new Error('Start survey is missing');
}
if (!files['app.js'].includes('Save my answers') || !files['app.js'].includes('Anonymous votes')) {
  throw new Error('vote and anonymous controls are missing');
}
if (!files['app.js'].includes("gifos.db('survey')") || !files['app.js'].includes("gifos.db('votes')") || !files['app.js'].includes("gifos.db('presence')")) {
  throw new Error('app.js must open survey, votes and presence');
}
const banned = /\b(hasAdminRoom|amAdmin|isHost|openFloor|open-floor|adminRoom|canIRunApp)\b/;
if (banned.test(files['app.js']) || banned.test(files['logic.js'])) {
  throw new Error('the app must not decide who may create');
}
if (!/host is leading/i.test(files['app.js']) || !/read-only for guests/.test(files['app.js'])) {
  throw new Error('a refused write must say the host is leading');
}

for (const [n, s] of Object.entries(files)) {
  if (!n.endsWith('.js')) continue;
  if (/<\/script/i.test(s)) throw new Error(n + ' contains </script — cannot inline safely');
  if (/\btype\s*=\s*["']module["']/.test(s) || /^\s*import\s/m.test(s) || /export\s+\{/.test(s) || /export default/.test(s)) {
    throw new Error(n + ' uses ESM — the runtime drops type=module.');
  }
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'eval(', 'new Function(']) {
    if (s.includes(bad)) throw new Error(n + ' uses ' + bad);
  }
  if (/https?:\/\//.test(s)) throw new Error(n + ' loads a network URL');
}
if (/https?:\/\//.test(html) || html.includes('cdn.')) throw new Error('index.html must not load anything from the network');

{
  const ctx = { console };
  vm.runInNewContext(
    files['logic.js'] + '\nresult = (function () {\n' +
    '  var Q = SurveyLogic;\n' +
    '  var made = Q.svCreate(null, { title: "Friday", anonymous: false, questions: [\n' +
    '    { text: "Which day?", kind: "single", options: ["Monday", "Friday"], free: false }\n' +
    '  ] }, 1000);\n' +
    '  if (!made.ok || made.survey.v !== 1 || made.survey.epoch !== 1 || !made.survey.open) throw new Error("create");\n' +
    '  var vote = Q.svCast(made.survey, null, { id: "ada", name: "Ada" }, { q1: { picks: [1], text: "" } }, 2000);\n' +
    '  if (!vote.ok || vote.vote.id !== "v:ada" || vote.vote.name !== "Ada") throw new Error("vote");\n' +
    '  var two = Q.svCast(made.survey, null, { id: "ada", name: "Ada" }, { q1: { picks: [0, 1], text: "" } }, 2001);\n' +
    '  if (two.ok) throw new Error("single must refuse two picks");\n' +
    '  var tally = Q.svTally(made.survey, [vote.vote]);\n' +
    '  if (tally.people !== 1 || tally.questions[0].options[1].pct !== 100) throw new Error("tally");\n' +
    '  var closed = Q.svSetOpen(made.survey, false, 3000);\n' +
    '  if (!closed.ok || closed.survey.open || closed.survey.v !== 2 || closed.survey.epoch !== 1) throw new Error("close");\n' +
    '  if (Q.svCast(closed.survey, null, { id: "bo", name: "Bo" }, { q1: { picks: [1] } }, 3001).ok) throw new Error("closed vote");\n' +
    '  var anon = Q.svCreate(made.survey, { anonymous: true, questions: [{ text: "Which day?", options: ["Monday", "Friday"] }] }, 4000);\n' +
    '  var hidden = Q.svCast(anon.survey, null, { id: "ada", name: "Ada" }, { q1: { picks: [0] } }, 4001);\n' +
    '  if (!hidden.ok || hidden.vote.name !== "") throw new Error("anonymous name");\n' +
    '  var names = Q.svTally(anon.survey, [hidden.vote]);\n' +
    '  if (names.names.length || JSON.stringify(names).indexOf("Ada") >= 0) throw new Error("anonymous tally");\n' +
    '  return 1;\n' +
    '})();',
    ctx
  );
  if (ctx.result !== 1) throw new Error('logic self-test failed');
}

const shotPath = join(dir, 'screenshot.png');
if (!existsSync(shotPath) || process.env.SURVEY_SHOT === 'gen') {
  const shot = screenshotPng();
  if (shot[0] !== 0x89 || shot[1] !== 0x50) throw new Error('screenshot is not a PNG');
  writeFileSync(shotPath, shot);
  console.log('wrote survey/screenshot.png —', (shot.length / 1024).toFixed(0), 'KB (fallback)');
} else {
  console.log('keeping survey/screenshot.png');
}

const bytes = await gif.encode(files, { preview: surveyIcon(), accent: manifest.accent });
if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error('packed file is not a GIF');
const out = join(dir, '..', '..', 'gifos-app', 'apps', 'survey', 'survey.gif');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log('wrote apps/survey/survey.gif —', (bytes.length / 1024).toFixed(0), 'KB,', Object.keys(files).length, 'files');
console.log('catalog is owned elsewhere — do not run build-app-catalog.mjs from this tree');
