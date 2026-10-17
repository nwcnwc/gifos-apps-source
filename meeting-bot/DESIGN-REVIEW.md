# Meet Bot v2 — design review

Nathan's three corrections, answered from the published GifOS design. `nwcnwc/gifos` is not a visible repository (`gh repo view` and `git ls-remote` both return "Repository not found"). The design that is published lives in **gifos-app** (the files served at gifos.app; citations below are `origin/meet-bot` unless noted) and in **gifos-apps-source** (`meeting-bot/`). `docs/providers.md` is named by the runtime and by `llms.txt`, and it is not in the `meet-bot` tree.

What was built from this review, and what was not:

- Correction 1 is fixed in this app. A test was written first and failed, then the app was changed. The host-ops branch in gifos-app was **not** edited.
- Correction 2 is a proposal. `setVoice` still accepts `none` / `grok` / `local`, because that is the contract gifos-mcp already calls, and correction 3 says not to build more until Nathan picks.
- Correction 3 is the recommendation below. `cursor/meetbot-host-ops` was not merged and was not extended.

## How an app gets a system capability

Every capability is shown to the user and can be vetoed. Undeclared means unavailable, and the error names the missing declaration (`llms.txt` 160–174).

`capabilities.ai` is an array of **roles**, not `true`: `smartest`, `cheapest`, `tts`, `stt`, `image`, `image_to_video`, `video` (`llms.txt` 170–174; `js/gifos-perms.js` 107). The user wires each role in Settings → AI models: an OpenAI-compatible endpoint plus a key, **or** an installed Provider app. The app never sees a key and cannot tell the two apart (`llms.txt` 335–338). The stored record is `localStorage` key `gifos_ai_config` (`js/runtime.js` 1663; `js/gifos-perms.js` 128–130). A role is "set" when that record has a `url` or an `app` (`js/gifos-perms.js` 129–130, 456).

The app calls roles, never engines:

- `gifos.ai.models()` → `{ available: [...] }` (`llms.txt` 339; `js/runtime.js` 1739).
- `gifos.ai.chat({ model: 'smartest'|'cheapest', messages|prompt, onDelta })` (`llms.txt` 340–346). `model` is a role, never a model name (`llms.txt` 341).
- `gifos.ai.tts({ text, voice, format })` → `{ bytes, mime }` (`llms.txt` 349).
- `gifos.ai.stt({ bytes, mime, language })` → `{ text, raw }` (`llms.txt` 350).

`brokerAI` refuses a call unless the manifest declares `capabilities.ai` and the specific role (`js/runtime.js` 1734–1741). If the role is unset it shows the OS setup sheet and rejects `NOT_CONFIGURED:ai:<role>` (`js/runtime.js` 1743). The app raises that sheet itself with `gifos.aiSetup(role, hint)` (`js/runtime.js` 542). The host, not the app, talks to the endpoint. Paths are fixed: chat `/chat/completions`, tts `/audio/speech`, stt `/audio/transcriptions` (`js/runtime.js` 1664).

A Provider app is a different manifest. `"provides": { "ai": ["tts"] }` is not a capability (`llms.txt` 156, 599–608). It registers with `gifos.provider.serve({ tts, cheapest, stt })` (`llms.txt` 614–631). A provider may not declare `capabilities.network` or `capabilities.api` (`llms.txt` 633–636). `GifOS.providers.scan` / `assign` / `assigned` / `call` is the OS page's own surface, used by meeting captions; a store app reaches the same provider through `gifos.ai` (`js/runtime.js` 2046–2054).

The app frame cannot fetch. CSP is `connect-src 'none'`, and WebRTC is removed before app code runs (`llms.txt` 482–487; `js/runtime.js` 625–646). Meet Bot's manifest declares `meet`, `remote`, and `db` only (`meeting-bot/manifest.json`). It does not declare `capabilities.ai`, so `gifos.ai.*` would reject today.

`requires` can block launch until a capability is set up. The default is optional, so the app still opens (`llms.txt` 232–238).

## How a store app takes part in a meeting

A store app cannot hold a meeting. Its frame has no WebRTC, no network, and no workers. The host page already knows how. Each session is one ordinary `run.html` document in a same-origin iframe (`js/meet-host.js` 1–12).

`gifos.meet` is messages only. The runtime says: "The app never touches WebRTC: the host page runs each meeting and this object is only messages" (`js/runtime.js` 584–588). The permission sheet says the same thing in the user's words: meet is "Join meetings for you" — "The meeting stays here, on GifOS — the app never receives the camera, the microphone, or a network connection. A bot joins with no camera and a bot badge everyone can see" (`js/gifos-perms.js` 65, 81). Remote is "Take commands from a control meeting" (`js/gifos-perms.js` 65).

Dispatch refuses the call when the app did not declare meet, or the user turned it off. An op the host does not know returns "Unknown meet op." The published ops are `join`, `leave`, `startRecording`, `stopRecording`, `getRecording`, `sendChat`, `transcribe`, `sendXfer`, `list`, `setControl` (`js/runtime.js` 3486–3518).

The host creates a 2px iframe, opacity 0.02, `pointer-events: none`, `allow="microphone; autoplay"`, and fills it with `run.html` stamped `window.__gifosMb="1"` (`js/meet-host.js` 50–59, 26–36). The session protocol is `ns: gifos-meet`. When `params.mb === '1'`, `GifOS.meetSession.install` handles `join`, `leave`, `startRecording`, `stopRecording`, `getRecording`, `sendChat`, `transcribe`, and `sendXfer` by calling the same page functions a person uses: `bootIntoRoom`, `leaveMeeting`, `startRec`, `sendAll` for chat, and `syncSpeech` for captions (`run.html` 20511–20630).

`params.bot === '1'` sets `myStatus.bot`, camera off, muted, acquires a microphone track, and leaves every track disabled. The comment is explicit: "A bot has no camera and does not speak. … nothing from this computer's microphone is written down: the bot's transcript is the other people (scribe)" (`run.html` 10918–10933). A later guard says "A bot does not use a camera or speak" (`run.html` 18738).

The app does not click the Meet DOM. The app sandbox is `frame-src 'none'` (`js/runtime.js` 646), so it cannot frame the meeting, and the session iframe is owned by the host and is not a click target. The `agent` capability is a different thing: it injects an assistant bar that clicks **that one app's own screen** (`llms.txt` 224–228). There is no screen-capture capability (`llms.txt` 229–230).

So the published answer is: Meet Bot calls a sanctioned host API, and that API drives the real Meet page. It does not drive the DOM, and it does not run its own client.

## 1. The bot's own voice belongs in the transcript

Dropping it was wrong. A line the bot speaks is part of the meeting.

### What was wrong

`meeting-bot/app.js` treated three kinds of line as "not a transcript": marked self, bot, or me; `by` equal to the bot's name; or text matching one of the last 20 strings the bot spoke. Those lines were not stored and `onTranscript` was not called. `CONTROL.md` said the same thing (the section formerly titled "The bot's own voice"). `help.md` said the bot's own voice is left out.

`cursor/meetbot-host-ops` in gifos-app drops it a second time, before the app ever sees the caption:

- `js/meet-host.js` 105: a transcript event for which `suppressTranscript` is true is not forwarded.
- `js/meet-host.js` 183–201: `suppressBotLine` drops the bot's own microphone, and `suppressTranscript` drops self/bot/me and any line whose text matches the last 20 spoken strings.
- `test/unit/meet-host-ops.js` 5, 155–158, and 200 assert that drop ("the bot voice stays out of the transcript").

The meeting page's own rule is narrower and should stay: the scribe does not write down **this computer's microphone** (`run.html` 10919–10921). That is not the same as omitting the words the bot was asked to say.

### The fix, in this app

A test was added to `meeting-bot/test.js` that requires a successful `interject` to store `Speaking now.` under the bot's name, to keep that line once when the same words come back (including an echo credited to someone else), and to show both the bot and the other person on the operator tail. Against the old filter that test failed on three checks (`interject writes the bot into the transcript`, `the bot voice is in the transcript once`, `the operator tail shows the bot and Ada`). The event check already passed, because the listener is attached after `interject` and a dropped echo emits nothing.

`keepLine` now stores the line. When it is the bot's own voice, `by` is the bot's name. A repeat of the same text among the last 20 lines already credited to the bot is not stored again and is not announced again. `maybeReply` still returns immediately on the bot's own voice, so the bot does not answer itself. A successful `interject`, and a conversation reply that comes back with text, write the line at speak time. Chat from `say` is still chat, not a transcript line. `CONTROL.md` and `help.md` now say this.

Because the app records the line when speech succeeds, the transcript is right even while host-ops still swallows the caption echo. When both sides keep the line, the repeat check prevents a double.

### Proposed change on host-ops, not made

On `cursor/meetbot-host-ops`, stop returning at `js/meet-host.js` 105 for the bot's own spoken line. Forward it with `by` set to the bot's name. Keep dropping audio that is only this computer's open microphone (`suppressBotLine` when the speaker id is the bot's own mic and the text is not one of the lines the bot was asked to say). Flip the assertions in `test/unit/meet-host-ops.js` 5 and 200 the same way this app's test was flipped. Do not take that edit until Nathan accepts the architecture in section 3, because that branch is also the one that must not grow.

## 2. Voice choices must be GifOS capabilities

`none` / `grok` / `local`, and the `llm` / `tts` / `stt` objects that carry URLs, are the wrong shape. They name engines and endpoints. GifOS already has the settings, and an app is not supposed to see them.

### What the current contract does

`CONTROL.md` still documents `setVoice({ respond_to_command, conversation_voice: 'none'|'grok'|'local', llm, tts, stt })`. Local mode streams a chat URL from the host page (`host-voice.js`, packed but not loaded in the app frame) and speaks with Kokoro (`offline-tts-kokoro`, voice `af_heart`) or an HTTP stand-in. The key is not stored in the app, which is necessary, and it is not sufficient: the app is still choosing an engine and handing a raw URL to the host. The operator screen (`index.html`) offers three buttons, `voice-none`, `voice-grok`, and `voice-local`.

`cursor/meetbot-host-ops` goes further in the wrong direction. `hostFetch` calls whatever URL arrived (`js/meet-host.js` 203–206), and `kokoro` calls `GifOS.providers.call('tts')` with the app id `offline-tts-kokoro` and the voice `af_heart` hardcoded (`js/meet-host.js` 208–217). That bypasses `gifos.ai`, so the user's Settings → AI models assignment is not what speaks.

Grok Voice is not a `gifos.ai` role. The roles are the seven listed above. There is no `grok` role and no `none` role.

### Proposed `setVoice` and operator screen

Do not build this until Nathan answers the questions below. The shape to aim at:

```js
MeetingBot.setVoice({
  respond_to_command: true, // a command in the room is answered out loud
  speak: true,              // conversation uses gifos.ai.chat + gifos.ai.tts
  listen: true              // captions stay the meeting's Speech → text
})
```

- No `conversation_voice`. No `llm`, `tts`, or `stt` objects. No engine name, no URL, no key, in the call, in `status()`, or on screen.
- Speech text comes from `gifos.ai.chat({ model: '<role>' })`. Speech audio comes from `gifos.ai.tts({ text })`. The bytes, if the meeting must play them, cross the host as audio bytes on a thin "play this on the bot microphone" op. The host does not learn a URL.
- Listening stays the meeting transcribe path, which already uses the computer's Speech → text provider (`CONTROL.md`, "Transcripts need a speech-to-text provider"; `js/runtime.js` 2046–2054). `gifos.ai.stt` is the same role if a clip has to be sent explicitly. A captions URL is not a setting.
- The operator screen reads `gifos.ai.models()` and shows each declared role as set or not set. A button calls `gifos.aiSetup(role)` so the OS sheet is the only place a key is typed. The sparkle stays on that AI block. One filled primary button remains the run-mode action.
- The manifest gains `capabilities.ai` for the roles it will call. Launch stays possible without them unless Nathan wants them in `requires` (`llms.txt` 232–238). Until a role is set, that half of the bot is quiet and the screen says which Settings row is empty.

`interject` still speaks text it was given. It does not call the language model. It uses `gifos.ai.tts` for the audio, including when conversation speech is off.

The current `none` / `grok` / `local` methods stay in this branch until that redesign is chosen, so a connector that already calls them does not break in the meantime.

## 3. What Meet Bot is, and how it is supposed to join

It calls a sanctioned host API. That API drives the real Meet page (`run.html`) inside a host-owned session iframe. It does not drive the Meet UI at the DOM level, and it does not run its own client.

The three options Nathan named:

| | Drive the real Meet UI (DOM) | Sanctioned host API | Its own client |
|---|---|---|---|
| What it is | The bot clicks and types on the Meet page the way a person does. | `gifos.meet` postMessage. The host runs a real `run.html` and each op calls the same function the button calls. | A second, smaller WebRTC client, in the app or beside it. |
| Robustness | Poor. The session iframe is 2px, `pointer-events: none`, and not visible (`js/meet-host.js` 50–59). The app cannot see it: `frame-src 'none'` (`js/runtime.js` 646). Selectors break when Meet's markup changes. The `agent` bar clicks one app's own screen, not the OS page (`llms.txt` 224–228). | Good. Join, leave, record, chat, and transcribe already go through this path and call `bootIntoRoom`, `leaveMeeting`, `startRec`, `sendAll`, and `syncSpeech` (`run.html` 20517–20610). An unknown op fails closed (`js/runtime.js` 3518). | Poor. Signaling, the relay, the bot badge, the recording indicator, and the scribe would have to be reimplemented, and they would drift. The app frame cannot open a peer connection (`llms.txt` 484–486; `js/meet-host.js` 4–5). |
| Security | Poor. Reaching the OS page's DOM from the app is the boundary the sandbox is there to keep. There is no screen-capture capability on purpose (`llms.txt` 229–230). A DOM driver can click whatever is on the page, including controls the meet capability did not name. | Good. `capabilities.meet` is shown and can be vetoed (`js/gifos-perms.js` 65, 81; `js/runtime.js` 3488–3490). The app never receives the camera, the microphone, or a network connection. The bot tile has no camera and a badge everyone can see (`run.html` 10918–10924). A key stays in `gifos_ai_config` on the OS page (`js/runtime.js` 1663, 1758), not in the app. | Poor. A private client needs network and media the permission text says the app never gets. It can also omit the badge and the "transcribing" indicator, which the session path checks for (`run.html` 20602–20608). |
| Maintenance | Every Meet layout change is a bot change. Two UIs stay aligned only by accident. | One meeting implementation. A new action is a named op plus a call to a function that already exists. The published list is short, which is the point (`js/runtime.js` 3508–3518). | Two meeting implementations for as long as both exist. |

### Recommendation

Keep the sanctioned host API over the real `run.html` session. Do not have Meet Bot click the Meet DOM. Do not build a second WebRTC client.

New actions, if Nathan wants them, should be thin session ops that call the same functions the human buttons call, still gated by `capabilities.meet`. Raising a hand, unmuting, and playing audio bytes are that kind of op. Fetching an LLM URL, holding an API key, and choosing Kokoro by app id are not. Those belong to `gifos.ai` inside the app, as in section 2.

`cursor/meetbot-host-ops` (tip `7914474`) added `setVoice`, `interject`, `raiseHand`, and the rest (`js/runtime.js` 653–661 and 3658–3667) and it also drops the bot's transcript line and calls host-side URLs. That branch was not merged and was not extended. Leave it until Nathan picks.

## Questions

1. An echo credited to another person, whose text matches a line the bot just spoke, is rewritten to the bot and kept once. Should it instead stay under that person's name?
2. Should a chat `say` also appear in the transcript? This fix records spoken lines only.
3. For conversation, which text role: `cheapest`, `smartest`, or a choice among the roles `gifos.ai.models()` says are available?
4. Does Grok Voice remain a meeting-page feature, or does it disappear unless it is whatever the user assigned to Text → speech?
5. When the capability-shaped `setVoice` lands, should a call that still passes `llm` / `tts` / `stt` URLs be rejected, or ignored?
6. Is the sanctioned host API the join path to keep? If yes, are new session ops limited to "do what the Meet button does" (raise hand, unmute, play audio bytes that `gifos.ai.tts` already produced), with the host not calling a model and not holding a key?
7. Should Meet Bot declare `capabilities.ai` (and which roles), and should any of them be in `requires`, or should it still join a meeting with speech left quiet until Settings is filled in?
8. Is the 2px hidden session iframe the intended shape of a bot's meeting, or should the bot's meeting be the visible `run.html` a person watches?
