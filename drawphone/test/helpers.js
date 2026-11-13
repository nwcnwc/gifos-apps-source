'use strict';
// Small vocabulary for the Drawphone meet.js rooms (eval-old.js, meet-room.js), after test/gate2/rooms/lib/take-turns-ep.js.
const path = require('path');
const fs = require('fs');

function make(cast, check, shotsDir, tag) {
  fs.mkdirSync(shotsDir, { recursive: true });
  const roleOf = (a) => Object.keys(cast.map).find((r) => cast.get(r) === a) || a.name;
  const ok = (cond, desc, detail) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + desc + (cond || detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 600))); return check.assert(!!cond, desc, detail); };
  const note = (desc, v) => console.log('NOTE — ' + desc + ': ' + JSON.stringify(v).slice(0, 1500));
  const until = async (desc, fn, within) => {
    let last; const t0 = Date.now();
    for (;;) {
      try { last = await fn(); if (last && last.ok) { ok(true, desc + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)'); return last; } } catch (e) { last = String(e); }
      if (Date.now() - t0 > within * 1000) { ok(false, desc, last && last.detail !== undefined ? last.detail : last); return null; }
      await cast.sleep(1.5);
    }
  };
  const parse = (r) => { const l = ((r.out || []).map((x) => x.trim()).filter((x) => x.startsWith('@@eval ')).pop() || '').slice(7); try { return JSON.parse(l); } catch (e) { return l; } };
  const app = async (a, js) => parse(await a.cmd('appeval ' + js, 30000));
  const page = async (a, js) => parse(await a.cmd('eval ' + js, 30000));
  const shot = (a, t) => a.cmd('shot ' + path.join(shotsDir, tag + '-' + t + '-' + roleOf(a) + '.png'), 30000);
  const shots = (as, t) => Promise.all(as.map((a) => shot(a, t)));
  const click = (a, id) => app(a, '(() => { const b = document.getElementById("' + id + '"); if (!b || b.hidden || b.disabled || b.offsetParent === null) return "no ' + id + '"; b.click(); return "ok"; })()');
  // GifOS's own sheets (abilities / unsigned / stage line) on the meeting page: confirm them
  const ack = (a) => page(a, '(() => { const b = document.querySelector(".perm-modal button.done"); if (b) { b.click(); return "sheet"; } return 0; })()');
  async function runApp(host, all) {
    const inst = await host.cmd('app install drawphone', 60000);
    ok(/app install → [a-z0-9_-]+$/i.test((inst.out || []).join(' ').trim()) && !/ERR/.test((inst.out || []).join(' ')), 'the host puts the store Drawphone GIF in its store', inst.out);
    const run = await host.cmd('app run drawphone', 120000);
    ok(!/NOT in store|ERR/.test((run.out || []).join(' ')), 'the host runs Drawphone in the meeting', run.out);
    return until('every page mounts Drawphone', async () => {
      await Promise.all(all.map(ack));
      const s = await Promise.all(all.map((a) => app(a, '(() => !!document.getElementById("chip"))()')));
      return { ok: s.every((x) => x === true), detail: s };
    }, 150);
  }
  // A few strokes on the pad by pointer events (the same path a finger takes).
  const DRAW = (canvasId) => '(() => { const c = document.getElementById("' + canvasId + '"); if (!c || c.offsetParent === null) return "no pad"; const r = c.getBoundingClientRect(); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height, button: 0 })); for (const s of [[0.2,0.2,0.8,0.8],[0.8,0.2,0.2,0.8],[0.5,0.1,0.5,0.9]]) { ev("pointerdown", s[0], s[1]); for (let i = 1; i <= 12; i++) ev("pointermove", s[0] + (s[2]-s[0])*i/12, s[1] + (s[3]-s[1])*i/12); ev("pointerup", s[2], s[3]); } return "drew"; })()';
  const drawOld = (a) => app(a, DRAW('pad'));
  const draw = (a, id) => app(a, DRAW(id || 'pad'));
  return { ok, note, until, app, page, shot, shots, click, ack, runApp, drawOld, draw, roleOf };
}
module.exports = { make };
