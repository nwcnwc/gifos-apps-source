/* Whiteboard: the GifOS shell around the Excalidraw engine.
 *
 * The engine (window.ExcalidrawLib) draws. collab.js shares: every change on
 * this page goes to the room as this page's own rows, and every row from the
 * room is merged into the scene. This file joins the two and adds the workshop
 * tools on the right edge: sticky notes, dots, highlighter, timer, templates
 * and the exports.
 */
(function () {
  'use strict';

  var EX = window.ExcalidrawLib, WB = window.WB || {};
  var rootEl = document.getElementById('root');
  var gifos = window.gifos || null;

  // ---- words -------------------------------------------------------------------
  var EN = WB.EN || {};
  var i18nReady = false;
  function T(key, params) {
    if (i18nReady) { try { var s = gifos.i18n.t(key, params); if (s && s !== key) return s; } catch (e) {} }
    var en = String(EN[key] == null ? key : EN[key]);
    // English fallback without the platform: a small reader for {n, plural, one {..} other {..}} and {name}
    en = en.replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, function (_, k, one, other) {
      var n = params ? params[k] : 0; return (n === 1 ? one : other).replace('#', String(n));
    });
    return en.replace(/\{(\w+)\}/g, function (_, k) { return params && params[k] != null ? String(params[k]) : ''; });
  }
  function fail(msg) { if (rootEl) { rootEl.innerHTML = ''; var d = document.createElement('div'); d.className = 'boot'; d.textContent = msg; rootEl.appendChild(d); } }

  if (!EX || !EX.Excalidraw || !EX.React || !EX.createRoot || !WB.Collab || !WB.Export) { fail(T('failed')); return; }
  var h = EX.React.createElement;

  // Opened outside GifOS (a developer looking at the page): a room of one, in memory.
  function memoryApi() {
    var cols = {}, subs = {};
    function fire(c) { (subs[c] || []).forEach(function (cb) { cb(Object.keys(cols[c] || {}).map(function (k) { return cols[c][k]; })); }); }
    return {
      db: function (c) {
        return {
          put: function (r) { (cols[c] = cols[c] || {})[r.id] = JSON.parse(JSON.stringify(r)); fire(c); return Promise.resolve({ id: r.id }); },
          delete: function (id) { if (cols[c]) delete cols[c][id]; fire(c); return Promise.resolve(true); },
          subscribe: function (cb) { (subs[c] = subs[c] || []).push(cb); Promise.resolve().then(function () { fire(c); }); }
        };
      },
      me: function () { return Promise.resolve({ id: 'local', name: '' }); }
    };
  }
  var api = gifos && gifos.db ? gifos : memoryApi();

  var NOTE_COLORS = [['yellow', '#ffec99'], ['pink', '#fcc2d7'], ['blue', '#a5d8ff'], ['green', '#b2f2bb'], ['orange', '#ffd8a8'], ['purple', '#d0bfff']];
  var DOT = '#e03131', INK = '#1e1e1e';
  var LANG = { en: 'en', de: 'de-DE', es: 'es-ES', ru: 'ru-RU', zh: 'zh-CN' };

  var ex = null;            // the engine's API
  var board = null, sync = null, me = { id: 'local', name: '' };
  var applyQueue = Object.create(null), applyTimer = 0, applying = false, firstFit = false, staleTries = Object.create(null), touched = false;
  var people = [];
  var noteN = 0;
  var hl = null;            // what the pen was before the highlighter was switched on
  var timer = null, timerTick = 0;

  function nonce() { return Math.floor(Math.random() * 2147483647); }
  function rid() { var s = ''; while (s.length < 20) s += Math.random().toString(36).slice(2); return s.slice(0, 20); }
  // A changed copy of an element, the way the engine would have changed it.
  function bump(el, patch) { return Object.assign({}, el, patch, { version: el.version + 1, versionNonce: nonce(), updated: Date.now() }); }

  // ---- room -> scene -----------------------------------------------------------
  function busy(st) { return !!(st.editingTextElement || st.newElement || st.multiElement || st.draggingElement || st.resizingElement || st.selectedElementsAreBeingDragged); }

  function applyNow() {
    applyTimer = 0;
    if (!ex) return;
    var st = ex.getAppState(), ids = Object.keys(applyQueue);
    if (!ids.length) return;
    var remote = [];
    for (var i = 0; i < ids.length; i++) { var w = board.get(ids[i]); if (w) remote.push(w); }
    applyQueue = Object.create(null);
    var scene = ex.getSceneElementsIncludingDeleted(), merged;
    // The engine's check re-numbers the stacking order of any list that is not already
    // in that order, and a re-numbered element counts as changed: handed the room's rows
    // as they come, it would rewrite the whole board each time somebody joins. So the
    // list goes in sorted by the shared order (ties by id, the engine's own tie-break),
    // and each element keeps the order value the room gave it.
    remote.sort(function (a, b) { var x = a.index || '', y = b.index || ''; return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    try {
      var given = Object.create(null);
      remote.forEach(function (r) { given[r.id] = r.index; });
      remote = EX.restoreElements(remote, null).map(function (r) {
        return typeof given[r.id] === 'string' && r.index !== given[r.id] ? Object.assign({}, r, { index: given[r.id] }) : r;
      });
    } catch (e) {}
    try { merged = EX.reconcileElements(scene, remote, st); }
    catch (e2) { // the engine's merge refused: do the same rule by hand
      var by = Object.create(null); merged = scene.slice();
      for (var j = 0; j < merged.length; j++) by[merged[j].id] = j;
      remote.forEach(function (r) { if (by[r.id] == null) merged.push(r); else if (WB.Collab.newer(r, merged[by[r.id]])) merged[by[r.id]] = r; });
    }
    applying = true;
    try { ex.updateScene({ elements: merged, captureUpdate: EX.CaptureUpdateAction ? EX.CaptureUpdateAction.NEVER : 'NEVER' }); }
    finally { applying = false; }
    // Someone who arrives at a board that is already there is shown all of it, once,
    // never closer than life size, and never once they have started working.
    if (!firstFit && merged.length) {
      firstFit = true;
      if (!touched) { try { ex.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1, animate: false }); } catch (e3) {} }
    }
  }
  function queueApply(els) {
    for (var i = 0; i < els.length; i++) applyQueue[els[i].id] = 1;
    if (!applyTimer) applyTimer = setTimeout(applyNow, 30);
  }

  // ---- scene -> room -----------------------------------------------------------
  function onChange(elements, st) {
    if (!board) return;
    var hold = null;
    ['newElement', 'multiElement', 'editingTextElement', 'draggingElement'].forEach(function (k) {
      if (st[k] && st[k].id) { (hold = hold || {})[st[k].id] = 1; }
    });
    var r = board.local(elements, hold);
    if (r.marked) { touched = true; sync.touch(); }
    // A copy on this page that lost to the room (the engine kept it while it was being edited): take the room's.
    // Asked a few times at most per copy: if the engine keeps its own, it has a reason this file does not know.
    if (r.stale.length && !busy(st) && !applying) {
      var again = r.stale.filter(function (id) {
        var w = board.get(id), k = w ? WB.Collab.keyOf(w) : '', t = staleTries[id];
        if (!t || t.k !== k) t = staleTries[id] = { k: k, n: 0 };
        return ++t.n <= 3;
      });
      if (again.length) queueApply(again.map(function (id) { return { id: id }; }));
    }
    watchTool(st);
  }

  // ---- people --------------------------------------------------------------------
  function hue(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }
  function onPeople(list) {
    people = list;
    if (ex) {
      var map = new Map();
      list.forEach(function (p) {
        if (p.me) return;
        var c = { username: p.name || T('guest'), id: p.id, color: { background: 'hsl(' + hue(p.pid) + ',70%,85%)', stroke: 'hsl(' + hue(p.pid) + ',70%,40%)' } };
        if (p.x != null && p.y != null) c.pointer = { x: p.x, y: p.y, tool: 'pointer' };
        map.set(p.id, c);
      });
      try { ex.updateScene({ collaborators: map }); } catch (e) {}
    }
    paintStatus();
  }

  var lastStatus = { pending: 0, refused: false };
  function paintStatus() {
    var el = document.getElementById('wb-status'); if (!el) return;
    var s = lastStatus, key = s.refused ? 'waiting' : s.pending ? 'saving' : 'saved';
    el.dataset.state = key;
    var n = Math.max(1, people.length);
    el.querySelector('.n').textContent = String(n);
    var label = T('status.' + key) + '. ' + T('people', { n: n });
    el.title = label; el.setAttribute('aria-label', label);
    var live = document.getElementById('wb-live');
    if (live && live.dataset.k !== key) { live.dataset.k = key; if (key !== 'saving') live.textContent = T('status.' + key); }
  }
  function say(text) { var live = document.getElementById('wb-live'); if (live) { live.textContent = ''; setTimeout(function () { live.textContent = text; }, 30); } toast(text); }
  function toast(text) { try { ex.setToast({ message: text, duration: 3000, closable: true }); } catch (e) {} }

  // ---- adding things ---------------------------------------------------------------
  function viewCentre() {
    var st = ex.getAppState(), z = (st.zoom && st.zoom.value) || 1;
    return { x: -st.scrollX + st.width / 2 / z, y: -st.scrollY + st.height / 2 / z, z: z };
  }
  function insert(els, select) {
    var scene = ex.getSceneElementsIncludingDeleted();
    var sel = {}; (select || els).forEach(function (e) { if (e.type !== 'text' || !e.containerId) sel[e.id] = true; });
    ex.updateScene({ elements: scene.concat(els), appState: { selectedElementIds: sel },
                     captureUpdate: EX.CaptureUpdateAction ? EX.CaptureUpdateAction.IMMEDIATELY : 'IMMEDIATELY' });
  }
  function replace(changed, added) {
    var by = Object.create(null); changed.forEach(function (e) { by[e.id] = e; });
    var scene = ex.getSceneElementsIncludingDeleted().map(function (e) { return by[e.id] || e; });
    ex.updateScene({ elements: scene.concat(added || []), captureUpdate: EX.CaptureUpdateAction ? EX.CaptureUpdateAction.IMMEDIATELY : 'IMMEDIATELY' });
  }
  function tag(els, type, data) { els.forEach(function (e) { if (e.type === type) e.customData = Object.assign({}, e.customData, data); }); return els; }

  function addNote(color) {
    var c = viewCentre(), k = noteN++ % 8, size = 180;
    var els = EX.convertToExcalidrawElements([{
      type: 'rectangle', x: c.x - size / 2 + k * 22, y: c.y - size / 2 + k * 22, width: size, height: size,
      backgroundColor: color, strokeColor: color, fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: null,
      label: { text: T('note.text'), fontSize: 20, strokeColor: INK }
    }]);
    tag(els, 'rectangle', { wb: 'note' });
    insert(els);
    try { ex.setActiveTool({ type: 'selection' }); } catch (e) {}
  }

  function selected() {
    var st = ex.getAppState(), ids = st.selectedElementIds || {}, all = ex.getSceneElements(), by = Object.create(null), out = [];
    all.forEach(function (e) { by[e.id] = e; });
    Object.keys(ids).forEach(function (id) {
      if (!ids[id] || !by[id]) return;
      var e = by[id];
      if (e.type === 'text' && e.containerId && by[e.containerId]) e = by[e.containerId];
      if (out.indexOf(e) < 0) out.push(e);
    });
    return out;
  }
  function votable(e) { return (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') && !(e.customData && e.customData.wb === 'dot'); }
  function dotsOn(id) { return ex.getSceneElements().filter(function (e) { return e.customData && e.customData.wb === 'dot' && e.customData.on === id; }); }

  // A dot is a small red circle on the note, in the note's group so it moves with it.
  function vote() {
    var targets = selected().filter(votable);
    if (!targets.length) { say(T('vote.pick')); return; }
    var changed = [], added = [], all = ex.getSceneElements();
    targets.forEach(function (n) {
      var gid = n.groupIds && n.groupIds.length ? n.groupIds[n.groupIds.length - 1] : null;
      if (!gid) {
        gid = rid();
        changed.push(bump(n, { groupIds: [gid] }));
        all.forEach(function (t) { if (t.type === 'text' && t.containerId === n.id) changed.push(bump(t, { groupIds: [gid] })); });
      }
      var d = 22, x = n.x + 8 + Math.random() * Math.max(1, n.width - d - 16), y = n.y + n.height - d - 6 - Math.random() * 10;
      var els = EX.convertToExcalidrawElements([{ type: 'ellipse', x: x, y: y, width: d, height: d, backgroundColor: DOT, strokeColor: DOT, fillStyle: 'solid', strokeWidth: 1, roughness: 0 }]);
      els.forEach(function (e) { e.groupIds = n.groupIds && n.groupIds.length ? n.groupIds.slice() : [gid]; e.customData = { wb: 'dot', on: n.id, by: me.id }; });
      added = added.concat(els);
    });
    replace(changed, added);
  }
  function unvote() {
    var gone = [];
    selected().forEach(function (e) {
      var id = e.customData && e.customData.wb === 'dot' ? e.customData.on : e.id;
      var mine = dotsOn(id).filter(function (d) { return d.customData.by === me.id; });
      if (mine.length) gone.push(bump(mine[mine.length - 1], { isDeleted: true }));
    });
    if (!gone.length) { say(selected().length ? T('vote.none') : T('vote.pick')); return; }
    replace(gone);
  }

  // The highlighter is the pen with a wide, see-through yellow line. Leaving the pen puts the pen back as it was.
  function toggleHl() {
    var st = ex.getAppState();
    if (hl) { ex.updateScene({ appState: hl }); hl = null; }
    else {
      hl = { currentItemStrokeColor: st.currentItemStrokeColor, currentItemStrokeWidth: st.currentItemStrokeWidth, currentItemOpacity: st.currentItemOpacity };
      ex.updateScene({ appState: { currentItemStrokeColor: '#ffd43b', currentItemStrokeWidth: 4, currentItemOpacity: 40 } });
      try { ex.setActiveTool({ type: 'freedraw' }); } catch (e) {}
    }
    paintHl();
  }
  function paintHl() { var b = document.getElementById('wb-hl'); if (b) b.setAttribute('aria-pressed', hl ? 'true' : 'false'); }
  function watchTool(st) {
    if (hl && st.activeTool && st.activeTool.type !== 'freedraw') {
      var back = hl; hl = null; paintHl();
      setTimeout(function () { try { ex.updateScene({ appState: back }); } catch (e) {} }, 0);
    }
  }

  // ---- frames and templates ---------------------------------------------------------
  function freeSpot(w) {
    var live = ex.getSceneElements();
    if (!live.length) { var c = viewCentre(); return { x: c.x - w / 2, y: c.y - 300 }; }
    var b = EX.getCommonBounds(live);
    return { x: b[2] + 120, y: b[1] };
  }
  function frameCount() { return ex.getSceneElements().filter(function (e) { return e.type === 'frame'; }).length; }
  function addTemplate(kind) {
    var W = 1280, H = 720, p = freeSpot(W), sk = [], kids = [];
    function child(o) { o.id = rid(); kids.push(o.id); sk.push(o); return o; }
    var name = kind === 'brainstorm' ? T('tpl.brainstorm') : kind === 'retro' ? T('tpl.retro') : T('frame.name', { n: frameCount() + 1 });
    if (kind !== 'frame') {
      var cols = kind === 'brainstorm' ? [['tpl.b.ideas', '#fff9db'], ['tpl.b.themes', '#e7f5ff'], ['tpl.b.top', '#ebfbee']] : [['tpl.r.good', '#ebfbee'], ['tpl.r.bad', '#fff5f5'], ['tpl.r.act', '#e7f5ff']];
      var top = kind === 'brainstorm' ? 110 : 40, cw = (W - 80 - 40) / 3;
      if (kind === 'brainstorm') child({ type: 'text', x: p.x + 40, y: p.y + 36, text: T('tpl.b.q'), fontSize: 36, strokeColor: INK });
      cols.forEach(function (c, i) {
        var x = p.x + 40 + i * (cw + 20);
        child({ type: 'rectangle', x: x, y: p.y + top, width: cw, height: H - top - 40, backgroundColor: c[1], strokeColor: '#ced4da', fillStyle: 'solid', strokeWidth: 1, roughness: 0, roundness: null, locked: false });
        child({ type: 'text', x: x + 16, y: p.y + top + 14, text: T(c[0]), fontSize: 24, strokeColor: INK });
      });
    }
    sk.push({ type: 'frame', x: p.x, y: p.y, width: W, height: H, name: name, children: kids });
    var els = EX.convertToExcalidrawElements(sk, { regenerateIds: false });
    var frame = els.filter(function (e) { return e.type === 'frame'; })[0];
    // The frame is exactly the slide size, whatever the engine made of its children.
    if (frame) { frame.x = p.x; frame.y = p.y; frame.width = W; frame.height = H; els.forEach(function (e) { if (e !== frame) e.frameId = frame.id; }); }
    insert(els, frame ? [frame] : els);
    try { ex.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true }); } catch (e) {}
  }

  // ---- timer (one row per page that set it; the newest setting wins) ------------------
  var meta = null, timerRows = [];
  function setTimer(mins) {
    var now = Date.now();
    var row = { id: board.actor + '/timer', a: board.actor, at: now, end: mins ? now + mins * 60000 : 0, dur: mins * 60000 };
    Promise.resolve(meta.put(row)).catch(function () {});
  }
  function onMeta(rows) {
    timerRows = rows || [];
    var best = null;
    timerRows.forEach(function (r) {
      if (!r || typeof r.id !== 'string' || !/\/timer$/.test(r.id) || typeof r.at !== 'number' || typeof r.end !== 'number') return;
      if (!best || r.at > best.at || (r.at === best.at && r.id > best.id)) best = r;
    });
    timer = best && best.end > Date.now() - 4000 ? best : null;
    if (timer && !timerTick) timerTick = setInterval(paintTimer, 500);
    paintTimer();
  }
  var timerDoneFor = 0;
  function paintTimer() {
    var b = document.getElementById('wb-timer'); if (!b) return;
    var out = b.querySelector('.t');
    if (!timer) { out.textContent = ''; b.classList.remove('on', 'done'); if (timerTick) { clearInterval(timerTick); timerTick = 0; } return; }
    var left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    var txt = Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    out.textContent = txt;
    b.classList.add('on'); b.classList.toggle('done', left === 0);
    b.setAttribute('aria-label', T('timer') + ': ' + T('timer.left', { time: txt }));
    if (left === 0 && timerDoneFor !== timer.end) { timerDoneFor = timer.end; say(T('timer.done')); }
    if (left === 0 && Date.now() - timer.end > 4000) { timer = null; paintTimer(); }
  }

  // ---- export -------------------------------------------------------------------------
  function hex(c, fallback) {
    if (typeof c !== 'string') return fallback;
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
    return fallback;
  }
  // Frames in reading order; with no frame, the whole board is one slide.
  function slides() {
    var live = ex.getSceneElements();
    var frames = live.filter(function (e) { return e.type === 'frame'; });
    if (!frames.length) {
      if (!live.length) return [];
      var b = EX.getCommonBounds(live), pad = 40;
      return [{ title: T('title'), x: b[0] - pad, y: b[1] - pad, w: b[2] - b[0] + 2 * pad, h: b[3] - b[1] + 2 * pad, frame: null, els: live }];
    }
    frames.sort(function (a, b) { var row = Math.abs(a.y - b.y) > Math.min(a.height, b.height) / 2; return row ? a.y - b.y : a.x - b.x; });
    return frames.map(function (f, i) {
      return { title: f.name || T('frame.name', { n: i + 1 }), x: f.x, y: f.y, w: f.width, h: f.height, frame: f,
               els: live.filter(function (e) { return e.frameId === f.id; }) };
    });
  }
  function blobBytes(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = function () { rej(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }
  // What PowerPoint has no shape for (freehand, pictures, curves) goes in as one picture per slide.
  function isNative(e) {
    if (e.angle) return false;
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'text') return true;
    if ((e.type === 'arrow' || e.type === 'line') && e.points && e.points.length >= 2 && !(e.roundness && e.points.length > 2)) return true;
    return false;
  }
  function slideItems(s) {
    var items = [], by = Object.create(null), dots = Object.create(null), ink = [];
    s.els.forEach(function (e) { by[e.id] = e; });
    s.els.forEach(function (e) { if (e.customData && e.customData.wb === 'dot' && by[e.customData.on]) dots[e.customData.on] = (dots[e.customData.on] || 0) + 1; });
    var labels = Object.create(null);
    s.els.forEach(function (e) { if (e.type === 'text' && e.containerId && by[e.containerId]) labels[e.containerId] = e; });
    s.els.forEach(function (e) {
      if (!isNative(e)) { ink.push(e); return; }
      var x = e.x - s.x, y = e.y - s.y;
      if (e.type === 'text') {
        if (e.containerId && by[e.containerId] && by[e.containerId].type !== 'arrow' && by[e.containerId].type !== 'line' && isNative(by[e.containerId])) return;
        items.push({ k: 'text', id: e.id, x: x, y: y, w: e.width + 16, h: e.height + 8, tx: e.originalText || e.text || '', color: hex(e.strokeColor, INK), sz: e.fontSize || 20 });
        return;
      }
      if (e.type === 'arrow' || e.type === 'line') {
        var pts = e.points, a = e.startBinding && by[e.startBinding.elementId] ? e.startBinding.elementId : null, b = e.endBinding && by[e.endBinding.elementId] ? e.endBinding.elementId : null;
        for (var i = 0; i + 1 < pts.length; i++) {
          var last = i + 2 === pts.length;
          items.push({ k: 'line', id: e.id + (i ? '.' + i : ''), x: x + pts[i][0], y: y + pts[i][1], x2: x + pts[i + 1][0], y2: y + pts[i + 1][1],
                       ar: last && e.endArrowhead ? 1 : 0, stroke: hex(e.strokeColor, INK), a: i === 0 ? a : null, b: last ? b : null });
        }
        return;
      }
      if (e.customData && e.customData.wb === 'dot' && by[e.customData.on] && isNative(by[e.customData.on])) return; // counted on its note
      var note = e.customData && e.customData.wb === 'note', t = labels[e.id];
      var fill = e.backgroundColor && e.backgroundColor !== 'transparent' ? hex(e.backgroundColor, null) : null;
      var it = { k: note ? 'note' : e.type === 'ellipse' ? 'ell' : e.type === 'diamond' ? 'dia' : 'rect', id: e.id, x: x, y: y, w: e.width, h: e.height,
                 tx: t ? (t.originalText || t.text || '') : '' };
      if (note) { it.fill = fill || '#ffec99'; it.color = t ? hex(t.strokeColor, INK) : INK; it.votes = dots[e.id] || 0; }
      else { it.fill = fill; it.stroke = hex(e.strokeColor, INK); if (dots[e.id]) it.tx += (it.tx ? '\n' : '') + new Array(dots[e.id] + 1).join('●'); }
      items.push(it);
    });
    return { items: items, ink: ink };
  }
  function inkPng(s, ink) {
    if (!ink.length) return Promise.resolve(null);
    var b = EX.getCommonBounds(ink), pad = 8;
    return EX.exportToBlob({ elements: ink, files: ex.getFiles ? ex.getFiles() : null, mimeType: 'image/png', exportPadding: pad, maxWidthOrHeight: 2400,
                             appState: { exportBackground: false, viewBackgroundColor: 'transparent', exportWithDarkMode: false, exportEmbedScene: false } })
      .then(blobBytes).then(function (png) { return { png: png, rect: { x: b[0] - pad - s.x, y: b[1] - pad - s.y, w: b[2] - b[0] + 2 * pad, h: b[3] - b[1] + 2 * pad } }; });
  }
  function buildPptx() {
    var list = slides();
    if (!list.length) return Promise.reject(new Error('empty'));
    var deck = { title: T('title'), slides: [] }, chain = Promise.resolve();
    list.forEach(function (s) {
      chain = chain.then(function () {
        var parts = slideItems(s);
        return inkPng(s, parts.ink).then(function (ink) {
          deck.slides.push({ title: s.title, w: s.w, h: s.h, items: parts.items, ink: ink ? ink.png : null, inkRect: ink ? ink.rect : null });
        });
      });
    });
    return chain.then(function () { return WB.Export.pptx(deck); });
  }
  function slideCanvas(s, max) {
    var opt = { elements: s.frame ? s.els.concat([s.frame]) : s.els, files: ex.getFiles ? ex.getFiles() : null, maxWidthOrHeight: max, exportPadding: s.frame ? 0 : 40,
                appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false, exportEmbedScene: false } };
    if (s.frame) opt.exportingFrame = s.frame;
    return EX.exportToCanvas(opt);
  }
  function canvasBytes(canvas, type, q) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { if (b) blobBytes(b).then(res, rej); else rej(new Error('no picture')); }, type, q); });
  }
  // The frame to picture: the selected one, else the one in the middle of the view, else the first.
  function currentSlide() {
    var list = slides(); if (!list.length) return null;
    var sel = selected().filter(function (e) { return e.type === 'frame'; })[0], c = viewCentre();
    for (var i = 0; i < list.length; i++) if (sel && list[i].frame === sel) return list[i];
    for (var j = 0; j < list.length; j++) { var s = list[j]; if (c.x >= s.x && c.x <= s.x + s.w && c.y >= s.y && c.y <= s.y + s.h) return s; }
    return list[0];
  }
  function buildPng() {
    var s = currentSlide(); if (!s) return Promise.reject(new Error('empty'));
    return slideCanvas(s, 3000).then(function (c) { return canvasBytes(c, 'image/png'); });
  }
  function buildPdf() {
    var list = slides(); if (!list.length) return Promise.reject(new Error('empty'));
    var pages = [], chain = Promise.resolve();
    list.forEach(function (s) {
      chain = chain.then(function () {
        return slideCanvas(s, 2400).then(function (c) {
          return canvasBytes(c, 'image/jpeg', 0.9).then(function (jpeg) {
            var k = 842 / Math.max(c.width, c.height);
            pages.push({ w: Math.round(c.width * k), h: Math.round(c.height * k), jpeg: jpeg, pxW: c.width, pxH: c.height });
          });
        });
      });
    });
    return chain.then(function () { return WB.Export.pdf({ pages: pages }); });
  }
  var lastExport = null;
  // The OS's save (gifos.file.save, GifOS 0.9.26+): a download on the web, the system save or share sheet in
  // the GifOS Meet app. An older OS has no such call: the plain download link below, as before.
  function saveFile(bytes, name, mime) {
    lastExport = { name: name, mime: mime, bytes: bytes };
    var g = typeof gifos !== 'undefined' ? gifos : null;
    if (g && g.file && typeof g.file.save === 'function') {
      g.file.save(name, mime, bytes).catch(function () { linkSave(bytes, name, mime); });
      return;
    }
    linkSave(bytes, name, mime);
  }
  function linkSave(bytes, name, mime) {
    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 4000);
  }
  function stamp() { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function doExport(kind) {
    var name = 'whiteboard-' + stamp() + '.' + kind;
    var mime = kind === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : kind === 'pdf' ? 'application/pdf' : 'image/png';
    toast(T('export.working'));
    return (kind === 'pptx' ? buildPptx() : kind === 'pdf' ? buildPdf() : buildPng()).then(function (bytes) {
      saveFile(bytes, name, mime); say(T('export.done', { name: name })); return bytes;
    }, function (e) { say(e && e.message === 'empty' ? T('export.empty') : T('export.fail')); return null; });
  }

  // ---- the bar on the right edge ----------------------------------------------------------
  var ICON = {
    note: '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
    undot: '<circle cx="12" cy="12" r="5"/><path d="M5 5l14 14"/>',
    hl: '<path d="M4 20h6"/><path d="M8 16l-2-2 9-9 4 4-9 9z"/><path d="M13 7l4 4"/>',
    timer: '<circle cx="12" cy="13" r="7"/><path d="M12 13V9"/><path d="M9 3h6"/>',
    tpl: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16"/>',
    exp: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }

  var openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.menu.hidden = true; openMenu.btn.setAttribute('aria-expanded', 'false'); openMenu = null; } }
  function button(parent, id, icon, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'wb-btn'; b.innerHTML = svg(icon) + '<span class="t"></span>';
    b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(b); });
    parent.appendChild(b);
    return b;
  }
  function menuButton(parent, id, icon, label, entries) {
    var wrap = document.createElement('div'); wrap.className = 'wb-wrap';
    var menu = document.createElement('div'); menu.className = 'wb-menu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
    entries.forEach(function (en) {
      var it = document.createElement('button');
      it.type = 'button'; it.setAttribute('role', 'menuitem'); it.className = 'wb-item';
      if (en.swatch) { it.className += ' sw'; it.style.setProperty('--sw', en.swatch); it.setAttribute('aria-label', en.label); it.title = en.label; }
      else it.textContent = en.label;
      if (en.id) it.id = en.id;
      it.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); en.run(); });
      menu.appendChild(it);
    });
    var btn = button(wrap, id, icon, label, function (b) {
      var was = openMenu && openMenu.btn === b; closeMenu();
      if (!was) { menu.hidden = false; b.setAttribute('aria-expanded', 'true'); openMenu = { menu: menu, btn: b }; var first = menu.querySelector('button'); if (first) first.focus(); }
    });
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    menu.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('button')), i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); btn.focus(); e.stopPropagation(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    });
    wrap.appendChild(menu); parent.appendChild(wrap);
    return btn;
  }
  function buildRail() {
    var old = document.getElementById('wb-rail'); if (old) old.parentNode.removeChild(old);
    var rail = document.createElement('div');
    rail.id = 'wb-rail'; rail.setAttribute('role', 'toolbar'); rail.setAttribute('aria-label', T('rail')); rail.setAttribute('aria-orientation', 'vertical');
    var st = document.createElement('div');
    st.id = 'wb-status'; st.setAttribute('role', 'img'); st.innerHTML = '<span class="d"></span><span class="n">1</span>';
    rail.appendChild(st);
    menuButton(rail, 'wb-note', 'note', T('note'), NOTE_COLORS.map(function (c) { return { id: 'wb-note-' + c[0], swatch: c[1], label: T('note') + ': ' + T('color.' + c[0]), run: function () { addNote(c[1]); } }; }));
    button(rail, 'wb-vote', 'dot', T('vote'), vote);
    button(rail, 'wb-unvote', 'undot', T('unvote'), unvote);
    var hb = button(rail, 'wb-hl', 'hl', T('hl'), toggleHl); hb.setAttribute('aria-pressed', 'false');
    menuButton(rail, 'wb-timer', 'timer', T('timer'), [1, 3, 5, 10].map(function (m) { return { id: 'wb-timer-' + m, label: T('timer.min', { n: m }), run: function () { setTimer(m); } }; })
      .concat([{ id: 'wb-timer-stop', label: T('timer.stop'), run: function () { setTimer(0); } }]));
    menuButton(rail, 'wb-tpl', 'tpl', T('templates'), [
      { id: 'wb-tpl-frame', label: T('tpl.frame'), run: function () { addTemplate('frame'); } },
      { id: 'wb-tpl-brainstorm', label: T('tpl.brainstorm'), run: function () { addTemplate('brainstorm'); } },
      { id: 'wb-tpl-retro', label: T('tpl.retro'), run: function () { addTemplate('retro'); } }]);
    menuButton(rail, 'wb-exp', 'exp', T('export'), [
      { id: 'wb-exp-pptx', label: T('export.pptx'), run: function () { doExport('pptx'); } },
      { id: 'wb-exp-png', label: T('export.png'), run: function () { doExport('png'); } },
      { id: 'wb-exp-pdf', label: T('export.pdf'), run: function () { doExport('pdf'); } }]);
    document.body.appendChild(rail);
    if (!document.getElementById('wb-live')) {
      var live = document.createElement('div'); live.id = 'wb-live'; live.className = 'wb-sr'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
      document.body.appendChild(live);
    }
    paintStatus(); paintTimer(); paintHl();
  }
  document.addEventListener('click', closeMenu);

  // ---- start ------------------------------------------------------------------------------
  function langCode() {
    try { var l = gifos.locale(); return LANG[String(l.language || l.ui || 'en').slice(0, 2)] || 'en'; } catch (e) { return 'en'; }
  }
  var reactRoot = null;
  function mount() {
    rootEl.innerHTML = '';
    var host = document.createElement('div'); host.style.height = '100%'; host.style.width = '100%';
    rootEl.appendChild(host);
    if (reactRoot) { try { reactRoot.unmount(); } catch (e) {} }
    reactRoot = EX.createRoot(host);
    reactRoot.render(h(EX.Excalidraw, {
      excalidrawAPI: function (a) { if (a && a !== ex) { ex = a; started(); } },
      onChange: onChange,
      onPointerUpdate: function (p) { if (sync && p && p.pointer) sync.setPointer(p.pointer.x, p.pointer.y); },
      isCollaborating: true,
      langCode: langCode(),
      theme: 'light',
      name: T('title'),
      initialData: { elements: [], appState: { viewBackgroundColor: '#ffffff', currentItemRoughness: 1 } },
      UIOptions: { tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, toggleTheme: false, changeViewBackgroundColor: false } }
    }));
  }
  function started() {
    // Rows that arrived before the engine was ready.
    var els = board.elements();
    if (els.length) queueApply(els);
    onPeople(people);
    buildRail();
  }

  function boot() {
    Promise.resolve(api.me ? api.me() : null).catch(function () { return null; }).then(function (id) {
      me.id = String((id && id.id) || 'local'); me.name = String((id && id.name) || '');
      board = new WB.Collab.Board(me.id + '~' + rid().slice(0, 8));
      sync = WB.Collab.sync({ api: api, board: board, me: me, onApply: queueApply, onPeople: onPeople,
                              onStatus: function (s) { lastStatus = s; paintStatus(); } });
      meta = api.db('meta');
      mount();
      sync.start();
      meta.subscribe(onMeta);
      if (gifos && gifos.onIdentity) gifos.onIdentity(function (who) { if (who && who.name) sync.setName(String(who.name)); });
      if (gifos && gifos.onLocaleChange) gifos.onLocaleChange(function () { loadWords().then(function () { mount(); }); });
      window.addEventListener('pagehide', function () { try { sync.stop(); } catch (e) {} });
      // For tests and for a look from the console: what this page holds.
      window.__wb = {
        board: board, sync: sync, ex: function () { return ex; }, me: me,
        hash: function () { return board.hash(); },
        live: function () { return ex ? ex.getSceneElements().length : -1; },
        addNote: addNote, vote: vote, unvote: unvote, addTemplate: addTemplate, setTimer: setTimer, timer: function () { return timer; },
        build: { pptx: buildPptx, png: buildPng, pdf: buildPdf }, doExport: doExport, lastExport: function () { return lastExport; }
      };
    });
  }
  function loadWords() {
    if (!gifos || !gifos.i18n || !gifos.i18n.load) return Promise.resolve();
    return Promise.resolve(gifos.i18n.load()).then(function () { i18nReady = true; }, function () {});
  }
  loadWords().then(boot, boot);
})();
