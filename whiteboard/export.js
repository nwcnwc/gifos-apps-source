// Whiteboard exporter: ZIP (stored), PPTX (native shapes) and PDF (JPEG pages).
// Pure and dependency-free: no DOM, no network. Output is deterministic (fixed dates).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.WB = root.WB || {}).Export = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var enc = new TextEncoder();
  function bytes(d) { return typeof d === 'string' ? enc.encode(d) : d; }

  // Join byte chunks into one Uint8Array.
  function concat(chunks) {
    var n = 0, i, out, p = 0;
    for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    out = new Uint8Array(n);
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
    return out;
  }

  // ---------- ZIP ----------
  var CRC = (function () {
    var t = new Uint32Array(256), n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xffffffff, i;
    for (i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Method 0 (stored); date fixed at 1980-01-01 00:00 so the same input gives the same bytes.
  function zip(files) {
    var parts = [], cen = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = bytes(f.data), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true);
      ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      cen.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    var cd = concat(cen), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cd.length, true); end.setUint32(16, off, true);
    parts.push(cd, new Uint8Array(end.buffer));
    return concat(parts);
  }

  // ---------- XML helpers ----------
  // Strip characters XML 1.0 forbids, then escape the five specials.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hex(c, dflt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    return m ? m[1].toUpperCase() : dflt || '000000';
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function n(v) { return Math.round(v); }
  var HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  function rels(list) {
    return HDR + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map(function (r) {
        return '<Relationship Id="' + r[0] + '" Type="' + (r[1].indexOf('http') === 0 ? r[1] : REL + r[1]) +
          '" Target="' + r[2] + '"/>';
      }).join('') + '</Relationships>';
  }
  function solid(c) { return '<a:solidFill><a:srgbClr val="' + hex(c) + '"/></a:solidFill>'; }

  // ---------- PPTX ----------
  var SW = 12192000, SH = 6858000;

  // Paragraphs from text; `extra` is an optional pre-built paragraph (votes).
  function paras(tx, pt, color, algn, extra) {
    var sz = n(pt * 100), out = String(tx == null ? '' : tx).replace(/\r/g, '').split('\n').map(function (line) {
      if (!line) return '<a:p><a:pPr algn="' + algn + '"/><a:endParaRPr sz="' + sz + '"/></a:p>';
      return '<a:p><a:pPr algn="' + algn + '"/><a:r><a:rPr sz="' + sz + '" dirty="0">' + solid(color) +
        '</a:rPr><a:t>' + esc(line) + '</a:t></a:r></a:p>';
    }).join('');
    return out + (extra || '');
  }
  function body(inner, anchor, auto, ins) {
    return '<p:txBody><a:bodyPr wrap="square" lIns="' + ins + '" tIns="' + ins + '" rIns="' + ins + '" bIns="' + ins +
      '" rtlCol="0" anchor="' + anchor + '">' + (auto ? '<a:normAutofit/>' : '<a:noAutofit/>') + '</a:bodyPr><a:lstStyle/>' + inner + '</p:txBody>';
  }
  function xfrm(x, y, w, h, flip) {
    return '<a:xfrm' + (flip || '') + '><a:off x="' + n(x) + '" y="' + n(y) + '"/><a:ext cx="' + n(w) + '" cy="' + n(h) + '"/></a:xfrm>';
  }
  function sp(id, name, tb, geom, X, ln, fill, effect, txBody) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + esc(name) + '"/><p:cNvSpPr' + (tb ? ' txBox="1"' : '') +
      '/><p:nvPr/></p:nvSpPr><p:spPr>' + X + '<a:prstGeom prst="' + geom + '"><a:avLst/></a:prstGeom>' +
      fill + ln + (effect || '') + '</p:spPr>' + txBody + '</p:sp>';
  }
  var NOLN = '<a:ln><a:noFill/></a:ln>';
  var SHADOW = '<a:effectLst><a:outerShdw blurRad="63500" dist="25400" dir="5400000" algn="t" rotWithShape="0">' +
    '<a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr></a:outerShdw></a:effectLst>';

  // Connection site nearest to point (px,py) on box b: 0 top, 1 left, 2 bottom, 3 right.
  // An ellipse has 8 sites in PowerPoint, so its four cardinal ones are 0, 2, 4, 6.
  function site(b, px, py) {
    var d = [Math.abs(py - b.y), Math.abs(px - b.x), Math.abs(py - (b.y + b.h)), Math.abs(px - (b.x + b.w))];
    var best = 0, i;
    for (i = 1; i < 4; i++) if (d[i] < d[best]) best = i;
    return b.k === 'ell' ? best * 2 : best;
  }

  function slideXml(s, inkRid) {
    var W = s.w > 0 ? s.w : 1, H = s.h > 0 ? s.h : 1;
    var sc = Math.min(SW * 0.94 / W, SH * 0.94 / H);
    var ox = (SW - W * sc) / 2, oy = (SH - H * sc) / 2;
    var X = function (v) { return ox + v * sc; }, Y = function (v) { return oy + v * sc; };
    var ptScale = sc / 12700, items = s.items || [], next = 2, shapes = [], ids = {}, byId = {};
    var picId = inkRid ? next++ : 0;
    items.forEach(function (it) { ids[it.id] = next++; byId[it.id] = it; });

    // The drawing covers the whole slide area, or just inkRect {x, y, w, h} when the caller cropped it.
    if (inkRid) {
      shapes.push('<p:pic><p:nvPicPr><p:cNvPr id="' + picId + '" name="Drawing"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>' +
        '<p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + inkRid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
        '<p:spPr>' + (s.inkRect ? xfrm(X(s.inkRect.x), Y(s.inkRect.y), s.inkRect.w * sc, s.inkRect.h * sc) : xfrm(ox, oy, W * sc, H * sc)) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>');
    }
    items.forEach(function (it) {
      var id = ids[it.id], k = it.k, nm = k + ' ' + id, x, y, w, h, X0, c;
      if (k === 'line') {
        var ax = X(it.x), ay = Y(it.y), bx = X(it.x2), by = Y(it.y2);
        var flip = (bx < ax ? ' flipH="1"' : '') + (by < ay ? ' flipV="1"' : '');
        var cx = '';
        [['a', 'stCxn', it.x, it.y], ['b', 'endCxn', it.x2, it.y2]].forEach(function (e) {
          var t = byId[it[e[0]]];
          if (t && t.k !== 'line' && it[e[0]] !== it.id) cx += '<a:' + e[1] + ' id="' + ids[t.id] + '" idx="' + site(t, e[2], e[3]) + '"/>';
        });
        shapes.push('<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + id + '" name="' + nm + '"/><p:cNvCxnSpPr>' + cx + '</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>' +
          '<p:spPr>' + xfrm(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), flip) +
          '<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050">' + solid(it.stroke) +
          (it.ar ? '<a:tailEnd type="triangle"/>' : '') + '</a:ln></p:spPr></p:cxnSp>');
        return;
      }
      x = X(it.x); y = Y(it.y); w = it.w * sc; h = it.h * sc; X0 = xfrm(x, y, w, h);
      if (k === 'note') {
        var pt = clamp(Math.min(it.w, it.h) * ptScale * 0.2, 8, 40), v = Math.max(0, it.votes | 0);
        var dots = v ? '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="' + n(pt * 70) + '" dirty="0">' + solid(it.color) +
          '</a:rPr><a:t>' + new Array(v + 1).join('●') + '</a:t></a:r></a:p>' : '';
        shapes.push(sp(id, nm, false, 'rect', X0, NOLN, solid(it.fill), SHADOW,
          body(paras(it.tx, pt, it.color, 'ctr', dots), 'ctr', true, 91440)));
      } else if (k === 'text') {
        shapes.push(sp(id, nm, true, 'rect', X0, NOLN, '<a:noFill/>', '',
          body(paras(it.tx, clamp((it.sz || 16) * ptScale, 8, 96), it.color, 'l'), 't', false, 0)));
      } else if (k === 'group') {
        c = '#666666';
        shapes.push(sp(id, nm, false, 'roundRect', X0, '<a:ln w="12700">' + solid(c) + '<a:prstDash val="dash"/></a:ln>', '<a:noFill/>', '',
          body(paras(it.tx, clamp(Math.min(it.w, it.h) * ptScale * 0.1, 8, 14), c, 'l'), 't', false, 45720)));
      } else {
        var g = k === 'ell' ? 'ellipse' : k === 'dia' ? 'diamond' : 'rect';
        shapes.push(sp(id, nm, false, g, X0, '<a:ln w="19050">' + solid(it.stroke) + '</a:ln>',
          it.fill ? solid(it.fill) : '<a:noFill/>', '',
          body(paras(it.tx, clamp(Math.min(it.w, it.h) * ptScale * 0.15, 8, 28), it.stroke, 'ctr'), 'ctr', true, 45720)));
      }
    });
    return HDR + '<p:sld ' + NS + '><p:cSld name="' + esc(s.title) + '"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      shapes.join('') + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function fillLn(i) { return '<a:ln w="' + (6350 + i * 12700) + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'; }
  var THEME = HDR + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>' +
    '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="Office"><a:fillStyleLst>' + [0, 1, 2].map(function () { return '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'; }).join('') +
    '</a:fillStyleLst><a:lnStyleLst>' + [0, 1, 2].map(fillLn).join('') + '</a:lnStyleLst><a:effectStyleLst>' +
    [0, 1, 2].map(function () { return '<a:effectStyle><a:effectLst/></a:effectStyle>'; }).join('') +
    '</a:effectStyleLst><a:bgFillStyleLst>' + [0, 1, 2].map(function () { return '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'; }).join('') +
    '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

  var EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
  var LVL = '<a:lvl1pPr algn="l"><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr>';
  var MASTER = HDR + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' +
    EMPTY_TREE + '</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
    'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '<p:txStyles><p:titleStyle>' + LVL + '</p:titleStyle><p:bodyStyle>' + LVL + '</p:bodyStyle><p:otherStyle>' + LVL + '</p:otherStyle></p:txStyles></p:sldMaster>';
  var LAYOUT = HDR + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank">' + EMPTY_TREE +
    '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

  function pptx(deck) {
    var slides = deck && deck.slides && deck.slides.length ? deck.slides : [{ title: '', w: 1600, h: 900, ink: null, items: [] }];
    var title = (deck && deck.title) || '';
    var files = [], ct = [], media = 0, i;
    var ov = function (part, type) { ct.push('<Override PartName="/' + part + '" ContentType="application/vnd.openxmlformats-officedocument.' + type + '+xml"/>'); };
    var slideFiles = [];
    slides.forEach(function (s, idx) {
      var N = idx + 1, r = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']], rid = null;
      if (s.ink) {
        media++;
        rid = 'rId2';
        r.push([rid, 'image', '../media/ink' + media + '.png']);
        slideFiles.push({ name: 'ppt/media/ink' + media + '.png', data: s.ink });
      }
      slideFiles.push({ name: 'ppt/slides/slide' + N + '.xml', data: slideXml(s, rid) });
      slideFiles.push({ name: 'ppt/slides/_rels/slide' + N + '.xml.rels', data: rels(r) });
      ov('ppt/slides/slide' + N + '.xml', 'presentationml.slide');
    });
    var presRels = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']], ids = '';
    for (i = 0; i < slides.length; i++) {
      presRels.push(['rId' + (i + 2), 'slide', 'slides/slide' + (i + 1) + '.xml']);
      ids += '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>';
    }
    presRels.push(['rId' + (slides.length + 2), 'theme', 'theme/theme1.xml']);
    ov('ppt/presentation.xml', 'presentationml.presentation.main');
    ov('ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster');
    ov('ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout');
    ov('ppt/theme/theme1.xml', 'theme');
    ct.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
    ov('docProps/app.xml', 'extended-properties');
    files.push({
      name: '[Content_Types].xml', data: HDR + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' + ct.join('') + '</Types>'
    });
    files.push({
      name: '_rels/.rels', data: rels([
        ['rId1', 'officeDocument', 'ppt/presentation.xml'],
        ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
        ['rId3', 'extended-properties', 'docProps/app.xml']])
    });
    files.push({
      name: 'docProps/app.xml', data: HDR + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
        '<Application>Microsoft Office PowerPoint</Application><Slides>' + slides.length + '</Slides></Properties>'
    });
    files.push({
      name: 'docProps/core.xml', data: HDR + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + esc(title) + '</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">2000-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>'
    });
    files.push({
      name: 'ppt/presentation.xml', data: HDR + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldIdLst>' + ids + '</p:sldIdLst><p:sldSz cx="' + SW + '" cy="' + SH + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'
    });
    files.push({ name: 'ppt/_rels/presentation.xml.rels', data: rels(presRels) });
    files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER });
    files.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) });
    files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT });
    files.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) });
    files.push({ name: 'ppt/theme/theme1.xml', data: THEME });
    return zip(files.concat(slideFiles));
  }

  // ---------- PDF ----------
  function pdf(doc) {
    var pages = doc.pages || [], chunks = [], offs = [], pos = 0;
    var put = function (b) { b = bytes(b); chunks.push(b); pos += b.length; };
    var obj = function (id, head, stream) {
      offs[id] = pos;
      put(id + ' 0 obj\n' + head);
      if (stream) { put('\nstream\n'); put(stream); put('\nendstream'); }
      put('\nendobj\n');
    };
    var kids = pages.map(function (p, i) { return (3 + i * 3) + ' 0 R'; }).join(' ');
    put('%PDF-1.4\n%âãÏÓ\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids + '] >>');
    pages.forEach(function (p, i) {
      var pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
      var content = 'q ' + p.w + ' 0 0 ' + p.h + ' 0 0 cm /Im0 Do Q';
      obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.w + ' ' + p.h + '] /Contents ' + cid +
        ' 0 R /Resources << /XObject << /Im0 ' + iid + ' 0 R >> >> >>');
      obj(cid, '<< /Length ' + content.length + ' >>', enc.encode(content));
      obj(iid, '<< /Type /XObject /Subtype /Image /Width ' + p.pxW + ' /Height ' + p.pxH +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>', p.jpeg);
    });
    var total = 3 + pages.length * 3, xref = pos, s = 'xref\n0 ' + total + '\n0000000000 65535 f \n', i;
    for (i = 1; i < total; i++) s += ('0000000000' + offs[i]).slice(-10) + ' 00000 n \n';
    put(s + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return concat(chunks);
  }

  return { zip: zip, pptx: pptx, pdf: pdf, crc32: crc32 };
});
