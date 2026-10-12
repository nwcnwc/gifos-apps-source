/* The last PDF and the reading position live in the private save collection.
 * A file over 8 MB is opened for this visit and not kept. The position is still kept. */
(function (root) {
  'use strict';

  var MAX_BYTES = 8 * 1024 * 1024;

  function byteLength(bytes) {
    if (!bytes) return 0;
    if (bytes.byteLength != null) return bytes.byteLength;
    if (bytes.length != null) return bytes.length;
    return 0;
  }

  function toRecord(state) {
    state = state || {};
    var rec = {
      id: 'last',
      name: state.name || '',
      page: state.page || 1,
      sentence: state.sentence | 0,
      speed: state.speed || 1,
      fit: state.fit || 'width'
    };
    if (state.bytes && byteLength(state.bytes) <= MAX_BYTES) rec.bytes = state.bytes;
    return rec;
  }

  function resumeAt(sentences, saved) {
    var n = sentences ? sentences.length : 0;
    if (!n) return 0;
    if (!saved) return 0;
    var idx = saved.sentence;
    if (typeof idx === 'number' && isFinite(idx)) {
      if (idx < 0) return 0;
      if (idx >= n) return n - 1;
      return idx;
    }
    if (saved.page != null && saved.page !== '') {
      var page = saved.page | 0;
      var i;
      for (i = 0; i < n; i++) {
        var sp = sentences[i] && sentences[i].page != null ? sentences[i].page : 1;
        if (sp >= page) return i;
      }
      return n - 1;
    }
    return 0;
  }

  function placeAt(sentences, saved) {
    var index = resumeAt(sentences, saved);
    var s = sentences && sentences[index];
    var page = s && s.page ? s.page : ((saved && saved.page) || 1);
    return { index: index, page: page };
  }

  function load(db) {
    if (!db || typeof db.get !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return db.get('last'); }).catch(function () { return null; });
  }

  function save(db, state) {
    if (!db || typeof db.put !== 'function') return Promise.resolve(null);
    var rec = toRecord(state);
    return Promise.resolve().then(function () { return db.put(rec); }).then(function () { return rec; }, function () { return rec; });
  }

  root.PdfStore = {
    MAX_BYTES: MAX_BYTES,
    toRecord: toRecord,
    resumeAt: resumeAt,
    placeAt: placeAt,
    load: load,
    save: save
  };
})(typeof window !== 'undefined' ? window : this);
