/* Meeting Bot UI. Commands are structured chat on the admin meeting only. */
(function () {
  var DUP = BotProto.DUP;
  var state = {
    phase: 'idle',
    name: '',
    admin: null,
    adminId: '',
    probeId: '',
    instance: 'in_' + Math.random().toString(36).slice(2),
    meetings: {},
    lines: {},
    probeBeat: null,
    warned: {},
    ctrlItems: []
  };

  var warnEl = document.getElementById('warn');
  var suggestEl = document.getElementById('suggest');
  var phaseEl = document.getElementById('phase');
  var logEl = document.getElementById('log');
  var ignoredEl = document.getElementById('ignored');
  var rulesEl = document.getElementById('rules');

  function warn(text) {
    warnEl.textContent = text || '';
    warnEl.classList.toggle('show', !!text);
  }
  function log(line) {
    logEl.textContent += (logEl.textContent ? '\n' : '') + line;
  }
  function noteIgnored() {
    ignoredEl.textContent = 'Ignored command-like chat outside the admin meeting.';
  }
  function workMeetings() {
    return Object.keys(state.meetings).filter(function (id) { return !state.meetings[id].control; }).map(function (id) {
      var m = state.meetings[id];
      return { id: m.meetingId, room: m.room || '', link: m.link || '', rec: !!m.rec, cc: !!m.cc };
    });
  }
  function paint() {
    var label = { idle: '', probe: 'Checking whether this bot is already running…', run: 'Running', control: 'Controlling' };
    phaseEl.textContent = label[state.phase] || state.phase;
    document.getElementById('runbox').hidden = state.phase !== 'run';
    document.getElementById('ctrl').hidden = state.phase !== 'control';
    document.getElementById('rules-label').hidden = document.getElementById('mode-control').checked && state.phase === 'idle';
    var ul = document.getElementById('run-meetings');
    ul.innerHTML = '';
    workMeetings().forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = m.id + '  ' + (m.link || m.room) + (m.rec ? '  ⏺ recording' : '') + (m.cc ? '  📝 transcribing' : '');
      ul.appendChild(li);
    });
    if (state.phase === 'control') renderCtrl(state.ctrlItems);
  }
  function renderCtrl(items) {
    state.ctrlItems = items || [];
    var box = document.getElementById('ctrl-meetings');
    box.innerHTML = '';
    if (!state.ctrlItems.length) {
      var empty = document.createElement('p');
      empty.textContent = 'No work meetings yet.';
      box.appendChild(empty);
      return;
    }
    state.ctrlItems.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'meet';
      row.dataset.id = m.id;
      var title = document.createElement('div');
      title.innerHTML = '<b></b>';
      title.querySelector('b').textContent = m.id;
      var sub = document.createElement('div');
      sub.textContent = m.link || m.room || '';
      var flags = document.createElement('div');
      flags.className = 'chips';
      flags.textContent = (m.rec ? '⏺ recording  ' : '') + (m.cc ? '📝 transcribing' : '');
      var rec = document.createElement('button');
      rec.type = 'button';
      rec.textContent = m.rec ? 'Record off' : 'Record on';
      rec.onclick = function () { sendCtrl({ op: 'record', meetingId: m.id, on: !m.rec, id: qid() }); };
      var tr = document.createElement('button');
      tr.type = 'button';
      tr.textContent = m.cc ? 'Transcribe off' : 'Transcribe on';
      tr.onclick = function () { sendCtrl({ op: 'transcribe', meetingId: m.id, on: !m.cc, id: qid() }); };
      var say = document.createElement('input');
      say.type = 'text';
      say.placeholder = 'Send into this meeting';
      var sayGo = document.createElement('button');
      sayGo.type = 'button';
      sayGo.textContent = 'Send';
      sayGo.onclick = function () { sendCtrl({ op: 'say', meetingId: m.id, text: say.value, id: qid() }); say.value = ''; };
      var dl = document.createElement('button');
      dl.type = 'button';
      dl.textContent = 'Download transcript';
      dl.onclick = function () { sendCtrl({ op: 'transcript', meetingId: m.id, id: qid() }); };
      var dlr = document.createElement('button');
      dlr.type = 'button';
      dlr.textContent = 'Download recording';
      dlr.onclick = function () { sendCtrl({ op: 'recording', meetingId: m.id, id: qid() }); };
      var leave = document.createElement('button');
      leave.type = 'button';
      leave.className = 'ghost';
      leave.textContent = 'Leave';
      leave.onclick = function () { sendCtrl({ op: 'leave', meetingId: m.id, id: qid() }); };
      row.appendChild(title);
      row.appendChild(sub);
      row.appendChild(flags);
      [rec, tr, say, sayGo, dl, dlr, leave].forEach(function (el) { row.appendChild(el); });
      box.appendChild(row);
    });
  }
  function qid() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function adminEvent(ev) {
    if (!ev || !ev.control) return false;
    if (state.phase === 'probe') return ev.meetingId === state.probeId;
    return !!state.adminId && ev.meetingId === state.adminId;
  }

  function reply(extra) {
    var msg = Object.assign({ v: 1, role: 'bot', instance: state.instance, id: qid() }, extra || {});
    return gifos.meet.sendChat(state.adminId, BotProto.encode(msg));
  }
  function sendCtrl(msg) {
    msg = Object.assign({ v: 1, role: 'controller', instance: state.instance }, msg || {});
    if (!msg.id) msg.id = qid();
    log('→ ' + msg.op + (msg.meetingId ? ' ' + msg.meetingId : ''));
    return gifos.meet.sendChat(state.adminId, BotProto.encode(msg));
  }
  function sendXferRetry(id, name, mime, bytes, left) {
    return gifos.meet.sendXfer(state.adminId, { id: id, name: name, mime: mime, bytes: bytes }).catch(function (e) {
      if (left > 1 && /data channel/i.test(String(e && e.message || e))) {
        return new Promise(function (res) { setTimeout(res, 1000); }).then(function () {
          return sendXferRetry(id, name, mime, bytes, left - 1);
        });
      }
      throw e;
    });
  }
  function remember(sess, link, control) {
    state.meetings[sess.meetingId] = {
      meetingId: sess.meetingId, room: sess.room || '', link: link || sess.link || '', control: !!control, rec: false, cc: false
    };
    state.lines[sess.meetingId] = state.lines[sess.meetingId] || [];
  }
  function handleCommand(msg) {
    var ref = msg.id || '';
    if (msg.op === 'list' || msg.op === 'status') return reply({ op: 'meetings', ref: ref, items: workMeetings() });
    if (msg.op === 'join' && msg.link) {
      return gifos.meet.join(msg.link, msg.password || '', state.name, { bot: true }).then(function (sess) {
        remember(sess, msg.link, false);
        paint();
        return reply({ op: 'ok', ref: ref, text: 'joined ' + sess.meetingId, items: workMeetings() });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'leave' && msg.meetingId && state.meetings[msg.meetingId] && !state.meetings[msg.meetingId].control) {
      return gifos.meet.leave(msg.meetingId).then(function () {
        delete state.meetings[msg.meetingId];
        paint();
        return reply({ op: 'ok', ref: ref, text: 'left ' + msg.meetingId, items: workMeetings() });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'record' && msg.meetingId) {
      var call = msg.on ? gifos.meet.startRecording(msg.meetingId) : gifos.meet.stopRecording(msg.meetingId);
      return call.then(function () {
        if (state.meetings[msg.meetingId]) state.meetings[msg.meetingId].rec = !!msg.on;
        paint();
        return reply({ op: 'ok', ref: ref, text: 'record ' + (msg.on ? 'on' : 'off'), items: workMeetings() });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'transcribe' && msg.meetingId) {
      return gifos.meet.transcribe(msg.meetingId, !!msg.on).then(function () {
        if (state.meetings[msg.meetingId]) state.meetings[msg.meetingId].cc = !!msg.on;
        paint();
        return reply({ op: 'ok', ref: ref, text: 'transcribe ' + (msg.on ? 'on' : 'off'), items: workMeetings() });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'say' && msg.meetingId) {
      return gifos.meet.sendChat(msg.meetingId, msg.text || '').then(function () {
        return reply({ op: 'ok', ref: ref, text: 'sent' });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'transcript' && msg.meetingId) {
      var lines = state.lines[msg.meetingId] || [];
      var text = lines.map(function (l) { return (l.by || '') + ': ' + (l.text || ''); }).join('\n');
      var bytes = new TextEncoder().encode(text);
      var xid = 'xf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var fname = 'transcript-' + msg.meetingId + '.txt';
      return sendXferRetry(xid, fname, 'text/plain', bytes.buffer, 6).then(function () {
        return reply({ op: 'xfer', ref: ref, xferId: xid, name: fname, mime: 'text/plain', meetingId: msg.meetingId });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    if (msg.op === 'recording' && msg.meetingId) {
      return gifos.meet.stopRecording(msg.meetingId).catch(function () { return null; }).then(function () {
        if (state.meetings[msg.meetingId]) state.meetings[msg.meetingId].rec = false;
        return gifos.meet.getRecording(msg.meetingId);
      }).then(function (rec) {
        var xid = 'xr' + Date.now().toString(36);
        var fname = (rec && rec.name) || ('recording-' + msg.meetingId + '.webm');
        var mime = (rec && rec.mime) || 'video/webm';
        return sendXferRetry(xid, fname, mime, (rec && rec.bytes) || new ArrayBuffer(0), 6).then(function () {
          return reply({ op: 'xfer', ref: ref, xferId: xid, name: fname, mime: mime, meetingId: msg.meetingId });
        });
      }).catch(function (e) { return reply({ op: 'err', ref: ref, text: String(e.message || e) }); });
    }
    return reply({ op: 'err', ref: ref, text: 'Unknown command.' });
  }
  function handleBotReply(msg) {
    if (msg.op === 'warn') warn(msg.text || DUP);
    if ((msg.op === 'beat' || msg.op === 'meetings' || msg.op === 'ok') && (msg.meetings || msg.items)) {
      renderCtrl(msg.meetings || msg.items);
    }
    if (msg.op === 'ok' || msg.op === 'err' || msg.op === 'meetings') log('← ' + (msg.text || msg.op));
    if (msg.op === 'beat' && msg.instance && state.instance && msg.role === 'bot') {
      /* A controller just displays what the bot reports. */
    }
  }

  gifos.meet.onParticipants(function (ev) {
    if (state.phase !== 'probe' || !ev || ev.meetingId !== state.probeId) return;
    var people = ev.people || [];
    for (var i = 0; i < people.length; i++) {
      if (people[i] && people[i].bot && !people[i].me) state.probeBeat = state.probeBeat || { role: 'bot', op: 'beat' };
    }
  });
  gifos.meet.onChat(function (ev) {
    var text = String((ev && ev.text) || '');
    if (!adminEvent(ev)) {
      if (BotProto.looksLikeCommand(text) || BotProto.decode(text)) noteIgnored();
      return;
    }
    var msg = BotProto.decode(text);
    if (!msg) return;
    if (state.phase === 'probe') {
      if (msg.role === 'bot' && msg.op === 'beat') state.probeBeat = msg;
      return;
    }
    if (state.phase === 'run') {
      if (msg.role === 'bot' && msg.op === 'beat' && msg.instance && msg.instance !== state.instance) {
        warn(DUP);
        if (!state.warned[msg.instance]) {
          state.warned[msg.instance] = true;
          reply({ op: 'warn', text: DUP, instance: state.instance });
        }
        return;
      }
      if (msg.role === 'controller') handleCommand(msg);
      return;
    }
    if (state.phase === 'control' && msg.role === 'bot') handleBotReply(msg);
  });
  gifos.meet.onTranscriptLine(function (ev) {
    if (!ev || !ev.meetingId || ev.meetingId === state.adminId) return;
    var line = ev.line || {};
    (state.lines[ev.meetingId] = state.lines[ev.meetingId] || []).push({ by: line.by || '', text: line.text || '', at: line.at || Date.now() });
    var n = state.lines[ev.meetingId].length;
    var slot = document.getElementById('tr-' + ev.meetingId);
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'tr-' + ev.meetingId;
      logEl.appendChild(slot);
    }
    slot.textContent = ev.meetingId + ' transcript lines: ' + n + (line.text ? '  last: ' + line.text : '');
  });
  gifos.meet.onXfer(function (ev) {
    if (state.phase !== 'control' || !ev || ev.meetingId !== state.adminId) return;
    var bytes = ev.bytes ? new Uint8Array(ev.bytes) : new Uint8Array(0);
    var text = '';
    try { text = new TextDecoder().decode(bytes); } catch (e) { text = ''; }
    var box = document.getElementById('xfer');
    box.dataset.name = ev.name || '';
    box.dataset.bytes = String(bytes.length);
    box.textContent = (ev.name || 'download') + ' (' + bytes.length + ' bytes)\n' + text;
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: ev.mime || 'application/octet-stream' }));
      a.download = ev.name || 'download';
      a.click();
    } catch (e) {}
  });

  function beat() {
    if (state.phase !== 'run' || !state.adminId) return;
    gifos.meet.sendChat(state.adminId, BotProto.encode({
      v: 1, role: 'bot', op: 'beat', instance: state.instance, meetings: workMeetings()
    })).catch(function () {});
  }
  function autoJoin() {
    var links = String(rulesEl.value || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var chain = Promise.resolve();
    links.forEach(function (link) {
      chain = chain.then(function () {
        return gifos.meet.join(link, '', state.name, { bot: true }).then(function (sess) {
          remember(sess, link, false);
          paint();
          log('joined ' + sess.meetingId);
        });
      });
    });
    return chain;
  }
  function becomeBot(sawOther) {
    return gifos.meet.join(state.admin.room, state.admin.password, state.name, { bot: true, control: true }).then(function (sess) {
      state.phase = 'run';
      state.adminId = sess.meetingId;
      remember(sess, sess.link, true);
      if (sawOther) warn(DUP);
      paint();
      beat();
      state.beatTimer = setInterval(beat, 3000);
      return autoJoin();
    });
  }
  function startRun() {
    state.phase = 'probe';
    state.probeBeat = null;
    warn('');
    paint();
    return gifos.meet.join(state.admin.room, state.admin.password, state.name + ' probe', { bot: false, control: true }).then(function (sess) {
      state.probeId = sess.meetingId;
      // Long enough for the mesh to open and for one 3s heartbeat to cross it.
      return new Promise(function (res) { setTimeout(res, 8000); });
    }).then(function () {
      var beatSeen = state.probeBeat;
      var id = state.probeId;
      state.probeId = '';
      return gifos.meet.leave(id).then(function () {
        if (beatSeen && !document.getElementById('override').checked) {
          state.phase = 'idle';
          warn(DUP);
          paint();
          return;
        }
        return becomeBot(!!beatSeen);
      });
    });
  }
  function startControl() {
    state.phase = 'control';
    warn('');
    paint();
    return gifos.meet.join(state.admin.room, state.admin.password, state.name + ' remote', { bot: false, control: true }).then(function (sess) {
      state.adminId = sess.meetingId;
      paint();
      setTimeout(function () { sendCtrl({ op: 'list', id: qid() }); }, 1200);
    });
  }

  document.getElementById('fill').onclick = function () {
    var s = BotProto.suggest();
    var guard = 0;
    while (!BotProto.strength(s.name, s.password).ok && guard++ < 8) s = BotProto.suggest();
    document.getElementById('bot-name').value = s.name;
    document.getElementById('bot-pass').value = s.password;
    suggestEl.textContent = 'Suggestion: ' + s.name + ' / ' + s.password;
  };
  document.getElementById('mode-run').onchange = paint;
  document.getElementById('mode-control').onchange = paint;
  document.getElementById('start').onclick = function () {
    var name = document.getElementById('bot-name').value.trim();
    var password = document.getElementById('bot-pass').value;
    var chk = BotProto.strength(name, password);
    if (!chk.ok) {
      warn(chk.reason);
      var s = BotProto.suggest();
      var guard = 0;
      while (!BotProto.strength(s.name, s.password).ok && guard++ < 8) s = BotProto.suggest();
      suggestEl.textContent = 'Suggestion: ' + s.name + ' / ' + s.password;
      return;
    }
    suggestEl.textContent = '';
    warn('');
    var mode = document.getElementById('mode-control').checked ? 'control' : 'run';
    document.getElementById('start').disabled = true;
    try { gifos.db('rules').put({ id: 'autojoin', text: rulesEl.value || '' }); } catch (e) {}
    BotProto.derive(name, password).then(function (admin) {
      state.name = name;
      state.admin = admin;
      return mode === 'control' ? startControl() : startRun();
    }).catch(function (e) {
      warn(String(e && e.message || e));
      state.phase = 'idle';
      paint();
    }).then(function () {
      document.getElementById('start').disabled = false;
    });
  };
  document.getElementById('list-go').onclick = function () { sendCtrl({ op: 'list', id: qid() }); };
  document.getElementById('join-go').onclick = function () {
    var link = document.getElementById('join-link').value.trim();
    if (!link) return;
    sendCtrl({ op: 'join', link: link, id: qid() });
  };

  try {
    gifos.db('rules').get('autojoin').then(function (row) {
      if (row && row.text && !rulesEl.value) rulesEl.value = row.text;
    }).catch(function () {});
  } catch (e) {}
  gifos.launch().then(function (args) {
    if (!args) return;
    if (args.name) document.getElementById('bot-name').value = args.name;
    if (args.password) document.getElementById('bot-pass').value = args.password;
    if (args.mode === 'control') document.getElementById('mode-control').checked = true;
    if (args.mode === 'run') document.getElementById('mode-run').checked = true;
    paint();
  }).catch(function () {});
  paint();
})();
