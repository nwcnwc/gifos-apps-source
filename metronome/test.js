// METRONOME HAS TO CLICK IN TIME.
//
// The GIF is a lookahead Web Audio scheduler (Chris Wilson): notes are
// scheduled 100ms ahead, then the lights and the pendulum MUST follow
// audio.currentTime, not the schedule call. Tempo math is the product —
// 120 4/4 is a click every 500ms, 6/8 at 120 clicks eighths, tap tempo
// from timestamps. A port that paints when it schedules flashes early
// and is not a metronome.
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
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise,
    setTimeout: () => 0, clearTimeout: () => {},
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
  return sandbox;
}

const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const html = src('index.html');
const css = src('style.css');
const app = src('app.js');
const mp = src('mp.js');
const help = src('help.md');
const listing = JSON.parse(src('listing.json'));
const manifest = JSON.parse(src('manifest.json'));

const sandbox = load();
const M = sandbox.MetronomeApp;
check('app.js loads and attaches MetronomeApp', !!(M && M.beatsOf && M.scheduleBar && M.tapBpm));

check('4/4 is 4 beats', M.beatsOf('4/4') === 4);
check('3/4 is 3 beats', M.beatsOf('3/4') === 3);
check('2/4 is 2 beats', M.beatsOf('2/4') === 2);
check('6/8 is 6 pulses', M.beatsOf('6/8') === 6);
check('unknown signature falls back to 4', M.beatsOf('9/8') === 4);

{
  const q = M.nextSeconds(120, '4/4');
  check('120 BPM 4/4 is a click every 0.5s', Math.abs(q - 0.5) < 1e-9, q);
  const e = M.nextSeconds(120, '6/8');
  check('120 BPM 6/8 clicks eighths (0.25s)', Math.abs(e - 0.25) < 1e-9, e);
  const slow = M.secondsPerClick(60, '4/4', 'beat');
  check('60 BPM 4/4 is a click every 1s', Math.abs(slow - 1) < 1e-9, slow);
  const s8 = M.secondsPerClick(120, '4/4', '8th');
  check('120 BPM 4/4 eighths click every 0.25s', Math.abs(s8 - 0.25) < 1e-9, s8);
  const trip = M.secondsPerClick(120, '4/4', 'trip');
  check('120 BPM 4/4 triplets click every 1/6 s', Math.abs(trip - 1 / 6) < 1e-9, trip);
  const s16 = M.secondsPerClick(120, '4/4', '16th');
  check('120 BPM 4/4 sixteenths click every 0.125s', Math.abs(s16 - 0.125) < 1e-9, s16);
}

{
  const bar = M.scheduleBar(120, '4/4', 'beat', 0);
  check('a 4/4 bar at the beat is 4 clicks', bar.length === 4, bar.length);
  check('times are 0, 0.5, 1.0, 1.5',
    bar.every((n, i) => Math.abs(n.time - i * 0.5) < 1e-9),
    bar.map((n) => n.time));
  check('only the downbeat is the accent', bar[0].accent && bar.slice(1).every((n) => !n.accent));
  check('every beat click is onBeat', bar.every((n) => n.onBeat));
}

{
  const bar = M.scheduleBar(120, '4/4', '8th', 1);
  check('eighths: 8 clicks in a 4/4 bar', bar.length === 8, bar.length);
  check('eighths start at t0', Math.abs(bar[0].time - 1) < 1e-9, bar[0].time);
  check('off-beat eighths are not onBeat', !bar[1].onBeat && bar[1].beat === 0 && bar[1].sub === 1);
  check('beat 1 lands at +0.5s', Math.abs(bar[2].time - 1.5) < 1e-9 && bar[2].beat === 1 && bar[2].onBeat);
}

{
  const bar = M.scheduleBar(120, '6/8', 'beat', 0);
  check('6/8 bar is 6 clicks', bar.length === 6, bar.length);
  check('6/8 spacing is 0.25s at 120',
    bar.every((n, i) => Math.abs(n.time - i * 0.25) < 1e-9));
  check('6/8 downbeat is the only accent', bar[0].accent && !bar[3].accent);
}

check('clicksInBar 4/4 16th is 16', M.clicksInBar('4/4', '16th') === 16);
check('clicksInBar 3/4 trip is 9', M.clicksInBar('3/4', 'trip') === 9);

check('tempo clamps below 30', M.clampTempo(0) === 30);
check('tempo clamps above 240', M.clampTempo(999) === 240);
check('tempo rounds', M.clampTempo(120.4) === 120);

check('tap of 500ms gaps is 120 BPM', M.tapBpm([0, 500, 1000, 1500]) === 120);
check('tap of 1000ms gaps is 60 BPM', M.tapBpm([1000, 2000, 3000]) === 60);
check('tap of one stamp is nothing', M.tapBpm([1]) === null);
check('tap uses the last 6 stamps', M.tapBpm([0, 10, 1000, 1500, 2000, 2500, 3000, 3500]) === 120);
check('tap clamps a 10ms flutter up to 240', M.tapBpm([0, 10, 20]) === 240);

check('120 is Allegro', M.tempoMark(120) === 'Allegro');
check('50 is Largo', M.tempoMark(50) === 'Largo');
check('92 is Andante', M.tempoMark(92) === 'Andante');
check('180 is Presto', M.tempoMark(180) === 'Presto');
check('printed marks are on the box', Array.isArray(M.MARKS) && M.MARKS.length >= 6);

check('lookahead is Wilson\'s 25ms', M.LOOKAHEAD === 25);
check('schedule-ahead is Wilson\'s 0.1s', M.SCHEDULE_AHEAD === 0.1);

// ============================================================================
// PLAY THE PAGE. The shipped index.html is parsed into a tiny DOM, mp.js and
// app.js run in a vm against a fake Web Audio clock, fake timers and a fake
// gifos, and the suite presses the real controls by id/data-attribute.
// ============================================================================
// ---- tiny DOM: parses the shipped index.html so the app binds to its real ids
function miniDom(html) {
  const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'col', 'area', 'base', 'wbr']);
  class Ev {
    constructor(type, init) { Object.assign(this, { bubbles: true }, init || {}); this.type = type; this.defaultPrevented = false; this._stop = false; }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
  }
  class Node {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.nodeName = this.tagName;
      this.attrs = {}; this.childNodes = []; this.parentNode = null; this._ls = {}; this._text = '';
      const self = this;
      this.style = {
        _p: {},
        setProperty(k, v) { this._p[k] = String(v); },
        getPropertyValue(k) { return this._p[k] || ''; },
        removeProperty(k) { delete this._p[k]; },
      };
      this.classList = {
        _s() { return (self.attrs.class || '').split(/\s+/).filter(Boolean); },
        add(...c) { const s = this._s(); c.forEach((x) => { if (!s.includes(x)) s.push(x); }); self.attrs.class = s.join(' '); },
        remove(...c) { self.attrs.class = this._s().filter((x) => !c.includes(x)).join(' '); },
        contains(c) { return this._s().includes(c); },
        toggle(c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; },
      };
      this.value = ''; this.checked = false; this.disabled = false;
    }
    get children() { return this.childNodes.filter((n) => n.tagName !== '#TEXT'); }
    get firstChild() { return this.childNodes[0] || null; }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get className() { return this.attrs.class || ''; }
    set className(v) { this.attrs.class = String(v); }
    get hidden() { return 'hidden' in this.attrs; }
    set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
    get type() { return this.attrs.type || ''; }
    set type(v) { this.attrs.type = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
    insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
    removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    get textContent() { return this.tagName === '#TEXT' ? this._text : this.childNodes.map((n) => n.textContent).join(''); }
    set textContent(v) { if (this.tagName === '#TEXT') { this._text = String(v); return; } this.childNodes.forEach((n) => { n.parentNode = null; }); this.childNodes = []; if (String(v)) this.appendChild(text(String(v))); }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    get innerHTML() { return this._html || ''; }
    set innerHTML(v) { this.textContent = ''; this._html = String(v); parseInto(this, String(v)); }
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
    removeEventListener(t, fn) { this._ls[t] = (this._ls[t] || []).filter((f) => f !== fn); }
    dispatchEvent(ev) {
      if (!ev.target) ev.target = this;
      for (let n = this; n && !ev._stop; n = ev.bubbles ? n.parentNode : null) {
        ev.currentTarget = n;
        (n._ls[ev.type] || []).slice().forEach((f) => f.call(n, ev));
        if (n['on' + ev.type]) n['on' + ev.type](ev);
      }
      return !ev.defaultPrevented;
    }
    click() { if (!this.disabled) this.dispatchEvent(new Ev('click', { button: 0 })); }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; this.dispatchEvent(new Ev('blur', { bubbles: false })); }
    select() {}
    matches(sel) { return sel.split(',').some((s) => matchComplex(this, s.trim())); }
    closest(sel) { for (let n = this; n && n.tagName !== '#DOC'; n = n.parentNode) if (n.matches && n.matches(sel)) return n; return null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; }
  }
  function text(s) { const t = new Node('#text'); t._text = s; return t; }
  function matchCompound(el, s) {
    if (!el || !el.attrs) return false;
    const re = /([#.]?[\w-]+|\*|\[[^\]]+\]|:[\w-]+(\([^)]*\))?)/g;
    let m; let ok = true;
    while ((m = re.exec(s))) {
      const t = m[0];
      if (t === '*') continue;
      if (t[0] === '#') ok = ok && el.id === t.slice(1);
      else if (t[0] === '.') ok = ok && el.classList.contains(t.slice(1));
      else if (t[0] === '[') { const a = /^\[([\w-]+)(?:([~^$*]?=)["']?([^"'\]]*)["']?)?\]$/.exec(t); if (!a) return false; const v = el.getAttribute(a[1]); ok = ok && v !== null && (!a[2] || (a[2] === '=' ? v === a[3] : a[2] === '^=' ? v.startsWith(a[3]) : a[2] === '*=' ? v.includes(a[3]) : a[2] === '$=' ? v.endsWith(a[3]) : v.split(/\s+/).includes(a[3]))); }
      else if (t[0] === ':') { if (/^:not\(/.test(t)) ok = ok && !matchCompound(el, t.slice(5, -1)); else if (t === ':root') ok = ok && el === doc.documentElement; else if (t === ':disabled') ok = ok && !!el.disabled; else return false; }
      else ok = ok && el.tagName === t.toUpperCase();
    }
    return ok;
  }
  function matchComplex(el, sel) {
    const parts = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const step = (node, i) => {
      if (!matchCompound(node, parts[i])) return false;
      if (i === 0) return true;
      if (parts[i - 1] === '>') return node.parentNode && node.parentNode.attrs ? step(node.parentNode, i - 2) : false;
      for (let p = node.parentNode; p && p.attrs; p = p.parentNode) if (step(p, i - 1)) return true;
      return false;
    };
    return step(el, parts.length - 1);
  }
  function parseInto(root, src) {
    src = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
    const stack = [root];
    const re = /<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1]) { const t = m[1].toUpperCase(); for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === t) { stack.length = i; break; } continue; }
      if (m[2]) {
        const el = new Node(m[2]);
        const ar = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
        while ((a = ar.exec(m[3] || ''))) el.attrs[a[1].toLowerCase()] = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&amp;/g, '&');
        if ('value' in el.attrs) el.value = el.attrs.value;
        if ('checked' in el.attrs) el.checked = true;
        if ('disabled' in el.attrs) el.disabled = true;
        if (el.attrs.style) el.attrs.style.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) { const k = d.slice(0, i).trim(); const v = d.slice(i + 1).trim(); el.style._p[k] = v; el.style[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v; } });
        top.appendChild(el);
        const tl = m[2].toLowerCase();
        if (tl === 'script' || tl === 'style' || tl === 'textarea') {
          const end = src.toLowerCase().indexOf('</' + tl, re.lastIndex);
          const body = src.slice(re.lastIndex, end < 0 ? src.length : end);
          if (body) el.appendChild(text(body));
          if (tl === 'textarea') el.value = body;
          re.lastIndex = end < 0 ? src.length : src.indexOf('>', end) + 1;
        } else if (!m[4] && !VOID.has(tl)) stack.push(el);
        continue;
      }
      if (m[5] && m[5].trim()) top.appendChild(text(m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')));
    }
  }
  const doc = new Node('#doc');
  doc._ls = {};
  doc.readyState = 'complete';
  doc.createElement = (t) => new Node(t);
  doc.createTextNode = (s) => text(s);
  doc.createEvent = () => new Ev('x');
  doc.execCommand = () => false;
  parseInto(doc, html);
  doc.documentElement = doc.children.find((n) => n.tagName === 'HTML') || doc.appendChild(new Node('html'));
  doc.head = doc.documentElement.querySelector('head') || doc.documentElement.appendChild(new Node('head'));
  doc.body = doc.documentElement.querySelector('body') || doc.documentElement.appendChild(new Node('body'));
  doc.activeElement = doc.body;
  doc.getElementById = (id) => doc.querySelector('#' + CSS_ESC(id));
  const CSS_ESC = (s) => String(s).replace(/([^\w-])/g, '\\$1');
  return { doc, Event: Ev, Node };
}

// ---- tiny cascade: which declarations from the shipped stylesheet land on an element
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (src, media) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (/^@media/.test(head)) walk(body, head.replace(/^@media\s*/, ''));
      else if (!/^@/.test(head)) {
        const decl = {};
        body.split(';').forEach((d) => { const k = d.indexOf(':'); if (k > 0) decl[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
        head.split(',').forEach((s) => rules.push({ sel: s.trim(), decl, media }));
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}
function mediaOk(media, width) {
  if (!media) return true;
  const mx = /max-width:\s*(\d+)px/.exec(media); const mn = /min-width:\s*(\d+)px/.exec(media);
  if (mx && width > +mx[1]) return false;
  if (mn && width < +mn[1]) return false;
  return true;
}
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!not)[\w-]+/g) || []).length;
  const tags = (sel.replace(/[#.][\w-]+|\[[^\]]+\]|:[\w-]+/g, ' ').match(/\b[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + cls * 100 + tags;
}
// computed(el, rules, {width}) -> {prop: value} after cascade (specificity, then order; inline style last).
function computed(el, rules, opts) {
  const width = (opts && opts.width) || 1024;
  const hits = [];
  rules.forEach((r, i) => {
    if (!mediaOk(r.media, width)) return;
    const sel = r.sel.replace(/::?(before|after|placeholder|hover|focus|active|focus-visible)\b.*$/, '');
    if (sel !== r.sel) return;
    let ok = false;
    try { ok = el.matches(sel); } catch (e) { ok = false; }
    if (ok) hits.push({ s: specificity(sel), i, decl: r.decl });
  });
  hits.sort((a, b) => a.s - b.s || a.i - b.i);
  const out = {};
  hits.forEach((h) => Object.keys(h.decl).forEach((k) => { out[k] = h.decl[k].replace(/\s*!important$/, ''); }));
  Object.keys(el.style._p || {}).forEach((k) => { out[k] = el.style._p[k]; });
  return out;
}
// Is the element shown? display:none on itself or any ancestor hides it.
function shown(el, rules, opts) {
  for (let n = el; n && n.attrs; n = n.parentNode) {
    if (n.hidden) return false;
    const d = computed(n, rules, opts).display;
    if (d === 'none') return false;
    if (n.style && n.style.display === 'none') return false;
  }
  return true;
}
const px = (v) => { const m = /(-?[\d.]+)px/.exec(String(v || '')); return m ? +m[1] : (/(-?[\d.]+)rem/.test(String(v || '')) ? +/(-?[\d.]+)rem/.exec(v)[1] * 16 : NaN); };

function mockDb(seed) {
  const rows = {};
  const subs = [];
  const puts = [];
  (seed || []).forEach((r) => { rows[r.id] = JSON.parse(JSON.stringify(r)); });
  const all = () => Object.keys(rows).map((k) => JSON.parse(JSON.stringify(rows[k])));
  return {
    rows, puts,
    put(r) { puts.push(JSON.parse(JSON.stringify(r))); rows[r.id] = JSON.parse(JSON.stringify(r)); subs.forEach((cb) => cb(all())); return Promise.resolve(r); },
    get(id) { return Promise.resolve(rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null); },
    getAll() { return Promise.resolve(all()); },
    delete(id) { delete rows[id]; return Promise.resolve(true); },
    subscribe(cb) { subs.push(cb); cb(all()); },
  };
}

// Fake Web Audio: every oscillator remembers its type, pitch and start time.
function fakeAudio(clock) {
  const oscs = [];
  const param = (v) => ({ value: v, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  function AC() {
    this.destination = {};
    this.state = 'running';
    Object.defineProperty(this, 'currentTime', { get: () => clock.now / 1000 });
    this.createGain = () => { const g = { gain: param(1), connect() {} }; AC.gains.push(g); return g; };
    this.createOscillator = () => {
      const o = { type: 'sine', frequency: param(440), connect() {}, start(t) { o.at = t; }, stop(t) { o.end = t; } };
      oscs.push(o);
      return o;
    };
    this.createBuffer = () => ({});
    this.createBufferSource = () => ({ connect() {}, start() {} });
    this.resume = () => Promise.resolve();
  }
  AC.oscs = oscs;
  AC.gains = [];
  return AC;
}

function fakeTimers(clock) {
  let seq = 0;
  const q = [];
  const add = (fn, ms, every) => { const id = ++seq; q.push({ id, at: clock.now + Math.max(0, ms || 0), fn, every }); return id; };
  const clear = (id) => { const i = q.findIndex((t) => t.id === id); if (i >= 0) q.splice(i, 1); };
  return {
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms || 1)),
    clearTimeout: clear,
    clearInterval: clear,
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = q[0];
        if (!t || t.at > end) break;
        clock.now = t.at;
        if (t.every) t.at += t.every; else q.shift();
        t.fn();
      }
      clock.now = end;
    },
  };
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// Boot the page the way index.html does: mp.js, then app.js.
async function boot(opts) {
  opts = opts || {};
  const { doc, Event } = miniDom(html);
  const clock = { now: 1_000_000 };
  const timers = fakeTimers(clock);
  const AC = fakeAudio(clock);
  const save = mockDb(opts.saveRows);
  const room = mockDb();
  const spy = { mic: 0, fetch: 0, invite: 0 };
  let backFn = null;
  const sandbox = {
    console, Math, Object, Array, JSON, String, Number, Boolean, Promise, Error,
    Date: { now: () => clock.now },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    document: doc,
    AudioContext: AC,
    navigator: { mediaDevices: { getUserMedia() { spy.mic++; return Promise.reject(new Error('no')); } } },
    fetch() { spy.fetch++; return Promise.reject(new Error('offline')); },
    XMLHttpRequest: function () { spy.fetch++; },
    WebSocket: function () { spy.fetch++; },
    gifos: {
      db: (n) => (n === 'save' ? save : n === 'room' ? room : null),
      me: () => Promise.resolve({ id: opts.guest ? 'guest-1' : 'host-1', name: 'Player' }),
      info: () => Promise.resolve({ owner: !opts.guest, appId: 'metronome' }),
      onBack: (fn) => { backFn = fn; },
      launch: () => Promise.resolve(opts.launch || null),
      invite: () => { spy.invite++; },
      share: () => { spy.invite++; },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const winLs = {};
  sandbox.addEventListener = (t, fn) => { (winLs[t] = winLs[t] || []).push(fn); };
  sandbox.removeEventListener = () => {};
  // Window keydown: events that bubble out of the document reach the window.
  doc._ls.keydown = [(e) => (winLs.keydown || []).forEach((f) => f(e))];
  vm.createContext(sandbox);
  const scripts = doc.querySelectorAll('script[src]').map((s) => s.getAttribute('src'));
  for (const f of scripts) vm.runInContext(src(f), sandbox, { filename: f });
  await flush();
  const $ = (id) => doc.getElementById(id);
  const P = {
    doc, $, clock, timers, AC, save, room, spy, sandbox,
    get back() { return backFn; },
    tick(ms) { timers.advance(ms); },
    async settle(ms) { await flush(); timers.advance(ms || 0); await flush(); },
    bpm: () => Number($('bpm').textContent),
    beatsLit: () => $('beats').children.map((s) => s.className),
    pend: () => $('pendArm').style.getPropertyValue('--pend'),
    click: (el) => el.click(),
    key: (code, target) => {
      const e = new Event('keydown', { code, target: target || doc.body });
      (target || doc.body).dispatchEvent(e);
      return e;
    },
    pointer: (el, type) => el.dispatchEvent(new Event(type, { button: 0 })),
    input: (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); },
    // Oscillators started in [from, to) on the audio clock, sorted.
    starts(from) { return AC.oscs.filter((o) => o.at >= (from || 0)).map((o) => o.at).sort((a, b) => a - b); },
    // Distinct click times (one click = 1 or 2 oscillators at the same instant).
    clicks(from) { const t = []; P.starts(from).forEach((x) => { if (!t.length || Math.abs(t[t.length - 1] - x) > 1e-9) t.push(x); }); return t; },
    lastSave: () => save.rows.last || null,
  };
  return P;
}
const gaps = (t) => t.slice(1).map((x, i) => x - t[i]);
const allNear = (arr, v) => arr.length > 0 && arr.every((x) => Math.abs(x - v) < 1e-6);

const rules = cssRules(css);
const locked = (el) => { for (let n = el; n && n.attrs; n = n.parentNode) if (computed(n, rules).pointerEvents === 'none' || computed(n, rules)['pointer-events'] === 'none') return true; return false; };

(async () => {
  // ---- the page loads only its own files, as classic scripts --------------
  {
    const { doc } = miniDom(html);
    const refs = doc.querySelectorAll('[src],[href]').map((e) => e.getAttribute('src') || e.getAttribute('href'));
    check('every src/href in the page is a file shipped beside it',
      refs.length >= 3 && refs.every((r) => !/^[a-z]+:|^\/\//i.test(r) && fs.existsSync(path.join(APP, r))), refs);
    check('classic scripts only (each one runs in a plain vm)',
      doc.querySelectorAll('script').every((s) => s.getAttribute('type') !== 'module') && !!sandbox.MetronomeApp);
  }

  // ---- Start: Web Audio clicks on the lookahead clock ----------------------
  {
    const P = await boot();
    check('the page boots with its tempo readout and pendulum', P.bpm() === 120 && !!P.$('pendArm'));
    const t0 = P.clock.now / 1000;
    P.click(P.$('playBtn'));
    check('Start schedules Web Audio oscillators', P.AC.oscs.length > 0, P.AC.oscs.length);
    check('lookahead: nothing is scheduled past currentTime + SCHEDULE_AHEAD',
      P.starts().every((t) => t <= t0 + M.SCHEDULE_AHEAD + 1e-9), P.starts());
    check('notes are not painted when scheduled, only when they play',
      P.beatsLit().length === 4 && P.beatsLit().every((c) => !/\bon\b/.test(c)), P.beatsLit());
    const pend0 = P.pend();
    P.tick(70);
    check('the downbeat lights when audio.currentTime reaches it',
      /\bon\b/.test(P.beatsLit()[0]) && /accent/.test(P.beatsLit()[0]), P.beatsLit());
    check('the pendulum moves with the audio clock', !!P.pend() && P.pend() !== pend0, [pend0, P.pend()]);
    P.tick(2000);
    const c = P.clicks();
    check('120 BPM 4/4 plays clicks every 0.5s on the audio clock', c.length >= 4 && allNear(gaps(c), 0.5), gaps(c));
    check('the scheduler keeps no more than SCHEDULE_AHEAD ahead of the clock',
      P.starts().every((t) => t <= P.clock.now / 1000 + M.SCHEDULE_AHEAD + 1e-9));
    const lit = P.beatsLit().findIndex((x) => /\bon\b/.test(x));
    const played = c.filter((t) => t <= P.clock.now / 1000).length;
    check('the lit beat is the last click that played, not the last one scheduled', lit === (played - 1) % 4, [lit, played]);
    check('default sound is the wood click (square tick + triangle body)',
      P.AC.oscs.some((o) => o.type === 'square') && P.AC.oscs.some((o) => o.type === 'triangle'));
    check('no microphone is ever requested while playing', P.spy.mic === 0);
    check('nothing is fetched while playing', P.spy.fetch === 0);

    // Back stops the click; Back when stopped is not consumed.
    check('Back is registered with gifos.onBack', typeof P.back === 'function');
    const consumed = P.back();
    const n = P.AC.oscs.length;
    P.tick(2000);
    check('Back while playing stops the click and consumes Back', consumed === true && P.AC.oscs.length === n, [consumed, P.AC.oscs.length - n]);
    check('stopped: pendulum rests and no beat is lit',
      P.$('pendArm').classList.contains('rest') && P.beatsLit().every((x) => !/\bon\b/.test(x)));
    check('Back when stopped falls through to the OS', P.back() === false);
  }

  // ---- Space starts and stops; a focused button keeps its own Space --------
  {
    const P = await boot();
    const e = P.key('Space');
    P.tick(300);
    const n = P.AC.oscs.length;
    check('Space starts the click', n > 0 && e.defaultPrevented);
    P.key('Space');
    P.tick(1000);
    check('Space again stops it', P.AC.oscs.length === n);
    P.key('Space', P.$('tapBtn'));
    P.tick(500);
    check('Space on a focused button does not double-toggle', P.AC.oscs.length === n);
    P.key('ArrowUp');
    check('ArrowUp bumps the tempo by 1', P.bpm() === 121, P.bpm());
  }

  // ---- phone −/+ step, hold repeats, and the tempo lands in the private save
  {
    const P = await boot();
    const down = P.$('tempoDown');
    const up = P.$('tempoUp');
    check('phone − / + controls exist', !!(down && up && down.tagName === 'BUTTON' && up.tagName === 'BUTTON'));
    P.pointer(up, 'pointerdown'); P.pointer(up, 'pointerup');
    check('+ raises the tempo by 1', P.bpm() === 121, P.bpm());
    P.pointer(down, 'pointerdown');
    P.tick(380 + 80 * 5);
    P.pointer(down, 'pointerup');
    const held = P.bpm();
    P.tick(1000);
    check('holding − repeats, letting go stops', held === 121 - 1 - 5 && P.bpm() === held, [held, P.bpm()]);
    P.tick(300);
    const row = P.lastSave();
    check('private save gets {id: last} with the tempo', !!row && row.id === 'last' && row.tempo === held, row);
    check('volume is kept in the private save', row && row.vol === 80);
    const roomRow = P.room.rows.shared;
    check('the room snapshot carries the tempo', !!roomRow && roomRow.tempo === held, roomRow);
    check('volume is not in the room snapshot', roomRow && !('vol' in roomRow), roomRow);
  }

  // ---- 1.0 save (tempo, sig, vol only) still opens on its numbers ----------
  {
    const P = await boot({ saveRows: [{ id: 'last', tempo: 88, sig: '3/4', vol: 40 }] });
    P.click(P.$('playBtn'));
    P.tick(3000);
    const c = P.clicks();
    check('1.0 save restores the tempo', P.bpm() === 88, P.bpm());
    check('1.0 save restores 3/4 (three beat lights)', P.beatsLit().length === 3, P.beatsLit());
    check('1.0 save restores the volume', P.$('vol').value == 40 && P.AC.gains[0].gain.value === 0.4, P.$('vol').value);
    check('missing subdiv defaults to the beat (60/88 s apart)', allNear(gaps(c), 60 / 88), gaps(c));
    check('missing sound defaults to the wood click', P.AC.oscs.some((o) => o.type === 'square'));
    const accents = P.AC.oscs.filter((o) => o.type === 'square' && o.frequency.value === 1900).length;
    check('3/4: one accent per three clicks', accents > 0 && Math.abs(accents - c.length / 3) <= 1, [accents, c.length]);
  }

  // ---- reopen: the tempo comes back ----------------------------------------
  {
    const A = await boot();
    A.click(A.$('marks').querySelector('[data-mark="Andante"]'));
    A.tick(300);
    const saved = A.lastSave();
    check('a tempo-mark tap sets its bpm', !!saved && saved.tempo === 92, saved);
    const B = await boot({ saveRows: saved ? [saved] : [] });
    check('the tempo comes back the next time the app opens', B.bpm() === 92, B.bpm());
  }

  // ---- subdivision, signature and sound chips -------------------------------
  {
    const P = await boot();
    P.click(P.$('subs').querySelector('[data-sub="8th"]'));
    P.click(P.$('playBtn'));
    P.tick(1500);
    check('8ths chip: clicks every 0.25s at 120', allNear(gaps(P.clicks()), 0.25), gaps(P.clicks()));
    P.click(P.$('playBtn'));
    const q = await boot();
    q.click(q.$('subs').querySelector('[data-sub="trip"]'));
    q.click(q.$('playBtn'));
    q.tick(1500);
    check('triplets chip: clicks every 1/6 s at 120', allNear(gaps(q.clicks()), 1 / 6), gaps(q.clicks()));
    q.tick(300);
    check('the subdivision is saved', q.lastSave() && q.lastSave().subdiv === 'trip', q.lastSave());

    const s = await boot();
    s.click(s.$('sigs').querySelector('[data-sig="6/8"]'));
    s.click(s.$('playBtn'));
    s.tick(2000);
    check('6/8 chip: six beat lights', s.beatsLit().length === 6, s.beatsLit());
    check('6/8 chip: eighths every 0.25s at 120', allNear(gaps(s.clicks()), 0.25), gaps(s.clicks()));

    const b = await boot();
    b.click(b.$('sounds').querySelector('[data-sound="beep"]'));
    b.click(b.$('playBtn'));
    b.tick(1200);
    const types = new Set(b.AC.oscs.map((o) => o.type));
    const freqs = new Set(b.AC.oscs.map((o) => o.frequency.value));
    check('beep chip: Wilson sine beeps (880 accent, 440 beat)', types.size === 1 && types.has('sine') && freqs.has(880) && freqs.has(440), [...types, ...freqs]);
    b.click(b.$('playBtn'));
    const n = b.AC.oscs.length;
    b.click(b.$('sounds').querySelector('[data-sound="click"]'));
    b.click(b.$('playBtn'));
    b.tick(600);
    check('click chip: back to the wood click', b.AC.oscs.slice(n).some((o) => o.type === 'square'));
  }

  // ---- tap tempo -----------------------------------------------------------
  {
    const P = await boot();
    const tap = P.$('tapBtn');
    for (let i = 0; i < 4; i++) { P.click(tap); P.tick(500); }
    check('tap tempo: four taps 500ms apart set 120', P.bpm() === 120, P.bpm());
    P.tick(2500);
    for (let i = 0; i < 4; i++) { P.click(tap); P.tick(i < 3 ? 750 : 0); }
    check('tap tempo: taps 750ms apart set 80', P.bpm() === 80, P.bpm());
    P.tick(300);
    check('tapped tempo is saved', P.lastSave() && P.lastSave().tempo === 80);
  }

  // ---- launch link opens on a tempo ----------------------------------------
  {
    const P = await boot({ launch: { bpm: '96', sig: '2/4' } });
    check('launch {bpm, sig} opens on that tempo and signature', P.bpm() === 96 && P.beatsLit().length === 2, [P.bpm(), P.beatsLit().length]);
  }

  // ---- Invite is OS chrome: no in-app control reaches a share/invite API ----
  {
    const P = await boot();
    P.doc.querySelectorAll('button').forEach((b) => b.click());
    P.tick(1000);
    check('no in-app button invites or shares (Invite is OS chrome)', P.spy.invite === 0);
    check('the meeting status line is filled for a solo host', P.$('meet').textContent.trim().length > 0);
  }

  // ---- guest: read-only numbers, local volume ------------------------------
  {
    const host = await boot();
    const G = await boot({ guest: true });
    check('a guest gets body.guest', G.doc.body.classList.contains('guest'));
    check('guest status differs from the host status', G.$('meet').textContent !== host.$('meet').textContent && G.$('meet').classList.contains('live'));
    G.pointer(G.$('tempoUp'), 'pointerdown'); G.pointer(G.$('tempoUp'), 'pointerup');
    G.click(G.$('tapBtn')); G.tick(500); G.click(G.$('tapBtn'));
    check('a guest cannot change the tempo', G.bpm() === 120, G.bpm());
    check('guest tempo slider is locked by the stylesheet', locked(G.$('tempo')));
    check('guest volume slider is NOT locked by the stylesheet', !locked(G.$('vol')));
    G.click(G.$('playBtn'));
    G.input(G.$('vol'), 25);
    check('a guest can still turn the local volume', Math.abs(G.AC.gains[0].gain.value - 0.25) < 1e-9, G.AC.gains[0].gain.value);
    G.tick(500);
    check('a guest never writes the private save', G.save.puts.length === 0, G.save.puts);
    G.sandbox.MetroMp.publish();
    check('a guest never writes the room (publish is a no-op for a guest)', G.room.puts.length === 0, G.room.puts);
  }

  // ---- phone tap targets (stylesheet cascade on the real elements) ---------
  {
    const P = await boot();
    const start = computed(P.$('playBtn'), rules);
    check('Start is at least 52px tall', px(start['min-height'] || start.height) >= 52, start);
    for (const id of ['tempoDown', 'tempoUp']) {
      const s = computed(P.$(id), rules);
      check(id + ' step button is at least 56px square', px(s['min-width']) >= 56 && px(s['min-height']) >= 56, s);
    }
  }

  // TEXT-CHECK: an absence guarantee over every code path, including ones no
  // test drives; a spy only covers the paths this suite plays.
  check('no live microphone API anywhere in the shipped code', !/getUserMedia|mediaDevices|recordAudio|createMediaStreamSource/.test(app + html + mp));

  // ---- docs and listing data -----------------------------------------------
  check('help.md is a real page', help.length >= 400);
  check('listing credits cwilso', listing.author && listing.author.name === 'cwilso');
  check('listing is an unofficial port', listing.basedOn && listing.basedOn.blessed === false);
  check('no mic in the manifest', !manifest.capabilities.microphone && !manifest.capabilities.network);
  check('save is private, room is read-only',
    manifest.data.save.visibility === 'private' && manifest.data.room.visibility === 'read-only');
  check('launch can open on a tempo', !!(manifest.launch && manifest.launch.bpm && manifest.launch.sig));

  if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exit(1);
  }
  console.log('\n' + 'all PASS');
})().catch((e) => { console.error(e); process.exit(1); });
