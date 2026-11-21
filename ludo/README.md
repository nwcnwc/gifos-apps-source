# Ludo

Four-seat Ludo as a GifOS app. Invite is the room. Close it, come back — the board is still there.

An unofficial port of **[ludo-game](https://github.com/chukwumaijem/ludo-game)**
by chukwumaijem (MIT). Upstream is React + Electron with a lobby. This
directory is a classic-script rewrite of the race (six to leave, 56 steps
home, capture, extra turn on six). Generic Ludo, not a branded product.

Online, `gifos.room` seats people (Red, Green, Yellow, Blue in join order, two
needed to play) and keeps who is here. Empty seats are skipped. The roller
rolls and moves on their own page and writes the whole game record with
`gifos.room.move`. Turns are "free" in the room because the OS passes the turn
to the next seat even when it is empty; the game's own turn skips empty colours.

`minBuild` is **5861**. No wasm, no network.

```bash
node apps/ludo/build.mjs
```
