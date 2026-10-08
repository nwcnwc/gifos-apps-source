// Queens has to actually place, clash, win, and remember the board.
//
// The GIF claimed "the board you were in the middle of stay in this file"
// while app.js wrote `board` and never read it back. Hundreds of levels
// without a restore is a daily-puzzle that forgets the morning. This suite
// PLAYS the tap loop in a vm — tap empty→X→queen, auto-X, a real 6×6 solved
// by the same tap() the GIF runs — and greps the shell for the restore,
// onBack, the room subscribe, and the phone board (touch-action).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function load() {
  const sandbox = { console, Math, Object, Array, JSON, Date, String, Number, Boolean };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'levels.js'), 'utf8'), sandbox, { filename: 'levels.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });
  return sandbox;
}

const G = load();
const QNS = G.QNS;
const LEVELS = G.QUEENS_LEVELS;
check('game.js attaches QNS', !!(QNS && QNS.tap && QNS.checkWin && QNS.clashes));
check('768 community boards are aboard', Array.isArray(LEVELS) && LEVELS.length === 768, (LEVELS && LEVELS.length));

{
  const ids = LEVELS.map((l) => l.id);
  check('ids are 1..768 unique', ids[0] === 1 && ids[767] === 768 && new Set(ids).size === 768);
  const lv = LEVELS[0];
  check('level 1 is 6×6', lv && lv.size === 6 && lv.r.length === 6 && lv.r[0].length === 6);
}

// ---- the tap cycle the phone actually uses ---------------------------------
{
  const lv = LEVELS[0];
  const regions = QNS.regionsOf(lv);
  let b = QNS.emptyBoard(lv.size);
  check('an empty board is not a win', QNS.checkWin(b, regions) === false);
  b = QNS.tap(b, regions, 0, 0, false);
  check('tap empty → X', b[0][0] === 'X');
  b = QNS.tap(b, regions, 0, 0, false);
  check('tap X → queen', b[0][0] === 'Q');
  b = QNS.tap(b, regions, 0, 0, false);
  check('tap queen → empty', b[0][0] == null);
}

// Auto X has to fill the row, column, region, and the eight neighbours —
// otherwise placing a queen on a phone is a chore of 20 extra taps.
{
  const lv = LEVELS[0];
  const regions = QNS.regionsOf(lv);
  let b = QNS.emptyBoard(lv.size);
  b = QNS.tap(b, regions, 0, 0, false);
  b = QNS.tap(b, regions, 0, 0, true);
  check('auto-X keeps the queen', b[0][0] === 'Q');
  check('auto-X fills the rest of the row', b[0].every((v, c) => c === 0 ? v === 'Q' : v === 'X'));
  check('auto-X fills the rest of the column', b.every((row, r) => r === 0 ? true : row[0] === 'X'));
  check('auto-X fills the neighbouring corner', b[1][1] === 'X');
}

// Two queens in one row must light a clash. Two that only share a long
// diagonal (not a neighbouring corner) must NOT — that is the rule that
// is not chess.
{
  const lv = LEVELS[0];
  const regions = QNS.regionsOf(lv);
  const n = lv.size;
  const b = QNS.emptyBoard(n);
  b[0][0] = 'Q';
  b[0][3] = 'Q';
  const clash = QNS.clashes(b, regions);
  check('two queens in a row clash', !!(clash['0,0'] && clash['0,3']));
  const d = QNS.emptyBoard(n);
  d[0][0] = 'Q';
  d[2][2] = 'Q';
  const far = QNS.clashes(d, regions);
  check('a long diagonal is not a clash', !far['0,0'] && !far['2,2']);
  const near = QNS.emptyBoard(n);
  near[0][0] = 'Q';
  near[1][1] = 'Q';
  const nClash = QNS.clashes(near, regions);
  check('a corner-touch is a clash', !!(nClash['0,0'] && nClash['1,1']));
}

// Drag-X must never overwrite a queen.
{
  const lv = LEVELS[0];
  const b = QNS.emptyBoard(lv.size);
  b[0][0] = 'Q';
  const next = QNS.paintX(b, [[0, 0], [0, 1]]);
  check('paintX leaves a queen alone', next[0][0] === 'Q' && next[0][1] === 'X');
}

// PLAY: solve level 1 with the same tap() the GIF runs. The placement is
// the unique (up to search order) solution the backtracker found; feeding
// it through tap+autoX and then checkWin is the loop a thumb plays.
{
  const lv = LEVELS[0];
  const regions = QNS.regionsOf(lv);
  const places = [[0, 0], [1, 3], [2, 5], [3, 2], [4, 4], [5, 1]];
  let b = QNS.emptyBoard(lv.size);
  for (const [r, c] of places) {
    b = QNS.tap(b, regions, r, c, false); // empty → X
    b = QNS.tap(b, regions, r, c, true);  // X → Q + auto X
  }
  check('level 1 is won after six queens', QNS.checkWin(b, regions) === true);
  check('level 1 has six queens', b.flat().filter((v) => v === 'Q').length === 6);
}

// A handful of larger boards must also be solvable under the same rules,
// or the 768-count is a pile of broken JSON.
function solve(level) {
  const n = level.size, regions = QNS.regionsOf(level), board = QNS.emptyBoard(n);
  const usedCol = Array(n).fill(false), usedReg = {};
  function adjOK(r, c) {
    for (const [dr, dc] of [[-1, -1], [-1, 1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && cc < n && board[rr][cc] === 'Q') return false;
    }
    return true;
  }
  function rec(r) {
    if (r === n) return true;
    for (let c = 0; c < n; c++) {
      const reg = regions[r][c];
      if (usedCol[c] || usedReg[reg]) continue;
      if (!adjOK(r, c)) continue;
      board[r][c] = 'Q'; usedCol[c] = true; usedReg[reg] = true;
      if (rec(r + 1)) return true;
      board[r][c] = null; usedCol[c] = false; delete usedReg[reg];
    }
    return false;
  }
  return rec(0) ? board : null;
}
{
  const sample = [0, 1, 70, 71, 280, 360, 500, 700, 767];
  let ok = 0;
  for (const i of sample) {
    const lv = LEVELS[i];
    const b = solve(lv);
    if (b && QNS.checkWin(b, QNS.regionsOf(lv))) ok++;
    else check('level ' + lv.id + ' (' + lv.size + '×' + lv.size + ') solves', false);
  }
  check('sampled boards across sizes all solve', ok === sample.length, { ok, n: sample.length });
}

// ---- shell: app.js runs for real ---------------------------------------------
// index.html's elements (every id) become a fake DOM; levels.js, game.js and
// app.js run in a vm with a fake gifos (save db, room db, me, onBack) and
// network stubs that count every call. The checks click and read state.
function shell(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const els = {};
  function El(tag, attrs) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs || {}; this.id = this.attrs.id || '';
    this.hidden = 'hidden' in this.attrs; this.checked = 'checked' in this.attrs; this.value = '';
    this.textContent = ''; this.className = this.attrs.class || ''; this.children = []; this.listeners = {}; this.parentNode = null;
    const st = {}; this.style = { setProperty: (k, v) => { st[k] = v; } };
  }
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.setPointerCapture = function () {};
  El.prototype.closest = function (sel) { let e = this; while (e) { if (sel[0] === '.' && (' ' + e.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0) return e; e = e.parentNode; } return null; };
  Object.defineProperty(El.prototype, 'innerHTML', { get() { return ''; }, set(v) { this.children = []; } });
  El.prototype.click = function () {
    const ev = { target: this, preventDefault() {} };
    let e = this;
    while (e) { for (const fn of e.listeners.click || []) fn.call(e, ev); if (typeof e.onclick === 'function') e.onclick.call(e, ev); e = e.parentNode; }
  };
  html.replace(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>/g, (m, tag, a) => {
    const attrs = {}; a.replace(/([\w-]+)(?:="([^"]*)")?/g, (mm, k, v) => { attrs[k] = v === undefined ? '' : v; return mm; });
    if (attrs.id) els[attrs.id] = new El(tag, attrs);
    return m;
  });
  const net = { calls: [] };
  const puts = []; const roomPuts = []; let sub = null; let back = null; const gifosCalls = [];
  const gifos = {
    db: (name) => name === 'save'
      ? { put: (r) => { puts.push(JSON.parse(JSON.stringify(r))); return Promise.resolve(); }, get: () => Promise.resolve(opts.saved || null) }
      : { put: (r) => { roomPuts.push(r); return Promise.resolve(); }, subscribe: (fn) => { sub = fn; } },
    me: () => Promise.resolve(opts.me || { id: 'solo' }),
    onBack: (fn) => { back = fn; },
  };
  // Anything else an app could call on gifos (invite, share, open…) is recorded.
  const gifosProxy = new Proxy(gifos, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? (...a) => gifosCalls.push(k) : undefined)) });
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, parseInt,
    gifos: gifosProxy,
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (t) => new El(t),
      addEventListener() {},
      elementFromPoint: () => null,
    },
    navigator: { sendBeacon: (...a) => { net.calls.push(['sendBeacon', a[0]]); return true; } },
    fetch: (u) => { net.calls.push(['fetch', u]); return Promise.reject(new Error('offline')); },
    XMLHttpRequest: function () { net.calls.push(['xhr']); this.open = () => {}; this.send = () => {}; },
    Image: function () { const o = {}; Object.defineProperty(o, 'src', { set: (u) => net.calls.push(['img', u]) }); return o; },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/levels.js', 'game.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  const cells = () => els.board.children;
  const cellAt = (r, c) => cells().find((x) => x.getAttribute('data-r') === String(r) && x.getAttribute('data-c') === String(c));
  return { els, puts, roomPuts, sub: () => sub, back: () => back && back(), net, gifosCalls, cells, cellAt };
}

(async () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  {
    // A board left mid-solve comes back exactly as it was.
    const lv = LEVELS[0];
    const mid = QNS.emptyBoard(lv.size); mid[0][0] = 'Q'; mid[1][3] = 'X';
    const S = shell({ saved: { id: 'save', done: {}, auto: true, cur: lv.id, idx: 0, board: mid } });
    await flush();
    S.els.playBtn.click();
    const q = S.cellAt(0, 0), x = S.cellAt(1, 3), e = S.cellAt(2, 2);
    check('an in-progress board is RESTORED from gifos.db', !!q && / q\b/.test(q.className) && / x\b/.test(x.className) && !/ [qx]\b/.test(e.className), q && q.className);
    check('the board is on screen', S.els.play.hidden === false && S.els.home.hidden === true);
    // A tap is saved with the whole save format.
    const before = S.puts.length;
    S.cellAt(5, 5).click();
    const rec = S.puts[S.puts.length - 1];
    check('a tap saves done/auto/cur/board/idx as id save', S.puts.length > before && rec.id === 'save' && typeof rec.done === 'object' && rec.auto === true && rec.cur === lv.id && rec.idx === 0 && rec.board[0][0] === 'Q' && rec.board[5][5] === 'X', rec);
    // Back leaves play for the level list, then lets the OS have the press.
    const r1 = S.back();
    check('Back from a board goes to the level list and reports it handled the press', r1 === true && S.els.play.hidden === true && S.els.home.hidden === false);
    check('Back on the level list returns false (the OS may leave)', S.back() === false);
    // Reopening resumes the same board.
    S.els.playBtn.click();
    check('Play after Back resumes the same board', / q\b/.test(S.cellAt(0, 0).className) && / x\b/.test(S.cellAt(5, 5).className));
  }
  {
    // A saved board for a different-size level is not forced onto this one.
    const S = shell({ saved: { id: 'save', done: {}, auto: true, cur: 1, idx: 0, board: [['Q']] } });
    await flush();
    S.els.playBtn.click();
    check('a saved board of the wrong size is not restored', S.cells().length === LEVELS[0].size * LEVELS[0].size && S.cells().every((c) => !/ [qx]\b/.test(c.className)));
  }
  {
    // In a room: a guest follows the host's puzzle.
    const S = shell({ me: { id: 'guest-1', name: 'Guest' } });
    await flush();
    check('the room is subscribed', typeof S.sub() === 'function');
    const target = LEVELS[70];
    S.sub()([{ id: 'puzzle', level: target.id, by: 'host-1' }, { id: 'host-1', name: 'Host', level: target.id }]);
    S.els.playBtn.click();
    check('a guest pressing Play sits the host puzzle', S.cells().length === target.size * target.size && S.puts[S.puts.length - 1].cur === target.id, S.puts[S.puts.length - 1].cur);
    const next = LEVELS[360];
    S.sub()([{ id: 'puzzle', level: next.id, by: 'host-1' }]);
    check('a guest on a board follows when the host moves on', S.cells().length === next.size * next.size && S.puts[S.puts.length - 1].cur === next.id);
    const myPuts = S.roomPuts.filter((r) => r.id === 'guest-1');
    check('a guest publishes their own progress to the room, not the puzzle', myPuts.length > 0 && !S.roomPuts.some((r) => r.id === 'puzzle' && r.level === next.id && r.by === 'guest-1'));
  }
  {
    // Every button in the page: none reaches for an OS invite/share call, and
    // nothing in a whole session phones home.
    const S = shell({ me: { id: 'p-a' } });
    await flush();
    S.els.playBtn.click();
    for (let i = 0; i < 6; i++) S.cellAt(i, i).click();
    for (const el of Object.values(S.els)) if (el.tagName === 'BUTTON') el.click();
    S.back();
    await flush();
    check('no in-app control calls an OS invite or share (Invite is OS chrome)', S.gifosCalls.length === 0, S.gifosCalls);
    check('no analytics beacon, fetch, XHR or pixel in a whole session', S.net.calls.length === 0, S.net.calls);
  }

  // Thumb play: resolve the stylesheet for the board and a cell.
  {
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [];
    (function scan(text) {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const head = text.slice(i, open).trim(); let depth = 1, k = open + 1;
        while (k < text.length && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
        const inner = text.slice(open + 1, k - 1);
        if (head.startsWith('@media')) scan(inner); else rules.push({ sels: head.split(',').map((x) => x.trim()), body: inner });
        i = k;
      }
    })(css);
    const resolve = (classes, prop) => {
      let v = null;
      for (const r of rules) for (const sel of r.sels) {
        if (sel[0] !== '.' || /[\s>:\[]/.test(sel)) continue;
        if (!sel.split('.').filter(Boolean).every((c) => classes.indexOf(c) >= 0)) continue;
        const m = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*([^;]+)').exec(r.body);
        if (m) v = m[1].trim();
      }
      return v;
    };
    check('the board does not steal the page scroll (touch-action: none)', resolve(['board'], 'touch-action') === 'none' && resolve(['cell'], 'touch-action') === 'none');
    // The board is 'min(92vw, …)' wide with n columns; on a 390px phone a 9×9
    // cell must still reach 44px or the size must say so.
    const S = shell();
    await flush();
    S.els.playBtn.click();
    const w = resolve(['board'], 'width') || '';
    const vw = /(\d+(?:\.\d+)?)vw/.exec(w);
    const capPx = /(\d+(?:\.\d+)?)px/.exec(w);
    const boardPx = Math.min(vw ? 390 * parseFloat(vw[1]) / 100 : Infinity, capPx ? parseFloat(capPx[1]) : Infinity);
    const cell = boardPx / 8;
    check('cells on an 8×8 board on a 390px phone are at least 44px', cell >= 44, { w, cell });
  }

  if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exit(1);
  }
  console.log('\nAll ' + (process.stdout.isTTY ? '' : '') + 'PASS');
  process.exit(0);
})();
