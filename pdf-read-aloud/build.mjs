// Pack pdf-read-aloud/ into site/apps/pdf-read-aloud/pdf-read-aloud.gif.
// pdf.js 2.16 legacy rides IN the GIF. The worker source becomes
// window.PDF_WORKER_SRC (app mints a blob: Worker). Sample PDF becomes
// window.SAMPLE_PDF_B64. Tesseract.js-core rides the same way: glue plus
// ocr-worker.js become window.OCR_WORKER_SRC, and the wasm is packed under
// .assets/tesseract-core.wasm. English is an optional asset pin.
// Same CompressionStream polyfill as PDF Reader.
import { pdfReadAloudIcon, screenshotPng } from './icon.mjs';
import { samplePdfBytes } from './sample.mjs';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// CI keeps the codec beside this checkout. A worktree looks next to the
// main repository, which is where the shared git directory lives.
function resolveCodec(appDir) {
  const conventional = join(appDir, '..', '..', 'gifos-app', 'js', 'gifos-gif.js');
  if (existsSync(conventional)) return conventional;
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: appDir, encoding: 'utf8' }).trim();
  let common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: appDir, encoding: 'utf8' }).trim();
  if (!isAbsolute(common)) common = join(top, common);
  const sibling = join(dirname(dirname(common)), 'gifos-app', 'js', 'gifos-gif.js');
  if (existsSync(sibling)) return sibling;
  throw new Error('gifos-gif.js was not found beside this repository');
}

const dir = dirname(fileURLToPath(import.meta.url));
const codec = resolveCodec(dir);
await import(pathToFileURL(codec).href);

const gif = globalThis.GifOS.gif;
const read = (p) => readFileSync(join(dir, p), 'utf8');
const bin = (p) => readFileSync(join(dir, p));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const PDF_SHA = '6c339beabbb74a9705608284b97155113bbefe1ce0011dc0bf3d25b8dc6b32ee';
const WORKER_SHA = '19bf7ed5cdfdbe980a68e5096bb20ab9862be8e65d9ae4f82ac18d2bcfacbb40';

const manifest = JSON.parse(read('manifest.json'));
const listing = JSON.parse(read('listing.json'));

for (const need of [
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'vendor/COPYING-pdfjs.txt', 'vendor/UPSTREAM.txt'
]) {
  if (!existsSync(join(dir, need))) throw new Error(need + ' is missing');
}

const pdfLib = read('vendor/pdf.min.js');
const pdfWorker = read('vendor/pdf.worker.min.js');
if (sha256(bin('vendor/pdf.min.js')) !== PDF_SHA) {
  throw new Error('vendor/pdf.min.js sha256 drifted from UPSTREAM.txt');
}
if (sha256(bin('vendor/pdf.worker.min.js')) !== WORKER_SHA) {
  throw new Error('vendor/pdf.worker.min.js sha256 drifted from UPSTREAM.txt');
}

const pins = JSON.parse(read('LANG-PINS.json'));
const glue = read('vendor/tesseract-core-simd-lstm.js');
const wasm = bin('vendor/tesseract-core-simd-lstm.wasm');
const gluePin = pins.core.files['tesseract-core-simd-lstm.js'];
const wasmPin = pins.core.files['tesseract-core-simd-lstm.wasm'];
if (!gluePin || !wasmPin) throw new Error('LANG-PINS.json is missing the core pin');
if (sha256(Buffer.from(glue)) !== gluePin.sha256) {
  throw new Error('vendor/tesseract-core-simd-lstm.js sha256 drifted from LANG-PINS.json');
}
if (sha256(wasm) !== wasmPin.sha256 || wasm.length !== wasmPin.bytes) {
  throw new Error('vendor/tesseract-core-simd-lstm.wasm drifted from LANG-PINS.json');
}
if (wasm.subarray(0, 4).toString() !== '\0asm') throw new Error('vendor wasm is not a WebAssembly module');
if (!glue.startsWith('var TesseractCore=')) throw new Error('glue no longer assigns var TesseractCore=');
if (!glue.includes('instantiateWasm')) throw new Error('glue lost instantiateWasm');
if (glue.includes('import.meta')) throw new Error('glue uses import.meta — cannot run as a classic worker');

const lang = (pins.langs || []).find((l) => l.asset === 'eng.traineddata');
if (!lang) throw new Error('LANG-PINS.json has no English pin');
const asset = (manifest.assets || []).find((a) => a.path === 'eng.traineddata');
if (!asset) throw new Error('manifest.json is missing the English asset pin');
if (asset.sha256 !== lang.sha256 || asset.bytes !== lang.bytes || asset.url !== lang.url) {
  throw new Error('English asset pin does not match LANG-PINS.json');
}
if (asset.optional !== true) throw new Error('eng.traineddata must be an optional asset pin');

if (manifest.minBuild !== 1381) throw new Error('minBuild must be 1381');
if (manifest.name !== 'Read Aloud' || manifest.shortName !== 'Read Aloud') {
  throw new Error('name and shortName must be Read Aloud');
}
if (manifest.appId !== 'pdf-read-aloud') throw new Error('appId must be pdf-read-aloud');
if (!manifest.capabilities || manifest.capabilities.db !== true) {
  throw new Error('manifest must declare capabilities.db');
}
if (!manifest.capabilities.wasm) throw new Error('manifest must declare capabilities.wasm — blob worker');
if (manifest.capabilities.network) throw new Error('pdf-read-aloud has no network path');
if (JSON.stringify(manifest.capabilities.ai) !== JSON.stringify(['tts'])) {
  throw new Error('capabilities.ai must be ["tts"]');
}
if (!manifest.data || !manifest.data.save || manifest.data.save.visibility !== 'private') {
  throw new Error('save must be private');
}

// GifOS's own app: pdf.js is a packed-in engine, credited in the description,
// not a work this app ports.
if (listing.author !== 'GifOS') throw new Error('author is GifOS');
if (listing.basedOn || listing.porter) throw new Error('not a port: no basedOn or porter');
if (!/pdf\.js/.test(listing.description)) throw new Error('the description credits pdf.js');
if (listing.license !== 'Apache-2.0') throw new Error('listing.license must be Apache-2.0');
if (listing.homepage !== 'https://github.com/nwcnwc/gifos-apps-source/tree/main/pdf-read-aloud') {
  throw new Error('listing.homepage must be the gifos tree');
}
const listingBlob = JSON.stringify(listing);
for (const bad of ['gifos.db', 'WASM', 'sandbox', 'connect-src', 'localStorage', 'WebRTC']) {
  if (listingBlob.includes(bad)) throw new Error('listing.json mentions ' + bad);
}
if (/\bDrop\b/.test(listing.tagline) || /\bDrop\b/.test(listing.description)) {
  throw new Error('listing copy: say Open, not Drop');
}
if (!/pasted text/.test(listing.tagline) || !/image of text/.test(listing.tagline)) {
  throw new Error('tagline must say pasted text and an image of text');
}
for (const tag of ['pdf', 'ocr', 'text']) {
  if (!listing.tags || listing.tags.indexOf(tag) < 0) throw new Error('listing.tags must include ' + tag);
}

const sample = samplePdfBytes();
if (sample.subarray(0, 5).toString() !== '%PDF-') throw new Error('sample PDF is not a PDF');
if (sample.length < 800) throw new Error('sample PDF is too small');
{
  const latin = sample.toString('latin1');
  for (const needle of ['A page, read aloud', 'Where the voice comes from', '%%EOF', '0 0 0 rg', '%PDF-1.4']) {
    if (!latin.includes(needle)) throw new Error('sample PDF missing “' + needle + '”');
  }
}
writeFileSync(join(dir, 'sample.pdf'), sample);

const workerJs = ('window.PDF_WORKER_SRC=' + JSON.stringify(pdfWorker) + ';').split('</').join('<\\/');
const sampleJs = 'window.SAMPLE_PDF_B64=' + JSON.stringify(sample.toString('base64')) + ';';
const workerBody = read('ocr-worker.js');
const workerBundle = glue + '\n' + workerBody;
if (/<\/script/i.test(workerBundle)) throw new Error('ocr worker bundle contains </script');
const ocrWorkerJs = ('window.OCR_WORKER_SRC=' + JSON.stringify(workerBundle) + ';').split('</').join('<\\/');

const SCRIPTS = [
  'vendor/pdf.min.js', 'pdf-worker.js', 'ocr-worker.js', 'sample.js',
  'text.js', 'speak.js', 'store.js', 'view.js', 'ocr.js', 'boot.js'
];

const files = {
  'manifest.json': JSON.stringify(manifest),
  'index.html': read('index.html'),
  'style.css': read('style.css'),
  'vendor/pdf.min.js': pdfLib,
  'pdf-worker.js': workerJs,
  'ocr-worker.js': ocrWorkerJs,
  'sample.js': sampleJs,
  'text.js': read('text.js'),
  'speak.js': read('speak.js'),
  'store.js': read('store.js'),
  'view.js': read('view.js'),
  'ocr.js': read('ocr.js'),
  'boot.js': read('boot.js'),
  'COPYING-pdfjs.txt': read('vendor/COPYING-pdfjs.txt'),
  'COPYING-tesseract.txt': read('vendor/COPYING-tesseract.txt'),
  'UPSTREAM.txt': read('vendor/UPSTREAM.txt'),
  'UPSTREAM-tesseract.txt': read('vendor/UPSTREAM-tesseract.txt'),
  '.assets/tesseract-core.wasm': wasm,
  'sample.pdf': sample,
};

{
  const helpMd = read('help.md').trim();
  if (helpMd.length < 400) throw new Error('help.md is missing or too short (' + helpMd.length + ')');
  files['help.md'] = helpMd;
}

const html = files['index.html'];
for (const s of SCRIPTS) {
  if (!html.includes('src="' + s + '"')) throw new Error('index.html does not load ' + s);
}
if (!html.includes('href="style.css"')) throw new Error('index.html does not load style.css');
if (!html.includes('<title>Read Aloud</title>')) throw new Error('title must be Read Aloud');
if (!html.includes('>Read Aloud<')) throw new Error('heading must be Read Aloud');
if (/type=["']module["']/.test(html)) throw new Error('classic scripts only — no type=module');
if (/https?:\/\//i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) {
  throw new Error('index.html has an external URL');
}
if (/<button\b[^>]*>\s*Invite\s*</i.test(html) || /<button\b[^>]*id=["'][^"']*invite/i.test(html)) {
  throw new Error('do not draw an Invite button — that is OS chrome');
}
if (!files['boot.js'].includes('onBack')) throw new Error('boot.js must register gifos.onBack');
if (!files['boot.js'].includes("db('save')")) throw new Error('boot.js must open the private save');
if (!files['boot.js'].includes('gifos.ai.tts')) throw new Error('boot.js must call gifos.ai.tts');
if (!files['store.js'].includes("id: 'last'")) throw new Error('store.js must save the last file');
if (!files['speak.js'].includes('Offline TTS')) throw new Error('speak.js must name Offline TTS when the voice fails');
if (!files['view.js'].includes('isEvalSupported: false')) {
  throw new Error('view.js must disable pdf.js eval');
}
if (files['view.js'].includes('GlobalWorkerOptions.workerPort')) {
  throw new Error('do not reuse GlobalWorkerOptions.workerPort — a second open hangs');
}
if (!files['view.js'].includes('PDFWorker') || !files['view.js'].includes('mintWorker')) {
  throw new Error('view.js must mint a fresh PDFWorker per open');
}
if (!files['ocr.js'].includes('gifos.assets')) throw new Error('ocr.js must call gifos.assets');
if (!files['ocr.js'].includes('eng.traineddata')) throw new Error('ocr.js must ask for eng.traineddata');
if (!files['ocr.js'].includes('tesseract-core.wasm')) throw new Error('ocr.js must ask for tesseract-core.wasm');
if (!files['ocr.js'].includes('OCR_WORKER_SRC')) throw new Error('ocr.js must mint the blob worker');
if (!files['boot.js'].includes('Reading text from image…')) throw new Error('boot.js must show image progress');
if (!files['boot.js'].includes('plainToSentences')) throw new Error('boot.js must split pasted text with text.js');
if (!files['text.js'].includes('plainToSentences')) throw new Error('text.js must split pasted text');
if (!files['COPYING-tesseract.txt'].includes('Apache License')) {
  throw new Error('COPYING-tesseract.txt is not the Apache-2.0 notice');
}
const codeLines = (s) => s.split('\n').filter((l) => {
  const t = l.trim();
  return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
}).join('\n');
for (const [n, s] of [['ocr.js', codeLines(files['ocr.js'])], ['ocr-worker.js', codeLines(workerBody)]]) {
  for (const bad of ['new Function(', 'eval(', 'XMLHttpRequest', 'importScripts(', 'fetch(']) {
    if (s.includes(bad)) throw new Error(n + ' uses ' + bad);
  }
}

for (const [n, s] of Object.entries(files)) {
  if (typeof s !== 'string' || !n.endsWith('.js')) continue;
  if (/<\/script/i.test(s) && n !== 'pdf-worker.js') {
    throw new Error(n + ' contains </script — cannot inline safely');
  }
  if (n === 'vendor/pdf.min.js' || n === 'pdf-worker.js' || n === 'ocr-worker.js' || n === 'sample.js') continue;
  if (/^\s*export\s|export\{|import\.meta/m.test(s) || /^\s*import\s/m.test(s)) {
    throw new Error(n + ' uses ESM syntax — the classic-script inline path cannot carry it.');
  }
  for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'eval(', 'new Function(', 'speechSynthesis']) {
    if (s.includes(bad)) throw new Error(n + ' uses ' + bad);
  }
}
if (!files['COPYING-pdfjs.txt'].includes('Apache License')) {
  throw new Error('COPYING-pdfjs.txt is not the Apache-2.0 notice');
}

const shot = screenshotPng();
if (shot[0] !== 0x89 || shot[1] !== 0x50) throw new Error('screenshot is not a PNG');
writeFileSync(join(dir, 'screenshot.png'), shot);

const bytes = await gif.encode(files, { preview: pdfReadAloudIcon(), accent: manifest.accent });
const out = join(dirname(codec), '..', 'apps', 'pdf-read-aloud', 'pdf-read-aloud.gif');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log('wrote site/apps/pdf-read-aloud/pdf-read-aloud.gif —', (bytes.length / 1024).toFixed(0), 'KB, from',
            Object.keys(files).length, 'files');
console.log('catalog is owned elsewhere — do not run build-app-catalog.mjs from this tree');
