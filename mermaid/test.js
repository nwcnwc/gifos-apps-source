// MERMAID HAS TO DRAW A FIXTURE, AND A BAD LINE MUST NOT WIPE THE LAST GOOD PICTURE.
//
// The loop is textarea → mermaid.render → SVG. This suite plays that loop in a
// vm over a small in-memory DOM built from the app's own index.html, with
// style.css applied by a small cascade. The engine is the vendored mermaid:
// its real parser decides good from bad; only the SVG drawing is stubbed
// (that half needs a browser's layout). No wording of the app is asserted.
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

const FIXTURE = 'flowchart TD\n  A[Start] --> B{Edit me}\n  B -->|Yes| C[Nice]';
const BAD = 'flowchart TD\n  A -->';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The vendored engine, loaded on its own over a blank in-memory document.
// Its parser needs no layout; DOMPurify inside it only needs a document.
function loadEngine() {
  const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  const d = makeMiniDom();
  d.document.implementation = { createHTMLDocument: () => makeMiniDom().document };
  const g = {
    console: quiet, setTimeout, clearTimeout, Promise, structuredClone, document: d.document,
    navigator: { userAgent: 'node' }, addEventListener() {},
    Element: d.Element, Node: d.Node, Text: d.Text, DocumentFragment: d.Fragment, NodeFilter: d.NodeFilter,
    NamedNodeMap: function () {}, HTMLFormElement: function () {}, DOMParser: function () {},
  };
  g.globalThis = g; g.window = g;
  vm.createContext(g);
  vm.runInContext(read('vendor/mermaid.min.js'), g, { filename: 'mermaid.min.js' });
  return g.mermaid;
}

// One collection store per page, the shape gifos.db hands an app.
function fakeGifos(seed) {
  const cols = {};
  const writes = [];
  const db = (name) => {
    const rows = cols[name] = cols[name] || new Map(Object.entries((seed || {})[name] || {}));
    const subs = [];
    return {
      put: (r) => { writes.push({ name, rec: JSON.parse(JSON.stringify(r)) }); rows.set(r.id, r); subs.forEach((f) => f([...rows.values()])); return Promise.resolve(r); },
      get: (id) => Promise.resolve(rows.has(id) ? rows.get(id) : null),
      getAll: () => Promise.resolve([...rows.values()]),
      subscribe: (f) => { subs.push(f); db.subs[name] = f; },
    };
  };
  db.subs = {};
  return { db, writes, me: () => Promise.resolve({ id: 'b-me', name: 'Me' }), onBack() {} };
}

function loadApp(engine, opts) {
  opts = opts || {};
  const dom = makeMiniDom({ html: read('index.html') });
  const rendered = [];
  const mermaid = {
    initialize: function (o) { this.opts = o; },
    render: function (id, text) {
      rendered.push({ id, text });
      return engine.parse(String(text)).then(() => ({ svg: '<svg data-id="' + id + '"><g class="node"></g></svg>' }));
    },
  };
  const clip = [];
  const g = {
    console, Math, Object, Array, JSON, Date, String, Number, Boolean, Promise, RegExp, Error,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    document: dom.document, mermaid, gifos: opts.gifos || null,
    navigator: { clipboard: { writeText: (t) => { clip.push(t); return Promise.resolve(); } } },
  };
  g.window = g; g.globalThis = g;
  vm.createContext(g);
  vm.runInContext(read('app.js'), g, { filename: 'app.js' });
  vm.runInContext(read('mp.js'), g, { filename: 'mp.js' });
  const $ = (id) => dom.document.getElementById(id);
  return { g, dom, doc: dom.document, $, mermaid, rendered, clip };
}

(async function main() {
  const engine = loadEngine();
  check('the vendored mermaid engine loads and exposes initialize/render/parse',
    !!(engine && typeof engine.initialize === 'function' && typeof engine.render === 'function' && typeof engine.parse === 'function'));

  const A = loadApp(engine);
  const { g, $, mermaid, rendered } = A;
  check('app.js loads and attaches MMApp', !!(g.MMApp && g.MMApp.draw && g.MMApp.tidyError));
  check('first boot draws the flowchart sample', rendered.length >= 1 && rendered[0].text === g.MMApp.samples.flowchart, rendered[0] && rendered[0].text);
  await wait(20);
  check('first boot paints an SVG', !!$('view').querySelector('svg'), $('view').innerHTML.slice(0, 80));

  $('src').value = FIXTURE;
  g.MMApp.draw();
  await wait(20);
  const shown = $('view').querySelector('svg');
  check('a flowchart fixture renders and its SVG lands in #view', !!shown && shown.getAttribute('data-id') === rendered[rendered.length - 1].id && $('err').hidden);
  const good = $('view').innerHTML;

  let engineMsg = '';
  try { await engine.parse(BAD); } catch (e) { engineMsg = String(e && (e.str || e.message) || e); }
  $('src').value = BAD;
  g.MMApp.draw();
  await wait(20);
  const errText = $('err').textContent;
  check('bad syntax shows the engine\'s position line, not its whole dump',
    engineMsg.indexOf('\n') > 0 && !$('err').hidden && errText.length > 0 && errText.indexOf('\n') < 0 &&
    errText === engineMsg.split('\n')[0].trim() && errText.length < engineMsg.length,
    { errText, engineMsg: engineMsg.slice(0, 80) });
  check('bad syntax keeps the last good picture', $('view').innerHTML === good, $('view').innerHTML.slice(0, 60));

  const before = rendered.length;
  $('src').value = '   ';
  g.MMApp.draw();
  await wait(20);
  check('empty text is a hint, not a parser dump: no render, no error, an empty-state block',
    rendered.length === before && $('err').hidden && !$('view').querySelector('svg') && !!$('view').querySelector('.empty'));

  const long = g.MMApp.tidyError({ message: 'Error: ' + 'x'.repeat(400) });
  check('tidyError caps a long dump', long.length <= 181, long.length);

  check('initialize turns htmlLabels off', mermaid.opts && mermaid.opts.flowchart && mermaid.opts.flowchart.htmlLabels === false);
  const kinds = ['flowchart', 'sequence', 'class', 'pie'];
  const parsed = [];
  for (const k of kinds) {
    try { parsed.push(g.MMApp.samples[k] && (await engine.parse(g.MMApp.samples[k])) !== false); } catch (e) { parsed.push(false); }
  }
  check('samples include flowchart, sequence, class, pie, and the real engine parses every one', parsed.every(Boolean), parsed);

  // The Sample button drops the chosen kind in and shows the picture.
  $('kind').value = 'sequence';
  $('sampleBtn').click();
  await wait(260);
  check('Sample drops in the chosen kind and draws it', $('src').value === g.MMApp.samples.sequence &&
    rendered[rendered.length - 1].text === g.MMApp.samples.sequence);

  // ---- phone tabs: the cascade decides what is on screen ----------------------
  {
    const phone = A.dom.parseCss(read('style.css'), 390);
    const wide = A.dom.parseCss(read('style.css'), 1200);
    const vis = (rules, id) => A.dom.shown(rules, $(id));
    $('tabPic').click();
    const pic = [vis(phone, 'src'), vis(phone, 'preview'), A.doc.body.classList.contains('tab-pic'), $('tabPic').getAttribute('aria-selected')];
    $('tabSrc').click();
    const src = [vis(phone, 'src'), vis(phone, 'preview'), $('tabSrc').getAttribute('aria-selected')];
    const tabsBar = A.doc.querySelector('[role="tablist"]');
    check('phone Recipe/Picture tabs swap the editor and the picture',
      pic[0] === false && pic[1] === true && pic[2] === true && pic[3] === 'true' &&
      src[0] === true && src[1] === false && src[2] === 'true' && vis(phone, 'tabSrc'), { pic, src });
    check('on a wide screen the tabs are gone and both panes show',
      !A.dom.shown(wide, tabsBar) && vis(wide, 'src') && vis(wide, 'preview'));
  }

  // ---- Copy SVG --------------------------------------------------------------
  {
    $('src').value = FIXTURE;
    g.MMApp.draw();
    await wait(20);
    $('copyBtn').click();
    check('Copy SVG puts the drawn SVG on the clipboard', A.clip.length === 1 && A.clip[0] === $('view').innerHTML && /^<svg/.test(A.clip[0]), A.clip);
  }

  // ---- mermaid's error bomb is scrubbed --------------------------------------
  {
    const rules = A.dom.parseCss(read('style.css'), 390);
    const bomb = A.doc.createElement('div');
    bomb.id = 'dmmd99';
    bomb.textContent = 'Syntax error in text'; // what the engine itself appends to <body>
    const icon = A.doc.createElement('div');
    icon.className = 'error-icon';
    A.doc.body.appendChild(bomb);
    A.doc.body.appendChild(icon);
    check('the engine\'s error icon is never shown, even before it is removed', !A.dom.shown(rules, icon));
    $('src').value = BAD;
    g.MMApp.draw();
    await wait(20);
    check('bad syntax scrubs mermaid\'s bomb overlay and keeps the app',
      !bomb.parentNode && !icon.parentNode && !!$('shell') && $('shell').parentNode === A.doc.body);
  }

  // ---- the file is the save ---------------------------------------------------
  {
    const gif = fakeGifos();
    const B = loadApp(engine, { gifos: gif });
    B.$('src').value = FIXTURE;
    B.$('src').dispatchEvent(new B.dom.Event('input', { bubbles: true }));
    await wait(600);
    const saves = gif.writes.filter((w) => w.name === 'save');
    const manifest = JSON.parse(read('manifest.json'));
    check('typing saves the document to the private save collection',
      saves.length >= 1 && saves[saves.length - 1].rec.id === 'doc' && saves[saves.length - 1].rec.text === FIXTURE &&
      (manifest.data.save || {}).visibility === 'private', saves);
    const again = fakeGifos({ save: { doc: { id: 'doc', text: 'pie title Saved\n  "a" : 1' } } });
    const C = loadApp(engine, { gifos: again });
    await wait(40);
    check('reopening restores and draws the saved document', C.$('src').value === 'pie title Saved\n  "a" : 1' &&
      C.rendered[C.rendered.length - 1].text === C.$('src').value && !!C.$('view').querySelector('svg'));

    // Play together: a friend's newer round is adopted and drawn here.
    const D = loadApp(engine, { gifos: fakeGifos() });
    D.$('shareBtn').click();
    await wait(10);
    const room = D.g.gifos.db.subs.room;
    if (room) room([{ id: 'a-friend', name: 'Friend', round: 7, text: FIXTURE, at: Date.now() }]);
    await wait(20);
    check('Play together joins the room and shows a friend\'s newer diagram',
      !!room && !D.$('friend-bar').hidden && D.$('src').value === FIXTURE && D.rendered[D.rendered.length - 1].text === FIXTURE);
  }

  // ---- shell ------------------------------------------------------------------
  {
    const html = read('index.html');
    // TEXT-CHECK: Invite is OS chrome. There is no invite API an app could call,
    // so the only sign of a duplicate in-app Invite is a button with that label.
    check('no in-app Invite button', !/<button\b[^>]*>\s*Invite\s*</i.test(html));
    const doc = makeMiniDom({ html }).document;
    const refs = [];
    doc.querySelectorAll('*').forEach((e) => e.attributes.forEach((a) => refs.push([e.localName, a.name, a.value])));
    const urls = refs.filter(([, k, v]) => /^(src|href|srcset|action|data|poster)$/.test(k) || /^\s*(https?:)?\/\//i.test(v));
    const inline = doc.querySelectorAll('script, style').map((e) => e.textContent).join('\n');
    const remote = urls.filter(([, , v]) => /^\s*(https?:)?\/\//i.test(v));
    const missing = urls.filter(([, k, v]) => /^(src|href)$/.test(k) && !/^#/.test(v) && !fs.existsSync(path.join(APP, v)));
    check('no CDN / no type=module: every script and stylesheet is a file in the app',
      remote.length === 0 && missing.length === 0 && !/https?:\/\//i.test(inline) &&
      doc.querySelectorAll('script[type="module"]').length === 0 && doc.querySelectorAll('script[src]').length >= 2, { remote, missing });
    const listing = JSON.parse(read('listing.json'));
    check('listing is an unofficial (unblessed) wrap of the mermaid engine', listing.basedOn.name === 'mermaid' && listing.basedOn.blessed === false);
  }

  if (failures) {
    console.log('\n' + failures + ' failing');
    process.exit(1);
  }
  console.log('\nAll mermaid checks green.');
  process.exit(0);
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
