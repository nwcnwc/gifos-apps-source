// Tests for export.js: zip, pptx, pdf. Run: node test-export.js
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
var X = require('./export.js');
var pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('ok ' + pass + ' ' + msg); } else { fail++; console.log('FAIL ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + (a === b ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')')); }
function has(cmd) { return cp.spawnSync(cmd, ['--help'], { stdio: 'ignore' }).error === undefined; }
var dec = new TextDecoder();

// ---- small zip reader (walks the central directory) ----
function crc(b) {
  var c = 0xffffffff, i, k;
  for (i = 0; i < b.length; i++) { c ^= b[i]; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function readZip(u8) {
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.length), e = u8.length - 22, out = [];
  if (dv.getUint32(e, true) !== 0x06054b50) throw new Error('no end record');
  var cnt = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true);
  for (var i = 0; i < cnt; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central header');
    var meth = dv.getUint16(p + 10, true), cr = dv.getUint32(p + 16, true), cs = dv.getUint32(p + 20, true), us = dv.getUint32(p + 24, true);
    var nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('bad local header');
    var ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name: name, meth: meth, crc: cr, cs: cs, us: us, data: u8.subarray(ds, ds + cs) });
    p += 46 + nl + el + cl;
  }
  return out;
}

// ---- strict-ish XML well-formedness checker ----
function wellFormed(s) {
  var i = 0, stack = [], roots = 0, m;
  if (s.indexOf('<?xml') === 0) { i = s.indexOf('?>'); if (i < 0) return 'bad decl'; i += 2; }
  var ent = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
  while (i < s.length) {
    var lt = s.indexOf('<', i), txt = s.slice(i, lt < 0 ? s.length : lt);
    if (txt.replace(ent, '').indexOf('&') >= 0) return 'stray & in text';
    if (txt.indexOf('>') >= 0) return 'stray > in text';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(txt)) return 'illegal char';
    if (stack.length === 0 && txt.trim()) return 'text outside root';
    if (lt < 0) break;
    var gt = s.indexOf('>', lt); if (gt < 0) return 'unterminated tag';
    var tag = s.slice(lt + 1, gt);
    if (tag[0] === '/') {
      var nm = tag.slice(1).trim();
      if (stack.pop() !== nm) return 'unbalanced </' + nm + '>';
    } else {
      var self = tag[tag.length - 1] === '/', inner = self ? tag.slice(0, -1) : tag;
      m = /^([A-Za-z_][\w.:-]*)/.exec(inner); if (!m) return 'bad tag ' + tag.slice(0, 30);
      var rest = inner.slice(m[0].length), seen = {};
      var re = /^\s+([A-Za-z_][\w.:-]*)="([^"<&]*(?:&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);[^"<&]*)*)"/;
      while ((m2 = re.exec(rest))) { var m2; if (seen[m2[1]]) return 'dup attr ' + m2[1]; seen[m2[1]] = 1; rest = rest.slice(m2[0].length); }
      if (rest.trim()) return 'bad attributes: ' + rest.slice(0, 40);
      if (stack.length === 0) roots++;
      if (!self) stack.push(inner.match(/^[^\s]+/)[0]);
    }
    i = gt + 1;
  }
  if (stack.length) return 'unclosed ' + stack.pop();
  return roots === 1 ? '' : 'roots=' + roots;
}
function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbexp-')), made = [];
function tmpFile(name, data) { var f = path.join(tmp, name); fs.writeFileSync(f, data); made.push(f); return f; }

// ---- zip ----
var bin = new Uint8Array(300); for (var q = 0; q < 300; q++) bin[q] = (q * 7) & 255;
var z = X.zip([{ name: '[Content_Types].xml', data: '<a/>' }, { name: 'dir/b.bin', data: bin }, { name: 'ué.txt', data: 'héllo' }, { name: 'empty', data: '' }]);
var ents = readZip(z);
eq(ents.map(function (e) { return e.name; }).join('|'), '[Content_Types].xml|dir/b.bin|ué.txt|empty', 'zip names and order');
ok(ents.every(function (e) { return e.meth === 0 && e.cs === e.us; }), 'zip stored');
ok(ents.every(function (e) { return crc(e.data) === e.crc; }), 'zip crc matches payload');
eq(ents[1].us, 300, 'zip size');
eq(dec.decode(ents[2].data), 'héllo', 'zip utf8 payload');
ok(Buffer.compare(Buffer.from(X.zip([{ name: 'a', data: 'x' }])), Buffer.from(X.zip([{ name: 'a', data: 'x' }]))) === 0, 'zip deterministic');
if (has('unzip')) { var zf = tmpFile('t.zip', z); eq(cp.spawnSync('unzip', ['-tq', zf]).status, 0, 'unzip -tq accepts zip'); }
else console.log('note: unzip not found, skipped');

// ---- pptx ----
var PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
var weird = 'A&B <tag> "q"\nline2 😀 end';
var deck = {
  title: 'Deck & Co', slides: [
    {
      title: 'First <1>', w: 1600, h: 900, ink: null, items: [
        { k: 'note', id: 'n1', x: 100, y: 100, w: 200, h: 150, tx: 'Plain', fill: '#ffee58', color: '#111111', votes: 0 },
        { k: 'note', id: 'n2', x: 400, y: 100, w: 200, h: 150, tx: 'Voted', fill: '#80deea', color: '#000000', votes: 3 },
        { k: 'note', id: 'n3', x: 700, y: 100, w: 200, h: 150, tx: weird, fill: '#f48fb1', color: '#222222', votes: 0 },
        { k: 'rect', id: 'r1', x: 100, y: 400, w: 200, h: 100, tx: 'R', fill: '#ffffff', stroke: '#336699' },
        { k: 'ell', id: 'e1', x: 500, y: 400, w: 200, h: 100, tx: 'E', fill: null, stroke: '#993366' },
        { k: 'dia', id: 'd1', x: 900, y: 400, w: 200, h: 100, tx: 'D', fill: '#cccccc', stroke: '#000000' },
        { k: 'text', id: 't1', x: 100, y: 700, w: 300, h: 60, tx: 'Free text', color: '#333333', sz: 24 },
        { k: 'group', id: 'g1', x: 1200, y: 50, w: 350, h: 300, tx: 'Group', stroke: '#888888' },
        { k: 'line', id: 'l1', x: 900, y: 700, x2: 600, y2: 600, ar: 0, stroke: '#ff0000', a: null, b: null },
        { k: 'line', id: 'l2', x: 300, y: 450, x2: 500, y2: 450, ar: 1, stroke: '#00aa00', a: 'r1', b: 'e1' }
      ]
    },
    { title: 'Second', w: 800, h: 800, ink: PNG, items: [{ k: 'note', id: 'x', x: 10, y: 10, w: 100, h: 100, tx: 'Only', fill: '#ffffff', color: '#000000', votes: 0 }] }
  ]
};
var pp = X.pptx(deck);
var P = {}; readZip(pp).forEach(function (e) { P[e.name] = e; });
var names = readZip(pp).map(function (e) { return e.name; });
eq(names[0], '[Content_Types].xml', 'pptx content types first');
['_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels',
  'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml',
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/theme/theme1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml',
  'ppt/slides/_rels/slide1.xml.rels', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/media/ink1.png'].forEach(function (n) { ok(!!P[n], 'part ' + n); });
function txt(n) { return dec.decode(P[n].data); }
var bad = 0;
names.forEach(function (n) { if (/\.(xml|rels)$/.test(n)) { var r = wellFormed(txt(n)); if (r) { bad++; console.log('FAIL xml ' + n + ': ' + r); fail++; } } });
if (!bad) { pass++; console.log('ok ' + pass + ' all xml parts well-formed'); }
ok(wellFormed('<a b="1&"/>') !== '' && wellFormed('<a><b></a>') !== '' && wellFormed('<a>&x;</a>') !== '', 'checker rejects bad xml');
var pres = txt('ppt/presentation.xml'), prels = txt('ppt/_rels/presentation.xml.rels');
eq((pres.match(/<p:sldId /g) || []).length, 2, 'presentation slide count');
eq((prels.match(/relationships\/slide"/g) || []).length, 2, 'presentation rels slide count');
ok(/<p:sldSz cx="12192000" cy="6858000"\/>/.test(pres) && /<p:sldMasterIdLst>/.test(pres) && /<p:notesSz /.test(pres), 'presentation sldSz/master/notesSz');
ok(/id="256"/.test(pres) && /id="257"/.test(pres), 'slide ids from 256');
ok(/Extension="png" ContentType="image\/png"/.test(txt('[Content_Types].xml')), 'content types cover png');
var th = txt('ppt/theme/theme1.xml');
ok(/<a:clrScheme/.test(th) && /<a:fontScheme/.test(th) && (th.match(/<a:effectStyle>/g) || []).length === 3 && (th.match(/<a:ln /g) || []).length === 3, 'theme complete');

var s1 = txt('ppt/slides/slide1.xml');
eq((s1.match(/<p:sp>/g) || []).length, 8, 'slide1 sp count');
eq((s1.match(/<p:cxnSp>/g) || []).length, 2, 'slide1 cxnSp count');
eq((s1.match(/prst="rect"/g) || []).length, 5, 'rect geoms (3 notes, rect, text box)');
eq((s1.match(/prst="ellipse"/g) || []).length, 1, 'ellipse');
eq((s1.match(/prst="diamond"/g) || []).length, 1, 'diamond');
eq((s1.match(/prst="roundRect"/g) || []).length, 1, 'roundRect');
eq((s1.match(/prst="line"/g) || []).length, 2, 'line geoms');
eq((s1.match(/txBox="1"/g) || []).length, 1, 'one text box');
ok(s1.indexOf('<p:cSld name="First &lt;1&gt;">') >= 0, 'slide title in cSld name');
ok(s1.indexOf('FFEE58') >= 0 && s1.indexOf('80DEEA') >= 0 && s1.indexOf('Plain') >= 0, 'note fill and text');
eq((s1.match(/●/g) || []).length, 3, 'vote dots');
ok(/<a:normAutofit\/>/.test(s1) && /<a:prstDash val="dash"\/>/.test(s1), 'autofit and dashed group');
var ids = (s1.match(/<p:cNvPr id="(\d+)"/g) || []).map(function (t) { return +/\d+/.exec(t)[0]; });
eq(new Set(ids).size, ids.length, 'slide1 shape ids unique');
ok(ids[0] === 1 && Math.min.apply(null, ids.slice(1)) === 2, 'shape ids start at 2');
var refs = (s1.match(/<a:(stCxn|endCxn) id="\d+"/g) || []).map(function (t) { return +/\d+/.exec(t)[0]; });
ok(/<a:stCxn /.test(s1) && /<a:endCxn /.test(s1) && refs.length === 2 && refs.every(function (r) { return ids.indexOf(r) >= 0; }), 'connection ids exist');
eq((s1.match(/<a:tailEnd type="triangle"\/>/g) || []).length, 1, 'tailEnd only on arrow');
var cx = s1.match(/<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g);
ok(/flipH="1"/.test(cx[0]) && /flipV="1"/.test(cx[0]) && !/stCxn/.test(cx[0]), 'up-left line is flipped');
ok(!/flip/.test(cx[1]) && /stCxn id="\d+" idx="3"/.test(cx[1]) && /endCxn id="\d+" idx="2"/.test(cx[1]), 'arrow sites (rect right, ellipse left)');
ok(!/c[xy]="-/.test(s1), 'no negative extents');
var tt = (s1.match(/<a:t>[^<]*<\/a:t>/g) || []).map(function (t) { return unesc(t.slice(5, -6)); });
ok(tt.indexOf('A&B <tag> "q"') >= 0 && tt.indexOf('line2 😀 end') >= 0, 'escaped text round-trips');

var s2 = txt('ppt/slides/slide2.xml'), r2 = txt('ppt/slides/_rels/slide2.xml.rels');
eq((s2.match(/<p:pic>/g) || []).length, 1, 'slide2 has one pic');
ok(s2.indexOf('<p:pic>') < s2.indexOf('<p:sp>'), 'pic first in tree');
var emb = /r:embed="([^"]+)"/.exec(s2)[1], tgt = new RegExp('Id="' + emb + '"[^>]*Target="([^"]+)"').exec(r2) || new RegExp('Target="([^"]+)"[^>]*Id="' + emb + '"').exec(r2);
var mp = tgt && path.posix.normalize(path.posix.join('ppt/slides', tgt[1]));
ok(mp && P[mp] && Buffer.compare(Buffer.from(P[mp].data), Buffer.from(PNG)) === 0, 'pic embed resolves to the input PNG');
ok(/Extension="png"/.test(txt('[Content_Types].xml')), 'png default present');
ok(!/<p:pic>/.test(s1) && !/ink/.test(txt('ppt/slides/_rels/slide1.xml.rels')), 'slide1 has no ink');
ok(Buffer.compare(Buffer.from(pp), Buffer.from(X.pptx(deck))) === 0, 'pptx deterministic');
eq(readZip(X.pptx({ title: '', slides: [] })).filter(function (e) { return /^ppt\/slides\/slide\d+\.xml$/.test(e.name); }).length, 1, 'empty deck gets one slide');
ok(readZip(pp).every(function (e) { return crc(e.data) === e.crc; }), 'pptx crc ok');
if (has('unzip')) eq(cp.spawnSync('unzip', ['-tq', tmpFile('t.pptx', pp)]).status, 0, 'unzip -tq accepts pptx');
if (has('python3')) {
  var pf = tmpFile('p.pptx', pp);
  var code = 'import sys,zipfile\nfrom xml.dom import minidom\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nn=0\n' +
    'for i in z.namelist():\n  if i.endswith(".xml") or i.endswith(".rels"):\n    minidom.parseString(z.read(i)); n+=1\nprint(n)\n';
  var r = cp.spawnSync('python3', ['-I', '-c', code, pf], { encoding: 'utf8' });
  ok(r.status === 0 && +r.stdout > 10, 'python zipfile + minidom parse every xml part' + (r.status ? ' ' + r.stderr : ''));
} else console.log('note: python3 not found, skipped');

// ---- pdf ----
var jpg = new Uint8Array(40); jpg[0] = 0xff; jpg[1] = 0xd8; jpg[38] = 0xff; jpg[39] = 0xd9; for (q = 2; q < 38; q++) jpg[q] = (q * 13) & 255;
var jpg2 = new Uint8Array(25); jpg2[0] = 0xff; jpg2[1] = 0xd8; jpg2[23] = 0xff; jpg2[24] = 0xd9;
var pd = X.pdf({ pages: [{ w: 612, h: 792, jpeg: jpg, pxW: 10, pxH: 12 }, { w: 792, h: 612, jpeg: jpg2, pxW: 20, pxH: 8 }] });
var ps = Buffer.from(pd).toString('latin1');
ok(ps.indexOf('%PDF-1.4') === 0, 'pdf header');
ok(/%%EOF\n$/.test(ps), 'pdf EOF');
var sx = +/startxref\n(\d+)\n/.exec(ps)[1];
eq(ps.substr(sx, 4), 'xref', 'startxref points at xref');
var xl = ps.slice(sx).split('\n'), cnt = +xl[1].split(' ')[1], good = true;
for (q = 1; q < cnt; q++) { var off = +xl[2 + q].slice(0, 10); if (ps.substr(off, (q + ' 0 obj').length) !== q + ' 0 obj') good = false; }
ok(good && cnt === 9, 'every xref offset points at N 0 obj');
eq((ps.match(/\/Type \/Page /g) || []).length, 2, 'pdf page count');
ok(/\/Count 2/.test(ps) && /\/MediaBox \[0 0 792 612\]/.test(ps), 'pdf count and landscape mediabox');
eq((ps.match(/\/DCTDecode/g) || []).length, 2, 'DCTDecode present');
var lens = (ps.match(/\/DCTDecode \/Length (\d+)/g) || []).map(function (t) { return +/(\d+)$/.exec(t)[1]; });
eq(lens.join(','), '40,25', 'stream Length equals jpeg length');
var at = ps.indexOf('stream\n', ps.indexOf('/DCTDecode')) + 7;
ok(Buffer.compare(Buffer.from(pd.subarray(at, at + 40)), Buffer.from(jpg)) === 0 && ps.substr(at + 40, 10) === '\nendstream', 'jpeg bytes intact');

// remove only what this test made
made.forEach(function (f) { try { fs.unlinkSync(f); } catch (e) { } });
try { fs.rmdirSync(tmp); } catch (e) { }
console.log('export: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
