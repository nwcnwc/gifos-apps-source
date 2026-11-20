// Survey records. Pure: the page and the tests both run these functions.
// A meeting decides who may write the survey record. This file only checks
// the record itself: shape, version, and whether the survey is open.
(function (root) {
  'use strict';

  var MAX_Q = 8, MAX_OPT = 8, MAX_TEXT = 200, MAX_OPT_TEXT = 80, MAX_FREE = 500, MAX_TITLE = 80, MAX_NAME = 40;

  function clip(s, n) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  }

  function copy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function questionsOf(draft) {
    var src = Array.isArray(draft && draft.questions) ? draft.questions : [];
    if (!src.length) return { ok: false, error: 'Add a question.' };
    if (src.length > MAX_Q) return { ok: false, error: 'A survey can have up to 8 questions.' };
    var questions = [], i, j, q, text, opts, options, o;
    for (i = 0; i < src.length; i++) {
      q = src[i] || {};
      text = clip(q.text, MAX_TEXT);
      if (!text) return { ok: false, error: 'Question ' + (i + 1) + ' needs words.' };
      opts = Array.isArray(q.options) ? q.options : [];
      options = [];
      for (j = 0; j < opts.length; j++) {
        o = clip(opts[j], MAX_OPT_TEXT);
        if (o) options.push(o);
      }
      if (options.length < 2) return { ok: false, error: 'Each question needs at least two choices.' };
      if (options.length > MAX_OPT) return { ok: false, error: 'Each question can have up to 8 choices.' };
      questions.push({
        id: 'q' + (i + 1),
        text: text,
        kind: q.kind === 'multi' ? 'multi' : 'single',
        options: options,
        free: !!q.free
      });
    }
    return { ok: true, questions: questions };
  }

  function svCreate(prev, draft, now) {
    var built = questionsOf(draft || {});
    if (!built.ok) return { ok: false, error: built.error, survey: prev || null };
    var survey = {
      id: 'current',
      v: ((prev && prev.v) | 0) + 1,
      epoch: ((prev && prev.epoch) | 0) + 1,
      open: true,
      anonymous: !!(draft && draft.anonymous),
      title: clip(draft && draft.title, MAX_TITLE),
      questions: built.questions,
      at: now | 0
    };
    return { ok: true, survey: survey };
  }

  function svSetOpen(prev, open, now) {
    if (!prev || prev.id !== 'current') return { ok: false, error: 'No survey yet.', survey: prev || null };
    if (!!prev.open === !!open) return { ok: true, survey: prev };
    var next = copy(prev);
    next.open = !!open;
    next.v = (prev.v | 0) + 1;
    next.at = now | 0;
    return { ok: true, survey: next };
  }

  function svMergeSurvey(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    if ((b.v | 0) !== (a.v | 0)) return (b.v | 0) > (a.v | 0) ? b : a;
    return (b.at | 0) >= (a.at | 0) ? b : a;
  }

  function picksOf(raw, n, kind) {
    var src = Array.isArray(raw) ? raw : [];
    var seen = Object.create(null), out = [], i, p;
    for (i = 0; i < src.length; i++) {
      p = src[i] | 0;
      if (p < 0 || p >= n || seen[p]) continue;
      if (String(src[i]).trim() !== String(p)) continue;
      seen[p] = 1;
      out.push(p);
    }
    out.sort(function (x, y) { return x - y; });
    if (kind !== 'multi' && out.length > 1) return { ok: false, error: 'Pick one choice.' };
    return { ok: true, picks: out };
  }

  function svCast(survey, prev, person, answers, now) {
    if (!survey || survey.id !== 'current') return { ok: false, error: 'No survey yet.' };
    if (!survey.open) return { ok: false, error: 'This survey is closed.' };
    if (!person || !person.id) return { ok: false, error: 'Join the meeting to vote.' };
    answers = answers || {};
    var clean = {}, any = false, i, q, got, text;
    var qs = survey.questions || [];
    for (i = 0; i < qs.length; i++) {
      q = qs[i];
      got = picksOf((answers[q.id] || {}).picks, q.options.length, q.kind);
      if (!got.ok) return { ok: false, error: got.error };
      text = q.free ? clip((answers[q.id] || {}).text, MAX_FREE) : '';
      if (!got.picks.length && !text) continue;
      clean[q.id] = { picks: got.picks, text: text };
      any = true;
    }
    // Refuse a ballot that named picks the question cannot hold, even when a
    // later filter would have dropped them. picksOf already drops out-of-range
    // numbers, so an explicit out-of-range pick with nothing else is empty and
    // falls through to the empty-ballot error. Callers that pass a pick past
    // the end expect a refusal either way. Distinguish "past the end" here.
    for (i = 0; i < qs.length; i++) {
      q = qs[i];
      var raw = (answers[q.id] || {}).picks || [];
      for (var j = 0; j < raw.length; j++) {
        var n = raw[j] | 0;
        if (String(raw[j]).trim() !== String(n) || n < 0 || n >= q.options.length) {
          return { ok: false, error: 'That choice is not on this question.' };
        }
      }
    }
    if (!any) return { ok: false, error: 'Pick an answer or write one.' };
    return {
      ok: true,
      vote: {
        id: 'v:' + person.id,
        epoch: survey.epoch | 0,
        name: survey.anonymous ? '' : clip(person.name || 'Someone', MAX_NAME),
        answers: clean,
        at: now | 0
      }
    };
  }

  function svMergeVotes(a, b) {
    var map = Object.create(null);
    function take(list) {
      (list || []).forEach(function (v) {
        if (!v || !v.id) return;
        var cur = map[v.id];
        if (!cur || (v.at | 0) >= (cur.at | 0)) map[v.id] = v;
      });
    }
    take(a);
    take(b);
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  function svTally(survey, votes) {
    var epoch = survey ? (survey.epoch | 0) : -1;
    var byId = Object.create(null);
    (votes || []).forEach(function (v) {
      if (!v || !v.id || (v.epoch | 0) !== epoch) return;
      var cur = byId[v.id];
      if (!cur || (v.at | 0) >= (cur.at | 0)) byId[v.id] = v;
    });
    var ballots = Object.keys(byId).map(function (k) { return byId[k]; });
    var people = ballots.length;
    var anonymous = !!(survey && survey.anonymous);
    var names = [];
    if (!anonymous) {
      var seen = Object.create(null);
      ballots.forEach(function (v) {
        if (v.name && !seen[v.name]) { seen[v.name] = 1; names.push(v.name); }
      });
      names.sort();
    }
    var questions = ((survey && survey.questions) || []).map(function (q) {
      var counts = q.options.map(function () { return 0; });
      var texts = [];
      ballots.forEach(function (v) {
        var a = v.answers && v.answers[q.id];
        if (!a) return;
        (a.picks || []).forEach(function (p) { if (counts[p] != null) counts[p]++; });
        if (a.text) texts.push({ name: anonymous ? '' : (v.name || ''), text: a.text });
      });
      texts.sort(function (x, y) { return (x.name < y.name ? -1 : x.name > y.name ? 1 : 0); });
      return {
        id: q.id,
        text: q.text,
        kind: q.kind,
        free: !!q.free,
        options: q.options.map(function (label, i) {
          return { label: label, n: counts[i], pct: people ? Math.round(counts[i] * 100 / people) : 0 };
        }),
        texts: texts
      };
    });
    return { people: people, anonymous: anonymous, names: names, questions: questions };
  }

  var api = {
    svCreate: svCreate,
    svSetOpen: svSetOpen,
    svMergeSurvey: svMergeSurvey,
    svCast: svCast,
    svMergeVotes: svMergeVotes,
    svTally: svTally
  };
  root.SurveyLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
