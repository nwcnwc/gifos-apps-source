# Quiz Buzzer

A host puts a question on the big screen. Everyone else's phone is a buzzer.
Fastest correct answer scores. Next question. End-of-round board.

Inspired by live classroom buzzers. This is a first-party engine with our own
question pack — not a port, and it ships **no Kahoot assets, trademarks, or
APIs**. Nothing is fetched. The pack is inside the app. Custom questions you
type stay with your copy too.

```
index.html     home / lobby / host screen / buzzer pads / board
style.css      dark stage, huge 2×2 pads, live board
pack.js        40 original questions + scoring (QuizBuzzer)
app.js         solo drill, host-authority multiplayer
icon.mjs       four pads; red lights; score ticks; 1200×720 fallback
tools/shoot.js Playwright cover (mid-round + live scores)
build.mjs      packs site/apps/quiz-buzzer/quiz-buzzer.gif
```

## Why this, not a quiz company

No account. No class code. No hosted quiz server. Works on a plane. One
invite is the room. The host's device is the authority; phones only publish
their own buzz. Answers are on the phone, so you do not need a projector.

## Play

- **Solo** — drill the bundled pack against the clock. You are host and
  player. Pack progress (asked / correct / streak) is private, inside the icon.
  Type a question on this device; tick Keep in this file and it travels with
  the GIF. **My questions** drills only those.
- **Friends** — press **Invite** in the GifOS menu (OS chrome; this app does
  not draw a share button). Opened with other people in the room, the app goes
  straight to the lobby. The person who shared the app (its owner) hosts:
  put that device where people can see it. If the owner leaves a resilient
  room, GifOS hands the app to the next person, who hosts from then on. Host picks how many questions and
  how many seconds, or types a custom question + four answers (tap the colour
  that is right). Start. Guests tap one of four coloured pads — that lock is
  their buzz (`pointerdown`). When everyone is in, or the clock hits zero,
  Reveal. First legal correct buzz scores. Next. End-of-round board.
- Who is here comes from the room (`gifos.people()`, GifOS 0.9.27+): no
  presence rows, no heartbeat. On an older GifOS the app says "needs a newer
  GifOS" and runs solo only. Without GifOS the solo pack still runs.

## Scoring (host authority)

Each player writes **only their own** `players` row: `{ choice, buzzAt }`.
The host writes the `match` row: question, deadline, revealed answer, scores.
`QuizBuzzer.scoreQuestion` keeps the first legal buzz whose choice matches
the right index. Early, late, and wrong are recorded and do not score.

## capabilities

| capability | why |
|---|---|
| `db` | Private pack progress + custom questions, shared match, each player's own buzz. |
| `multiplayer` | The room. |

No `wasm`, no `network`, no `pointer`. `minBuild` is **5861** (`gifos.people()`).

Collections:

- `prefs` private — solo progress, custom questions, the host's in-flight
  answer (so a refresh mid-question can still Reveal without putting the key
  on the match).
- `match` read-write — host is the only writer of the round.
- `players` read-write — each person writes only their own row, keyed by
  their room id, and only when they act (join, new round, buzz). Rows of
  people the room no longer has are not shown.

## Building

```bash
node apps/quiz-buzzer/build.mjs
node apps/quiz-buzzer/tools/shoot.js   # after the GIF is current
```

Writes `site/apps/quiz-buzzer/quiz-buzzer.gif`. `build.mjs` does not clobber
a Playwright `screenshot.png`. Do not run `scripts/build-app-catalog.mjs`
from this change — `index.json` is owned elsewhere.

## Licence

MIT. Original questions and engine, GifOS.
