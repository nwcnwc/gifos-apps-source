// Survey. Shared records ride gifos.db the way Take Turns does. A refused
// write means the meeting host is leading; this file does not decide that.
(function () {
  'use strict';
  var S = window.SurveyLogic;
  var $ = function (id) { return document.getElementById(id); };
  var HOST_LINE = 'The host is leading this app, so only they can change the survey.';

  var surveyDb = null, voteDb = null, presDb = null;
  try {
    if (window.gifos && gifos.db) {
      surveyDb = gifos.db('survey');
      voteDb = gifos.db('votes');
      presDb = gifos.db('presence');
    }
  } catch (e) {}

  var me = { id: 'local', name: '' };
  var since = Date.now();
  var survey = null;
  var votes = [];
  var mode = 'build';
  var draft = blankDraft();
  var pending = {};
  var painted = '';
  var shownKey = '';
  var noteTimer = null;
  // The runner is the person who opened Survey in the meeting (the app's owner
  // copy). Only the runner sets a survey up, closes, reopens or replaces it;
  // everyone else sees who is setting it up, then votes. Outside a meeting the
  // one copy is the runner.
  var runner = !(window.gifos && gifos.info);
  var setup = null;      // the runner's "setting up" record, as everyone reads it
  var setupSent = '';

  function blankQuestion() {
    return { text: '', kind: 'single', options: ['', ''], free: false };
  }
  function blankDraft() {
    return { title: '', anonymous: false, questions: [blankQuestion()] };
  }
  function myId() { return me.id && me.id !== 'local' ? me.id : ''; }
  function say(msg, bad) {
    var el = $('note');
    el.textContent = msg || '';
    el.classList.toggle('bad', !!bad);
    clearTimeout(noteTimer);
    if (msg) noteTimer = setTimeout(function () { el.textContent = ''; el.classList.remove('bad'); }, 6000);
  }
  function led(err) {
    return /read-only for guests/i.test(String(err && err.message || err || ''));
  }
  function voteCountLabel(n) {
    return n === 1 ? '1 vote' : n + ' votes';
  }

  function beat() {
    if (!presDb || !myId()) return;
    presDb.put({ id: 'p:' + me.id, name: me.name || '', since: since, ts: Date.now() }).catch(function () {});
  }

  // Tell the room the runner is at the form (on) or is not (off).
  function sayBuilding(on) {
    if (!runner || !surveyDb) return;
    var key = (on ? '1' : '0') + ':' + (me.name || '');
    if (key === setupSent) return;
    setupSent = key;
    surveyDb.put({ id: 'setup', on: !!on, name: me.name || '', at: Date.now() }).catch(function () { setupSent = ''; });
  }
  function setupName() {
    return (setup && setup.name) ? setup.name : 'Someone';
  }

  function readDraft() {
    var title = ($('d-title') && $('d-title').value) || '';
    var anonymous = !!($('d-anon') && $('d-anon').checked);
    var questions = [].map.call(document.querySelectorAll('#build .q'), function (card) {
      return {
        text: card.querySelector('.qtext').value,
        kind: card.querySelector('.seg button.on').getAttribute('data-kind'),
        free: card.querySelector('.qfree').checked,
        options: [].map.call(card.querySelectorAll('.optline input'), function (inp) { return inp.value; })
      };
    });
    draft = { title: title, anonymous: anonymous, questions: questions.length ? questions : [blankQuestion()] };
  }

  function renderBuild() {
    var root = $('build');
    root.hidden = mode !== 'build';
    if (mode !== 'build') { root.innerHTML = ''; return; }
    root.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'card';
    var title = document.createElement('label');
    title.className = 'field';
    title.innerHTML = '<span>Title, if you want one</span>';
    var titleIn = document.createElement('input');
    titleIn.id = 'd-title';
    titleIn.maxLength = 80;
    titleIn.value = draft.title || '';
    titleIn.placeholder = 'Friday lunch';
    title.appendChild(titleIn);
    card.appendChild(title);
    var anon = document.createElement('label');
    anon.className = 'check';
    var anonIn = document.createElement('input');
    anonIn.id = 'd-anon';
    anonIn.type = 'checkbox';
    anonIn.checked = !!draft.anonymous;
    anon.appendChild(anonIn);
    anon.appendChild(document.createTextNode('Anonymous votes'));
    card.appendChild(anon);
    // The question comes first; the title and anonymous votes are extras, under the questions.

    draft.questions.forEach(function (q, qi) {
      var box = document.createElement('div');
      box.className = 'q';
      var head = document.createElement('div');
      head.className = 'qhead';
      var lab = document.createElement('b');
      lab.textContent = 'Question ' + (qi + 1);
      head.appendChild(lab);
      if (draft.questions.length > 1) {
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'sm';
        rm.textContent = 'Remove';
        rm.onclick = function () { readDraft(); draft.questions.splice(qi, 1); renderBuild(); };
        head.appendChild(rm);
      }
      box.appendChild(head);
      var qt = document.createElement('label');
      qt.className = 'field';
      qt.appendChild(document.createTextNode('Question'));
      var qIn = document.createElement('textarea');
      qIn.className = 'qtext';
      qIn.maxLength = 200;
      qIn.rows = 2;
      qIn.value = q.text || '';
      qIn.placeholder = 'Which day works?';
      qt.appendChild(qIn);
      box.appendChild(qt);
      var seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'How many choices');
      ['single', 'multi'].forEach(function (kind) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sm' + ((q.kind || 'single') === kind ? ' on' : '');
        b.setAttribute('data-kind', kind);
        b.textContent = kind === 'single' ? 'One choice' : 'Any number';
        b.onclick = function () {
          [].forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
        };
        seg.appendChild(b);
      });
      box.appendChild(seg);
      var opts = document.createElement('div');
      (q.options || ['', '']).forEach(function (val, oi) {
        var line = document.createElement('div');
        line.className = 'optline';
        var inp = document.createElement('input');
        inp.maxLength = 80;
        inp.value = val || '';
        inp.placeholder = 'Choice ' + (oi + 1);
        inp.setAttribute('aria-label', 'Choice ' + (oi + 1));
        line.appendChild(inp);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon sm';
        del.textContent = '×';
        del.setAttribute('aria-label', 'Remove choice ' + (oi + 1));
        del.onclick = function () {
          readDraft();
          if (draft.questions[qi].options.length <= 2) { say('Each question needs at least two choices.', true); return; }
          draft.questions[qi].options.splice(oi, 1);
          renderBuild();
        };
        line.appendChild(del);
        opts.appendChild(line);
      });
      box.appendChild(opts);
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'sm';
      add.textContent = 'Add choice';
      add.onclick = function () {
        readDraft();
        if (draft.questions[qi].options.length >= 8) { say('Each question can have up to 8 choices.', true); return; }
        draft.questions[qi].options.push('');
        renderBuild();
      };
      box.appendChild(add);
      var free = document.createElement('label');
      free.className = 'check';
      var freeIn = document.createElement('input');
      freeIn.className = 'qfree';
      freeIn.type = 'checkbox';
      freeIn.checked = !!q.free;
      free.appendChild(freeIn);
      free.appendChild(document.createTextNode('Written answer'));
      box.appendChild(free);
      root.appendChild(box);
    });

    root.appendChild(card);
    var actions = document.createElement('div');
    actions.className = 'row';
    var addQ = document.createElement('button');
    addQ.type = 'button';
    addQ.className = 'sm';
    addQ.textContent = 'Add question';
    addQ.onclick = function () {
      readDraft();
      if (draft.questions.length >= 8) { say('A survey can have up to 8 questions.', true); return; }
      draft.questions.push(blankQuestion());
      renderBuild();
    };
    var start = document.createElement('button');
    start.type = 'button';
    start.className = 'go';
    start.id = 'start';
    start.textContent = 'Start survey';
    start.onclick = onStart;
    if (survey) {
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'sm';
      cancel.textContent = 'Cancel';
      cancel.onclick = function () { mode = 'live'; sayBuilding(false); render(); };
      actions.appendChild(cancel);
    }
    actions.appendChild(addQ);
    actions.appendChild(start);
    root.appendChild(actions);
  }

  // Survey 1.2: the app keeps its own scroll, so a new survey (ours after Start, or one that arrives) must show its
  // top (title, then the choices), and a closed one its results, never the old scroll position below the fold.
  function toTop() {
    var m = document.querySelector('main');
    var go = function () { if (m) { m.scrollTop = 0; } try { window.scrollTo(0, 0); } catch (e) {} };
    go();
    if (window.requestAnimationFrame) requestAnimationFrame(go);
  }
  function toResults() {
    var res = $('results');
    if (res && res.scrollIntoView) { try { res.scrollIntoView({ block: 'start' }); } catch (e) { res.scrollIntoView(); } }
  }

  function onStart() {
    readDraft();
    var made = S.svCreate(survey, draft, Date.now());
    if (!made.ok) { say(made.error, true); return; }
    var next = made.survey;
    var apply = function () {
      survey = next;
      pending = {};
      painted = '';
      mode = 'live';
      say('');
      sayBuilding(false);
      render();
      toTop();
    };
    if (!surveyDb) { apply(); return; }
    surveyDb.put(next).then(apply, function (err) {
      if (led(err)) say(HOST_LINE, true);
      else say('Could not share the survey. Try again.', true);
      surveyDb.get('current').then(function (row) {
        if (row) survey = S.svMergeSurvey(survey, row);
        render();
      }, function () {});
    });
  }

  function setOpen(open) {
    var step = S.svSetOpen(survey, open, Date.now());
    if (!step.ok) { say(step.error, true); return; }
    var next = step.survey;
    var apply = function () { survey = next; say(''); render(); if (!open) toResults(); else toTop(); };
    if (!surveyDb) { apply(); return; }
    surveyDb.put(next).then(apply, function (err) {
      if (led(err)) say(HOST_LINE, true);
      else say('Could not update the survey. Try again.', true);
      surveyDb.get('current').then(function (row) {
        if (row) survey = S.svMergeSurvey(survey, row);
        render();
      }, function () {});
    });
  }

  function myVote() {
    if (!survey || !myId()) return null;
    var id = 'v:' + me.id;
    for (var i = 0; i < votes.length; i++) if (votes[i] && votes[i].id === id && (votes[i].epoch | 0) === (survey.epoch | 0)) return votes[i];
    return null;
  }

  function answersFromPending() {
    var out = {};
    (survey.questions || []).forEach(function (q) {
      var p = pending[q.id] || { picks: [], text: '' };
      out[q.id] = { picks: (p.picks || []).slice(), text: p.text || '' };
    });
    return out;
  }

  function loadPending() {
    pending = {};
    var mine = myVote();
    (survey.questions || []).forEach(function (q) {
      var a = mine && mine.answers && mine.answers[q.id];
      pending[q.id] = { picks: a ? (a.picks || []).slice() : [], text: a ? (a.text || '') : '' };
    });
  }

  function paintResults(tally) {
    var box = $('results');
    box.innerHTML = '';
    var lab = document.createElement('h3');
    lab.className = 'reshead';
    lab.textContent = 'Results';
    box.appendChild(lab);
    tally.questions.forEach(function (q) {
      var card = document.createElement('div');
      card.className = 'q';
      var h = document.createElement('h3');
      h.textContent = q.text;
      card.appendChild(h);
      q.options.forEach(function (opt) {
        var row = document.createElement('div');
        row.className = 'opt';
        row.setAttribute('data-n', String(opt.n));
        var meta = document.createElement('div');
        meta.className = 'meta';
        var name = document.createElement('span');
        name.textContent = opt.label;
        var num = document.createElement('span');
        num.textContent = opt.n + ' · ' + opt.pct + '%';
        meta.appendChild(name);
        meta.appendChild(num);
        var bar = document.createElement('div');
        bar.className = 'bar';
        var fill = document.createElement('i');
        fill.style.width = opt.pct + '%';
        bar.appendChild(fill);
        row.appendChild(meta);
        row.appendChild(bar);
        card.appendChild(row);
      });
      if (q.texts.length) {
        var ul = document.createElement('ul');
        ul.className = 'texts';
        q.texts.forEach(function (t) {
          var li = document.createElement('li');
          if (!tally.anonymous && t.name) {
            var b = document.createElement('b');
            b.textContent = t.name;
            li.appendChild(b);
            li.appendChild(document.createTextNode(' ' + t.text));
          } else {
            li.textContent = t.text;
          }
          ul.appendChild(li);
        });
        card.appendChild(ul);
      }
      box.appendChild(card);
    });
  }

  function paintMine() {
    var box = $('mine');
    var key = survey.epoch + ':' + (survey.questions || []).map(function (q) { return q.id; }).join(',');
    if (painted === key && box.childNodes.length) {
      syncChoices();
      return;
    }
    // Only a different survey moves the scroll; a repaint of the same one (identity arriving) leaves the voter where they are.
    var fresh = key !== shownKey;
    shownKey = key;
    painted = key;
    loadPending();
    if (fresh) toTop();
    box.innerHTML = '';
    if (!survey.open) return;
    (survey.questions || []).forEach(function (q) {
      var card = document.createElement('div');
      card.className = 'q';
      card.setAttribute('data-qid', q.id);
      var h = document.createElement('h3');
      h.textContent = q.text;
      card.appendChild(h);
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = q.kind === 'multi' ? 'Pick any number.' : 'Pick one.';
      card.appendChild(hint);
      q.options.forEach(function (label, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'choice';
        b.textContent = label;
        b.setAttribute('data-i', String(i));
        b.setAttribute('aria-pressed', 'false');
        b.onclick = function () { togglePick(q, i); };
        card.appendChild(b);
      });
      if (q.free) {
        var lab = document.createElement('label');
        lab.className = 'field';
        lab.appendChild(document.createTextNode('Written answer'));
        var area = document.createElement('textarea');
        area.maxLength = 500;
        area.value = (pending[q.id] && pending[q.id].text) || '';
        area.oninput = function () { pending[q.id].text = area.value; paintSave(); };
        lab.appendChild(area);
        card.appendChild(lab);
      }
      box.appendChild(card);
    });
    syncChoices();
  }

  function syncChoices() {
    (survey.questions || []).forEach(function (q) {
      var card = document.querySelector('#mine .q[data-qid="' + q.id + '"]');
      if (!card) return;
      var picks = (pending[q.id] && pending[q.id].picks) || [];
      [].forEach.call(card.querySelectorAll('button.choice'), function (b) {
        var on = picks.indexOf(+b.getAttribute('data-i')) >= 0;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !survey.open;
      });
    });
  }

  // The Save button says whether what is picked is what the room has: "Saved" right after a save, "Save my answers"
  // once a pick changes.
  function paintSave() {
    var b = $('save');
    if (!b) return;
    var mine = myVote();
    var same = !!mine && JSON.stringify(mine.answers || {}) === JSON.stringify((S.svCast(survey, mine, { id: me.id, name: me.name }, answersFromPending(), 0).vote || {}).answers || {});
    b.textContent = same ? 'Saved \u2713' : 'Save my answers';
    b.classList.toggle('done', same);
  }

  function togglePick(q, i) {
    var p = pending[q.id] || { picks: [], text: '' };
    pending[q.id] = p;
    var at = p.picks.indexOf(i);
    if (q.kind === 'multi') {
      if (at >= 0) p.picks.splice(at, 1);
      else p.picks.push(i);
    } else {
      p.picks = at >= 0 ? [] : [i];
    }
    p.picks.sort(function (a, b) { return a - b; });
    syncChoices();
    paintSave();
  }

  function onSave() {
    var cast = S.svCast(survey, myVote(), { id: me.id, name: me.name }, answersFromPending(), Date.now());
    if (!cast.ok) { say(cast.error, true); return; }
    var row = cast.vote;
    var apply = function () {
      votes = S.svMergeVotes(votes, [row]);
      say('Saved.');
      render();
      // The voter sees the counts their vote just joined.
      var res = $('results');
      if (res && res.scrollIntoView) { try { res.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { res.scrollIntoView(); } }
    };
    if (!voteDb) { apply(); return; }
    voteDb.put(row).then(apply, function (err) {
      if (led(err)) say(HOST_LINE, true);
      else say('Could not save your vote. Try again.', true);
    });
  }

  function render() {
    if (!runner && mode === 'build') mode = 'live';
    var live = $('live');
    var showLive = mode === 'live' && !!survey;
    var waiting = !runner && !survey;
    live.hidden = !showLive;
    $('lede').hidden = showLive || waiting;
    var wait = $('wait');
    wait.hidden = !waiting;
    if (waiting) {
      $('wait-text').textContent = setup && setup.on
        ? setupName() + ' is setting up a survey\u2026'
        : 'Waiting for the survey. The person who opened Survey sets it up.';
    }
    var newer = $('newer');
    newer.hidden = !(showLive && !runner && setup && setup.on);
    if (!newer.hidden) newer.textContent = setupName() + ' is setting up a new survey\u2026';
    renderBuild();
    if (runner && mode === 'build') sayBuilding(true);
    if (!showLive) {
      $('chip').textContent = waiting ? 'Waiting' : 'Setting up';
      return;
    }
    var tally = S.svTally(survey, votes);
    $('title').textContent = survey.title || 'Survey';
    $('chip').textContent = (survey.open ? 'Open' : 'Closed') + ' · ' + voteCountLabel(tally.people);
    var who = $('who');
    if (tally.anonymous) who.textContent = 'Anonymous votes. Names stay off the results.';
    else if (tally.names.length) who.textContent = 'Voted: ' + tally.names.join(', ');
    else who.textContent = survey.open ? 'No votes yet.' : 'No votes.';
    paintResults(tally);
    paintMine();
    var dock = $('dock');
    dock.innerHTML = '';
    if (survey.open) {
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'go';
      save.id = 'save';
      save.textContent = 'Save my answers';
      save.onclick = onSave;
      dock.appendChild(save);
      paintSave();
    }
    if (!runner) return;
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sm';
    toggle.id = survey.open ? 'close' : 'reopen';
    toggle.textContent = survey.open ? 'Close survey' : 'Reopen';
    toggle.onclick = function () { setOpen(!survey.open); };
    dock.appendChild(toggle);
    var fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'sm';
    fresh.id = 'anew';
    fresh.textContent = 'New survey';
    fresh.onclick = function () { mode = 'build'; draft = blankDraft(); render(); };
    dock.appendChild(fresh);
  }

  function draftBlank() {
    if ((draft.title || '').trim() || draft.anonymous) return false;
    var qs = draft.questions || [];
    if (qs.length !== 1) return false;
    var q = qs[0] || {};
    if ((q.text || '').trim() || q.free || (q.kind && q.kind !== 'single')) return false;
    var opts = q.options || [];
    for (var i = 0; i < opts.length; i++) if ((opts[i] || '').trim()) return false;
    return true;
  }
  function onSurveyRows(list) {
    var row = null;
    (list || []).forEach(function (x) {
      if (x && x.id === 'current') row = x;
      else if (x && x.id === 'setup' && (!setup || (x.at | 0) >= (setup.at | 0))) setup = x;
    });
    var prevEpoch = survey && survey.epoch;
    var next = S.svMergeSurvey(survey, row);
    // A blank form follows the room. A form someone has started typing stays
    // put; Cancel (shown once a survey exists) returns to the shared survey.
    var moved = !!next && (!survey || (next.v | 0) !== (survey.v | 0) || (next.at | 0) !== (survey.at | 0));
    if (next && moved && mode === 'build' && runner) {
      if (document.querySelector('#build .qtext')) readDraft();
      if (draftBlank()) mode = 'live';
    }
    survey = next;
    if (survey && prevEpoch !== survey.epoch) painted = '';
    render();
  }
  function onVoteRows(list) {
    votes = S.svMergeVotes([], list || []);
    render();
  }

  function boot() {
    render();
    var hello = function (m) {
      me = { id: (m && m.id) || 'local', name: (m && m.name) || '' };
      beat();
      setupSent = '';
      if (runner && mode === 'build') sayBuilding(true);
      if (survey) { painted = ''; render(); }
    };
    if (window.gifos && gifos.info) {
      gifos.info().then(function (i) {
        runner = !(i && i.owner === false);
        if (runner && !survey) mode = 'build';
        render();
      }, function () { runner = true; render(); });
    }
    if (window.gifos && gifos.me) gifos.me().then(hello, function () { hello(null); });
    if (window.gifos && gifos.onIdentity) gifos.onIdentity(function (m) { if (m && m.id) hello(m); });
    if (surveyDb) surveyDb.subscribe(onSurveyRows);
    if (voteDb) voteDb.subscribe(onVoteRows);
    setInterval(beat, 3000);
    window.addEventListener('pagehide', function () {
      if (runner && surveyDb && mode === 'build') surveyDb.put({ id: 'setup', on: false, name: me.name || '', at: Date.now() }).catch(function () {});
      if (presDb && myId()) presDb.delete('p:' + me.id).catch(function () {});
    });
  }
  if (S) boot();
})();
