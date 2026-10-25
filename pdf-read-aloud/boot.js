/* Wire the page: open a PDF, pasted text, or a picture, then speak it. */
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
  var sentences = [];
  var cursor = 0;
  var speed = 1;
  var preparingOn = true;
  var placeSaved = null;
  var audioCtx = null;
  var uiQueued = false;
  var uiAt = 0;
  var pendingHighlight = false;
  var saveTimer = 0;
  var watchGen = 0;
  var openGen = 0;
  var sourceSerial = 0;
  var userOpened = false;
  var pwUpdate = null;
  var busyMsg = '';
  var imageUrl = '';
  var source = { kind: 'pdf', name: '', text: '', bytes: null, mime: '' };

  function saveDb() {
    try { return root.gifos && root.gifos.db ? root.gifos.db('save') : null; }
    catch (e) { return null; }
  }

  function status(msg) {
    $('status').textContent = busyMsg || msg || '';
  }
  function setBusy(msg) {
    busyMsg = msg || '';
    if (busyMsg) $('status').textContent = busyMsg;
  }
  function spinner(on) { $('spinner').hidden = !on; }
  function showError(msg) {
    var el = $('message');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function paintChrome() {
    var pdf = source.kind === 'pdf';
    $('pager').hidden = !pdf;
    if (pdf) {
      var n = view.numPages || 1;
      $('page').value = view.page || 1;
      $('page').max = n;
      $('of').textContent = '/ ' + n;
    }
    var total = sentences.length;
    var playing = reader && reader.playing();
    $('play').textContent = playing ? 'Pause' : 'Play';
    $('prev').disabled = !total || cursor <= 0;
    $('next').disabled = !total || cursor >= total - 1;
    var who = (pdf ? view.name : source.name) || '';
    who = who.replace(/^.*[\\/]/, '');
    var bits = [];
    if (who) bits.push(who);
    if (pdf && view.numPages) bits.push('page ' + view.page + ' of ' + view.numPages);
    if (total) bits.push('sentence ' + (cursor + 1) + ' of ' + total);
    status(bits.join(' · '));
    var prep = $('prep-toggle');
    if (prep) prep.textContent = preparingOn ? 'Stop preparing' : 'Resume preparing';
  }

  function paintBuffer() {
    var el = $('buffer');
    if (!el || !root.PdfSpeak || !root.PdfSpeak.bufferLabel) return;
    var info = reader ? reader.stats() : { prepared: 0, total: sentences.length, ahead: 0 };
    el.textContent = root.PdfSpeak.bufferLabel(info);
  }

  function flushUi() {
    if (pendingHighlight) {
      pendingHighlight = false;
      if (source.kind === 'pdf') {
        if (sentences[cursor]) view.showSentence(sentences[cursor]);
      } else applyMark(cursor);
    }
    paintBuffer();
    paintChrome();
  }

  function scheduleUi() {
    pendingHighlight = true;
    if (uiQueued) return;
    uiQueued = true;
    var kick = function () {
      uiQueued = false;
      var now = Date.now();
      if (uiAt && now - uiAt < 250) {
        uiQueued = true;
        setTimeout(kick, 250 - (now - uiAt));
        return;
      }
      uiAt = Date.now();
      flushUi();
    };
    if (root.requestAnimationFrame) root.requestAnimationFrame(function () { kick(); });
    else setTimeout(kick, 16);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      root.PdfStore.save(saveDb(), {
        kind: source.kind,
        name: source.kind === 'pdf' ? view.name : source.name,
        page: source.kind === 'pdf' ? view.page : 1,
        sentence: cursor,
        speed: speed,
        fit: view.fit,
        bytes: source.kind === 'pdf' ? view.bytes : source.bytes,
        text: source.kind === 'pdf' ? '' : source.text,
        mime: source.mime || ''
      });
    }, 400);
  }

  // The only voice call. Decode is prepareBytes. The reader dedupes both.
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

  function sharedCtx() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) {
      try { audioCtx = new AC(); }
      catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }

  function resumeAudio() {
    var ctx = sharedCtx();
    if (ctx && ctx.state === 'suspended' && ctx.resume) {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function copyAudioBuffer(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    var out = new ArrayBuffer(u.byteLength);
    new Uint8Array(out).set(u);
    return out;
  }

  function pcmBytes(buf) {
    if (!buf || !buf.length) return 0;
    return buf.length * (buf.numberOfChannels || 1) * 4;
  }

  function prepareBuffer(ctx, decoded, encodedBytes) {
    return {
      bytes: Math.max(encodedBytes || 0, pcmBytes(decoded)),
      ready: Promise.resolve(),
      drop: function () { decoded = null; },
      play: function () {
        resumeAudio();
        var settled = false;
        var resolve, reject;
        var done = new Promise(function (res, rej) { resolve = res; reject = rej; });
        var node = null;
        var offset = 0;
        var startedAt = 0;
        var epoch = 0;
        function finish(err) {
          if (settled) return;
          settled = true;
          if (err) reject(err); else resolve();
        }
        function halt() {
          var n = node;
          node = null;
          if (!n) return;
          try { n.onended = null; } catch (e) { void e; }
          try { n.stop(); } catch (e2) { void e2; }
          try { n.disconnect(); } catch (e3) { void e3; }
        }
        function startAt(off) {
          if (!decoded) {
            finish(new Error('PLAYBACK: The audio did not play.'));
            return;
          }
          var n = ctx.createBufferSource();
          n.buffer = decoded;
          n.connect(ctx.destination);
          var my = ++epoch;
          node = n;
          n.onended = function () {
            if (my !== epoch || node !== n) return;
            node = null;
            finish();
          };
          var dur = decoded.duration || 0;
          if (off < 0) off = 0;
          if (dur && off > dur) off = Math.max(0, dur - 0.01);
          offset = off;
          startedAt = ctx.currentTime;
          try { n.start(0, off); }
          catch (e) { finish(new Error('PLAYBACK: The audio did not play.')); }
        }
        startAt(0);
        return {
          done: done,
          pause: function () {
            if (!node) return;
            offset += Math.max(0, ctx.currentTime - startedAt);
            epoch++;
            halt();
          },
          resume: function () {
            resumeAudio();
            if (node || settled) return;
            startAt(offset);
          },
          stop: function () {
            epoch++;
            halt();
            finish();
          }
        };
      }
    };
  }

  function prepareElement(audio) {
    var blob = new Blob([audio.bytes], { type: audio.mime || 'audio/mpeg' });
    var url = URL.createObjectURL(blob);
    var encoded = audio.bytes && audio.bytes.byteLength || 0;
    return {
      bytes: encoded,
      ready: Promise.resolve(),
      drop: function () {
        try { URL.revokeObjectURL(url); } catch (e) { void e; }
      },
      play: function () {
        var a = new Audio();
        a.preload = 'auto';
        a.src = url;
        var settled = false;
        var resolve, reject;
        var done = new Promise(function (res, rej) { resolve = res; reject = rej; });
        function finish(err) {
          if (settled) return;
          settled = true;
          a.onended = null;
          a.onerror = null;
          if (err) reject(err); else resolve();
        }
        a.onended = function () { finish(); };
        a.onerror = function () { finish(new Error('PLAYBACK: The audio did not play.')); };
        var started = a.play();
        if (started && started.catch) {
          started.catch(function () { finish(new Error('PLAYBACK: The audio did not play.')); });
        }
        return {
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
      }
    };
  }

  function prepareBytes(audio) {
    var ctx = sharedCtx();
    var encoded = audio && audio.bytes && audio.bytes.byteLength || 0;
    if (!ctx || typeof ctx.decodeAudioData !== 'function' || !audio || audio.bytes == null) {
      return prepareElement(audio);
    }
    var copy;
    try { copy = copyAudioBuffer(audio.bytes); }
    catch (e) { return prepareElement(audio); }
    return ctx.decodeAudioData(copy).then(function (decoded) {
      return prepareBuffer(ctx, decoded, encoded);
    }, function () {
      return prepareElement(audio);
    });
  }

  function dropReader() {
    if (reader) {
      reader.close();
      reader = null;
    }
    paintBuffer();
  }

  function makeReader() {
    dropReader();
    sourceSerial++;
    reader = root.PdfSpeak.createReader({
      sentences: sentences,
      index: cursor,
      speed: speed,
      voice: '',
      sourceId: sourceSerial,
      preparing: preparingOn,
      tts: ttsCall,
      prepare: prepareBytes,
      onBuffer: function () { scheduleUi(); },
      onIndex: function (i) {
        cursor = i;
        scheduleUi();
        scheduleSave();
      }
    });
    scheduleUi();
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

  function clearShot() {
    $('shot').hidden = true;
    $('shot').removeAttribute('src');
    if (imageUrl) {
      try { URL.revokeObjectURL(imageUrl); } catch (e) { void e; }
      imageUrl = '';
    }
  }

  function showShot(bytes, mime) {
    clearShot();
    var blob = new Blob([bytes], { type: mime || 'image/png' });
    imageUrl = URL.createObjectURL(blob);
    $('shot').src = imageUrl;
    $('shot').hidden = false;
  }

  function renderSentences(index) {
    var host = $('sentences');
    host.textContent = '';
    var frag = document.createDocumentFragment();
    var i;
    var batch = Math.min(sentences.length, 80);
    for (i = 0; i < batch; i++) {
      var p = document.createElement('p');
      p.className = 'sent' + (i === index ? ' on' : '');
      p.textContent = sentences[i].text;
      frag.appendChild(p);
    }
    host.appendChild(frag);
    if (batch < sentences.length) {
      var rest = sentences;
      var at = batch;
      var step = function () {
        if (rest !== sentences) return;
        var more = document.createDocumentFragment();
        var end = Math.min(rest.length, at + 80);
        var n;
        for (n = at; n < end; n++) {
          var node = document.createElement('p');
          node.className = 'sent' + (n === cursor ? ' on' : '');
          node.textContent = rest[n].text;
          more.appendChild(node);
        }
        host.appendChild(more);
        at = end;
        if (at < rest.length) setTimeout(step, 0);
      };
      setTimeout(step, 0);
    }
    var on = host.children[index];
    if (on && on.scrollIntoView) {
      try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { void e; }
    }
  }

  function applyMark(index) {
    var host = $('sentences');
    if (!host) return;
    if (host.children.length !== sentences.length) {
      if (host.children.length < sentences.length && host.children.length >= 80) return;
      renderSentences(index);
      return;
    }
    var i;
    var changed = false;
    for (i = 0; i < host.children.length; i++) {
      var want = i === index;
      if (host.children[i].classList.contains('on') !== want) {
        host.children[i].classList.toggle('on', want);
        changed = true;
      }
    }
    if (!changed) return;
    var on = host.children[index];
    if (on && on.scrollIntoView) {
      try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { void e; }
    }
  }

  function noTextMessage() {
    if (source.kind === 'image') return 'No text found in this image.';
    if (source.kind === 'text') return 'There is no text to read.';
    return 'This PDF has no text to read.';
  }

  function applyText(my, text, saved) {
    if (my !== openGen) return;
    source.text = String(text || '');
    if (source.kind !== 'image') clearShot();
    sentences = root.PdfRead.plainToSentences(source.text);
    $('page-wrap').hidden = true;
    $('readout').hidden = false;
    document.body.classList.add('loaded');
    $('empty').hidden = true;
    var place = root.PdfStore.placeAt(sentences, saved || null);
    cursor = place.index;
    if (saved && saved.speed) syncSpeed(saved.speed);
    renderSentences(cursor);
    view.close();
    makeReader();
    setBusy('');
    spinner(false);
    paintChrome();
    if (!sentences.length) showError(noTextMessage());
    else if (source.kind === 'image' && source.bytes && source.bytes.byteLength > root.PdfStore.MAX_BYTES) {
      showError('This image is too large to keep in the app (8 MB). Open it again next time.');
    } else showError('');
    scheduleSave();
  }

  function openText(name, text, saved) {
    var my = ++openGen;
    dropReader();
    showError('');
    setBusy('');
    source = {
      kind: 'text',
      name: name || 'Pasted text',
      text: '',
      bytes: null,
      mime: ''
    };
    $('paste-box').value = String(text || '');
    return applyText(my, text, saved);
  }

  view.onChange = function () { paintChrome(); };
  view.onSentences = function (list) {
    if (source.kind !== 'pdf') return;
    sentences = list || [];
    if (!sentences.length) {
      paintBuffer();
      return;
    }
    if (!reader) {
      var place = root.PdfStore.placeAt(sentences, placeSaved);
      cursor = place.index;
      if (placeSaved && placeSaved.speed) syncSpeed(placeSaved.speed);
      makeReader();
    } else {
      reader.setSentences(sentences);
      if (placeSaved && !reader.playing() && !reader.paused()) {
        var again = root.PdfStore.placeAt(sentences, placeSaved);
        if (again.index !== cursor) {
          cursor = again.index;
          reader.setIndex(cursor);
        }
      }
    }
    scheduleUi();
  };
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
    var my = openGen;
    document.body.classList.add('loaded');
    $('empty').hidden = true;
    $('page-wrap').hidden = false;
    $('readout').hidden = true;
    source.kind = 'pdf';
    source.name = view.name;
    source.text = '';
    sentences = view.sentences || [];
    var place = root.PdfStore.placeAt(sentences, saved || null);
    if (!reader) {
      cursor = place.index;
      if (saved && saved.speed) syncSpeed(saved.speed);
      if (sentences.length) makeReader();
    } else if (!reader.playing() && !reader.paused() && place.index !== cursor) {
      cursor = place.index;
      reader.setIndex(cursor);
    }
    var sent = sentences[cursor];
    var shown = sent ? view.showSentence(sent) : view.go(place.page || 1);
    return Promise.resolve(shown).then(function () {
      if (my !== openGen) return;
      paintChrome();
      paintBuffer();
      if (!sentences.length) showError('This PDF has no text to read.');
      else if (view.bytes && view.bytes.byteLength > root.PdfStore.MAX_BYTES) {
        showError('This file is too large to keep in the app (8 MB). Open it again next time.');
      }
      scheduleSave();
    });
  }

  function openBytes(name, buf, saved, my) {
    if (my == null) my = ++openGen;
    if (my !== openGen) return Promise.resolve();
    spinner(true);
    setBusy('');
    showError('');
    status('Opening ' + (name || 'PDF') + '…');
    placeSaved = saved || null;
    dropReader();
    source = { kind: 'pdf', name: name || 'document.pdf', text: '', bytes: null, mime: '' };
    clearShot();
    $('readout').hidden = true;
    $('page-wrap').hidden = false;
    $('pager').hidden = false;
    view.page = saved && saved.page ? saved.page : 1;
    return view.open(name, buf).then(function () {
      if (my !== openGen) return;
      spinner(false);
      return afterOpen(saved);
    }).catch(function (e) {
      if (my !== openGen) return;
      spinner(false);
      if (!$('pw-sheet').hidden) return;
      showError((e && e.message) || String(e));
    });
  }

  function recognizeImage(name, mime, bytes, blob, my) {
    if (my == null) my = ++openGen;
    if (my !== openGen) return Promise.resolve();
    dropReader();
    source = {
      kind: 'image',
      name: name || 'Image',
      text: '',
      bytes: bytes,
      mime: mime || 'image/png'
    };
    sentences = [];
    cursor = 0;
    $('page-wrap').hidden = true;
    $('readout').hidden = false;
    $('pager').hidden = true;
    document.body.classList.add('loaded');
    $('empty').hidden = true;
    showShot(bytes, source.mime);
    renderSentences(0);
    showError('');
    setBusy('Reading text from image…');
    spinner(true);
    view.close();
    return root.PdfOcr.recognize(blob).then(function (text) {
      if (my !== openGen) return;
      return applyText(my, text, null);
    }, function (err) {
      if (my !== openGen) return;
      setBusy('');
      spinner(false);
      if (err && err.message === 'stopped') return;
      showError((err && err.message) || 'Could not read the text in this image.');
      paintChrome();
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

  function isPdfFile(file) {
    var t = (file.type || '').toLowerCase();
    var n = (file.name || '').toLowerCase();
    return t === 'application/pdf' || n.endsWith('.pdf');
  }

  function isImageFile(file) {
    var t = (file.type || '').toLowerCase();
    var n = (file.name || '').toLowerCase();
    if (t.indexOf('image/') === 0) return true;
    return /\.(png|jpe?g|gif|webp|bmp|tif|tiff)$/.test(n);
  }

  function sniff(buf) {
    var u = new Uint8Array(buf);
    var head = '';
    var i;
    for (i = 0; i < 5 && i < u.length; i++) head += String.fromCharCode(u[i]);
    if (head === '%PDF-') return 'pdf';
    if (u.length >= 2 && u[0] === 0x89 && u[1] === 0x50) return 'image';
    if (u.length >= 2 && u[0] === 0xff && u[1] === 0xd8) return 'image';
    if (u.length >= 3 && u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return 'image';
    if (u.length > 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46) return 'image';
    return '';
  }

  function bufferFrom(bytes) {
    if (!bytes) return null;
    var buf = bytes;
    if (buf.buffer && buf.byteLength != null && !(buf instanceof ArrayBuffer)) {
      buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else if (!(buf instanceof ArrayBuffer)) buf = null;
    return buf;
  }

  function openPdfFile(file) {
    var my = ++openGen;
    spinner(true);
    return readFile(file).then(function (buf) {
      return openBytes(file.name || 'document.pdf', buf, null, my);
    }).catch(function (err) {
      if (my !== openGen) return;
      spinner(false);
      showError((err && err.message) || String(err));
    });
  }

  function openImageFile(file) {
    var my = ++openGen;
    setBusy('Reading text from image…');
    spinner(true);
    return readFile(file).then(function (buf) {
      if (my !== openGen) return;
      var bytes = new Uint8Array(buf);
      var mime = file.type || 'image/png';
      return recognizeImage(file.name || 'Image', mime, bytes, new Blob([bytes], { type: mime }), my);
    }).catch(function (err) {
      if (my !== openGen) return;
      setBusy('');
      spinner(false);
      showError((err && err.message) || String(err));
    });
  }

  function takeFile(file) {
    if (!file) return;
    userOpened = true;
    if (isPdfFile(file)) return openPdfFile(file);
    if (isImageFile(file)) return openImageFile(file);
    var my = ++openGen;
    spinner(true);
    return readFile(file).then(function (buf) {
      if (my !== openGen) return;
      var kind = sniff(buf);
      if (kind === 'pdf') return openBytes(file.name || 'document.pdf', buf, null, my);
      if (kind === 'image') {
        var bytes = new Uint8Array(buf);
        var mime = file.type || 'image/png';
        return recognizeImage(file.name || 'Image', mime, bytes, new Blob([bytes], { type: mime }), my);
      }
      spinner(false);
      showError('Open a PDF or a picture of text.');
    }).catch(function (err) {
      if (my !== openGen) return;
      spinner(false);
      setBusy('');
      showError((err && err.message) || String(err));
    });
  }

  function imageFromClipboard(cd) {
    var items = cd.items;
    var i;
    if (items) {
      for (i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type || '')) return items[i].getAsFile();
      }
    }
    var files = cd.files;
    if (files && files[0] && /^image\//.test(files[0].type || '')) return files[0];
    return null;
  }

  $('file-input').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    takeFile(f);
  });

  var stage = $('stage');
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    stage.classList.add('drag');
  });
  document.addEventListener('dragleave', function (e) {
    if (e.target === document.documentElement || e.target === document.body) stage.classList.remove('drag');
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    stage.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    takeFile(f);
  });

  $('paste-text').onclick = function () {
    $('text-sheet').hidden = false;
    $('paste-box').focus();
  };
  $('text-cancel').onclick = function () { $('text-sheet').hidden = true; };
  $('text-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('paste-box').value || '';
    if (!String(text).trim()) {
      showError('There is no text to read.');
      return;
    }
    $('text-sheet').hidden = true;
    userOpened = true;
    openText('Pasted text', text, null);
  });

  document.addEventListener('paste', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    var cd = e.clipboardData;
    if (!cd) return;
    var img = imageFromClipboard(cd);
    if (img) {
      e.preventDefault();
      $('text-sheet').hidden = true;
      userOpened = true;
      if (!img.name) {
        try { img = new File([img], 'Pasted image', { type: img.type || 'image/png' }); } catch (err) { void err; }
      }
      openImageFile(img);
      return;
    }
    var text = '';
    try { text = cd.getData('text/plain') || ''; } catch (err) { text = ''; }
    if (!String(text).trim()) return;
    e.preventDefault();
    $('text-sheet').hidden = true;
    userOpened = true;
    openText('Pasted text', text, null);
  });

  function seekTo(i) {
    if (busyMsg || !sentences.length) return;
    if (!(i >= 0) || i >= sentences.length) return;
    if (!reader) makeReader();
    showError('');
    watch(reader.go(i));
    scheduleSave();
  }

  $('sentences').addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== $('sentences') && node.tagName !== 'P') node = node.parentNode;
    if (!node || node.tagName !== 'P' || node.parentNode !== $('sentences')) return;
    var kids = $('sentences').children;
    var i;
    for (i = 0; i < kids.length; i++) {
      if (kids[i] === node) { seekTo(i); return; }
    }
  });

  $('text-layer').addEventListener('click', function (e) {
    if (source.kind !== 'pdf' || !sentences.length) return;
    var frag = e.target && e.target.textContent ? String(e.target.textContent).replace(/\s+/g, ' ').trim() : '';
    if (frag.length < 2) return;
    var page = view.page;
    var hits = [];
    var i;
    for (i = 0; i < sentences.length; i++) {
      var s = sentences[i];
      if ((s.page || 1) !== page) continue;
      if (String(s.text || '').indexOf(frag) >= 0) hits.push(i);
    }
    if (!hits.length) return;
    var pick = hits[0];
    for (i = 0; i < hits.length; i++) {
      if (hits[i] >= cursor) { pick = hits[i]; break; }
    }
    seekTo(pick);
  });

  $('play').onclick = function () {
    if (busyMsg) return;
    if (!sentences.length) {
      showError(noTextMessage());
      return;
    }
    resumeAudio();
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
  $('stop').onclick = function () {
    if (!reader) return;
    showError('');
    reader.stop();
    paintChrome();
  };
  $('prep-toggle').onclick = function () {
    preparingOn = !preparingOn;
    if (reader) {
      if (preparingOn) reader.startPreparing();
      else reader.stopPreparing();
    }
    paintChrome();
    paintBuffer();
  };
  $('prev').onclick = function () {
    if (busyMsg || !sentences.length) return;
    if (!reader) makeReader();
    showError('');
    watch(reader.prev());
  };
  $('next').onclick = function () {
    if (busyMsg || !sentences.length) return;
    if (!reader) makeReader();
    showError('');
    watch(reader.next());
  };
  $('page').addEventListener('change', function () {
    if (source.kind !== 'pdf') return;
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
    if (e.key === 'Escape' && !$('text-sheet').hidden) {
      $('text-sheet').hidden = true;
      if (e.target && e.target.blur) e.target.blur();
      return;
    }
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
      if (source.kind === 'pdf' && reader) watch(reader.goPage(view.page + 1));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      if (source.kind === 'pdf' && reader) watch(reader.goPage(view.page - 1));
    }
  });

  root.addEventListener('resize', function () {
    if (view.pdf && view.fit === 'width') view.draw();
  });

  if (root.gifos && root.gifos.onBack) {
    root.gifos.onBack(function () {
      if (!$('text-sheet').hidden) { $('text-sheet').hidden = true; return; }
      if (!$('pw-sheet').hidden) { $('pw-cancel').click(); return; }
      if (reader && reader.playing()) { reader.pause(); paintChrome(); }
    });
  }

  function restoreImage(rec) {
    var buf = bufferFrom(rec.bytes);
    var bytes = buf ? new Uint8Array(buf) : null;
    if (rec.text) {
      var my = ++openGen;
      dropReader();
      source = {
        kind: 'image',
        name: rec.name || 'Image',
        text: '',
        bytes: bytes,
        mime: rec.mime || 'image/png'
      };
      $('page-wrap').hidden = true;
      $('readout').hidden = false;
      if (bytes) showShot(bytes, source.mime);
      else clearShot();
      return applyText(my, rec.text, rec);
    }
    if (bytes) {
      var mime = rec.mime || 'image/png';
      return recognizeImage(rec.name || 'Image', mime, bytes, new Blob([bytes], { type: mime }), null);
    }
    return null;
  }

  root.PdfStore.load(saveDb()).then(function (rec) {
    if (userOpened) return;
    var kind = rec && (rec.kind === 'text' || rec.kind === 'image') ? rec.kind : '';
    if (!kind && rec && rec.text && !rec.bytes) kind = 'text';
    if (kind === 'text' && rec.text && String(rec.text).trim()) {
      return openText(rec.name || 'Pasted text', rec.text, rec);
    }
    if (kind === 'image' && rec && (rec.text || rec.bytes)) return restoreImage(rec);
    var buf = bufferFrom(rec && rec.bytes);
    if (buf) return openBytes(rec.name || 'saved.pdf', buf, rec);
    if (userOpened) return;
    var sample = decodeSample();
    if (sample) return openBytes('paper-and-voice.pdf', sample, null);
  }).catch(function (e) {
    showError((e && e.message) || String(e));
  });
})(typeof window !== 'undefined' ? window : this);
