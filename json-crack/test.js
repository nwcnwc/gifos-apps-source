// JSON CRACK HAS TO DRAW A FIXTURE, AND BAD JSON MUST NOT WIPE THE LAST GRAPH.
//
// The loop is paste → parse → toGraph → layout → cards. graph.js is a classic
// IIFE, so this suite loads the shipped source in a vm and PLAYS that loop on
// a real document (the Super hero squad sample). The whole app then runs over
// a small in-memory DOM built from its own index.html, with style.css applied
// by a small cascade: tabs, zoom, pinch, Back and the save are driven, not
// read. No wording of the app is asserted.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

function loadGraph() {
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error,
    parseInt, isNaN,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, 'graph.js'), 'utf8'), sandbox, { filename: 'graph.js' });
  return sandbox;
}

for (const f of ['graph.js', 'mp.js', 'app.js']) {
  try {
    new vm.Script(fs.readFileSync(path.join(APP, f), 'utf8'), { filename: f });
    check(f + ' parses as classic JS', true);
  } catch (e) {
    check(f + ' parses as classic JS', false, String(e && e.message || e));
  }
}

const S = loadGraph();
const JC = S.JsonCrack;
check('graph.js attaches JsonCrack', !!(JC && JC.toGraph && JC.layout && JC.parseJson && JC.SAMPLE));

{
  const p = JC.parseJson('');
  check('empty string is empty, not a parse error', !!(p.empty && !p.error));
  check('whitespace-only is empty', !!JC.parseJson('  \n\t  ').empty);
}

{
  const p = JC.parseJson('{');
  check('truncated JSON is an error with a message', !!(p.error && typeof p.message === 'string' && p.message.trim()), p.message);
  check('…and does not invent a value', p.value === undefined);
}

{
  const p = JC.parseJson('{\n  a: 1}');
  // `{` newline, two spaces, then the bad key: line 2, column 3.
  const nums = (p.message.match(/\d+/g) || []).map(Number);
  check('invalid JSON points at the line and column of the fault (2, 3)', nums.length === 2 && nums[0] === 2 && nums[1] === 3, p.message);
}

{
  check('valid object parses', JC.parseJson('{"a": 1}').value.a === 1);
  check('valid array parses', JC.parseJson('[1,2]').value[1] === 2);
  check('valid primitive parses', JC.parseJson('true').value === true);
  check('null parses as null, not empty', JC.parseJson('null').value === null);
}

{
  const g = JC.toGraph({ a: 1, b: { c: 'x' }, d: [true, { e: null }] });
  check('fixture {a, b:{c}, d:[true,{e}]} is 4 cards', g.nodes.length === 4, g.nodes.length);
  check('…and 3 edges (b, d, d[1])', g.edges.length === 3, g.edges.length);
  const root = g.nodes[0];
  check('nested keys stay as rows on the parent', root.rows.length === 3 && root.rows[1].nested && root.rows[1].k === 'b', root.rows);
  check('primitives stay on the parent', root.rows[0].k === 'a' && root.rows[0].t === 'number' && !root.rows[0].nested);
  const L = JC.layout(g, {});
  check('layout assigns x/y/w/h', !!(L.nodes[0].w && L.nodes[0].h && L.nodes[0].x >= 0));
  check('cards do not overlap', JC.cardsOverlap(L) === false);
  const child = L.nodes.filter((n) => n.id !== root.id)[0];
  check('children sit to the right of the parent', !!(child && child.x >= L.nodes[0].x + L.nodes[0].w), child && { x: child.x, px: L.nodes[0].x, pw: L.nodes[0].w });
  const folded = JC.layout(g, (function () { const o = {}; o[root.id] = true; return o; })());
  check('collapse hides descendants', folded.nodes.length === 1, folded.nodes.length);
}

{
  const g = JC.toGraph(JC.SAMPLE);
  check('sample Super hero squad is 6 cards (root, members, 2 people, 2 power lists)', g.nodes.length === 6, g.nodes.length);
  check('sample has 5 edges', g.edges.length === 5, g.edges.length);
  const root = g.nodes[0];
  const memberRow = root.rows.filter((r) => r.k === 'members')[0];
  check('members is a nested row on the root card', !!(memberRow && memberRow.nested && memberRow.t === 'array' && memberRow.size === 2), memberRow);
  const L = JC.layout(g, {});
  check('sample layout does not overlap', JC.cardsOverlap(L) === false);
  check('sample graph has a positive bounding box', L.width > 200 && L.height > 200, { w: L.width, h: L.height });
  const byId = {};
  L.nodes.forEach((n) => { byId[n.id] = n; });
  const membersEdge = L.edges.filter((e) => e.label === 'members')[0];
  check('members edge is attached, not floating', !!(membersEdge && membersEdge.x1 > 0 && membersEdge.x2 > membersEdge.x1));
  if (membersEdge) {
    const parent = byId[membersEdge.from];
    const dy = Math.abs(membersEdge.y1 - (parent.y + 18));
    check('members edge leaves the members row, not only the title', dy > 8, { y1: membersEdge.y1, titleY: parent.y + 18, dy: dy });
  }
}

{
  const g = JC.toGraph([1, { a: 2 }, 3]);
  check('root array keeps primitive slots as rows', g.nodes[0].isArray && g.nodes[0].rows.length === 3);
  check('only the nested object becomes a child card', g.nodes.length === 2, g.nodes.length);
}

{
  const g = JC.toGraph(42);
  check('a primitive root is one card', g.nodes.length === 1 && g.nodes[0].rows[0].v === 42);
}

// ---- the app over an in-memory DOM -----------------------------------------
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

const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeGifos(seed) {
  const cols = {};
  const writes = [];
  const subs = {};
  const db = (name) => {
    const rows = cols[name] = cols[name] || new Map(Object.entries((seed || {})[name] || {}));
    return {
      put: (r) => { writes.push({ name, rec: JSON.parse(JSON.stringify(r)) }); rows.set(r.id, r); return Promise.resolve(r); },
      get: (id) => (rows.has(id) ? Promise.resolve(rows.get(id)) : Promise.reject(new Error('missing'))),
      subscribe: (f) => { subs[name] = f; },
    };
  };
  const g = { db, writes, subs, me: () => Promise.resolve({ id: 'b-me', name: 'Me' }), back: null };
  g.onBack = (f) => { g.back = f; };
  return g;
}

function loadApp(opts) {
  opts = opts || {};
  const dom = makeMiniDom({ html: read('index.html') });
  const clip = [];
  const sandbox = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Error, Promise, RegExp, parseInt, isNaN,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    document: dom.document, gifos: opts.gifos || null,
    navigator: { clipboard: { writeText: (t) => { clip.push(t); return Promise.resolve(); } } },
    FileReader: function () {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['graph.js', 'mp.js', 'app.js']) vm.runInContext(read(f), sandbox, { filename: f });
  const $ = (id) => dom.document.getElementById(id);
  const scale = () => { const m = /scale\(([\d.]+)\)/.exec($('graph-inner').style.transform || ''); return m ? +m[1] : NaN; };
  const shift = () => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec($('graph-inner').style.transform || ''); return m ? [+m[1], +m[2]] : null; };
  return { sandbox, dom, doc: dom.document, $, clip, scale, shift };
}

(async function main() {
  {
    const A = loadApp();
    const { sandbox, $ } = A;
    const svg = () => $('graph-inner').querySelector('svg');
    check('app.js attaches JsonCrackApp', !!(sandbox.JsonCrackApp && sandbox.JsonCrackApp.parseAndDraw));
    let pasted = null;
    try { pasted = JSON.parse($('src').value); } catch (e) { /* not JSON */ }
    check('first boot pastes the sample and draws its cards',
      JSON.stringify(pasted) === JSON.stringify(JC.SAMPLE) && !!svg() && svg().querySelectorAll('g.node').length === 6,
      svg() && svg().querySelectorAll('g.node').length);
    const good = svg() && svg().innerHTML;
    const counts = ($('meta').textContent.match(/\d+/g) || []).map(Number);
    check('meta counts the cards and edges after a draw', counts[0] === 6 && counts[1] === 5, $('meta').textContent);
    check('first view frames the root at 1×, not a microscopic fit-all', A.scale() === 1 && JSON.stringify(A.shift()) === '[16,16]', $('graph-inner').style.transform);

    // A tap on a row copies its value; a fold collapses the card's children.
    const row = svg().querySelectorAll('g.row').find((r) => r.getAttribute('data-copy') === 'Metro City');
    if (row) row.click();
    check('tapping a row copies that value', !!row && A.clip[0] === 'Metro City', A.clip);
    const fold = svg().querySelector('.fold');
    if (fold) fold.click();
    check('the fold control collapses a card\'s children', !!fold && svg().querySelectorAll('g.node').length === 1);
    if (svg().querySelector('.fold')) svg().querySelector('.fold').click();
    const goodAgain = svg().innerHTML;
    void good;

    $('src').value = '{';
    sandbox.JsonCrackApp.parseAndDraw();
    check('invalid JSON shows the parser\'s short message', $('err').hidden === false && $('err').textContent === JC.parseJson('{').message, $('err').textContent);
    check('invalid JSON keeps the last good graph', !!svg() && svg().innerHTML === goodAgain);

    $('src').value = '   ';
    sandbox.JsonCrackApp.parseAndDraw();
    check('empty textarea is an empty state, not a parser dump',
      !!$('graph-inner').querySelector('.empty') && !svg() && $('err').hidden === true && $('meta').textContent === '',
      $('graph-inner').innerHTML.slice(0, 80));
  }

  // ---- phone tabs, zoom, pinch, Back ----------------------------------------
  {
    const gif = fakeGifos();
    const A = loadApp({ gifos: gif });
    const { $, doc } = A;
    await wait(20);
    const css = read('style.css');
    const phone = A.dom.parseCss(css, 390), wide = A.dom.parseCss(css, 1200);
    $('tab-text').click();
    const t = [A.dom.shown(phone, $('editor')), A.dom.shown(phone, $('stage')), $('tab-text').getAttribute('aria-selected')];
    $('tab-graph').click();
    const g = [A.dom.shown(phone, $('editor')), A.dom.shown(phone, $('stage')), $('tab-graph').getAttribute('aria-selected')];
    check('phone Text/Graph tabs swap the editor and the graph',
      t[0] === true && t[1] === false && t[2] === 'true' && g[0] === false && g[1] === true && g[2] === 'true', { t, g });
    check('on a wide screen the editor and the graph show together',
      A.dom.shown(wide, $('editor')) && A.dom.shown(wide, $('stage')) && !A.dom.shown(wide, doc.querySelector('[role="tablist"]')));

    const s0 = A.scale();
    $('zoom-in').click();
    const s1 = A.scale();
    $('zoom-out').click(); $('zoom-out').click();
    const s2 = A.scale();
    $('zoom-fit').click();
    const s3 = A.scale();
    check('zoom +/−/Fit exist and change the scale (phones have no wheel)',
      s1 > s0 && s2 < s1 && s3 > 0 && s3 !== s2, [s0, s1, s2, s3]);

    const P = (type, id, x, y) => $('stage').dispatchEvent(new A.dom.Event(type, { bubbles: true, pointerId: id, clientX: x, clientY: y }));
    const before = A.scale();
    P('pointerdown', 1, 100, 100);
    P('pointerdown', 2, 140, 100);
    P('pointermove', 2, 220, 100);
    const pinched = A.scale();
    P('pointerup', 1, 100, 100); P('pointerup', 2, 220, 100);
    check('pinch-zoom is wired, and the stage leaves touch gestures to the app',
      pinched > before * 1.5 && A.dom.styleOf(phone, $('stage'), 'touch-action') === 'none', [before, pinched]);

    $('tab-text').click();
    const backFn = gif.back;
    if (backFn) backFn();
    check('gifos.onBack is registered and Back leaves the Text tab first',
      typeof backFn === 'function' && doc.body.classList.contains('tab-graph') && !doc.body.classList.contains('tab-text'));
    $('zoom-in').click();
    const zoomed = A.scale();
    if (backFn) backFn();
    check('…then Back fits a zoomed graph back to the stage', zoomed !== s3 && A.scale() === s3, [zoomed, A.scale(), s3]);
  }

  // ---- the save ----------------------------------------------------------------
  {
    const gif = fakeGifos();
    const A = loadApp({ gifos: gif });
    await wait(20);
    A.$('src').value = '{"pinned": [1, 2]}';
    A.$('src').dispatchEvent(new A.dom.Event('input', { bubbles: true }));
    await wait(700);
    const saves = gif.writes.filter((w) => w.name === 'save');
    const last = saves[saves.length - 1];
    const manifest = JSON.parse(read('manifest.json'));
    check('app.js saves the last document privately',
      !!last && last.rec.id === 'last' && last.rec.text === '{"pinned": [1, 2]}' && manifest.data.save.visibility === 'private', saves);

    const B = loadApp({ gifos: fakeGifos({ save: { last: { id: 'last', text: '' } } }) });
    await wait(20);
    check('empty saved text is restored, not replaced by the sample',
      B.$('src').value === '' && !!B.$('graph-inner').querySelector('.empty'), B.$('src').value.slice(0, 40));
    const C = loadApp({ gifos: fakeGifos({ save: { last: { id: 'last', text: '{"kept": true}' } } }) });
    await wait(20);
    check('a saved document comes back on reopen', C.$('src').value === '{"kept": true}' && !!C.$('graph-inner').querySelector('svg'));
  }

  // ---- the meeting: the host's document shows on a guest's screen ------------
  {
    const gif = fakeGifos();
    const A = loadApp({ gifos: gif });
    await wait(20);
    const room = gif.subs.room;
    if (room) room([{ id: 'a-host', name: 'Host', at: 1, text: '{"shared": 1}' }, { id: 'b-me', name: 'Me', at: 1, text: A.$('src').value }]);
    check('in a meeting, a guest sees the host\'s document as cards',
      !!room && A.$('src').value === '{"shared": 1}' && A.$('graph-inner').querySelectorAll('g.node').length === 1);
  }

  // ---- shell -------------------------------------------------------------------
  const html = read('index.html');
  // TEXT-CHECK: Invite is OS chrome. There is no invite API an app could call,
  // so the only sign of a duplicate in-app Invite is a button with that label.
  check('no in-app Invite button', !/<button\b[^>]*>\s*Invite\s*</i.test(html));
  {
    const doc = makeMiniDom({ html }).document;
    const urls = [];
    doc.querySelectorAll('*').forEach((e) => e.attributes.forEach((a) => {
      if (/^(src|href|srcset|action|data|poster)$/.test(a.name) || /^\s*(https?:)?\/\//i.test(a.value)) urls.push([e.localName, a.name, a.value]);
    }));
    const inline = doc.querySelectorAll('script, style').map((e) => e.textContent).join('\n');
    const remote = urls.filter(([, , v]) => /^\s*(https?:)?\/\//i.test(v));
    const missing = urls.filter(([, k, v]) => /^(src|href)$/.test(k) && !/^#/.test(v) && !fs.existsSync(path.join(APP, v)));
    check('no CDN / no type=module: every script and stylesheet is a file in the app',
      remote.length === 0 && missing.length === 0 && !/https?:\/\//i.test(inline) &&
      doc.querySelectorAll('script[type="module"]').length === 0 && doc.querySelectorAll('script[src]').length === 3, { remote, missing });
  }
  const listing = JSON.parse(read('listing.json'));
  check('listing is an unofficial (unblessed) port of JSON Crack',
    listing.basedOn.name === 'JSON Crack' && listing.basedOn.blessed === false);
  check('author is Aykut Saraç, never GifOS', listing.author.name === 'Aykut Saraç' && listing.porter.name === 'GifOS');

  const manifest = JSON.parse(read('manifest.json'));
  check('no network capability: the data has no way off the device', !manifest.capabilities.network);
  check('save collection is private', manifest.data.save.visibility === 'private');
  check('minBuild stays 947', manifest.minBuild === 947);

  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
