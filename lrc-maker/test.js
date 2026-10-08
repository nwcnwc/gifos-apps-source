// LRC Maker has to stamp lines, follow the singing line, export LRC, and keep
// the song bytes in the file. The parser + LRCCore play that loop in a vm.
// Phone Stamp size and Back are one-liners, scanned in source.
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
  const sandbox = {
    console, Math, Map, Number, Intl, isFinite, Uint8Array, Array, Object, JSON,
    String, Boolean, Date, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'vendor', 'lrc-parser.js'), 'utf8'), sandbox, { filename: 'lrc-parser.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const S = load();
const P = S.lrcParser;
const C = S.LRCCore;
check('parser and LRCCore load', !!(P && P.parser && P.stringify && C && C.stampLine && C.singingAt && C.persistRecord));

{
  const st = P.parser('[00:01.00]Hello\nWorld');
  check('parser: two lines', st.lyric.length === 2, st.lyric.length);
  check('parser: first line is t=1', st.lyric[0].time === 1, st.lyric[0].time);
  const out = P.stringify({ info: new Map(), lyric: st.lyric }, { spaceStart: 0, spaceEnd: 0, fixed: 2, endOfLine: '\n' });
  check('stringify roundtrip keeps the tag', out.indexOf('[00:01.00]Hello') >= 0, out);
}

{
  const parsed = C.parseText('[ti:Demo]\n[00:01.00]Hello\nWorld');
  check('parseText: two lyric lines', parsed.lines.length === 2);
  check('parseText: info.ti', parsed.info.ti === 'Demo', parsed.info);
  check('parseText: unsung second line has no time', parsed.lines[1].time === undefined);

  const cur = C.stampLine(parsed.lines, 1, 2.5);
  check('stamp writes the time and advances', parsed.lines[1].time === 2.5 && cur === 1);

  check('singingAt before first stamp is -1', C.singingAt(parsed.lines, 0) === -1);
  check('singingAt 1.2 is line 0', C.singingAt(parsed.lines, 1.2) === 0);
  check('singingAt 2.5 is line 1 (karaoke follow)', C.singingAt(parsed.lines, 2.5) === 1);
  check('singingAt 9 is still the last stamped line', C.singingAt(parsed.lines, 9) === 1);

  C.unstampLine(parsed.lines, 1);
  check('unstamp clears the time', parsed.lines[1].time === undefined);
  check('singingAt after unstamp falls back to line 0', C.singingAt(parsed.lines, 9) === 0);

  const text = C.exportText(parsed.lines, parsed.info);
  check('export includes [ti: Demo] and the stamped line',
    text.indexOf('[ti: Demo]') >= 0 && text.indexOf('[00:01.00]') >= 0, text);
}

{
  const lines = [{ time: 1, text: 'a' }, { text: 'b' }];
  const small = C.persistRecord({
    lines: lines, cur: 0,
    audioBytes: new Uint8Array([1, 2, 3, 4]),
    audioName: 'song.mp3', audioMime: 'audio/mpeg'
  });
  check('persist keeps lyrics', small.lines.length === 2 && small.id === 'lrc');
  check('persist keeps small audio in the file', small.audioBytes && small.audioBytes.length === 4 && small.audioName === 'song.mp3');
  check('small audio is not flagged too big', small.audioTooBig === false);

  const big = new Uint8Array(C.MAX_AUDIO + 1);
  const rec = C.persistRecord({ lines: lines, cur: 1, audioBytes: big, audioName: 'huge.wav' });
  check('audio over 8 MB is not stuffed into the file', !rec.audioBytes);
  check('…and the save says so honestly', rec.audioTooBig === true);

  const old = C.persistRecord({ lines: lines, cur: 0 });
  check('old saves without audio still load (no audioBytes key required)', old.lines.length === 2 && !old.audioBytes);
}

{
  const empty = C.parseText('one\ntwo\nthree');
  check('plain lyrics become untimed lines', empty.lines.length === 3 && empty.lines[0].time === undefined);
  const i0 = C.stampLine(empty.lines, 0, 0.4);
  const i1 = C.stampLine(empty.lines, i0, 1.1);
  const i2 = C.stampLine(empty.lines, i1, 2.0);
  check('stamping through a song advances 0 → 1 → 2', i0 === 1 && i1 === 2 && i2 === 2);
  check('karaoke lights line 1 at t=1.5', C.singingAt(empty.lines, 1.5) === 1);
  const lrc = C.exportText(empty.lines, {});
  check('export writes three tagged lines',
    (lrc.match(/\[\d/g) || []).length === 3, lrc);
}

// ---- the page, executed ---------------------------------------------------
// app.js and mp.js run against a fake page: elements by id, an Audio whose
// clock the test moves, a FileReader that hands back invented bytes, and a
// gifos with a save collection that records what is written.
function pageEl(tag, id) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', hidden: false, disabled: false, value: '',
    style: {}, attrs: {}, listeners: {}, textContent: '', _html: '', files: null,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    fire(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn.call(e, Object.assign({ preventDefault() {}, type: t, target: e }, ev || {}))); },
    querySelector(sel) {
      const cls = sel.replace(/^\./, '');
      return new RegExp('class="[^"]*\\b' + cls + '\\b').test(this._html) ? { scrollIntoView() {} } : null;
    },
    focus() {}, click() {},
  };
  Object.defineProperty(e, 'innerHTML', { get() { return e._html; }, set(v) { e._html = String(v); } });
  return e;
}
// Rendered list rows: [{ i, classes }] from the <li data-i> markup.
function rows(listEl) {
  const out = [];
  listEl.innerHTML.replace(/<li class="([^"]*)" data-i="(\d+)"/g, (_, c, i) => { out.push({ i: +i, classes: c.split(/\s+/).filter(Boolean) }); });
  return out;
}
function page(opts) {
  opts = opts || {};
  const els = {};
  const hiddenAtLoad = ['editor', 'err', 'friend-bar'];
  const document = {
    getElementById(id) {
      if (!els[id]) { els[id] = pageEl(id === 'lyrics' ? 'textarea' : 'div', id); if (hiddenAtLoad.indexOf(id) >= 0) els[id].hidden = true; }
      return els[id];
    },
    createElement(tag) { return pageEl(tag); },
    addEventListener() {},
    body: pageEl('body'),
  };
  const timers = [];
  const saved = Object.assign({}, opts.rows || {}), puts = [], dbNames = [], backs = [];
  const audios = [];
  class Audio {
    constructor() { this.currentTime = 0; this.paused = true; this.duration = 120; this.src = ''; this.listeners = {}; audios.push(this); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    fire(t) { (this.listeners[t] || []).forEach((fn) => fn()); }
    load() {}
    play() { this.paused = false; this.fire('play'); return Promise.resolve(); }
    pause() { this.paused = true; this.fire('pause'); }
  }
  class FileReader {
    readAsArrayBuffer(f) { this.result = f.bytes.buffer.slice(0); this.onload && this.onload(); }
    readAsText(f) { this.result = f.text; this.onload && this.onload(); }
  }
  class Blob { constructor(parts, o) { this.parts = parts; this.type = (o && o.type) || ''; } }
  let url = 0;
  const gifos = opts.noApi ? undefined : {
    db(name) {
      dbNames.push(name);
      if (name !== 'save') return { put() { return Promise.resolve(); }, subscribe() {}, get() { return Promise.resolve(null); } };
      return {
        get(id) { return Promise.resolve(saved[id] || null); },
        put(r) { puts.push(r); saved[r.id] = r; return Promise.resolve(); },
      };
    },
    me() { return Promise.resolve({ id: 'm', name: 'Sample' }); },
    onBack(fn) { backs.push(fn); },
  };
  const sandbox = {
    console, Math, Map, Number, Intl, isFinite, Uint8Array, ArrayBuffer, Array, Object, JSON, String, Boolean, Date, Promise,
    document, gifos, Audio, FileReader, Blob,
    URL: { createObjectURL() { return 'blob:sample-' + (++url); }, revokeObjectURL() {} },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1] = null; },
    setInterval() { return 1; }, clearInterval() {},
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/lrc-parser.js', 'app.js', 'mp.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  const flush = () => { const t = timers.splice(0); t.forEach((fn) => fn && fn()); };
  return { S: sandbox, els, audio: audios[0], saved, puts, dbNames, backs, flush };
}
const settle = () => new Promise((r) => setImmediate(r));

async function pageChecks() {
  {
    const P = page();
    await settle();
    // Lyrics in, Stamp from the dock, the song's clock decides the time.
    P.els.lyrics.value = 'first line\nsecond line\nthird line';
    P.els.lyrics.fire('change');
    P.audio.currentTime = 1.25;
    P.els.stampBtn.fire('click');
    P.audio.currentTime = 3.5;
    P.els.stampBtn.fire('click');
    const L = P.S.LRCApp.getLines();
    check('the Stamp button stamps the current line at the song time and moves on',
      L.length === 3 && L[0].time === 1.25 && L[1].time === 3.5 && L[2].time === undefined
        && rows(P.els.lines).find((r) => r.classes.indexOf('on') >= 0).i === 2,
      L);

    // Karaoke follow: while the song plays, the sung line is marked.
    P.audio.src = 'blob:sample';
    P.audio.play();
    P.audio.currentTime = 2.0;
    P.audio.fire('timeupdate');
    const sing1 = rows(P.els.lines).filter((r) => r.classes.indexOf('sing') >= 0).map((r) => r.i);
    P.audio.currentTime = 4.0;
    P.audio.fire('timeupdate');
    const sing2 = rows(P.els.lines).filter((r) => r.classes.indexOf('sing') >= 0).map((r) => r.i);
    P.audio.pause();
    const sing3 = rows(P.els.lines).filter((r) => r.classes.indexOf('sing') >= 0).length;
    check('karaoke follow uses singingAt during play',
      sing1.join() === '0' && sing2.join() === '1' && sing3 === 0, { sing1, sing2, sing3 });

    // The song bytes go into the save row with the lyrics.
    const bytes = new Uint8Array([9, 8, 7, 6]);
    P.els.audioFile.files = [{ name: 'sample.mp3', type: 'audio/mpeg', bytes }];
    P.els.audioFile.fire('change');
    P.flush();
    const row = P.saved.lrc;
    check('audio bytes are written to gifos.db save',
      P.dbNames.indexOf('save') >= 0 && !!row && row.audioBytes && Array.from(row.audioBytes).join() === '9,8,7,6'
        && row.audioName === 'sample.mp3' && row.lines.length === 3 && row.lines[1].time === 3.5,
      row && { name: row.audioName, n: row.lines && row.lines.length });

    // Back: closes the lyrics editor first, then leaves a shared sheet.
    const back = P.backs[0];
    P.els.editBtn.fire('click');
    const opened = P.els.editor.hidden === false;
    const r1 = back && back();
    const closed = P.els.editor.hidden === true;
    P.els.shareBtn.fire('click');
    await settle(); await settle();
    const inRoom = P.S.LRMp.busy();
    const r2 = back && back();
    const left = !P.S.LRMp.busy();
    const r3 = back && back();
    check('onBack closes the lyrics editor, then leaves a shared sheet',
      !!back && opened && r1 === true && closed && inRoom && r2 === true && left && r3 === false,
      { opened, r1, closed, inRoom, r2, left, r3 });
  }
  // Reopen: lyrics, stamps and the song come back from the file.
  {
    const rec = page().S.LRCCore.persistRecord({
      lines: [{ time: 1, text: 'a' }, { text: 'b' }], cur: 1,
      audioBytes: new Uint8Array([1, 2, 3]), audioName: 'kept.ogg', audioMime: 'audio/ogg',
    });
    const P = page({ rows: { lrc: rec } });
    await settle(); await settle();
    const L = P.S.LRCApp.getLines();
    check('a saved file reopens with its lyrics, stamps and song',
      L.length === 2 && L[0].time === 1 && !!P.audio.src && P.els.lyrics.value === 'a\nb', { n: L.length, src: P.audio.src });
  }
}

// ---- dock and layout -------------------------------------------------------
// Stamp lives in the dock: #stampBtn is a child of #dock in the shipped page.
function childIdsOf(markup, id) {
  const open = markup.search(new RegExp('<div\\b[^>]*\\bid="' + id + '"'));
  if (open < 0) return null;
  let depth = 0, end = -1;
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(markup))) { depth += m[1] ? -1 : 1; if (!depth) { end = m.index; break; } }
  const inner = markup.slice(open, end < 0 ? undefined : end);
  return (inner.match(/\bid="([^"]+)"/g) || []).map((x) => x.slice(4, -1));
}
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
{
  const ids = childIdsOf(html, 'dock') || [];
  check('Stamp sits in a dock under the thumb', ids.indexOf('stampBtn') >= 0 && ids.indexOf('playBtn') >= 0, ids);
}
// Computed min-height of #stampBtn from style.css, for a phone and a desktop
// viewport: a small cascade over id / tag / class selectors and descendant
// combinators, with @media (max-width|min-width).
function computed(cssText, chain, prop, width) {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;
  (function parse(str, media) {
    let j = 0;
    while (j < str.length) {
      const open = str.indexOf('{', j);
      if (open < 0) break;
      const head = str.slice(j, open).trim();
      let depth = 1, k = open + 1;
      while (k < str.length && depth) { if (str[k] === '{') depth++; else if (str[k] === '}') depth--; k++; }
      const body = str.slice(open + 1, k - 1);
      if (/^@media/i.test(head)) parse(body, head.slice(6));
      else if (!/^@/.test(head)) rules.push({ sels: head.split(',').map((x) => x.trim()), body, media, order: order++ });
      j = k;
    }
  })(text, null);
  const mediaOk = (q) => !q || q.split(',').some((part) => (part.match(/\(([^)]+)\)/g) || []).every((c) => {
    const [k, v] = c.slice(1, -1).split(':').map((x) => x.trim());
    if (k === 'max-width') return width <= parseFloat(v);
    if (k === 'min-width') return width >= parseFloat(v);
    return false;
  }));
  const compound = (str) => {
    const m = str.match(/^([a-z]+|\*)?((?:[#.][\w-]+)*)$/i);
    if (!m) return null;
    return { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, ids: (m[2].match(/#[\w-]+/g) || []).map((x) => x.slice(1)),
      cls: (m[2].match(/\.[\w-]+/g) || []).map((x) => x.slice(1)) };
  };
  const fits = (c, el) => c && (!c.tag || c.tag === el.tag) && c.ids.every((x) => x === el.id) && c.cls.every((x) => el.cls.indexOf(x) >= 0);
  const spec = (cs) => cs.reduce((n, c) => n + 100 * c.ids.length + 10 * c.cls.length + (c.tag ? 1 : 0), 0);
  let best = null;
  rules.forEach((r) => {
    if (!mediaOk(r.media)) return;
    const d = r.body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
    if (!d) return;
    r.sels.forEach((sel) => {
      const cs = sel.split(/\s+/).map(compound);
      if (cs.some((c) => !c)) return;   // pseudo-classes, combinators other than descendant: not this element's resting state
      if (!fits(cs[cs.length - 1], chain[chain.length - 1])) return;
      let ci = cs.length - 2;
      for (let ei = chain.length - 2; ei >= 0 && ci >= 0; ei--) if (fits(cs[ci], chain[ei])) ci--;
      if (ci >= 0) return;
      const sp = spec(cs);
      if (!best || sp > best.sp || (sp === best.sp && r.order >= best.order)) best = { sp, order: r.order, v: d[1].trim() };
    });
  });
  return best ? best.v : null;
}
{
  const chain = [{ tag: 'div', id: 'shell', cls: [] }, { tag: 'div', id: 'dock', cls: [] }, { tag: 'button', id: 'stampBtn', cls: [] }];
  // Phone widths only: "under the thumb". On a wide screen the shared
  // `#dock button` rule (one id + one tag) outranks `#stampBtn` (one id), so
  // the desktop Stamp computes to the 40px of the other dock buttons. That is
  // a product finding, reported, not asserted here.
  const phone = computed(css, chain, 'min-height', 390), small = computed(css, chain, 'min-height', 640);
  check('Stamp is at least 56px tall', /px$/.test(phone) && parseFloat(phone) >= 56 && /px$/.test(small) && parseFloat(small) >= 56, { phone, small });
}

const src = {
  app: fs.readFileSync(path.join(APP, 'app.js'), 'utf8'),
  mp: fs.readFileSync(path.join(APP, 'mp.js'), 'utf8'),
  listing: JSON.parse(fs.readFileSync(path.join(APP, 'listing.json'), 'utf8')),
  manifest: JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8')),
};

// TEXT-CHECK: Invite is OS chrome and there is no app API behind an in-app
// Invite control, so there is nothing to run. This scans the markup.
check('no in-app Invite button', !/<button\b[^>]*>\s*Invite\s*</i.test(html) && !/\bid\s*=\s*["']invite["']/i.test(html));
// TEXT-CHECK: the absence of a network or eval path can only be proven over
// the whole source; running the app exercises only the paths a test takes.
check('no fetch / XHR / WebSocket / eval',
  !['fetch(', 'XMLHttpRequest', 'WebSocket', 'eval(', 'new Function('].some((b) => src.app.includes(b) || src.mp.includes(b)));
check('no microphone capability (clips are not required)', !src.manifest.capabilities.microphone);
check('no network capability', !src.manifest.capabilities.network);
check('author is magic-akari, porter is GifOS',
  src.listing.author.name === 'magic-akari' && src.listing.porter.name === 'GifOS');

let pageDone = false;
process.on('exit', () => {
  if (!pageDone) { console.log('FAIL — the page checks never finished (a promise hung)'); process.exitCode = 1; }
});
pageChecks().then(() => {
  pageDone = true;
  console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}, (e) => { console.log('FAIL — page harness threw: ' + (e && e.stack || e)); process.exit(1); });
