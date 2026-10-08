// Yopass has to actually lock, open, and burn.
//
// Crypto is Web Crypto AES-GCM in crypto.js; room screens live in core.js.
// Both are classic IIFEs, so the suite loads the shipped source in a vm and
// PLAYS the loop: lock → unlock, wrong passphrase, empty secret, burn-after-
// read, expiry, guest waiting / already-burned. DOM-only rules (phone, copy,
// no in-app Invite) are source-scanned — a line that must stay is better
// guarded by a grep than by a browser suite that cannot launch.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function load() {
  const sandbox = {
    console,
    crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, TextDecoder, Uint8Array, Promise, Date, String, Number, Boolean, Object, Array,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['crypto.js', 'core.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

function src(name) {
  return fs.readFileSync(path.join(APP, name), 'utf8');
}

const S = load();
const Crypto = S.YopassCrypto;
const Core = S.YopassCore;

check('crypto.js and core.js attach', !!(Crypto && Crypto.lock && Crypto.unlock && Core && Core.makeRow && Core.screen));

const MAIN = [];

MAIN.push(async () => {
  const rec = await Crypto.lock('hello-secret', 'correct horse');
  check('passphrase lock sets hasPass + salt, not a raw key',
    !!(rec && rec.hasPass && rec.ct && rec.iv && rec.salt && !rec.key));
  const plain = await Crypto.unlock(rec, 'correct horse');
  check('passphrase lock/open roundtrips', plain === 'hello-secret', plain);

  let wrongMsg = '';
  try {
    await Crypto.unlock(rec, 'wrong');
    wrongMsg = 'did-not-throw';
  } catch (e) {
    wrongMsg = String(e && e.message || e);
  }
  check('wrong passphrase is honest', /wrong passphrase/i.test(wrongMsg), wrongMsg);

  let needMsg = '';
  try {
    await Crypto.unlock(rec, '');
    needMsg = 'did-not-throw';
  } catch (e) {
    needMsg = String(e && e.message || e);
  }
  check('empty passphrase on a locked secret is honest', /needs a passphrase/i.test(needMsg), needMsg);
});

MAIN.push(async () => {
  const rec = await Crypto.lock('plain-token', '');
  check('no-pass lock carries a key and not hasPass', !!(rec && !rec.hasPass && rec.key && rec.ct && rec.iv));
  const plain = await Crypto.unlock(rec, null);
  check('no-pass lock/open roundtrips', plain === 'plain-token', plain);

  const flipped = rec.ct.slice(0, 4) === 'AAAA' ? 'BBBB' + rec.ct.slice(4) : 'AAAA' + rec.ct.slice(4);
  let tamperMsg = '';
  try {
    await Crypto.unlock(Object.assign({}, rec, { ct: flipped }), null);
    tamperMsg = 'did-not-throw';
  } catch (e) {
    tamperMsg = String(e && e.message || e);
  }
  check('tampered ciphertext is refused', /bytes were changed|could not open/i.test(tamperMsg), tamperMsg);
});

MAIN.push(async () => {
  const rec = await Crypto.lock('密码🔐\nline two', 'sëcret');
  const plain = await Crypto.unlock(rec, 'sëcret');
  check('unicode secret + passphrase roundtrips', plain === '密码🔐\nline two', plain);
});

MAIN.push(async () => {
  check('empty string is empty', Core.isEmpty('') === true);
  check('whitespace-only is empty', Core.isEmpty('  \n\t') === true);
  check('a real secret is not empty', Core.isEmpty('x') === false);
  check('null is empty', Core.isEmpty(null) === true);
});

MAIN.push(async () => {
  const out = await Crypto.lock('api-key-123', 'pw');
  const now = 1_000;
  const row = Core.makeRow(out, { burn: true, lifetime: '1h' }, { id: 'host' }, now);
  check('makeRow keeps ciphertext and burn', !!(row.ct && row.burn && row.hasPass && row.id === 'secret'));
  check('1h lifetime stamps expiresAt', row.expiresAt === now + Core.LIFE_MS['1h'], row.expiresAt);
  check('status locked while the timer runs', Core.status(row, now) === 'locked');
  check('status expired when the timer runs out', Core.status(row, now + Core.LIFE_MS['1h']) === 'expired');
  check('owner sees locked', Core.screen(row, { id: 'host' }, true, now) === 'locked');
  check('guest sees open', Core.screen(row, { id: 'guest' }, false, now) === 'open');
  check('guest with nothing sees waiting', Core.screen(null, { id: 'guest' }, false, now) === 'waiting');
  check('owner with nothing sees home', Core.screen(null, { id: 'host' }, true, now) === 'home');
  const gone = Core.burnRow({ id: 'guest' }, now + 5);
  check('burn row is burned', gone.burned === true && gone.id === 'secret');
  check('guest after burn sees gone', Core.screen(gone, { id: 'guest' }, false, now + 5) === 'gone');
  check('owner after burn sees gone (not the lock form)', Core.screen(gone, { id: 'host' }, true, now + 5) === 'gone');
  check('expired secret is gone for a guest', Core.screen(row, { id: 'guest' }, false, now + Core.LIFE_MS['1h']) === 'gone');
  const until = Core.makeRow(out, { burn: false, lifetime: '' }, { id: 'host' }, now);
  check('until-burned has no expiresAt', !until.expiresAt);
  check('until-burned stays locked', Core.status(until, now + Core.LIFE_MS['1w'] * 4) === 'locked');
});

MAIN.push(async () => {
  // Play the host→guest→burn loop the way the app does: lock, guest unlocks, burn.
  const out = await Crypto.lock('the-db-password', '');
  const host = { id: 'host' };
  const guest = { id: 'guest' };
  const row = Core.makeRow(out, { burn: true, lifetime: '1d' }, host, 50);
  check('guest arriving after lock is on the open screen', Core.screen(row, guest, false, 50) === 'open');
  const text = await Crypto.unlock(row, null);
  check('guest unlocks the secret', text === 'the-db-password');
  const after = Core.burnRow(guest, 51);
  check('after a burn-after-read open, the room is gone', Core.status(after, 51) === 'burned');
  check('a late guest sees already burned, not waiting', Core.screen(after, { id: 'late' }, false, 80) === 'gone');
  const copy = Core.goneCopy(after, 80);
  check('already-burned copy is honest', /burned/i.test(copy.title) && /will not open again/i.test(copy.lede), copy);
});

// ============================================================================
// PLAY THE PAGE ON TWO DEVICES. index.html is parsed into a tiny DOM per
// device; crypto.js, core.js and app.js run in a vm with real Web Crypto, and
// both devices share one fake gifos room the way an Invite link joins them.
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

const html = src('index.html');
const css = src('style.css');
const manifest = JSON.parse(src('manifest.json'));
const rules = cssRules(css);
const tick = () => new Promise((r) => setImmediate(r));
async function until(fn, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { if (fn()) return true; await tick(); }
  return !!fn();
}

function sharedRoom() {
  const rows = {};
  const subs = [];
  const puts = [];
  const all = () => Object.keys(rows).map((k) => JSON.parse(JSON.stringify(rows[k])));
  return {
    rows, puts,
    put(r) { puts.push(JSON.parse(JSON.stringify(r))); rows[r.id] = JSON.parse(JSON.stringify(r)); const l = all(); setImmediate(() => subs.forEach((cb) => cb(l))); return Promise.resolve(r); },
    get(id) { return Promise.resolve(rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null); },
    getAll() { return Promise.resolve(all()); },
    delete(id) { delete rows[id]; return Promise.resolve(true); },
    subscribe(cb) { subs.push(cb); cb(all()); },
  };
}

async function device(room, opts) {
  opts = opts || {};
  const { doc, Event } = miniDom(html);
  const save = sharedRoom();
  const spy = { invite: 0, fetch: 0, clip: [], exec: [] };
  let backFn = null;
  const clock = { now: opts.now || 1_000_000 };
  const sandbox = {
    console, crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, TextDecoder, Uint8Array, Promise, String, Number, Boolean, Object, Array, Error, Math, JSON,
    Date: { now: () => clock.now },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    document: doc,
    navigator: {
      clipboard: opts.noClipboard ? null : { writeText(t) { spy.clip.push(t); return Promise.resolve(); } },
    },
    fetch() { spy.fetch++; return Promise.reject(new Error('offline')); },
    XMLHttpRequest: function () { spy.fetch++; },
    WebSocket: function () { spy.fetch++; },
    gifos: {
      db: (n) => (n === 'room' ? room : n === 'save' ? save : null),
      me: () => Promise.resolve({ id: opts.id || 'host', name: 'Player' }),
      info: () => Promise.resolve({ owner: !opts.guest, appId: 'yopass' }),
      onBack: (fn) => { backFn = fn; },
      invite: () => { spy.invite++; },
      share: () => { spy.invite++; },
    },
  };
  doc.execCommand = (cmd) => {
    const ta = doc.body.querySelector('textarea[readonly]');
    spy.exec.push({ cmd, value: ta ? ta.value : null });
    return cmd === 'copy';
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of doc.querySelectorAll('script[src]').map((s) => s.getAttribute('src'))) {
    vm.runInContext(src(f), sandbox, { filename: f });
  }
  for (let i = 0; i < 6; i++) await tick();
  const $ = (id) => doc.getElementById(id);
  return {
    doc, $, save, spy, clock, sandbox,
    get back() { return backFn; },
    screen: () => ['home', 'locked', 'open', 'revealed', 'waiting', 'gone'].filter((k) => shown($(k), rules)),
    on: (k) => shown($(k), rules),
    warn: (id) => $(id).classList.contains('warn') && $(id).textContent.trim().length > 0,
    lock: async (secret, pass, life, burnIt) => {
      $('plain').value = secret;
      $('pass').value = pass || '';
      if (life !== undefined) $('life').querySelector('[data-life="' + life + '"]').click();
      $('burn').checked = burnIt !== false;
      $('lockBtn').click();
      await until(() => !$('lockBtn').disabled);
      for (let i = 0; i < 4; i++) await tick();
    },
    open: async (pass) => {
      $('openPass').value = pass || '';
      $('openBtn').click();
      await until(() => !$('openBtn').disabled);
      for (let i = 0; i < 4; i++) await tick();
    },
  };
}

MAIN.push(async () => {
  // ---- the page loads only its own files, as classic scripts -------------
  const { doc } = miniDom(html);
  const refs = doc.querySelectorAll('[src],[href]').map((e) => e.getAttribute('src') || e.getAttribute('href'));
  check('every src/href in the page is a file shipped beside it',
    refs.length >= 4 && refs.every((r) => !/^[a-z]+:|^\/\//i.test(r) && fs.existsSync(path.join(APP, r))), refs);
  check('classic scripts only', doc.querySelectorAll('script').every((s) => s.getAttribute('type') !== 'module'));
});

MAIN.push(async () => {
  // ---- host locks with a passphrase; guest opens; burn-after-read ---------
  const room = sharedRoom();
  const host = await device(room, { id: 'host' });
  check('owner with an empty room sees the lock form', JSON.stringify(host.screen()) === '["home"]', host.screen());

  host.$('lockBtn').click();
  await tick();
  check('empty secret is refused in the UI (warning, no write, still home)',
    host.warn('lockStatus') && room.puts.length === 0 && host.on('home'));

  await host.lock('db-pass-7731', 'two words', '1d', true);
  const row = room.rows.secret;
  check('Lock writes ciphertext to the room, not the plaintext',
    !!row && !!row.ct && row.hasPass && !JSON.stringify(row).includes('db-pass-7731'), row);
  check('Lock honours the lifetime and burn choices', row && row.lifetime === '1d' && row.burn === true && row.expiresAt === host.clock.now + Core.LIFE_MS['1d']);
  check('the lock form is cleared after Lock', host.$('plain').value === '' && host.$('pass').value === '');
  check('owner moves to the locked screen', JSON.stringify(host.screen()) === '["locked"]', host.screen());
  check('the owner keeps a private copy of the lock', !!host.save.rows.last && host.save.rows.last.ct === row.ct);

  const guest = await device(room, { id: 'guest', guest: true });
  check('guest arriving after lock is on the open screen', JSON.stringify(guest.screen()) === '["open"]', guest.screen());
  check('guest sees the passphrase field for a passphrase lock', shown(guest.$('openPassRow'), rules));
  check('Open and burn warns before opening', guest.warn('openStatus'));

  await guest.open('');
  check('empty passphrase is refused, nothing opens', guest.warn('openStatus') && guest.on('open') && !room.rows.secret.burned);
  await guest.open('wrong words');
  check('wrong passphrase is refused, nothing opens', guest.warn('openStatus') && guest.on('open') && !room.rows.secret.burned);
  await guest.open('two words');
  check('right passphrase reveals the secret', guest.on('revealed') && guest.$('revText').textContent === 'db-pass-7731', guest.screen());
  await until(() => room.rows.secret && room.rows.secret.burned);
  for (let i = 0; i < 6; i++) await tick();
  check('burn-after-read burns the room row', room.rows.secret.burned === true && !room.rows.secret.ct);
  check('burn-after-read does not yank the revealed screen', guest.on('revealed') && guest.$('revText').textContent === 'db-pass-7731', guest.screen());

  guest.$('copyBtn').click();
  await tick();
  check('Copy writes the secret to the clipboard', guest.spy.clip[0] === 'db-pass-7731', guest.spy.clip);

  check('Back on the revealed secret hides it and is consumed', guest.back() === true && guest.$('revText').textContent === '');
  check('after Hide the guest sees already burned', JSON.stringify(guest.screen()) === '["gone"]', guest.screen());
  check('Back on a guest gone screen falls through to the OS', guest.back() === false);
  check('owner sees burned, with Lock another', host.on('gone') && shown(host.$('goneLock'), rules));

  const late = await device(room, { id: 'late', guest: true });
  check('a late guest sees already burned, not waiting', JSON.stringify(late.screen()) === '["gone"]', late.screen());
  check('a guest gets no Lock another on the gone screen', !shown(late.$('goneLock'), rules));

  check('Back on the owner gone screen returns to the lock form', host.back() === true && host.on('home'));
  check('no fetch / XHR / WebSocket during the whole loop', [host, guest, late].every((d) => d.spy.fetch === 0));
});

MAIN.push(async () => {
  // ---- no passphrase, stays until burned; owner opens and burns ----------
  const room = sharedRoom();
  const host = await device(room, { id: 'host' });
  await host.lock('plain-note-42', '', '', false);
  const row = room.rows.secret;
  check('until-burned lock has no expiry', !!row && !row.expiresAt && row.burn === false && row.hasPass === false);
  const guest = await device(room, { id: 'guest', guest: true, noClipboard: true });
  check('no-passphrase lock hides the passphrase field', guest.on('open') && !shown(guest.$('openPassRow'), rules));
  check('a non-burning open has no burn warning', !guest.warn('openStatus'));
  await guest.open('');
  check('no-passphrase open reveals the secret', guest.on('revealed') && guest.$('revText').textContent === 'plain-note-42');
  for (let i = 0; i < 6; i++) await tick();
  check('a non-burning open leaves the room row locked', !room.rows.secret.burned && !!room.rows.secret.ct);
  guest.$('copyBtn').click();
  await tick();
  check('Copy falls back to execCommand when there is no clipboard API',
    guest.spy.exec.length === 1 && guest.spy.exec[0].cmd === 'copy' && guest.spy.exec[0].value === 'plain-note-42', guest.spy.exec);

  host.$('openMine').click();
  check('owner can open it here', host.on('open'));
  check('Back on the owner open screen returns to locked', host.back() === true && host.on('locked'));
  host.$('burnNow').click();
  await until(() => room.rows.secret.burned);
  for (let i = 0; i < 6; i++) await tick();
  check('Burn now burns it for everyone and drops the owner private copy', host.on('gone') && !host.save.rows.last);
  check('a guest still reading keeps the revealed screen', guest.on('revealed'));
  guest.$('hideBtn').click();
  check('the guest lands on gone after Hide', guest.on('gone'));
});

MAIN.push(async () => {
  // ---- guests: waiting, and never the lock form ---------------------------
  const room = sharedRoom();
  const guest = await device(room, { id: 'guest', guest: true });
  check('guest with an empty room sees waiting, not the lock form',
    JSON.stringify(guest.screen()) === '["waiting"]', guest.screen());
  guest.$('plain').value = 'sneaky';
  guest.$('lockBtn').click();
  await tick();
  check('guest cannot lock (warning, no room write)', guest.warn('lockStatus') && room.puts.length === 0);
  check('guest is decided by gifos.info().owner === false',
    (await device(sharedRoom(), { id: 'x', guest: false })).on('home') && guest.on('waiting'));

  const host = await device(room, { id: 'host' });
  await host.lock('late-arrival', '', '1h', true);
  for (let i = 0; i < 6; i++) await tick();
  check('a waiting guest moves to open when the owner locks', guest.on('open'));

  host.clock.now += Core.LIFE_MS['1h'] + 1;
  guest.clock.now += Core.LIFE_MS['1h'] + 1;
  await guest.open('');
  check('opening an expired secret does not reveal it', !guest.on('revealed') && guest.$('revText').textContent === '');
  check('the expired secret shows gone', guest.on('gone'));
});

MAIN.push(async () => {
  // ---- Invite is OS chrome: no in-app control reaches a share/invite API ---
  const room = sharedRoom();
  const host = await device(room, { id: 'host' });
  await host.lock('tap-everything', '', '1h', false);
  const guest = await device(room, { id: 'guest', guest: true });
  for (const d of [host, guest]) d.doc.querySelectorAll('button').forEach((b) => b.click());
  for (let i = 0; i < 10; i++) await tick();
  check('no in-app button invites or shares (Invite is OS chrome)', host.spy.invite === 0 && guest.spy.invite === 0);

  // ---- phone: tap targets and no zoom-on-focus (cascade on real elements) -
  const touch = host.doc.querySelectorAll('button').filter((b) => computed(b, rules)['touch-action'] !== 'manipulation');
  check('every button has touch-action: manipulation', touch.length === 0, touch.map((b) => b.id || b.getAttribute('data-life')));
  const small = ['plain', 'pass', 'openPass'].filter((id) => !(px(computed(host.$(id), rules).font) >= 16));
  check('16px text fields (no iOS zoom on focus)', small.length === 0, small);
  check('16px root font', px(computed(host.doc.documentElement, rules).font) === 16 && px(computed(host.doc.body, rules).font) === 16);

  // TEXT-CHECK: an absence guarantee over every code path, including ones no
  // test drives; the fetch spies above only cover the paths this suite plays.
  check('no fetch / XHR / WebSocket in app code',
    !/fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(src('app.js') + src('crypto.js') + src('core.js')));
  check('manifest has no network', !manifest.capabilities.network);
  check('room is read-write, save is private',
    manifest.data.room.visibility === 'read-write' && manifest.data.save.visibility === 'private');
});

(async () => {
  for (const step of MAIN) await step();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
