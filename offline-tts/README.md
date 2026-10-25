# Offline Text to Speech

The first **Provider app** (see `docs/providers.md`): it doesn't do a job on
its own screen — it gives the OS an ability. Installed and assigned in
**Settings → AI models**, it serves the **Text → speech** AI role to every
app on the computer via `gifos.provider.serve({ tts: … })`, entirely
offline: no network capability, no key, nothing leaves the device.

## How it's put together

- **Everything rides in the GIF** (~1.6 MB deflated), Chess Grandmaster's
  pattern: `build.mjs` packs `vendor/espeak.js` (the eSpeak core compiled to
  JS, from meSpeak/speak.js, pre-wrapped to `window.__ESpeak`) as an
  executable `engine.js`, and the config + en-us voice as JS string modules
  (`engine-data.js` / `voice-data.js`). No eval. The engine is plain asm.js,
  inlined like any other app file. It declares `capabilities.wasm` only so the
  runtime allows a blob worker: `run()` happens there, not on the main thread.
  The install-time **assets** pattern is deliberately NOT used: at 5.6 MB raw
  the engine sits well under the 8 MB floor `build-app-catalog.mjs`
  enforces — that pattern is reserved for genuinely huge public model
  weights (docs/providers.md).
- `app.js` is a compact driver derived from meSpeak's raw-WAV path
  (VFS setup → argstack → `run()` → read `wav.wav`). `run()` is one
  synchronous call, so the provider declares `capabilities.wasm` and does
  that call in a blob worker. The worker keeps a single eSpeak instance.
  Each call reuses that instance's static heap instead of allocating another,
  and the WAV samples are transferred out and dropped. Every 40 calls, or if
  the worker heap grows past its cap, the page terminates the worker and
  starts a fresh one. Requests still waiting are sent to the new worker.
  The main thread only forwards the request. One sentence is synthesized at
  a time, and the worker yields before each one.
- OpenAI-style voice names (`nova`, `onyx`, `whisper`, …) map onto eSpeak
  variants, so consumer apps written against a cloud TTS work unchanged.
  `speed` accepts the OpenAI 0.25–4 multiplier; returns 22.05 kHz mono WAV
  as `{ bytes, mime: 'audio/wav' }`.

The vendored engine source lives in `vendor/` (the app's source tree, like
chess-grandmaster's `sf-src.js` + `stockfish.wasm`); the committed GIF under
`site/apps/offline-tts/` is the built artifact.

## Licensing

eSpeak and the meSpeak/speak.js build are **GPLv3** (see
`COPYING-espeak.txt`), so this app is GPLv3 — the same posture as
Chess Grandmaster bundling Stockfish. Source lives in this directory and in
the staged assets; the engine files carry their original notices.

## Rebuild

```bash
node apps/offline-tts/build.mjs        # packs the slim GIF into site/apps/offline-tts/
node scripts/build-app-catalog.mjs      # refresh the store catalog
```

Sign with the rest of the catalog: `node scripts/sign-apps.mjs` (`GIFOS_SIGN_KEY`, not GitHub).
