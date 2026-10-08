// PIANO TRAINER HAS TO FINISH A SCALE AND SCORE A QUIZ WITHOUT MIDI.
//
// A port of ZaneH/piano-trainer that cannot complete a C major scale from
// taps, or that names C-E-G anything other than "C major", is not a trainer.
// This suite PLAYS the theory loop in a vm: seed Math.random, feed notes,
// score answers. Then app.js runs on a fake page with a recorded Web Audio:
// home-row keys, pointer glissando, MIDI, modes, quiz, together, Back.
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
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'theory.js'), 'utf8'), sandbox, { filename: 'theory.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'sound.js'), 'utf8'), sandbox, { filename: 'sound.js' });
  return sandbox;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = src('index.html');
const css = src('style.css');
const listing = JSON.parse(src('listing.json'));
const manifest = JSON.parse(src('manifest.json'));

const sandbox = load();
const PT = sandbox.PT;
check('theory.js loads and attaches PT', !!(PT && PT.Trainer && PT.chordName && PT.quizItem && PT.scoreQuiz));
check('sound.js attaches a local piano bank', sandbox.PTSound && sandbox.PTSound.kind === 'local-piano');

const C = PT.TONICS.filter((t) => t.id === 'c-major')[0];
check('C major is aboard', !!(C && C.root === 48));
const sc = PT.scaleNotes(C);
check('C major is C D E F G A B C', sc.join(',') === '48,50,52,53,55,57,59,60', sc);

{
  const tri = PT.triad(sc, 0);
  check('I of C is C E G', tri.join(',') === '48,52,55', tri);
  check('that triad is named C major', PT.chordName(tri) === 'C major', PT.chordName(tri));
}
{
  const am = PT.triad(PT.scaleNotes(PT.tonicById('a-minor')), 0);
  check('i of A minor is A C E', am.join(',') === '57,60,64', am);
  check('A C E is named A minor', PT.chordName(am) === 'A minor', PT.chordName(am));
}
{
  const g7 = PT.seventh(sc, 4); // V7 of C: G B D F
  check('V7 of C is G B D F', g7.join(',') === '55,59,62,65', g7);
  check('G B D F is named G7', PT.chordName(g7) === 'G7', PT.chordName(g7));
}
{
  const bdim = PT.triad(sc, 6);
  check('vii of C is B D F', bdim.join(',') === '59,62,65', bdim);
  check('B D F is named B diminished', PT.chordName(bdim) === 'B diminished', PT.chordName(bdim));
}
check('fifth of C is G', PT.fifthOf(sc, 48) === 55);
check('fifthAbove(C) is G', PT.fifthAbove('C') === 'G');
check('fifthAbove(G) is D', PT.fifthAbove('G') === 'D');
check('C major has no accidentals', PT.keySignature(C).n === 0, PT.keySignature(C));
check('G major has 1 sharp', PT.keySignature(PT.tonicById('g-major')).n === 1);
check('D major has 2 sharps', PT.keySignature(PT.tonicById('d-major')).n === 2);
check('F major has 1 flat', PT.keySignature(PT.tonicById('f-major')).n === 1);
check('octave-equivalent chord match', PT.chordMatch([60, 52, 55], [48, 52, 55]));

// ---- PLAY a C major scale without MIDI --------------------------------------
{
  const T = PT.Trainer.create({ mode: 'scales', tonicId: 'c-major', rand: () => 0 });
  check('a fresh trainer is on C major scales', T.mode === 'scales' && T.tonicId === 'c-major' && T.step === 0);
  const seq = T.target.slice();
  check('C major up-and-down is 15 notes (8 up, 7 down)', seq.length === 15, seq);
  check('it starts on C3 and hits C4', seq[0] === 48 && seq.indexOf(60) >= 0, seq);
  let advanced = 0;
  seq.forEach((n) => {
    const r = T.down(n);
    if (r.advanced) advanced++;
    T.up(n);
  });
  check('every note of the scale advances the trainer', advanced === 15, { advanced, rounds: T.rounds, step: T.step });
  check('the scale COMPLETES without MIDI', T.rounds === 1, T.rounds);
  check('progress records the finished round', (T.done['c-major:scales'] | 0) === 1, T.done);
}

// Wrong note does not advance.
{
  const T = PT.Trainer.create({ mode: 'scales', tonicId: 'c-major', rand: () => 0 });
  const r = T.down(49); // C#
  check('a wrong pitch does not advance', r.advanced === false && T.step === 0);
  T.up(49);
  const ok = T.down(48);
  check('the right pitch then does', ok.advanced === true && T.step === 1);
}

// ---- PLAY a C major triad (chords mode) -------------------------------------
{
  const T = PT.Trainer.create({ mode: 'chords', tonicId: 'c-major', rand: () => 0 });
  const want = T.want();
  check('first chord of C is C E G', want.join(',') === '48,52,55', want);
  T.down(48); T.down(52);
  check('two notes of a triad are not enough', T.step === 0);
  const r = T.down(55);
  check('holding the whole triad advances', r.advanced === true && T.step === 1);
  const names = [];
  T.target.forEach((ch) => names.push(PT.chordName(ch)));
  check('the seven triads of C are named', names[0] === 'C major' && names[5] === 'A minor' && names[6] === 'B diminished', names);
}

// ---- PLAY fifths around the circle ------------------------------------------
{
  const T = PT.Trainer.create({ mode: 'fifths', tonicId: 'c-major', rand: () => 0 });
  check('fifths walk all seven degrees', T.target.length === 7, T.target.length);
  const first = T.want();
  check('first fifth of C is C then G', first.join(',') === '48,55', first);
  T.down(48); T.down(55);
  check('playing the pair advances', T.step === 1);
}

// ---- SCORE a quiz -----------------------------------------------------------
{
  const rand = seeded(0xC0FFEE);
  const fifth = PT.quizItem(rand, { type: 'fifth' });
  check('a fifth question has four options and a prompt',
    !!(fifth.prompt && fifth.answer && fifth.options.length === 4 && fifth.options.indexOf(fifth.answer) >= 0), fifth);
  const right = PT.scoreQuiz(fifth, fifth.answer);
  const wrong = PT.scoreQuiz(fifth, fifth.options.filter((o) => o !== fifth.answer)[0]);
  check('the right fifth scores', right.ok === true && right.delta === 1, right);
  check('a wrong fifth does not', wrong.ok === false && wrong.delta === 0, wrong);

  const chordQ = PT.quizItem(rand, { type: 'chord' });
  check('a chord question names a real chord',
    !!(chordQ.prompt && chordQ.answer && chordQ.options.length === 4), chordQ);
  check('answering the chord name scores', PT.scoreQuiz(chordQ, chordQ.answer).ok === true);

  const sigQ = PT.quizItem(rand, { type: 'signature' });
  const sigTonic = PT.TONICS.filter((t) => t.kind === 'major' && t.root === sigQ.midi)[0];
  check('a key-signature question includes its answer',
    sigQ.type === 'signature' && !!sigTonic && sigQ.answer === PT.keySignature(sigTonic).label &&
    sigQ.options.indexOf(sigQ.answer) >= 0 && sigQ.options.length === 4, sigQ);
  const relQ = PT.quizItem(rand, { type: 'relative' });
  const relTonic = PT.TONICS.filter((t) => t.kind === 'major' && t.root === relQ.midi)[0];
  check('relative minor of a major is in the options',
    relQ.type === 'relative' && !!relTonic && relQ.answer === PT.REL_MIN[PT.FIFTHS.indexOf(relTonic.name)] &&
    relQ.options.indexOf(relQ.answer) >= 0, relQ);
  check('C major\'s relative minor is Am', PT.REL_MIN[PT.FIFTHS.indexOf('C')] === 'Am');

  const playQ = PT.quizItem(rand, { type: 'play' });
  check('a play question can be answered by tapping a key (no MIDI)',
    playQ.type === 'play' && playQ.midi != null && PT.scoreQuiz(playQ, playQ.midi).ok === true, playQ);
  check('…and also by picking the note name', PT.scoreQuiz(playQ, playQ.answer).ok === true);
}

{
  const T = PT.Trainer.create({ mode: 'quiz', tonicId: 'c-major', rand: seeded(7) });
  check('quiz mode deals a question', !!(T.quiz && T.quiz.answer && T.quiz.options.length === 4), T.quiz);
  const r = T.answer(T.quiz.answer);
  check('a correct tap on a quiz option increments the score', r.ok === true && T.quizScore === 1 && T.quizAsked === 1, r);
  const miss = T.answer('NOT-A-CHORD');
  check('a miss keeps the score and breaks the streak', miss.ok === false && T.quizScore === 1 && T.quizStreak === 0, miss);
}

{
  const T = PT.Trainer.create({ mode: 'quiz', rand: () => 0.9 });
  // force a play question
  T.quiz = PT.quizItem(() => 0, { type: 'play' });
  const r = T.down(T.quiz.midi);
  check('playing the named key scores the quiz without MIDI', r.ok === true && T.quizScore === 1, r);
}

// ---- saved progress of the CURRENT version still loads ----------------------
{
  const T = PT.Trainer.create({ mode: 'scales', tonicId: 'g-major' });
  T.quizScore = 4; T.rounds = 2; T.done['g-major:scales'] = 2;
  const snap = PT.snapshot(T);
  check('snapshot keeps last key/mode/score', snap.mode === 'scales' && snap.tonicId === 'g-major' && snap.quizScore === 4);
  const fresh = PT.Trainer.create();
  PT.applySave(fresh, { mode: 'chords', tonicId: 'c-major', quizScore: 9, hard: true });
  check('an old save (mode, tonic, score only) still loads',
    fresh.mode === 'chords' && fresh.tonicId === 'c-major' && fresh.quizScore === 9 && fresh.hard === true);
  const empty = PT.Trainer.create();
  PT.applySave(empty, null);
  check('an empty first-run stays on C major scales', empty.mode === 'scales' && empty.tonicId === 'c-major' && empty.quizScore === 0);
}

// ---- quiz questions are never ambiguous or self-answering ------------------
// The first port asked "Which scale starts on C major?" with "C major" as the
// answer. For every question type but 'play' (whose whole point is to name
// the key to press), the prompt must not contain the answer, the options must
// be distinct, and exactly one option must score.
{
  const bad = [];
  for (const type of ['fifth', 'signature', 'relative', 'chord', 'play']) {
    const rand = seeded(0xA11 + type.length);
    for (let i = 0; i < 150; i++) {
      const q = PT.quizItem(rand, { type });
      const esc = String(q.answer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const leaks = type !== 'play' && new RegExp('(^|[^\\w#])' + esc + '($|[^\\w#])').test(q.prompt);
      const distinct = new Set(q.options).size === q.options.length;
      const right = q.options.filter((o) => PT.scoreQuiz(q, o).ok).length;
      if (leaks || !distinct || right !== 1) { bad.push({ type, prompt: q.prompt, answer: q.answer, options: q.options, right }); break; }
    }
  }
  check('quiz prompts are not ambiguous scale-starts-on', bad.length === 0, bad);
}

// ---- the app: theory.js + sound.js + app.js on a fake page ------------------
const pageEls = {};
const modeButtons = [];
html.replace(/<!--[\s\S]*?-->/g, '').replace(/<([a-z0-9]+)\b([^>]*)>/gi, (all, tag, attrs) => {
  const a = {};
  attrs.replace(/([\w-]+)(?:="([^"]*)")?/g, (m, k, v) => { a[k] = v === undefined ? true : v; return m; });
  if (a.id) pageEls[a.id] = { tag: tag.toLowerCase(), attrs: a };
  if (a['data-mode']) modeButtons.push(a['data-mode']);
  return all;
});

const tickP = () => new Promise((r) => setImmediate(r));
async function settleAll() { for (let i = 0; i < 20; i++) await tickP(); }

function pianoApp(opts) {
  opts = opts || {};
  const mkEl = (id, tag) => {
    const cls = new Set();
    const attrs = {};
    let inner = '';
    const e = {
      id, tagName: (tag || 'div').toUpperCase(), hidden: false, textContent: '', value: '', checked: false,
      style: {}, children: [], onclick: null, onchange: null, listeners: {}, captured: [],
      get className() { return Array.from(cls).join(' '); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => cls.add(c)); },
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); },
      },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] == null ? null : attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      querySelectorAll(q) { return q === 'button' ? this.children.filter((c) => c.tagName === 'BUTTON') : []; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      fire(t, ev) { (this.listeners[t] || []).forEach((f) => f(Object.assign({ type: t, preventDefault() {} }, ev || {}))); },
      setPointerCapture(pid) { this.captured.push(pid); },
      get innerHTML() { return inner; },
      set innerHTML(v) { inner = v; if (v === '') this.children = []; },
    };
    return e;
  };
  const els = {};
  Object.keys(pageEls).forEach((id) => {
    const e = mkEl(id, pageEls[id].tag);
    e.hidden = pageEls[id].attrs.hidden === true;
    els[id] = e;
  });
  modeButtons.forEach((m) => {
    const b = mkEl('', 'button');
    b.setAttribute('data-mode', m);
    els.modes.children.push(b);
  });
  const timers = [];
  let now = 0;
  const runTimers = (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((p, q) => p.at - q.at);
      if (!timers.length || timers[0].at > until) break;
      const t = timers.shift();
      now = t.at;
      t.f();
    }
    now = until;
  };
  // Web Audio, recorded
  const started = [];
  const stopped = [];
  class AudioContext {
    constructor() { this.sampleRate = 4000; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} };
    }
    createBuffer(ch, n, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(n));
      return { length: n, sampleRate: sr, getChannelData: (i) => data[i] };
    }
    createBufferSource() {
      const src = { buffer: null, connect() {}, start() { started.push(src); }, stop() { stopped.push(src); } };
      return src;
    }
    resume() { return Promise.resolve(); }
  }
  const windowListeners = {};
  const netTouches = [];
  const dbs = {};
  const db = (name) => {
    if (!dbs[name]) {
      const st = { rows: {}, puts: [], subs: [] };
      st.api = {
        get: (id) => Promise.resolve(st.rows[id]),
        put: (row) => { st.puts.push(JSON.parse(JSON.stringify(row))); st.rows[row.id] = row; return Promise.resolve(); },
        subscribe: (f) => { st.subs.push(f); },
      };
      dbs[name] = st;
    }
    return dbs[name].api;
  };
  if (opts.saved) { db('save'); dbs.save.rows.last = opts.saved; }
  const backs = [];
  const sb = {
    console, Math, Object, Array, JSON, String, Number, Boolean, Promise, Error, parseInt, Float32Array,
    Date: { now: () => now },
    AudioContext,
    navigator: opts.midi ? { requestMIDIAccess: () => Promise.resolve(opts.midi) } : {},
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (t) => mkEl('', t),
      elementsFromPoint: (x) => els.piano.children.filter((k) => +k.getAttribute('data-midi') === x),
    },
    addEventListener: (t, f) => { (windowListeners[t] = windowListeners[t] || []).push(f); },
    setTimeout: (f, ms) => { timers.push({ at: now + (ms || 0), f }); return timers.length; },
    clearTimeout: () => {},
    gifos: {
      db,
      me: () => Promise.resolve({ id: 'me-1', name: 'Pat' }),
      onBack: (f) => backs.push(f),
    },
  };
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Audio'].forEach((k) => {
    Object.defineProperty(sb, k, { get() { netTouches.push(k); return undefined; }, configurable: true });
  });
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src('theory.js'), sb, { filename: 'theory.js' });
  vm.runInContext(src('sound.js'), sb, { filename: 'sound.js' });
  const attacks = [];
  const releases = [];
  const S = sb.PTSound;
  const realAttack = S.attack, realRelease = S.release;
  S.attack = function (m) { attacks.push(m); return realAttack.apply(this, arguments); };
  S.release = function (m) { releases.push(m); return realRelease.apply(this, arguments); };
  vm.runInContext(src('app.js'), sb, { filename: 'app.js' });
  const key = (code, type) => (windowListeners[type || 'keydown'] || []).forEach((f) => f({ code, repeat: false, target: {}, preventDefault() {} }));
  const tap = (code) => { key(code, 'keydown'); key(code, 'keyup'); };
  const keyEl = (midi) => els.piano.children.find((k) => +k.getAttribute('data-midi') === midi);
  const mode = (m) => els.modes.onclick({ target: els.modes.children.find((b) => b.getAttribute('data-mode') === m) });
  return { sb, els, dbs, backs, attacks, releases, started, stopped, netTouches, runTimers, key, tap, keyEl, mode };
}

const CODE_OF = {};
Object.keys(PT.HOME).forEach((c) => { CODE_OF[PT.HOME[c]] = c; });

async function appChecks() {
  // -- sound.js: Web Audio really plays a note ------------------------------
  {
    const h = pianoApp({});
    await settleAll();
    h.sb.PTSound.attack(60);
    const src0 = h.started[0];
    let energy = 0;
    if (src0 && src0.buffer) { const d = src0.buffer.getChannelData(0); for (let i = 0; i < d.length; i += 7) energy += Math.abs(d[i]); }
    check('Web Audio actually plays', !!src0 && energy > 1, { started: h.started.length, energy });
    h.sb.PTSound.release(60);
    check('…and releasing the key stops it', h.stopped.indexOf(src0) !== -1);
  }

  // -- first run, home row, a finished scale, saved -------------------------
  {
    const h = pianoApp({});
    await settleAll();
    check('empty first-run paints a coach line', h.els.coach.hidden === false);
    check('on-screen keys carry midi + a label',
      PT.WHITES.concat(PT.BLACKS).every((m) => h.keyEl(m) && h.keyEl(m).tagName === 'BUTTON' && h.keyEl(m).getAttribute('aria-label')) &&
      PT.WHITES.every((m) => h.keyEl(m).children.some((c) => c.className === 'letter')));
    check('the next key is marked on the piano', /\bnext\b/.test(h.keyEl(48).className) && !/\bnext\b/.test(h.keyEl(50).className));
    h.tap('KeyA');
    check('home-row A is C3', PT.HOME.KeyA === 48 && h.attacks[0] === 48, h.attacks);
    check('home-row mapping is used from the keyboard', /\bnext\b/.test(h.keyEl(50).className) && h.releases.indexOf(48) !== -1);
    check('the coach line goes once you play', h.els.coach.hidden === true);
    const rest = PT.Trainer.create({ mode: 'scales', tonicId: 'c-major', rand: () => 0 }).target.slice(1);
    rest.forEach((m) => h.tap(CODE_OF[m]));
    h.runTimers(1000);
    check('the scale COMPLETES from the home row', h.els.doneChip.hidden === false);
    const saves = h.dbs.save.puts;
    const last = saves[saves.length - 1];
    check('progress is written to gifos.db save',
      !!last && last.id === 'last' && last.rounds === 1 && last.done && last.done['c-major:scales'] === 1, last);
    check('their server stays behind (no network, no remote samples)', h.netTouches.length === 0, h.netTouches);
  }

  // -- a saved player who has already played sees no coach -----------------
  {
    const h = pianoApp({ saved: { id: 'last', mode: 'chords', tonicId: 'g-major', quizScore: 3, seen: true } });
    await settleAll();
    check('a returning player gets their key and mode back, no coach',
      h.els.tonic.value === 'g-major' && h.els.coach.hidden === true &&
      h.els.modes.children.find((b) => b.getAttribute('data-mode') === 'chords').classList.contains('on'));
  }

  // -- phone keys: pointer tracking + capture, glissando, chords ------------
  {
    const h = pianoApp({});
    await settleAll();
    const P = h.els.piano;
    P.fire('pointerdown', { pointerId: 7, clientX: 48, clientY: 10 });
    check('phone keys: a press captures the pointer and sounds the key', P.captured.indexOf(7) !== -1 && h.attacks.indexOf(48) !== -1);
    P.fire('pointermove', { pointerId: 7, clientX: 50, clientY: 10 });
    check('phone keys: sliding to the next key moves the note', h.releases.indexOf(48) !== -1 && h.attacks.indexOf(50) !== -1);
    P.fire('pointerup', { pointerId: 7, clientX: 50, clientY: 10 });
    check('phone keys: lifting releases it', h.releases.indexOf(50) !== -1);
    h.mode('chords');
    P.fire('pointerdown', { pointerId: 1, clientX: 48 });
    P.fire('pointerdown', { pointerId: 2, clientX: 52 });
    P.fire('pointerdown', { pointerId: 3, clientX: 55 });
    // after C-E-G the next chord is D-F-A: D is marked next
    check('phone keys: three fingers hold a triad and advance the chord', /\bnext\b/.test(h.keyEl(50).className) && /\bnext\b/.test(h.keyEl(53).className));
  }

  // -- MIDI is optional, and works when it is there --------------------------
  {
    const port = {};
    const h = pianoApp({ midi: { inputs: [port], onstatechange: null } });
    await settleAll();
    check('a MIDI keyboard plays the trainer when one is present',
      typeof port.onmidimessage === 'function' && (port.onmidimessage({ data: [0x90, 48, 100] }), h.attacks.indexOf(48) !== -1) &&
      (port.onmidimessage({ data: [0x80, 48, 0] }), h.releases.indexOf(48) !== -1));
    check('MIDI is optional (requestMIDIAccess, never required)',
      !/midi/i.test(JSON.stringify(manifest.capabilities || {})));
  }

  // -- modes: circle of fifths, Hear, quiz ----------------------------------
  {
    const h = pianoApp({});
    await settleAll();
    check('every mode has a tab', ['scales', 'chords', 'sevenths', 'fifths', 'quiz'].every((m) => modeButtons.indexOf(m) !== -1));
    h.mode('fifths');
    const wedges = h.els.circle.children.filter((c) => /\bwedge\b/.test(c.className));
    check('circle of fifths is a mode with a wheel', h.els.circle.hidden === false && wedges.length === 12);
    const gWedge = wedges[PT.FIFTHS.indexOf('G')];
    gWedge.onclick();
    check('tapping a wedge changes key', h.els.tonic.value === 'g-major', h.els.tonic.value);
    h.mode('scales');
    check('the wheel goes away outside fifths mode', h.els.circle.hidden === true);
    const n0 = h.started.length;
    h.els.hearBtn.onclick();
    h.runTimers(2000);
    const heard = h.started.slice(n0);
    check('Hear plays the next notes', heard.length === 1 && heard[0].buffer === h.sb.PTSound.bufferFor(55), heard.length);

    h.mode('quiz');
    check('quiz mode deals four options', h.els.quizBox.hidden === false && h.els.quizBox.children.length === 4);
    const opt = h.els.quizBox.children[0];
    opt.onclick();
    h.runTimers(1000);
    check('tapping a quiz option scores it', /^(good|bad)$/.test(opt.className) && /^\d+$/.test(h.els.quizScore.textContent),
      { cls: opt.className, score: h.els.quizScore.textContent });
    h.mode('chords');
    check('hidden quiz cannot leak into other modes', h.els.quizBox.hidden === true && h.els.quizBox.children.length === 0 &&
      /^none\s*!important$/.test(cssDecl('[hidden]', 'display') || ''));
  }

  // -- together, Back, buttons ----------------------------------------------
  {
    const h = pianoApp({});
    await settleAll();
    check('no in-app Invite button', !Object.keys(pageEls).some((id) => /invite/i.test(id)));
    check('every button in the page does something',
      Object.keys(pageEls).filter((id) => pageEls[id].tag === 'button').every((id) => typeof h.els[id].onclick === 'function') &&
      typeof h.els.modes.onclick === 'function');
    check('gifos.onBack is registered', h.backs.length === 1);
    check('Back with the coach up dismisses the coach', h.backs[0]() === true && h.els.coach.hidden === true);
    check('Back with nothing open lets the OS close', h.backs[0]() === false);
    h.els.togetherBtn.onclick.call(h.els.togetherBtn);
    const room = h.dbs.room;
    const row = room.puts[room.puts.length - 1];
    check('Practice together shows the invite note and publishes my prompt',
      h.els.togetherNote.hidden === false && row && row.id === 'me-1' && row.mode === 'scales');
    room.subs[0]([{ id: 'me-1', at: 1 }, { id: 'friend-9', name: 'Lee', mode: 'chords', at: 2 }]);
    check('a friend\'s prompt shows up', h.els.friendNote.hidden === false);
    check('Back leaves practice-together first', h.backs[0]() === true && h.els.togetherNote.hidden === true && h.els.friendNote.hidden === true);
  }
}

const cssRules = [];
css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, body) => {
  const decls = {};
  body.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  cssRules.push({ sels: sel.split(',').map((x) => x.trim().replace(/\s+/g, ' ')), decls });
  return all;
});
function cssDecl(sel, prop) {
  let v = null;
  cssRules.forEach((r) => { if (r.sels.indexOf(sel) !== -1 && r.decls[prop] != null) v = r.decls[prop]; });
  return v;
}
check('phone keys: touch-action none on the piano', cssDecl('.piano', 'touch-action') === 'none', cssDecl('.piano', 'touch-action'));
{
  const refs = [];
  html.replace(/<!--[\s\S]*?-->/g, '').replace(/\b(?:src|href)="([^"]*)"/g, (a, u) => { refs.push(u); return a; });
  check('no remote URLs in the entry', refs.length > 0 && refs.every((u) => !/^(https?:)?\/\//i.test(u)), refs);
}
check('minBuild stays 947', manifest.minBuild === 947);
check('db + multiplayer, no network',
  manifest.capabilities.db === true && manifest.capabilities.multiplayer === true && !manifest.capabilities.network);
check('save is private, room is shared',
  manifest.data.save.visibility === 'private' && manifest.data.room.visibility === 'read-write');
check('listing is a port of Zane Helton, not GifOS',
  listing.author.name === 'Zane Helton' && listing.porter.name === 'GifOS' && listing.basedOn.name === 'Piano Trainer' && listing.basedOn.blessed === false);
check('tagline fits a card', listing.tagline.length > 8 && listing.tagline.length < 80);

appChecks().then(() => {
  if (failures) {
    console.log('\n' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('\nall PASS');
}, (e) => { console.log('FAIL — app harness threw: ' + (e && e.stack)); process.exit(1); });
