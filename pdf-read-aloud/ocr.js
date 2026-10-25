/* Read words out of a picture on this device.
 * The engine is packed under .assets/ and handed over by gifos.assets().
 * English is an optional pin: the first picture downloads it, then it stays.
 * A blob worker runs the engine so the page does not freeze. */
(function (root) {
  'use strict';

  var LANG = 'eng';
  var LANG_ASSET = 'eng.traineddata';
  var WASM_ASSET = 'tesseract-core.wasm';

  var worker = null;
  var booted = false;
  var langReady = false;
  var pending = null;
  var seq = 0;

  function assetBytes(path) {
    if (!root.gifos || typeof root.gifos.assets !== 'function') {
      return Promise.reject(new Error('Open Read Aloud from the home screen to read a picture of text.'));
    }
    return root.gifos.assets(path).then(function (buf) {
      if (!buf || !buf.byteLength) throw new Error('The reading data came back empty.');
      return buf;
    }, function (e) {
      throw new Error((e && e.message) || 'The reading data is not on this device yet.');
    });
  }

  function asBuffer(buf) {
    if (buf instanceof ArrayBuffer) return buf;
    var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  }

  function killWorker() {
    if (worker) {
      try { worker.terminate(); } catch (e) { void e; }
    }
    worker = null;
    booted = false;
    langReady = false;
    pending = null;
  }

  function onWorkerMessage(e) {
    var d = e.data || {};
    if (d.type === 'progress') return;
    if (d.type === 'error') {
      var err = new Error(d.error || 'Could not read the text in this image.');
      if (pending && (d.id == null || d.id === pending.id)) {
        pending.rej(err);
        pending = null;
      }
      return;
    }
    if (pending && pending.type === d.type && (d.id == null || d.id === pending.id)) {
      pending.res(d);
      pending = null;
    }
  }

  function ensureWorker() {
    if (worker) return Promise.resolve();
    if (!root.OCR_WORKER_SRC) return Promise.reject(new Error('The text reader did not load.'));
    var blob = new Blob([root.OCR_WORKER_SRC], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    worker = new Worker(url);
    worker.onmessage = onWorkerMessage;
    worker.onerror = function (ev) {
      var msg = (ev && ev.message) || 'Could not read the text in this image.';
      if (pending) { pending.rej(new Error(msg)); pending = null; }
      killWorker();
    };
    return Promise.resolve();
  }

  function send(msg, transfer, expect) {
    var id = ++seq;
    msg.id = id;
    var p = new Promise(function (res, rej) {
      if (pending) pending.rej(new Error('stopped'));
      pending = { type: expect, id: id, res: res, rej: rej };
    });
    worker.postMessage(msg, transfer || []);
    return p;
  }

  function bootEngine() {
    if (booted) return Promise.resolve();
    return ensureWorker().then(function () {
      return assetBytes(WASM_ASSET);
    }).then(function (wasm) {
      var buf = asBuffer(wasm);
      return send({ type: 'boot', wasm: buf }, [buf], 'booted');
    }).then(function () {
      booted = true;
    });
  }

  function loadLang() {
    if (langReady) return Promise.resolve();
    return bootEngine().then(function () {
      return assetBytes(LANG_ASSET);
    }).then(function (bytes) {
      var buf = asBuffer(bytes);
      return send({ type: 'lang', code: LANG, bytes: buf }, [buf], 'lang-ready');
    }).then(function () {
      langReady = true;
    });
  }

  function fileBytes(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Could not read this image.')); };
      r.readAsArrayBuffer(file);
    });
  }

  function cleanText(text) {
    return String(text || '').replace(/\u000c/g, '').replace(/[ \t]+\n/g, '\n').trim();
  }

  function recognize(file) {
    return fileBytes(file).then(function (png) {
      return loadLang().then(function () {
        var buf = asBuffer(png);
        return send({
          type: 'recognize',
          image: buf,
          opts: { psm: 3, rotateAuto: true }
        }, [buf], 'result');
      });
    }).then(function (out) {
      return cleanText(out && out.text);
    }).catch(function (err) {
      if (err && err.message === 'stopped') throw err;
      if (!booted) killWorker();
      throw err;
    });
  }

  root.PdfOcr = { recognize: recognize };
})(typeof window !== 'undefined' ? window : this);
