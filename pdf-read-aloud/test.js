// Read Aloud: sentences, headers, prefetch, resume, missing voice,
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
