// CRON SPEAK HAS TO TRANSLATE, NOT JUST WRAP THE LIBRARY.
//
// A five-field expression becomes English, an invalid one is an honest error,
// next fire times are real clock times, and the last expression is what the
// file keeps. The UI (field pills, empty state, Invite-is-OS-chrome) is
// pinned by source scan — a vm cannot tap a chip.
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
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  for (const f of ['vendor/cronstrue.js', 'cron.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const S = load();
check('cronstrue + CronTalk + CronSpeak load', !!(S.cronstrue && S.CronTalk && S.CronSpeak && S.CronSpeak.speak));

const speak = S.CronSpeak.speak;
const Talk = S.CronTalk;

{
  const a = speak('0 0 * * *', {});
  check('midnight speaks', /12:00 AM|midnight/i.test(a), a);
  const b = speak('*/5 * * * *', {});
  check('every 5 minutes', /every 5 minutes/i.test(b), b);
  const c = speak('0 9 * * 1-5', { h24: true });
  check('weekday 09:00 in 24h', /09:00|9:00/.test(c), c);
  const d = speak('0 9 * * 1-5', { h24: false });
  check('weekday 9:00 AM', /9:00 AM/i.test(d), d);
  const e = speak('@hourly', {});
  check('@hourly is every hour', /every hour/i.test(e), e);
  const f = speak('@daily', {});
  check('@daily is midnight', /12:00 AM|midnight|every day/i.test(f), f);
  const fv = speak('@daily', { verbose: true });
  check('@daily verbose mentions every day', /every day/i.test(fv), fv);
}

{
  let msg = null;
  try { speak('99 * * * *', {}); } catch (e) { msg = String(e && e.message || e); }
  check('minute 99 throws', !!msg, msg);
  check('minute 99 names the range or the field', /minute|0 and 59|0-59/i.test(msg || ''), msg);

  msg = null;
  try { speak('0 0 * *', {}); } catch (e) { msg = String(e && e.message || e); }
  check('four fields throws', !!msg, msg);
  const human = Talk.humanError(new Error(msg), '0 0 * *');
  check('four fields is a five-field reminder', /five fields/i.test(human), human);

  msg = null;
  try { speak('@nope', {}); } catch (e) { msg = String(e && e.message || e); }
  check('unknown special throws', !!msg, msg);
  check('unknown special is honest', /special/i.test(Talk.humanError(new Error(msg), '@nope')), msg);

  check('empty is a type-it prompt, not a stack', Talk.humanError(new Error('cron expression is empty'), '') === 'Type a cron expression.');
  check('@reboot is next boot, not a clock', /boot/i.test(Talk.humanError(new Error('x'), '@reboot')));
}

{
  const p = Talk.parse('0 9 * * 1-5');
  check('five fields parsed', p.fields && p.fields.length === 5);
  check('hour field is 9', p.fields[1].value === '9', p.fields && p.fields[1]);
  check('dow field is 1-5', p.fields[4].value === '1-5');
  check('minute phrase for */5', Talk.phrase('*/5') === 'every 5');
  check('star phrase is every', Talk.phrase('*') === 'every');
}

{
  const from = new Date(2026, 7, 24, 8, 0, 0, 0); // Mon 24 Aug 2026 08:00 local
  const n = Talk.nextTimes('0 9 * * 1-5', from, 3);
  check('weekday 9am yields 3 times', n.times && n.times.length === 3, n);
  if (n.times && n.times[0]) {
    check('first fire is today 09:00', n.times[0].getDate() === 24 && n.times[0].getHours() === 9 && n.times[0].getMinutes() === 0,
      { d: n.times[0].toString() });
    check('second fire is Tuesday 09:00', n.times[1].getDate() === 25 && n.times[1].getHours() === 9,
      { d: n.times[1].toString() });
  }
  const later = new Date(2026, 7, 24, 10, 0, 0, 0);
  const n2 = Talk.nextTimes('0 9 * * 1-5', later, 1);
  check('after 9am, next is Tuesday', n2.times[0] && n2.times[0].getDate() === 25, n2.times[0] && n2.times[0].toString());

  const fri = new Date(2026, 7, 28, 10, 0, 0, 0); // Friday after 9
  const n3 = Talk.nextTimes('0 9 * * 1-5', fri, 1);
  check('Friday after 9 → Monday', n3.times[0] && n3.times[0].getDay() === 1 && n3.times[0].getHours() === 9,
    n3.times[0] && n3.times[0].toString());

  const ev = Talk.nextTimes('*/5 * * * *', new Date(2026, 7, 24, 12, 1, 0, 0), 2);
  check('every 5 min: 12:05 then 12:10',
    ev.times[0] && ev.times[0].getMinutes() === 5 && ev.times[1] && ev.times[1].getMinutes() === 10,
    ev.times.map((d) => d.getMinutes()));

  const daily = Talk.nextTimes('@daily', new Date(2026, 7, 24, 0, 1, 0, 0), 1);
  check('@daily next is tomorrow midnight', daily.times[0] && daily.times[0].getDate() === 25 && daily.times[0].getHours() === 0,
    daily.times[0] && daily.times[0].toString());

  const first = Talk.nextTimes('0 0 1 * *', new Date(2026, 7, 24, 12, 0, 0, 0), 1);
  check('1st of month from Aug 24 is Sep 1', first.times[0] && first.times[0].getMonth() === 8 && first.times[0].getDate() === 1,
    first.times[0] && first.times[0].toString());

  const rb = Talk.nextTimes('@reboot', new Date(), 1);
  check('@reboot is flagged, no clock times', rb.reboot === true && rb.times.length === 0);
}

{
  // Both DOM and DOW restricted → OR (Vixie). 0 0 1 * 1 = 1st of month OR Mondays.
  const from = new Date(2026, 7, 24, 0, 1, 0, 0); // Monday after midnight
  const n = Talk.nextTimes('0 0 1 * 1', from, 4);
  check('DOM|DOW OR yields times', n.times.length === 4);
  const days = n.times.map((d) => d.getDay());
  const dates = n.times.map((d) => d.getDate());
  check('OR includes a Monday', days.some((d) => d === 1), { days, dates });
  check('OR includes the 1st', dates.some((d) => d === 1), { days, dates });
}

{
  let threw = false;
  try { Talk.parse('99 * * * *'); } catch (e) { threw = true; check('parse 99 is out of range', /range/i.test(e.message), e.message); }
  check('parse 99 throws', threw);
  threw = false;
  try { Talk.parse(''); } catch (e) { threw = true; }
  check('parse empty throws', threw);
}

// ============================================================================
// PLAY THE PAGE. index.html is parsed into a tiny DOM; its scripts run in a vm
// with fake timers and a fake gifos, and the suite types into #expr and taps
// the real chips, pills and buttons.
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

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
const help = fs.readFileSync(path.join(APP, 'help.md'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
const rules = cssRules(css);

async function boot(opts) {
  opts = opts || {};
  const { doc, Event } = miniDom(html);
  const clock = { now: 5_000_000 };
  const timers = fakeTimers(clock);
  const save = mockDb(opts.saveRows);
  const room = mockDb();
  const spy = { invite: 0, fetch: 0, clip: [] };
  let backFn = null;
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, RegExp, Promise,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    document: doc,
    navigator: { clipboard: { writeText(t) { spy.clip.push(t); return Promise.resolve(); } } },
    fetch() { spy.fetch++; return Promise.reject(new Error('offline')); },
    gifos: {
      db: (n) => (n === 'save' ? save : n === 'room' ? room : null),
      me: () => Promise.resolve({ id: opts.guest ? 'guest-1' : 'host-1', name: 'Player' }),
      info: () => Promise.resolve({ owner: !opts.guest, appId: 'cron-speak' }),
      onBack: (fn) => { backFn = fn; },
      launch: () => Promise.resolve(opts.launch || null),
      invite: () => { spy.invite++; },
      share: () => { spy.invite++; },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  for (const f of doc.querySelectorAll('script[src]').map((s) => s.getAttribute('src'))) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  await flush();
  const $ = (id) => doc.getElementById(id);
  const shownEl = (id) => shown($(id), rules);
  const P = {
    doc, $, save, room, spy, sandbox, timers,
    get back() { return backFn; },
    tick(ms) { timers.advance(ms); },
    shown: shownEl,
    type(v) { $('expr').value = v; $('expr').dispatchEvent(new Event('input')); },
    toggle(id) { $(id).checked = !$(id).checked; $(id).dispatchEvent(new Event('change')); },
    blur() { $('expr').blur(); },
    pills: () => $('fields').children,
    next: () => $('next').children.map((li) => li.textContent),
  };
  return P;
}

(async () => {
  // ---- the page loads only its own files, as classic scripts ---------------
  {
    const { doc } = miniDom(html);
    const refs = doc.querySelectorAll('[src],[href]').map((e) => e.getAttribute('src') || e.getAttribute('href'));
    check('every src/href in the page is a file shipped beside it',
      refs.length >= 4 && refs.every((r) => !/^[a-z]+:|^\/\//i.test(r) && fs.existsSync(path.join(APP, r))), refs);
    check('classic scripts, no type=module (each runs in a plain vm)',
      doc.querySelectorAll('script').every((s) => s.getAttribute('type') !== 'module') && !!S.CronSpeak);
    // TEXT-CHECK: the viewport meta is read only by a real browser; no vm can apply it.
    const vp = doc.querySelector('meta[name="viewport"]');
    check('viewport-fit for the phone notch', !!vp && /viewport-fit=cover/.test(vp.getAttribute('content')));
  }

  // ---- type an expression: English, field pills, next times ----------------
  {
    const P = await boot();
    P.type('0 9 * * 1-5');
    check('a valid expression shows the English and hides empty/error',
      P.shown('out') && P.$('out').textContent === speak('0 9 * * 1-5', {}) && !P.shown('empty') && !P.shown('err'));
    check('field pills: one per field', P.shown('fields') && P.pills().length === 5, P.pills().length);
    check('next times: five clock times are listed', P.shown('nextWrap') && P.next().length === 5, P.next());
    const want = Talk.nextTimes('0 9 * * 1-5', new Date(), 5).times.map((d) => Talk.formatStamp(d, false));
    check('the listed next times are the computed fire times', JSON.stringify(P.next()) === JSON.stringify(want), [P.next(), want]);
    P.toggle('h24');
    check('24-hour toggle re-speaks the sentence', P.$('out').textContent === speak('0 9 * * 1-5', { h24: true }));

    P.pills()[1].click();
    check('tapping a pill opens its hint and suggestions', P.shown('fieldHint') && P.shown('suggest') && P.$('suggest').children.length > 0);
    const sug = P.$('suggest').children[0];
    const v = sug.textContent;
    sug.click();
    check('a suggestion rewrites that field of the expression', P.$('expr').value.split(' ')[1] === v && P.$('expr').value.split(' ')[0] === '0', P.$('expr').value);
    check('Back with a pill open closes it and consumes Back', typeof P.back === 'function' && P.shown('fieldHint') && P.back() === true && !P.shown('fieldHint'));
    check('Back with nothing open falls through to the OS', P.back() === false);

    P.$('copyEn').click();
    P.$('copyEx').click();
    await flush();
    check('Copy English and Copy expression write the clipboard',
      P.spy.clip[0] === P.$('out').textContent && P.spy.clip[1] === P.$('expr').value.trim(), P.spy.clip);
  }

  // ---- empty and error states ----------------------------------------------
  {
    const P = await boot();
    P.type('');
    check('empty state: the empty hint shows, nothing else', P.shown('empty') && !P.shown('out') && !P.shown('err') && !P.shown('fields') && !P.shown('nextWrap'));
    P.type('99 * * * *');
    check('an invalid expression shows the error node, no English, no next times',
      P.shown('err') && P.$('err').textContent.length > 0 && !P.shown('out') && !P.shown('nextWrap') && !P.shown('copyEn'));
    P.type('@reboot');
    check('@reboot speaks and notes next boot instead of clock times', P.shown('out') && P.next().length === 0 && P.shown('nextNote') && P.$('nextNote').textContent.length > 0);
  }

  // ---- chips and history, saved privately ----------------------------------
  {
    const P = await boot();
    const chips = P.$('chips').children;
    check('quick chips are there', chips.length >= 4, chips.length);
    const pick = chips.find((b) => b.textContent === '0 0 1 * *') || chips[2];
    pick.click();
    check('a chip loads its expression', P.$('expr').value === pick.textContent && P.$('out').textContent === speak(pick.textContent, {}));
    P.type('15 14 1 * *');
    P.blur();
    P.tick(300);
    const row = P.save.rows.last;
    check('the last expression is saved privately as {id: last}', !!row && row.expr === '15 14 1 * *', row);
    check('history is persisted', !!row && Array.isArray(row.history) && row.history.includes(pick.textContent) && row.history.includes('15 14 1 * *'), row && row.history);
    const B = await boot({ saveRows: row ? [row] : [] });
    check('reopen: the last expression comes back', B.$('expr').value === '15 14 1 * *' && B.shown('out'));
    const hist = B.$('hist').children;
    check('reopen: history chips come back', B.shown('hist') && hist.some((b) => b.textContent === pick.textContent));
    const h = hist.find((b) => b.textContent === pick.textContent);
    if (h) h.click();
    check('a history chip loads its expression', B.$('expr').value === pick.textContent);
  }

  // ---- launch link ---------------------------------------------------------
  {
    const P = await boot({ launch: { expr: '0 12 * * 0' } });
    await flush();
    check('launch {expr} opens on that expression', P.$('expr').value === '0 12 * * 0' && P.$('out').textContent === speak('0 12 * * 0', {}));
  }

  // ---- Invite is OS chrome; guest is read-only ------------------------------
  {
    const P = await boot();
    P.type('*/5 * * * *');
    P.tick(300);
    check('the host publishes the expression to the room', P.room.rows.shared && P.room.rows.shared.expr === '*/5 * * * *', P.room.rows.shared);
    P.doc.querySelectorAll('button').forEach((b) => b.click());
    check('no in-app button invites or shares (Invite is OS chrome)', P.spy.invite === 0 && P.spy.fetch === 0);
    check('the meeting status line is filled for a solo host', P.$('meet').textContent.trim().length > 0);

    const G = await boot({ guest: true });
    check('guest status differs from the host status', G.$('meet').textContent !== P.$('meet').textContent && G.$('meet').classList.contains('live'));
    G.room.put({ id: 'shared', expr: '0 0 * * *', h24: true, verbose: false, dow0: true });
    check('a guest sees the host expression', G.$('expr').value === '0 0 * * *' && G.$('out').textContent === speak('0 0 * * *', { h24: true }));
    G.type('1 1 1 1 1');
    G.$('chips').children[0].click();
    G.blur();
    G.tick(300);
    check('a guest cannot change it or write the save/room',
      G.$('out').textContent === speak('0 0 * * *', { h24: true }) && G.save.puts.length === 0 && G.room.puts.length === 1, [G.save.puts.length, G.room.puts.length]);
  }

  // ---- phone tap targets (stylesheet cascade on the real elements) ----------
  {
    const P = await boot();
    const chip = P.$('chips').children[0];
    const a = computed(chip, rules);
    const b = computed(P.$('copyEn'), rules);
    check('chips and copy buttons are 40px+ tap targets', px(a['min-height']) >= 40 && px(b['min-height']) >= 40, [a['min-height'], b['min-height']]);
  }

  check('launch.expr is declared', !!(manifest.launch && manifest.launch.expr));
  check('minBuild stays 947', manifest.minBuild === 947);
  check('save is private', manifest.data.save.visibility === 'private');
  check('room is read-only', manifest.data.room.visibility === 'read-only');
  check('help is a tool page, not empty', help.length > 400);

  if (failures) {
    console.log('\n' + failures + ' failed');
    process.exit(1);
  }
  console.log('\nAll PASS');
})().catch((e) => { console.error(e); process.exit(1); });
