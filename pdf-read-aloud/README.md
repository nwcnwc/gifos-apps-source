# PDF Read Aloud

Open a PDF and hear it read aloud. Mozilla's **[pdf.js](https://github.com/mozilla/pdf.js)**
(Apache-2.0, the 2.16 legacy UMD build) draws the page. This directory is the
GifOS surface around it: the file lives in `gifos.db`, the reading position
comes back with it, and each sentence goes to the computer's Text → speech
voice. Nothing is uploaded.

The voice is not in this app. Install Offline TTS from the store and assign it
to Text → speech. If that voice is missing or it fails, the app says so. It
does not substitute another sound.

pdf-reader is the viewer. This app reads.

```
index.html      chrome, stage, transport
style.css       dark shell, white paper, phone layout
vendor/         pdf.js 2.16 legacy + Apache-2.0 notice (never fetched)
text.js         lines, headers, sentences, bite size
speak.js        one sentence ahead, no silent fallback
store.js        last file + sentence in the private save
view.js         open / render / highlight
boot.js         file, controls, voice, Back
sample.mjs      public-domain 2-page sample, packed as sample.js
icon.mjs        page-and-voice sticker + 1200×720 cover
build.mjs       packs site/apps/pdf-read-aloud/pdf-read-aloud.gif
```

## Why 2.16, not 4.x

4.x uses dynamic `import()`, and the app CSP has no `blob:` in `script-src`.
2.16 is classic scripts. The app runs it with **`isEvalSupported: false`** so
its `new Function`/`eval` fast-paths (which the CSP forbids) are never taken,
and hands pdf.js a **real `Worker` built from a `blob:` URL** as a fresh
`PDFWorker` **per open** — `worker-src blob:` is the `capabilities.wasm` hatch.
A singleton `GlobalWorkerOptions.workerPort` is not used: `pdf.destroy()`
leaves that port's `PDFWorker` destroyed, and `fromPort` hands the next
`getDocument` the dead instance. Setting only `workerSrc` would send pdf.js
down its fake-worker path, which injects a `<script src="blob:">` that
`script-src` refuses.

## Why sentences are short

A Text → speech provider returns one finished clip per call. A long call is a
long silence before the first sound. This app sends one sentence, and fetches
the next sentence while that clip plays. A sentence longer than 180 characters
is cut on a comma or a space.

## capabilities

| capability | why |
|---|---|
| `db` | Last file, page, sentence, and speed in a `private` collection. |
| `wasm` | Blob worker for pdf.js. No `.wasm` file; the hatch is the worker. |
| `ai: ["tts"]` | Asks the computer's Text → speech provider. The call is `gifos.ai.tts({ text, voice, speed })`. |

Needs nothing newer than the App Store itself, so `minBuild` is **947**.

## Building

```bash
node apps/pdf-read-aloud/build.mjs        # -> site/apps/pdf-read-aloud/pdf-read-aloud.gif
node apps/pdf-read-aloud/test.js
```

## Licence

Apache-2.0 for this app. pdf.js is Apache-2.0. The notice is packed **inside the GIF** as
`COPYING-pdfjs.txt` as well as living in `vendor/`.
