/*
 * OCR worker — Tesseract.js-core, no network.
 *
 * build.mjs concatenates the vendored glue (TesseractCore) in front of this
 * file and packs the result as window.OCR_WORKER_SRC. The page mints a blob:
 * Worker from that string. Wasm bytes and English data arrive as transferred
 * ArrayBuffers. This worker never loads a URL.
 *
 * instantiateWasm is the only wasm path. The glue's other loaders are not used.
 */
(function (self) {
  'use strict';

  var Tess = null;
  var api = null;
  var langCode = null;
  var currentId = null;

  function post(msg) {
    if (currentId != null && msg.id == null) msg.id = currentId;
    self.postMessage(msg);
  }
  function fail(err) {
    post({ type: 'error', error: String(err && err.message || err) });
  }

  function u8of(buf) {
    if (buf instanceof Uint8Array) return buf;
    return new Uint8Array(buf);
  }

  function maybeGunzip(buf) {
    var u8 = u8of(buf);
    if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
      var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }
    return Promise.resolve(u8);
  }

  function boot(wasmBuf) {
    if (typeof TesseractCore !== 'function') throw new Error('TesseractCore factory missing');
    var wasm = u8of(wasmBuf);
    return TesseractCore({
      wasmBinary: wasm,
      locateFile: function (p) { return p; },
      instantiateWasm: function (imports, done) {
        WebAssembly.instantiate(wasm, imports).then(function (r) {
          done(r.instance, r.module);
        }).catch(function (e) { fail(e); });
        return {};
      },
      TesseractProgress: function (percent) {
        var p = Number(percent);
        if (!(p >= 0)) p = 0;
        post({ type: 'progress', phase: 'recognize', progress: Math.max(0, Math.min(1, (p - 30) / 70)) });
      },
      print: function () {},
      printErr: function () {}
    }).then(function (mod) {
      Tess = mod;
    });
  }

  function initLang(code, bytes) {
    return maybeGunzip(bytes).then(function (data) {
      if (!Tess) throw new Error('Engine is not booted.');
      if (api) { try { api.End(); } catch (e) {} api = null; }
      Tess.FS.writeFile(code + '.traineddata', data);
      api = new Tess.TessBaseAPI();
      var oem = (Tess.OEM_LSTM_ONLY != null) ? Tess.OEM_LSTM_ONLY : 1;
      var status = api.Init(null, code, oem);
      if (status === -1) throw new Error('Could not start English text recognition.');
      langCode = code;
    });
  }

  var MAX_SIDE = 2400;

  function scaleImage(buf) {
    var raw = u8of(buf);
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      return Promise.resolve(raw);
    }
    var blob = new Blob([raw]);
    return createImageBitmap(blob).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      if (!w || !h) throw new Error('This image has no size.');
      var scale = 1;
      if (Math.max(w, h) > MAX_SIDE) scale = MAX_SIDE / Math.max(w, h);
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      if (cw === w && ch === h && raw.length < 1500000) {
        if (bmp.close) try { bmp.close(); } catch (e) { void e; }
        return raw;
      }
      var canvas = new OffscreenCanvas(cw, ch);
      var g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0, cw, ch);
      if (bmp.close) try { bmp.close(); } catch (e2) { void e2; }
      if (typeof canvas.convertToBlob !== 'function') return raw;
      return canvas.convertToBlob({ type: 'image/png' }).then(function (out) {
        if (!out) return raw;
        return out.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      });
    }, function () { return raw; });
  }

  function recognize(image, opts) {
    if (!api) throw new Error('No language loaded.');
    opts = opts || {};
    Tess.FS.writeFile('/input', u8of(image));
    var angle = 0;
    if (opts.rotateAuto && api.FindLines && api.GetGradient) {
      var r0 = api.SetImageFile(1, 0);
      if (r0 === 1) throw new Error('Could not read the image.');
      api.FindLines();
      angle = api.GetGradient();
      if (!(Math.abs(angle) >= 0.005)) angle = 0;
    }
    var r = api.SetImageFile(1, angle);
    if (r === 1) throw new Error('Could not read the image.');
    if (opts.psm != null) api.SetVariable('tessedit_pageseg_mode', String(opts.psm));
    api.Recognize(null);
    var text = api.GetUTF8Text() || '';
    return { text: text };
  }

  self.onmessage = function (e) {
    var d = e.data || {};
    currentId = d.id;
    var p;
    if (d.type === 'boot') {
      p = boot(d.wasm).then(function () { post({ type: 'booted' }); });
    } else if (d.type === 'lang') {
      p = initLang(d.code, d.bytes).then(function () {
        post({ type: 'lang-ready', code: langCode });
      });
    } else if (d.type === 'recognize') {
      p = scaleImage(d.image).then(function (png) {
        var out = recognize(png, d.opts);
        post({ type: 'result', text: out.text });
      });
    } else {
      return;
    }
    p.catch(fail);
  };
})(self);
