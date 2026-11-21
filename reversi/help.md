# Reversi

An eight-by-eight green board. Black and white take turns putting a disc down. Any of the other colour trapped in a straight line — row, column, or diagonal — between two of yours flip to you. Black goes first. Dots mark where you can go. When neither of you can place, the one with more discs wins. A draw is possible.

Discs actually turn over.

## How to play

Tap or click a dotted square. If you have no legal square, the turn passes back. Corners are strong; a big lead early can still vanish.

## Computer

On **New game**, leave **Computer** selected and pick **Black** or **White**. Black goes first, so white waits for the opening move. **Start game**.

The computer thinks on this device — about a second and a half a move. The chip at the top says when it is thinking.

- **Undo** takes back your last exchange (your move and its reply). In two-here it takes back one place.
- **New game** returns to the setup card.

A game in progress auto-saves in this file. Close and reopen and you are still on the board, unless it had already ended.

## Two here

Pick **Two here**, then **Start game**. Pass the device. Black goes first.

## Play a friend

Press **Play a friend**, then **Invite** in the bar above the app — that button is not inside the board. If other people are already in the room with you, the game opens on the shared board by itself. GifOS seats the first two people black and white; anyone else watches and takes a seat when one opens. You only place on your colour’s turn, and a player who is away is waited for.

**Resign** (on your turn) gives the board to the other colour. After a result, **New game** (either player) starts the next one. **Leave** gives up your seat and returns to setup.

## Saved

The local computer or two-here game lives in this file. A live friend game lives in the room, not as a solo save. Sharing the GIF does not hand someone your current friend match.

Unofficial port of [Reversi](https://github.com/alex-berson/reversi) by Alexander Berson. The computer is the same one that shipped with that game.
