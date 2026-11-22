/*
 * vendor.mjs — rebuild vendor/css-doodle.js and COPYING from the pinned
 * css-doodle@0.70.1 npm tarball (same commit as GitHub tag v0.70.1).
 *
 * This is the ONLY step that needs the network, and it is deliberately NOT
 * part of build.mjs: the App GIF must be buildable offline from what is
 * committed here. Run this only to move the pin.
 *
 *   node apps/css-doodle/vendor.mjs
 *
 * WHAT IT PRODUCES. The published classic IIFE that registers <css-doodle>
 * (esbuild+terser of src/index.js). GifOS inlines <script src> and DROPS
 * type="module", so the ESM source tree cannot ride in as-is.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const vendor = join(dir, 'vendor');
mkdirSync(vendor, { recursive: true });

// Moving the pin is a deliberate act: bump TAG + COMMIT + SHA256 together.
const TAG = '0.70.1';
const COMMIT = 'bd5d9106d29765feeea792d4f77d9ef25bbd035a';
const TARBALL = 'https://registry.npmjs.org/css-doodle/-/css-doodle-' + TAG + '.tgz';
const JS_SHA256 = 'caac6918c799de58f16138956080fa49d2b1da230ec714f128123d683b46fa31';
const LICENSE_SHA256 = '6a3bfd2b5099860379fa3d20f457f984f894c9bfd3d360e16ad8a961ea51c399';

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

const tmp = mkdtempSync(join(tmpdir(), 'css-doodle-'));
const tgz = join(tmp, 'css-doodle.tgz');

const res = await fetch(TARBALL);
if (!res.ok) throw new Error('download failed: ' + res.status + ' ' + TARBALL);
writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
execFileSync('tar', ['-xzf', tgz, '-C', tmp], { timeout: 30000 });

const jsBuf = readFileSync(join(tmp, 'package', 'css-doodle.min.js'));
const licBuf = readFileSync(join(tmp, 'package', 'LICENSE'));
const jsHex = sha256(jsBuf);
const licHex = sha256(licBuf);
if (jsHex !== JS_SHA256) {
  throw new Error('css-doodle.min.js sha256 ' + jsHex + ' ≠ pin ' + JS_SHA256 + ' — move the pin deliberately.');
}
if (licHex !== LICENSE_SHA256) {
  throw new Error('LICENSE sha256 ' + licHex + ' ≠ pin ' + LICENSE_SHA256 + ' — move the pin deliberately.');
}

const js = jsBuf.toString('utf8');
if (/<\/script/i.test(js)) throw new Error('css-doodle.min.js contains </script — cannot inline safely.');
if (!js.includes('customElements') || !js.includes('css-doodle')) {
  throw new Error('css-doodle.min.js does not register the css-doodle custom element.');
}
if (/^\s*import\s|export\{|import\.meta/m.test(js)) {
  throw new Error('css-doodle.min.js uses ESM — the classic-script inline path cannot carry it.');
}
if (!js.startsWith('/*! css-doodle v' + TAG)) {
  throw new Error('css-doodle.min.js banner is not v' + TAG);
}

writeFileSync(join(vendor, 'css-doodle.js'), jsBuf);
writeFileSync(join(vendor, 'COPYING-css-doodle.txt'), licBuf);
writeFileSync(join(vendor, 'UPSTREAM.txt'),
  'vendor/css-doodle.js is GENERATED. Do not edit it;\n' +
  'run node apps/css-doodle/vendor.mjs.\n\n' +
  'package: css-doodle@' + TAG + '\n' +
  'npm:     ' + TARBALL + '\n' +
  'commit:  ' + COMMIT + ' (GitHub tag v' + TAG + ')\n' +
  'sha256:  ' + JS_SHA256 + '\n' +
  'entry:   css-doodle.min.js — classic IIFE, defines <css-doodle>\n\n' +
  'The MIT notice travels beside it as COPYING-css-doodle.txt and is packed\n' +
  'into the GIF too, so a copy of this app that someone was handed still\n' +
  'carries the notice it is required to carry.\n\n' +
  'Google Fonts fetch in the upstream IIFE is dead in the GifOS sandbox\n' +
  '(connect-src none). Snippets shipped here never ask for a font.\n'
);

console.log('wrote vendor/css-doodle.js —', (jsBuf.length / 1024).toFixed(1), 'KB, css-doodle@' + TAG, '(' + COMMIT.slice(0, 10) + ')');
rmSync(tmp, { recursive: true, force: true });
