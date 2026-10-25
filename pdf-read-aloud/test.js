// Read Aloud: sentences, headers, lookahead, resume, missing voice,
// pasted text, the English asset pin, and the vendored engine hash.
// The checks run the app's own functions on invented fixtures.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const APP = __dirname;
let failures = 0;

function check(name, cond, extra) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (!ok && extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  if (!ok) failures++;
}

function load() {
  const sandbox = {
    console: console,
    Math: Math,
    Object: Object,
    Array: Array,
    JSON: JSON,
    Date: Date,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    RegExp: RegExp,
    Promise: Promise,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    isFinite: isFinite,
    parseInt: parseInt,
    __synth: 0
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.speechSynthesis = {
    speak: function () { sandbox.__synth++; }
  };
  vm.createContext(sandbox);
  for (const f of ['text.js', 'speak.js', 'store.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

function item(str, x, y, h) {
  h = h || 12;
  return {
    str: str,
    width: Math.max(8, String(str).length * h * 0.5),
    height: h,
    transform: [h, 0, 0, h, x, y]
  };
}

function page(n, items) {
  return { page: n, width: 612, height: 792, items: items };
}

function texts(pages) {
  return S.PdfRead.pagesToSentences(pages).map((s) => s.text);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function micro() {
  return Promise.resolve().then(() => {}).then(() => {}).then(() => {});
}

const S = load();
check('text, speak, and store load', !!(S.PdfRead && S.PdfSpeak && S.PdfStore));

{
  const got = S.PdfRead.plainToSentences('The paper glides. It stays up.').map((s) => s.text);
  check('pasted text splits into sentences', got.length === 2 && got[0] === 'The paper glides.' && got[1] === 'It stays up.', got);
}
{
  const got = S.PdfRead.plainToSentences('Mr. Smith folded it.\nHe smiled.').map((s) => s.text);
  check('pasted text keeps Mr. and splits on a new line', got.length === 2 && got[0] === 'Mr. Smith folded it.' && got[1] === 'He smiled.', got);
}
{
  const words = [];
  for (let i = 0; i < 80; i++) words.push('alpha' + i);
  const got = S.PdfRead.plainToSentences(words.join(' ') + '.').map((s) => s.text);
  check('a long pasted sentence is cut into bites', got.length > 1 && got.every((s) => s.length <= S.PdfRead.MAX_BITE), got.map((s) => s.length));
}

{
  const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  const pins = JSON.parse(fs.readFileSync(path.join(APP, 'LANG-PINS.json'), 'utf8'));
  const lang = pins.langs.find((l) => l.asset === 'eng.traineddata');
  const asset = (manifest.assets || []).find((a) => a.path === 'eng.traineddata');
  check('the manifest name is Read Aloud', manifest.name === 'Read Aloud' && manifest.shortName === 'Read Aloud' && manifest.appId === 'pdf-read-aloud');
  check('the English asset pin is present', !!(asset && lang && asset.optional === true && asset.sha256 === lang.sha256 && asset.bytes === lang.bytes && asset.url === lang.url), asset && asset.sha256);
  const wasmPath = path.join(APP, 'vendor', 'tesseract-core-simd-lstm.wasm');
  const wasm = fs.readFileSync(wasmPath);
  const sha = crypto.createHash('sha256').update(wasm).digest('hex');
  const wasmPin = pins.core.files['tesseract-core-simd-lstm.wasm'];
  check('the vendored wasm hash matches the pin', sha === wasmPin.sha256 && wasm.length === wasmPin.bytes, sha);
}

{
  const got = texts([page(1, [
    item('The paper glides. It stays up.', 72, 600)
  ])]);
  check('a period splits two sentences', got.length === 2 && got[0] === 'The paper glides.' && got[1] === 'It stays up.', got);
}

{
  const got = texts([page(1, [
    item('Mr. Smith folded it. He smiled.', 72, 600)
  ])]);
  check('Mr. stays inside the sentence', got.length === 2 && got[0] === 'Mr. Smith folded it.' && got[1] === 'He smiled.', got);
}

{
  const got = texts([page(1, [
    item('U.S. policy holds. Done.', 72, 600)
  ])]);
  check('U.S. stays inside the sentence', got[0] === 'U.S. policy holds.' && got[1] === 'Done.', got);
}

{
  const got = texts([page(1, [
    item('Pi is 3.14 today. Yes.', 72, 600)
  ])]);
  check('a decimal is not a sentence break', got[0] === 'Pi is 3.14 today.' && got[1] === 'Yes.', got);
}

{
  const got = texts([page(1, [
    item('Hello', 72, 600),
    item('there.', 160, 600)
  ])]);
  check('items on one line join with a space', got.length === 1 && got[0] === 'Hello there.', got);
}

{
  const got = texts([page(1, [
    item('Hello ', 72, 600),
    item('there.', 160, 600)
  ])]);
  check('a trailing space is not doubled', got.length === 1 && got[0] === 'Hello there.', got);
}

{
  const got = texts([page(1, [
    item('A sheet of paper is already', 72, 600),
    item('a wing.', 72, 580)
  ])]);
  check('wrapped lines join into one sentence', got.length === 1 && got[0] === 'A sheet of paper is already a wing.', got);
}

{
  const got = texts([page(1, [
    item('plan-', 72, 600),
    item('es fly farther.', 72, 580)
  ])]);
  check('a hyphenated line break joins the word', got.length === 1 && got[0] === 'planes fly farther.', got);
}

{
  const got = texts([page(1, [
    item('Folding a dart', 72, 700, 22),
    item('Crease the sheet in half.', 72, 660, 12)
  ])]);
  check('a taller heading is its own sentence', got[0] === 'Folding a dart' && got[1] === 'Crease the sheet in half.', got);
}

{
  const words = [];
  for (let i = 0; i < 80; i++) words.push('word' + i);
  const sentence = words.join(' ') + '.';
  const got = texts([page(1, [item(sentence, 72, 600)])]);
  check('a long sentence becomes several bites', got.length > 1, got.map((s) => s.length));
  check('each bite stays within the cap', got.every((s) => s.length <= S.PdfRead.MAX_BITE), got.map((s) => s.length));
  const back = got.join(' ').replace(/\s+/g, ' ');
  check('bites keep every word', words.every((w) => back.indexOf(w) >= 0), { bites: got.length, sample: got[0] });
}

{
  const body = [
    item('Paper and Voice', 72, 760, 10),
    item('The paper glides.', 72, 600, 12),
    item('12', 300, 500, 12),
    item('1', 300, 40, 10)
  ];
  const body2 = [
    item('Paper and Voice', 72, 760, 10),
    item('It stays up.', 72, 600, 12),
    item('Page 2 of 2', 72, 36, 9)
  ];
  const sents = S.PdfRead.pagesToSentences([page(1, body), page(2, body2)]);
  const got = sents.map((s) => s.text);
  check('a repeated margin header is dropped', got.every((t) => t.indexOf('Paper and Voice') < 0), got);
  check('a margin page number is dropped', got.every((t) => t !== '1' && t.indexOf('Page 2 of 2') < 0), got);
  check('a number in the body is kept', got.indexOf('12') >= 0, got);
  check('body sentences on both pages are kept', got.indexOf('The paper glides.') >= 0 && got.indexOf('It stays up.') >= 0, got);
  const pages = sents.map((s) => s.page);
  check('sentences stay on their own pages', pages[got.indexOf('The paper glides.')] === 1 && pages[got.indexOf('It stays up.')] === 2, pages);
}

{
  const repeated = S.PdfRead.pagesToSentences([
    page(1, [item('It glides.', 72, 400), item('It glides.', 72, 360)]),
    page(2, [item('It glides.', 72, 400)])
  ]);
  check('a repeated body line is not a header', repeated.length === 3, repeated.map((s) => s.text));
}

function memDb() {
  const rows = {};
  return {
    put: (rec) => { rows[rec.id] = rec; return Promise.resolve(rec); },
    get: (id) => Promise.resolve(rows[id] || null)
  };
}

async function main() {
  const sentences = [
    { text: 'One.', page: 1 },
    { text: 'Two.', page: 1 },
    { text: 'Three.', page: 2 },
    { text: 'Four.', page: 2 },
    { text: 'Five.', page: 3 }
  ];
  check('no save starts at the first sentence', S.PdfStore.resumeAt(sentences, null) === 0);
  check('an empty document has no position', S.PdfStore.resumeAt([], { sentence: 3 }) === 0);
  check('sentence 4 is restored', S.PdfStore.resumeAt(sentences, { sentence: 4, page: 3 }) === 4);
  check('a sentence past the end clamps to the last', S.PdfStore.resumeAt(sentences, { sentence: 99 }) === 4);
  check('a negative sentence clamps to the first', S.PdfStore.resumeAt(sentences, { sentence: -2 }) === 0);
  check('a page with no sentence index finds the first sentence there', S.PdfStore.resumeAt(sentences, { page: 2 }) === 2);
  check('a page past the end lands on the last sentence', S.PdfStore.resumeAt(sentences, { page: 9 }) === 4);
  const placed = S.PdfStore.placeAt(sentences, { sentence: 3, page: 1 });
  check('the place follows the sentence page', placed.index === 3 && placed.page === 2, placed);

  const db = memDb();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const saved = await S.PdfStore.save(db, {
    name: 'notes.pdf', page: 2, sentence: 3, speed: 1.25, fit: 'width', bytes: bytes
  });
  const loaded = await S.PdfStore.load(db);
  check('the save record is the last document', loaded && loaded.id === 'last' && loaded.name === 'notes.pdf', loaded && loaded.name);
  check('the save keeps the sentence and the speed', loaded.sentence === 3 && loaded.speed === 1.25 && loaded.page === 2, loaded);
  check('a small file is kept', loaded.bytes === bytes);
  check('resume reads the saved sentence', S.PdfStore.resumeAt(sentences, loaded) === 3);

  const textDb = memDb();
  const textSaved = await S.PdfStore.save(textDb, {
    kind: 'text', name: 'Pasted text', sentence: 1, speed: 1, text: 'Hello there. Next.'
  });
  const textLoaded = await S.PdfStore.load(textDb);
  check('pasted text is kept with its sentence',
    textSaved.kind === 'text' && textLoaded.text === 'Hello there. Next.' && textLoaded.sentence === 1 && !textLoaded.bytes,
    textLoaded);

  const huge = new Uint8Array(S.PdfStore.MAX_BYTES + 1);
  const big = await S.PdfStore.save(db, { name: 'big.pdf', page: 4, sentence: 1, speed: 1, bytes: huge });
  check('a file over 8 MB is not kept', !big.bytes && big.sentence === 1 && big.page === 4, { has: !!big.bytes, sentence: big.sentence });
  check('the position of a large file still loads', (await S.PdfStore.load(db)).sentence === 1);

  const order = [];
  const gates = {};
  function tts(req) {
    order.push('tts:' + req.text + '@' + req.speed);
    const d = deferred();
    gates[req.text] = d;
    return d.promise;
  }
  const plays = [];
  function play(audio) {
    order.push('play:' + audio.text);
    plays.push(audio);
    const d = deferred();
    gates['play:' + audio.text] = d;
    return {
      done: d.promise,
      pause: function () { order.push('pause:' + audio.text); },
      resume: function () { order.push('resume:' + audio.text); },
      stop: function () { order.push('stop:' + audio.text); d.resolve(); }
    };
  }

  const reader = S.PdfSpeak.createReader({
    sentences: [
      { text: 'Alpha.', page: 1 },
      { text: 'Beta.', page: 1 },
      { text: 'Gamma.', page: 2 }
    ],
    index: 0,
    speed: 1.25,
    voice: '',
    tts: tts,
    play: play
  });
  const done = reader.play();
  await micro();
  check('the first request is only the first sentence', order.length === 1 && order[0] === 'tts:Alpha.@1.25', order.slice());
  gates['Alpha.'].resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
  await micro();
  check('the next sentence is fetched while the first plays',
    order.indexOf('play:Alpha.') >= 0 && order.indexOf('tts:Beta.@1.25') >= 0 && order.indexOf('tts:Gamma.@1.25') < 0,
    order.slice());
  check('prefetch starts after the first audio is ready and before it ends',
    order.indexOf('tts:Alpha.@1.25') < order.indexOf('play:Alpha.') &&
    order.indexOf('play:Alpha.') < order.indexOf('tts:Beta.@1.25'),
    order.slice());
  gates['Beta.'].resolve({ bytes: new Uint8Array([2]), mime: 'audio/wav' });
  gates['play:Alpha.'].resolve();
  await micro();
  check('the second sentence plays from the prefetch and the third fetch starts',
    order.indexOf('play:Beta.') > order.indexOf('tts:Beta.@1.25') && order.indexOf('tts:Gamma.@1.25') > order.indexOf('play:Alpha.'),
    order.slice());
  gates['Gamma.'].resolve({ bytes: new Uint8Array([3]), mime: 'audio/wav' });
  gates['play:Beta.'].resolve();
  await micro();
  gates['play:Gamma.'].resolve();
  const finished = await done;
  check('a full read speaks and does not fall back', finished.spoke === true && finished.fallback === false && finished.code === 'ok', finished);
  check('play order is the sentence order', plays.map((a) => a.text).join(',') === 'Alpha.,Beta.,Gamma.', plays.map((a) => a.text));
  check('the computer voice was not used', S.__synth === 0, S.__synth);

  const from = S.PdfSpeak.createReader({
    sentences: [
      { text: 'Alpha.', page: 1 },
      { text: 'Beta.', page: 1 },
      { text: 'Gamma.', page: 2 }
    ],
    index: 2,
    speed: 1,
    tts: tts,
    play: play
  });
  const mid = [];
  const savedOrder = order.splice(0, order.length);
  void savedOrder;
  const midDone = from.play();
  await micro();
  check('resume starts at the saved sentence', order.length === 1 && order[0] === 'tts:Gamma.@1', order.slice());
  gates['Gamma.'].resolve({ bytes: new Uint8Array([9]), mime: 'audio/wav' });
  await micro();
  gates['play:Gamma.'].resolve();
  const midResult = await midDone;
  check('resume speaks that sentence', midResult.spoke === true && midResult.index === 2, midResult);
  void mid;

  {
    const lead = S.PdfSpeak.splitLead('One two three four five six seven eight nine ten eleven twelve thirteen.');
    check('a long first sentence splits after about ten words',
      lead.length === 2 && lead[0].split(' ').length === 10 && lead[1] === 'eleven twelve thirteen.', lead);
    const comma = S.PdfSpeak.splitLead('One two three four five six seven eight, nine ten eleven twelve thirteen fourteen.');
    check('a comma in the first window is the split',
      comma.length === 2 && comma[0] === 'One two three four five six seven eight,', comma);
    check('a short sentence stays one chunk', S.PdfSpeak.splitLead('Then it dipped.').length === 1);
    const twelve = [];
    for (let i = 1; i <= 12; i++) twelve.push('w' + i);
    check('twelve words stay one chunk', S.PdfSpeak.splitLead(twelve.join(' ')).length === 1);
    check('the lookahead buffer defaults to four', S.PdfSpeak.LOOKAHEAD === 4);
  }

  async function flush() {
    for (let n = 0; n < 8; n++) await Promise.resolve();
  }

  {
    const names = ['S0.', 'S1.', 'S2.', 'S3.', 'S4.', 'S5.', 'S6.', 'S7.'];
    const order2 = [];
    const gates2 = {};
    function tts2(req) {
      order2.push('tts:' + req.text);
      const d = deferred();
      gates2[req.text] = d;
      return d.promise;
    }
    function play2(audio) {
      order2.push('play:' + audio.text);
      const d = deferred();
      gates2['play:' + audio.text] = d;
      return {
        done: d.promise,
        pause: function () {},
        resume: function () {},
        stop: function () { d.resolve(); }
      };
    }
    const ahead = S.PdfSpeak.createReader({
      sentences: names.map((text, i) => ({ text: text, page: 1 })),
      lookahead: 4,
      tts: tts2,
      play: play2
    });
    const aheadDone = ahead.play();
    await flush();
    check('lookahead asks for the first sentence before anything plays', order2.length === 1 && order2[0] === 'tts:S0.', order2.slice());
    for (let n = 0; n < 5; n++) {
      gates2['S' + n + '.'].resolve({ bytes: new Uint8Array([n + 1]), mime: 'audio/wav' });
      await flush();
    }
    const ttsWhileFirstPlays = order2.filter((x) => x.startsWith('tts:')).length;
    check('while the first sentence plays, four more are ready and a fifth is not',
      ttsWhileFirstPlays === 5 && order2.filter((x) => x.startsWith('play:')).join(',') === 'play:S0.',
      order2.slice());
    gates2['play:S0.'].resolve();
    await flush();
    check('the next sentence starts as soon as the first ends and the buffer refills',
      order2.indexOf('play:S1.') > order2.indexOf('play:S0.') && order2.filter((x) => x.startsWith('tts:')).length === 6,
      order2.slice());
    for (let n = 1; n < names.length; n++) {
      if (gates2['S' + n + '.'] && order2.indexOf('tts:S' + n + '.') >= 0) {
        gates2['S' + n + '.'].resolve({ bytes: new Uint8Array([n + 1]), mime: 'audio/wav' });
      }
      await flush();
      if (gates2['play:S' + n + '.']) gates2['play:S' + n + '.'].resolve();
      await flush();
    }
    const aheadResult = await aheadDone;
    check('lookahead keeps sentence order through the whole read',
      aheadResult.spoke === true && order2.filter((x) => x.startsWith('play:')).join(',') === names.map((t) => 'play:' + t).join(','),
      order2.filter((x) => x.startsWith('play:')));
  }

  {
    const longA = 'One two three four five six seven eight nine ten eleven twelve thirteen.';
    const longB = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november.';
    const splitOrder = [];
    const splitGates = {};
    const splitReader = S.PdfSpeak.createReader({
      sentences: [
        { text: longA, page: 1 },
        { text: longB, page: 1 }
      ],
      tts: (req) => {
        splitOrder.push(req.text);
        const d = deferred();
        splitGates[req.text] = d;
        return d.promise;
      },
      play: (audio) => {
        const d = deferred();
        splitGates['play:' + audio.text] = d;
        return { done: d.promise, stop: function () { d.resolve(); } };
      }
    });
    const splitDone = splitReader.play();
    await flush();
    check('playback starts by synthesizing only the short first chunk',
      splitOrder.length === 1 && splitOrder[0] === 'One two three four five six seven eight nine ten', splitOrder.slice());
    splitGates[splitOrder[0]].resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
    await flush();
    check('the rest of the first sentence is next, and the following sentence stays whole',
      splitOrder.length === 2 && splitOrder[1] === 'eleven twelve thirteen.', splitOrder.slice());
    splitGates[splitOrder[1]].resolve({ bytes: new Uint8Array([2]), mime: 'audio/wav' });
    await flush();
    check('a later sentence is not split into a short chunk',
      splitOrder.length === 3 && splitOrder[2] === longB, splitOrder.slice());
    splitReader.stop();
    await splitDone.catch(() => {});
    void splitDone;
  }

  {
    let drops = 0;
    const staleOrder = [];
    const staleGates = {};
    function ttsStale(req) {
      staleOrder.push('tts:' + req.text);
      const d = deferred();
      d.text = req.text;
      staleGates[req.text] = d;
      return d.promise;
    }
    function playStale(audio) {
      staleOrder.push('play:' + audio.text);
      const d = deferred();
      staleGates['play:' + audio.text] = d;
      return { done: d.promise, stop: function () { d.resolve(); } };
    }
    const stale = S.PdfSpeak.createReader({
      sentences: [
        { text: 'Alpha.', page: 1 },
        { text: 'Beta.', page: 1 },
        { text: 'Gamma.', page: 1 },
        { text: 'Delta.', page: 1 }
      ],
      lookahead: 4,
      tts: ttsStale,
      play: playStale,
      prepare: (audio) => ({
        drop: function () { drops++; },
        play: function () { return playStale(audio); }
      })
    });
    const staleDone = stale.play();
    await flush();
    staleGates['Alpha.'].resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
    await flush();
    staleGates['Beta.'].resolve({ bytes: new Uint8Array([2]), mime: 'audio/wav' });
    await flush();
    const betaInFlight = staleGates['Gamma.'];
    check('a prepared sentence is waiting while the first one plays',
      staleOrder.indexOf('play:Alpha.') >= 0 && staleOrder.indexOf('tts:Gamma.') >= 0 && staleOrder.indexOf('play:Beta.') < 0,
      staleOrder.slice());
    const playsBefore = staleOrder.filter((x) => x.startsWith('play:')).length;
    stale.next();
    await flush();
    betaInFlight.resolve({ bytes: new Uint8Array([3]), mime: 'audio/wav' });
    await flush();
    check('seeking drops a prepared sentence and ignores a stale result',
      drops >= 1 && staleOrder.filter((x) => x.startsWith('play:')).length === playsBefore && staleOrder.indexOf('play:Gamma.') < 0,
      { drops: drops, order: staleOrder.slice() });
    const betaAgain = staleGates['Beta.'];
    check('the sentence that was seeked to is fetched again', betaAgain && betaAgain !== undefined && staleOrder.filter((x) => x === 'tts:Beta.').length >= 2, staleOrder.slice());
    betaAgain.resolve({ bytes: new Uint8Array([9]), mime: 'audio/wav' });
    await flush();
    check('only the sentence seeked to starts after the stale result',
      staleOrder.filter((x) => x.startsWith('play:')).join(',') === 'play:Alpha.,play:Beta.',
      staleOrder.filter((x) => x.startsWith('play:')));
    stale.stop();
    await staleDone.catch(() => {});
  }

  {
    const pauseOrder = [];
    const pauseGates = {};
    const pauseReader = S.PdfSpeak.createReader({
      sentences: [
        { text: 'Alpha.', page: 1 },
        { text: 'Beta.', page: 1 },
        { text: 'Gamma.', page: 1 }
      ],
      tts: (req) => {
        pauseOrder.push('tts:' + req.text);
        const d = deferred();
        pauseGates[req.text] = d;
        return d.promise;
      },
      play: (audio) => {
        pauseOrder.push('play:' + audio.text);
        const d = deferred();
        pauseGates['play:' + audio.text] = d;
        return {
          done: d.promise,
          pause: function () { pauseOrder.push('pause:' + audio.text); },
          resume: function () { pauseOrder.push('resume:' + audio.text); },
          stop: function () { d.resolve(); }
        };
      }
    });
    const pauseDone = pauseReader.play();
    await flush();
    pauseGates['Alpha.'].resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
    await flush();
    const oldBeta = pauseGates['Beta.'];
    pauseReader.pause();
    check('pause holds the current sentence', pauseReader.paused() === true && pauseReader.playing() === false, pauseOrder.slice());
    oldBeta.resolve({ bytes: new Uint8Array([2]), mime: 'audio/wav' });
    await flush();
    check('a result that arrives while paused does not play',
      pauseOrder.filter((x) => x.startsWith('play:')).join(',') === 'play:Alpha.' && pauseOrder.indexOf('pause:Alpha.') >= 0,
      pauseOrder.slice());
    pauseReader.play();
    await flush();
    check('resume continues the same sentence and refills the queue',
      pauseOrder.indexOf('resume:Alpha.') >= 0 && pauseOrder.filter((x) => x === 'tts:Beta.').length === 2,
      pauseOrder.slice());
    const newBeta = pauseGates['Beta.'];
    newBeta.resolve({ bytes: new Uint8Array([4]), mime: 'audio/wav' });
    await flush();
    check('the refilled sentence stays queued until the current one ends',
      pauseOrder.filter((x) => x.startsWith('play:')).join(',') === 'play:Alpha.',
      pauseOrder.slice());
    pauseGates['play:Alpha.'].resolve();
    await flush();
    check('after resume the next sentence plays from the refill',
      pauseOrder.filter((x) => x.startsWith('play:')).join(',') === 'play:Alpha.,play:Beta.',
      pauseOrder.slice());
    pauseReader.stop();
    await pauseDone.catch(() => {});
  }

  async function miss(label, ttsFn) {
    const heard = [];
    const r = S.PdfSpeak.createReader({
      sentences: [{ text: 'Hello there.', page: 1 }],
      tts: ttsFn,
      play: (audio) => { heard.push(audio); const d = deferred(); d.resolve(); return { done: d.promise, stop: function () {} }; }
    });
    const res = await r.play();
    check(label + ' plays nothing', heard.length === 0, heard.length);
    check(label + ' is the no-voice path', res.code === 'no-voice' && res.spoke === false && res.fallback === false, res);
    check(label + ' names Offline TTS and the store',
      /Offline TTS/.test(res.message) && /store/.test(res.message), res.message);
    return res;
  }

  await miss('a missing provider', null);
  await miss('NOT_CONFIGURED', () => Promise.reject(new Error('NOT_CONFIGURED:ai:tts')));
  const detailed = await miss('a provider failure', () => Promise.reject(new Error('voice-weight-missing-42')));
  check('a provider failure keeps its own detail', /voice-weight-missing-42/.test(detailed.message), detailed.message);

  const emptyHeard = [];
  const emptyReader = S.PdfSpeak.createReader({
    sentences: [],
    tts: () => { emptyHeard.push('tts'); return Promise.resolve({ bytes: new Uint8Array([1]), mime: 'audio/wav' }); },
    play: () => { emptyHeard.push('play'); return { done: Promise.resolve(), stop: function () {} }; }
  });
  const emptyRes = await emptyReader.play();
  check('a PDF with no text does not call the voice', emptyRes.code === 'no-text' && emptyHeard.length === 0, { code: emptyRes.code, heard: emptyHeard });
  check('the speech synthesis hook stayed unused', S.__synth === 0, S.__synth);

  if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
  }
  console.log('all checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
