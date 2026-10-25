/* Open a PDF and paint one page. pdf.js gets a live blob: Worker.
 * The CSP forbids its fake-worker script path. One Worker per document:
 * a shared port is dead after pdf.destroy(), and the next open hangs. */
(function (root) {
  'use strict';

  var workerSrcUrl = '';
  function workerSrc() {
    if (!root.PDF_WORKER_SRC) return '';
    if (!workerSrcUrl) {
      var blob = new Blob([root.PDF_WORKER_SRC], { type: 'text/javascript' });
      workerSrcUrl = URL.createObjectURL(blob);
    }
    return workerSrcUrl;
  }
  function mintWorker() {
    var src = workerSrc();
    if (!src) return null;
    return new Worker(src);
  }
  function copyU8(buf) {
    var src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var out = new Uint8Array(src.byteLength);
    out.set(src);
    return out;
  }
  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(msg)); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); });
    });
  }

  function View(el) {
    this.stage = el.stage;
    this.wrap = el.wrap;
    this.canvas = el.canvas;
    this.textLayer = el.textLayer;
    this.hlLayer = el.hlLayer;
    this.pdf = null;
    this.bytes = null;
    this.name = '';
    this.page = 1;
    this.numPages = 0;
    this.scale = 1;
    this.fit = 'width';
    this.sentences = [];
    this.sentence = null;
    this.rendering = false;
    this.pending = false;
    this.renderTask = null;
    this.onChange = function () {};
    this.onSentences = null;
    this.onPassword = null;
    this._cssW = 0;
    this._cssH = 0;
    this._gen = 0;
    this._loadingTask = null;
    this._pdfWorker = null;
    this._port = null;
    this._lastCssVp = null;
  }

  View.prototype.open = function (name, buf, password) {
    if (!root.pdfjsLib || !root.PDF_WORKER_SRC) {
      return Promise.reject(new Error('The PDF engine did not load.'));
    }
    var self = this;
    var gen = ++this._gen;
    var data = copyU8(buf);
    var port = mintWorker();
    if (!port) return Promise.reject(new Error('The PDF engine did not load.'));
    var worker = new root.pdfjsLib.PDFWorker({ port: port });
    var opts = {
      data: new Uint8Array(data),
      worker: worker,
      password: password || '',
      isEvalSupported: false,
      disableStream: true,
      disableAutoFetch: true,
      disableRange: true,
      useSystemFonts: false,
      verbosity: 0
    };
    var task = root.pdfjsLib.getDocument(opts);
    var waitingOnPassword = false;
    var adopted = false;
    if (this.onPassword) {
      task.onPassword = function (update, reason) {
        waitingOnPassword = true;
        self.onPassword(update, reason);
      };
    }
    return withTimeout(task.promise, 20000, 'Could not open this PDF.')
      .then(function (pdf) {
        if (gen !== self._gen) {
          Promise.resolve(task.destroy && task.destroy()).catch(function () {});
          try { worker.destroy(); } catch (x) { void x; }
          try { port.terminate(); } catch (x) { void x; }
          return;
        }
        return self._adopt(name, data, pdf, task, worker, port, gen).then(function () {
          adopted = true;
          return self.extract(gen);
        });
      })
      .catch(function (e) {
        if (!adopted) {
          Promise.resolve(task.destroy && task.destroy()).catch(function () {});
          try { worker.destroy(); } catch (x) { void x; }
          try { port.terminate(); } catch (x) { void x; }
        }
        if (waitingOnPassword && /timeout|could not open/i.test((e && e.message) || '')) {
          throw new Error('The file is locked.');
        }
        throw e;
      });
  };

  View.prototype._adopt = function (name, data, pdf, task, worker, port, gen) {
    var self = this;
    var old = this._teardown();
    this.pdf = pdf;
    this.bytes = data;
    this.name = name || 'document.pdf';
    this._loadingTask = task;
    this._pdfWorker = worker;
    this._port = port;
    this.numPages = pdf.numPages;
    this.sentences = [];
    this.sentence = null;
    if (this.page < 1 || this.page > this.numPages) this.page = 1;
    return Promise.resolve(old).then(function () {
      if (gen !== self._gen) return;
      return self.draw();
    });
  };

  function later() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  View.prototype.extract = function (gen) {
    var self = this;
    var pdf = this.pdf;
    if (!pdf) return Promise.resolve([]);
    var pages = [];
    var step = function (n) {
      if (gen != null && gen !== self._gen) return Promise.resolve();
      if (n > pdf.numPages) return Promise.resolve();
      return pdf.getPage(n).then(function (page) {
        var vp = page.getViewport({ scale: 1, rotation: 0 });
        return page.getTextContent().then(function (tc) {
          pages.push({
            page: n,
            width: vp.width,
            height: vp.height,
            items: (tc && tc.items) || []
          });
          return later();
        }).then(function () {
          if (gen != null && gen !== self._gen) return;
          self.sentences = root.PdfRead.pagesToSentences(pages);
          if (typeof self.onSentences === 'function') self.onSentences(self.sentences);
          return later();
        }).then(function () {
          if (gen != null && gen !== self._gen) return;
          return step(n + 1);
        });
      });
    };
    return step(1).then(function () {
      if (gen != null && gen !== self._gen) return self.sentences;
      return self.sentences;
    });
  };

  View.prototype._teardown = function () {
    this.rendering = false;
    this.pending = false;
    if (this.renderTask && this.renderTask.cancel) {
      try { this.renderTask.cancel(); } catch (e) { void e; }
    }
    this.renderTask = null;
    var task = this._loadingTask;
    var worker = this._pdfWorker;
    var port = this._port;
    var pdf = this.pdf;
    this._loadingTask = null;
    this._pdfWorker = null;
    this._port = null;
    this.pdf = null;
    var jobs = [];
    if (task && task.destroy) jobs.push(Promise.resolve(task.destroy()).catch(function () {}));
    else if (pdf && pdf.destroy) jobs.push(Promise.resolve(pdf.destroy()).catch(function () {}));
    var done = jobs.length ? Promise.all(jobs) : Promise.resolve();
    var cap = new Promise(function (res) { setTimeout(res, 1500); });
    return Promise.race([done, cap]).then(function () {
      if (worker && worker.destroy) try { worker.destroy(); } catch (e) { void e; }
      if (port && port.terminate) try { port.terminate(); } catch (e) { void e; }
    });
  };

  View.prototype.baseScale = function () {
    if (!this.pdf) return Promise.resolve(1);
    var self = this;
    return this.pdf.getPage(this.page).then(function (page) {
      var vp1 = page.getViewport({ scale: 1, rotation: 0 });
      var pad = 24;
      var aw = Math.max(120, self.stage.clientWidth - pad);
      var ah = Math.max(120, self.stage.clientHeight - pad);
      if (self.fit === 'page') return Math.min(aw / vp1.width, ah / vp1.height);
      return aw / vp1.width;
    });
  };

  View.prototype.draw = function () {
    var self = this;
    var gen = this._gen;
    if (!this.pdf) return Promise.resolve();
    if (this.rendering) {
      this.pending = true;
      return Promise.resolve();
    }
    this.rendering = true;
    this.pending = false;
    if (this.renderTask && this.renderTask.cancel) {
      try { this.renderTask.cancel(); } catch (e) { void e; }
    }
    return this.baseScale().then(function (s) {
      if (gen !== self._gen || !self.pdf) return null;
      self.scale = s;
      return self.pdf.getPage(self.page);
    }).then(function (page) {
      if (!page || gen !== self._gen) return null;
      var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      var cssVp = page.getViewport({ scale: self.scale, rotation: 0 });
      var vp = page.getViewport({ scale: self.scale * dpr, rotation: 0 });
      var canvas = self.canvas;
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      canvas.style.width = Math.round(cssVp.width) + 'px';
      canvas.style.height = Math.round(cssVp.height) + 'px';
      self._cssW = cssVp.width;
      self._cssH = cssVp.height;
      self._lastCssVp = cssVp;
      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      self.textLayer.innerHTML = '';
      self.textLayer.style.width = canvas.style.width;
      self.textLayer.style.height = canvas.style.height;
      self.hlLayer.style.width = canvas.style.width;
      self.hlLayer.style.height = canvas.style.height;
      var task = page.render({ canvasContext: ctx, viewport: vp });
      self.renderTask = task;
      return task.promise.then(function () {
        if (gen !== self._gen) return null;
        return page.getTextContent();
      }).then(function (tc) {
        if (!tc || gen !== self._gen) return;
        if (root.pdfjsLib.renderTextLayer) {
          root.pdfjsLib.renderTextLayer({
            textContent: tc,
            container: self.textLayer,
            viewport: cssVp,
            textDivs: []
          });
        }
        self.paintSentence();
      });
    }).catch(function (e) {
      var msg = (e && e.message) || String(e);
      if (/cancelled/i.test(msg)) return;
      throw e;
    }).then(function () {
      if (gen !== self._gen) return;
      self.rendering = false;
      self.onChange();
      if (self.pending) return self.draw();
    });
  };

  View.prototype.go = function (n) {
    if (!this.pdf) return Promise.resolve();
    n = Math.max(1, Math.min(this.numPages, n | 0));
    if (n === this.page && !this.pending && !this.rendering) {
      this.paintSentence();
      this.onChange();
      return Promise.resolve();
    }
    this.page = n;
    return this.draw();
  };

  View.prototype.showSentence = function (sent) {
    this.sentence = sent || null;
    var page = sent && sent.page ? sent.page : this.page;
    if (!this.pdf) return Promise.resolve();
    if (page !== this.page) return this.go(page);
    this.paintSentence();
    this.onChange();
    return Promise.resolve();
  };

  View.prototype.paintSentence = function () {
    var layer = this.hlLayer;
    if (!layer) return;
    layer.innerHTML = '';
    var sent = this.sentence;
    if (!sent || !sent.runs || !this._lastCssVp || !root.pdfjsLib || !root.pdfjsLib.Util) return;
    var vp = this._lastCssVp;
    var i;
    for (i = 0; i < sent.runs.length; i++) {
      var run = sent.runs[i];
      if (!run.transform || run.page !== this.page) continue;
      var t = root.pdfjsLib.Util.transform(vp.transform, run.transform);
      var x = t[4];
      var y = t[5];
      var h = Math.hypot(t[2], t[3]) || run.height || 10;
      var w = (run.width || 0) * (vp.scale || 1);
      if (!(w > 1)) w = Math.max(8, String(run.text || '').length * h * 0.45);
      var div = document.createElement('div');
      div.className = 'hl';
      div.style.left = x + 'px';
      div.style.top = (y - h) + 'px';
      div.style.width = Math.max(w, 4) + 'px';
      div.style.height = Math.max(h, 4) + 'px';
      layer.appendChild(div);
    }
    var box = layer.firstChild;
    if (box && box.scrollIntoView) {
      try { box.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { void e; }
    }
  };

  View.prototype.close = function () {
    this._gen++;
    var old = this._teardown();
    this.bytes = null;
    this.name = '';
    this.numPages = 0;
    this.sentences = [];
    this.sentence = null;
    this.page = 1;
    this._lastCssVp = null;
    if (this.hlLayer) this.hlLayer.innerHTML = '';
    if (this.textLayer) this.textLayer.innerHTML = '';
    return Promise.resolve(old);
  };

  root.PdfView = View;
})(typeof window !== 'undefined' ? window : this);
