// Pack meeting-bot into ../gifos-app/apps/meeting-bot/meeting-bot.gif, the store's
// layout. Listing, signing and publishing are separate steps.
import { icon } from './icon.mjs';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
await import('../../gifos-app/js/gifos-gif.js');

const dir = dirname(fileURLToPath(import.meta.url));
const gif = globalThis.GifOS.gif;
const read = (p) => readFileSync(join(dir, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const listing = JSON.parse(read('listing.json'));

if (manifest.minBuild !== 2723) throw new Error('minBuild must be 2723');
if (manifest.appId !== 'meeting-bot') throw new Error('appId');
if (!manifest.capabilities || manifest.capabilities.meet !== true || manifest.capabilities.remote !== true) {
  throw new Error('manifest must declare capabilities.meet and capabilities.remote');
}
if (manifest.capabilities.network) throw new Error('meeting-bot has no network path');
if (!listing.tagline || !listing.description) throw new Error('listing');
const help = read('help.md');
if (help.length < 400) throw new Error('help.md is too short');
if (!/window\.MeetingBot/.test(read('CONTROL.md'))) throw new Error('CONTROL.md must document window.MeetingBot');
for (const src of ['app.js', 'protocol.js', 'index.html']) {
  const text = read(src);
  if (/\bfetch\s*\(/.test(text) || /WebSocket/.test(text) || /\beval\s*\(/.test(text)) throw new Error(src + ' reaches the network');
}

const files = {
  'manifest.json': JSON.stringify(manifest),
  'index.html': read('index.html'),
  'app.js': read('app.js'),
  'protocol.js': read('protocol.js'),
  'help.md': help,
  'CONTROL.md': read('CONTROL.md'),
  'listing.json': JSON.stringify(listing)
};
const bytes = await gif.encode(files, { preview: icon(), accent: manifest.accent });
const outDir = join(dir, '..', '..', 'gifos-app', 'apps', 'meeting-bot');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'meeting-bot.gif');
writeFileSync(out, Buffer.from(bytes));
if (bytes[0] !== 0x47 || bytes[1] !== 0x49) throw new Error('encode did not return a GIF');
console.log('wrote ' + out + ' (' + bytes.length + ' bytes)');
