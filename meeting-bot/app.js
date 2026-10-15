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
    ctrlItems: [],
    people: {}
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
      var people = (state.people[id] || []).filter(function (x) { return x && !x.me; });
      return {
        id: m.meetingId, room: m.room || '', link: m.link || '', rec: !!m.rec, cc: !!m.cc,
        created: !!m.created, people: people.map(function (x) { return x.name || ''; })
      };
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
      li.dataset.id = m.id;
      li.textContent = m.id + '  ' + (m.link || m.room) + (m.rec ? '  ⏺ recording' : '') + (m.cc ? '  📝 transcribing' : '') +
        (m.people.length ? '  with ' + m.people.join(', ') : '');
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
      sub.className = 'link';
      sub.textContent = (m.link || m.room || '') + (m.people && m.people.length ? '  with ' + m.people.join(', ') : '');
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
  // The bot's operations. RUN answers them for the admin meeting (handleCommand)
  // and for whoever drives this page directly (window.MeetingBot). Each one
  // resolves with a plain result or rejects with an Error.
  function needWork(id) {
    var m = state.meetings[id];
    if (!m || m.control) throw new Error('No such meeting: ' + id);
    return m;
  }
  function freshRoom() {
    var abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var u = new Uint8Array(16);
    crypto.getRandomValues(u);
    var out = '';
    for (var i = 0; i < u.length; i++) out += abc[u[i] % abc.length];
    return out;
  }
  function transcriptText(id) {
    return (state.lines[id] || []).map(function (l) { return (l.by || '') + ': ' + (l.text || ''); }).join('\n');
  }
  var ops = {
    list: function () { return Promise.resolve(workMeetings()); },
    join: function (link, password) {
      if (!link) return Promise.reject(new Error('join needs a meeting link.'));
      return gifos.meet.join(link, password || '', state.name, { bot: true }).then(function (sess) {
        // A bare room code is shown as the meeting's own invite link.
        var shown = /[:\/#]/.test(link) ? link : (sess.link || link);
        remember(sess, shown, false);
        paint();
        log('joined ' + sess.meetingId);
        return { id: sess.meetingId, room: sess.room || '', link: shown };
      });
    },
    // A new meeting this bot hosts: an unguessable 16-character open-room code.
    create: function () {
      return ops.join(freshRoom(), '').then(function (r) {
        state.meetings[r.id].created = true;
        paint();
        return r;
      });
    },
    leave: function (id) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      return gifos.meet.leave(id).then(function () {
        delete state.meetings[id];
        delete state.people[id];
        paint();
        return { id: id, left: true };
      });
    },
    record: function (id, on) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      var call = on ? gifos.meet.startRecording(id) : gifos.meet.stopRecording(id);
      return call.then(function () {
        if (state.meetings[id]) state.meetings[id].rec = !!on;
        paint();
        return { id: id, rec: !!on };
      });
    },
    transcribe: function (id, on) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      return gifos.meet.transcribe(id, !!on).then(function (r) {
        if (r && r.ok === false) throw new Error(r.error || 'Transcribing did not start.');
        if (state.meetings[id]) state.meetings[id].cc = !!on;
        paint();
        return { id: id, cc: !!on };
      });
    },
    say: function (id, text) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      return gifos.meet.sendChat(id, text || '').then(function () { return { id: id, sent: true }; });
    },
    people: function (id) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      return Promise.resolve((state.people[id] || []).map(function (p) {
        return { id: p.id || '', name: p.name || '', bot: !!p.bot, me: !!p.me };
      }));
    },
    transcript: function (id) {
      if (!state.lines[id]) return Promise.reject(new Error('No such meeting: ' + id));
      var lines = state.lines[id].map(function (l) { return { by: l.by, text: l.text, at: l.at }; });
      return Promise.resolve({ id: id, lines: lines, text: transcriptText(id) });
    },
    recording: function (id) {
      try { needWork(id); } catch (e) { return Promise.reject(e); }
      return gifos.meet.stopRecording(id).catch(function () { return null; }).then(function () {
        if (state.meetings[id]) state.meetings[id].rec = false;
        paint();
        return gifos.meet.getRecording(id);
      }).then(function (rec) {
        return {
          id: id,
          name: (rec && rec.name) || ('recording-' + id + '.webm'),
          mime: (rec && rec.mime) || 'video/webm',
          bytes: (rec && rec.bytes) || new ArrayBuffer(0)
        };
      });
    }
  };

  function handleCommand(msg) {
    var ref = msg.id || '';
    var fail = function (e) { return reply({ op: 'err', ref: ref, text: String(e && e.message || e) }); };
    var okItems = function (text) { return function () { return reply({ op: 'ok', ref: ref, text: text, items: workMeetings() }); }; };
    var id = msg.meetingId;
    if (msg.op === 'list' || msg.op === 'status') return reply({ op: 'meetings', ref: ref, items: workMeetings() });
    if (msg.op === 'create') {
      return ops.create().then(function (r) {
        return reply({ op: 'ok', ref: ref, text: 'created ' + r.id, meetingId: r.id, link: r.link, room: r.room, items: workMeetings() });
      }).catch(fail);
    }
    if (msg.op === 'join' && msg.link) {
      return ops.join(msg.link, msg.password).then(function (r) {
        return reply({ op: 'ok', ref: ref, text: 'joined ' + r.id, meetingId: r.id, link: r.link, room: r.room, items: workMeetings() });
      }).catch(fail);
    }
    if ((msg.op === 'leave' || msg.op === 'end') && id) return ops.leave(id).then(okItems('left ' + id)).catch(fail);
    if (msg.op === 'record' && id) return ops.record(id, !!msg.on).then(okItems('record ' + (msg.on ? 'on' : 'off'))).catch(fail);
    if (msg.op === 'transcribe' && id) return ops.transcribe(id, !!msg.on).then(okItems('transcribe ' + (msg.on ? 'on' : 'off'))).catch(fail);
    if (msg.op === 'say' && id) {
      return ops.say(id, msg.text).then(function () { return reply({ op: 'ok', ref: ref, text: 'sent' }); }).catch(fail);
    }
    if (msg.op === 'people' && id) {
      return ops.people(id).then(function (people) { return reply({ op: 'people', ref: ref, meetingId: id, people: people }); }).catch(fail);
    }
    if (msg.op === 'transcript' && id) {
      return ops.transcript(id).then(function (t) {
        var bytes = new TextEncoder().encode(t.text);
        var xid = 'xf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var fname = 'transcript-' + id + '.txt';
        return sendXferRetry(xid, fname, 'text/plain', bytes.buffer, 6).then(function () {
          return reply({ op: 'xfer', ref: ref, xferId: xid, name: fname, mime: 'text/plain', meetingId: id, lines: t.lines.length });
        });
      }).catch(fail);
    }
    if (msg.op === 'recording' && id) {
      return ops.recording(id).then(function (rec) {
        var xid = 'xr' + Date.now().toString(36);
        return sendXferRetry(xid, rec.name, rec.mime, rec.bytes, 6).then(function () {
          return reply({ op: 'xfer', ref: ref, xferId: xid, name: rec.name, mime: rec.mime, meetingId: id });
        });
      }).catch(fail);
    }
    return reply({ op: 'err', ref: ref, text: 'Unknown command.' });
  }
  function handleBotReply(msg) {
    if (msg.op === 'warn') warn(msg.text || DUP);
    if ((msg.op === 'beat' || msg.op === 'meetings' || msg.op === 'ok') && (msg.meetings || msg.items)) {
      renderCtrl(msg.meetings || msg.items);
    }
    if (msg.op === 'ok' || msg.op === 'err' || msg.op === 'meetings') log('← ' + (msg.text || msg.op) + (msg.link ? '  ' + msg.link : ''));
    if (msg.op === 'beat' && msg.instance && state.instance && msg.role === 'bot') {
      /* A controller just displays what the bot reports. */
    }
  }

  gifos.meet.onParticipants(function (ev) {
    if (!ev || !ev.meetingId) return;
    var people = ev.people || [];
    if (state.meetings[ev.meetingId]) {
      state.people[ev.meetingId] = people.slice();
      paint();
    }
    if (state.phase !== 'probe' || ev.meetingId !== state.probeId) return;
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
      return new Promise(function (res) { setTimeout(res, 4500); });
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
  // Start in RUN or CONTROL. The Start button, window.MeetingBot.start and a
  // granted go.start launch all come through here. Resolves when the bot is
  // running (or controlling); rejects with the reason it did not start.
  function start(opts) {
    opts = opts || {};
    if (opts.name != null) document.getElementById('bot-name').value = String(opts.name);
    if (opts.password != null) document.getElementById('bot-pass').value = String(opts.password);
    if (opts.mode === 'control') document.getElementById('mode-control').checked = true;
    if (opts.mode === 'run') document.getElementById('mode-run').checked = true;
    if (opts.override != null) document.getElementById('override').checked = !!opts.override;
    if (opts.rules != null) rulesEl.value = String(opts.rules);
    if (state.phase !== 'idle') return Promise.reject(new Error('Already started (' + state.phase + ').'));
    var name = document.getElementById('bot-name').value.trim();
    var password = document.getElementById('bot-pass').value;
    var chk = BotProto.strength(name, password);
    if (!chk.ok) {
      warn(chk.reason);
      var s = BotProto.suggest();
      var guard = 0;
      while (!BotProto.strength(s.name, s.password).ok && guard++ < 8) s = BotProto.suggest();
      suggestEl.textContent = 'Suggestion: ' + s.name + ' / ' + s.password;
      return Promise.reject(new Error(chk.reason));
    }
    suggestEl.textContent = '';
    warn('');
    var mode = document.getElementById('mode-control').checked ? 'control' : 'run';
    document.getElementById('start').disabled = true;
    try { gifos.db('rules').put({ id: 'autojoin', text: rulesEl.value || '' }); } catch (e) {}
    return BotProto.derive(name, password).then(function (admin) {
      state.name = name;
      state.admin = admin;
      return mode === 'control' ? startControl() : startRun();
    }).then(function () {
      document.getElementById('start').disabled = false;
      if (state.phase === 'idle') throw new Error(warnEl.textContent || 'Did not start.');
      return status();
    }, function (e) {
      warn(String(e && e.message || e));
      state.phase = 'idle';
      paint();
      document.getElementById('start').disabled = false;
      throw e;
    });
  }
  function status() {
    return { phase: state.phase, name: state.name, meetings: workMeetings(), warning: warnEl.textContent || '' };
  }
  document.getElementById('start').onclick = function () { start().catch(function () {}); };
  document.getElementById('list-go').onclick = function () { sendCtrl({ op: 'list', id: qid() }); };
  document.getElementById('create-go').onclick = function () { sendCtrl({ op: 'create', id: qid() }); };
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
    // go.start=1: the person approved this launch in the sheet, so start now.
    if (args.start === '1' || args.start === 'true') start().catch(function () {});
  }).catch(function () {});
  // Local control surface for an automated browser driving THIS page (see
  // CONTROL.md). RUN-mode calls act on this bot directly; nothing here is
  // reachable from outside the app frame.
  function running() { if (state.phase !== 'run') throw new Error('The bot is not running. Call start({ mode: "run", ... }) first.'); }
  function guard(fn) {
    return function () {
      var args = arguments;
      try { running(); } catch (e) { return Promise.reject(e); }
      return fn.apply(null, args);
    };
  }
  window.MeetingBot = {
    version: 1,
    start: start,
    status: status,
    list: guard(ops.list),
    create: guard(ops.create),
    join: guard(ops.join),
    leave: guard(ops.leave),
    end: guard(ops.leave),
    record: guard(ops.record),
    transcribe: guard(ops.transcribe),
    say: guard(ops.say),
    people: guard(ops.people),
    transcript: guard(ops.transcript),
    recording: guard(ops.recording)
  };
  paint();
})();
