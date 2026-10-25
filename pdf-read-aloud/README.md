# Read Aloud

Read a PDF, pasted text, or a picture of text aloud. The file stays on this
device. Mozilla's **[pdf.js](https://github.com/mozilla/pdf.js)** (Apache-2.0,
the 2.16 legacy UMD build) draws a PDF page. A picture of text is read with
**[Tesseract.js](https://github.com/naptha/tesseract.js)** (Apache-2.0,
tesseract.js-core 7.0.0). This directory is the GifOS surface around them:
the file lives in the private save, the reading position comes back with it,
and each sentence goes to the computer's Text → speech voice. Nothing is uploaded.

The voice is not in this app. Install Offline TTS from the store and assign it
to Text → speech. If that voice is missing or it fails, the app says so. It
does not substitute another sound.

pdf-reader is the viewer. This app reads.

```
index.html      chrome, stage, paste box
style.css       dark shell, white paper, sentence mark, phone layout
vendor/         pdf.js 2.16 legacy, tesseract.js-core 7.0.0, notices
text.js         lines, headers, sentences, bite size, pasted text
speak.js        whole-document synthesis, memory guard, no silent fallback
store.js        last PDF, text, or picture, and the sentence
view.js         open / render / highlight a PDF
ocr.js          picture → text, blob worker, English asset pin
ocr-worker.js   Tesseract.js-core, instantiated from bytes
boot.js         file, paste, picture, voice, Back
sample.mjs      public-domain 2-page sample, packed as sample.js
icon.mjs        page-and-voice sticker + 1200×720 cover
build.mjs       packs site/apps/pdf-read-aloud/pdf-read-aloud.gif
LANG-PINS.json  sha256 pins for the engine and English
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
long silence before the first sound. This app sends one sentence. The first
sentence of a reading is cut shorter still, so the voice can start on the
first few words. A sentence longer than 180 characters is cut on a comma or
a space.

## Preparing ahead

Synthesis does not wait for playback. From the moment the text is ready, the
app asks for every remaining sentence, one call at a time, as soon as the
previous call returns. Later PDF pages are included as soon as their sentences
exist. Clips are decoded before they play. The line `#buffer` shows how many
sentences are prepared and how many of those sit ahead of the one you are on.

Each sentence is sent to the voice once (1.1.4). A decoded clip is placed on
the audio clock as soon as it is ready, at the end of the clip already
playing, so the next sentence does not wait for the main thread. While a
request is still
coming back or being decoded, Play, Pause, resume, Stop, and a jump wait for
the request already in flight. The sentence is sent again only if that request
failed, or when a different file, text, or picture replaces this one.

A memory guard holds this at 400 sentences or about 200 MB of audio. Past that,
synthesis waits until a played clip can be released.

**Pause** holds the audio only. Preparation keeps going, so **Play** continues
from the clip that is already decoded. **Stop** stops the audio and returns to
the first sentence without throwing those clips away. **Prev**, **Next**, and
a click move playback and leave the buffer in place.

**Stop preparing** is the control that halts synthesis. **Resume preparing**
continues from the sentence it had reached. Opening a different PDF, text, or
picture discards the old clips and starts over, unless preparing is off.

## capabilities

| capability | why |
|---|---|
| `db` | Last file, pasted text, picture, sentence, and speed in a `private` collection. |
| `wasm` | Blob workers for pdf.js and for Tesseract. The wasm engine is packed under `.assets/` and handed over by `gifos.assets()`. |
| `ai: ["tts"]` | Asks the computer's Text → speech provider. The call is `gifos.ai.tts({ text, voice, speed })`. |

English (`tessdata_best`, the same optional pin as Tesseract OCR) downloads the first time a picture is read, hash-verified by GifOS, then stays on this device. `minBuild` is **1381** because that is the build that can defer an optional asset pin.

## A picture of text

The page mints one blob worker from the vendored SIMD-LSTM glue plus `ocr-worker.js`. Wasm bytes and English data arrive as transferred buffers. The worker's `instantiateWasm` path is the one that runs. The app does not load a URL of its own.

## Building

```bash
node apps/pdf-read-aloud/build.mjs        # -> site/apps/pdf-read-aloud/pdf-read-aloud.gif
node apps/pdf-read-aloud/test.js
```

## Licence

Apache-2.0 for this app. pdf.js is Apache-2.0. Tesseract OCR, tesseract.js, and
tesseract.js-core are Apache-2.0. The notices are packed **inside the GIF** as
`COPYING-pdfjs.txt` and `COPYING-tesseract.txt`, and they live in `vendor/`.
