// SOLITAIRE HAS TO ACTUALLY PLAY KLONDIKE.
//
// The 1.0 port shuffled with Array.sort(Math.random) (biased), had no undo,
// no draw-1, no score, and tap-to-move was the only phone path. This suite
// PLAYS the shipped engine: deal, legal moves, draw, recycle, undo, a win,
// and a 1.0 save still loading. DOM wiring a vm cannot run is source-scanned.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function load() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('klondike.js'), sandbox, { filename: 'klondike.js' });
  return sandbox.Klondike;
}

const K = load();
check('klondike.js attaches Klondike', !!(K && K.newGame && K.applyMove && K.undo));

{
  const s = K.newGame(seeded(0x51A7));
  check('a deal is 52 cards', s.cards.length === 52);
  const dealt = s.desk.reduce((n, c) => n + c.length, 0);
  check('Klondike deal: 28 on the tableau, 24 in the stock', dealt === 28 && s.pile.length === 24 && s.waste.length === 0,
    { dealt: dealt, pile: s.pile.length });
  check('seven columns, 1..7 cards', s.desk.map((c) => c.length).join(',') === '1,2,3,4,5,6,7');
  let up = 0;
  s.desk.forEach((col) => { const i = col[col.length - 1]; if (s.cards[i].facingUp) up++; });
  check('each column has its top card face-up (7 showing)', up === 7, up);
  const two = K.newGame(seeded(0x51A7));
  const same = JSON.stringify(K.snapshot(s).cards) === JSON.stringify(K.snapshot(two).cards);
  check('the same seed deals the same tableau', same);
  const other = K.newGame(seeded(0xBEEF));
  check('a different seed deals a different tableau',
    JSON.stringify(K.snapshot(s).cards) !== JSON.stringify(K.snapshot(other).cards));
}

check('QH sits on KS (red on black, one rank down)', K.canPlace(12, 'h', 13, 's'));
check('QH does not sit on KH (same colour)', !K.canPlace(12, 'h', 13, 'h'));
check('only a king fills an empty column', K.kingOnEmpty(13) && !K.kingOnEmpty(12));
check('only an ace starts a foundation', K.aceOnFoundation(1) && !K.aceOnFoundation(2));

function blank() {
  const s = K.empty();
  s.pile = [];
  s.waste = [];
  s.desk = [[], [], [], [], [], [], []];
  s.finish = [[], [], [], []];
  return s;
}

{
  const s = blank();
  s.cards[0].facingUp = true; // AC
  s.waste = [0];
  const moved = K.tap(s, 0);
  check('tapping the ace of clubs sends it to a foundation',
    !!(moved && moved.dest === 'finish' && s.finish[moved.pile][0] === 0 && s.waste.length === 0), moved);
  check('…and scores +10', s.score === 10, s.score);
}

{
  const s = blank();
  s.cards[51].facingUp = true; // KS
  s.desk[0] = [51];
  const ok = K.applyMove(s, 51, { dest: 'desk', pile: 2 });
  check('a king may move to an empty column', ok && s.desk[2][0] === 51 && s.desk[0].length === 0);
  const again = K.tapDests(s, 51).some((d) => d.dest === 'desk' && s.desk[d.pile].length === 0);
  check('tap will not shuffle a king between empty columns', !again);
}

{
  const s = blank();
  s.cards[51].facingUp = true; // KS
  s.cards[37].facingUp = true; // QH  (hearts queen: 2*13+11)
  s.desk[0] = [51];
  s.desk[1] = [37];
  check('QH on KS is legal', K.applyMove(s, 37, { dest: 'desk', pile: 0 }) && s.desk[0].join(',') === '51,37');
}

{
  const s = blank();
  s.cards[38].facingUp = true; // KH
  s.cards[24].facingUp = true; // QD
  s.desk[0] = [38];
  s.desk[1] = [24];
  check('QD on KH is refused (both red)', !K.applyMove(s, 24, { dest: 'desk', pile: 0 }));
}

{
  const s = blank();
  s.pile = [10, 11, 12, 13];
  s.draw = 3;
  K.draw(s);
  check('draw 3 turns three cards, last drawn on top of the waste',
    s.pile.join(',') === '10' && s.waste.join(',') === '13,12,11' && s.cards[11].facingUp,
    { pile: s.pile, waste: s.waste });
  s.draw = 1;
  s.pile = [8, 9];
  s.waste = [];
  K.draw(s);
  check('draw 1 turns a single card', s.waste.join(',') === '9' && s.pile.join(',') === '8');
}

{
  const s = blank();
  s.waste = [1, 2, 3];
  s.cards[1].facingUp = s.cards[2].facingUp = s.cards[3].facingUp = true;
  s.draw = 3;
  s.score = 50;
  K.recycle(s);
  check('recycle flips the waste: oldest card is the next draw',
    s.waste.length === 0 && s.pile.join(',') === '3,2,1' && !s.cards[1].facingUp,
    { pile: s.pile });
  s.draw = 1;
  K.draw(s);
  check('…so the first card after a recycle is the oldest waste card',
    s.waste[s.waste.length - 1] === 1, s.waste);
  check('draw-3 recycle costs 20', s.score === 30, s.score);
}

{
  const s = blank();
  s.cards[0].facingUp = true;
  s.waste = [0];
  K.tap(s, 0);
  const score = s.score, moves = s.moves;
  check('undo is available after a move', s.history.length === 1);
  K.undo(s);
  check('undo restores the ace to the waste and the score',
    s.waste[0] === 0 && s.finish[0].length === 0 && s.score === 0 && s.moves === 0,
    { waste: s.waste, score: s.score, moves: s.moves, prev: { score: score, moves: moves } });
}

{
  const s = blank();
  s.finish = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
    [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
    [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
  ];
  check('four kings on the foundations is a win', K.checkWin(s) === true && s.won);
}

{
  const s = blank();
  s.cards[0].facingUp = true;
  s.cards[1].facingUp = true;
  s.finish[0] = [0];
  s.waste = [1]; // 2♣
  check('auto-complete walks a 2 onto its ace', K.autoStep(s) && s.finish[0].join(',') === '0,1');
}

{
  // A 1.0 save: no draw/score/moves/elapsed. Must still load the tableau.
  const s0 = K.newGame(seeded(7));
  const rec = {
    id: 'game',
    cards: s0.cards.map((c) => ({ type: c.type, number: c.number, facingUp: c.facingUp })),
    desk: s0.desk.map((d) => d.slice()),
    finish: s0.finish.map((d) => d.slice()),
    pile: s0.pile.slice(),
    waste: s0.waste.slice()
  };
  const loaded = K.restore(rec);
  check('a 1.0 save (no draw/score) still restores',
    !!(loaded && loaded.cards.length === 52 && loaded.draw === 3 && loaded.desk[6].length === 7),
    loaded && { draw: loaded.draw, col6: loaded.desk[6].length });
  const snap = K.snapshot(loaded);
  check('a round-trip snapshot still has id:game and 52 cards',
    snap.id === 'game' && snap.cards.length === 52 && Array.isArray(snap.desk));
}

{
  const s = blank();
  s.cards[0].facingUp = true;
  s.waste = [0];
  const h = K.hint(s);
  check('hint points at the ace that can go up', !!(h && h.card === 0 && h.dest && h.dest.dest === 'finish'), h);
}

const listing = JSON.parse(read('listing.json'));
const manifest = JSON.parse(read('manifest.json'));

// ---- the shuffle is fair --------------------------------------------------
// Deal 5,200 games from a seeded generator and count which card lands in each
// of three deck slots. A fair shuffle puts every card there ~100 times; the 1.0
// sort(Math.random) shuffle is skewed far past this bound.
{
  const rand = seeded(0xC0FFEE);
  const N = 5200;
  let worst = 0;
  for (const slot of [0, 25, 51]) {
    const hits = new Map();
    for (let n = 0; n < N; n++) {
      const g = K.newGame(rand);
      const c = g.cards[slot]; const k = c.type + c.number;
      hits.set(k, (hits.get(k) || 0) + 1);
    }
    const exp = N / 52;
    let chi = 0;
    for (let i = 0; i < 52; i++) { const k = [...hits.keys()][i]; chi += Math.pow((hits.get(k) || 0) - exp, 2) / exp; }
    chi += (52 - hits.size) * exp; // cards that never landed there
    worst = Math.max(worst, chi);
  }
  // 51 degrees of freedom: p = 0.0001 sits near chi2 = 99.
  check('the shuffle is uniform (every card equally likely in a slot)', worst < 99, { chi2: Math.round(worst) });
}

// ---- the page, run for real ---------------------------------------------
// klondike.js + app.js on a tiny fake DOM built from index.html, with nested
// markup, classList, pointer events on window, captured timers, and a fake
// gifos (save db + onBack) behind a Proxy that records any other call.
function parseInto(parent, html, make) {
  const re = /<(\/?)(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [parent]; let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { const t = m[5].trim(); if (t) stack[stack.length - 1].textContent += t; continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; (m[3] || '').replace(/([\w-]+)(?:="([^"]*)")?/g, (mm, k, v) => { attrs[k] = v === undefined ? '' : v; return mm; });
    const el = make(m[2], attrs);
    stack[stack.length - 1].appendChild(el);
    if (!m[4] && !/^(meta|link|br|input|img)$/i.test(m[2])) stack.push(el);
  }
}
function sim(opts) {
  opts = opts || {};
  const byId = {};
  function El(tag, attrs) {
    attrs = attrs || {};
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.children = []; this.parentNode = null;
    this.hidden = 'hidden' in attrs; this.disabled = false; this.textContent = ''; this.style = {}; this.listeners = {};
    this._cls = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const self = this;
    this.classList = {
      add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c), contains: (c) => self._cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !self._cls.has(c) : !!on; if (v) self._cls.add(c); else self._cls.delete(c); return v; },
    };
    if (attrs.id) { this.id = attrs.id; byId[attrs.id] = this; } else this.id = '';
  }
  Object.defineProperty(El.prototype, 'className', { get() { return [...this._cls].join(' '); }, set(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(El.prototype, 'innerHTML', { get() { return ''; }, set(h) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; parseInto(this, h, (t, a) => new El(t, a)); } });
  El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
  El.prototype.removeChild = function (c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
  El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
  El.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 60, height: 90 }; };
  El.prototype.all = function (f, out) { out = out || []; for (const c of this.children) { if (f(c)) out.push(c); c.all(f, out); } return out; };
  El.prototype.querySelectorAll = function (sel) { return this.all((c) => c._cls.has(sel.slice(1))); };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  // A click bubbles to ancestors (target stays the clicked element).
  El.prototype.fire = function (type, ev) {
    let stopped = false;
    const e = Object.assign({ target: this, button: 0, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() { stopped = true; } }, ev || {});
    for (let n = this; n && !stopped; n = n.parentNode) for (const fn of (n.listeners[type] || []).slice()) fn.call(n, e);
  };
  El.prototype.click = function () { this.fire('click'); };
  const doc = new El('#document');
  const html = read('index.html');
  parseInto(doc, html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, ''), (t, a) => new El(t, a));
  const winL = {}; const timers = [];
  const puts = []; let back = null; const gifosCalls = [];
  const gifos = new Proxy({
    db: () => ({ put: (r) => { puts.push(JSON.parse(JSON.stringify(r))); return Promise.resolve(); }, get: () => Promise.resolve(opts.saved || null) }),
    onBack: (fn) => { back = fn; },
  }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => gifosCalls.push(k) : undefined)) });
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    gifos,
    document: { getElementById: (id) => byId[id] || null, createElement: (t) => new El(t), addEventListener: (t, fn) => doc.addEventListener(t, fn) },
    addEventListener: (t, fn) => { (winL[t] = winL[t] || []).push(fn); },
    removeEventListener: (t, fn) => { winL[t] = (winL[t] || []).filter((f) => f !== fn); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('klondike.js'), sandbox, { filename: 'klondike.js' });
  vm.runInContext(read('app.js'), sandbox, { filename: 'app.js' });
  const flushTimers = () => { let n = 0; while (timers.length && n++ < 50) timers.shift().fn(); };
  const win = (type, ev) => (winL[type] || []).slice().forEach((fn) => fn(Object.assign({ preventDefault() {} }, ev)));
  // Each card element is the one whose pips show this card: find it by suit + rank class/text.
  const cardEls = () => doc.all((c) => c._cls.has('card'));
  return { doc, byId, puts, back: () => back && back(), gifosCalls, timers, flushTimers, win, cardEls, K: sandbox.Klondike, lastSave: () => puts[puts.length - 1] };
}
function rec(state) { const r = K.snapshot(state); return r; }
// The element showing card index i: app.js builds els[i] for s.cards[i]; the
// pile/desk mount order lets us find it by where the card sits in the state.
const deskTop = (S, pile) => { let n = S.byId['js-board'].children[pile]; while (n.children.some((c) => c._cls.has('card'))) n = n.children.find((c) => c._cls.has('card')); return n; };
const wasteTop = (S) => { const w = S.byId['js-deck-deal'].children; return w[w.length - 1]; };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  {
    // Tap-to-move: one tap sends an ace home; Undo puts it back.
    const st = blank(); st.cards[0].facingUp = true; st.waste = [0];
    const S = sim({ saved: rec(st) });
    await flush();
    const ace = wasteTop(S);
    check('fixture: the ace is on the waste', !!ace && ace._cls.has('card--front'));
    ace.click();
    const fin = S.byId['js-finish'].children.find((slot) => slot.children.length === 1);
    check('a tap sends the ace to a foundation', !!fin && fin.children[0] === ace && S.byId['js-deck-deal'].children.length === 0);
    S.flushTimers();
    check('the move is saved privately as id game', S.lastSave() && S.lastSave().id === 'game' && S.lastSave().waste.length === 0);
    check('Undo is enabled after a move', S.byId.undo.disabled === false);
    S.byId.undo.click();
    check('Undo puts the ace back on the waste', wasteTop(S) === ace && !fin.children.length);
    check('Undo is disabled with nothing to undo', S.byId.undo.disabled === true);
  }
  {
    // Several homes: the first tap selects, a tap on the chosen column moves.
    const st = blank();
    st.cards[37].facingUp = true; st.waste = [37];          // QH
    st.cards[51].facingUp = true; st.desk[0] = [51];        // KS
    st.cards[12].facingUp = true; st.desk[1] = [12];        // KC
    const S = sim({ saved: rec(st) });
    await flush();
    const q = wasteTop(S);
    q.click();
    check('with two homes a tap selects instead of moving', q._cls.has('sel') && q.parentNode === S.byId['js-deck-deal']);
    const kc = deskTop(S, 1);
    kc.click();
    check('a second tap on the chosen king moves the queen there', q.parentNode === kc);
  }
  {
    // Draw 1/3 is a real toggle and is saved.
    const S = sim();
    await flush();
    S.flushTimers();
    const d0 = (S.lastSave() || {}).draw;
    S.byId.drawN.click(); S.flushTimers();
    const d1 = S.lastSave().draw;
    S.byId.drawN.click(); S.flushTimers();
    const d2 = S.lastSave().draw;
    check('the draw toggle flips 3 -> 1 -> 3 and is saved', d1 !== undefined && [1, 3].indexOf(d1) >= 0 && d2 !== d1 && d2 === (d0 === undefined ? 3 : d0), { d0, d1, d2 });
    const pileBefore = S.lastSave().pile.length;
    S.byId['js-deck-pile'].click();
    S.flushTimers();
    check('a stock tap turns the toggled number of cards', pileBefore - S.lastSave().pile.length === d2, { before: pileBefore, after: S.lastSave().pile.length, draw: d2 });
  }
  {
    // Drag: it arms only past 8px, a long hold never arms, and a still
    // press + click is a tap.
    const st = blank(); st.cards[0].facingUp = true; st.waste = [0];
    const S = sim({ saved: rec(st) });
    await flush();
    const ace = wasteTop(S);
    ace.fire('pointerdown', { clientX: 100, clientY: 100 });
    S.flushTimers(); // a long-press timer would fire here
    check('holding still never arms a drag', !ace._cls.has('card--moving'));
    S.win('pointermove', { clientX: 105, clientY: 104 });
    check('a 6px wobble does not arm a drag', !ace._cls.has('card--moving'));
    S.win('pointerup', { clientX: 105, clientY: 104 });
    ace.click();
    const fin = S.byId['js-finish'].children.find((slot) => slot.children.length === 1);
    check('a press without travel is a tap (the ace goes home)', !!fin && fin.children[0] === ace);
    S.byId.undo.click();
    const ace2 = wasteTop(S);
    ace2.fire('pointerdown', { clientX: 100, clientY: 100 });
    S.win('pointermove', { clientX: 110, clientY: 108 });
    check('moving past 8px arms the drag', ace2._cls.has('card--moving'));
    S.win('pointerup', { clientX: 900, clientY: 900 });
    check('a drop on nothing puts the card back', !ace2._cls.has('card--moving') && wasteTop(S) === ace2);
  }
  {
    // Back: closes the ask, then a selection, then undoes, then lets go.
    const st = blank();
    st.cards[37].facingUp = true; st.waste = [37];
    st.cards[51].facingUp = true; st.desk[0] = [51];
    st.cards[12].facingUp = true; st.desk[1] = [12];
    st.cards[0].facingUp = true; st.desk[2] = [0];
    const S = sim({ saved: rec(st) });
    await flush();
    deskTop(S, 2).click();                       // ace home: one move in history
    S.byId['js-reset'].click();                  // a game in progress asks first
    check('New on a game in progress asks first', S.byId.ask.hidden === false);
    check('Back closes the ask', S.back() === true && S.byId.ask.hidden === true);
    const q = wasteTop(S); q.click();
    check('fixture: the queen is selected', q._cls.has('sel'));
    check('Back clears a selection', S.back() === true && !q._cls.has('sel'));
    check('Back undoes the last move', S.back() === true && S.byId['js-finish'].children.every((f) => !f.children.length));
    check('Back with nothing left returns false (the OS may leave)', S.back() === false);
  }
  {
    // A 1.0 save (no draw/score/moves) loads into the page.
    const s0 = K.newGame(seeded(7));
    const old = { id: 'game', cards: s0.cards.map((c) => ({ type: c.type, number: c.number, facingUp: c.facingUp })), desk: s0.desk.map((d) => d.slice()), finish: s0.finish.map((d) => d.slice()), pile: s0.pile.slice(), waste: s0.waste.slice() };
    const S = sim({ saved: old });
    await flush();
    let depth = 0; let n = S.byId['js-board'].children[6];
    while ((n = n.children.find((c) => c._cls.has('card')))) depth++;
    check('a 1.0 save loads its tableau into the page', depth === 7 && S.byId['js-deck-pile'].children.filter((c) => c._cls.has('card')).length === 24, depth);
    S.flushTimers();
  }
  {
    // No control in the page reaches for an OS invite or share.
    const S = sim();
    await flush();
    for (const el of S.doc.all((c) => c.tagName === 'BUTTON')) el.click();
    S.back();
    check('no in-app control calls an OS invite or share (Invite is OS chrome)', S.gifosCalls.length === 0, S.gifosCalls);
  }

  // ---- the stylesheet, resolved per element -------------------------------
  // A small cascade: rules (inside matching @media too), compound selectors of
  // tag/.class/#id joined by ' ' or '>', specificity, then source order.
  {
    const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = []; let order = 0;
    (function scan(text, media) {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i); if (open < 0) break;
        const head = text.slice(i, open).trim(); let depth = 1, k = open + 1;
        while (k < text.length && depth) { if (text[k] === '{') depth++; else if (text[k] === '}') depth--; k++; }
        const inner = text.slice(open + 1, k - 1);
        if (head.startsWith('@media')) scan(inner, head.slice(6).trim());
        else if (!head.startsWith('@')) for (const sel of head.split(',')) rules.push({ sel: sel.trim(), body: inner, media, order: order++ });
        i = k;
      }
    })(css, null);
    const mediaOk = (q, w) => !q || q.split(',').some((part) => (part.match(/\(([^)]+)\)/g) || []).every((f) => {
      const [k, v] = f.slice(1, -1).split(':').map((x) => x.trim());
      return k === 'max-width' ? w <= parseFloat(v) : k === 'min-width' ? w >= parseFloat(v) : false;
    }));
    const simple = (el, part) => {
      if (/[:\[]/.test(part)) return false;
      const m = part.match(/^([a-z]+)?((?:[.#][\w-]+)*)$/i); if (!m) return false;
      if (m[1] && el.tag !== m[1].toLowerCase()) return false;
      return (m[2].match(/[.#][\w-]+/g) || []).every((t) => t[0] === '#' ? el.id === t.slice(1) : el.cls.indexOf(t.slice(1)) >= 0);
    };
    const matches = (el, sel) => {
      const toks = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/);
      const go = (node, i) => {
        if (!node || !simple(node, toks[i])) return false;
        if (i === 0) return true;
        if (toks[i - 1] === '>') return go(node.parent, i - 2);
        for (let a = node.parent; a; a = a.parent) if (go(a, i - 1)) return true;
        return false;
      };
      return go(el, toks.length - 1);
    };
    const spec = (sel) => { const t = sel.replace(/>/g, ' '); return ((t.match(/#/g) || []).length * 100) + ((t.match(/\./g) || []).length * 10) + ((t.match(/(^|\s)[a-z]/gi) || []).length); };
    const resolve = (el, prop, width) => {
      let best = null;
      for (const r of rules) {
        if (!mediaOk(r.media, width) || !matches(el, r.sel)) continue;
        const m = new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;]+)').exec(r.body); if (!m) continue;
        const sp = spec(r.sel);
        if (!best || sp > best.sp || (sp === best.sp && r.order > best.order)) best = { v: m[1].trim(), sp, order: r.order };
      }
      return best && best.v;
    };
    const node = (tag, cls, parent, id) => ({ tag, cls, parent: parent || null, id: id || '' });
    const board = node('div', ['board-deck']);
    const col = node('div', ['seven'], board);
    const back = node('div', ['card', 'card--back'], col);
    const front = node('div', ['card', 'card--front', 'card--hearts'], back);
    const front2 = node('div', ['card', 'card--front', 'card--spades'], front);
    const pipOfFront = node('span', ['pip', 'tl'], front);
    const pipOfBack = node('span', ['pip', 'tl'], back);
    check('a face-up card nested in a face-down card shows its pips', resolve(pipOfFront, 'display', 1024) !== 'none');
    check('a face-down card hides its own pips', resolve(pipOfBack, 'display', 1024) === 'none');
    const phoneTop = parseFloat(resolve(front2, 'top', 390));
    const backTop = parseFloat(resolve(front, 'top', 390));
    check('on a phone a face-up overlap still leaves a readable rank (>= 15px)', phoneTop >= 15, phoneTop);
    check('on a phone face-up overlaps step wider than face-down ones', phoneTop > backTop, { phoneTop, backTop });
    const bar = node('div', ['bar']);
    const undo = node('button', [], bar, 'undo');
    check('the Undo button is a 44px thumb target', parseFloat(resolve(undo, 'min-height', 390)) >= 44, resolve(undo, 'min-height', 390));
    check('the stylesheet pulls nothing remote (@import, url(http…))', !/@import/i.test(css) && !/url\(\s*['"]?https?:/i.test(css));
  }

  // Every script and stylesheet index.html loads ships inside the app; no modules.
  {
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    const refs = [];
    html.replace(/<(script|link)\b([^>]*)>/gi, (m, tag, attrs) => { const a = /\b(src|href)=["']([^"']+)["']/.exec(attrs); refs.push({ ref: a ? a[2] : null, module: /type=["']module["']/i.test(attrs) }); return m; });
    const missing = refs.filter((r) => r.ref && !fs.existsSync(path.join(APP, r.ref)));
    check('every loaded file ships inside the app (no CDN)', refs.filter((r) => r.ref).length >= 3 && missing.length === 0, missing);
    check('classic scripts only', refs.every((r) => !r.module));
  }

  check('listing tagline fits a card', listing.tagline.length <= 80);
  check('author is rjanjic, porter GifOS', listing.author.name === 'rjanjic' && listing.porter.name === 'GifOS');
  check('one-player: no multiplayer capability', !manifest.capabilities.multiplayer);
  check('minBuild stays 947', manifest.minBuild === 947);

  if (failures) {
    console.log('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nsolitaire unit: all PASS');
})();
