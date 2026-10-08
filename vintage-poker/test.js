// VINTAGE POKER HAS TO PLAY A HAND.
//
// The port kills Pobermeier/vintage-poker’s Node + socket.io hall: the host
// deals, Invite is the seats, chips are toys. A ranking table that never
// deals, or a table that deals and then deadlocks, is not Hold'em. This suite
// loads the shipped poker.js in a vm, seeds the shoe, and PLAYS: deal, fold
// (uncontested), a call-down to showdown, an all-in runout, a side pot. Then
// app.js runs on a fake page: a solo hand is played through the buttons, the
// chip pile is saved at hand end, a host deals to a guest who walks in.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function seeded(seed) {
  let x = seed >>> 0;
  if (!x) x = 1;
  return function () {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function load() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'poker.js'), 'utf8'), sandbox, { filename: 'poker.js' });
  return sandbox;
}

function src(name) {
  return fs.readFileSync(path.join(APP, name), 'utf8');
}

function sum(t) {
  return t.seats.reduce((a, s) => a + (s.stack || 0), 0) + (t.pot || 0);
}

const S = load();
const PK = S.PK;
check('poker.js loads PK', !!(PK && PK.newTable && PK.startHand && PK.applyAction && PK.eval5));

{
  const d = PK.makeDeck();
  check('a shoe is 52', d.length === 52, d.length);
  const keys = {};
  d.forEach((c) => { keys[c.r + c.s] = 1; });
  check('…all distinct', Object.keys(keys).length === 52);
}

{
  const c = (r, s) => ({ r, s });
  const rf = PK.eval5([c(14, 's'), c(13, 's'), c(12, 's'), c(11, 's'), c(10, 's')]);
  const sf = PK.eval5([c(9, 'h'), c(8, 'h'), c(7, 'h'), c(6, 'h'), c(5, 'h')]);
  const wheel = PK.eval5([c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c'), c(5, 's')]);
  const pair = PK.eval5([c(14, 's'), c(14, 'h'), c(9, 'd'), c(4, 'c'), c(2, 's')]);
  check('royal flush is the top category', rf.cat === 9, rf);
  check('straight flush sits under it', sf.cat === 8 && rf.score > sf.score, sf);
  check('A-2-3-4-5 is a wheel', wheel.cat === 4, wheel);
  check('a pair is a pair', pair.cat === 1, pair);
}

// Deal two, fold: the other seat wins uncontested. Seeded so the shoe is a tape.
{
  const t = PK.newTable();
  PK.sit(t, 'a', 'Alice', 1000, false);
  PK.sit(t, 'b', 'Bob', 1000, false);
  check('the first deal sits the button on seat 0', (function () {
    const ok = PK.startHand(t, seeded(7));
    return ok && t.dealer === 0 && t.phase === 'preflop';
  })(), { dealer: t.dealer, phase: t.phase });
  check('each live seat gets two hole cards', t.seats[0].hand.length === 2 && t.seats[1].hand.length === 2,
    { a: t.seats[0].hand.length, b: t.seats[1].hand.length });
  const actor = t.toAct;
  const folded = t.seats[actor].name;
  check('someone is to act preflop', actor === 0 || actor === 1, actor);
  check('fold is legal', PK.legal(t, actor).fold === true);
  check('the fold applies', PK.applyAction(t, actor, 'fold') === true);
  check('…and the hand is over (uncontested)', t.phase === 'showdown', t.phase);
  check('…the other seat wins the blinds', t.winners.length === 1 && t.winners[0].name !== folded && t.winners[0].nameHand === 'uncontested',
    t.winners);
  check('chips are conserved on a fold', sum(t) === 2000, sum(t));
}

// Call every street to a showdown. Five board cards. A winner with a named hand.
{
  const t = PK.newTable();
  PK.sit(t, 'a', 'Alice', 1000, false);
  PK.sit(t, 'b', 'Bob', 1000, false);
  check('a second deal starts', PK.startHand(t, seeded(42)) === true);
  let guard = 0, badAct = false;
  const phases = [t.phase];
  while (t.phase !== 'showdown' && t.phase !== 'idle' && guard++ < 80) {
    const i = t.toAct;
    if (!(i === 0 || i === 1)) badAct = true;
    const L = PK.legal(t, i);
    const kind = L.toCall > 0 ? 'call' : 'check';
    const ok = PK.applyAction(t, i, kind);
    if (!ok) {
      check('every call/check applies', false, { kind, i, phase: t.phase, L });
      break;
    }
    if (phases[phases.length - 1] !== t.phase) phases.push(t.phase);
  }
  check('every street has a live actor', !badAct);
  check('a call-down reaches showdown', t.phase === 'showdown', { phase: t.phase, phases, guard });
  check('the board is five cards', t.board.length === 5, t.board.map(PK.label));
  check('the streets were preflop → flop → turn → river → showdown',
    phases.join('>') === 'preflop>flop>turn>river>showdown', phases);
  check('a named hand takes the pot', t.winners.length >= 1 && t.winners[0].amount > 0 && t.winners[0].nameHand,
    t.winners);
  check('chips are conserved through showdown', sum(t) === 2000, sum(t));
}

// All-in short stack: the board runs out, unmatched chips come back, not a fake win.
{
  const t = PK.newTable();
  PK.sit(t, 'short', 'Short', 40, false);
  PK.sit(t, 'deep', 'Deep', 1000, false);
  PK.startHand(t, seeded(9));
  let g = 0;
  while (t.phase !== 'showdown' && t.phase !== 'idle' && g++ < 40) {
    const i = t.toAct;
    if (i == null) break;
    const L = PK.legal(t, i);
    if (L.raiseTo) PK.applyAction(t, i, 'raise', L.raiseTo);
    else PK.applyAction(t, i, L.toCall > 0 ? 'call' : 'check');
  }
  check('an all-in runs the board to showdown', t.phase === 'showdown' && t.board.length === 5,
    { phase: t.phase, board: t.board.length, msg: t.msg });
  check('unmatched chips are not listed as a win', t.winners.every((w) => w.amount <= 80), t.winners);
  check('the two stacks still add to 1040', sum(t) === 1040, sum(t));
}

// Side pots: short trips take the main, deep pair takes the side.
{
  const t = PK.newTable();
  PK.sit(t, 'a', 'A', 100, false);
  PK.sit(t, 'b', 'B', 500, false);
  PK.sit(t, 'c', 'C', 500, false);
  t.phase = 'river';
  t.board = [{ r: 2, s: 's' }, { r: 3, s: 'h' }, { r: 8, s: 'd' }, { r: 9, s: 'c' }, { r: 14, s: 's' }];
  t.seats[0].folded = false; t.seats[0].contrib = 100; t.seats[0].stack = 0; t.seats[0].allIn = true;
  t.seats[0].hand = [{ r: 8, s: 'h' }, { r: 8, s: 'c' }];
  t.seats[1].folded = false; t.seats[1].contrib = 500; t.seats[1].stack = 0; t.seats[1].allIn = true;
  t.seats[1].hand = [{ r: 14, s: 'h' }, { r: 13, s: 'd' }];
  t.seats[2].folded = false; t.seats[2].contrib = 500; t.seats[2].stack = 0; t.seats[2].allIn = true;
  t.seats[2].hand = [{ r: 7, s: 'h' }, { r: 6, s: 'd' }];
  t.pot = 1100;
  t.seats[1].allIn = false; t.seats[1].acted = false; t.seats[1].bet = 0; t.toAct = 1; t.streetBet = 0;
  PK.applyAction(t, 1, 'check');
  const by = {};
  t.winners.forEach((w) => { by[w.name] = w; });
  check('side pot: trips take the main 300', by.A && by.A.amount === 300 && /three/.test(by.A.nameHand), t.winners);
  check('side pot: pair takes the side 800', by.B && by.B.amount === 800 && by.B.nameHand === 'pair', t.winners);
  check('side pot: the air takes nothing', t.seats[2].stack === 0, t.seats[2].stack);
  check('side pot conserves 1100', sum(t) === 1100, sum(t));
}

{
  const t = PK.newTable();
  PK.sit(t, 'a', 'A', 0, false);
  t.seats[0].sittingOut = true;
  check('rebuy puts a broke seat back in', PK.rebuy(t, 'a', PK.START) && t.seats[0].stack === 1000 && t.seats[0].sittingOut === false,
    t.seats[0]);
}

// ---- the table app: poker.js + app.js on a fake page ----------------------
const html = src('index.html');
const css = src('style.css');
const man = JSON.parse(src('manifest.json'));

const pageEls = {};
html.replace(/<!--[\s\S]*?-->/g, '').replace(/<([a-z0-9]+)\b([^>]*)>/gi, (all, tag, attrs) => {
  const id = /\bid="([^"]+)"/.exec(attrs);
  if (id) {
    const a = {};
    attrs.replace(/([\w-]+)(?:="([^"]*)")?/g, (m, k, v) => { a[k] = v === undefined ? true : v; return m; });
    pageEls[id[1]] = { tag: tag.toLowerCase(), attrs: a };
  }
  return all;
});
const buttonIds = Object.keys(pageEls).filter((id) => pageEls[id].tag === 'button');

const settle = () => new Promise((r) => setImmediate(r));
async function settleAll() { for (let i = 0; i < 20; i++) await settle(); }

function table(opts) {
  opts = opts || {};
  const els = {};
  const mkEl = (id, tag) => {
    const cls = new Set();
    let inner = '';
    const e = {
      id, tagName: (tag || 'div').toUpperCase(), hidden: false, textContent: '', value: '', className: '',
      children: [], onclick: null, oninput: null,
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); },
      },
      appendChild(c) { this.children.push(c); return c; },
      get innerHTML() { return inner; },
      set innerHTML(v) { inner = v; if (v === '') this.children = []; },
    };
    return e;
  };
  Object.keys(pageEls).forEach((id) => {
    const e = mkEl(id, pageEls[id].tag);
    e.hidden = pageEls[id].attrs.hidden === true;
    if (pageEls[id].attrs.value != null) e.value = pageEls[id].attrs.value;
    els[id] = e;
  });
  const body = mkEl('body');
  const timers = [];
  let now = 1e12;
  const dbs = {};
  const db = (name) => {
    if (!dbs[name]) {
      const st = { rows: {}, puts: [], subs: [] };
      st.api = {
        get: (id) => Promise.resolve(st.rows[id]),
        put: (row) => { st.puts.push({ row: JSON.parse(JSON.stringify(row)), phase: st.phaseNow && st.phaseNow() }); st.rows[row.id] = row; return Promise.resolve(); },
        subscribe: (f) => { st.subs.push(f); },
      };
      dbs[name] = st;
    }
    return dbs[name].api;
  };
  if (opts.saved) { db('save'); dbs.save.rows.last = opts.saved; }
  const netTouches = [];
  const backs = [];
  let x = 12345;
  const rnd = () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
  const M = Object.create(Math);
  M.random = rnd;
  const sb = {
    console, Math: M, Object, Array, JSON, String, Number, Boolean, Promise, Error, parseInt,
    Date: { now: () => now },
    document: {
      body,
      getElementById: (id) => els[id] || null,
      createElement: (t) => mkEl('', t),
    },
    setTimeout: (f, ms) => { timers.push({ at: now + ms, f }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    gifos: {
      db,
      me: () => Promise.resolve({ id: opts.meId || 'host-1', name: 'Hosty' }),
      info: () => Promise.resolve({ owner: opts.owner !== false }),
      onBack: (f) => backs.push(f),
    },
  };
  // The port has no server: any reach for the network is recorded.
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'io', 'RTCPeerConnection'].forEach((k) => {
    Object.defineProperty(sb, k, { get() { netTouches.push(k); return undefined; }, configurable: true });
  });
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src('poker.js'), sb, { filename: 'poker.js' });
  // record every action the app applies, and which table it applied it to
  const acts = [];
  let lastT = null;
  const realApply = sb.PK.applyAction;
  sb.PK.applyAction = function (t, i, kind, amt) { lastT = t; acts.push({ i, kind, amt }); return realApply.apply(this, arguments); };
  const realStart = sb.PK.startHand;
  sb.PK.startHand = function (t) { lastT = t; return realStart.apply(this, arguments); };
  db('save');
  dbs.save.phaseNow = () => lastT && lastT.phase;
  vm.runInContext(src('app.js'), sb, { filename: 'app.js' });
  const runTimers = () => {
    let n = 0;
    while (timers.length && n++ < 200) {
      timers.sort((p, q) => p.at - q.at);
      const t = timers.shift();
      now = Math.max(now, t.at);
      t.f();
    }
  };
  const click = (id) => { if (els[id].onclick) els[id].onclick.call(els[id]); };
  return { sb, els, dbs, acts, backs, netTouches, runTimers, click, table: () => lastT, setNow: (v) => { now = v; }, now: () => now };
}

async function appChecks() {
  check('the home panel is not a playing-card .card',
    pageEls.home && /\bpanel\b/.test(pageEls.home.attrs.class) && !/\bcard\b/.test(pageEls.home.attrs.class));
  check('fold/call/raise exist with aria-labels',
    ['foldBtn', 'callBtn', 'raiseBtn'].every((id) => pageEls[id] && pageEls[id].tag === 'button' && pageEls[id].attrs['aria-label']));
  check('no in-app Invite button', !Object.keys(pageEls).some((id) => /invite/i.test(id)));

  // -- solo: a hand on this device, played through the buttons ----------------
  {
    const h = table({ saved: { id: 'last', chips: 777 } });
    await settleAll();
    check('the file holds the chip pile: saved chips come back', h.els.chips.textContent === '777', h.els.chips.textContent);
    h.click('soloBtn');
    check('Play on this device deals a hand', h.els.play.hidden === false && h.els.home.hidden === true &&
      h.table() && h.table().phase === 'preflop');
    const cardEls = h.els.board.children.concat(h.els.hole.children);
    check('playing cards use .pcard', h.els.board.children.length === 5 && h.els.hole.children.length === 2 &&
      cardEls.every((c) => c.className.split(' ').indexOf('pcard') !== -1) &&
      /(^|\})\s*\.pcard\s*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
    const meIdx = () => h.sb.PK.seatById(h.table(), 'host-1');
    let clicked = [], guard = 0, raised = false, sliderAt = null;
    const saves = h.dbs.save.puts;
    const savesBefore = saves.length;
    while (guard++ < 60) {
      h.runTimers();
      const t = h.table();
      if (t.phase === 'showdown' || t.phase === 'idle') break;
      if (!h.els.raiseBtn.hidden && !raised) {
        raised = true;
        check('every button on the table does something', buttonIds.every((id) => typeof h.els[id].onclick === 'function'),
          buttonIds.filter((id) => typeof h.els[id].onclick !== 'function'));
        sliderAt = Number(h.els.raiseRange.min) + 5;
        h.els.raiseRange.value = String(sliderAt);
        h.click('raiseBtn');
        clicked.push('raiseBtn');
        continue;
      }
      if (!h.els.callBtn.hidden) { h.click('callBtn'); clicked.push('callBtn'); continue; }
      if (!h.els.checkBtn.hidden) { h.click('checkBtn'); clicked.push('checkBtn'); continue; }
    }
    const mine = h.acts.filter((a) => a.i === meIdx());
    check('Raise / Call / Check apply my action to my seat',
      clicked.length > 0 && mine.length === clicked.length &&
      mine.every((a, k) => a.kind === { raiseBtn: 'raise', callBtn: 'call', checkBtn: 'check' }[clicked[k]]),
      { clicked, mine });
    check('the raise uses the slider amount', sliderAt > 5 && mine[0] && mine[0].kind === 'raise' && mine[0].amt === sliderAt, { sliderAt, act: mine[0] });
    check('the bots play the hand out', h.table().phase === 'showdown', h.table().phase);
    const handSaves = saves.slice(savesBefore);
    check('chips are written at hand end, not mid-street',
      handSaves.length > 0 && handSaves.every((p) => p.phase === 'showdown' || p.phase === 'idle'), handSaves.map((p) => p.phase));
    const last = handSaves[handSaves.length - 1];
    check('the file holds the chip pile (gifos.db save, private)',
      last && last.row.id === 'last' && last.row.chips === h.table().seats[meIdx()].stack &&
      man.data.save.visibility === 'private', last);
    check('Deal starts the next hand', !h.els.dealBtn.hidden && (h.click('dealBtn'), h.table().phase === 'preflop'));
    h.runTimers();
    if (!h.els.foldBtn.hidden) {
      const n = h.acts.length;
      h.click('foldBtn');
      check('Fold folds my seat', h.acts.length === n + 1 && h.acts[n].kind === 'fold' && h.acts[n].i === meIdx() &&
        h.table().seats[meIdx()].folded === true);
    } else check('Fold folds my seat', false, 'fold not offered');
    check('their server stays behind (no network reached in a whole hand)', h.netTouches.length === 0, h.netTouches);
  }

  // -- friends: the host's empty table, the guest who walks in ---------------
  {
    const hostT = table({ owner: true });
    await settleAll();
    check('the host stays on the home screen', hostT.els.home.hidden === false);
    hostT.click('friendBtn');
    hostT.dbs.room.subs[0]([{ id: 'host-1', kind: 'seat', name: 'Hosty', at: hostT.now(), joined: 1 }]);
    const emptyStatus = hostT.els.lobbyStatus.textContent;
    check('an empty table offers the invite and no Deal',
      hostT.els.lobby.hidden === false && hostT.els.lobbyEmpty.hidden === false && hostT.els.dealLobby.hidden === true);
    hostT.dbs.room.subs[0]([
      { id: 'host-1', kind: 'seat', name: 'Hosty', at: hostT.now(), joined: 1 },
      { id: 'guest-2', kind: 'seat', name: 'Gus', at: hostT.now(), joined: 2 },
    ]);
    check('two seated: the host can deal', hostT.els.dealLobby.hidden === false && hostT.els.lobbyEmpty.hidden === true);
    hostT.click('dealLobby');
    const pub = hostT.dbs.room.puts.map((p) => p.row).filter((r) => r.kind === 'table').pop();
    check('the host deals and publishes the table', pub && pub.t && pub.t.phase === 'preflop' && hostT.els.play.hidden === false);

    const g = table({ owner: false, meId: 'guest-2' });
    await settleAll();
    const seatRow = (g.dbs.room ? g.dbs.room.puts : []).map((p) => p.row).find((r) => r.kind === 'seat');
    check('guests who open the invite sit without tapping Play with friends',
      g.els.lobby.hidden === false && g.els.home.hidden === true && seatRow && seatRow.id === 'guest-2');
    g.dbs.room.subs[0]([
      { id: 'host-1', kind: 'seat', name: 'Hosty', at: g.now(), joined: 1 },
      { id: 'guest-2', kind: 'seat', name: 'Gus', at: g.now(), joined: 2 },
    ]);
    check('empty table copy is distinct from waiting-on-host',
      g.els.lobbyEmpty.hidden === true && g.els.dealLobby.hidden === true &&
      g.els.lobbyStatus.textContent !== '' && g.els.lobbyStatus.textContent !== emptyStatus,
      { guest: g.els.lobbyStatus.textContent, empty: emptyStatus });
    check('Back from the lobby goes home', g.backs[0] && g.backs[0]() === true && g.els.home.hidden === false);
    check('Back at home lets the OS close', g.backs[0]() === false);
  }
}

{
  const cssRules = [];
  css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => {
    const decls = {};
    body.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    cssRules.push({ sels: sel.split(',').map((x) => x.trim().replace(/\s+/g, ' ')), decls });
    return all;
  });
  const decl = (sel, prop) => {
    let v = null;
    cssRules.forEach((r) => { if (r.sels.indexOf(sel) !== -1 && r.decls[prop] != null) v = r.decls[prop]; });
    return v;
  };
  check('phone action buttons are 48px tall', parseFloat(decl('.bar button', 'min-height')) >= 48, decl('.bar button', 'min-height'));
  check('[hidden] actually hides (raise-row is display:flex)',
    /^none\s*!important$/.test(decl('[hidden]', 'display') || ''), decl('[hidden]', 'display'));
  const refs = [];
  html.replace(/<!--[\s\S]*?-->/g, '').replace(/\b(?:src|href)="([^"]*)"/g, (a, u) => { refs.push(u); return a; });
  check('no CDN / webfont / remote at load',
    refs.length > 0 && refs.every((u) => !/^(https?:)?\/\//i.test(u)) &&
    !cssRules.some((r) => r.sels.some((x) => /^@import/.test(x))) && !/@import|url\(\s*['"]?(https?:)?\/\//i.test(css), refs);
  check('minBuild stays 947', man.minBuild === 947);
  check('multiplayer + db declared; no network',
    man.capabilities.db === true && man.capabilities.multiplayer === true && !man.capabilities.network);
}

appChecks().then(() => {
  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  console.log('\nAll tests passed.');
}, (e) => { console.log('FAIL — table harness threw: ' + (e && e.stack)); process.exit(1); });
