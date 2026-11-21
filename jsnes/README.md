# jsnes

A JavaScript NES emulator as an ordinary sandboxed GifOS app. Solo it is
Ben Firshman's [JSNES](https://github.com/bfirsh/jsnes) (Apache-2.0) plus
two homebrew carts. Send the invite and the friend is **player 2**.

The engine is vendored at **2.1.0** (`vendor/jsnes.min.js`). Upstream has
no persistence and no netplay; jsnes.org fetches ROMs from the network.
This copy keeps the ROM in the GIF and the save in `gifos.db` (a last-play
snapshot, plus SRAM when the cart's battery bit is set), so the file is
the save, and the invite is the second controller.

```
index.html      screen, library, NES pad markup
style.css       CRT chrome + thumb pad
vendor/jsnes.min.js   JSNES 2.1.0 UMD. Never fetch it at runtime.
roms.js         generated: Concentration Room + Lawn Mower as bytes
emu.js          canvas, APU, keyboard, SRAM, quick states
touch.js        plus-shaped d-pad, A/B, Start/Select above them
net.js          player-2 over a meeting — each peer writes only their pad
boot.js         library, drop a dump, wiring
icon.mjs        NES pad sticker + a real in-game cover
build.mjs       packs site/apps/jsnes/jsnes.gif
```

Sample ROMs are homebrew only. Concentration Room is GPL-3 with Damian
Yerrick's iNES-binary exception. Lawn Mower is Shiru, public domain.
A user may drop their own dump; nothing Nintendo ships in this tree.

## capabilities

| capability | why |
|---|---|
| `db` | Last-play snapshot and battery SRAM in a `private` collection; quick states; the live pad in a `read-write` one; the host's cart in a `read-only` one the guest reads once. |
| `multiplayer` | The room. Invite is OS chrome — this app never draws that button. |

Seats (Pad 1, Pad 2) come from `gifos.room`, so `minBuild` is **5861**. On an older GifOS the app says so in one line; solo play still works and nothing shared is written.

## Two controllers

The first two people in the room take Pad 1 and Pad 2 (a third watches); the app's owner writes the `session` and `cart` rows, and GifOS hands that on if the owner leaves. Each writes only their
own row in `pads` (a button mask). Both run the same cart. A custom dump
the host dropped is published once on `cart` so the guest can load it.

## Building

```bash
node apps/jsnes/build.mjs   # -> site/apps/jsnes/jsnes.gif
```

## Licence

Apache-2.0, Ben Firshman / JSNES. Notices for the engine and for each
sample ROM ride **inside the GIF**.
