# Meeting Bot control surface

This is the contract for software that drives Meeting Bot, for example a connector running a headless browser. Contract version: `window.MeetingBot.version === 1`. The app needs a GifOS build that has `capabilities.meet` (minBuild 2723, release 0.9.23).

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

The app runs in `#appmount iframe`, a sandboxed srcdoc frame. With Playwright:

```js
const el = await page.waitForSelector('#appmount iframe');
const app = await el.contentFrame();
await app.waitForFunction(() => window.MeetingBot && window.MeetingBot.version === 1);
```

### Transcripts need a speech-to-text provider

The bot writes down what it hears with the computer's **Speech → text** provider. For example, install **Offline STT Whisper** from the store and assign it to Speech → text in Settings. Transcript lines come only from that provider. The bot does not send audio anywhere else.

## 2. Local API: `window.MeetingBot`

Every method returns a Promise. A failure rejects with an `Error` whose message is meant for people. Every method except `start` and `status` needs RUN mode to be running. Before that, they reject with "The bot is not running".

| Method | Resolves with | Notes |
|---|---|---|
| `start({ mode, name, password, override?, rules? })` | `status()` | `mode` is `'run'` or `'control'`. A weak name and password pair rejects, for example "Password needs at least 10 characters." If a bot with this pair is already running, it rejects with the duplicate warning unless `override: true`. `rules` is the auto-join list, one link per line. RUN takes about 5 s, because it first listens for a running duplicate. |
| `status()` | `{ phase, name, meetings, warning }` | Synchronous. `phase` is `'idle'`, `'probe'`, `'run'` or `'control'`. |
| `create()` | `{ id, room, link }` | Hosts a new meeting with an unguessable 16-character room code. `link` is the invite to give people. |
| `join(link, password?)` | `{ id, room, link }` | `link` is a meeting link or a room code. `password` is the room password, if it has one. |
| `list()` | `[{ id, room, link, rec, cc, created, people }]` | The work meetings, without the admin meeting. `people` holds the names of everyone except the bot. |
| `people(id)` | `[{ id, name, bot, me }]` | Who is in the meeting now. `me` is the bot itself. |
| `transcribe(id, on)` | `{ id, cc }` | Turns writing everyone down on or off. Everyone sees 📝 transcribing on the bot's tile. If that indicator cannot be shown, the call rejects. |
| `record(id, on)` | `{ id, rec }` | Turns recording on or off. Everyone sees ⏺ recording on the bot's tile. |
| `say(id, text)` | `{ id, sent: true }` | Posts one chat message into the meeting, up to 2000 characters. |
| `transcript(id)` | `{ id, lines: [{ by, text, at }], text }` | Every line so far. `text` has one `Name: words` line per entry. `at` is ms since epoch. |
| `recording(id)` | `{ id, name, mime, bytes }` | Stops recording if it is on, then returns the file (`bytes` is an ArrayBuffer, usually `video/webm`). |
| `leave(id)` / `end(id)` | `{ id, left: true }` | The bot leaves the meeting. |

### Mapping for a connector

| Connector verb | Meeting Bot |
|---|---|
| `start` | `start({ mode: 'run', name, password })` |
| `create` | `create()`, then hand `link` to the people you invite |
| `join` | `join(link, password)` |
| `admit` | No call needed. GifOS meetings have no waiting room. Anyone with the link (and the password, if the room has one) is let in by a member who is already seated. In a meeting the bot created, that member is the bot. Poll `people(id)` to see who has arrived. |
| `mute` | Nothing to do. The bot has no microphone and no camera, and never sends audio or video. There is no unmute. |
| `share` | `say(id, text)` posts text or a link into the meeting chat. The bot cannot share a screen. |
| `end` | `end(id)`. The bot leaves. Everyone else stays: a GifOS meeting has no end-for-all. |
| `get_transcript` | `transcript(id)` |
| recording | `record(id, true)`, then `recording(id)` |

The page also shows the same state for people. `#phase` reads Running or Controlling. `#run-meetings li[data-id]` is one row per meeting. `#warn` holds the current warning.

## 3. Launch link

Add `go.` keys to a `?run=` link. The link fills in the form. It starts the app only when it asks to, and only after the person approves the launch in the Abilities sheet. A link alone never starts the bot.

```
<origin>/?run=meeting-bot&go.mode=run&go.name=<name>&go.password=<password>&go.start=1
```

| Key | Meaning |
|---|---|
| `go.mode` | `run` or `control` |
| `go.name`, `go.password` | the bot's name and password |
| `go.start` | `1` presses Start as soon as the launch is approved |

A password in a URL can end up in shell history and logs. On a shared machine, prefer `start()` from the local API.

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
| `list` / `status` | — | `meetings` with `items` |
| `create` | — | `ok` with `meetingId`, `link`, `room`, `items` |
| `join` | `link`, `password?` | `ok` with `meetingId`, `link`, `room`, `items` |
| `leave` / `end` | `meetingId` | `ok` with `items` |
| `record` / `transcribe` | `meetingId`, `on` | `ok` with `items` |
| `say` | `meetingId`, `text` | `ok` |
| `people` | `meetingId` | `people` with `people` |
| `transcript` | `meetingId` | the file over the data channel, then `xfer` with `name`, `lines` |
| `recording` | `meetingId` | the file over the data channel, then `xfer` with `name`, `mime` |

A failure replies `err` with `text`. While running, the bot also posts `beat` every 3 s, with `instance` and `meetings`. A second bot with the same pair gets `warn`.

Transcripts and recordings travel as data-channel frames (`k: "bx"`, base64 chunks of 8000 bytes). Only a session opened by the app, in CONTROL mode, puts them back together. A plain meeting page sees the chat lines but not the files. So to fetch files remotely, run the app in CONTROL mode and read `#xfer`, or catch the browser download.

## Consent and limits

- Everyone in the meeting sees the bot as a tile with no camera and a 🤖 bot badge.
- The bot will not record or transcribe unless the matching indicator is on screen.
- Transcripts and recordings stay on the bot's computer until a controller asks for them.
- One bot per name and password. A duplicate is warned about and refused unless overridden.
