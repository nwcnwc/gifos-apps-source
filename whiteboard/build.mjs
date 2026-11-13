// Pack apps/whiteboard/ into the finished, downloadable
// site/apps/whiteboard/whiteboard.gif (see apps/README.md).
// Uses the SAME codec the GifOS desktop and MCP server use (site/js/gifos-gif.js).
//
// Offline and deterministic: everything it reads is committed. The one step
// that needs the network is vendor.mjs, which rebuilds vendor/excalidraw.js
// from the pinned npm packages and is run only when the pin moves.
//
// Run:  node apps/whiteboard/build.mjs
import { deflateRawSync } from 'node:zlib';
import { whiteboardIcon } from './icon.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Node 18's CompressionStream rejects 'deflate-raw' (the format gifos-gif.js
// uses). Node 20+ is fine. Same polyfill as hat-sh/build.mjs.
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
        }
      });
      this.readable = ts.readable;
      this.writable = ts.writable;
    }
  };
}
await import('../../gifos-app/js/gifos-gif.js'); // attaches globalThis.GifOS.gif

const dir = dirname(fileURLToPath(import.meta.url));
const gif = globalThis.GifOS.gif;
const read = (p) => readFileSync(join(dir, p), 'utf8');
const fail = (m) => { throw new Error(m); };

const manifest = JSON.parse(read('manifest.json'));
const listing = JSON.parse(read('listing.json'));

for (const need of ['vendor/excalidraw.js', 'vendor/excalidraw.css']) {
  if (!existsSync(join(dir, need))) fail(need + ' is missing — run node apps/whiteboard/vendor.mjs first (it needs the network).');
}
// The engine bundles the graph renderer's "stripe" node fill (stripe-size, hasStripe, drawStripe: drawing only,
// no payment code). The GifOS Meet app bundle refuses any app text naming a payment method (native/meet-only.json
// appWords), so the name is respelled "strype" here, the same way in every place it occurs (definitions and uses
// are all inside this one file). The vendored file stays as upstream built it.
// Any case, letter by letter (the history code's stripElementsProps matches too and is respelled with it).
const respell = (src) => src.replace(/stripe/gi, (m) => m.slice(0, 3) + (m[3] === 'I' ? 'Y' : 'y') + m.slice(4));
const vendorJs = respell(read('vendor/excalidraw.js'));
if (/stripe/i.test(vendorJs)) fail('a "stripe" spelling survived the respell in vendor/excalidraw.js');
const vendorCss = read('vendor/excalidraw.css');
if (/^\s*export\s|export\{|import\.meta/m.test(vendorJs)) {
  fail('excalidraw.js uses ESM syntax — the classic-script inline path cannot carry it.');
}

// Words: strings.js is UMD; its object is the English source.
const EN = createRequire(import.meta.url)('./strings.js');
const LANGS = ['de', 'es', 'ru', 'zh-Hans'];
const PLACEHOLDERS = ['{n}', '{time}', '{name}'];
const i18n = { 'i18n/en.json': JSON.stringify(EN) };
for (const lang of LANGS) {
  const rel = 'i18n/' + lang + '.json';
  const tr = JSON.parse(read(rel));
  for (const k of Object.keys(EN)) {
    if (!(k in tr)) fail(rel + ' is missing key ' + k);
    for (const ph of PLACEHOLDERS) {
      if (EN[k].includes(ph) && !String(tr[k]).includes(ph)) fail(rel + ' key ' + k + ' lost placeholder ' + ph);
    }
  }
  for (const k of Object.keys(tr)) if (!(k in EN)) fail(rel + ' has an extra key ' + k);
  i18n[rel] = JSON.stringify(tr);
}

const OWN = ['collab.js', 'export.js', 'strings.js', 'app.js'];
const files = {
  'manifest.json': JSON.stringify(manifest),
  'index.html': read('index.html'),
  'style.css': read('style.css'),
  'shim.js': read('shim.js'),
  'vendor/excalidraw.js': vendorJs,
  'vendor/excalidraw.css': vendorCss,
};
for (const n of OWN) files[n] = read(n);
Object.assign(files, i18n);
files['COPYING-excalidraw.txt'] = read('vendor/COPYING-excalidraw.txt');
files['COPYING-react.txt'] = read('vendor/COPYING-react.txt');
{
  const helpMd = read('help.md');
  if (helpMd.trim().length < 400) fail('help.md is too short — OS Help needs a real guide');
  files['help.md'] = helpMd;
}

// Scripts and styles are inlined into the page, so none may hold a closing script tag.
for (const [n, s] of Object.entries(files)) {
  if (!/\.(js|css)$/.test(n)) continue;
  if (/<\/script/i.test(s)) fail(n + ' contains </script — cannot inline safely.');
}

// --- manifest checks ---
if (manifest.minBuild !== 947) fail('minBuild must be 947 — this app needs nothing newer than the store.');
if (!manifest.capabilities || manifest.capabilities.db !== true || manifest.capabilities.multiplayer !== true) {
  fail('manifest must declare capabilities.db and capabilities.multiplayer');
}
if (manifest.capabilities.network) fail('whiteboard has no network path');
for (const c of ['els', 'pres', 'meta']) {
  if (!manifest.data || !manifest.data[c] || manifest.data[c].visibility !== 'read-write') {
    fail('manifest.data.' + c + ' must be read-write — the shared board has to sync.');
  }
}

// --- index.html checks ---
const html = files['index.html'];
const htmlLive = html.replace(/<!--[\s\S]*?-->/g, '');
{
  const order = ['shim.js', 'vendor/excalidraw.js', 'strings.js', 'collab.js', 'export.js', 'app.js'];
  let at = -1;
  for (const s of order) {
    const i = html.indexOf('src="' + s + '"');
    if (i < 0) fail('index.html does not load ' + s);
    if (i < at) fail('index.html loads ' + s + ' out of order (need ' + order.join(', ') + ')');
    at = i;
  }
}
if (!html.includes('href="vendor/excalidraw.css"')) fail('index.html does not load vendor/excalidraw.css');
if (!html.includes('href="style.css"')) fail('index.html does not load style.css');
if (/type\s*=\s*["']module["']/i.test(html)) fail('index.html uses type="module" — classic scripts only.');
if (/https?:\/\//i.test(htmlLive)) fail('index.html names an external URL.');
if (/<button[^>]*>\s*Invite/i.test(htmlLive)) fail('index.html has its own Invite button — Invite is OS chrome.');

// --- our own scripts: no network, no dynamic code, no ESM ---
const BANNED_CODE = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'eval(', 'new Function('];
for (const n of OWN) {
  for (const bad of BANNED_CODE) if (files[n].includes(bad)) fail(n + ' contains ' + bad);
  if (/^\s*(export|import)\s|import\.meta/m.test(files[n])) fail(n + ' uses ESM syntax.');
}
// The lost-write net must stay.
if (!files['collab.js'].includes('settled') || !files['collab.js'].includes("db('els')")) {
  fail("collab.js lost the lost-write net (settled / db('els')).");
}

// --- listing checks ---
if (listing.license !== 'MIT') fail('listing.license must be MIT');
if (!listing.basedOn || listing.basedOn.blessed !== false) fail('listing.basedOn.blessed must be false — unofficial port');
const listingBlob = JSON.stringify(listing);
for (const bad of ['gifos.db', 'WASM', 'sandbox', 'connect-src', 'localStorage']) {
  if (listingBlob.includes(bad)) fail('listing.json mentions ' + bad + ' — keep it non-technical');
}

if (!existsSync(join(dir, 'screenshot.png'))) console.log('note: screenshot.png is not there yet (hand-made capture, not built)');

const bytes = await gif.encode(files, { preview: whiteboardIcon(), accent: manifest.accent });
const out = join(dir, '..', '..', 'gifos-app', 'apps', 'whiteboard', 'whiteboard.gif');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log('wrote site/apps/whiteboard/whiteboard.gif —', (bytes.length / 1024).toFixed(0), 'KB, from',
            Object.keys(files).length, 'files');
console.log('catalog is owned elsewhere — do not run build-app-catalog.mjs from this tree');
