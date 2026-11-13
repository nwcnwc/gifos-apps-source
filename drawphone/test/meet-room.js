#!/usr/bin/env node
'use strict';
// Drawphone in a real local meeting: 4 meet.js seats (2 desktop, 2 phone), DEBUG on, the app shared by Ada.
//   Draw & guess: everyone at the table with no typed name or Join; anyone (not only the host) starts a round;
//   the drawer's pad reaches every page live; a guess in another language counts; the scores are the same on
//   every page; a guesser who leaves mid-turn does not hold the turn; a late joiner watches, then plays the next
//   round; the round finishes with the same standings everywhere.
//   Telephone: a player who leaves mid-round is skipped and the chain goes on.
// Run (through the box queue): GIFOS=<gifos tree> bash $GIFOS/test/gate2/lib/q.sh room --pages 4 -- node meet-room.js
// Screenshots go to DP_SHOTS (default: the run folder).
const path = require('path');
const GIFOS = process.env.GIFOS || path.join(__dirname, '..', '..', '..', 'gifos');
const { Room } = require(path.join(GIFOS, 'test/gate2/rooms/lib/room.js'));
const H = require('./helpers.js');

const body = async (cast, check) => {
  const h = H.make(cast, check, process.env.DP_SHOTS || cast.runDir, 'dp');
  const ST = '(() => window.__drawphone ? window.__drawphone.state() : null)()';
  const st = (a) => h.app(a, ST);
  const sts = (as) => Promise.all(as.map(st));
  const vis = (a) => h.app(a, '(() => ["lobby","gg","play"].filter((id) => !document.getElementById(id).hidden))()');
  const txt = (a, id) => h.app(a, '(() => { const e = document.getElementById("' + id + '"); return e ? e.textContent : null; })()');
  const byId = (as, ss, id) => as[ss.findIndex((s) => s && s.me === id)];

  await cast.joinAll({ roles: ['ada', 'bob', 'cleo'] });
  await check.converged(3);
  const [ada, bob, cleo, dev] = ['ada', 'bob', 'cleo', 'dev'].map((r) => cast.get(r));
  let all = [ada, bob, cleo];
  await h.runApp(ada, all);

  // ---- 1. the table is the meeting ----
  await h.until('every page sits all 3 people at the table by itself (no name typed, no Join pressed)', async () => {
    const s = await sts(all); const v = await Promise.all(all.map(vis));
    return { ok: s.every((x) => x && x.people.length === 3) && v.every((x) => x.join() === 'lobby'), detail: { people: s.map((x) => x && x.people.length), v } };
  }, 60);
  const inputs = await Promise.all(all.map((a) => h.app(a, '(() => [...document.querySelectorAll("#lobby input")].length + ":" + !!document.getElementById("friendBtn"))()')));
  h.ok(inputs.every((x) => x === '0:false'), 'the lobby has no name field and no Join button', inputs);
  const s0 = await sts(all);
  const host = byId(all, s0, s0.find((x) => x.host).me);
  const notHost = all.find((a) => a !== host);
  h.ok(s0.filter((x) => x.host).length === 1, 'exactly one page is the host (' + host.name + ')', s0.map((x) => x.host));
  const startVis = await Promise.all(all.map((a) => h.app(a, '(() => !document.getElementById("startBtn").disabled)()')));
  h.ok(startVis.every(Boolean), 'Start is offered on every page, not only the host\'s', startVis);
  await h.shots(all, '1-lobby');

  // ---- 2. someone who is not the host starts a 45 s Draw & guess round ----
  await h.app(notHost, '(() => { document.querySelector("#timeSeg [data-ms=\\"45000\\"]").click(); document.getElementById("startBtn").click(); return 1; })()');
  let r = await h.until(notHost.name + ' (not the host) starts a round: every page shows the same round, drawer and word', async () => {
    const s = await sts(all);
    const k = (x) => x && x.board && x.board.game === 'guess' && x.board.phase === 'draw' ? [x.board.round, x.board.turn.drawer, x.board.turn.word, x.board.players.length].join('|') : 'none';
    return { ok: s.every((x) => k(x) !== 'none' && k(x) === k(s[0])) && s[0].board.ms === 45000, detail: s.map(k), s };
  }, 40);
  if (!r) return;
  let b = r.s[0].board;
  const drawerA = byId(all, r.s, b.turn.drawer);
  const guessers = all.filter((a) => a !== drawerA);
  const words = await Promise.all(all.map((a) => txt(a, 'ggWord')));
  const di = all.indexOf(drawerA);
  h.ok(words[di] && !/_/.test(words[di]) && words.every((w, i) => i === di || /^[_ ]+$/.test(w)), 'the drawer sees the word, everyone else only its blanks', words);
  const clocks = (await sts(all)).map((x) => x.msLeft);
  h.ok(Math.max(...clocks) - Math.min(...clocks) < 3000 && Math.min(...clocks) > 30000, 'the clock reads the same on every page (within 3 s)', clocks);

  // the drawer draws; the strokes reach every page
  h.ok((await h.draw(drawerA, 'ggPad')) === 'drew', drawerA.name + ' draws with a finger');
  await h.until('the drawing reaches every other page while the turn runs', async () => {
    const s = await sts(guessers);
    return { ok: s.every((x) => x.ink.some((i) => i.id === b.turn.drawer && i.key === b.turn.key && i.n >= 3)), detail: s.map((x) => x.ink) };
  }, 20);
  await h.shots(all, '2-drawing');

  // a wrong guess, then the right word in German
  const g1 = guessers[0];
  const word = await h.app(g1, '(() => { const b = window.__drawphone.state().board; return window.DP.PACK[b.turn.word]; })()');
  const guess = (a, t) => h.app(a, '(() => { const i = document.getElementById("guessIn"); if (i.disabled) return "disabled"; i.value = ' + JSON.stringify(t) + '; document.getElementById("ggGuess").requestSubmit(); return "ok"; })()');
  await guess(g1, 'teapot-not-it');
  await guess(g1, word[1]);
  r = await h.until(g1.name + ' guesses in German ("' + word[1] + '"): 10 points, on every page', async () => {
    const s = await sts(all);
    return { ok: s.every((x) => x.board && x.board.turn && x.board.turn.hits.length === 1 && x.board.turn.hits[0].pts === 10 && x.board.scores[x.board.turn.hits[0].id] === 10), detail: s.map((x) => x.board && x.board.turn && x.board.turn.hits), s };
  }, 25);
  const feed = await txt(guessers[1], 'ggFeed');
  h.ok(/teapot-not-it/.test(feed) && !feed.includes(word[1]) && /\+10/.test(feed), 'the feed shows the wrong guess and "got it", never the right word', feed);
  await h.shots(all, '3-got-it');

  // the last guesser leaves mid-turn: everyone still here has it, so the turn closes
  const leaver = guessers[1];
  await leaver.cmd('leave', 30000);
  all = all.filter((a) => a !== leaver);
  r = await h.until(leaver.name + ' leaves mid-turn: the turn does not wait for them (reveal or next drawer)', async () => {
    const s = await sts(all);
    return { ok: s.every((x) => x.board && (x.board.phase === 'reveal' || x.board.ti > 0 || x.board.phase === 'over')), detail: s.map((x) => x.board && [x.board.phase, x.board.ti]), s };
  }, 30);
  await h.shots(all, '4-after-leave');

  // a late joiner comes in during the round
  await cast.joinAll({ roles: ['dev'] });
  all = all.concat([dev]);
  r = await h.until('the late joiner sits at the table and watches this round (not a player in it)', async () => {
    const s = await sts(all);
    const d = s[s.length - 1];
    return { ok: d && d.board && d.board.game === 'guess' && !d.board.players.includes(d.me) && s.every((x) => x.people.length === 3), detail: s.map((x) => x && [x.people.length, x.board && x.board.players.length]), s };
  }, 120);
  const devFeed = await txt(dev, 'ggFeed');
  h.ok(/next round/i.test(devFeed || ''), 'the late joiner is told they play from the next round', devFeed);
  await h.shots(all, '5-late-joiner');

  // play the rest of the round: each turn, every guesser still here guesses right
  for (let i = 0; i < 6; i++) {
    const s = await sts(all);
    b = s[0].board;
    if (!b || b.phase === 'over') break;
    if (b.phase === 'draw') {
      const d = byId(all, s, b.turn.drawer);
      if (d) await h.draw(d, 'ggPad');
      for (const a of all) {
        const me = s[all.indexOf(a)].me;
        if (me !== b.turn.drawer && b.players.includes(me)) await guess(a, (await h.app(a, '(() => window.DP.PACK[window.__drawphone.state().board.turn.word][0])()')));
      }
    }
    await cast.sleep(4, 'next turn');
  }
  r = await h.until('the round ends on every page with the same standings', async () => {
    const s = await sts(all);
    const k = (x) => x && x.board && x.board.phase === 'over' ? JSON.stringify([x.board.round, x.board.scores, x.board.totals]) : 'not over';
    return { ok: s.every((x) => k(x) !== 'not over' && k(x) === k(s[0])), detail: s.map(k), s };
  }, 120);
  if (r) {
    const shown = await Promise.all(all.map((a) => h.app(a, '(() => [...document.querySelectorAll("#standings .pt")].map((e) => e.textContent).join(","))()')));
    h.ok(shown.every((x) => x && x === shown[0]), 'the standings on screen read the same points on every page', shown);
    const sc = r.s[0].board.scores;
    h.ok(Object.values(sc).some((v) => v > 0), 'someone scored', sc);
  }
  await h.shots(all, '6-round-over');

  // the late joiner starts the next round and is in it
  await h.click(dev, 'nextRoundBtn');
  r = await h.until('the late joiner presses Next round: round 2 starts with them in it, on every page', async () => {
    const s = await sts(all);
    const devId = s[all.indexOf(dev)].me;
    return { ok: s.every((x) => x.board && x.board.round === 2 && x.board.players.includes(devId) && x.board.players.length === 3), detail: s.map((x) => x.board && [x.board.round, x.board.players.length]), s };
  }, 40);
  if (r) {
    const s = r.s;
    h.ok(s.every((x) => JSON.stringify(x.board.totals) === JSON.stringify(s[0].board.totals)), 'totals carried into round 2 are the same everywhere', s.map((x) => x.board.totals));
  }
  await h.shots(all, '7-round-2');

  // ---- 3. Telephone: a leaver is skipped ----
  // end round 2 quickly by letting it run? No: switch games from the next "over"; here, wait for time-outs is long, so guess through.
  for (let i = 0; i < 8; i++) {
    const s = await sts(all); b = s[0].board;
    if (!b || b.phase === 'over') break;
    if (b.phase === 'draw') for (const a of all) { const me = s[all.indexOf(a)].me; if (me !== b.turn.drawer) await guess(a, (await h.app(a, '(() => window.DP.PACK[window.__drawphone.state().board.turn.word][0])()'))); }
    await cast.sleep(4, 'next turn');
  }
  await h.until('round 2 is over everywhere', async () => { const s = await sts(all); return { ok: s.every((x) => x.board && x.board.phase === 'over'), detail: s.map((x) => x.board && x.board.phase) }; }, 90);
  await h.click(all[0], 'otherGameBtn');
  r = await h.until('Telephone starts for the 3 people here, every page on turn 1', async () => {
    const s = await sts(all);
    return { ok: s.every((x) => x.board && x.board.game === 'chain' && x.board.phase === 'play' && x.board.turn === 0 && x.board.order.length === 3), detail: s.map((x) => x.board && [x.board.game, x.board.phase, x.board.turn]), s };
  }, 40);
  if (!r) return;
  for (const a of all) { await h.draw(a, 'pad'); await h.click(a, 'drawSend'); }
  await h.until('every page reaches turn 2 (guess)', async () => { const s = await sts(all); return { ok: s.every((x) => x.board.turn === 1), detail: s.map((x) => x.board.turn) }; }, 30);
  await h.shots(all, '8-telephone');
  const tLeaver = all.find((a) => a !== ada);
  await tLeaver.cmd('leave', 30000);
  const stay = all.filter((a) => a !== tLeaver);
  for (const a of stay) await h.app(a, '(() => { const i = document.getElementById("wordIn"); i.value = "a kite"; document.getElementById("wordSend").click(); return 1; })()');
  await h.until(tLeaver.name + ' left mid-Telephone: their turn is skipped and the chain goes on to turn 3', async () => {
    const s = await sts(stay);
    return { ok: s.every((x) => x.board.turn >= 2 && x.board.chains.some((c) => c.links.some((l) => l.skip))), detail: s.map((x) => [x.board.turn, x.board.phase]) };
  }, 40);
  await h.shots(stay, '9-telephone-after-leave');
};

new Room({
  name: 'drawphone-meeting', C: 3, base: 0,
  episodes: [{
    id: 'dp-meeting', room: 'fresh', run: body,
    cast: { ada: { name: 'Ada' }, bob: { name: 'Bob', profile: 'phone' }, cleo: { name: 'Cleo' }, dev: { name: 'Dev', profile: 'phone' } },
  }],
}).play();
