// THE STAMP BUTTON HAS TO LOOK LIKE THE STAMP BUTTON.
//
// Stamp is the one button the whole app is for: teal, tall, wide. Its rule
// was `#stampBtn` (one id), while the dock's shared rule `#dock button` (one
// id plus a type) outranked it, so the browser painted Stamp exactly like
// -5s and Play. This suite runs the cascade: it parses the app's style.css
// into rules, matches them against the dock's buttons as index.html nests
// them, orders by importance, specificity and source order, and reads the
// computed values on a desktop and a phone width.
const fs = require('fs');
const path = require('path');

const APP = __dirname;

let failures = 0;
const check = (n, c, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (extra !== undefined && !c ? '  ' + JSON.stringify(extra) : ''));
  if (!c) failures++;
};

// ---- parse: [{ selector, decls: [[prop, value, important]], media, order }] ----
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;
  function block(text, media) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) block(body, head.slice(6).trim());
      else if (!head.startsWith('@')) {
        const decls = body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
          const k = d.indexOf(':');
          let v = d.slice(k + 1).trim();
          const imp = /!important$/.test(v);
          if (imp) v = v.replace(/\s*!important$/, '');
          return [d.slice(0, k).trim(), v, imp];
        });
        // `border: 1px solid #hex` also sets border-color, as a browser expands it.
        for (const [prop, v, imp] of decls.slice()) {
          const col = prop === 'border' && (v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i) || [])[0];
          if (col) decls.push(['border-color', col, imp]);
        }
        for (const sel of head.split(',')) rules.push({ selector: sel.trim(), decls, media, order: order++ });
      }
      i = j;
    }
  }
  block(src, null);
  return rules;
}

function mediaMatches(media, width) {
  if (!media) return true;
  let ok = true;
  media.replace(/\(\s*(max|min)-width:\s*(\d+)px\s*\)/g, (m, kind, px) => {
    ok = ok && (kind === 'max' ? width <= +px : width >= +px);
  });
  if (!/width/.test(media)) return false; // a media feature this resolver does not model
  return ok;
}

// ---- match: compound selectors joined by descendant combinators ------------
function parseCompound(c) {
  const out = { tag: null, ids: [], classes: [], pseudos: [], attrs: [], universal: false };
  const re = /(#[\w-]+)|(\.[\w-]+)|(::?[\w-]+(?:\([^)]*\))?)|(\[[^\]]+\])|(\*)|([\w-]+)/g;
  let m;
  while ((m = re.exec(c))) {
    if (m[1]) out.ids.push(m[1].slice(1));
    else if (m[2]) out.classes.push(m[2].slice(1));
    else if (m[3]) out.pseudos.push(m[3]);
    else if (m[4]) out.attrs.push(m[4].slice(1, -1));
    else if (m[5]) out.universal = true;
    else if (m[6]) out.tag = m[6].toLowerCase();
  }
  return out;
}
function compoundMatches(cp, el) {
  if (cp.tag && cp.tag !== el.tag) return false;
  if (cp.ids.some((id) => id !== el.id)) return false;
  if (cp.classes.some((c) => !el.classes.includes(c))) return false;
  if (cp.attrs.some((a) => !(a in el.attrs))) return false;
  if (cp.pseudos.some((p) => !(el.states || []).includes(p))) return false;
  return true;
}
function matches(selector, el) {
  if (/[>+~]/.test(selector)) return false; // not used by the dock rules
  const parts = selector.split(/\s+/).map(parseCompound);
  if (!compoundMatches(parts[parts.length - 1], el)) return false;
  let cur = el.parent;
  for (let k = parts.length - 2; k >= 0; k--) {
    while (cur && !compoundMatches(parts[k], cur)) cur = cur.parent;
    if (!cur) return false;
    cur = cur.parent;
  }
  return true;
}
function specificity(selector) {
  let a = 0, b = 0, c = 0;
  for (const cp of selector.split(/\s+/).map(parseCompound)) {
    a += cp.ids.length;
    b += cp.classes.length + cp.attrs.length + cp.pseudos.filter((p) => !p.startsWith('::')).length;
    c += (cp.tag ? 1 : 0) + cp.pseudos.filter((p) => p.startsWith('::')).length;
  }
  return a * 10000 + b * 100 + c;
}
function computed(rules, el, width) {
  const won = {};
  for (const r of rules) {
    if (!mediaMatches(r.media, width) || !matches(r.selector, el)) continue;
    const spec = specificity(r.selector);
    for (const [prop, value, imp] of r.decls) {
      const rank = [imp ? 1 : 0, spec, r.order];
      const cur = won[prop];
      if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && (rank[1] > cur.rank[1] || (rank[1] === cur.rank[1] && rank[2] >= cur.rank[2])))) {
        won[prop] = { value, rank };
      }
    }
  }
  const out = {};
  for (const k of Object.keys(won)) out[k] = won[k].value;
  return out;
}

// ---- the dock, nested as index.html nests it --------------------------------
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const rules = parseCss(fs.readFileSync(path.join(APP, 'style.css'), 'utf8'));
const node = (tag, id, parent, classes) => ({ tag, id, parent, classes: classes || [], attrs: {} });
const htmlEl = node('html', '', null);
const body = node('body', '', htmlEl);
const shell = node('div', 'shell', body);
const dock = node('div', 'dock', shell);
const dockIds = (html.match(/<div id="dock">([\s\S]*?)<\/div>/) || [, ''])[1].match(/id="([\w-]+)"/g).map((s) => s.slice(4, -1));
check('the dock holds playBtn and stampBtn', dockIds.includes('stampBtn') && dockIds.includes('playBtn'), dockIds);
const stamp = node('button', 'stampBtn', dock);
const play = node('button', 'playBtn', dock);

for (const [label, width] of [['desktop', 1024], ['phone', 390]]) {
  const s = computed(rules, stamp, width);
  const p = computed(rules, play, width);
  check(label + ': Stamp is painted in its own colour, not the dock\'s', s.background && s.background !== p.background && /39d0c5/i.test(s.background), { stamp: s.background, play: p.background });
  check(label + ': Stamp text is dark on teal', s.color && s.color !== p.color, { stamp: s.color, play: p.color });
  check(label + ': Stamp has its own border colour', s['border-color'] === '#2bb8ae', s['border-color']);
  check(label + ': Stamp is taller than the other dock buttons', parseInt(s['min-height'], 10) > parseInt(p['min-height'], 10), { stamp: s['min-height'], play: p['min-height'] });
  check(label + ': Stamp text is larger than the other dock buttons', parseInt(s['font-size'], 10) > parseInt(p['font-size'], 10), { stamp: s['font-size'], play: p['font-size'] });
  check(label + ': Stamp grows wider than its neighbours', /^1\.8/.test(s.flex || ''), s.flex);
  check(label + ': Play keeps the dock style', p.background === '#182030', p.background);
}
{
  const s = computed(rules, Object.assign(node('button', 'stampBtn', dock), { states: [':disabled'] }), 1024);
  check('a disabled Stamp is dimmed', s.opacity === '0.45', s.opacity);
}

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nAll lrc-maker Stamp checks green.');
