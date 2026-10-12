/* Wire the page: open a file, restore the last one, speak through the computer. */
(function (root) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var view = new root.PdfView({
    stage: $('stage'),
    wrap: $('page-wrap'),
    canvas: $('page-canvas'),
    textLayer: $('text-layer'),
    hlLayer: $('hl-layer')
  });
  var reader = null;
  var cursor = 0;
  var speed = 1;
  var saveTimer = 0;
  var watchGen = 0;
  var pwUpdate = null;

  function saveDb() {
    try { return root.gifos && root.gifos.db ? root.gifos.db('save') : null; }
    catch (e) { return null; }
  }

  function status(msg) { $('status').textContent = msg || ''; }
  function spinner(on) { $('spinner').hidden = !on; }
  function showError(msg) {
    var el = $('message');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function paintChrome() {
    var n = view.numPages || 1;
    $('page').value = view.page || 1;
    $('page').max = n;
    $('of').textContent = '/ ' + n;
    var total = view.sentences ? view.sentences.length : 0;
    var playing = reader && reader.playing();
    $('play').textContent = playing ? 'Pause' : 'Play';
    $('prev').disabled = !total || cursor <= 0;
    $('next').disabled = !total || cursor >= total - 1;
    var who = view.name ? view.name.replace(/^.*[\\/]/, '') : '';
    var bits = [];
    if (who) bits.push(who);
    if (view.numPages) bits.push('page ' + view.page + ' of ' + view.numPages);
    if (total) bits.push('sentence ' + (cursor + 1) + ' of ' + total);
    status(bits.join(' · '));
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      root.PdfStore.save(saveDb(), {
        name: view.name,
        page: view.page,
        sentence: cursor,
        speed: speed,
        fit: view.fit,
        bytes: view.bytes
      });
    }, 400);
  }

  function ttsCall(req) {
    if (!root.gifos || !root.gifos.ai || typeof root.gifos.ai.tts !== 'function') {
      return Promise.reject(new Error('NOT_CONFIGURED:ai:tts'));
    }
    return root.gifos.ai.tts({
      text: req.text,
      voice: req.voice || '',
      speed: req.speed
    });
  }

  function playBytes(audio) {
    var blob = new Blob([audio.bytes], { type: audio.mime || 'audio/mpeg' });
    var url = URL.createObjectURL(blob);
    var a = new Audio(url);
    var settled = false;
    var resolve, reject;
    var done = new Promise(function (res, rej) { resolve = res; reject = rej; });
    function finish(err) {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch (e) { void e; }
      if (err) reject(err); else resolve();
    }
    a.onended = function () { finish(); };
    a.onerror = function () { finish(new Error('PLAYBACK: The audio did not play.')); };
    var handle = {
      done: done,
      pause: function () { try { a.pause(); } catch (e) { void e; } },
      resume: function () {
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      },
      stop: function () {
        a.onended = null;
        a.onerror = null;
        try { a.pause(); } catch (e) { void e; }
        finish();
      }
    };
    var started = a.play();
    if (started && started.catch) {
      started.catch(function () { finish(new Error('PLAYBACK: The audio did not play.')); });
    }
    return handle;
  }

  function makeReader() {
    if (reader) reader.stop();
    reader = root.PdfSpeak.createReader({
      sentences: view.sentences || [],
      index: cursor,
      speed: speed,
      voice: '',
      tts: ttsCall,
      play: playBytes,
      onIndex: function (i, sent) {
        cursor = i;
        view.showSentence(sent);
        paintChrome();
        scheduleSave();
      }
    });
    return reader;
  }

  function watch(p) {
    var my = ++watchGen;
    Promise.resolve(p).then(function (res) {
      if (my !== watchGen) return;
      if (res && res.message) showError(res.message);
      paintChrome();
    }).catch(function (e) {
      if (my !== watchGen) return;
      showError(root.PdfSpeak.installMessage(e));
      paintChrome();
    });
  }

  function syncSpeed(value) {
    var n = Number(value);
    if (!(n >= 0.25 && n <= 4)) n = 1;
    speed = n;
    var sel = $('speed');
    var found = false;
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (Number(sel.options[i].value) === n) { sel.value = sel.options[i].value; found = true; break; }
    }
    if (!found) sel.value = '1';
    if (reader) reader.setSpeed(speed);
  }

  view.onChange = function () { paintChrome(); };
  view.onPassword = function (update, reason) {
    pwUpdate = update;
    $('pw-msg').textContent = reason === 2
      ? 'That password was wrong. Try again.'
      : 'This PDF is locked. Enter the password.';
    $('pw-sheet').hidden = false;
    $('pw').value = '';
    $('pw').focus();
  };

  function afterOpen(saved) {
    document.body.classList.add('loaded');
    $('empty').hidden = true;
    var place = root.PdfStore.placeAt(view.sentences, saved || null);
    cursor = place.index;
    if (saved && saved.speed) syncSpeed(saved.speed);
    var sent = view.sentences[cursor];
    var shown = sent ? view.showSentence(sent) : view.go(place.page || 1);
    return Promise.resolve(shown).then(function () {
      makeReader();
      paintChrome();
      if (!view.sentences.length) showError('This PDF has no text to read.');
      else if (view.bytes && view.bytes.byteLength > root.PdfStore.MAX_BYTES) {
        showError('This file is too large to keep in the app (8 MB). Open it again next time.');
      }
      scheduleSave();
    });
  }

  function openBytes(name, buf, saved) {
    spinner(true);
    showError('');
    status('Opening ' + (name || 'PDF') + '…');
    if (reader) { reader.stop(); reader = null; }
    view.page = saved && saved.page ? saved.page : 1;
    return view.open(name, buf).then(function () {
      spinner(false);
      return afterOpen(saved);
    }).catch(function (e) {
      spinner(false);
      if (!$('pw-sheet').hidden) return;
      showError((e && e.message) || String(e));
    });
  }

  function decodeSample() {
    var b64 = root.SAMPLE_PDF_B64;
    if (!b64) return null;
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Could not read the file.')); };
      r.readAsArrayBuffer(file);
    });
  }

  function takeFile(file) {
    if (!file) return;
    spinner(true);
    readFile(file).then(function (buf) {
      view.page = 1;
      cursor = 0;
      return openBytes(file.name || 'document.pdf', buf, null);
    }).catch(function (err) {
      spinner(false);
      showError((err && err.message) || String(err));
    });
  }

  $('file-input').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    takeFile(f);
  });

  var stage = $('stage');
  stage.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    stage.classList.add('drag');
  });
  stage.addEventListener('dragleave', function () { stage.classList.remove('drag'); });
  stage.addEventListener('drop', function (e) {
    e.preventDefault();
    stage.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    takeFile(f);
  });

  $('play').onclick = function () {
    if (!view.sentences || !view.sentences.length) {
      showError('This PDF has no text to read.');
      return;
    }
    if (!reader) makeReader();
    if (reader.playing()) {
      reader.pause();
      paintChrome();
      return;
    }
    showError('');
    reader.setSpeed(speed);
    reader.setIndex(cursor);
    watch(reader.play());
    paintChrome();
  };
  $('prev').onclick = function () {
    if (!reader) makeReader();
    showError('');
    watch(reader.prev());
  };
  $('next').onclick = function () {
    if (!reader) makeReader();
    showError('');
    watch(reader.next());
  };
  $('page').addEventListener('change', function () {
    if (!reader) makeReader();
    showError('');
    watch(reader.goPage(+$('page').value || 1));
  });
  $('speed').addEventListener('change', function () {
    syncSpeed($('speed').value);
    scheduleSave();
  });

  $('pw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!pwUpdate) return;
    var fn = pwUpdate;
    pwUpdate = null;
    $('pw-sheet').hidden = true;
    fn($('pw').value);
  });
  $('pw-cancel').onclick = function () {
    pwUpdate = null;
    $('pw-sheet').hidden = true;
    spinner(false);
    showError('The file is locked.');
  };

  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
      if (e.key === 'Escape' && e.target.blur) e.target.blur();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      $('play').click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      $('prev').click();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      $('next').click();
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      if (reader) watch(reader.goPage(view.page + 1));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      if (reader) watch(reader.goPage(view.page - 1));
    }
  });

  root.addEventListener('resize', function () {
    if (view.pdf && view.fit === 'width') view.draw();
  });

  if (root.gifos && root.gifos.onBack) {
    root.gifos.onBack(function () {
      if (!$('pw-sheet').hidden) { $('pw-cancel').click(); return; }
      if (reader && reader.playing()) { reader.pause(); paintChrome(); }
    });
  }

  root.PdfStore.load(saveDb()).then(function (rec) {
    if (rec && rec.bytes) {
      var buf = rec.bytes;
      if (buf.buffer && buf.byteLength != null) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      else if (!(buf instanceof ArrayBuffer)) buf = null;
      if (buf) return openBytes(rec.name || 'saved.pdf', buf, rec);
    }
    var sample = decodeSample();
    if (sample) return openBytes('paper-and-voice.pdf', sample, null);
  }).catch(function (e) {
    showError((e && e.message) || String(e));
  });
})(typeof window !== 'undefined' ? window : this);
