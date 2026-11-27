/* Meeting Bot: play videos on the Stage.
 *
 * When the bot is the host of a broadcast (it joined a /cast link on a device that hosts that room), it can press the
 * broadcast's own Rebroadcast button with video files you pick here: one after another, looping if you like. That is
 * exactly what a person hosting can do, so viewers see the same Prerecorded badge.
 *
 * The files stay on this device. They go to the meeting page by reference (gifos.meet.rebroadcast), never copied,
 * so a 40-minute film costs no extra memory.
 *
 * Local API (added to window.MeetingBot):
 *   playlist(id, files, { loop, start, at, blur })  play File objects in order on meeting id's Stage; start = index,
 *                                            at = second, blur = 'none' (default: viewers may tap to unblur), 'min', 'max'
 *   stopPlaylist()                            stop the film and the list
 *   stage()                                   { on, id, index, count, title, loop, startedAt, at, plays, skips, error }
 * A film that stops early is a page matter (the page plays on past a false end); the list only moves on a real end,
 * goes on after the meeting page reloaded (same film, same second), and stops when a person presses Stop.
 */
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var MB = window.MeetingBot;
  var S = window.MeetingStage = { on: false, id: '', files: [], index: 0, loop: true, title: '', startedAt: 0, at: 0, plays: 0, error: '', log: [] };
  var box = el('stagebox');
  var supported = !!(window.gifos && gifos.meet && typeof gifos.meet.rebroadcast === 'function' && typeof gifos.meet.onRebroadcast === 'function');
  function note(text) {
    S.log.push({ at: Date.now(), text: text });
    if (S.log.length > 40) S.log.shift();
    var n = el('stage-now'); if (n) n.textContent = text;
  }
  function titleOf(f) { return String((f && f.name) || 'Video').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').slice(0, 120); }
  function paint() {
    if (!box) return;
    var st = MB.status();
    box.hidden = st.phase !== 'run';
    var sel = el('stage-meeting');
    var want = sel.value;
    var ms = (st.meetings || []).map(function (m) { return m.id + '|' + (m.link || m.room || ''); }).join('\n');
    if (sel.dataset.sig !== ms) {
      sel.dataset.sig = ms;
      sel.innerHTML = '';
      (st.meetings || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m.id; o.textContent = m.id + '  ' + (m.link || m.room || '');
        sel.appendChild(o);
      });
      if (want) sel.value = want;
    }
    el('stage-play').disabled = !supported || S.on || !sel.value || !el('stage-files').files.length;
    el('stage-stop').disabled = !S.on;
  }
  if (!supported) {
    if (box) { el('stage-now').textContent = 'Playing videos on the Stage needs a newer GifOS.'; }
  }

  function playAt(i, at) {
    if (!S.on) return Promise.resolve(null);
    if (i >= S.files.length) {
      if (!S.loop) { S.on = false; note('The list finished.'); paint(); return Promise.resolve(null); }
      i = 0;
    }
    S.index = i;
    var f = S.files[i];
    S.title = titleOf(f);
    S.at = at || 0;
    return gifos.meet.rebroadcast(S.id, f, { title: S.title, at: S.at, blur: S.blur }).then(function (r) {
      S.startedAt = Date.now(); S.plays++; S.error = '';
      note('Playing ' + (i + 1) + ' of ' + S.files.length + ': ' + S.title + (S.at ? ' from ' + Math.round(S.at) + ' s' : ''));
      paint();
      return r;
    }, function (e) {
      var m = String(e && e.message || e);
      S.error = m;
      // A file the page cannot play is skipped; anything else (not the host, not a broadcast, busy) stops the list.
      if (/^unplayable/.test(m) && S.files.length > 1) { note('Skipped ' + S.title + ': ' + m); return playAt(i + 1, 0); }
      S.on = false; note('Stopped: ' + m.replace(/^[a-z-]+: /, '')); paint();
      throw e;
    });
  }
  function playlist(id, files, opts) {
    if (!supported) return Promise.reject(new Error('Playing videos on the Stage needs a newer GifOS.'));
    opts = opts || {};
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f && typeof f.size === 'number'; });
    if (!list.length) return Promise.reject(new Error('Pick one or more video files.'));
    var go = function () {
      S.on = true; S.id = id; S.files = list; S.loop = opts.loop !== false; S.blur = opts.blur || 'none';
      var start = Math.max(0, Math.min(list.length - 1, opts.start | 0));
      return playAt(start, Number(opts.at) || 0).then(function () { return stage(); });
    };
    return S.on ? stopPlaylist().then(go) : go();
  }
  function stopPlaylist() {
    var was = S.on;
    S.on = false;
    paint();
    if (!was || !S.id) return Promise.resolve(stage());
    return gifos.meet.stopRebroadcast(S.id).catch(function () {}).then(function () { note('Stopped.'); return stage(); });
  }
  function stage() {
    return { on: S.on, id: S.id, index: S.index, count: S.files.length, title: S.title, loop: S.loop, startedAt: S.startedAt, at: S.at, plays: S.plays, error: S.error };
  }

  if (supported) gifos.meet.onRebroadcast(function (ev) {
    if (!ev || !S.on || ev.meetingId !== S.id) return;
    if (ev.state === 'started') return;
    if (ev.state === 'ended') { playAt(S.index + 1, 0).catch(function () {}); return; }
    if (ev.state === 'error') { note('The film stalled at ' + Math.round(ev.pos || 0) + ' s: next.'); playAt(S.index + 1, 0).catch(function () {}); return; }
    // stopped: the meeting page reloaded (same film, where it was), or a person pressed Stop (the list stops with it).
    if (ev.why === 'reload') { playAt(S.index, ev.pos || 0).catch(function () {}); return; }
    if (ev.why === 'app') return;
    S.on = false; note(ev.why === 'left' ? 'The bot left the meeting.' : 'Stopped on the meeting page.'); paint();
  });

  if (box) {
    el('stage-files').onchange = paint;
    el('stage-play').onclick = function () {
      playlist(el('stage-meeting').value, el('stage-files').files, { loop: el('stage-loop').checked }).catch(function () {});
    };
    el('stage-stop').onclick = function () { stopPlaylist(); };
    setInterval(paint, 2000);
  }

  var status0 = MB.status;
  MB.status = function () { var s = status0(); s.stage = stage(); return s; };
  MB.playlist = function (id, files, opts) {
    try { if (MB.status().phase !== 'run') throw new Error('The bot is not running. Call start({ mode: "run", ... }) first.'); } catch (e) { return Promise.reject(e); }
    return playlist(id, files, opts);
  };
  MB.stopPlaylist = stopPlaylist;
  MB.stage = stage;
  paint();
})();
