// A two-page public-domain sample so first-run is not an empty page.
// Helvetica / Times are the built-in Type1 faces. Deterministic bytes.
// The text is original to this file.

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function T(font, size, x, y, text) {
  return 'BT /' + font + ' ' + size + ' Tf 1 0 0 1 ' + x + ' ' + y + ' Tm (' + esc(text) + ') Tj ET\n';
}

function lines(font, size, x, y, leading, arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += T(font, size, x, y - i * leading, arr[i]);
  return s;
}

function bar() {
  return '0.77 0.36 0.16 rg 54 742 504 8 re f\n0 0 0 rg\n';
}

function page1() {
  let s = '';
  s += bar();
  s += T('Fh', 9, 72, 760, 'Paper and Voice');
  s += T('Fb', 22, 72, 700, 'A page, read aloud');
  s += lines('Fr', 12, 72, 660, 18, [
    'A sheet of paper can be heard as well as seen.',
    'This note is two pages. It lives in the app.',
    'Nothing here is uploaded. Close the app and open',
    'it again. The same page is waiting.',
    'Press Play. The voice reads one sentence, then',
    'the next. The line you hear is marked on the page.',
  ]);
  s += T('Fh', 9, 300, 40, '1');
  return s;
}

function page2() {
  let s = '';
  s += bar();
  s += T('Fh', 9, 72, 760, 'Paper and Voice');
  s += T('Fb', 22, 72, 700, 'Where the voice comes from');
  s += lines('Fr', 12, 72, 660, 18, [
    'The voice is not inside this app. It is the Text',
    'to speech voice already on this computer.',
    'Install Offline TTS from the store if no voice',
    'is assigned yet. Then press Play again.',
    'A scanned page is a picture of words. There is',
    'nothing to read aloud, and the app says so.',
  ]);
  s += T('Fh', 9, 300, 40, '2');
  return s;
}

export function samplePdfBytes() {
  const streams = [page1(), page2()];
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>';
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>';
  objs[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>';
  objs[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < 2; i++) {
    const contentId = 8 + i;
    const stream = streams[i];
    const len = Buffer.byteLength(stream, 'latin1');
    objs[3 + i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Fb 5 0 R /Fr 6 0 R /Fh 7 0 R >> >> /Contents ' + contentId + ' 0 R >>';
    objs[contentId] = '<< /Length ' + len + ' >>\nstream\n' + stream + 'endstream';
  }

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  const maxId = 9;
  for (let i = 1; i <= maxId; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  let xref = 'xref\n0 ' + (maxId + 1) + '\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= maxId; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += xref;
  out += 'trailer << /Size ' + (maxId + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
