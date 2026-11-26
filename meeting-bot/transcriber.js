/* Meeting Bot: the transcript of every meeting you host.
 *
 * Set up once ("Join and transcribe every meeting I host"). From then on, when this device hosts a
 * meeting, GifOS wakes this app (gifos.meet.onHostWake) and it joins as a declared bot seat. It
 * records only while the host's signed recording order stands (every page in the meeting shows the
 * notice from that order). Each person is recorded on their own, cut at their pauses and labelled with
 * their seat's name and language. When the meeting ends the clips are written down here with the
 * Speech to text model you picked (Whisper on this device by default), placed in time with the
 * pictures of shared screens, kept in this app, and the audio is thrown away and checked gone.
 */
(function () {
  'use strict';
  var POLL_MS = 2000, ORDER_WAIT_MS = 45000, HOST_GONE_MS = 60000, EMPTY_MS = 20000, STT_RETRY_MS = 3000;
  var T = window.MeetingTranscriber = { active: {}, log: [], audioHeld: 0, last: null };
  var el = function (id) { return document.getElementById(id); };
  if (!gifos.meet || typeof gifos.meet.hostBot !== 'function' || typeof gifos.meet.onHostWake !== 'function') {
    el('hb-on').disabled = true;
    el('hb-status').textContent = 'Transcribing the meetings you host needs a newer GifOS (0.9.28.36 or later).';
    return;
  }
  var setupDb = gifos.db('hostbot'), meetDb = gifos.db('meetings'), shotDb = gifos.db('shots');
  function note(text) {
    T.log.push({ at: Date.now(), text: text });
    if (T.log.length > 60) T.log.shift();
    var s = el('hb-status'); if (s) s.textContent = text;
  }

  // SETUP. The OS keeps the switch (it wakes the app); the app keeps the bot's name.
  function paintSetup(r) {
    el('hb-on').checked = !!(r && r.on);
    if (r && r.name) el('hb-name').value = r.name;
  }
  function saveSetup() {
    var on = el('hb-on').checked;
    var name = (el('hb-name').value || '').trim() || 'Meeting Bot';
    return gifos.meet.hostBot({ on: on, name: name }).then(function (r) {
      paintSetup(r);
      setupDb.put({ id: 'setup', name: name }).catch(function () {});
      note(r.on ? name + ' joins and transcribes every meeting you host on this device.' : 'Off: meetings you host are not transcribed.');
      return r;
    }, function (e) { el('hb-on').checked = false; note(String(e && e.message || e)); });
  }
  el('hb-on').addEventListener('change', saveSetup);
  el('hb-name').addEventListener('change', function () { if (el('hb-on').checked) saveSetup(); });
  setupDb.get('setup').then(function (row) { if (row && row.name) el('hb-name').value = row.name; }).catch(function () {});
  gifos.meet.hostBot().then(paintSetup).catch(function () {});

  // ONE HOSTED MEETING.
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function record(w) {
    var room = String(w.room || w.link || '');
    if (!w.link || T.active[room]) return;
    var job = T.active[room] = { room: room, tok: w.tok, host: w.host || '', started: Date.now(), clips: [], captions: [], id: '', seen: {}, phase: 'joining' };
    var name = (el('hb-name').value || '').trim() || 'Meeting Bot';
    note('Joining ' + (w.host ? w.host + "'s" : 'your') + ' meeting to transcribe it.');
    return gifos.meet.join(w.link, w.password || '', name, { bot: true, guest: true }).then(function (sess) {
      job.id = sess.meetingId;
      // Keep the room's transcript on this seat: the share pictures are taken only where a transcript is kept.
      return gifos.meet.transcribe(job.id, false).catch(function () {});
    }).then(function () { return waitOrder(job); }).then(function (ok) {
      if (!ok) { note('No recording order from the host came, so nothing was recorded.'); return leave(job).then(function () { return null; }); }
      job.phase = 'recording';
      job.order = ok;
      paintActive();
      note('Recording: ' + (ok.by || 'the host') + "'s order is shown to everyone in the meeting.");
      return gifos.meet.speakers(job.id, true).then(function () { return watch(job); });
    }).then(function (r) {
      if (job.phase === 'joining') delete T.active[room];
      return r;
    }, function (e) {
      note('The meeting bot stopped: ' + String(e && e.message || e));
      if (job.phase === 'recording') { job.why = 'The meeting bot stopped.'; return end(job); }
      delete T.active[room];
      return leave(job);
    });
  }
  function waitOrder(job) {
    var until = Date.now() + ORDER_WAIT_MS;
    var step = function () {
      return gifos.meet.hostOrder(job.id).then(function (o) {
        if (o && o.on && o.tok === job.tok) return o;
        if (Date.now() > until) return null;
        return wait(1000).then(step);
      }, function () { return Date.now() > until ? null : wait(1000).then(step); });
    };
    return step();
  }
  function pull(job) {
    return gifos.meet.speakerClips(job.id).then(function (r) {
      (r.clips || []).forEach(function (c) { job.clips.push(c); job.seen[c.id] = { name: c.name, lang: c.lang }; });
      T.audioHeld = countAudio();
    });
  }
  function watch(job) {
    var hostGoneAt = 0, emptyAt = 0;
    var loop = function () {
      if (job.phase !== 'recording') return null;
      return wait(POLL_MS).then(function () { return pull(job); }).then(function () { return gifos.meet.hostOrder(job.id); }).then(function (o) {
        var now = Date.now();
        if (!o || !o.on || o.tok !== job.tok) { job.why = 'The host stopped the recording.'; return end(job); }
        hostGoneAt = o.hostHere ? 0 : (hostGoneAt || now);
        emptyAt = o.people > 0 ? 0 : (emptyAt || now);
        if (hostGoneAt && now - hostGoneAt > HOST_GONE_MS) { job.why = 'The host left.'; return end(job); }
        if (emptyAt && now - emptyAt > EMPTY_MS) { job.why = 'Everyone left.'; return end(job); }
        paintActive();
        return loop();
      }, function (e) { job.why = 'The meeting ended (' + String(e && e.message || e) + ').'; return end(job); });
    };
    return loop();
  }
  function leave(job) { return job.id ? gifos.meet.leave(job.id).catch(function () {}) : Promise.resolve(); }
  function end(job) {
    if (job.phase !== 'recording') return null;
    job.phase = 'ending';
    note(job.why + ' Finishing the transcript.');
    var shots = [];
    return gifos.meet.speakers(job.id, false).catch(function () {})
      .then(function () { return pull(job).catch(function () {}); })
      .then(function () { return gifos.meet.shots(job.id).then(function (r) { shots = (r && r.shots) || []; }, function () {}); })
      .then(function () { return gifos.meet.speakerClips(job.id).then(function (r) { job.sessionHeld = r.held || 0; }, function () { job.sessionHeld = 0; }); })
      .then(function () { return leave(job); })
      .then(function () { job.shots = shots; return finish(job); });
  }

  // AFTER THE MEETING: write each clip down, place the pictures, keep it, throw the audio away.
  function names(job) {
    var out = [];
    Object.keys(job.seen).forEach(function (k) { var n = job.seen[k].name; if (n && out.indexOf(n) < 0) out.push(n); });
    if (job.host && out.indexOf(job.host) < 0) out.push(job.host);
    return out;
  }
  function transcribeAll(job) {
    var prompt = names(job).join(', ');
    job.clips.sort(function (a, b) { return a.at - b.at; });
    var said = {}, failed = {};
    var clean = function (t) { return String(t || '').replace(/\[[^\]]*\]|\([^)]*\)|[\u266a\u266b*]/g, ' ').replace(/\s+/g, ' ').trim(); };
    // One pass over the clips; a clip that fails (the model may still be arriving on this device on the first calls)
    // waits for a second pass, when the model is here. Each clip's audio is dropped as soon as it is written.
    var pass = function (list, n) {
      var i = 0;
      var next = function () {
        if (i >= list.length) return Promise.resolve();
        var c = list[i++];
        note('Writing down ' + i + ' of ' + list.length + (n ? ' (again)' : '') + (c.name ? ' (' + c.name + ')' : '') + '\u2026');
        return gifos.ai.stt({ bytes: c.bytes, mime: c.mime, language: c.lang || 'auto', prompt: prompt }).then(function (r) {
          said[c.at + c.id] = { c: c, text: clean(r && r.text), lang: (r && r.language) || c.lang || '' };
          delete failed[c.at + c.id];
          c.bytes = null;
        }, function (e) { failed[c.at + c.id] = { c: c, error: String(e && e.message || e) }; }).then(function () { T.audioHeld = countAudio(); return next(); });
      };
      return next();
    };
    return pass(job.clips, 0).then(function () {
      var again = Object.keys(failed).map(function (k) { return failed[k].c; });
      return again.length ? wait(STT_RETRY_MS).then(function () { return pass(again, 1); }) : null;
    }).then(function () {
      var lines = [];
      job.clips.forEach(function (c) {
        var k = c.at + c.id, ok = said[k], bad = failed[k];
        c.bytes = null;
        if (ok) { if (ok.text) lines.push({ at: c.at, end: c.end, byId: c.id, by: c.name || 'Someone', lang: ok.lang, text: ok.text }); return; }
        // The speech model could not write this clip: the meeting's own caption lines from that person at that time
        // stand in (said so in the line), and the audio is still deleted.
        var from = (job.captions || []).filter(function (x) { return x.by === c.name && x.at >= c.at - 2000 && x.at <= c.end + 6000 && !x.used; });
        from.forEach(function (x) { x.used = true; });
        var text = from.map(function (x) { return x.text; }).join(' ').trim();
        lines.push({ at: c.at, end: c.end, byId: c.id, by: c.name || 'Someone', lang: c.lang || '', text: text, src: text ? 'captions' : '', error: bad ? bad.error : 'not written' });
      });
      T.audioHeld = countAudio();
      return lines;
    });
  }
  function countAudio() {
    var n = 0;
    Object.keys(T.active).forEach(function (k) { (T.active[k].clips || []).forEach(function (c) { if (c && c.bytes) n++; }); });
    return n;
  }
  function finish(job) {
    var shots = job.shots || [];
    var lines = [];
    var go = job.clips.length ? transcribeAll(job) : Promise.resolve([]);
    return go.then(function (l) { lines = l; }).then(function () {
      // The audio check: no clip left in the meeting page nor in this app.
      job.clips.forEach(function (c) { c.bytes = null; });
      job.clips.length = 0;
      var appHeld = countAudio();
      var id = 'm' + job.started.toString(36);
      var rec = {
        id: id, room: job.room, host: job.host, bot: (job.order && job.order.bot) || '',
        orderBy: (job.order && job.order.by) || '', started: job.started, ended: Date.now(),
        speakers: Object.keys(job.seen).map(function (k) { return { id: k, name: job.seen[k].name, lang: job.seen[k].lang }; }),
        lines: lines, shots: shots.map(function (s, n) { return { id: id + '_s' + n, at: s.at, name: s.name || '', w: s.w, h: s.h, mime: s.mime }; }),
        audio: { deleted: job.sessionHeld === 0 && appHeld === 0, page: job.sessionHeld || 0, app: appHeld, at: Date.now() },
        why: job.why || ''
      };
      return Promise.all(shots.map(function (s, n) { return shotDb.put({ id: id + '_s' + n, meeting: id, mime: s.mime, bytes: new Uint8Array(s.bytes) }); }))
        .then(function () { return meetDb.put(rec); }).then(function () {
          T.last = rec;
          delete T.active[job.room];
          paintActive();
          note('Transcript ready: ' + lines.filter(function (l) { return l.text; }).length + ' lines, ' + shots.length + ' pictures. ' + (rec.audio.deleted ? 'The audio is deleted.' : 'Audio still held: check.'));
          return rec;
        });
    });
  }
  gifos.meet.onHostWake(function (w) { record(w); });
  // The meeting's live caption lines, kept only as a stand-in for a clip the speech model could not write.
  gifos.meet.onTranscriptLine(function (ev) {
    Object.keys(T.active).forEach(function (k) {
      var j = T.active[k];
      if (j.id && ev && ev.meetingId === j.id && ev.line && ev.line.text && !ev.line.self) j.captions.push({ at: ev.line.at || Date.now(), by: ev.line.by || '', text: String(ev.line.text) });
    });
  });

  // REVIEW: the meetings kept here, newest first.
  function fmtTime(ms) { var d = new Date(ms); return d.toLocaleString(); }
  function clock(ms, from) { var s = Math.max(0, Math.round((ms - from) / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function paintActive() {
    var box = el('hb-active'); if (!box) return;
    var keys = Object.keys(T.active);
    box.textContent = keys.length ? keys.map(function (k) { var j = T.active[k]; return (j.phase === 'recording' ? 'Recording ' : 'Joining ') + (j.host ? j.host + "'s meeting" : 'a meeting') + ' · ' + Object.keys(j.seen).length + ' speakers'; }).join('\n') : '';
  }
  function merged(rec) {
    var items = rec.lines.filter(function (l) { return l.text; }).map(function (l) { return { kind: 'line', at: l.at, l: l }; });
    rec.shots.forEach(function (s) { items.push({ kind: 'shot', at: s.at, s: s }); });
    items.sort(function (a, b) { return a.at - b.at || (a.kind === 'shot' ? -1 : 1); });
    return items;
  }
  function paintList(all) {
    var box = el('hb-list'); if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    all = (all || []).slice().sort(function (a, b) { return b.started - a.started; });
    if (!all.length) { box.textContent = 'No meetings yet.'; return; }
    all.forEach(function (rec) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'meet hb-item'; b.dataset.id = rec.id;
      b.textContent = fmtTime(rec.started) + ' · ' + (rec.speakers || []).length + ' speakers · ' + rec.lines.filter(function (l) { return l.text; }).length + ' lines · ' + rec.shots.length + ' pictures';
      b.onclick = function () { open(rec.id); };
      box.appendChild(b);
    });
  }
  meetDb.subscribe(paintList);
  function shotUrl(s) { return shotDb.get(s.id).then(function (r) { return r ? URL.createObjectURL(new Blob([r.bytes], { type: r.mime || 'image/jpeg' })) : ''; }); }
  function open(id) {
    return meetDb.get(id).then(function (rec) {
      var box = el('hb-view'); if (!rec || !box) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      var h = document.createElement('h3'); h.textContent = fmtTime(rec.started); box.appendChild(h);
      var meta = document.createElement('p'); meta.className = 'muted';
      meta.textContent = 'Recorded on ' + (rec.orderBy || 'the host') + "'s order. Speakers: " + (rec.speakers || []).map(function (s) { return s.name + (s.lang ? ' (' + s.lang + ')' : ''); }).join(', ') + '. ' + (rec.audio && rec.audio.deleted ? 'Audio deleted.' : 'Audio not confirmed deleted.');
      box.appendChild(meta);
      var row = document.createElement('p');
      var dl = document.createElement('button'); dl.type = 'button'; dl.id = 'hb-download'; dl.textContent = 'Download (.zip)'; dl.onclick = function () { download(rec); };
      var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete'; del.onclick = function () { remove(rec).then(function () { while (box.firstChild) box.removeChild(box.firstChild); }); };
      row.appendChild(dl); row.appendChild(document.createTextNode(' ')); row.appendChild(del); box.appendChild(row);
      var list = document.createElement('div'); list.id = 'hb-transcript'; box.appendChild(list);
      merged(rec).forEach(function (it) {
        var p = document.createElement('div');
        if (it.kind === 'line') {
          p.className = 'hb-line'; p.dataset.lang = it.l.lang || '';
          var b = document.createElement('b'); b.textContent = it.l.by; p.appendChild(b);
          p.appendChild(document.createTextNode(' [' + clock(it.l.at, rec.started) + (it.l.lang ? ' · ' + it.l.lang : '') + '] ' + it.l.text));
        } else {
          p.className = 'hb-shot';
          var cap = document.createElement('div'); cap.className = 'muted'; cap.textContent = '[' + clock(it.at, rec.started) + '] ' + (it.s.name ? it.s.name + "'s screen" : 'Shared screen'); p.appendChild(cap);
          var img = document.createElement('img'); img.alt = cap.textContent; img.style.cssText = 'max-width:100%;border-radius:8px;border:1px solid #2c2c44';
          shotUrl(it.s).then(function (u) { if (u) img.src = u; });
          p.appendChild(img);
        }
        list.appendChild(p);
      });
    });
  }
  function remove(rec) {
    return Promise.all(rec.shots.map(function (s) { return shotDb.delete(s.id).catch(function () {}); })).then(function () { return meetDb.delete(rec.id); });
  }

  // DOWNLOAD: transcript.txt, transcript.md, transcript.html and shots/, in one .zip (stored, no compression).
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], dir = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var d = new DataView(new ArrayBuffer(46));
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, off, true);
      dir.push(new Uint8Array(d.buffer), name);
      off += 30 + name.length + data.length;
    });
    var size = dir.reduce(function (n, u) { return n + u.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(dir, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function build(rec) {
    var title = 'Meeting ' + fmtTime(rec.started);
    var head = 'Recorded for a transcript on ' + (rec.orderBy || 'the host') + "'s order (shown to everyone in the meeting). The audio was deleted after the transcript was made.";
    var txt = [title, head, ''], md = ['# ' + title, '', '_' + head + '_', ''], html = ['<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title><h1>' + esc(title) + '</h1><p><i>' + esc(head) + '</i></p>'];
    var files = [];
    merged(rec).forEach(function (it, n) {
      var t = clock(it.at, rec.started);
      if (it.kind === 'line') {
        var l = it.l, tag = l.lang ? ' (' + l.lang + ')' : '';
        txt.push('[' + t + '] ' + l.by + tag + ': ' + l.text);
        md.push('**' + l.by + '**' + tag + ' [' + t + ']: ' + l.text, '');
        html.push('<p lang="' + esc(l.lang || '') + '"><b>' + esc(l.by) + '</b>' + esc(tag) + ' [' + t + ']: ' + esc(l.text) + '</p>');
      } else {
        var file = 'shots/' + ('00' + n).slice(-3) + '-' + t.replace(':', 'm') + 's.jpg';
        files.push({ id: it.s.id, name: file });
        var cap = (it.s.name ? it.s.name + "'s screen" : 'Shared screen');
        txt.push('[' + t + '] (' + cap + ': ' + file + ')');
        md.push('![' + cap + ' at ' + t + '](' + file + ')', '');
        html.push('<figure><img src="' + file + '" alt="' + esc(cap) + '" style="max-width:100%"><figcaption>' + esc(cap) + ' [' + t + ']</figcaption></figure>');
      }
    });
    return Promise.all(files.map(function (f) { return shotDb.get(f.id).then(function (r) { return { name: f.name, data: r ? new Uint8Array(r.bytes) : new Uint8Array(0) }; }); })).then(function (shots) {
      return zip([{ name: 'transcript.txt', data: txt.join('\n') + '\n' }, { name: 'transcript.md', data: md.join('\n') + '\n' }, { name: 'transcript.html', data: html.join('\n') + '\n' }].concat(shots));
    });
  }
  function download(rec) {
    return build(rec).then(function (blob) { return gifos.file.save('transcript-' + new Date(rec.started).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.zip', 'application/zip', blob); });
  }
  T.open = open; T.build = build; T.record = record; T.list = function () { return meetDb.getAll(); };
})();
