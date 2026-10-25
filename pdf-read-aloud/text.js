/* Turn pdf.js getTextContent items into sentences.
 * Running headers and page numbers in the margin are dropped when they are easy
 * to see. Lines of a paragraph are joined. A long sentence is cut into bites
 * so a Text → speech provider can start speaking before the page is done.
 * Spoken units do not cross a page, so the highlight can follow page to page. */
(function (root) {
  'use strict';

  var MAX_BITE = 180;
  var TOP_MARGIN = 0.90;
  var BOTTOM_MARGIN = 0.12;

  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isPageNumber(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 32) return false;
    if (/^\d{1,4}$/.test(t)) return true;
    if (/^page\s+\d{1,4}$/i.test(t)) return true;
    if (/^(?:page\s+)?\d{1,4}\s*(?:\/|of)\s*\d{1,4}$/i.test(t)) return true;
    if (/^[-–—]\s*\d{1,4}\s*[-–—]$/.test(t)) return true;
    return false;
  }

  function inMargin(y, height) {
    var h = height || 792;
    if (!h) return false;
    var yn = y / h;
    return yn >= TOP_MARGIN || yn <= BOTTOM_MARGIN;
  }

  function itemBox(it) {
    var t = it && it.transform ? it.transform : [1, 0, 0, 1, 0, 0];
    var h = 0;
    if (it && it.height) h = Math.abs(it.height);
    if (!h) h = Math.abs(t[3]) || 8;
    return {
      str: it && it.str ? String(it.str) : '',
      x: t[4] || 0,
      y: t[5] || 0,
      w: it && it.width ? it.width : 0,
      h: h,
      transform: t
    };
  }

  function needsSpace(prev, next) {
    if (!prev || !next) return false;
    if (/\s$/.test(prev) || /^\s/.test(next)) return false;
    if (/[-–—]$/.test(prev)) return false;
    return true;
  }

  function copyRun(run, text) {
    return {
      text: text,
      page: run.page,
      transform: run.transform,
      width: run.width,
      height: run.height
    };
  }

  function trimRuns(runs) {
    var i;
    var out = runs.slice();
    while (out.length && /^\s+$/.test(out[0].text)) out.shift();
    while (out.length && /^\s+$/.test(out[out.length - 1].text)) out.pop();
    if (!out.length) return { text: '', runs: [] };
    out[0] = copyRun(out[0], out[0].text.replace(/^\s+/, ''));
    out[out.length - 1] = copyRun(out[out.length - 1], out[out.length - 1].text.replace(/\s+$/, ''));
    if (!out[0].text) out.shift();
    if (out.length && !out[out.length - 1].text) out.pop();
    var text = '';
    for (i = 0; i < out.length; i++) text += out[i].text;
    return { text: text, runs: out };
  }

  function buildLine(items, pageNo) {
    var runs = [];
    var text = '';
    var i;
    var h = 0;
    for (i = 0; i < items.length; i++) {
      var s = items[i].str;
      if (!s) continue;
      if (items[i].h > h) h = items[i].h;
      if (text && needsSpace(text, s)) {
        runs.push({ text: ' ', page: pageNo });
        text += ' ';
      }
      runs.push({
        text: s,
        page: pageNo,
        transform: items[i].transform,
        width: items[i].w,
        height: items[i].h
      });
      text += s;
    }
    var trimmed = trimRuns(runs);
    return { text: trimmed.text, runs: trimmed.runs, h: h };
  }

  function linesFromItems(items, page) {
    var height = page && page.height ? page.height : 792;
    var pageNo = page && page.page ? page.page : 1;
    var boxes = [];
    var i;
    var list = items || [];
    for (i = 0; i < list.length; i++) {
      var b = itemBox(list[i]);
      if (!b.str) continue;
      boxes.push(b);
    }
    boxes.sort(function (a, b) {
      if (Math.abs(a.y - b.y) > 0.5) return b.y - a.y;
      return a.x - b.x;
    });
    var heights = [];
    for (i = 0; i < boxes.length; i++) heights.push(boxes[i].h);
    heights.sort(function (a, b) { return a - b; });
    var med = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
    var yTol = Math.max(2, med * 0.45);
    var lines = [];
    for (i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var line = lines.length ? lines[lines.length - 1] : null;
      if (line && Math.abs(line.y - box.y) <= yTol) {
        line.items.push(box);
        var n = line.items.length;
        line.y = (line.y * (n - 1) + box.y) / n;
      } else {
        lines.push({ y: box.y, items: [box] });
      }
    }
    var out = [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var built = buildLine(ln.items, pageNo);
      out.push({
        y: ln.y,
        text: built.text,
        runs: built.runs,
        h: built.h,
        page: pageNo,
        margin: inMargin(ln.y, height)
      });
    }
    return out;
  }

  function dropChrome(pages) {
    var counts = Object.create(null);
    var p, i, lines, seen, key;
    for (p = 0; p < pages.length; p++) {
      lines = pages[p].lines || [];
      seen = Object.create(null);
      for (i = 0; i < lines.length; i++) {
        if (!lines[i].margin) continue;
        key = norm(lines[i].text);
        if (!key || seen[key]) continue;
        seen[key] = true;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    for (p = 0; p < pages.length; p++) {
      lines = pages[p].lines || [];
      for (i = 0; i < lines.length; i++) {
        key = norm(lines[i].text);
        if (!key) { lines[i].drop = true; continue; }
        if (lines[i].margin && isPageNumber(lines[i].text)) { lines[i].drop = true; continue; }
        if (lines[i].margin && counts[key] >= 2 && key.length <= 80) { lines[i].drop = true; continue; }
        lines[i].drop = false;
      }
    }
    return pages;
  }

  function abbrevBefore(text, dotIndex) {
    var upto = text.slice(0, dotIndex + 1);
    // St. / Mr. / Mrs. / Dr. / Mt. are names and places, not sentence ends,
    // even when the next word is capitalized ("St. Thomas").
    // e.g. / i.e. / vs. / etc. before a capital are ambiguous; keeping them
    // inside the sentence avoids a pause in the middle of the phrase.
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc)\.$/i.test(upto)) return true;
    if (/\b(?:e\.g|i\.e|U\.S|U\.K)\.$/i.test(upto)) return true;
    if (/(?:^|[\s(])[A-Z]\.$/.test(upto)) return true;
    return false;
  }

  function pushBites(ranges, text, a, b) {
    var at = a;
    while (at < b) {
      var rest = b - at;
      var end;
      if (rest <= MAX_BITE) {
        end = b;
      } else {
        var window = text.slice(at, at + MAX_BITE);
        var rel = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(' '));
        if (rel < 40) rel = MAX_BITE;
        else rel += 1;
        end = at + rel;
      }
      var raw = text.slice(at, end);
      var lead = raw.match(/^\s*/)[0].length;
      var piece = raw.slice(lead).replace(/\s+$/, '');
      if (piece && /[0-9A-Za-z]/.test(piece)) {
        ranges.push({ start: at + lead, end: at + lead + piece.length, text: piece });
      }
      at = end;
      while (text[at] === ' ') at++;
    }
  }

  function sentenceRanges(text) {
    var ranges = [];
    var start = 0;
    var i = 0;
    function flush(end) {
      var raw = text.slice(start, end);
      var lead = raw.match(/^\s*/)[0].length;
      var piece = raw.slice(lead).replace(/\s+$/, '');
      if (piece && /[0-9A-Za-z]/.test(piece)) pushBites(ranges, text, start + lead, start + lead + piece.length);
      start = end;
    }
    while (i < text.length) {
      var ch = text[i];
      if (ch === '\n') {
        flush(i);
        while (text[i] === '\n' || text[i] === ' ') i++;
        start = i;
        continue;
      }
      if (/[.!?]/.test(ch)) {
        var next = text[i + 1];
        var boundary = (next == null || /\s/.test(next));
        if (boundary && !abbrevBefore(text, i)) {
          flush(i + 1);
          i = i + 1;
          while (text[i] === ' ') i++;
          start = i;
          continue;
        }
      }
      i++;
    }
    if (start < text.length) flush(text.length);
    return ranges;
  }

  function median(nums) {
    if (!nums.length) return 0;
    var hs = nums.slice().sort(function (a, b) { return a - b; });
    return hs[Math.floor((hs.length - 1) / 2)];
  }

  function isHeading(line, lines) {
    if (!line || !line.text || !line.h) return false;
    if (line.text.length > 80) return false;
    if (/[,;:]$/.test(line.text) || /[-–—]$/.test(line.text)) return false;
    if (/[.!?]$/.test(line.text)) return false;
    var others = [];
    var i;
    for (i = 0; i < lines.length; i++) {
      if (lines[i] === line) continue;
      if (lines[i].h) others.push(lines[i].h);
    }
    var med = median(others);
    if (!med) return false;
    return line.h >= med * 1.35;
  }

  function lastChar(stream) {
    var i;
    for (i = stream.length - 1; i >= 0; i--) {
      var t = stream[i].text || '';
      if (!t) continue;
      return t.charAt(t.length - 1);
    }
    return '';
  }

  function stripTrailingHyphen(stream) {
    var i;
    for (i = stream.length - 1; i >= 0; i--) {
      var t = stream[i].text || '';
      if (!t || /^\s+$/.test(t)) continue;
      var next = t.replace(/[-–—]\s*$/, '');
      stream[i] = copyRun(stream[i], next);
      if (!next) stream.splice(i, 1);
      return;
    }
  }

  function runsOverlapping(stream, start, end) {
    var out = [];
    var at = 0;
    var i;
    for (i = 0; i < stream.length; i++) {
      var t = stream[i].text || '';
      var next = at + t.length;
      if (next > start && at < end && stream[i].transform) out.push(stream[i]);
      at = next;
    }
    return out;
  }

  function pagesToSentences(rawPages) {
    var pages = [];
    var p, i;
    for (p = 0; p < (rawPages || []).length; p++) {
      var src = rawPages[p] || {};
      var lines = src.lines;
      if (!lines) lines = linesFromItems(src.items || [], src);
      pages.push({
        page: src.page || (p + 1),
        width: src.width || 612,
        height: src.height || 792,
        lines: lines
      });
    }
    dropChrome(pages);

    var stream = [];
    for (p = 0; p < pages.length; p++) {
      var kept = [];
      var linesAll = pages[p].lines || [];
      for (i = 0; i < linesAll.length; i++) {
        if (!linesAll[i].drop && linesAll[i].text) kept.push(linesAll[i]);
      }
      if (p > 0 && stream.length && lastChar(stream) !== '\n') {
        stream.push({ text: '\n', page: pages[p].page });
      }
      for (i = 0; i < kept.length; i++) {
        var ln = kept[i];
        var heading = isHeading(ln, kept);
        if (stream.length) {
          var end = lastChar(stream);
          if (heading) {
            if (end !== '\n') stream.push({ text: '\n', page: ln.page });
          } else if ((end === '-' || end === '–' || end === '—') && /^[a-z]/.test(ln.text)) {
            stripTrailingHyphen(stream);
          } else if (end !== '\n' && end !== ' ') {
            stream.push({ text: ' ', page: ln.page });
          }
        }
        var r;
        for (r = 0; r < ln.runs.length; r++) stream.push(ln.runs[r]);
        if (heading) stream.push({ text: '\n', page: ln.page });
      }
    }

    var full = '';
    for (i = 0; i < stream.length; i++) full += stream[i].text || '';
    var ranges = sentenceRanges(full);
    var sentences = [];
    for (i = 0; i < ranges.length; i++) {
      var rg = ranges[i];
      var runs = runsOverlapping(stream, rg.start, rg.end);
      var pageNo = 1;
      var k;
      for (k = 0; k < runs.length; k++) {
        if (runs[k].page) { pageNo = runs[k].page; break; }
      }
      sentences.push({ text: rg.text, page: pageNo, runs: runs });
    }
    return sentences;
  }

  /* Pasted text uses the same sentence and bite splitter as a page.
   * There is no margin, so nothing is treated as a running header. */
  function plainToSentences(text) {
    var ranges = sentenceRanges(String(text || '').replace(/\r\n/g, '\n'));
    var out = [];
    var i;
    for (i = 0; i < ranges.length; i++) {
      out.push({ text: ranges[i].text, page: 1, runs: [] });
    }
    return out;
  }

  root.PdfRead = {
    MAX_BITE: MAX_BITE,
    isPageNumber: isPageNumber,
    linesFromItems: linesFromItems,
    dropChrome: dropChrome,
    sentenceRanges: sentenceRanges,
    pagesToSentences: pagesToSentences,
    plainToSentences: plainToSentences
  };
})(typeof window !== 'undefined' ? window : this);
