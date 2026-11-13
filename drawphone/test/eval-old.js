#!/usr/bin/env node
'use strict';
// Evaluation room for Drawphone 1.0 as it is in the store (before the meeting tweaks): 3 meet.js seats in a
// local meeting, DEBUG on, the app shared by Ada. Records what each seat sees, whether players come from the
// meeting by themselves, and what a leave mid-round does. Run with GIFOS=<gifos tree> (default ../../../gifos).
const path = require('path');
const GIFOS = process.env.GIFOS || path.join(__dirname, '..', '..', '..', 'gifos');
const { Room } = require(path.join(GIFOS, 'test/gate2/rooms/lib/room.js'));
const H = require('./helpers.js');

new Room({
  name: 'drawphone-eval', C: 3, base: 0,
  episodes: [{
    id: 'dp-old', room: 'fresh',
    cast: { ada: { name: 'Ada' }, bob: { name: 'Bob', profile: 'phone' }, cleo: { name: 'Cleo' } },
    run: async (cast, check) => {
      const h = H.make(cast, check, process.env.DP_SHOTS || cast.runDir, 'old');
      await cast.joinAll();
      await check.converged(3);
      const [ada, bob, cleo] = ['ada', 'bob', 'cleo'].map((r) => cast.get(r));
      const all = [ada, bob, cleo];
      await h.runApp(ada, all);
      const vis = '(() => ["setup","hereSetup","lobby","play"].filter((id) => !document.getElementById(id).hidden))()';
      const v0 = await Promise.all(all.map((a) => h.app(a, vis)));
      h.note('sections visible after the app opens', v0);
      h.ok(v0.every((x) => Array.isArray(x) && x.includes('lobby')), 'OLD: players join the table from the meeting by themselves (no button)', v0);
      await h.shots(all, '1-open');
      for (const a of all) await h.click(a, 'friendBtn');
      const lob = await h.until('OLD: after pressing Play with friends, the table shows 3 seats on every page', async () => {
        const s = await Promise.all(all.map((a) => h.app(a, '(() => document.querySelectorAll("#lobbySeats .seat:not(.open)").length)()')));
        return { ok: s.every((n) => n === 3), detail: s };
      }, 60);
      await h.shots(all, '2-lobby');
      if (!lob) return;
      let started = false;
      for (const a of all) if ((await h.click(a, 'lobbyStart')) === 'ok') { started = true; break; }
      h.ok(started, 'OLD: the host sees Start the round');
      await h.until('OLD: every page is on turn 1 (draw)', async () => {
        const s = await Promise.all(all.map((a) => h.app(a, '(() => !document.getElementById("drawPane").hidden)()')));
        return { ok: s.every(Boolean), detail: s };
      }, 40);
      await h.shots(all, '3-draw');
      for (const a of all) { await h.drawOld(a); await h.click(a, 'drawSend'); }
      await h.until('OLD: every page reaches turn 2 (guess)', async () => {
        const s = await Promise.all(all.map((a) => h.app(a, '(() => !document.getElementById("wordPane").hidden)()')));
        return { ok: s.every(Boolean), detail: s };
      }, 40);
      await h.shots(all, '4-guess');
      await cleo.cmd('leave', 30000);
      for (const a of [ada, bob]) await h.app(a, '(() => { document.getElementById("wordIn").value = "a hat"; document.getElementById("wordSend").click(); return 1; })()');
      await cast.sleep(40, 'does the chain go on without Cleo?');
      const t = await Promise.all([ada, bob].map((a) => h.app(a, '(() => [document.getElementById("playTitle").textContent, document.getElementById("playCount").textContent, document.getElementById("waitLead").textContent])()')));
      h.note('40 s after Cleo left mid-round', t);
      h.ok(!t.every((x) => /Waiting/.test(x[0])), 'OLD: a leaver mid-round does not stall the chain', t);
      await h.shots([ada, bob], '5-after-leave');
    },
  }],
}).play();
