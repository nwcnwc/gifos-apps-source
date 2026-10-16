# Meeting Bot control surface

This is the contract for software that drives Meeting Bot, for example a connector running a headless browser. Contract version: `window.MeetingBot.version === 2`. Version 1 callers keep working: `compatibleWith(1)` is true, and every version 1 method keeps its name and its result. The app needs a GifOS build that has `capabilities.meet` (minBuild 2723, release 0.9.23).

There are three ways in:

1. **Local API.** Call `window.MeetingBot` inside the app frame on the computer that runs the bot. Use this from an automated browser.
2. **Launch link.** `/?run=meeting-bot&go.…` opens the app pre-filled and can start it.
3. **Remote protocol.** Structured chat in the secret admin meeting. The CONTROL screen uses it, from any other device.

## 1. Install and open the app in a headless browser

From the store:
1. Open `<origin>/store.html`.
2. In the card titled **Meeting Bot**, press **Install**. The card then says **Open**.
3. The app is now an icon on the Home Screen (`<origin>/index.html`). Double-click it. It opens in a new tab, at `run.html#id=<fileId>`.

From a link, with no store page:
- `<origin>/?run=meeting-bot` downloads `/apps/meeting-bot/meeting-bot.gif`, saves it under Stolen Apps, and opens it.

The first launch shows the Abilities sheet (`.perm-box`) with **Join meetings for you** (`input[data-cap="meet"]`) and **Take commands from a control meeting** (`input[data-cap="remote"]`). Leave both checked and press `.perm-box .done`. A person can switch them off later under **Abilities** (`#appperms`). Every call then fails with "turned Meet off".

The app runs in `#appmount iframe`, a sandboxed srcdoc frame. Its content security policy is `connect-src 'none'`. The frame must not call `fetch`. With Playwright:

```js
const el = await page.waitForSelector('#appmount iframe');
const app = await el.contentFrame();
await app.waitForFunction(() => window.MeetingBot && window.MeetingBot.version >= 1);
```

Version 2 is `window.MeetingBot.version === 2`.

### Transcripts need a speech-to-text provider

The bot writes down what it hears with the computer's **Speech → text** provider. For example, install **Offline STT Whisper** from the store and assign it to Speech → text in Settings. Transcript lines come only from that provider, unless a voice setting names a captions stand-in for the host page. The bot does not send audio anywhere else from the app frame.

## 2. Local API: `window.MeetingBot`

Every method returns a Promise, except `status`, which is synchronous. A failure rejects with an `Error` whose message is meant for people. `start`, `status`, `setVoice`, and `onTranscript` work before RUN mode. Every other method rejects with "The bot is not running" until `start({ mode: "run", name, password })` has connected.

| Method | Resolves with | Notes |
|---|---|---|
| `start({ mode, name, password, override?, rules? })` | `status()` | `mode` is `'run'` or `'control'`. A weak name and password pair rejects, for example "Password needs at least 10 characters." If a bot with this pair is already running, it rejects with the duplicate warning unless `override: true`. `rules` is the auto-join list, one link per line. RUN takes about 5 s, because it first listens for a running duplicate. |
| `status()` | `{ phase, connected, name, meetings, warning }` | Synchronous. `phase` is `'idle'`, `'probe'`, `'run'` or `'control'`. `connected` turns true once the admin meeting is joined. Wait for it before you send commands. In CONTROL, `meetings` is the last list the bot reported. Version 2 adds `respond_to_command`, `conversation_voice`, `speaking`, and `listening`. It may add `llm` as `{ url, model }`, `tts` as `{ engine, app?, voice? }`, and `stt` as `{ configured: true }`. It never includes `llm.key`, `tts.url`, or `stt.url`. |
| `create()` | `{ id, room, link }` | Hosts a new meeting with an unguessable 16-character room code. `link` is the invite to give people. |
| `join(link, password?)` | `{ id, room, link }` | `link` is a meeting link or a room code. `password` is the room password, if it has one. |
| `list()` | `[{ id, room, link, rec, cc, created, people, hand, mic, camera }]` | The work meetings, without the admin meeting. `people` holds the names of everyone except the bot. The hand, microphone, and camera flags are the last ones this bot set. |
| `people(id)` | `[{ id, name, bot, me }]` | Who is in the meeting now. `me` is the bot itself. |
| `transcribe(id, on)` | `{ id, cc }` | Turns writing everyone down on or off. Everyone sees 📝 transcribing on the bot's tile. If that indicator cannot be shown, the call rejects. The bot writes down each person who is unmuted, credited to that person. People join muted, so a person has to unmute to be written down. The bot never writes down its own computer's microphone. A line it spoke is written down separately, credited to the bot. |
| `record(id, on)` | `{ id, rec }` | Turns recording on or off. Everyone sees ⏺ recording on the bot's tile. |
| `say(id, text)` | `{ id, sent: true }` | Posts one chat message into the meeting, up to 2000 characters. This is chat. It does not speak. |
| `transcript(id)` | `{ id, lines: [{ by, text, at }], text }` | Every kept line so far. `text` has one `Name: words` line per entry. `at` is ms since epoch. A line the bot spoke is in this list, with `by` set to the bot's name. |
| `recording(id)` | `{ id, name, mime, bytes }` | Stops recording if it is on, then returns the file (`bytes` is an ArrayBuffer, usually `video/webm`). |
| `leave(id)` / `end(id)` | `{ id, left: true }` | The bot leaves the meeting. |
| `setVoice(settings)` | the public settings | See below. Works before RUN. Rejects an unknown `conversation_voice`. The resolved value and `status()` omit `llm.key`, `tts.url`, and `stt.url`. |
| `interject(id, text)` | `{ id, spoken: true }` | Speaks now, through the bot, and interrupts the bot's own speech. Up to 2000 characters. This is not chat. It does not fall back to `say`. Rejects when the meeting page cannot play the bot. |
| `stopSpeaking(id?)` | `{ id, stopped: true }` or `{ stopped: true }` | Stops the bot's current speech. An in-flight `interject` then rejects with "Stopped." |
| `raiseHand(id, on)` | `{ id, hand }` | Raises the bot's hand when `on` is true, and lowers it when `on` is false. Rejects when the meeting page cannot. |
| `setMic(id, on)` | `{ id, mic }` | Unmutes the bot's microphone when `on` is true, and mutes it when `on` is false. Rejects when the meeting page cannot. |
| `setCamera(id, on)` | `{ id, camera }` | Shows the bot's camera when `on` is true, and turns it off when `on` is false. Rejects when the meeting page cannot. |
| `meetingState(id)` | `{ id, hand, mic, camera, people }` | The hand, microphone, camera, and the people list. Read-only. |
| `snapshot(id)` | `{ id, hand, mic, camera, people }` | Same fields as `meetingState`. Read-only. It does not change the meeting and it does not open a browser. A connector may also save a PNG of the Meet Bot page it already has open. |
| `onTranscript(fn)` | an unsubscribe function | Called with `{ id, by, text, at }` for each kept line, including a line the bot spoke. `by` is the bot's name on those lines. A repeat of the same spoken line is not delivered again. |

### `setVoice`

```js
MeetingBot.setVoice({
  respond_to_command: true,
  conversation_voice: "local", // "none" | "grok" | "local"
  llm: { url: "https://api.x.ai/v1", model: "grok-4.20-0309-non-reasoning", key: "<secret>" },
  tts: { engine: "kokoro", app: "offline-tts-kokoro", voice: "af_heart" },
  stt: { url: "https://example.test/stt" }
})
```

| Field | Meaning |
|---|---|
| `respond_to_command` | When true, a command heard in the room is answered out loud. When false, conversation may continue and commands get no spoken reply. Omit the field to leave the switch as it is. |
| `conversation_voice` | `none` stays quiet (transcription can still be on). `grok` is Grok Voice inside the meeting page. `local` streams a chat model and speaks the answer. Any other value rejects. Omit the field to leave the voice as it is. |
| `llm` | Included for `local` only. `url` and `model` name an OpenAI-compatible chat endpoint. `key` is sent once to the GifOS host page as `Authorization: Bearer` and is then dropped. It is never logged, never put on screen, never put in `status()`, and never put in a reply. |
| `tts` | Included for `local` only. Kokoro is `{ engine: "kokoro", app: "offline-tts-kokoro", voice: "af_heart" }`. A URL stand-in is `{ engine: "http", url }`. `{ engine: "none" }` turns speech off. The public result names the engine and, for Kokoro, the app and the voice. It does not include `tts.url`. |
| `stt` | Optional captions stand-in, `{ url }`, on any voice. The public result is `{ configured: true }` and does not include the URL. Room transcription still arrives through the meeting page. |

A command is a line addressed to the bot (its name, or "bot"), a line that starts with `join`, `leave`, `list`, `record`, `transcribe`, `status`, or `send`, or a line that starts with `/` or `!`. Conversation is any other line that ends with `?` or is at least 24 characters. `interject` speaks even when conversation voice is `none`. It uses Grok Voice when that voice is selected, and Kokoro or the HTTP stand-in otherwise. It does not call the language model. The text is already written.

### Where local voice runs

The app frame cannot `fetch`. Local mode runs on the GifOS host page, which owns the meeting session iframe. `host-voice.js` is that implementation. It is packed beside the app and it is not a script in `index.html`.

The host streams `POST {url}/chat/completions` with a JSON body of only `{ model, messages, stream: true }`. No tools and no function calls. The key travels only as `Authorization: Bearer`. When the URL is empty and a key is set, the host uses `https://api.x.ai/v1` and, on that host, `grok-4.20-0309-non-reasoning` if the model is empty. The first clause (text through `.`, `!`, or `?`) is spoken before the stream ends. Kokoro is `tts({ text, engine: "kokoro", app, voice })` on the computer. An HTTP stand-in is `POST` of `{ text, voice }` to `tts.url`, and the response body is the audio. The language-model key is not sent to that URL.

The app forwards the setting with `gifos.meet.setVoice(settings)` and does not keep the key. Speech is `gifos.meet.interject(id, text)`. A conversation turn is `gifos.meet.converse(id, { by, text })`. Stopping is `gifos.meet.stopSpeaking(id)`. Hand, microphone, and camera are `gifos.meet.raiseHand(id, on)`, `gifos.meet.setMic(id, on)`, and `gifos.meet.setCamera(id, on)`. A published GifOS build that does not know one of these answers "Unknown meet op." `setVoice` still stores the switches and resolves, with the key not retained. `interject`, `raiseHand`, `setMic`, and `setCamera` reject, and the room is left as it is.

### The bot's own voice

A line the bot spoke is stored and announced, with `by` set to the bot's name. That includes a successful `interject`, a spoken conversation reply, and a caption that is the bot's own line (marked self, bot, or me, credited to the bot's name, or matching one of the last 20 lines the bot spoke). The same line is kept once: a repeat among the last 20 lines already credited to the bot is not stored again and is not announced again. The bot does not answer its own lines. Chat from `say` is not a transcript line. The meeting page still does not caption this computer's own microphone.

### Mapping for a connector

| Connector verb | Meeting Bot |
|---|---|
| `start` | `start({ mode: 'run', name, password })` |
| `create` | `create()`, then hand `link` to the people you invite |
| `join` | `join(link, password)` |
| `admit` | No call needed. GifOS meetings have no waiting room. Anyone with the link (and the password, if the room has one) is let in by a member who is already seated. In a meeting the bot created, that member is the bot. Poll `people(id)` to see who has arrived. |
| `mute` | `setMic(id, false)` |
| `set_mic` | `setMic(id, on)` |
| `set_camera` | `setCamera(id, on)` |
| `raise_hand` | `raiseHand(id, on)` |
| `get_meeting_state` | `people(id)` and `meetingState(id)` |
| `snapshot` | `snapshot(id)`. Read-only. |
| `share` / `send_chat` | `say(id, text)` posts text or a link into the meeting chat. The bot cannot share a screen. |
| `say` (spoken) | `interject(id, text)`. `say` stays chat. |
| `set_voice` | `setVoice({ respond_to_command, conversation_voice, llm, tts, stt })` |
| `end` / `leave_meeting` | `end(id)`. The bot leaves. Everyone else stays: a GifOS meeting has no end-for-all. |
| `get_transcript` | `transcript(id)`, or `onTranscript` for each new line |

The page also shows the same state for people. `#phase` reads Running or Controlling. `#run-meetings li[data-id]` is one row per meeting. `#warn` holds the current warning. While running, `#ops` is the operator page: the meeting and its participants, the two voice switches, speaking or listening, the transcript tail, recent commands, and errors. One filled button on that screen is **Stop speaking**.

## 3. Launch link

Add `go.` keys to a `?run=` link. The link fills in the form. It starts the app only when it asks to, and only after the person approves the launch in the sheet. A link alone never starts the bot.

The sheet is titled "Meeting Bot is about to open on something". Press **Yes, do that** (`#perm-go`) to approve. **Just open it** (`#perm-plain`) opens the app with nothing filled in.

```
<origin>/?run=meeting-bot&go.mode=run&go.name=<name>&go.password=<password>&go.start=1
```

| Key | Meaning |
|---|---|
| `go.mode` | `run` or `control` |
| `go.name`, `go.password` | the bot's name and password |
| `go.start` | `1` presses Start as soon as the launch is approved |
| `go.conversation_voice` | `none`, `grok`, or `local` |
| `go.respond_to_command` | `1` or `on` turns the command switch on |

The sheet shows every value the link carries, the password included. A password in a URL can also end up in shell history and logs. On a shared machine, prefer `start()` from the local API. Do not put an API key in a launch link.

## 4. Remote protocol (admin meeting)

The name and password derive a secret admin meeting:

```
bits = PBKDF2-SHA256(password, salt = "gifos-meet-bot-v1|" + name.trim(), 20000 iterations, 256 bits)
room = hex(bits)[0..32]     password = hex(bits)[32..64]
```

Every message is one chat line, `gb1 ` followed by JSON with `"v":1`, an explicit `"role"` (`"controller"` or `"bot"`), an `"op"` and an `"id"`. A reply carries `"ref"`, the `id` of the request. The bot ignores messages without a role. It also ignores command-like chat in every other meeting.

Controller to bot:

| op | fields | reply |
|---|---|---|
| `list` / `status` | — | `meetings` with `items`, plus `respond_to_command`, `conversation_voice`, `speaking`, `listening`. `llm`, `tts`, and `stt` are the public forms only. |
| `create` | — | `ok` with `meetingId`, `link`, `room`, `items` |
| `join` | `link`, `password?` | `ok` with `meetingId`, `link`, `room`, `items` |
| `leave` / `end` | `meetingId` | `ok` with `items` |
| `record` / `transcribe` | `meetingId`, `on` | `ok` with `items` |
| `say` | `meetingId`, `text` | `ok` with `text: "sent"`. Chat only. |
| `interject` | `meetingId`, `text` | `ok` with `text: "spoken"` and `spoken: true` |
| `stop_speaking` | `meetingId?` | `ok` with `text: "stopped"` |
| `set_voice` | `respond_to_command?`, `conversation_voice?`, `llm?`, `tts?`, `stt?` | `ok` with the public settings. `llm.key`, `tts.url`, and `stt.url` are not copied into the reply, the log, or the page. |
| `raise_hand` | `meetingId`, `on` | `ok` with `hand` and `items` |
| `set_mic` | `meetingId`, `on` | `ok` with `mic` and `items` |
| `set_camera` | `meetingId`, `on` | `ok` with `camera` and `items` |
| `meeting_state` | `meetingId` | `meeting_state` with `hand`, `mic`, `camera`, `people` |
| `snapshot` | `meetingId` | `snapshot` with `hand`, `mic`, `camera`, `people`. Read-only. |
| `people` | `meetingId` | `people` with `people` |
| `transcript` | `meetingId` | the file over the data channel, then `xfer` with `name`, `lines` |
| `recording` | `meetingId` | the file over the data channel, then `xfer` with `name`, `mime` |

Camel-case aliases `setVoice`, `stopSpeaking`, `raiseHand`, `setMic`, `setCamera`, and `meetingState` are accepted as the same ops.

A failure replies `err` with `text`. While running, the bot also posts `beat` every 3 s, with `instance`, `meetings`, `respond_to_command`, `conversation_voice`, `speaking`, and `listening`. The beat does not carry a key or a stand-in URL. A second bot with the same pair gets `warn`.

New transcript lines are also posted by the bot, unsolicited, as `op: "transcript"` with `meetingId`, `by`, `text`, and `at`. That push is role `bot`. A controller's `transcript` request is still the file download. A line the bot spoke is posted the same way, with `by` set to the bot's name. A repeat of that line is not posted again.

Transcripts and recordings travel as data-channel frames (`k: "bx"`, base64 chunks of 8000 bytes). Only a session opened by the app, in CONTROL mode, puts them back together. A plain meeting page sees the chat lines but not the files. So to fetch files remotely, run the app in CONTROL mode and read `#xfer`, or catch the browser download.

## Consent and limits

- Everyone in the meeting sees the bot as a tile with no camera until `setCamera` turns one on, and a 🤖 bot badge.
- The bot will not record or transcribe unless the matching indicator is on screen.
- The bot will not raise a hand, open a microphone, open a camera, or speak unless the meeting page accepts that request.
- Transcripts and recordings stay on the bot's computer until a controller asks for them.
- One bot per name and password. A duplicate is warned about and refused unless overridden.
- An API key is not a status field, a log line, an error string, or a protocol reply.
