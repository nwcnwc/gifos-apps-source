# Air Hockey

The original WebGL air-hockey table, as an ordinary sandboxed GifOS app. Solo,
you play a computer paddle on the far side. Send the invite and a friend sits
at the other end, on their own phone or computer. There is no game server.

The engine is **[AirHockeyWebGL](https://github.com/MortimerGoro/AirHockeyWebGL)**
by MortimerGoro (Imanol Fernandez) — MIT, a three.js r66 table with box2dweb
physics, OBJ paddles and puck, and a chasing AI. This directory is the GifOS
port: two-device play, and the packing. Upstream has no networking.

```
index.html              shell: the table canvas, scores, hidden textures/audio
style.css               dark wood room, overlay HUD
boot.js                 our entry: loaders, Web Audio fallback, the netplay system
icon.mjs                procedural ice-table icon and the 1200×720 cover
vendor/three.min.js     UPSTREAM. three.js r66. Never edit.
vendor/box2d.js         UPSTREAM. box2dweb. Never edit.
vendor/OBJMTLLoader.js  UPSTREAM. r66 OBJ/MTL loader. Never edit.
vendor/physics.js       UPSTREAM. Table edges, joints, goals. Never edit.
vendor/AI.js            UPSTREAM. Far-side computer. Never edit.
vendor/hockey.js        UPSTREAM. Scene, camera, input. Never edit.
vendor/model.js         UPSTREAM. Scores and pucks. Never edit.
vendor/audio.js         UPSTREAM. Sound manager (paths patched in boot).
vendor/assets.js        GENERATED. OBJ/MTL as strings — GifOS CSP blocks XHR.
vendor/images/          UPSTREAM floor + ice surface
vendor/audio/           UPSTREAM hit / edge / goal samples
vendor.mjs              rebuilds vendor/* from the pin. The only step needing net.
build.mjs               packs all of the above into site/apps/air-hockey/air-hockey.gif
```

## Why this app can exist at all

Upstream is already classic scripts: no modules, no `localStorage`. GifOS's
runtime inlines `<script src>` as classic scripts, and these files already
are. The GifOS work is persistence through `gifos.db`, the invite room, and
feeding the loaders from the GIF filesystem (the sandbox refuses XHR).

## capabilities

| capability | why |
|---|---|
| `db` | Sound pref in a `private` collection; paddle/puck state in a `read-write` one. |
| `multiplayer` | The room. Invite is OS chrome — this app never draws a share button. |

Seats (Near, Far) come from `gifos.room`, so `minBuild` is **5861**. On an older GifOS the app says so in one line and plays solo against the CPU, writing nothing shared.

## Two devices, no game server

The app's owner (`gifos.info().owner`; GifOS hands it to the next copy when the
owner leaves) simulates the puck and writes the `world` row (puck and score)
when it changes. Each seated player writes only their own `paddles` row, and
only while they move it. Rows of people who hold no seat are ignored. No
heartbeat, no stale window. When the owner sits at the far end the CPU cannot
stand in for the near end (the original AI only plays the far paddle).

A subscriber re-downloads the whole collection on every change, so traffic is
O(players²) even for two people. The publish rate is 20 Hz of a handful of
numbers, not a stream of frames. The guest dead-reckons the puck between
host snapshots so it does not stutter. The guest camera sits at the far end
so their paddle is the near one.

When nobody else is in the room the far paddle is the original computer.
A friend joining turns that paddle into theirs and resets the score; they
leave and the computer takes it back.

## Touch

Upstream already maps a finger or the mouse onto the table plane. `boot.js`
adds pointer capture so a drag does not scroll the page.

## Honest limits

- **Host is the physics.** A delayed guest paddle can look like it hit a puck
  the host already called a miss. This is table ice with a friend over a
  link, not a tournament.
- **Two seats.** A third person who opens the link can watch; they do not get
  a paddle.
- **One puck.** Upstream's debug panel let you spawn up to ten; this copy
  keeps a single puck, which is the game.
- **Safari may not play the original oggs.** Hits then fall back to a short
  beep. The table, the AI and the ice are upstream's.

## Building

```bash
node apps/air-hockey/vendor.mjs      # only when moving the upstream pin (needs net)
node apps/air-hockey/build.mjs       # -> site/apps/air-hockey/air-hockey.gif
```

Do not run `scripts/build-app-catalog.mjs` from this change — `index.json`
is owned elsewhere.

## Licences

AirHockeyWebGL is MIT. three.js r66 is MIT. box2dweb is zlib (Erin Catto).
The notices are packed **inside the GIF** as well as living here, because a
copy of this app that someone was handed is a distribution of that work.
Audio samples were bundled upstream and credited to
[krb21 on Freesound](https://www.freesound.org/people/krb21/sounds/118604/).
