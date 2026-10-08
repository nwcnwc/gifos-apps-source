/*
 * THE LAYER WORDS GET THE LAST WORD, NOT THE FIRST.
 *
 * Worldview rewrites each layer's status line ("Not in this file — this
 * layer needs a connection", "Nothing here on this day", ...) from the map's
 * frame callback, at most every 400 ms. The map only produces a frame when
 * something draws. Offline, with nothing cached, nothing ever draws: if the
 * one frame that follows "add this layer" lands inside the 400 ms window, the
 * refresh is skipped and no later frame ever arrives, so the row says nothing
 * for ever. e2e-worldview caught it 1 run in 3 on a slow box, on main and on
 * the release candidate alike.
 *
 * This lifts the throttle out of apps/worldview/app.js and drives it on a
 * fake clock: a call inside the window must still be honoured once the window
 * closes, a burst must cost one call per window, and a call after the window
 * is immediate. Red on the old app.js, which had no closing call.
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}
const a = src.indexOf('  // WV-THROTTLE'), b = src.indexOf('  // END-WV-THROTTLE');
check('the status throttle lifts out of apps/worldview/app.js', a > 0 && b > a);
if (a > 0 && b > a) {
  let now = 1000000;
  const timers = [];
  const clock = { now: () => now };
  const setT = (fn, ms) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; };
  const clearT = (t) => { if (t) t.live = false; };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      now = due.at; due.live = false; due.fn();
    }
    now = end;
  };
  const throttleTrailing = new Function('Date', 'setTimeout', 'clearTimeout',
    src.slice(a, b) + '\nreturn throttleTrailing;')(clock, setT, clearT);
  let calls = [];
  const tick = throttleTrailing(() => calls.push(now), 400);

  tick();
  check('the first frame refreshes at once', calls.length === 1, calls);
  advance(100);
  tick();                      // the frame after "add this layer", inside the window
  check('a frame inside the window does not refresh at once', calls.length === 1, calls);
  advance(1000);               // ...and no frame ever comes again (offline)
  check('…but the refresh still happens when the window closes, with no further frame', calls.length === 2 && calls[1] - calls[0] === 400, calls);

  calls = [];
  for (let i = 0; i < 10; i++) { advance(50); tick(); }   // a burst of frames over 500 ms
  advance(1000);
  check('a burst of frames costs one refresh per 400 ms window, the last one included', calls.length >= 2 && calls.length <= 3, calls.length);

  calls = [];
  advance(2000);
  tick();
  check('a frame after a quiet spell refreshes at once', calls.length === 1);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
