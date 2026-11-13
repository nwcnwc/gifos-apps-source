#!/usr/bin/env node
'use strict';
// Whiteboard room test: real browsers, one local meeting, the Whiteboard store app shared by seat A.
//
// Seats A (the sharer), B, C edit one board at the same time through the real UI (notes, freehand strokes with
// real pointer events, a dot vote, a template, moved notes), then the test measures convergence, a lost write
// (the sga-probe `__actDrop` lever, armed on the top page), a late joiner, the pptx / png / pdf exports and a
// phone-profile seat.
//
// gate2 pages: 4
// gate2 appsource: yes
//
// Run (the site must serve apps/whiteboard/whiteboard.gif, the relay is the repo's test/servers/relay-local.js):
//   WB_BASE=http://127.0.0.1:8099 WB_RELAY=ws://127.0.0.1:8790 WB_GIFOS=<path to the gifos repo> \
//   WB_OUT=<output dir> WB_SEED=7 [WB_MAXPAGES=3] node room-test.js
// Options (env, or --base/--relay/--gifos/--out/--seed/--maxpages on the command line):
//   WB_MAXPAGES  3 on a small box: seat C leaves before the late joiner D joins, and D leaves before the phone seat (default 4)
// Output: <out>/results.json, <out>/shots/*.png, <out>/traces/<seat>.{console.log,dump.json,wb.json}, <out>/board.pptx
// Prints `ok ...` / `FAIL ...` lines and `whiteboard-room: N passed, M failed`; exit status is non-zero on any failure.
// Every page runs with DEBUG=on (run.html#...&DEBUG=on), so the meeting keeps its debug trace.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const argv = {};
for (let i = 2; i < process.argv.length; i++) if (/^--/.test(process.argv[i])) { argv[process.argv[i].slice(2)] = process.argv[i + 1]; i++; }
const opt = (k, env, d) => argv[k] !== undefined ? argv[k] : (process.env[env] !== undefined ? process.env[env] : d);
const BASE = String(opt('base', 'WB_BASE', 'http://127.0.0.1:8099')).replace(/\/$/, '');
const RELAY = opt('relay', 'WB_RELAY', 'ws://127.0.0.1:8790');
const GIFOS = opt('gifos', 'WB_GIFOS', '');
const OUT = path.resolve(opt('out', 'WB_OUT', './whiteboard-room-out'));
const SEED = parseInt(opt('seed', 'WB_SEED', String(Date.now() % 100000)), 10) >>> 0;
const MAXP = parseInt(opt('maxpages', 'WB_MAXPAGES', '4'), 10);
if (!GIFOS) { console.log('FAIL setup: WB_GIFOS (the gifos repo path) is not set'); process.exit(2); }
const { chromium, CHROME } = require(path.join(GIFOS, 'test', 'lib', 'pw'));

fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'traces'), { recursive: true });

let passed = 0, failed = 0;
const T0 = Date.now();
const results = { seed: SEED, base: BASE, maxPages: MAXP, timings: {}, notes: [] };
function ok(cond, name, detail) {
  const d = detail === undefined ? '' : ' (' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) + ')';
  if (cond) { passed++; console.log('ok ' + name + d); } else { failed++; console.log('FAIL ' + name + d); }
  return !!cond;
}
function note(s) { results.notes.push(s); console.log('note ' + s); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => Math.round(ms / 100) / 10 + 's';
function rngFor(tag) {
  let h = SEED ^ 0x9e3779b9; for (const c of String(tag)) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  let a = h >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function until(fn, ms, every) {
  const t = Date.now();
  while (Date.now() - t < ms) { let v = false; try { v = await fn(); } catch (e) { v = false; } if (v) return v; await sleep(every || 250); }
  return false;
}

// ---- seats ---------------------------------------------------------------------------------------------
const NOTE_HEX = { yellow: '#ffec99', pink: '#fcc2d7', blue: '#a5d8ff', green: '#b2f2bb', orange: '#ffd8a8', purple: '#d0bfff' };
const PALETTE = [['yellow', 'green'], ['pink', 'orange'], ['blue', 'purple']]; // seat s only uses its own colours: a note's colour says who made it
const ROOM = 'wb' + SEED + 'x' + Date.now().toString(36);
const DEBUG_URL = (BASE + '/run.html#v=' + ROOM + '&relay=' + encodeURIComponent(RELAY) + '&DEBUG=on');
// The sga-probe lever (page, top frame only): while window.__actDrop > 0 the next 'act' frames this page broadcasts are lost.
const LEVER = "(function(){ if (window.top !== window) return; window.__actDropped = 0; var iv = setInterval(function(){ var S = window.GifOS && GifOS.meetStageData; if (!S || S.__wbp) return; S.__wbp = 1; clearInterval(iv); var ob = S.broadcast.bind(S); S.broadcast = function(sid, kind, d){ if (kind === 'act' && window.__actDrop > 0) { window.__actDrop--; window.__actDropped++; return 0; } return ob.apply(null, arguments); }; }, 5); })();";
// Wraps the engine's restoreElements (in the app frame, before any row arrives) to log every element whose `index`/version it changes.
const RESTORE_LOG = "(function(){ if (window.top === window) return; window.__restoreLog = { calls: 0, sortedIn: [], changed: [], err: '' }; var iv = setInterval(function(){ var L = window.ExcalidrawLib; if (!L || !L.restoreElements || L.__wbr) return; L.__wbr = 1; clearInterval(iv); var o = L.restoreElements; try { L.restoreElements = function(els, loc, opts){ var R = window.__restoreLog, before = {}, inIdx = []; (els || []).forEach(function(e){ before[e.id] = [e.index, e.version, e.versionNonce]; inIdx.push(e.index); }); var out = o.apply(this, arguments); R.calls++; var sorted = true; for (var k = 1; k < inIdx.length; k++) if (inIdx[k-1] != null && inIdx[k] != null && inIdx[k-1] > inIdx[k]) sorted = false; R.sortedIn.push([inIdx.length, sorted]); try { out.forEach(function(e){ var b = before[e.id]; if (b && (b[0] !== e.index || b[1] !== e.version)) { if (R.changed.length < 200) R.changed.push({ id: e.id.slice(0, 8), type: e.type, indexBefore: b[0], indexAfter: e.index, vBefore: b[1], vAfter: e.version }); } }); } catch (x) {} return out; }; if (L.restoreElements === o) window.__restoreLog.err = 'assignment ignored (engine object is read-only)'; } catch (e) { window.__restoreLog.err = String(e); } }, 2); })();";
let browser = null;
const seats = [];   // every seat ever opened
async function openSeat(name, phone) {
  const ctxOpt = { viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] };
  if (phone) Object.assign(ctxOpt, { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const ctx = await browser.newContext(ctxOpt);
  await ctx.addInitScript({ content: "try{localStorage.setItem('gifos_name'," + JSON.stringify(name) + ");localStorage.setItem('gifos_meet_bar','1');localStorage.setItem('gifos_relay'," + JSON.stringify(RELAY) + ")}catch(e){}try{sessionStorage.setItem('gifos_appear_ok','1')}catch(e){}window.__gifosLgReadOff=true;" });
  await ctx.addInitScript({ content: LEVER });
  await ctx.addInitScript({ content: RESTORE_LOG });
  const page = await ctx.newPage();
  const s = { name, ctx, page, log: [], fr: null, open: true, phone: !!phone };
  page.on('console', (m) => { s.log.push(new Date().toISOString() + ' ' + m.type() + ' ' + m.text().slice(0, 600)); if (s.log.length > 20000) s.log.shift(); });
  page.on('pageerror', (e) => s.log.push(new Date().toISOString() + ' PAGEERROR ' + String(e && e.message || e).slice(0, 600)));
  seats.push(s);
  return s;
}
async function joinSeat(s) {
  const t = Date.now();
  await s.page.goto(DEBUG_URL, { waitUntil: 'domcontentloaded' });
  await s.page.waitForFunction(() => !!(window.__gifosVideo && window.__gifosVideo.debugDump), null, { timeout: 60000 });
  const c = await until(() => s.page.evaluate(() => { try { return window.__gifosVideo.meshCoord(); } catch (e) { return null; } }), 120000, 500);
  s.joinMs = Date.now() - t;
  ok(!!c, 'seat ' + s.name + ' is seated in the meeting', c ? c.pc + '/' + c.r + '.' + c.i + ' after ' + secs(s.joinMs) : 'never seated');
  const dbg = await s.page.evaluate(() => typeof window.__gifosVideo.debugDump === 'function').catch(() => false);
  ok(dbg, 'seat ' + s.name + ' runs in DEBUG mode (debugDump hook present)');
  return !!c;
}
function liveFrames(s) { return s.page.frames().filter((f) => f !== s.page.mainFrame() && !f.isDetached()); }
// The app's frame (the one that holds window.__wb). The room lane may re-mount the app, so the frame is looked up again whenever the old one is gone.
async function getFrame(s, ms) {
  const t = Date.now();
  do {
    if (s.fr && !s.fr.isDetached()) { const alive = await s.fr.evaluate(() => !!(window.__wb && window.__wb.ex && window.__wb.ex())).catch(() => false); if (alive) return s.fr; s.fr = null; }
    for (const f of liveFrames(s)) { if (await f.evaluate(() => !!(window.__wb && window.__wb.ex && window.__wb.ex())).catch(() => false)) { s.fr = f; return f; } }
    await s.page.evaluate(() => { const b = document.querySelector('.perm-modal button.done, .perm-box button.done'); if (b) b.click(); }).catch(() => {});
    await sleep(300);
  } while (Date.now() - t < (ms || 0));
  return null;
}
async function q(s, fn, arg) {
  let last;
  for (let i = 0; i < 20; i++) {
    const f = await getFrame(s, 5000);
    if (f) { try { return await f.evaluate(fn, arg); } catch (e) { last = e; if (!/closed|destroyed|detached|Execution context|navigat/i.test(String(e.message))) throw e; } }
    await sleep(400);
  }
  throw new Error('no live app frame on ' + s.name + (last ? ': ' + last.message : ''));
}
async function mountApp(s, t0) {
  const f = await getFrame(s, 120000);
  const ms = Date.now() - t0;
  s.mountMs = ms;
  ok(!!f, 'seat ' + s.name + ' has the whiteboard frame with window.__wb', f ? 'mounted ' + secs(ms) + ' after the join started' : 'no frame');
  return !!f;
}
async function snap(s) {
  return q(s, () => {
    const w = window.__wb, st = document.getElementById('wb-status'), els = w.ex().getSceneElements();
    const fnv = (str) => { let h = 2166136261; for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619) >>> 0; return h.toString(16); };
    const place = fnv(els.map((e) => e.id + ':' + Math.round(e.x) + ',' + Math.round(e.y) + ',' + Math.round(e.width) + ',' + Math.round(e.height) + (e.frameId ? ':' + e.frameId : '')).sort().join(','));
    const sceneV = fnv(els.map((e) => e.id + ':' + e.version + ':' + e.versionNonce).sort().join(','));
    const mism = [];
    els.forEach((e) => { const b = w.board.get(e.id); if (!b || b.version !== e.version || b.versionNonce !== e.versionNonce) mism.push(e.id.slice(0, 8) + ' ' + e.type + ' scene v' + e.version + ':' + e.versionNonce + ' board ' + (b ? 'v' + b.version + ':' + b.versionNonce : 'none')); });
    return { hash: w.hash(), scene: place, sceneV: sceneV, mism: mism.slice(0, 6), nMism: mism.length, pending: w.sync.pending(), state: st && st.dataset.state, live: w.live(), puts: w.sync.stats.puts, dels: w.sync.stats.dels, resent: w.sync.stats.resent, healed: w.sync.stats.healed };
  });
}
const orderFn2 = () => window.__wb.ex().getSceneElements().map((e) => [e.id, e.index === undefined ? null : e.index]);
// z-order on every seat: the order of the ids and the `index` strings must be the same everywhere.
async function zStrict(label, list) {
  const os = []; for (const s of list) os.push(await q(s, orderFn2));
  const bad = [];
  for (let k = 1; k < os.length; k++) {
    const ids0 = os[0].map((x) => x[0]), idsK = os[k].map((x) => x[0]), ix0 = os[0].map((x) => x[1]).join(','), ixK = os[k].map((x) => x[1]).join(',');
    if (JSON.stringify(ids0) !== JSON.stringify(idsK) || ix0 !== ixK) {
      const diffs = []; os[0].forEach((x, n) => { if (!os[k][n] || os[k][n][0] !== x[0] || os[k][n][1] !== x[1]) diffs.push(n + ': ' + list[0].name + ' ' + x[0].slice(0, 8) + '/' + x[1] + ' vs ' + list[k].name + ' ' + (os[k][n] ? os[k][n][0].slice(0, 8) + '/' + os[k][n][1] : 'none')); });
      bad.push({ pair: list[0].name + ' vs ' + list[k].name, sameIds: JSON.stringify(ids0.slice().sort()) === JSON.stringify(idsK.slice().sort()), idOrderEqual: JSON.stringify(ids0) === JSON.stringify(idsK), indexEqual: ix0 === ixK, differingPositions: diffs.length, sample: diffs.slice(0, 6) });
    }
  }
  results.zStrict = results.zStrict || {}; results.zStrict[label] = { seats: list.map((x) => x.name), elements: os[0].length, bad: bad };
  ok(bad.length === 0, label + ': z-order strict: the id order and every `index` string equal on ' + list.map((x) => x.name).join(', ') + ' (' + os[0].length + ' elements)', bad.length ? bad : undefined);
  return bad.length === 0;
}
// Scene elements this page holds that its board does not (or holds at another version): what a seat never published.
const unsharedFn = () => { const w = window.__wb; return w.ex().getSceneElementsIncludingDeleted().filter((e) => { const b = w.board.best[e.id]; return !b || b.el.version !== e.version || b.el.versionNonce !== e.versionNonce; }).map((e) => ({ id: e.id.slice(0, 8), type: e.type, v: e.version, del: !!e.isDeleted, frame: !!e.frameId, pts: e.points ? e.points.length : 0, mine: !!(w.board.mine[e.id]), dirty: !!(w.board.mine[e.id] && w.board.mine[e.id].dirty) })); };
const localStrokesFn = () => { const w = window.__wb; return w.ex().getSceneElements().filter((e) => e.type === 'freedraw' && !(w.board.best[e.id] && !w.board.best[e.id].mine)).length; };
const placeFn = () => { const w = window.__wb, o = {}; w.ex().getSceneElements().forEach((e) => { const b = w.board.get(e.id); o[e.id.slice(0, 8)] = e.type + ' ' + Math.round(e.x) + ',' + Math.round(e.y) + ' ' + Math.round(e.width) + 'x' + Math.round(e.height) + ' fr=' + (e.frameId ? e.frameId.slice(0, 5) : '-') + ' | board ' + (b ? Math.round(b.x) + ',' + Math.round(b.y) + ' fr=' + (b.frameId ? b.frameId.slice(0, 5) : '-') + ' v' + b.version : 'none') + ' | scene v' + e.version; }); return o; };
async function sceneDiff(list) { const maps = []; for (const s of list) maps.push(await q(s, placeFn).catch(() => ({}))); const ids = {}; maps.forEach((m) => Object.keys(m).forEach((k) => { ids[k] = 1; })); const out = [];
  Object.keys(ids).forEach((id) => { const cut = (m) => m[id] ? m[id].split(' | ')[0] : 'absent'; if (!maps.every((m) => cut(m) === cut(maps[0]))) out.push(id + ' ' + list.map((s, i) => s.name + ': ' + (maps[i][id] || 'absent')).join('  //  ')); }); return out.slice(0, 8); }
async function unshared(list) { const o = {}; for (const s of list) { const u = await q(s, unsharedFn).catch((e) => 'ERR ' + e.message); if (u.length || typeof u === 'string') o[s.name] = u; } return o; }
const elsFn = () => { const o = {}, b = window.__wb.board.best; Object.keys(b).forEach((id) => { o[id.slice(0, 8)] = JSON.parse(JSON.stringify(b[id].el)); }); return o; };
const keysFn = () => { const o = {}, b = window.__wb.board.best; Object.keys(b).forEach((id) => { o[id.slice(0, 8)] = b[id].el.type + ' ' + b[id].el.version + ':' + b[id].el.versionNonce + (b[id].mine ? ' mine' : ''); }); return o; };
async function diffKeys(s1, s2) { const k1 = await q(s1, keysFn), k2 = await q(s2, keysFn), d = []; Object.keys(Object.assign({}, k1, k2)).forEach((id) => { if (k1[id] !== k2[id]) d.push(id + ' ' + s1.name + '=' + k1[id] + ' ' + s2.name + '=' + k2[id]); }); return d.slice(0, 8); }
const short = (h) => String(h).slice(0, 12);
// Poll (sync predicate) until every hash is equal, nothing is pending, every status is saved and every live count is equal and >= minLive.
// No wall-clock limit: it fails only when no hash changed for 60 s.
async function converge(label, list, minLive, extra) {
  const t0 = Date.now(); let lastChange = t0; const prev = {}; let snaps = [];
  for (;;) {
    snaps = await Promise.all(list.map((s) => snap(s).catch((e) => ({ hash: 'ERR ' + e.message, pending: -1, state: '', live: -1 }))));
    snaps.forEach((x, i) => { if (prev[list[i].name] !== x.hash + x.sceneV + x.scene) { prev[list[i].name] = x.hash + x.sceneV + x.scene; lastChange = Date.now(); } });
    const eq = snaps.every((x) => x.hash === snaps[0].hash);
    const done = eq && snaps.every((x) => x.pending === 0 && x.state === 'saved' && x.live === snaps[0].live && x.live >= minLive && x.scene === snaps[0].scene && x.sceneV === snaps[0].sceneV && x.nMism === 0) && (!extra || extra(snaps));
    if (done) { const ms = Date.now() - t0; ok(true, label + ': board hashes equal, scene copies equal by version and nonce, every scene element at its board version, scene places equal, nothing pending, status saved, live ' + snaps[0].live + ' on every seat', secs(ms) + ' hash ' + short(snaps[0].hash)); return { ok: true, ms, snaps }; }
    if (Date.now() - lastChange > 60000) {
      ok(false, label + ': no convergence (no hash changed for 60 s)', list.map((s, i) => s.name + ' hash=' + snaps[i].hash + ' sceneV=' + snaps[i].sceneV + ' place=' + snaps[i].scene + ' scene!=board: ' + JSON.stringify(snaps[i].mism) + ' pending=' + snaps[i].pending + ' state=' + snaps[i].state + ' live=' + snaps[i].live).join(' | '));
      const sd = await sceneDiff(list); console.log('  scene places that differ between seats: ' + JSON.stringify(sd)); results.sceneDiff = results.sceneDiff || {}; results.sceneDiff[label] = sd;
      const un = await unshared(list); console.log('  scene elements not in the page\'s own board: ' + JSON.stringify(un)); results.unshared = results.unshared || {}; results.unshared[label] = un;
      return { ok: false, ms: Date.now() - t0, snaps };
    }
    await sleep(400);
  }
}

// ---- board helpers (inside the app frame) -----------------------------------------------------------------
const countsFn = (hex) => {
  const els = window.__wb.ex().getSceneElements(), c = { note: 0, freedraw: 0, dot: 0, frame: 0, mine: 0, all: els.length };
  els.forEach((e) => { if (e.type === 'rectangle' && e.customData && e.customData.wb === 'note') { c.note++; if (hex.indexOf(e.backgroundColor) >= 0) c.mine++; } else if (e.type === 'freedraw') c.freedraw++; else if (e.type === 'frame') c.frame++; if (e.customData && e.customData.wb === 'dot') c.dot++; });
  return c;
};
const myHex = (s) => PALETTE[s.idx].map((n) => NOTE_HEX[n]);
const counts = (s) => q(s, countsFn, myHex(s));
async function addNoteUI(s, color) {
  const before = (await counts(s)).mine;
  const fr = await getFrame(s, 30000);
  await fr.locator('#wb-note').click({ timeout: 20000 });
  await fr.locator('#wb-note-' + color).click({ timeout: 20000 });
  const got = await until(async () => (await counts(s)).mine === before + 1, 10000, 150);
  if (!got) throw new Error(s.name + ': the ' + color + ' note did not appear');
}
// scene point -> page coordinates (frame element box + engine viewport coordinates)
async function toPage(s, sx, sy) {
  const fr = await getFrame(s, 10000);
  const box = await (await fr.frameElement()).boundingBox();
  const r = await fr.evaluate((p) => { const st = window.__wb.ex().getAppState(), z = st.zoom.value, cx = (p.x + st.scrollX) * z + st.offsetLeft, cy = (p.y + st.scrollY) * z + st.offsetTop; const hit = document.elementFromPoint(cx, cy); return { cx, cy, hit: hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : null }; }, { x: sx, y: sy });
  return { x: box.x + r.cx, y: box.y + r.cy, hit: r.hit };
}
async function viewportToPage(s, vx, vy) { const fr = await getFrame(s, 10000); const box = await (await fr.frameElement()).boundingBox(); return { x: box.x + vx, y: box.y + vy }; }
async function pickTool(s, tool) {
  const fr = await getFrame(s, 10000);
  await fr.locator('[data-testid="toolbar-' + tool + '"]').click({ timeout: 5000 }).catch(() => {});
  let cur = await q(s, () => window.__wb.ex().getAppState().activeTool.type);
  if (cur !== tool) { s.toolFallback = (s.toolFallback || 0) + 1; await q(s, (t) => { window.__wb.ex().setActiveTool({ type: t }); }, tool); cur = await q(s, () => window.__wb.ex().getAppState().activeTool.type); }
  return cur === tool;
}
// A visible point on a note that is the top-most shape there, on the canvas (not under the engine's panels or the rail): { id, vx, vy } in app-frame viewport coordinates.
const grabFn = (a) => {
  const ex = window.__wb.ex(), st = ex.getAppState(), z = st.zoom.value, W = innerWidth, H = innerHeight, els = ex.getSceneElements();
  const vis = { l: 240, t: 190, r: W - 90, b: H - 30 }, cx = (vis.l + vis.r) / 2, cy = (vis.t + vis.b) / 2, c = [];
  for (let vx = vis.l; vx <= vis.r; vx += 24) for (let vy = vis.t; vy <= vis.b; vy += 24) {
    const sx = (vx - st.offsetLeft) / z - st.scrollX, sy = (vy - st.offsetTop) / z - st.scrollY; let top = null;
    els.forEach((e) => { if (sx >= e.x && sx <= e.x + e.width && sy >= e.y && sy <= e.y + e.height && e.type !== 'freedraw') top = e.type === 'text' && e.containerId ? { id: e.containerId } : e; });
    if (!top || a.ids.indexOf(top.id) < 0) continue;
    const el = els.find((e) => e.id === top.id), nx = (sx - el.x) / el.width, ny = (sy - el.y) / el.height;
    if (nx < 0.08 || nx > 0.92 || ny < 0.08 || ny > 0.92) continue;           // not on an edge handle
    const hit = document.elementFromPoint(vx, vy);
    if (hit && hit.tagName === 'CANVAS') c.push({ id: top.id, vx: vx, vy: vy, W: W, H: H, d: Math.abs(vx - cx) + Math.abs(vy - cy) });
  }
  c.sort((p, q2) => p.d - q2.d);
  return c.filter((_, i) => i % 5 === 0).slice(0, 12);
};
// Draw one freehand stroke (row picks the height) over the middle of the canvas, with the real pointer, inside the app frame's own area.
async function stroke(s, row, rnd) {
  if (!(await pickTool(s, 'freedraw'))) throw new Error(s.name + ': could not select the freedraw tool');
  const before = await q(s, localStrokesFn);
  const dim = await q(s, () => ({ w: innerWidth, h: innerHeight }));
  const x0 = dim.w * 0.42, y0 = 200 + row * 48, len = dim.w * 0.3;
  const p0 = await viewportToPage(s, x0, y0), page = s.page;
  await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  const amp = 8 + rnd() * 10;
  for (let i = 1; i <= 14; i++) await page.mouse.move(p0.x + i * len / 14, p0.y + Math.sin(i / 2) * amp, { steps: 2 });
  await page.mouse.up();
  const got = await until(async () => (await q(s, localStrokesFn)) >= before + 1, 8000, 150);
  if (!got) throw new Error(s.name + ': the stroke did not become a freedraw element');
}
const bumpFn = (a) => {
  const id = a.id, dx = a.dx, dy = a.dy, ex = window.__wb.ex(), all = ex.getSceneElementsIncludingDeleted(), t = all.find((e) => e.id === id); if (!t) return false;
  const bumped = (e, p) => Object.assign({}, e, p, { version: e.version + 1, versionNonce: (Math.random() * 2147483647) | 0, updated: Date.now() });
  const next = all.map((e) => e.id === id ? bumped(e, { x: e.x + dx, y: e.y + dy }) : (e.type === 'text' && e.containerId === id ? bumped(e, { x: e.x + dx, y: e.y + dy }) : e));
  ex.updateScene({ elements: next, captureUpdate: 'IMMEDIATELY' });
  return true;
};
const noteOf = (hex) => window.__wb.ex().getSceneElements().filter((e) => e.type === 'rectangle' && e.customData && e.customData.wb === 'note' && hex.indexOf(e.backgroundColor) >= 0).map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.width, h: e.height }));

// One seat's work: its notes and strokes in a seeded order with seeded delays, then its vote and its move of another seat's note.
async function seatOps(s, plan) {
  const rnd = rngFor('ops' + s.name);
  const ops = shuffle(['note', 'note', 'note', 'stroke', 'stroke'], rnd);
  const log = [];
  await sleep(rnd() * 800);
  let strokeN = 0, noteN = 0;
  for (const op of ops) {
    if (op === 'note') { await addNoteUI(s, PALETTE[s.idx][noteN % 2]); noteN++; }
    else { await stroke(s, s.idx * 2 + strokeN, rnd); strokeN++; }
    log.push(op);
    await sleep(60 + rnd() * 340);
  }
  if (plan.voter === s.idx) {
    const mine = await q(s, noteOf, myHex(s));
    await q(s, (id) => { window.__wb.ex().updateScene({ appState: { selectedElementIds: { [id]: true } } }); }, mine[0].id);
    plan.votedId = mine[0].id;
    const fr = await getFrame(s, 10000); await fr.locator('#wb-vote').click({ timeout: 20000 });
    const dots = await until(() => q(s, (id) => window.__wb.ex().getSceneElements().filter((e) => e.customData && e.customData.wb === 'dot' && e.customData.on === id).length, plan.votedId), 8000, 150);
    ok(!!dots, 'seat ' + s.name + ' voted: a dot is on its note (real click on #wb-vote)');
    log.push('vote');
  }
  // Move a note ANOTHER seat made, through the engine API (the real pointer drag has its own quiet step after the edits).
  const target = (s.idx + 1) % 3, tHex = PALETTE[target].map((n) => NOTE_HEX[n]);
  const there = await until(async () => (await q(s, noteOf, tHex)).length >= 1, 60000, 300);
  if (!there) throw new Error(s.name + ': no note of seat ' + 'ABC'[target] + ' arrived to move');
  const tn = (await q(s, noteOf, tHex))[0];
  await q(s, bumpFn, { id: tn.id, dx: 60, dy: 40 }); plan.moved = (plan.moved || []).concat(tn.id); log.push('move-api');
  return log;
}

// ---- zip / xml checks (copied from test-export.js) --------------------------------------------------------------
const dec = new TextDecoder();
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.length); let e = u8.length - 22; const out = [];
  if (dv.getUint32(e, true) !== 0x06054b50) throw new Error('no end record');
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    const meth = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('bad local header');
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, meth, data: u8.subarray(ds, ds + cs) });
    p += 46 + nl + el + cl;
  }
  return out;
}
function wellFormed(s) {
  let i = 0, m, m2; const stack = []; let roots = 0;
  if (s.indexOf('<?xml') === 0) { i = s.indexOf('?>'); if (i < 0) return 'bad decl'; i += 2; }
  const ent = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
  while (i < s.length) {
    const lt = s.indexOf('<', i), txt = s.slice(i, lt < 0 ? s.length : lt);
    if (txt.replace(ent, '').indexOf('&') >= 0) return 'stray & in text';
    if (txt.indexOf('>') >= 0) return 'stray > in text';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(txt)) return 'illegal char';
    if (stack.length === 0 && txt.trim()) return 'text outside root';
    if (lt < 0) break;
    const gt = s.indexOf('>', lt); if (gt < 0) return 'unterminated tag';
    const tag = s.slice(lt + 1, gt);
    if (tag[0] === '/') { const nm = tag.slice(1).trim(); if (stack.pop() !== nm) return 'unbalanced </' + nm + '>'; }
    else {
      const self = tag[tag.length - 1] === '/', inner = self ? tag.slice(0, -1) : tag;
      m = /^([A-Za-z_][\w.:-]*)/.exec(inner); if (!m) return 'bad tag ' + tag.slice(0, 30);
      let rest = inner.slice(m[0].length); const seen = {};
      const re = /^\s+([A-Za-z_][\w.:-]*)="([^"<&]*(?:&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);[^"<&]*)*)"/;
      while ((m2 = re.exec(rest))) { if (seen[m2[1]]) return 'dup attr ' + m2[1]; seen[m2[1]] = 1; rest = rest.slice(m2[0].length); }
      if (rest.trim()) return 'bad attributes: ' + rest.slice(0, 40);
      if (stack.length === 0) roots++;
      if (!self) stack.push(inner.match(/^[^\s]+/)[0]);
    }
    i = gt + 1;
  }
  if (stack.length) return 'unclosed ' + stack.pop();
  return roots === 1 ? '' : 'roots=' + roots;
}
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (u8) => PNG_SIG.every((b, i) => u8[i] === b);
const pngDims = (u8) => ({ w: (u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19]) >>> 0, h: (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0 });

async function buildBytes(s, kind) {
  const r = await q(s, async (k) => {
    const t = performance.now(); const b = await window.__wb.build[k](); let str = '';
    for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return { ms: Math.round(performance.now() - t), b64: btoa(str) };
  }, kind);
  return { ms: r.ms, bytes: new Uint8Array(Buffer.from(r.b64, 'base64')) };
}
// What the pptx must hold. want: { slides, ink: 'one'|'some', votes, noteText, noteHex, notes }
function checkPptx(label, file, bytes, want) {
  let ents = [];
  try { ents = readZip(bytes); } catch (e) { return ok(false, label + ': zip reads', e.message); }
  const P = {}; ents.forEach((e) => { P[e.name] = e; });
  const names = ents.map((e) => e.name), txt = (n) => dec.decode(P[n].data);
  ok(names[0] === '[Content_Types].xml', label + ': [Content_Types].xml is the first part');
  const bad = names.filter((n) => /\.(xml|rels)$/.test(n)).map((n) => [n, wellFormed(txt(n))]).filter((x) => x[1]);
  ok(!bad.length, label + ': every xml and rels part is well-formed (' + names.filter((n) => /\.(xml|rels)$/.test(n)).length + ' parts)', bad.slice(0, 3));
  const slideNames = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const pres = P['ppt/presentation.xml'] ? txt('ppt/presentation.xml') : '';
  ok(slideNames.length === want.slides && (pres.match(/<p:sldId /g) || []).length === want.slides, label + ': ' + want.slides + ' slide(s): one per frame' + (want.slides === 1 && !want.framed ? ' (no frame: one slide for the whole board)' : ''), { slides: slideNames.length, sldIds: (pres.match(/<p:sldId /g) || []).length });
  const sl = slideNames.map((n) => txt(n)), all = sl.join('\n');
  ok(sl.every((x) => /<p:sp>/.test(x)), label + ': every slide has <p:sp> shapes');
  const rects = (all.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((b) => /prst="rect"/.test(b) && /<a:solidFill>/.test(b));
  ok(rects.length >= (want.notes || 1), label + ': rect shapes with a solid fill', rects.length + ' (want >= ' + (want.notes || 1) + ')');
  const withText = rects.filter((b) => b.indexOf('<a:t>' + esc(want.noteText) + '</a:t>') >= 0);
  ok(withText.length >= 1 && withText.some((b) => b.toUpperCase().indexOf(want.noteHex.slice(1).toUpperCase()) >= 0), label + ': a note shape carries the note text and its solid fill colour', { text: want.noteText, withText: withText.length, hex: want.noteHex });
  const dotsShape = (all.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((b) => b.indexOf('●') >= 0);
  ok(dotsShape.length === 1 && (all.match(/●/g) || []).length === want.votes && dotsShape[0].indexOf('<a:t>' + esc(want.noteText) + '</a:t>') >= 0, label + ': the voted note carries the dot paragraph (' + want.votes + ' dot)', { shapesWithDot: dotsShape.length, dots: (all.match(/●/g) || []).length });
  const pics = (all.match(/<p:pic>/g) || []).length, media = names.filter((n) => /^ppt\/media\/.*\.png$/.test(n));
  const rels = slideNames.map((n) => txt(n.replace('slides/', 'slides/_rels/') + '.rels')).join('\n');
  ok(want.ink === 'one' ? pics === 1 && media.length === 1 : pics >= 1 && media.length >= 1, label + ': ' + (want.ink === 'one' ? 'the strokes are ONE ink picture' : 'at least one ink <p:pic>') + ' with a PNG media part', { pics, media });
  ok(media.length > 0 && media.every((n) => isPng(P[n].data) && /image\/png/.test(txt('[Content_Types].xml')) && rels.indexOf(n.replace('ppt/', '../')) >= 0), label + ': every media part is a PNG named by a slide rels part', media.map((n) => n + ' ' + JSON.stringify(pngDims(P[n].data))));
  if (media.length) note(label + ': ink picture ' + media.map((n) => JSON.stringify(pngDims(P[n].data))).join(','));
  try { const z = cp.spawnSync('unzip', ['-tq', file]); if (z.error) note(label + ': unzip not found, skipped unzip -tq'); else ok(z.status === 0, label + ': unzip -tq accepts the file', String(z.stdout).trim()); } catch (e) { note('unzip -tq not run: ' + e.message); }
}

async function shot(s, name) { await sleep(600); const f = path.join(OUT, 'shots', name + '.png'); await s.page.screenshot({ path: f }).catch((e) => note('shot ' + name + ' failed: ' + e.message)); return f; }
async function saveTrace(s) {
  const base = path.join(OUT, 'traces', s.name);
  try { fs.writeFileSync(base + '.console.log', s.log.join('\n') + '\n'); } catch (e) {}
  try { const d = await s.page.evaluate(() => { try { return JSON.stringify(window.__gifosVideo.debugDump()); } catch (e) { return JSON.stringify({ err: String(e) }); } }); fs.writeFileSync(base + '.dump.json', d); } catch (e) {}
  try { const f = await getFrame(s, 0); const w = await f.evaluate(() => ({ hash: window.__wb.hash(), live: window.__wb.live(), stats: window.__wb.sync.stats, pending: window.__wb.sync.pending() })); w.actDropped = await s.page.evaluate(() => window.__actDropped).catch(() => null); fs.writeFileSync(base + '.wb.json', JSON.stringify(w, null, 1)); } catch (e) {}
}
async function closeSeat(s) { if (!s.open) return; await saveTrace(s); s.open = false; await s.ctx.close().catch(() => {}); }
const openSeats = () => seats.filter((s) => s.open && !s.phone && s.idx !== undefined);

// One real pointer drag of a note another seat made, from seat s, on a quiet board. Returns true when the pointer moved such a note.
async function pointerDrag(s, plan) {
  const others = PALETTE.filter((_, i) => i !== s.idx).reduce((acc, p2) => acc.concat(p2.map((n) => NOTE_HEX[n])), []);
  const cands = await q(s, grabFn, { ids: (await q(s, noteOf, others)).map((n) => n.id) });
  let grab = null;
  await pickTool(s, 'selection');
  // The engine decides what is under the pointer: click candidate points until the selection is a note of another seat, then drag from there.
  for (const c0 of cands) {
    const pt = await viewportToPage(s, c0.vx, c0.vy);
    await s.page.mouse.click(pt.x, pt.y);
    const sel = await q(s, (a2) => { const ex = window.__wb.ex(), ids = Object.keys(ex.getAppState().selectedElementIds); return ex.getSceneElements().filter((e) => ids.indexOf(e.id) >= 0 && e.type === 'rectangle' && e.customData && e.customData.wb === 'note' && a2.own.indexOf(e.backgroundColor) < 0).length; }, { own: myHex(s) });
    if (sel > 0) { grab = c0; break; }
  }
  if (!grab) { note('seat ' + s.name + ': no note of another seat showing at a clickable point, no pointer drag from this seat'); return false; }
  const a = await viewportToPage(s, grab.vx, grab.vy), dir = grab.vx > grab.W / 2 ? -1 : 1, b = { x: a.x + dir * 110, y: a.y + (grab.vy > grab.H / 2 ? -70 : 70) };
  const zoomNow = await q(s, () => window.__wb.ex().getAppState().zoom.value), want = { dx: (b.x - a.x) / zoomNow, dy: (b.y - a.y) / zoomNow };
  const posBefore = await q(s, () => { const o = {}; window.__wb.ex().getSceneElements().forEach((e) => { o[e.id] = [e.x, e.y]; }); return o; });
  await s.page.mouse.move(a.x, a.y); await s.page.mouse.down(); await s.page.mouse.move(b.x, b.y, { steps: 14 }); await s.page.mouse.up();
  const movedNotes = () => q(s, (a2) => window.__wb.ex().getSceneElements().filter((e) => e.type === 'rectangle' && e.customData && e.customData.wb === 'note' && a2.own.indexOf(e.backgroundColor) < 0 && a2.pb[e.id] && Math.abs(e.x - a2.pb[e.id][0] - a2.want.dx) < 3 && Math.abs(e.y - a2.pb[e.id][1] - a2.want.dy) < 3).map((e) => e.id), { pb: posBefore, own: myHex(s), want: want });
  const gotMoved = await until(async () => (await movedNotes()).length > 0 ? await movedNotes() : false, 6000, 150);
  let why = '';
  if (!gotMoved) why = JSON.stringify(await q(s, (a2) => { const ex = window.__wb.ex(), o = { want: a2.want, moved: {} }; ex.getSceneElements().forEach((e) => { const p0 = a2.pb[e.id]; if (p0 && (Math.abs(e.x - p0[0]) > 1 || Math.abs(e.y - p0[1]) > 1)) o.moved[e.id.slice(0, 6) + ':' + e.type + ':' + (e.backgroundColor || '')] = Math.round(e.x - p0[0]) + ',' + Math.round(e.y - p0[1]); }); o.selected = Object.keys(ex.getAppState().selectedElementIds).map((x) => x.slice(0, 6)); return o; }, { pb: posBefore, want: want }));
  ok(!!gotMoved, 'seat ' + s.name + ' dragged a note another seat made with the real pointer (quiet board)', gotMoved ? { movedNotes: gotMoved.length, zoom: zoomNow } : why);
  if (gotMoved) { plan.drags = (plan.drags || 0) + 1; plan.moved = (plan.moved || []).concat(gotMoved[0]); }
  return !!gotMoved;
}

// ---- the run ---------------------------------------------------------------------------------------------------
(async () => {
  console.log('whiteboard-room seed=' + SEED + ' room=' + ROOM + ' base=' + BASE + ' maxpages=' + MAXP);
  const plan = { voter: Math.floor(rngFor('voter')() * 3) };
  plan.template = (plan.voter + 1) % 3; plan.painter = (plan.voter + 2) % 3;
  console.log('plan voter=' + 'ABC'[plan.voter] + ' template=' + 'ABC'[plan.template] + ' framePainter=' + 'ABC'[plan.painter]);
  browser = await chromium.launch({
    headless: true, executablePath: CHROME, ignoreDefaultArgs: ['--disable-dev-shm-usage'],
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-audio-output',
      '--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests']
  });
  const NAMES = ['WbAda', 'WbBen', 'WbCyd'];
  // 1. A joins and shares the app; B and C join and get it
  const seatObjs = [];
  for (let i = 0; i < 3; i++) { const s = await openSeat(NAMES[i]); s.idx = i; seatObjs.push(s); }
  const [a, b, c] = seatObjs;
  const tA = Date.now();
  if (!(await joinSeat(a))) throw new Error('A did not seat');
  const inst = await a.page.evaluate(async () => {
    const res = await fetch('/apps/whiteboard/whiteboard.gif'); if (!res.ok) return 'ERR http ' + res.status;
    const bytes = new Uint8Array(await res.arrayBuffer()); const st = window.GifOS.store;
    const id = st.uid('file'); await st.putFile({ id, name: 'whiteboard.gif', bytes, kind: 'gif', isApp: true, appId: 'whiteboard', mime: 'image/gif' });
    window.__wbFile = { id, size: bytes.length };
    const dg = await crypto.subtle.digest('SHA-256', bytes); window.__wbSha = Array.from(new Uint8Array(dg)).map((x) => x.toString(16).padStart(2, '0')).join('');
    await window.__gifosVideo.runAppForTest(id, 'Whiteboard'); return 'ok ' + bytes.length;
  }).catch((e) => 'ERR ' + e.message);
  ok(/^ok /.test(inst), 'seat A installed whiteboard.gif from the site and shared it to the meeting', inst);
  const servedSha = await a.page.evaluate(() => window.__wbSha), wantSha = process.env.WB_GIF_SHA || '';
  results.servedSha = servedSha;
  if (wantSha) ok(servedSha === wantSha, 'the bytes the site served as apps/whiteboard/whiteboard.gif have sha256 ' + wantSha, servedSha); else note('served whiteboard.gif sha256 ' + servedSha);
  // What does the runtime say about the app's signature? Read the stored file record (without its bytes), the page text and the GifOS object.
  results.signature = await a.page.evaluate(async () => {
    const out = { record: null, pageText: [], gifosKeys: [], appBar: null };
    try { const f = (await window.GifOS.store.allFiles()).find((x) => x.isApp && x.appId === 'whiteboard'); if (f) { const r = {}; Object.keys(f).forEach((k) => { r[k] = (f[k] && f[k].byteLength !== undefined) ? ('<' + f[k].byteLength + ' bytes>') : f[k]; }); out.record = r; } } catch (e) { out.record = 'ERR ' + e; }
    try { out.pageText = document.body.innerText.split('\n').filter((l) => /sign|verif|trust|gifos\.app|publisher|unverified/i.test(l)).slice(0, 12); } catch (e) {}
    try { out.gifosKeys = Object.keys(window.GifOS).filter((k) => /sign|verif|trust/i.test(k)); } catch (e) {}
    try { const b = document.getElementById('appbar') || document.querySelector('.appbar, #apphdr, [id*=appbar]'); out.appBar = b ? b.innerText.slice(0, 200) : null; } catch (e) {}
    return out;
  }).catch((e) => ({ err: String(e) }));
  note('signature observation (seat A, top page): ' + JSON.stringify(results.signature).slice(0, 1500));
  await mountApp(a, tA);
  const hostInfo = (s) => s.page.evaluate(() => ({ active: !!window.__gifosVideo.appActive(), name: window.__gifosVideo.appName(), host: window.__gifosVideo.appIsHost() }));
  const ha = await hostInfo(a); ok(ha.active && ha.host && /whiteboard/i.test(ha.name), 'seat A is the app host', ha);
  const tBC = Date.now();
  await Promise.all([b, c].map(async (s) => { await joinSeat(s); await mountApp(s, tBC); }));
  for (const s of [b, c]) { const h = await hostInfo(s); ok(h.active && !h.host && /whiteboard/i.test(h.name), 'seat ' + s.name + ' has the shared app and is not its host', h); }
  // the roster fills a moment after the seat does: poll (no fixed limit; fails only when the dump stops changing for 30 s)
  for (const s of seatObjs) {
    let last = '', lastChange = Date.now(), seen = false;
    for (;;) {
      const dump = await s.page.evaluate(() => JSON.stringify(window.__gifosVideo.debugDump())).catch(() => '');
      if (NAMES.filter((n) => n !== s.name).every((n) => dump.indexOf(n) >= 0)) { seen = true; break; }
      if (dump !== last) { last = dump; lastChange = Date.now(); }
      if (Date.now() - lastChange > 30000) break;
      await sleep(500);
    }
    ok(seen, 'seat ' + s.name + ' sees the other two in the meeting (debugDump roster)');
  }
  results.timings.mountMs = { A: a.mountMs, B: b.mountMs, C: c.mountMs };
  results.timings.joinMs = { A: a.joinMs, B: b.joinMs, C: c.joinMs };
  const c0 = await converge('empty board', seatObjs, 0);

  // 2. everyone edits at once
  const tEdit = Date.now();
  const outs = await Promise.all(seatObjs.map((s) => seatOps(s, plan).then((l) => ({ s: s.name, log: l }), (e) => { ok(false, 'seat ' + s.name + ' editing', e.message); return null; })));
  console.log('ops ' + JSON.stringify(outs));
  results.timings.editMs = Date.now() - tEdit;
  // 3. convergence: 9 notes x 2 elements + 6 strokes + 1 dot
  const cv1 = await converge('after concurrent edits', seatObjs, 25);
  const cn = await counts(a);
  ok(cn.note === 9 && cn.freedraw === 6 && cn.dot === 1, 'the board holds 9 notes, 6 strokes, 1 dot', cn);
  results.timings.convergeMs = cv1.ms;
  for (const s of [c, a, b]) { if (await pointerDrag(s, plan)) break; }
  await converge('after the pointer drag', seatObjs, 25);
  await zStrict('after the concurrent edits', seatObjs);
  results.realDrags = plan.drags || 0;
  ok((plan.drags || 0) >= 1, 'at least one real pointer drag of another seat\'s note happened', { drags: plan.drags || 0, ops: outs.map((o) => o && o.log.join('>')) });
  const moved = await q(a, (ids) => ids.map((id) => { const e = window.__wb.ex().getSceneElements().find((x) => x.id === id); return e ? Math.round(e.x) + ',' + Math.round(e.y) : null; }), (plan.moved || []).filter(Boolean));
  const movedB = await q(b, (ids) => ids.map((id) => { const e = window.__wb.ex().getSceneElements().find((x) => x.id === id); return e ? Math.round(e.x) + ',' + Math.round(e.y) : null; }), (plan.moved || []).filter(Boolean));
  ok(JSON.stringify(moved) === JSON.stringify(movedB) && moved.every(Boolean), 'the moved notes sit at the same place on A and B', { A: moved, B: movedB });

  // 6a. export with NO frame on the board: one slide, the 6 strokes as one ink picture, notes as shapes, the vote's dot paragraph
  const noteText = await q(a, (id) => { const e = window.__wb.ex().getSceneElements().find((x) => x.type === 'text' && x.containerId === id); return e ? (e.originalText || e.text) : ''; }, plan.votedId);
  const votedHex = await q(a, (id) => window.__wb.ex().getSceneElements().find((x) => x.id === id).backgroundColor, plan.votedId);
  const nf = await buildBytes(a, 'pptx'); fs.writeFileSync(path.join(OUT, 'board-noframe.pptx'), nf.bytes);
  results.timings.pptxNoFrame = { ms: nf.ms, bytes: nf.bytes.length };
  checkPptx('pptx (no frame)', path.join(OUT, 'board-noframe.pptx'), nf.bytes, { slides: 1, framed: false, ink: 'one', votes: 1, noteText, noteHex: votedHex, notes: 9 });
  for (const s of seatObjs) await shot(s, 'seat-' + s.name + '-after-edits');

  // 2b. a template (seat T), then the voted note dragged into the frame (voter) and a stroke inside it (painter)
  const T = seatObjs[plan.template], V = seatObjs[plan.voter], F = seatObjs[plan.painter];
  const base = (await snap(a)).live;
  const frT = await getFrame(T, 10000);
  await frT.locator('#wb-tpl').click({ timeout: 20000 }); await frT.locator('#wb-tpl-brainstorm').click({ timeout: 20000 });
  const cv2 = await converge('after the Brainstorm template', seatObjs, base + 2);
  const frameInfo = await q(a, () => window.__wb.ex().getSceneElements().filter((e) => e.type === 'frame').map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.width, h: e.height, name: e.name })));
  ok(frameInfo.length === 1, 'the Brainstorm template made one frame', frameInfo);
  const fr0 = frameInfo[0]; results.timings.templateElements = cv2.snaps[0].live - base;
  // let the animated scroll to the new frame settle on both working seats
  for (const s of [V, F]) await until(async () => { const p1 = await q(s, () => { const st = window.__wb.ex().getAppState(); return st.scrollX + ',' + st.scrollY + ',' + st.zoom.value; }); await sleep(450); const p2 = await q(s, () => { const st = window.__wb.ex().getAppState(); return st.scrollX + ',' + st.scrollY + ',' + st.zoom.value; }); return p1 === p2; }, 15000, 100);
  // voter drags its voted note (with its dot) into the middle column of the frame (the view first shows both)
  await pickTool(V, 'selection');
  await q(V, (a2) => { const ex = window.__wb.ex(); ex.scrollToContent(ex.getSceneElements().filter((e) => e.id === a2.id || e.id === a2.frame), { fitToViewport: true, viewportZoomFactor: 0.75, animate: false }); }, { id: plan.votedId, frame: fr0.id });
  await sleep(500);
  const grabV = (await q(V, grabFn, { ids: [plan.votedId] }))[0] || null;
  let inFrame = false;
  if (grabV) {
    const from = await viewportToPage(V, grabV.vx, grabV.vy), tgt = await q(V, (a2) => { const st = window.__wb.ex().getAppState(), z = st.zoom.value; return { vx: (a2.x + st.scrollX) * z + st.offsetLeft, vy: (a2.y + st.scrollY) * z + st.offsetTop }; }, { x: fr0.x + 520, y: fr0.y + 220 });
    const to = await viewportToPage(V, tgt.vx, tgt.vy);
    await V.page.mouse.move(from.x, from.y); await V.page.mouse.down(); await V.page.mouse.move(to.x, to.y, { steps: 18 }); await V.page.mouse.up();
    inFrame = await until(() => q(V, (a2) => { const e = window.__wb.ex().getSceneElements().find((x) => x.id === a2.id); return !!(e && e.frameId === a2.frame); }, { id: plan.votedId, frame: fr0.id }), 6000, 200);
  } else note('the voted note was not top-most and visible: no pointer drag into the frame');
  if (!inFrame) {
    note('the voted note did not get into the frame by a pointer drag (frameId unset); moved it into the frame through the engine API');
    await q(V, (a2) => { const ex = window.__wb.ex(), all = ex.getSceneElementsIncludingDeleted(), id = a2.id; const n = all.find((x) => x.id === id);
      const dx = a2.fx - n.x, dy = a2.fy - n.y, g = n.groupIds || [];
      const nx = all.map((e) => (e.id === id || (e.containerId === id) || (e.customData && e.customData.on === id) || (g.length && e.groupIds && e.groupIds.indexOf(g[g.length - 1]) >= 0 && e.type !== 'frame')) ? Object.assign({}, e, { x: e.x + dx, y: e.y + dy, frameId: a2.frame, version: e.version + 1, versionNonce: (Math.random() * 2147483647) | 0, updated: Date.now() }) : e);
      ex.updateScene({ elements: nx, captureUpdate: 'IMMEDIATELY' }); }, { id: plan.votedId, frame: fr0.id, fx: fr0.x + 520, fy: fr0.y + 220 });
    inFrame = true; results.noteIntoFrame = 'api';
  } else results.noteIntoFrame = 'pointer';
  ok(inFrame, 'the voted note is inside the Brainstorm frame (' + results.noteIntoFrame + ')');
  // painter draws one stroke inside the frame, over the empty bottom of the middle column
  await pickTool(F, 'freedraw');
  await q(F, (a2) => { const ex = window.__wb.ex(); ex.scrollToContent(ex.getSceneElements().filter((e) => e.id === a2.frame), { fitToViewport: true, viewportZoomFactor: 0.7, animate: false }); }, { frame: fr0.id });
  await sleep(500);
  const sp = await toPage(F, fr0.x + 480, fr0.y + 560), spLen = await q(F, () => innerWidth * 0.2);
  await F.page.mouse.move(sp.x, sp.y); await F.page.mouse.down();
  for (let i = 1; i <= 12; i++) await F.page.mouse.move(sp.x + i * spLen / 12, sp.y + Math.sin(i / 2) * 12, { steps: 2 });
  await F.page.mouse.up();
  const painterLocal = await q(F, localStrokesFn);
  const strokeIn = await until(() => q(F, (fid) => window.__wb.ex().getSceneElements().some((e) => e.type === 'freedraw' && e.frameId === fid), fr0.id), 8000, 200);
  ok(!!strokeIn, 'seat ' + F.name + ' drew a stroke inside the frame with the real pointer (the engine put it in the frame)', { toolAfter: await q(F, () => window.__wb.ex().getAppState().activeTool.type), freedrawOnSeat: painterLocal, frame: fr0, startPage: sp });
  const cv3 = await converge('after the frame edits', seatObjs, cv2.snaps[0].live + 1);
  await zStrict('after the frame edits', seatObjs);
  for (const s of seatObjs) await shot(s, 'seat-' + s.name + '-converged');
  const cnt3 = await counts(a); ok(cnt3.note === 9 && cnt3.freedraw === 7 && cnt3.dot === 1 && cnt3.frame === 1, 'the board holds 9 notes, 7 strokes, 1 dot, 1 frame', cnt3);

  // 4. lost write on B: control first, then with the sga-probe lever
  const live0 = cv3.snaps[0].live;
  async function lostWrite(label, dropN) {
    const start = await snap(a);
    if (dropN) await b.page.evaluate((n) => { window.__actDrop = n; window.__actDropped = 0; }, dropN);
    const t = Date.now(); let sawPending = false;
    await addNoteUI(b, 'pink');
    const want = start.live + 2;
    let tDeliver = null, tSaved = null, snaps = [];
    const lastChange = { t: Date.now(), h: '' };
    for (;;) {
      snaps = await Promise.all(openSeats().map((s) => snap(s)));
      const sb = snaps[openSeats().indexOf(b)];
      if (sb.pending > 0) sawPending = true;
      const eq = snaps.every((x) => x.hash === snaps[0].hash && x.live >= want);
      if (eq && tDeliver === null) tDeliver = Date.now() - t;
      if (eq && snaps.every((x) => x.pending === 0 && x.state === 'saved')) { tSaved = Date.now() - t; break; }
      if (lastChange.h !== snaps.map((x) => x.hash).join()) { lastChange.h = snaps.map((x) => x.hash).join(); lastChange.t = Date.now(); }
      if (Date.now() - lastChange.t > 60000) break;
      await sleep(250);
    }
    const dropped = dropN ? await b.page.evaluate(() => window.__actDropped) : 0;
    if (dropN) ok(dropped >= 1, label + ': the lever dropped the first act frames on B', { dropped, armed: dropN });
    ok(tSaved !== null, label + ': the note reaches every seat and B returns to "saved"', tSaved !== null ? 'delivered ' + secs(tDeliver) + ', B saved ' + secs(tSaved) + (dropN ? ', B was pending at some sample: ' + sawPending : '') : snaps.map((x, i) => openSeats()[i].name + ' ' + short(x.hash) + ' live=' + x.live + ' pending=' + x.pending + ' ' + x.state).join(' | '));
    if (dropN) { const st = await q(b, () => window.__wb.sync.stats); note(label + ': B sync stats ' + JSON.stringify(st)); }
    results.timings[label] = { deliverMs: tDeliver, savedMs: tSaved, dropped, sawPending };
    return tSaved;
  }
  await lostWrite('lost-write control (no lever)', 0);
  await lostWrite('lost-write with __actDrop=4', 4);

  // 5. the late joiner (a 3-page box lets seat C leave first)
  if (MAXP < 4) { note('MAXPAGES=' + MAXP + ': seat C leaves before the late joiner joins'); await closeSeat(c); }
  const hashBeforeD = (await snap(a)).hash, keysBeforeD = await q(a, keysFn), elsBeforeD = await q(a, elsFn), keysBeforeB = await q(b, keysFn);
  const d = await openSeat('WbDee'); d.idx = 3;
  const tD = Date.now();
  await joinSeat(d);
  await mountApp(d, tD);
  let first = null;
  let ref = null, lastD = null; await until(async () => { const x = await snap(d); ref = await snap(a); lastD = x; if (x.hash === ref.hash && x.live === ref.live) { first = x; return true; } return false; }, 120000, 150);
  const dMs = Date.now() - tD;
  results.timings.lateJoinMs = dMs;
  if (!first) { const df = await diffKeys(a, d); console.log('  board keys that differ A vs D: ' + JSON.stringify(df)); results.lateDiff = df; }
  ok(!!first, 'late joiner D: hash and live count equal to the others', first ? secs(dMs) + ' from join start, hash ' + short(first.hash) + ' live ' + first.live : 'D ' + JSON.stringify(lastD) + ' A ' + JSON.stringify(ref));
  ok(first && first.puts === 0 && first.dels === 0, 'late joiner D wrote nothing (sync.stats.puts === 0 and dels === 0 at first equality)', first && { puts: first.puts, dels: first.dels, resent: first.resent, healed: first.healed });
  await sleep(3000); // a rewrite by the joiner would show up now, after the first equality
  const settled = await snap(d); results.lateJoinSettled = { puts: settled.puts, resent: settled.resent };
  results.lateJoinSettled.dels = settled.dels;
  ok(settled.puts === 0 && settled.dels === 0, 'late joiner D still has puts === 0 and dels === 0 three seconds after first equality', results.lateJoinSettled);
  const joinConv = await converge('after the late join', [a, b, d], 0);
  // every seat: how many elements have another version than before D joined (the joiner has no "before": it is held to A's)
  const keysAfter = { A: await q(a, keysFn), B: await q(b, keysFn), D: await q(d, keysFn) };
  const bare = (k) => String(k).replace(/ mine$/, '');
  const diffCount = (after, before) => Object.keys(after).filter((id) => bare(after[id]) !== bare(before[id]));
  const bumpedBy = { A: diffCount(keysAfter.A, keysBeforeD), B: diffCount(keysAfter.B, keysBeforeB), D: diffCount(keysAfter.D, keysBeforeD) };
  results.lateJoinBumped = { A: bumpedBy.A.length, B: bumpedBy.B.length, D: bumpedBy.D.length, of: Object.keys(keysAfter.A).length };
  for (const k of ['A', 'B', 'D']) ok(bumpedBy[k].length === 0, 'after the late join, seat ' + k + ' has 0 elements whose version differs from before the join', bumpedBy[k].length ? { count: bumpedBy[k].length, sample: bumpedBy[k].slice(0, 5).map((id) => id + ' ' + keysBeforeD[id] + ' -> ' + keysAfter[k][id]) } : { of: results.lateJoinBumped.of });
  const bumped = bumpedBy.A;
  if (bumped.length) {
    const elsAfterD = await q(a, elsFn), why = {};
    bumped.slice(0, 40).forEach((id) => { const e1 = elsBeforeD[id], e2 = elsAfterD[id]; if (!e1 || !e2) return; Object.keys(Object.assign({}, e1, e2)).forEach((k) => { if (!/^(version|versionNonce|updated)$/.test(k) && JSON.stringify(e1[k]) !== JSON.stringify(e2[k])) why[k] = (why[k] || 0) + 1; }); });
    results.lateJoinFieldsChanged = why; console.log('  fields that changed on the bumped elements (count of elements): ' + JSON.stringify(why));
  }
  // z-order on A and D: the notes must stack the same way; any other difference is reported, with the engine's fractional `index` values
  const orderFn = () => window.__wb.ex().getSceneElements().map((e) => ({ id: e.id.slice(0, 8), t: e.type, n: !!(e.customData && e.customData.wb === 'note'), i: e.index === undefined ? null : e.index }));
  const zOk = await zStrict('after the late join', [a, b, d]);
  const oa = await q(a, orderFn), od = await q(d, orderFn), ob = await q(b, orderFn);
  results.zorder_AB = { notesEqual: JSON.stringify(oa.filter((x) => x.n).map((x) => x.id)) === JSON.stringify(ob.filter((x) => x.n).map((x) => x.id)), allEqual: JSON.stringify(oa.map((x) => x.id)) === JSON.stringify(ob.map((x) => x.id)) };
  console.log('  z-order A vs B (both there since the edits): ' + JSON.stringify(results.zorder_AB));
  const noteIds = (o) => o.filter((x) => x.n).map((x) => x.id), allIds = (o) => o.map((x) => x.id);
  const dups = (o) => { const c = {}; o.forEach((x) => { if (x.i !== null) c[x.i] = (c[x.i] || 0) + 1; }); return Object.keys(c).filter((k) => c[k] > 1); };
  const sameNotes = JSON.stringify(noteIds(oa)) === JSON.stringify(noteIds(od)), sameAll = JSON.stringify(allIds(oa)) === JSON.stringify(allIds(od));
  const diffPos = []; oa.forEach((x, k) => { if (!od[k] || od[k].id !== x.id) diffPos.push(k); });
  results.zorder = { notesEqual: sameNotes, allEqual: sameAll, elements: oa.length, dupIndexA: dups(oa), dupIndexD: dups(od), nullIndexA: oa.filter((x) => x.i === null).length, nullIndexD: od.filter((x) => x.i === null).length,
    differingPositions: diffPos.slice(0, 12).map((k) => ({ pos: k, A: oa[k] && (oa[k].t + ' ' + oa[k].id + ' idx=' + oa[k].i), D: od[k] && (od[k].t + ' ' + od[k].id + ' idx=' + od[k].i) })) };
  console.log('  z-order A vs D: ' + JSON.stringify(results.zorder));
  ok(sameNotes, 'the notes stack in the same order on seats A and D', { notesA: noteIds(oa).length, notesD: noteIds(od).length });
  if (!sameAll) note('z-order of all elements differs between A and D at ' + diffPos.length + ' positions (see results.json zorder)');
  const hashAfterD = (await snap(a)).hash; results.lateJoinHash = { before: hashBeforeD, atEquality: first && first.hash, afterA: hashAfterD };
  ok(hashAfterD === hashBeforeD, 'the board hash on A did not change because a late joiner arrived', { before: short(hashBeforeD), after: short(hashAfterD), dPuts: first && first.puts });
  if (!(first && first.puts === 0 && first.dels === 0 && settled.puts === 0 && settled.dels === 0) || !zOk || !joinConv.ok || bumpedBy.A.length || bumpedBy.B.length || bumpedBy.D.length) {
    // Do not guess: what did the engine's restoreElements change on the joiner, and how do the scene copies differ from the room's rows?
    results.joinerDiag = await q(d, () => {
      const w = window.__wb, R = window.__restoreLog || null, diffs = [];
      w.ex().getSceneElements().forEach((e) => { const b = w.board.get(e.id); if (!b) { diffs.push({ id: e.id.slice(0, 8), row: 'none' }); return; } const f = {}; Object.keys(Object.assign({}, e, b)).forEach((k) => { if (JSON.stringify(e[k]) !== JSON.stringify(b[k])) f[k] = { scene: JSON.stringify(e[k]).slice(0, 60), row: JSON.stringify(b[k]).slice(0, 60) }; }); if (Object.keys(f).length) diffs.push({ id: e.id.slice(0, 8), type: e.type, fields: f }); });
      return { restoreLog: R && { calls: R.calls, err: R.err, sortedIn: R.sortedIn.slice(0, 12), changedCount: R.changed.length, changed: R.changed.slice(0, 25) }, sceneVsRow: diffs.slice(0, 20), nSceneVsRow: diffs.length, stats: w.sync.stats };
    });
    console.log('  JOINER DIAG ' + JSON.stringify(results.joinerDiag).slice(0, 2500));
  } else results.joinerDiag = await q(d, () => { const R = window.__restoreLog; return R && { calls: R.calls, err: R.err, changedCount: R.changed.length, sortedIn: R.sortedIn.slice(0, 6) }; });
  await shot(d, 'seat-late-joiner');

  // 6b. exports on A with the frame on the board
  const frameCount = await q(a, () => window.__wb.ex().getSceneElements().filter((e) => e.type === 'frame').length);
  const pp = await buildBytes(a, 'pptx'); const ppFile = path.join(OUT, 'board.pptx'); fs.writeFileSync(ppFile, pp.bytes);
  results.timings.pptx = { ms: pp.ms, bytes: pp.bytes.length };
  console.log('pptx build ' + pp.ms + ' ms, ' + pp.bytes.length + ' bytes');
  checkPptx('pptx (frame)', ppFile, pp.bytes, { slides: frameCount, framed: true, ink: 'some', votes: 1, noteText, noteHex: votedHex, notes: 3 });
  const png = await buildBytes(a, 'png'); fs.writeFileSync(path.join(OUT, 'board.png'), png.bytes);
  ok(isPng(png.bytes), 'build.png() returns a PNG', pngDims(png.bytes) && (png.bytes.length + ' bytes ' + JSON.stringify(pngDims(png.bytes)) + ' ' + png.ms + ' ms'));
  const pdf = await buildBytes(a, 'pdf'); fs.writeFileSync(path.join(OUT, 'board.pdf'), pdf.bytes);
  const pdfTxt = Buffer.from(pdf.bytes).toString('latin1');
  ok(pdfTxt.indexOf('%PDF-1.4') === 0 && /%%EOF\s*$/.test(pdfTxt), 'build.pdf() returns %PDF-1.4 ... %%EOF', pdf.bytes.length + ' bytes ' + pdf.ms + ' ms');
  // the real UI path: #wb-exp -> #wb-exp-pptx, and does the browser download fire from the sandboxed frame?
  const frA = await getFrame(a, 10000);
  await frA.locator('#wb-exp').click({ timeout: 20000 });
  await sleep(400);
  await shot(a, 'seat-WbAda-export-menu');
  let dl = null, dlErr = '';
  try { [dl] = await Promise.all([a.page.waitForEvent('download', { timeout: 60000 }), frA.locator('#wb-exp-pptx').click({ timeout: 20000 })]); } catch (e) { dlErr = e.message.split('\n')[0]; }
  if (dl) {
    const f = path.join(OUT, 'ui-download.pptx'); await dl.saveAs(f); const sz = fs.statSync(f).size;
    const last = await q(a, () => { const l = window.__wb.lastExport(); return l ? { name: l.name, size: l.bytes.length } : null; });
    results.download = { fired: true, name: dl.suggestedFilename(), bytes: sz, appBytes: last && last.size };
    ok(true, 'the browser download fires from the sandboxed frame', dl.suggestedFilename());
    ok(last && sz === last.size, 'the saved download equals the built bytes in size', { saved: sz, built: last && last.size });
    ok(readZipOk(fs.readFileSync(f)), 'the downloaded file is a readable zip');
  } else { results.download = { fired: false, err: dlErr }; ok(false, 'the browser download fires from the sandboxed frame', dlErr); }

  // 7. a phone-profile seat (D leaves first on a small box)
  if (MAXP < 4) { await closeSeat(d); }
  const p = await openSeat('WbPia', true); p.idx = 4;
  const tP = Date.now();
  await joinSeat(p); await mountApp(p, tP);
  let refP = null, sp2 = null;
  await until(async () => { sp2 = await snap(p); refP = await snap(a); return sp2.hash === refP.hash && sp2.live === refP.live; }, 120000, 200);
  ok(sp2.hash === refP.hash, 'phone seat: same board as the others', { phone: short(sp2.hash), A: short(refP.hash), live: sp2.live, puts: sp2.puts, dels: sp2.dels });
  ok(sp2.puts === 0 && sp2.dels === 0, 'phone seat wrote nothing (puts === 0 and dels === 0)', { puts: sp2.puts, dels: sp2.dels });
  await converge('phone seat joined', [a, b, p], 0);
  await zStrict('phone seat joined', [a, b, p]);
  await sleep(1200);
  await shot(p, 'seat-phone');
  // The engine's own pieces: top toolbar, the small tools container, and its bottom bar (the rounded box that holds the menu button and undo / redo).
  const layFn = () => {
    const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
    const hit = (a, b) => a && b && b.l < a.r && b.r > a.l && b.t < a.b && b.b > a.t;
    const rail = R(document.getElementById('wb-rail')), mm = document.querySelector('.main-menu-trigger');
    let bar = null, el = mm;
    for (let k = 0; k < 6 && el && el.parentElement && el.parentElement !== document.body; k++) { el = el.parentElement; const cs = getComputedStyle(el); if ((cs.boxShadow !== 'none' || parseFloat(cs.borderTopLeftRadius) > 6) && el.getBoundingClientRect().height < innerHeight / 2) { bar = el; break; } }
    const parts = { 'top toolbar (.App-toolbar)': R(document.querySelector('.App-toolbar')), 'small tools (.mobile-misc-tools-container)': R(document.querySelector('.mobile-misc-tools-container')), 'bottom bar': R(bar) };
    const out = { vw: innerWidth, vh: innerHeight, rail, bottomBarSelector: bar ? bar.tagName.toLowerCase() + '.' + String(bar.className).trim().split(/\s+/).join('.') : null, parts, overlaps: [] };
    Object.keys(parts).forEach((k) => { if (!parts[k]) out.overlaps.push(k + ' NOT FOUND'); else if (hit(rail, parts[k])) out.overlaps.push(k); });
    out.errorSplash = !!document.querySelector('.ErrorSplash, .excalidraw-modal-container .error');
    return out;
  };
  const lay = await q(p, layFn);
  results.phoneLayout = lay; note('phone layout ' + JSON.stringify(lay));
  ok(lay.rail && lay.rail.l >= 0 && lay.rail.r <= lay.vw && lay.rail.b <= lay.vh && lay.overlaps.length === 0 && !lay.errorSplash, 'phone seat: the bar lies inside the screen and meets no engine piece (top toolbar, small tools, bottom bar = ' + lay.bottomBarSelector + ')', { rail: lay.rail, overlaps: lay.overlaps });
  // an opened menu stays fully inside the viewport
  const frP = await getFrame(p, 10000);
  await frP.locator('#wb-exp').click({ timeout: 20000 }); await sleep(500);
  const menu = await q(p, () => { const m = Array.prototype.slice.call(document.querySelectorAll('.wb-menu')).find((x) => !x.hidden); if (!m) return null; const r = m.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight }; });
  results.phoneMenu = menu;
  ok(menu && menu.l >= 0 && menu.t >= 0 && menu.r <= menu.vw && menu.b <= menu.vh, 'phone seat: the opened export menu (#wb-exp) is fully inside the viewport', menu);
  await shot(p, 'seat-phone-menu');
  await frP.locator('#wb-exp').click({ timeout: 20000 }).catch(() => {}); await sleep(300);
  // a shape selected: the engine shows its properties panel on a phone; what does the bar cover then?
  await q(p, () => { const ex = window.__wb.ex(), n = ex.getSceneElements().find((e) => e.type === 'rectangle' && e.customData && e.customData.wb === 'note'); ex.updateScene({ appState: { selectedElementIds: n ? { [n.id]: true } : {} } }); });
  await sleep(900);
  await shot(p, 'seat-phone-selected');
  const sel = await q(p, () => {
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
    const rail = R(document.getElementById('wb-rail')), hits = [];
    Array.prototype.slice.call(document.querySelectorAll('.App-bottom-bar *, .App-mobile-menu, .mobile-misc-tools-container, .App-toolbar, .selected-shape-actions, .Island')).forEach((el) => {
      const r = R(el); if (el.closest('#wb-rail') || r.r - r.l < 20 || r.b - r.t < 20) return;
      if (r.l < rail.r && r.r > rail.l && r.t < rail.b && r.b > rail.t) hits.push((el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.')) + ' ' + JSON.stringify(r));
    });
    return { rail, vw: innerWidth, vh: innerHeight, covered: hits.slice(0, 10) };
  });
  results.phoneSelected = sel; note('phone with a note selected: ' + JSON.stringify(sel));
  for (const s of seats) { const errs = s.log.filter((l) => / error | PAGEERROR /.test(' ' + l.slice(24, 40) + ' ') || /PAGEERROR/.test(l)); if (errs.length) note('console errors on ' + s.name + ': ' + errs.length + ' first: ' + errs[0].slice(0, 300)); }
  results.engineSplash = {};
  for (const s of seats.filter((x) => x.open)) results.engineSplash[s.name] = await q(s, () => !!document.querySelector('.ErrorSplash')).catch(() => null);
  ok(Object.values(results.engineSplash).every((v) => v === false), 'no engine error overlay on any open seat', results.engineSplash);
})().catch((e) => { ok(false, 'fatal', (e && e.stack || String(e)).split('\n').slice(0, 4).join(' | ')); }).then(async () => {
  for (const s of seats) await closeSeat(s).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  results.passed = passed; results.failed = failed; results.totalMs = Date.now() - T0;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('whiteboard-room: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
function readZipOk(u8) { try { return readZip(new Uint8Array(u8)).length > 3; } catch (e) { return false; } }
