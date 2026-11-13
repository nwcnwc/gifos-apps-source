# Drawphone

Draw & guess and Telephone for meetings: one draws, everyone guesses; or draw, pass it on, guess what they drew.

An unofficial port of **[Drawphone](https://github.com/tannerkrewson/drawphone)**
by Tanner Krewson (MIT). Upstream is a party game that **needs a Node room** —
Express + socket.io hold the table, shuffle the chains, and store the drawings.
**This copy has no game server.** The Node process, the socket.io room, fabric.js,
and every `localhost:3000` path stay behind. The GifOS meeting is the room.

```
index.html          the table, Draw & guess, Telephone
style.css           cream paper on dark wood; phone-first
i18n/*.json         words on screen in en, de, es, ru, zh-Hans (i18n-en.js is built from en.json)
words.js            the word pack: ~130 work-safe drawable things, each in five languages
game.js             Telephone chains + Draw & guess rules (pure; test/game-unit.js)
draw.js             touch pad (finger or mouse), stroke model
app.js              roster from the meeting, the host loop, screens
icon.mjs            procedural cat-on-paper icon + 1200x720 cover
build.mjs           packs the GIF into gifos-app/apps/drawphone/drawphone.gif
test/               game-unit.js (node), meet-room.js (a meet.js meeting), eval-old.js (1.0 as shipped)
vendor/COPYING-drawphone.txt   upstream MIT notice (also packed inside the GIF)
```

## In a meeting (1.1)

- **The players are the meeting.** Everyone with the app open is at the table:
  each page writes a heartbeat row and counts the rows it sees moving. No typed
  names, no Join, no pass-this-device roster.
- **One writer per row.** Each person writes only `p:<id>` (heartbeat, a pending
  request, this turn's guesses) and `ink:<id>` (the live pad or a Telephone
  drawing). The host (lowest live id) is the only writer of `board`; it applies
  requests, judges guesses, keeps the clock and the scores, so every page shows
  the same numbers. A new host picks the board up where it was.
- **Anyone starts a round** (a request on their own row, keyed to the board
  version it saw). People who arrive mid-round watch and play the next one.
  A drawer who leaves ends their turn; a Telephone player who leaves (or runs
  out of time) is skipped.
- **Clock without clock sync**: the board says how many ms were left when it was
  written; each page counts from when it first saw that version.
- **Draw & guess** scoring: 10, 8, 6, then 5 for right guesses in order; the drawer
  3 each (max 12). Three drawers a round. Telephone is capped at six steps.

## Why the server is gone

Upstream `server/` *is* the room (codes, host, bots, AWS archive, latin-square
rotation). A sandboxed GifOS app has `connect-src 'none'` and declares **no
`network` capability**, so that process cannot come along. The playable thing
— telephone with pictures — is small enough to run as classic scripts on a
shared collection. Fabric.js / jQuery / socket.io-client stay behind; the pad
is a few pointer events.

The invite button is **OS chrome**. This app never draws one.

## capabilities

| capability | why |
|---|---|
| `db` | The shared table, and a private save slot. |
| `multiplayer` | The room. |

No `wasm`. No `network`. `minBuild` is **947**.

## Building

```bash
node apps/drawphone/build.mjs
```

Writes `site/apps/drawphone/drawphone.gif`. The MIT notice rides inside the
GIF.

Do not run `scripts/build-app-catalog.mjs` from this change — `index.json`
is owned elsewhere.

## Licence

Drawphone — MIT, Copyright (c) 2016 Tanner Krewson. See
[`vendor/COPYING-drawphone.txt`](vendor/COPYING-drawphone.txt).
