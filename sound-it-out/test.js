// THE SOUND-IT-OUT PORT IS HELD AGAINST ITS PYTHON ORIGINAL, MECHANICALLY.
//
// apps/sound-it-out is a port of the sound-it-out desktop app (0.4.x: the
// sentence-library design), and a port of a curriculum is exactly the kind of
// code that rots invisibly: a wrong pad or a missing highlight is not a
// crash, it is a subtly worse video that nobody re-watches frame by frame.
// The desktop pipeline writes a fixture (tools/gen-clips.py: every segment
// gen/levels.py's library builder produces for a canonical library) and this
// suite replays the SAME library through the shipped curriculum.js and
// compares segment by segment.
//
// It also guards the bundle-completeness invariant the voice design rests
// on: every clip the starter packs can request must exist in clips-data.js -
// phonemes are never synthesised at runtime, so a missing bundled phoneme is
// a silently mute letter, forever.
//
// The storage, sight-word and export checks run the shipped ui.js/app.js and
// exporter.js (over a small in-memory DOM built from index.html) and assert
// what they write and do, not what their source says.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};
// Checks that must await the app run after the synchronous ones, in order.
const later = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- load the shipped modules exactly as the GIF would run them -------------
const sandbox = { window: {}, atob, btoa, console };
vm.createContext(sandbox);
for (const f of ['fonts-data.js', 'clips-data.js', 'dictionary-data.js', 'dictionary.js', 'curriculum.js', 'library.js', 'dsp.js', 'store.js', 'voice.js', 'studio.js', 'storyboard.js', 'player.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const SIO = sandbox.window.SIO;
const CLIPS = sandbox.window.SIO_CLIPS;
check('modules load and attach window.SIO',
  !!(SIO && SIO.curriculum && SIO.library && SIO.dsp && SIO.storyboard));

const cur = SIO.curriculum, lib = SIO.library;

// ---- word mechanics ---------------------------------------------------------
{
  const j = (x) => JSON.stringify(x);
  check('magic-e splits onset + rime: case = c + ase',
    j(cur.splitGraphemes('case')) === j([['c', 'k'], ['ase', 'eɪs']]), cur.splitGraphemes('case'));
  check('digraph + rime: Chase = Ch + ase',
    j(cur.splitGraphemes('Chase')) === j([['Ch', 'tʃ'], ['ase', 'eɪs']]), cur.splitGraphemes('Chase'));
  check('the rime softens c: face = f + ace said /eɪs/',
    j(cur.splitGraphemes('face')) === j([['f', 'f'], ['ace', 'eɪs']]), cur.splitGraphemes('face'));
  check('the rime softens g: cage = c + age said /eɪdʒ/',
    j(cur.splitGraphemes('cage')) === j([['c', 'k'], ['age', 'eɪdʒ']]), cur.splitGraphemes('cage'));
  check('consonant-le is its own little syllable: Rubble = R-u-bb-le (0.7.8)',
    j(cur.splitGraphemes('Rubble')) === j([['R', 'ɹ'], ['u', 'ʌ'], ['bb', 'b'], ['le', 'əl']]),
    cur.splitGraphemes('Rubble'));
  check('the dictionary agrees: rubble = ru-bb-le',
    j(cur.wordParts('rubble')) === j([['ru', 'ɹʌ'], ['bb', 'b'], ['le', 'əl']]), cur.wordParts('rubble'));
  check('a nonsense name reads zor-bul instead of being refused: Zorble',
    cur.decodable('zorble') === true
    && j(cur.splitGraphemes('Zorble').slice(-1)) === j([['le', 'əl']]), cur.splitGraphemes('Zorble'));
  check('names follow the syllable rules: Zuma = Z-u(oo)-m-a(uh) (0.7.9)',
    j(cur.splitGraphemes('Zuma')) === j([['Z', 'z'], ['u', 'uː'], ['m', 'm'], ['a', 'ə']]),
    cur.splitGraphemes('Zuma'));
  check('closed syllables stay short: vam is untouched',
    j(cur.splitGraphemes('vam')) === j([['v', 'v'], ['a', 'æ'], ['m', 'm']]), cur.splitGraphemes('vam'));
  check('doubled consonants are one sound: zoss = z-o-ss',
    j(cur.splitGraphemes('zoss')) === j([['z', 'z'], ['o', 'ɒ'], ['ss', 's']]), cur.splitGraphemes('zoss'));
  // The aligned dictionary answers first (0.6.0): it knows how real words
  // actually chunk, including the taught exceptions.
  check('the dictionary parsed', SIO.dictionary.load().size > 100000, SIO.dictionary.load().size);
  check('said builds as s-ai-d with ai saying /ɛ/',
    j(cur.wordParts('said')) === j([['s', 's'], ['ai', 'ɛ'], ['d', 'd']]), cur.wordParts('said'));
  check('the builds as th-e', j(cur.wordParts('the')) === j([['th', 'ð'], ['e', 'ə']]), cur.wordParts('the'));
  check('nose keeps its /z/', j(cur.wordParts('nose')) === j([['n', 'n'], ['ose', 'əʊz']]), cur.wordParts('nose'));
  check('is builds again - the lexicon splits the notorious single-chunkers (0.7.5)',
    j(cur.wordParts('is')) === j([['i', 'ɪ'], ['s', 'z']]), cur.wordParts('is'));
  check('a one-chunk word with matching letters and sounds pairs them: ab',
    j(cur.wordParts('ab')) === j([['a', 'æ'], ['b', 'b']]), cur.wordParts('ab'));
  check('the rules still serve nonsense: vam',
    j(cur.wordParts('vam')) === j([['v', 'v'], ['a', 'æ'], ['m', 'm']]), cur.wordParts('vam'));
  check('chunk sounds split into recordable phonemes: eɪk -> eɪ + k',
    j(SIO.dictionary.tokens('eɪk')) === j(['eɪ', 'k']) && j(SIO.dictionary.tokens('æn')) === j(['æ', 'n']));
  check('the schwa answers to the recorded /ʌ/',
    (cur.PHONEME_ALIASES['ə'] || []).includes('ʌ'));
  for (const w of ['sat', 'case', 'chase', 'is', 'vam', 'ship', 'like',
    'the', 'said', 'nose', 'have', 'happy', 'care', 'grandma']) {
    check(`decodable: ${w}`, cur.decodable(w) === true);
  }
  check('one is still refused - its spelling lies, and it shows whole',
    cur.decodable('one') === false && SIO.dictionary.chunks('one') === null);
  check('an invented y-name is still shown whole: blorky', cur.decodable('blorky') === false);
  check('entry kinds: letter / word / sentence',
    lib.entryKind('s') === 'letter' && lib.entryKind('Chase') === 'word'
    && lib.entryKind('Sam sat.') === 'sentence' && lib.entryKind('a') === 'letter');
}

// ---- the sight-word list: read whole, never sounded out ---------------------
// The parent's override of decodable(): a word on the list must never be
// decomposed into chunks or phonemes - not in the walk-through (no sound
// pieces queued) and not in the video plan (shown and said whole).
{
  check('the list parses anything a human types',
    JSON.stringify(cur.parseSightWords('Chase, Marshall\n  Skye\n# a note\nNana!'))
    === JSON.stringify(['Chase', 'Marshall', 'Skye', 'Nana']));

  cur.setSightWords([]);
  const soundedOut = cur.oneWord('dog', 3, 1.2);
  check('off the list, a decodable word is sounded out',
    soundedOut.some((s) => (s.parts && s.parts.length > 1) || s.touching));
  const piecesBefore = lib.pieceItems('The dog ran.', new Set());
  check('off the list, its pieces queue in the walk-through',
    piecesBefore.some((p) => (p.say || '').includes('dog')));
  const estBefore = lib.estimateSeconds(['dog'], 3, 1.5);

  cur.setSightWords(cur.parseSightWords('dog'));
  check('membership ignores case and punctuation',
    cur.isSight('Dog') && cur.isSight('dog,') && !cur.isSight('ran'));
  const whole = cur.oneWord('dog', 3, 1.2);
  check('on the list, every segment shows the whole word - no decomposition',
    whole.every((s) => s.parts && s.parts.length === 1 && s.parts[0][0] === 'dog'), whole);
  const piecesAfter = lib.pieceItems('The dog ran.', new Set());
  check('on the list, no piece derived from it queues - other words still do',
    piecesAfter.length > 0 && piecesAfter.every((p) => !(p.say || '').includes('“dog”')),
    piecesAfter.map((p) => p.say));
  check('the estimate prices it as a whole word',
    lib.estimateSeconds(['dog'], 3, 1.5) < estBefore);

  cur.setSightWords([]); // leave the mechanics untouched for the parity replay
}

// ---- curriculum parity with gen/levels.py -----------------------------------
const fixturePath = path.join(APP, 'tools', 'curriculum-fixture.json');
if (!fs.existsSync(fixturePath)) {
  check('curriculum fixture exists (tools/gen-clips.py writes it)', false);
} else {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const clipTuple = (c) => {
    if (c.kind === 'phoneme') return ['phoneme', c.ipa];
    if (c.kind === 'word') return ['word', c.text.toLowerCase(), !!c.slow];
    if (c.kind === 'sentence') return ['sentence', cur.sentenceKey(c.text)];
    return ['?'];
  };
  // Expand the JS builder's output to the Python fixture's shape: the
  // read-along marker becomes one slice row per word.
  const segs = cur.library(fixture.library, fixture.opts);
  const expanded = [];
  for (const seg of segs) {
    if (seg.touching) {
      const parts = seg.touching.parts;
      parts.forEach((pt, j) => {
        expanded.push({
          parts: parts.map(([t], k) => [t, k === j]),
          pad: j === parts.length - 1 ? cur.TOUCH_BREATH : 0,
          scale: seg.scale || 1, color: null, itemEnd: false, clip: ['slice'],
        });
      });
      continue;
    }
    if (!seg.readalong) {
      expanded.push({
        parts: seg.parts.map(([t, h]) => [t, !!h]),
        pad: seg.pad, scale: seg.scale || 1, color: seg.color || null,
        itemEnd: !!seg.itemEnd, clip: clipTuple(seg.clip),
      });
      continue;
    }
    const words = seg.readalong.text.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const parts = [];
      words.forEach((other, j) => {
        if (j) parts.push([' ', false]);
        parts.push([other, j === i]);
      });
      const last = i === words.length - 1;
      expanded.push({
        parts, pad: last ? seg.pad : 0, scale: seg.readalong.scale, color: null,
        itemEnd: last ? !!seg.itemEnd : false, clip: ['slice'],
      });
    });
  }
  const want = fixture.segments;
  let mismatch = null;
  if (expanded.length !== want.length) {
    mismatch = { reason: 'segment count', js: expanded.length, py: want.length };
  } else {
    for (let i = 0; i < expanded.length && !mismatch; i++) {
      const s = expanded[i], w = want[i];
      if (JSON.stringify(s.parts) !== JSON.stringify(w.parts)) mismatch = { i, reason: 'parts', js: s.parts, py: w.parts };
      else if (Math.abs(s.pad - w.pad) > 1e-3) mismatch = { i, reason: 'pad', js: s.pad, py: w.pad };
      else if (Math.abs(s.scale - w.scale) > 1e-9) mismatch = { i, reason: 'scale', js: s.scale, py: w.scale };
      else if ((s.color || null) !== (w.color || null)) mismatch = { i, reason: 'color', js: s.color, py: w.color };
      else if (s.itemEnd !== !!w.itemEnd) mismatch = { i, reason: 'itemEnd', js: s.itemEnd, py: w.itemEnd };
      else if (JSON.stringify(s.clip) !== JSON.stringify(w.clip)) mismatch = { i, reason: 'clip', js: s.clip, py: w.clip };
    }
  }
  check(`library builder: ${want.length} segments match gen/levels.py exactly`, !mismatch, mismatch);
}

// ---- the two-voice policy ---------------------------------------------------
// The bundle is the STARTER VOICE and nothing else: the app author's own
// recordings - every sound, every rime, every pack word and line - shipped so
// a buildup is never two voices and every shipped pack is READY on day one.
{
  const inTable = (table, key) => {
    const t = CLIPS.clips[table];
    if (!t) return false;
    if (t[key] !== undefined) return true;
    return (cur.PHONEME_ALIASES[key] || []).some((a) => t[a] !== undefined);
  };
  // Nothing synthetic: the bundle holds recorded clip tables only, and a clip
  // that neither she nor the starter voice has resolves to MISSING - never to
  // a synthesiser, even when one is sitting right there.
  check('the bundle is recorded clips only (sounds, words, lines)',
    Object.keys(CLIPS.clips).every((t) => ['phonemes', 'words', 'sentences'].includes(t))
    && Object.keys(CLIPS.clips.phonemes).length >= 42, Object.keys(CLIPS.clips));
  later.push(async () => {
    const said = [];
    sandbox.speechSynthesis = sandbox.window.speechSynthesis = { speak: (u) => said.push(u) };
    const vs = new SIO.VoiceSource();
    vs._recIndex = new Set();
    const word = await vs.resolve({ kind: 'word', text: 'zorblequix' });
    const line = await vs.resolve({ kind: 'sentence', text: 'Zorble quix flonk.' });
    const sound = await vs.resolve({ kind: 'phoneme', ipa: 'qqx' });
    check('an unrecorded word, line or sound with no starter clip is missing, never synthesised',
      word === null && line === null && sound === null && vs.used.missing === 3 && vs.used.starter === 0
      && vs.missing.length === 3 && said.length === 0, { used: vs.used, said: said.length });
    delete sandbox.speechSynthesis; delete sandbox.window.speechSynthesis;
  });

  const missing42 = cur.PHONEME_ROWS.filter((p) => !inTable('phonemes', p.ipa)).map((p) => p.key);
  check('every one of the 42 sounds has a starter clip', missing42.length === 0, missing42);

  const rimes = cur.allRimes();
  check('the magic-e rule produces 65 rimes', rimes.length === 65, rimes.length);
  const rimeMiss = rimes.filter(([, ipa]) => !inTable('phonemes', ipa)).map(([sp]) => sp);
  check('every rime sound has a starter clip', rimeMiss.length === 0, rimeMiss);

  // every shipped pack is fully covered: letters, words, lines
  const missing = [];
  for (const p of lib.packDefs()) {
    for (const item of p.items) {
      const kind = lib.entryKind(item);
      if (kind === 'letter') {
        const ipa = cur.CVC_PHONEMES[item.toLowerCase()] || item.toLowerCase();
        if (!inTable('phonemes', ipa)) missing.push('sound:' + item);
        continue;
      }
      for (const w of lib.uniqueWords(item)) {
        if (!inTable('words', w.toLowerCase())) missing.push('word:' + w);
      }
      if (kind === 'sentence' && !inTable('sentences', cur.sentenceKey(item))) missing.push('line:' + item);
    }
  }
  check('every pack letter, word and line is covered by the starter voice',
    missing.length === 0, missing.slice(0, 8));

  // the buildup gate: a word whose sounds cannot all be said is shown
  // WHOLE, never half-built (synthetic gate - the real bundle covers all)
  const yes = cur.oneWord('case', 3, 1.2, () => true);
  const no = cur.oneWord('case', 3, 1.2, () => false);
  check('a fully-voiced word builds up', yes.some((seg) => seg.clip.kind === 'phoneme'));
  check('a word with an unsayable sound is shown whole, never half-built',
    no.every((seg) => seg.clip.kind === 'word'), no.map((seg) => seg.clip.kind));

  // readiness: the starter voice makes pack content ready with NOTHING
  // recorded; a family's own words wait for the family's voice
  const rows = [{ id: 's', text: 's' }, { id: 'sat', text: 'sat' },
    { id: 'sam_sat', text: 'Sam sat.' }, { id: 'nana', text: 'Nana' },
    { id: 'nana_is_here', text: 'Nana is here.' }];
  const cold = lib.statusOf(rows, new Set());
  check('unrecorded: starter-covered entries are ready, family words are not',
    cold[0].ready && cold[1].ready && cold[2].ready && !cold[3].ready && !cold[4].ready,
    cold.map((r) => r.ready));
  const warm = lib.statusOf(rows, new Set(['words/nana', 'words/is', 'words/here', 'sentences/nana_is_here']));
  check('recording a family word and line flips them ready',
    warm[3].ready && warm[4].ready, warm.map((r) => r.ready));
}

// ---- packs ------------------------------------------------------------------
{
  const packs = lib.packDefs();
  check('packs exist in both groups',
    packs.some((p) => p.group === 'favourites') && packs.some((p) => p.group === 'skills'));
  check('no pack is empty', packs.every((p) => p.items.length > 0));
  const letterPack = packs.find((p) => p.id === 'letters');
  check('the letters pack is single letters',
    letterPack.items.every((i) => lib.entryKind(i) === 'letter'));
}

// ---- the sound bank (0.6.1 + 0.7.0) -----------------------------------------
{
  // caps budget PER SOUND: grandma's an=/æn/ carries two sounds and must
  // get twice one sound's time - trimming it to one amputated her /n/
  check('soundsIn counts a chunk\'s sounds', cur.soundsIn('æn') === 2 && cur.soundsIn('s') === 1);
  const segs = cur.approach([['gr', 'ɡɹ'], ['an', 'æn'], ['d', 'd']], 1.5, 2).filter((x) => x.clip);
  const capOf = (ipa) => segs.find((x) => x.clip.ipa === ipa).clip.cap;
  check('approach caps multiply by the chunk\'s sound count',
    Math.abs(capOf('æn') / capOf('d') - 2) < 1e-9, [capOf('æn'), capOf('d')]);

  const cat = SIO.dictionary.catalog();
  check('the chunk catalog is substantial and most-useful-first',
    cat.length > 300 && cat[0].words >= cat[Math.floor(cat.length / 2)].words, cat.length);
  check('every catalog entry carries spelling + example',
    cat.every((c) => c.spelling && c.example));
  const catIpas = new Set(cat.map((c) => c.ipa));
  const rimeMiss = cur.allRimes().filter(([, ipa]) => !catIpas.has(ipa));
  check('rime sounds stay listed in the catalog (recordings never invisible)',
    rimeMiss.length === 0, rimeMiss.slice(0, 5));

  // The recipe for a chunk is its member sounds' own hints, in order.
  const H = SIO.studio.SOUND_HINTS;
  const recipe = SIO.studio.soundRecipe('æn');
  check('the recipe spells a chunk out member by member, in order',
    !!H['æ'] && !!H.n && recipe.indexOf(H['æ']) === 0 && recipe.indexOf(H.n) > H['æ'].length - 1
    && SIO.studio.soundRecipe('n') === H.n, recipe);
  check('…and a sound with no hint is still named, not dropped',
    SIO.studio.soundRecipe('q') !== '' && SIO.studio.soundRecipe('q').includes('q') && !H.q, SIO.studio.soundRecipe('q'));

  // walk-through order: the line FIRST, then words, then chunks, then singles
  const items = lib.walkthroughItems('Grandma is here.', new Set());
  const kinds = items.map((it) => it.kind);
  check('walk-through: line first, then words, then sound pieces',
    kinds[0] === 'sentence' && kinds[1] === 'word'
    && kinds.lastIndexOf('word') < kinds.indexOf('phoneme'), kinds);
  const pieces = items.filter((it) => it.kind === 'phoneme');
  const firstSingle = pieces.findIndex((it) => SIO.dictionary.tokens(it.ipa).length === 1);
  const lastChunk = pieces.map((it) => SIO.dictionary.tokens(it.ipa).length > 1).lastIndexOf(true);
  check('pieces queue chunks before singles',
    pieces.length > 0 && (firstSingle === -1 || lastChunk < firstSingle));
  check('a recorded piece leaves the queue',
    lib.pieceItems('Grandma is here.', new Set(['phonemes/æn'])).every((it) => it.ipa !== 'æn'));
}

// ---- clip conditioning (0.7.1-0.7.4) ----------------------------------------
{
  const dsp = SIO.dsp;
  const sr = 24000;

  // a swelling /iː/: half a second of fade-in, then half a second of voice.
  // content() must find the voice, not report the swell.
  const swell = new Float32Array(sr);
  for (let i = 0; i < sr / 2; i++) swell[i] = 0.02 * Math.sin((2 * Math.PI * 300 * i) / sr);
  for (let i = sr / 2; i < sr; i++) swell[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sr);
  const kept = dsp.contentData(swell, sr);
  check('content() drops a slow swell and keeps the voice (lollipop\'s i)',
    kept.length < swell.length * 0.7 && dsp.peakOf(kept) > 0.3,
    [kept.length, swell.length]);

  // a /d/ recorded as long voiced closure with the burst at the END
  const d = new Float32Array(Math.round(sr * 0.6));
  for (let i = 0; i < d.length; i++) d[i] = 0.05 * Math.sin((2 * Math.PI * 150 * i) / sr);
  for (let i = d.length - Math.round(sr * 0.03); i < d.length; i++) d[i] = 0.7 * Math.sin((2 * Math.PI * 900 * i) / sr);
  check('cap keep=end preserves a trailing burst (the lost /d/)',
    dsp.peakOf(dsp.capData(d, sr, 0.2, 'end')) > 0.6
    && dsp.peakOf(dsp.capData(d, sr, 0.2, 'start')) < 0.1);
  check('hardClip centres a stop\'s window on its located burst',
    dsp.peakOf(dsp.hardClipData(d, sr, 0.2, true)) > 0.6);

  // booster gating: a window with no transient must NOT be amplified
  const flat = new Float32Array(Math.round(sr * 0.3));
  for (let i = 0; i < flat.length; i++) flat[i] = 0.1 * Math.sin((2 * Math.PI * 200 * i) / sr);
  const out = dsp.hardClipData(flat, sr, 0.2, true);
  check('the burst booster only fires on real transients (no manufactured static)',
    Math.abs(dsp.peakOf(out) - 0.1) < 0.02, dsp.peakOf(out));
}

// ---- the ticks are yours (0.7.3) --------------------------------------------
{
  later.push(async () => {
    // the in-memory store stands in for gifos.db (no gifos in this sandbox)
    const pack = lib.packDefs().find((p) => p.id === 'letters');
    const rows = await lib.addPack('letters');
    const stored = await lib.load();
    check('addPack returns the added rows so they can arrive ticked',
      Array.isArray(rows) && rows.length === pack.items.length
      && rows.every((r) => r && r.id && stored.some((s) => s.id === r.id)), rows && rows.length);
    const again = await lib.addPack('letters');
    check('…and adding the same pack twice adds nothing new', Array.isArray(again) && again.length === 0, again);
    for (const r of stored) await lib.remove(r.id);
  });
}

// ---- chunk speakability -----------------------------------------------------
{
  const vs = new SIO.VoiceSource();
  vs._recIndex = new Set(); // nothing recorded: starter voice only
  check('a chunk sound is speakable when its members are: /æn/, /eɪk/',
    vs.phonemeAvailable('æn') && vs.phonemeAvailable('eɪk'));
  check('…and not when a member is missing', vs.phonemeAvailable('qqx') === false);
}

// ---- read-along timing ------------------------------------------------------
{
  const n = 1000;
  const audio = new Float32Array(n);
  for (let i = 100; i < 900; i++) audio[i] = 0.5;
  const spans = lib.wordSpans(audio, ['the', 'dog'], [300, 300]);
  check('wordSpans tiles the audio exactly',
    spans[0][0] === 0 && spans[spans.length - 1][1] === n
    && spans.every((s, i) => i === 0 || s[0] === spans[i - 1][1]), spans);
  check('function words are discounted ("the" gets the smaller slice)',
    (spans[0][1] - spans[0][0]) < (spans[1][1] - spans[1][0]), spans);
  check('no words -> one span', JSON.stringify(lib.wordSpans(audio, [], [])) === JSON.stringify([[0, n]]));
}

// ---- the estimate -----------------------------------------------------------
{
  const short = lib.estimateSeconds(['s'], 3, 1.5);
  const sent = lib.estimateSeconds(['Chase is on the case.'], 3, 1.5);
  check('estimate: a letter costs less than a sentence', short > 0 && sent > short, [short, sent]);
  const slower = lib.estimateSeconds(['Chase is on the case.'], 3, 2.5);
  check('estimate tracks the gap option', slower > sent, [sent, slower]);
}

// ---- the neutral-pad rule ---------------------------------------------------
check('the highlight goes out on long pads (NEUTRAL_PAD ported)',
  SIO.storyboard.NEUTRAL_PAD === 0.35, SIO.storyboard.NEUTRAL_PAD);
check('the approach floor is two hundredths (0.5.4)',
  cur.APPROACH_FLOOR === 0.02, cur.APPROACH_FLOOR);
check('the blend hangs seven tenths before the word answers (0.7.7)',
  cur.TOUCH_BREATH === 0.7, cur.TOUCH_BREATH);
{
  const segs = cur.approach([['s', 's'], ['a', 'æ']], 1.5, 3).filter((x) => x.clip);
  const roundEnds = [segs[1], segs[3]];
  check('a breath between rounds: each pass ends with +0.5s (0.7.6)',
    roundEnds.every((x) => x.pad > 0.5) && segs[0].pad < 0.5,
    segs.map((x) => Math.round(x.pad * 100) / 100));
}
check('the count sets where the journey starts: 0.2 / 0.3 / 0.45',
  Math.abs(cur.approachStart(2) - 0.20) < 1e-9 && Math.abs(cur.approachStart(3) - 0.30) < 1e-9
  && Math.abs(cur.approachStart(4) - 0.45) < 1e-9,
  [cur.approachStart(2), cur.approachStart(3), cur.approachStart(4)]);

// ---- the cap curve (0.5.3: the sounds compress with the gaps) ---------------
{
  const segs = cur.approach([['s', 's'], ['a', 'æ'], ['t', 't']], 1.5, 3);
  const gapSegs = segs.filter((seg) => seg.clip);
  const caps = [...new Set(gapSegs.map((seg) => Math.round(seg.clip.cap * 1000) / 1000))];
  check('the gap passes cap sounds on the shrinking curve, starting at 1.1s',
    caps.length === 2 && Math.abs(caps[0] - 1.1) < 1e-9 && caps[0] > caps[1], caps);
  const last = segs[segs.length - 1];
  check('the final pass is the TOUCHING pass (crossfaded, no silence)',
    !!last.touching && last.touching.parts.length === 3 && gapSegs.length === 6);
  const a1 = new Float32Array(1000).fill(0.5), b1 = new Float32Array(1000).fill(0.5);
  const merged = SIO.dsp.xfadeData(a1, b1, 100);
  const mid = merged[950];
  check('the crossfade is equal-power and gapless',
    merged.length === 1900 && Math.abs(mid - 0.5 * (Math.cos(Math.PI / 4) + Math.sin(Math.PI / 4))) < 0.02,
    [merged.length, mid]);

  const sr = 24000;
  const long = new Float32Array(Math.round(sr * 2.6)).fill(0.4);
  const cut = SIO.dsp.capData(long, sr, 0.5);
  check('capData trims a 2.6s hold to 0.5s and fades the tail to silence',
    cut.length === Math.trunc(sr * 0.5) && Math.abs(cut[cut.length - 1]) < 1e-6
    && Math.abs(cut[0] - 0.4) < 1e-6, [cut.length, cut[cut.length - 1], cut[0]]);
  const short = new Float32Array(Math.round(sr * 0.2)).fill(0.4);
  check('capData leaves a short crisp stop untouched', SIO.dsp.capData(short, sr, 0.5) === short);

  // The blend must LOOK for the sound before deciding what to keep. Round 3
  // of "Ezra" lit r, then a, with nothing audible under either: the sound in
  // those clips started 0.38s in, behind a breath too loud for contentData
  // to strip, and the blend's cap is 0.40s - so the window it kept was the
  // breath. Rounds 1 and 2 cap at 1.10s / 0.74s and reached past it.
  {
    const rms = (x) => Math.sqrt(x.reduce((t, v) => t + v * v, 0) / (x.length || 1));
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const late = new Float32Array(Math.round(sr * 0.83));
    const lead = Math.round(sr * 0.38);
    for (let i = 0; i < lead; i++) late[i] = rnd() * 0.15;                       // a breath
    for (let i = lead; i < late.length; i++) late[i] = 0.9 * Math.sin((2 * Math.PI * 180 * (i - lead)) / sr);
    const blended = SIO.dsp.hardClipData(late, sr, 0.40, false);
    check('a sound that starts late is still heard in the blend (0.40s cap)',
      rms(blended) > 0.5 * (0.9 / Math.SQRT2) && rms(blended) > 5 * (0.15 / Math.sqrt(3)),
      { rms: Math.round(rms(blended) * 1000) / 1000, breath: 0.15 / Math.sqrt(3) });

    // The shape this must NOT touch: an /iː/ that fades in over half a second
    // also starts late, and cutting its swell is how lollipop lost its i.
    const swell = new Float32Array(Math.round(sr * 1.0));
    for (let i = 0; i < swell.length; i++) {
      const ramp = Math.min(1, i / (sr * 0.5));
      swell[i] = ramp * 0.9 * Math.sin((2 * Math.PI * 180 * i) / sr);
    }
    check('a swelling vowel is not slid forward',
      SIO.dsp.ontoTheSound(swell, sr, Math.trunc(sr * 0.40)) === swell);
    const fromZero = new Float32Array(Math.round(sr * 0.9));
    for (let i = 0; i < fromZero.length; i++) fromZero[i] = 0.9 * Math.sin((2 * Math.PI * 180 * i) / sr);
    check('a clip that starts on its sound is left alone',
      SIO.dsp.ontoTheSound(fromZero, sr, Math.trunc(sr * 0.40)) === fromZero);
  }

  // 0.5.2: a real mouth's hold (median 1.22s) must score well now
  const a = new Float32Array(Math.round(sr * 1.6));
  for (let i = 0; i < sr * 1.2; i++) a[Math.round(sr * 0.2) + i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const sc = SIO.dsp.scoreTake(a, sr, { kind: 'phoneme', ipa: 's', length: 'hold' });
  check('a 1.2s hold - what real mouths produce - scores high', !sc.fatal && sc.value > 90, sc.value);
}

// ---- the export clock -------------------------------------------------------
// "Save as a video file" performs the plan in real time, and a save that takes
// as long as the video is a save the tab spends in the BACKGROUND, where
// requestAnimationFrame stops dead. The engine's whole clock used to ride on
// rAF, so a backgrounded save recorded a frozen picture over correct sound and
// never finished at all - the end-of-plan check was on the stalled loop too.
// An externally clocked engine must therefore: never touch rAF, advance purely
// from the audio clock, and reach its end on its own.
{
  const seg = (name) => ({ parts: [[name, true]], pad: 0 });
  const plan = {
    duration: 3.0,
    entries: [
      { seg: seg('a'), buffer: null, duration: 1.0 },
      { seg: seg('b'), buffer: null, duration: 1.0 },
      { seg: seg('c'), buffer: null, duration: 1.0 },
    ],
  };
  let rafCalls = 0;
  const realRaf = sandbox.requestAnimationFrame;
  sandbox.requestAnimationFrame = () => { rafCalls++; return 0; };
  sandbox.cancelAnimationFrame = () => {};
  const ctx = { currentTime: 100 };
  const drawn = [];
  const eng = new SIO.player.Engine(plan, {
    ctx,
    dest: {},
    loop: false,
    external: true,
    draw: (s) => drawn.push(s.parts[0][0]),
    onDone: () => drawn.push('DONE'),
  });
  // repainting the SAME state is free and expected (the exporter leans on it);
  // what matters is the sequence of states the picture actually passes through
  const states = () => drawn.filter((s, i) => s !== drawn[i - 1]).join('');
  eng.start();
  check('an externally clocked engine never asks for an animation frame', rafCalls === 0, rafCalls);
  check('...and paints its opening frame at once', states() === 'a', drawn);
  // nothing advances without the clock, however many times it is ticked
  for (let i = 0; i < 20; i++) eng.tick();
  check('...and does not advance on its own', states() === 'a', drawn);
  ctx.currentTime = 100.15 + 1.05; eng.tick();
  ctx.currentTime = 100.15 + 2.05; eng.tick();
  check('...and follows the audio clock when ticked', states() === 'abc', drawn);
  ctx.currentTime = 100.15 + 3.01; eng.tick();
  check('...and reaches the end of the plan by itself', states() === 'abcDONE', drawn);
  check('...leaving nothing scheduled', eng.stopped === true);
  sandbox.requestAnimationFrame = realRaf;

  // The exporter is the reason the option exists: it must clock from audio,
  // which keeps running in a hidden tab, and repaint through every pad so the
  // video track does not end at the last visual change (it did: a 14 second
  // save held 14 frames and 3.4 fewer seconds of video than audio).
  later.push(async () => {
    const X = exportRig();
    const plan2 = {
      duration: 3.0,
      entries: [
        { seg: seg('a'), buffer: null, duration: 1.0 },
        { seg: seg('b'), buffer: null, duration: 1.0 },
        { seg: seg('c'), buffer: null, duration: 1.0 },
      ],
    };
    let blob = null;
    const done = X.SIO.exporter.exportVideo(plan2, {}).then((b) => { blob = b; });
    // the audio callback is the only clock: 2048-frame blocks at 48 kHz
    const pump = X.pumps[0];
    const block = 2048 / 48000;
    let t = 0;
    while (t < 2.5 + 3.0 + 0.6 && pump && pump.onaudioprocess) {
      t += block;
      X.actx.currentTime = t;
      pump.onaudioprocess({});
    }
    await Promise.race([done, wait(1500)]);
    const states = X.paints.map((p) => p[1]).filter((s, i, a) => s !== a[i - 1]).join('');
    const lastC = X.paints.filter((p) => p[1] === 'c');
    const cSpan = lastC.length ? lastC[lastC.length - 1][0] - lastC[0][0] : 0;
    check('the exporter clocks the engine from an audio callback, never an animation frame',
      !!pump && X.raf() === 0 && states === 'abc' && !!blob && X.recorder.stopped, { raf: X.raf(), states, blob: !!blob });
    check('the exporter repaints on a cadence through every pad, not only on state change',
      lastC.length >= 10 && cSpan >= 0.8 && X.paints.length >= 50, { c: lastC.length, cSpan, all: X.paints.length });
  });
}

// ---- the DSP port -----------------------------------------------------------
{
  const dsp = SIO.dsp;
  const sr = 24000;

  const silence = new Float32Array(sr);
  const sil = dsp.scoreTake(silence, sr, { kind: 'phoneme', ipa: 's', length: 'hold' });
  check('digital silence is fatal, never scored', !!sil.fatal);

  const clean = new Float32Array(Math.round(sr * 2.4));
  for (let i = 0; i < sr * 2; i++) clean[Math.round(sr * 0.2) + i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const good = dsp.scoreTake(clean, sr, { kind: 'phoneme', ipa: 's', length: 'hold' });
  check('a clean held take scores high', !good.fatal && good.value > 80, { fatal: good.fatal, value: good.value });

  const n = Math.round(sr * 0.65);
  const schwa = new Float32Array(n);
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x40000000 - 1; };
  for (let i = 0; i < Math.round(sr * 0.45); i++) schwa[i] = 0.3 * rnd();
  for (let i = Math.round(sr * 0.45); i < n; i++) schwa[i] = 0.35 * Math.sin((2 * Math.PI * 300 * i) / sr);
  check('the schwa detector hears an "uh" after a fricative', dsp.schwaTail(schwa, sr, 's') !== null);
  check('…and stays quiet when there is none', dsp.schwaTail(schwa.slice(0, Math.round(sr * 0.45)), sr, 's') === null);

  const st = dsp.stretch(new Float32Array(sr).fill(0.1), sr, 0.8);
  check('the time-stretch lands within 1% of the asked-for length',
    Math.abs(st.length - sr / 0.8) < sr * 0.01, st.length);
}

// ---- WHAT IS SHARED, AND WHAT IS NOT ---------------------------------------
// The curriculum tests above prove the sight-word list changes what gets
// sounded out. That is exactly why WHERE IT IS STORED is a correctness
// question, and it was wrong: the list lived in `prefs`, which the manifest
// declares private, so it never reached a guest at all. Host and guest then
// rendered the SAME shared sentence differently — one building a word sound by
// sound while the other showed it whole — and the per-row "4 of 4 words
// recorded" counts disagreed between screens.
//
// runtime.js is emphatic that an UNDECLARED collection is private, so a
// collection this app opens but forgets to declare fails silently and exactly
// this way. Hold every collection against the manifest.
{
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  const data = manifest.data || {};
  const vis = (c) => (data[c] || {}).visibility || 'private';
  // TEXT-CHECK: a static scan of every db('…') name, because the run below
  // only opens the collections on the paths it drives; a collection opened on
  // some other path would escape it.
  const src = ['app.js', 'ui.js', 'library.js', 'studio.js', 'voice.js']
    .map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  const named = new Set();
  for (const m of src.matchAll(/\bdb\(\s*'([a-z]+)'\s*\)/g)) named.add(m[1]);
  check('every collection named in the source is declared in the manifest',
    [...named].every((c) => data[c]), [...named].filter((c) => !data[c]));

  later.push(async () => {
    // Boot the real app on a desktop whose PRIVATE prefs still hold an old
    // sight-word list, then save a new list through the Setup control.
    const A = bootApp({ prefs: { prefs: { id: 'prefs', theme: 'day', reps: 3, ticked: [], sightWords: 'dog' } } });
    await wait(300);
    await A.SIO.studio.removeId('words/zorble');   // the studio's own paths
    await A.SIO.studio.doneMap();
    const opened = [...new Set(A.opened)];
    check('every collection the running app opens is declared in the manifest',
      opened.length >= 5 && opened.every((c) => data[c]), { opened, undeclared: opened.filter((c) => !data[c]) });
    const isList = (rec) => rec && typeof rec.words === 'string';
    const migrated = A.writes.filter((w) => isList(w.rec));
    check('an old private list is lifted into one shared record at boot',
      migrated.length === 1 && migrated[0].rec.words === 'dog' && A.SIO.curriculum.isSight('dog'), migrated);

    A.$('sight-input').value = 'cat, Zorp';
    A.$('sight-save').click();
    await wait(300);
    const listWrites = A.writes.filter((w) => isList(w.rec));
    const colls = [...new Set(listWrites.map((w) => w.name))];
    check('the sight-word list is written to exactly one collection',
      colls.length === 1 && listWrites.length === 2 && listWrites[1].rec.words === 'cat\nZorp', listWrites);
    check('…and that collection is SHARED, not private', !!colls[0] && vis(colls[0]) !== 'private', colls[0] + ' = ' + vis(colls[0]));
    check('…and writable by a guest, who may mark a sight word too', vis(colls[0]) === 'read-write', vis(colls[0]));
    check('…and saving it changes what gets sounded out',
      A.SIO.curriculum.isSight('Zorp') && A.SIO.curriculum.isSight('cat') && !A.SIO.curriculum.isSight('dog'));

    // A list saved at the other end reaches this screen's curriculum.
    const rec = listWrites[1].rec;
    await A.gifos.db(colls[0]).put({ id: rec.id, words: 'Nana' });
    await wait(50);
    check('a peer\'s list arrives through the shared collection',
      A.SIO.curriculum.isSight('Nana') && !A.SIO.curriculum.isSight('cat'));

    A.$('tick-all').click();
    await wait(50);
    const prefsWrites = A.writes.filter((w) => w.name === 'prefs');
    check('the prefs record never carries the sight-word list',
      prefsWrites.length >= 2 && prefsWrites.every((w) => !('sightWords' in w.rec)) && !('sightWords' in A.SIO.ui.state.prefs),
      prefsWrites.map((w) => Object.keys(w.rec)));
    check('…and no sight word is ever written into a private collection',
      A.writes.filter((w) => vis(w.name) === 'private').every((w) => !/Zorp|Nana/.test(JSON.stringify(w.rec))));
  });

  // The counterweight: prefs must STAY private. theme/reps/ticked are one
  // person's screen, and sharing them would yank a guest's theme around.
  check('prefs stays private', vis('prefs') === 'private');
  check('the sound bank stays shared', vis('recordings') !== 'private' && vis('recmeta') !== 'private');
}

// ---- rigs for the run-the-app checks ---------------------------------------
// ---- minidom: a small in-memory DOM, enough to run the app's own code -----
// (parse HTML, selectors, events, text walker, Range, a CSS cascade)
function makeMiniDom(opts) {
  opts = opts || {};
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const RAW = new Set(['script', 'style', 'textarea', 'title']);
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[e.toLowerCase()] || m;
  });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let doc = null;

  class Node {
    constructor(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; this._l = {}; }
    get ownerDocument() { return doc; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
    get previousSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] || null; }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get firstElementChild() { return this.children[0] || null; }
    get childElementCount() { return this.children.length; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc; }
    _adopt(n) {
      if (n.nodeType === 11) { const kids = n.childNodes.slice(); kids.forEach((k) => { k.parentNode = null; }); n.childNodes = []; return kids; }
      if (n.parentNode) n.parentNode.removeChild(n);
      return [n];
    }
    appendChild(n) { for (const k of this._adopt(n)) { k.parentNode = this; this.childNodes.push(k); } return n; }
    insertBefore(n, ref) {
      if (!ref) return this.appendChild(n);
      const kids = this._adopt(n);
      const i = this.childNodes.indexOf(ref);
      kids.forEach((k) => { k.parentNode = this; });
      this.childNodes.splice(i, 0, ...kids);
      return n;
    }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i < 0) throw new Error('NotFoundError'); this.childNodes.splice(i, 1); n.parentNode = null; return n; }
    replaceChild(n, old) { this.insertBefore(n, old); this.removeChild(old); return old; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    append(...ns) { ns.forEach((n) => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
    prepend(...ns) { const f = this.firstChild; ns.forEach((n) => this.insertBefore(typeof n === 'string' ? new Text(n) : n, f)); }
    replaceChildren(...ns) { this.childNodes.slice().forEach((c) => this.removeChild(c)); this.append(...ns); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    hasChildNodes() { return this.childNodes.length > 0; }
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 8 ? '' : c.textContent)).join(''); }
    set textContent(v) { this.childNodes.slice().forEach((c) => this.removeChild(c)); if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
    removeEventListener(t, fn) { if (this._l[t]) this._l[t] = this._l[t].filter((f) => f !== fn); }
    dispatchEvent(ev) {
      if (!ev.target) ev.target = this;
      const path = []; let n = this; while (n) { path.push(n); n = n.parentNode || (n === doc ? opts.window || null : null); }
      for (const node of path) {
        ev.currentTarget = node;
        for (const fn of ((node._l || {})[ev.type] || []).slice()) fn.call(node, ev);
        const on = node['on' + ev.type]; if (typeof on === 'function') on.call(node, ev);
        if (!ev.bubbles || ev._stop) break;
      }
      return !ev.defaultPrevented;
    }
    querySelectorAll(sel) { const out = []; const groups = parseSel(sel); walkEls(this, (e) => { if (groups.some((g) => matchChain(e, g))) out.push(e); }); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementById(id) { let hit = null; walkEls(this, (e) => { if (!hit && e.getAttribute('id') === id) hit = e; }); return hit; }
  }
  class Text extends Node {
    constructor(d) { super(3); this.data = String(d); }
    get nodeName() { return '#text'; }
    get nodeValue() { return this.data; } set nodeValue(v) { this.data = String(v); }
    get textContent() { return this.data; } set textContent(v) { this.data = String(v); }
    get length() { return this.data.length; }
    splitText(off) { const t = new Text(this.data.slice(off)); this.data = this.data.slice(0, off); if (this.parentNode) this.parentNode.insertBefore(t, this.nextSibling); return t; }
    cloneNode() { return new Text(this.data); }
    get outerHTML() { return esc(this.data); }
  }
  class Comment extends Node { constructor(d) { super(8); this.data = d; } cloneNode() { return new Comment(this.data); } get outerHTML() { return '<!--' + this.data + '-->'; } }
  class Fragment extends Node { constructor() { super(11); } cloneNode(deep) { const f = new Fragment(); if (deep) this.childNodes.forEach((c) => f.appendChild(c.cloneNode(true))); return f; } }
  class ClassList {
    constructor(el) { this.el = el; }
    _get() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    _set(a) { this.el.setAttribute('class', a.join(' ')); }
    contains(c) { return this._get().includes(c); }
    add(...cs) { const a = this._get(); cs.forEach((c) => { if (!a.includes(c)) a.push(c); }); this._set(a); }
    remove(...cs) { this._set(this._get().filter((c) => !cs.includes(c))); }
    toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want && !has) this.add(c); if (!want && has) this.remove(c); return want; }
    get length() { return this._get().length; }
    item(i) { return this._get()[i]; }
    forEach(fn) { this._get().forEach(fn); }
    toString() { return this._get().join(' '); }
  }
  class Element extends Node {
    constructor(tag, ns) {
      super(1); this.localName = String(tag).toLowerCase(); this.namespaceURI = ns || null; this.attrs = new Map();
      this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
      this.classList = new ClassList(this); this._value = null; this.scrollTop = 0; this.scrollLeft = 0;
      const self = this;
      this.dataset = new Proxy({}, {
        get(t, k) { if (typeof k !== 'string') return undefined; const v = self.getAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())); return v == null ? undefined : v; },
        set(t, k, v) { self.setAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v); return true; },
        deleteProperty(t, k) { self.removeAttribute('data-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())); return true; },
        has(t, k) { return self.hasAttribute('data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())); },
      });
    }
    get tagName() { return this.localName.toUpperCase(); }
    get nodeName() { return this.tagName; }
    getAttribute(k) { k = String(k).toLowerCase(); return this.attrs.has(k) ? this.attrs.get(k) : null; }
    setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
    hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
    removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }
    toggleAttribute(k, f) { const want = f === undefined ? !this.hasAttribute(k) : !!f; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
    get hidden() { return this.hasAttribute('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
    get disabled() { return this.hasAttribute('disabled'); } set disabled(v) { this.toggleAttribute('disabled', !!v); }
    get checked() { return this._checked != null ? this._checked : this.hasAttribute('checked'); } set checked(v) { this._checked = !!v; }
    get title() { return this.getAttribute('title') || ''; } set title(v) { this.setAttribute('title', v); }
    get type() { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : this.localName === 'input' ? 'text' : ''); } set type(v) { this.setAttribute('type', v); }
    get href() { return this.getAttribute('href') || ''; } set href(v) { this.setAttribute('href', v); }
    get src() { return this.getAttribute('src') || ''; } set src(v) { this.setAttribute('src', v); }
    get name() { return this.getAttribute('name') || ''; } set name(v) { this.setAttribute('name', v); }
    get placeholder() { return this.getAttribute('placeholder') || ''; } set placeholder(v) { this.setAttribute('placeholder', v); }
    get value() {
      if (this._value != null) return this._value;
      if (this.localName === 'textarea') return this.textContent;
      if (this.localName === 'select') { const o = this.querySelector('option[selected]') || this.querySelector('option'); return o ? o.value : ''; }
      if (this.localName === 'option') return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent;
      return this.getAttribute('value') || '';
    }
    set value(v) { this._value = String(v); }
    get innerHTML() { return this.childNodes.map(ser).join(''); }
    set innerHTML(h) { this.childNodes.slice().forEach((c) => this.removeChild(c)); parseInto(this, String(h)); }
    get outerHTML() { return ser(this); }
    insertAdjacentHTML(pos, h) {
      const f = new Fragment(); parseInto(f, h);
      if (pos === 'beforeend') this.appendChild(f); else if (pos === 'afterbegin') this.insertBefore(f, this.firstChild);
      else if (pos === 'beforebegin') this.parentNode.insertBefore(f, this); else this.parentNode.insertBefore(f, this.nextSibling);
    }
    matches(sel) { return parseSel(sel).some((g) => matchChain(this, g)); }
    closest(sel) { let n = this; const g = parseSel(sel); while (n && n.nodeType === 1) { if (g.some((x) => matchChain(n, x))) return n; n = n.parentNode; } return null; }
    cloneNode(deep) { const e = new Element(this.localName, this.namespaceURI); this.attrs.forEach((v, k) => e.attrs.set(k, v)); if (deep) this.childNodes.forEach((c) => e.appendChild(c.cloneNode(true))); return e; }
    click() { if (this.disabled) return; this.dispatchEvent(new Event('click', { bubbles: true })); }
    focus() { doc.activeElement = this; } blur() {} select() {} scrollIntoView() {} setPointerCapture() {} releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 }; }
    get offsetWidth() { return 0; } get offsetHeight() { return 0; }
    get clientWidth() { return this._cw || 640; } set clientWidth(v) { this._cw = v; }
    get clientHeight() { return this._ch || 400; } set clientHeight(v) { this._ch = v; }
    getContext() { return null; }
  }
  function ser(n) {
    if (n.nodeType === 3) return esc(n.data);
    if (n.nodeType === 8) return '<!--' + n.data + '-->';
    if (n.nodeType === 11) return n.childNodes.map(ser).join('');
    const a = [...n.attrs].map(([k, v]) => ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"').join('');
    if (VOID.has(n.localName)) return '<' + n.localName + a + '>';
    return '<' + n.localName + a + '>' + n.childNodes.map(ser).join('') + '</' + n.localName + '>';
  }
  function parseInto(rootNode, html) {
    const re = /<!--([\s\S]*?)-->|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/gi;
    let cur = rootNode, m;
    const ns = (tag, parent) => (tag === 'svg' ? 'http://www.w3.org/2000/svg' : (parent && parent.namespaceURI) || null);
    while ((m = re.exec(html))) {
      if (m[1] !== undefined) { cur.appendChild(new Comment(m[1])); continue; }
      if (m[2]) {
        const tag = m[2].toLowerCase(); let n = cur;
        while (n && n !== rootNode && n.localName !== tag) n = n.parentNode;
        if (n && n !== rootNode) cur = n.parentNode;
        continue;
      }
      if (m[3]) {
        const tag = m[3].toLowerCase();
        const e = new Element(tag, ns(tag, cur.nodeType === 1 ? cur : null));
        const ar = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
        while ((a = ar.exec(m[4] || ''))) e.setAttribute(a[1], decode(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : ''));
        cur.appendChild(e);
        if (RAW.has(tag) && !m[5]) {
          const close = html.toLowerCase().indexOf('</' + tag, re.lastIndex);
          const body = html.slice(re.lastIndex, close < 0 ? html.length : close);
          if (body) e.appendChild(new Text(tag === 'textarea' || tag === 'title' ? decode(body) : body));
          re.lastIndex = close < 0 ? html.length : html.indexOf('>', close) + 1;
          continue;
        }
        if (!m[5] && !VOID.has(tag)) cur = e;
        continue;
      }
      if (m[6]) cur.appendChild(new Text(decode(m[6])));
    }
  }
  // ---- selectors ----
  function parseSel(sel) {
    return String(sel).split(/,(?![^\[(]*[\])])/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const parts = []; let comb = ' '; const re = /\s*([>+~])\s*|\s+|((?:[a-zA-Z*][\w-]*)?(?:#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?)*)/g; let m;
      while (re.lastIndex < s.length && (m = re.exec(s))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        if (m[1]) { comb = m[1]; continue; }
        if (!m[2]) { comb = ' '; continue; }
        parts.push({ comb, simple: parseCompound(m[2]) }); comb = ' ';
      }
      return parts;
    });
  }
  function parseCompound(s) {
    const out = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] }; const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]|:([\w-]+)(?:\(([^)]*)\))?/g; let m;
    while ((m = re.exec(s)) && m[0]) {
      if (m[1]) out.tag = m[1].toLowerCase(); else if (m[2]) out.ids.push(m[2]); else if (m[3]) out.classes.push(m[3]);
      else if (m[4]) out.attrs.push({ k: m[4], op: m[5], v: m[6] != null ? m[6] : m[7] != null ? m[7] : m[8] });
      else if (m[9]) out.pseudos.push({ name: m[9], arg: m[10] });
    }
    return out;
  }
  function matchSimple(e, c) {
    if (!e || e.nodeType !== 1) return false;
    if (c.tag && c.tag !== '*' && e.localName !== c.tag) return false;
    for (const id of c.ids) if (e.getAttribute('id') !== id) return false;
    for (const k of c.classes) if (!e.classList.contains(k)) return false;
    for (const a of c.attrs) {
      const v = e.getAttribute(a.k); if (v == null) return false;
      if (a.op === '=' && v !== a.v) return false;
      if (a.op === '~=' && !v.split(/\s+/).includes(a.v)) return false;
      if (a.op === '^=' && !v.startsWith(a.v)) return false;
      if (a.op === '$=' && !v.endsWith(a.v)) return false;
      if (a.op === '*=' && !v.includes(a.v)) return false;
    }
    for (const p of c.pseudos) {
      const sibs = e.parentNode ? e.parentNode.children : [e];
      if (p.name === 'not') { if (parseSel(p.arg).some((g) => matchChain(e, g))) return false; }
      else if (p.name === 'first-child') { if (sibs[0] !== e) return false; }
      else if (p.name === 'last-child') { if (sibs[sibs.length - 1] !== e) return false; }
      else if (p.name === 'first-of-type') { if (sibs.filter((x) => x.localName === e.localName)[0] !== e) return false; }
      else if (p.name === 'checked') { if (!e.checked) return false; }
      else if (p.name === 'disabled') { if (!e.disabled) return false; }
      else if (p.name === 'scope') { /* treat as the element itself */ }
      else return false; // :hover, :focus, ::before … never match a still page
    }
    return true;
  }
  function matchChain(e, parts, i) {
    if (i === undefined) i = parts.length - 1;
    if (!matchSimple(e, parts[i].simple)) return false;
    if (i === 0) return true;
    const comb = parts[i].comb;
    if (comb === '>') return matchChain(e.parentNode, parts, i - 1);
    if (comb === '+') return matchChain(e.previousSibling && prevEl(e), parts, i - 1);
    if (comb === '~') { let s = prevEl(e); while (s) { if (matchChain(s, parts, i - 1)) return true; s = prevEl(s); } return false; }
    let a = e.parentNode; while (a && a.nodeType === 1) { if (matchChain(a, parts, i - 1)) return true; a = a.parentNode; } return false;
  }
  function prevEl(e) { let s = e.previousSibling; while (s && s.nodeType !== 1) s = s.previousSibling; return s; }
  function walkEls(rootNode, fn) { for (const c of rootNode.childNodes) { if (c.nodeType === 1) { fn(c); walkEls(c, fn); } else if (c.nodeType === 11) walkEls(c, fn); } }
  // ---- ranges ----
  const index = (n) => n.parentNode.childNodes.indexOf(n);
  const nodeLen = (n) => (n.nodeType === 3 || n.nodeType === 8 ? n.data.length : n.childNodes.length);
  function pathOf(n) { const p = []; while (n.parentNode) { p.unshift(index(n)); n = n.parentNode; } return p; }
  function isAnc(a, b) { return a.contains(b); }
  function cmpBP(nA, oA, nB, oB) {
    if (nA === nB) return Math.sign(oA - oB);
    const pa = pathOf(nA), pb = pathOf(nB);
    let after = false; for (let i = 0; i < Math.min(pa.length, pb.length); i++) { if (pa[i] !== pb[i]) { after = pa[i] > pb[i]; break; } if (i === Math.min(pa.length, pb.length) - 1) after = pa.length > pb.length; }
    if (after) return -cmpBP(nB, oB, nA, oA);
    if (isAnc(nA, nB)) { let c = nB; while (c.parentNode !== nA) c = c.parentNode; return index(c) < oA ? 1 : -1; }
    return -1;
  }
  class Range {
    constructor() { this.startContainer = doc; this.startOffset = 0; this.endContainer = doc; this.endOffset = 0; }
    setStart(n, o) { this.startContainer = n; this.startOffset = o; if (cmpBP(n, o, this.endContainer, this.endOffset) > 0 || this.endContainer === doc) this.setEnd(n, o); }
    setEnd(n, o) { this.endContainer = n; this.endOffset = o; }
    setStartBefore(n) { this.setStart(n.parentNode, index(n)); } setStartAfter(n) { this.setStart(n.parentNode, index(n) + 1); }
    setEndBefore(n) { this.setEnd(n.parentNode, index(n)); } setEndAfter(n) { this.setEnd(n.parentNode, index(n) + 1); }
    selectNodeContents(n) { this.startContainer = n; this.startOffset = 0; this.endContainer = n; this.endOffset = nodeLen(n); }
    selectNode(n) { this.setStart(n.parentNode, index(n)); this.setEnd(n.parentNode, index(n) + 1); }
    collapse(toStart) { if (toStart) this.setEnd(this.startContainer, this.startOffset); else { this.startContainer = this.endContainer; this.startOffset = this.endOffset; } }
    get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; }
    get commonAncestorContainer() { let a = this.startContainer; while (!isAnc(a, this.endContainer)) a = a.parentNode; return a; }
    cloneRange() { const r = new Range(); r.startContainer = this.startContainer; r.startOffset = this.startOffset; r.endContainer = this.endContainer; r.endOffset = this.endOffset; return r; }
    intersectsNode(n) { const p = n.parentNode; if (!p) return true; const i = index(n); return cmpBP(p, i, this.endContainer, this.endOffset) < 0 && cmpBP(p, i + 1, this.startContainer, this.startOffset) > 0; }
    compareBoundaryPoints(how, r) {
      const pick = [[this.startContainer, this.startOffset, r.startContainer, r.startOffset], [this.endContainer, this.endOffset, r.startContainer, r.startOffset], [this.endContainer, this.endOffset, r.endContainer, r.endOffset], [this.startContainer, this.startOffset, r.endContainer, r.endOffset]][how];
      return cmpBP(pick[0], pick[1], pick[2], pick[3]);
    }
    toString() {
      let s = ''; const sc = this.startContainer, ec = this.endContainer;
      if (sc === ec && sc.nodeType === 3) return sc.data.slice(this.startOffset, this.endOffset);
      const texts = []; (function w(n) { if (n.nodeType === 3) texts.push(n); n.childNodes.forEach(w); })(this.commonAncestorContainer);
      for (const t of texts) {
        if (cmpBP(t, t.data.length, sc, this.startOffset) <= 0) continue; if (cmpBP(t, 0, ec, this.endOffset) >= 0) continue;
        const a = t === sc ? this.startOffset : 0, b = t === ec ? this.endOffset : t.data.length; s += t.data.slice(a, b);
      }
      return s;
    }
    getBoundingClientRect() { return { left: 10, top: 100, right: 110, bottom: 120, width: 100, height: 20 }; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    extractContents() {
      const f = extract(this.startContainer, this.startOffset, this.endContainer, this.endOffset, this);
      return f;
    }
    deleteContents() { this.extractContents(); }
    insertNode(n) {
      const sc = this.startContainer, so = this.startOffset;
      if (sc.nodeType === 3) { const rest = sc.splitText(so); sc.parentNode.insertBefore(n, rest); }
      else sc.insertBefore(n, sc.childNodes[so] || null);
    }
    surroundContents(n) { const f = this.extractContents(); n.appendChild(f); this.insertNode(n); }
  }
  Range.START_TO_START = 0; Range.START_TO_END = 1; Range.END_TO_END = 2; Range.END_TO_START = 3;
  function extract(sc, so, ec, eo, range) {
    const frag = new Fragment();
    if (sc === ec && (sc.nodeType === 3 || sc.nodeType === 8)) {
      frag.appendChild(new Text(sc.data.slice(so, eo))); sc.data = sc.data.slice(0, so) + sc.data.slice(eo);
      if (range) { range.endContainer = sc; range.endOffset = so; }
      return frag;
    }
    let ca = sc; while (!isAnc(ca, ec)) ca = ca.parentNode;
    const childOf = (n) => { while (n.parentNode !== ca) n = n.parentNode; return n; };
    const firstPartial = isAnc(sc, ec) ? null : childOf(sc);
    const lastPartial = isAnc(ec, sc) ? null : childOf(ec);
    const startIdx = firstPartial ? index(firstPartial) + 1 : so;
    const endIdx = lastPartial ? index(lastPartial) : eo;
    let newN, newO;
    if (isAnc(sc, ec)) { newN = sc; newO = so; } else { let r = sc; while (!isAnc(r.parentNode, ec)) r = r.parentNode; newN = r.parentNode; newO = index(r) + 1; }
    const contained = ca.childNodes.slice(startIdx, Math.max(startIdx, endIdx));
    if (firstPartial) {
      if (firstPartial.nodeType === 3) { frag.appendChild(new Text(sc.data.slice(so))); sc.data = sc.data.slice(0, so); }
      else { const cl = firstPartial.cloneNode(false); cl.appendChild(extract(sc, so, firstPartial, nodeLen(firstPartial))); frag.appendChild(cl); }
    }
    contained.forEach((c) => frag.appendChild(c));
    if (lastPartial) {
      if (lastPartial.nodeType === 3) { frag.appendChild(new Text(ec.data.slice(0, eo))); ec.data = ec.data.slice(eo); }
      else { const cl = lastPartial.cloneNode(false); cl.appendChild(extract(lastPartial, 0, ec, eo)); frag.appendChild(cl); }
    }
    if (range) { range.startContainer = range.endContainer = newN; range.startOffset = range.endOffset = newO; }
    return frag;
  }
  // ---- events ----
  class Event {
    constructor(type, o) { o = o || {}; this.type = type; this.bubbles = !!o.bubbles; this.defaultPrevented = false; this.target = null; Object.keys(o).forEach((k) => { if (!(k in this)) this[k] = o[k]; }); }
    preventDefault() { this.defaultPrevented = true; } stopPropagation() { this._stop = true; } stopImmediatePropagation() { this._stop = true; }
  }
  // ---- document & window ----
  doc = new Node(9);
  Object.assign(doc, {
    readyState: 'complete', activeElement: null, title: '', fonts: { add() {} },
    createElement: (t) => new Element(t), createElementNS: (ns, t) => new Element(t, ns),
    createTextNode: (d) => new Text(d), createComment: (d) => new Comment(d), createDocumentFragment: () => new Fragment(),
    createRange: () => new Range(), execCommand: () => true,
    createTreeWalker(rootNode, what) {
      const list = []; (function w(n) { for (const c of n.childNodes) { if (c.nodeType === 3 && (what & 4)) list.push(c); else if (c.nodeType === 1 && (what & 1)) list.push(c); if (c.nodeType === 1 || c.nodeType === 11) w(c); } })(rootNode);
      let i = -1; return { root: rootNode, get currentNode() { return list[i] || rootNode; }, nextNode() { i++; return list[i] || null; } };
    },
  });
  Object.defineProperty(doc, 'documentElement', { get() { return doc.children[0] || null; } });
  Object.defineProperty(doc, 'body', { get() { return doc.querySelector('body'); } });
  Object.defineProperty(doc, 'head', { get() { return doc.querySelector('head'); } });
  doc.nodeName = '#document';
  const html = opts.html || '<!doctype html><html><head></head><body></body></html>';
  parseInto(doc, html);
  if (!doc.querySelector('html')) { const h = new Element('html'); h.appendChild(new Element('head')); h.appendChild(new Element('body')); doc.appendChild(h); }
  if (!doc.querySelector('body')) doc.querySelector('html').appendChild(new Element('body'));
  // ---- css cascade (enough to ask "is this shown / what colour") ----
  function parseCss(css, width) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = []; let order = 0;
    (function block(src) {
      let i = 0;
      while (i < src.length) {
        const open = src.indexOf('{', i); if (open < 0) break;
        const head = src.slice(i, open).trim();
        let depth = 1, j = open + 1; while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
        const body = src.slice(open + 1, j - 1);
        if (head.startsWith('@media')) {
          const q = head.slice(6); let ok = true;
          q.replace(/\((max|min)-width:\s*(\d+)px\)/g, (m, mm, px) => { if (mm === 'max' ? width > +px : width < +px) ok = false; });
          if (/prefers-|print/.test(q)) ok = false;
          if (ok) block(body);
        } else if (!head.startsWith('@')) {
          const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
            const k = d.indexOf(':'); let v = d.slice(k + 1).trim(); const imp = /!important\s*$/.test(v); v = v.replace(/!important\s*$/, '').trim();
            return { prop: d.slice(0, k).trim().toLowerCase(), value: v, important: imp };
          });
          for (const s of head.split(/,(?![^\[(]*[\])])/)) {
            const sel = s.trim(); if (!sel) continue;
            const g = parseSel(sel)[0]; if (!g) continue;
            let a = 0, b = 0, c = 0; for (const p of g) { a += p.simple.ids.length; b += p.simple.classes.length + p.simple.attrs.length + p.simple.pseudos.length; if (p.simple.tag && p.simple.tag !== '*') c++; }
            rules.push({ sel, chain: g, spec: a * 10000 + b * 100 + c, decls, order: order++ });
          }
        }
        i = j;
      }
    })(css);
    return rules;
  }
  function styleOf(rules, e, prop) {
    let best = null;
    for (const r of rules) {
      if (!matchChain(e, r.chain)) continue;
      for (const d of r.decls) {
        if (d.prop !== prop) continue;
        const key = [d.important ? 1 : 0, r.spec, r.order];
        if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = { key, value: d.value };
      }
    }
    return best ? best.value : null;
  }
  // shown(): not [hidden] (the UA rule), and no ancestor computed display:none
  function shown(rules, e) {
    for (let n = e; n && n.nodeType === 1; n = n.parentNode) {
      const d = styleOf(rules, n, 'display');
      if (d === 'none') return false;
      if (d == null && n.hidden) return false;
    }
    return true;
  }
  return { document: doc, Node, Element, Text, Fragment, Range, Event, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, parseCss, styleOf, shown, parseInto };
}

// The whole app, as index.html loads it, over a fake gifos.db.
function bootApp(seed) {
  const dom = makeMiniDom({ html: fs.readFileSync(path.join(APP, 'index.html'), 'utf8') });
  const opened = [], writes = [], cols = {}, subs = {};
  const gifos = {
    db(name) {
      opened.push(name);
      const rows = cols[name] = cols[name] || new Map(Object.entries((seed || {})[name] || {}));
      return {
        put: async (r) => { writes.push({ name, rec: JSON.parse(JSON.stringify(r)) }); rows.set(r.id, r); (subs[name] || []).forEach((f) => f([...rows.values()])); return r; },
        get: async (id) => (rows.has(id) ? JSON.parse(JSON.stringify(rows.get(id))) : null),
        getAll: async () => [...rows.values()],
        delete: async (id) => { rows.delete(id); },
        subscribe: (f) => { (subs[name] = subs[name] || []).push(f); f([...rows.values()]); },
      };
    },
    info: async () => ({ owner: true }), me: async () => ({ id: 'u1', name: 'Tester' }), onBack() {},
  };
  const g = {
    console, atob, btoa, document: dom.document, gifos, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, navigator: {}, Event: dom.Event, addEventListener() {},
  };
  g.window = g; g.globalThis = g;
  vm.createContext(g);
  for (const f of ['fonts-data.js', 'clips-data.js', 'dictionary-data.js', 'dictionary.js', 'curriculum.js', 'library.js', 'dsp.js', 'store.js', 'voice.js', 'storyboard.js', 'frames.js', 'player.js', 'exporter.js', 'studio.js', 'ui.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), g, { filename: f });
  }
  return { g, SIO: g.SIO, gifos, opened, writes, $: (id) => dom.document.getElementById(id) };
}

// exporter.js with a fake recorder, canvas and audio graph. The fakes record
// what the exporter asks for; the engine and the exporter are the shipped ones.
function exportRig() {
  let rafCalls = 0;
  const pumps = [], paints = [];
  const actx = {
    currentTime: 0, state: 'running', resume() {},
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [] } }),
    createScriptProcessor: () => { const p = { connect() {}, disconnect() {}, onaudioprocess: null }; pumps.push(p); return p; },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
  };
  const recorder = { stopped: false };
  class MediaRecorder {
    constructor() { this.mimeType = 'video/webm'; }
    start() {}
    stop() { recorder.stopped = true; if (this.onstop) this.onstop(); }
    static isTypeSupported() { return true; }
  }
  const g = {
    console, atob, btoa, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => { rafCalls++; return 0; }, cancelAnimationFrame() {},
    MediaRecorder, Blob: function (chunks, o) { this.type = o && o.type; },
    document: { createElement: () => ({ getContext: () => ({}), captureStream: () => ({ addTrack() {} }) }) },
  };
  g.window = g; g.globalThis = g;
  vm.createContext(g);
  for (const f of ['fonts-data.js', 'clips-data.js', 'dictionary-data.js', 'dictionary.js', 'curriculum.js', 'library.js', 'dsp.js', 'storyboard.js', 'frames.js', 'player.js', 'exporter.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), g, { filename: f });
  }
  g.SIO.dsp.audioContext = () => actx;
  g.SIO.player.masterChain = () => ({});
  g.SIO.frames.drawFrame = (ctx, seg) => paints.push([actx.currentTime, seg.parts[0][0]]);
  return { SIO: g.SIO, actx, pumps, paints, recorder, raf: () => rafCalls };
}

(async () => {
  for (const f of later) await f();
  console.log(failures ? `${failures} FAILURES` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
