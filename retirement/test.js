// The Retirement Calculator's arithmetic, pinned against the published record.
//
// This app's whole claim is that its numbers are the real ones. That claim is
// only worth anything if it is CHECKED, and it cannot be checked by eye — a
// withdrawal engine that is 15% too optimistic looks exactly like one that is
// right until you put it beside a paper. So every number below comes from a
// published source, named in the comment above it, and the engine has to hit it.
//
// The four things most likely to silently break, and why each is here:
//
//   1. THE DATA. If Shiller's series is ever refreshed with price-only returns
//      instead of total return, every answer gets ~2/3 worse in the optimistic
//      direction and nothing throws. The long-run CAGRs catch it.
//   2. THE 4% RULE. It is the one number every reader can check. If the engine
//      drifts, this is where it shows.
//   3. THE WORST COHORT. The mid-1960s beat 1929 because stagflation hurts a
//      withdrawing portfolio more than a fast crash. Getting 1929 back would
//      mean the inflation handling had broken.
//   4. THE STRATEGIES. Each is a published rule with exact parameters, and each
//      was wrong here once already by being copied from a popularization rather
//      than the paper.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = __dirname;

let failures = 0;
const check = (n, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + n
    + (!ok && extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  if (!ok) failures++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- load the shipped files, exactly as the GIF inlines them ----------------

function load() {
  const sandbox = {
    console, Math, JSON, Object, Array, Number, String, Boolean, Date,
    isFinite, isNaN, parseFloat, parseInt, Float64Array, Uint8Array,
    Infinity, NaN, Error, TypeError, RegExp
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['data/market.js', 'sim.js', 'advice.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const box = load();
const M = box.MARKET, S = box.RetireSim, A = box.Advice;

check('sim.js publishes RetireSim with no document', !!S && typeof S.runAll === 'function');
check('advice.js publishes Advice', !!A && typeof A.suggest === 'function');
if (!S || !A) process.exit(1);

// ---- 1. the data is the real record -----------------------------------------

check('history starts 1871-01', M.start[0] === 1871 && M.start[1] === 1, M.start);
check('history is contiguous and long', M.months > 1860, M.months);
check('every series is the same length',
  M.stock.length === M.months && M.bond.length === M.months && M.cpi.length === M.months);
check('the indices are re-based to 1.00', M.stock[0] === 1 && M.bond[0] === 1);

{
  const yrs = (M.months - 1) / 12;
  const s = Math.pow(M.stock[M.months - 1], 1 / yrs) - 1;
  const b = Math.pow(M.bond[M.months - 1], 1 / yrs) - 1;
  // Real TOTAL return, US, 1871-. Price-only returns land near 2%, so this is
  // the tripwire for the single most damaging data mistake available.
  check('stock real CAGR is total-return shaped (6-8%)', s > 0.06 && s < 0.08, (s * 100).toFixed(2));
  check('bond real CAGR is plausible (1.5-3.5%)', b > 0.015 && b < 0.035, (b * 100).toFixed(2));
}
{
  // The crashes have to be in there, at the right depth, in real total-return
  // terms. Source: the series itself; these are the canonical drawdowns.
  const at = (y, m) => M.stock[(y - 1871) * 12 + (m - 1)];
  const dd = (y1, m1, y2, m2) => at(y2, m2) / at(y1, m1) - 1;
  check('1929-09 → 1932-06 is about -77%', near(dd(1929, 9, 1932, 6), -0.768, 0.02), dd(1929, 9, 1932, 6));
  check('1966-01 → 1982-07 is a real LOSS', dd(1966, 1, 1982, 7) < -0.15, dd(1966, 1, 1982, 7));
  check('2007-10 → 2009-02 is about -47%', near(dd(2007, 10, 2009, 2), -0.468, 0.02), dd(2007, 10, 2009, 2));
  // Prices FELL for thirty years after 1871. A CPI series that only ever rises
  // is a fabricated one.
  check('CPI falls somewhere in the 19th century',
    M.cpi[(1900 - 1871) * 12] < M.cpi[0], [M.cpi[0], M.cpi[(1900 - 1871) * 12]]);
}

// ---- 2. the 4% rule ----------------------------------------------------------

const base = (o) => Object.assign({
  currentAge: 65, retireAge: 65, endAge: 95, portfolio: 1000000,
  annualSavings: 0, annualSpend: 40000, stocks: 0.75, fees: 0, glidepath: null,
  strategy: 'constant', percentRate: 0.04, incomes: [], events: [],
  mode: 'history', target: 0.95
}, o || {});

{
  const o = S.runAll(base());
  // Trinity Study Table 3 (inflation-adjusted withdrawals), 75/25 over 30 years:
  // 98%. Cooley, Hubbard & Walz, AAII Journal, Feb 1998.
  check('4% / 30y / 75-25 lands in the mid-to-high 90s',
    o.successRate > 0.94 && o.successRate <= 1, (o.successRate * 100).toFixed(1));
  check('a 30-year plan has 1400+ monthly start dates', o.cycles > 1400, o.cycles);

  // Bengen 1994: "a four-percent withdrawal rate has in no past case caused a
  // portfolio to be exhausted before 33 years"; 3.5% is comfortably below it.
  check('3.5% never failed', S.runAll(base({ annualSpend: 35000 })).successRate === 1);
  // Bengen 1994: "six percent or more is gambling."
  check('6% is gambling', S.runAll(base({ annualSpend: 60000 })).successRate < 0.75);

  // Trinity Table 3, 100% bonds at 4%: 20%. The point that survives every
  // methodology: an all-bond portfolio is the LEAST safe over 30 years.
  const allBonds = S.runAll(base({ stocks: 0 })).successRate;
  check('all bonds at 4% is the dangerous option, not the safe one',
    allBonds < 0.7, (allBonds * 100).toFixed(1));

  // ERN: "3.5% is the new 4%" — 4% degrades badly as the horizon lengthens.
  const long = S.runAll(base({ endAge: 125 })).successRate;
  check('4% is materially less safe over 60 years than 30',
    long < o.successRate - 0.03, [(o.successRate * 100).toFixed(1), (long * 100).toFixed(1)]);
}

{
  // The worst US cohort is the mid-1960s, not 1929. This is the single most
  // load-bearing fact in the app's copy, and it is asserted on screen.
  const o = S.runAll(base());
  const retired = S.monthName(o.worst.startIdx + o.worst.retireYear * 12);
  check('the worst 30-year cohort is the mid-1960s', /196[5-9]/.test(retired), retired);
  check('the worst cohort actually ran dry', o.worst.failed);
}

{
  // SAFEMAX. An independent computation from the same Shiller data (annual,
  // start-of-year) gives 3.78% for 75/25 over 30 years; monthly steps move it
  // a few basis points. Anything outside 3.6-4.0% means the engine has drifted.
  const v = S.solveSpend(base(), 1.0, { iters: 20 }) / 1000000;
  check('SAFEMAX for 75/25 over 30 years is near 3.8%', v > 0.036 && v < 0.040, (v * 100).toFixed(2));
}

{
  // Sequence-of-returns risk, demonstrated rather than asserted: the same
  // retirement is decided by WHEN the bad years land, not by the average.
  const y1966 = S.runCycle(base(), (1966 - 1871) * 12);
  const y1975 = S.runCycle(base(), (1975 - 1871) * 12);
  check('a 1966 retiree at 4% ends far poorer than a 1975 one',
    y1966.final < y1975.final, [Math.round(y1966.final), Math.round(y1975.final)]);
}

{
  // The counterweight the app prints: over 30 years at 4%, most cohorts ended
  // RICHER in real terms than the day they retired. An independent run of the
  // same data puts 60/40 at 63% richer and a median of 1.46x.
  const o = S.runAll(base({ stocks: 0.6 }));
  check('most 4% cohorts ended richer than they started',
    o.endedRicher > 0.55 && o.endedRicher < 0.8, (o.endedRicher * 100).toFixed(0));
  check('the median 4% cohort ends near 1.5x its starting pot',
    near(o.medianFinal / 1000000, 1.46, 0.25), (o.medianFinal / 1e6).toFixed(2));
}

// ---- 3. the plumbing ---------------------------------------------------------

{
  // Everything is in today's money, so a COLA income must be FLAT in real terms
  // and a fixed one must ERODE. Getting this backwards is the commonest bug in
  // the category and it always flatters the plan.
  const cola = S.runAll(base({ annualSpend: 0, incomes: [{ label: 'p', amount: 30000, from: 65, to: null, cola: true }] }));
  check('an indexed income is flat in real terms',
    near(cola.runs[0].incomes[29], 30000, 1), cola.runs[0].incomes[29]);

  const fixed = S.runAll(base({ annualSpend: 0, incomes: [{ label: 'p', amount: 30000, from: 65, to: null, cola: false }] }));
  const modern = fixed.runs[fixed.runs.length - 1];
  check('a fixed pension erodes in a modern cohort',
    modern.incomes[29] < 22000, Math.round(modern.incomes[29]));
  // ...and GREW for an 1871 retiree, because prices fell for thirty years.
  check('a fixed pension GREW in real terms for an 1871 retiree',
    fixed.runs[0].incomes[29] > 35000, Math.round(fixed.runs[0].incomes[29]));

  // An income that ends must actually end.
  const ends = S.runAll(base({ annualSpend: 0, incomes: [{ label: 'p', amount: 12000, from: 65, to: 75, cola: true }] }));
  check('an income with an end date stops', ends.runs[0].incomes[15] === 0, ends.runs[0].incomes[15]);

  // A one-off lands in its own year, IN the balance that year's strategy reads.
  // It used to be added after the year's paycheck had already been decided, so
  // a percentage-of-portfolio retiree spent an inheritance a year late.
  const lump = S.runCycle(base({ annualSpend: 0, portfolio: 0, stocks: 0, events: [{ label: 'sale', amount: 100000, at: 70 }] }), 0);
  check('nothing arrives before the year it is dated', lump.balances[4] === 0, lump.balances[4]);
  check('a one-off is in the balance the year it arrives', lump.balances[5] === 100000, lump.balances[5]);

  // ...and a balance-derived paycheck must SEE it that year.
  const rich = S.runCycle(base({
    strategy: 'percent', percentRate: 0.05,
    events: [{ label: 'inheritance', amount: 1000000, at: 70, years: 1 }]
  }), (1990 - 1871) * 12);
  check('a strategy that reads the balance spends the windfall the year it lands',
    rich.spends[5] > rich.spends[4] * 1.5, [Math.round(rich.spends[4]), Math.round(rich.spends[5])]);
}

{
  // COLLEGE, and everything shaped like it: an outflow several years long,
  // landing in the decade a plan can least afford it. `years` defaults to 1, so
  // a one-off is a span of one and there is no second concept.
  //
  // The span is tested on the SCHEDULE rather than inferred from balances,
  // because a balance is the sum of the bill and everything the bill stopped
  // earning, and that second part depends on which century the cycle ran in.
  const sched = S.schedule(base({
    currentAge: 45, endAge: 95,
    events: [{ label: 'College', amount: -30000, at: 55, years: 4 }]
  }));
  const billed = [];
  for (let y = 0; y < sched.lumps.length; y++) if (sched.lumps[y]) billed.push([45 + y, sched.lumps[y]]);
  check('college bills exactly four years, at the right ages',
    billed.length === 4 && billed[0][0] === 55 && billed[3][0] === 58, billed);
  check('...each one the full amount, and outward',
    billed.every(function (b) { return b[1] === -30000; }), billed);

  const one = S.schedule(base({ currentAge: 45, endAge: 95, events: [{ label: 'x', amount: -5000, at: 60 }] }));
  let n = 0;
  for (let y = 0; y < one.lumps.length; y++) if (one.lumps[y]) n++;
  check('an event with no span is still a single year', n === 1, n);

  // Two children overlapping in one year must both be billed, not one.
  const two = S.schedule(base({
    currentAge: 45, endAge: 95,
    events: [{ label: 'A', amount: -30000, at: 55, years: 4 },
      { label: 'B', amount: -30000, at: 57, years: 4 }]
  }));
  check('two children overlapping bill twice in the overlap year',
    two.lumps[57 - 45] === -60000, two.lumps[57 - 45]);

  // A bill you cannot pay is a shortfall, not a negative sleeve. The first
  // version clamped stocks to zero and then pushed the overdraft straight back
  // into it, and the plan ran the rest of its life on a phantom short position.
  const broke = S.runCycle(base({
    currentAge: 45, retireAge: 46, endAge: 70, portfolio: 10000, annualSavings: 0,
    annualSpend: 0, events: [{ label: 'C', amount: -90000, at: 46, years: 1 }]
  }), 0);
  check('an unaffordable bill is a failure, not a negative balance',
    broke.failed && broke.balances.every(function (v) { return v >= -1e-6; }),
    { failed: broke.failed, min: Math.min.apply(null, broke.balances) });

  // And it has to move the verdict, or the feature is decorative. These are the
  // app's own defaults, which sit just under their bar on purpose.
  const dflt = {
    currentAge: 45, retireAge: 65, endAge: 95, portfolio: 180000, annualSavings: 18000,
    annualSpend: 75000, stocks: 0.75, fees: 0.001,
    incomes: [{ label: 'Social Security', amount: 24900, from: 67, to: null, cola: true }]
  };
  const s1 = S.runAll(base(dflt)).successRate;
  const s2 = S.runAll(base(Object.assign({}, dflt, {
    events: [{ label: 'College', amount: -30000, at: 55, years: 4 }]
  }))).successRate;
  check('four years of college makes a real dent in the odds', s2 < s1 - 0.1,
    [(s1 * 100).toFixed(0) + '%', (s2 * 100).toFixed(0) + '%']);
}


// ---- 4. the strategies, against their own papers -----------------------------

{
  // Bogleheads VPW, published table. r = stocks*5.0% + bonds*1.9%, n = 100-age,
  // ANNUITY-DUE. The annuity-due form is what pins it; an ordinary annuity
  // misses by an order of magnitude more.
  const cell = (age, stk) => {
    const ctx = {
      plan: { currentAge: age, stocks: stk, glidepath: null },
      base: 0, balance: 100, year: 0, yearIndex: 0, left: 100 - age, infl: 1, lastReturn: 0
    };
    return S.STRATEGIES.vpw.step({}, ctx);
  };
  const table = [[50, 0.5, 4.1], [60, 0.6, 4.7], [65, 0.6, 5.0], [70, 0.6, 5.4],
    [75, 0.6, 6.0], [80, 0.6, 6.9], [85, 0.6, 8.5], [65, 0.3, 4.4], [65, 0.7, 5.2]];
  let bad = 0;
  for (const [age, stk, want] of table) if (!near(cell(age, stk), want, 0.06)) bad++;
  check('VPW reproduces the published Bogleheads table (9 cells)', bad === 0, bad + ' cells off');
  // The table is NOT capped at 10%. An earlier version capped it, which broke
  // every cell past 88 and left a third of the portfolio unspent at the end —
  // making the strategy's own promise, that nothing is left over, false.
  check('...including past 88, where a 10% cap used to break it',
    near(cell(90, 0.6), 11.74, 0.05) && near(cell(95, 0.6), 21.50, 0.05),
    [cell(90, 0.6).toFixed(2), cell(95, 0.6).toFixed(2)]);
  {
    const o = S.runAll(base({ strategy: 'vpw', endAge: 100, stocks: 0.6, annualSpend: 50000 }));
    check('...and "nothing is left over" is true of what it actually does',
      o.medianFinal < 20000, Math.round(o.medianFinal));
  }

  // A strategy whose paycheck comes OUT of the balance cannot run out, and must
  // never be scored as if it could. This was wrong once: VPW read 48.8% failure
  // for a method whose entire contract is "spend what you have".
  for (const k of ['vpw', 'percent']) {
    const o = S.runAll(base({ strategy: k, annualSpend: 50000, percentRate: 0.05 }));
    check(k + ' can never "run out"', o.successRate === 1, (o.successRate * 100).toFixed(1));
  }
  check('...and the fixed-paycheck strategy still can',
    S.runAll(base({ annualSpend: 60000 })).successRate < 1);
}

{
  // Guyton-Klinger. The rails are ±20% of the INITIAL rate, and the cuts and
  // raises are 10%. Its point is that flexibility buys survival — and its cost,
  // which Kitces' critique is entirely about, is a genuinely lean year.
  const hard = base({ annualSpend: 55000 });
  const flat = S.runAll(hard).successRate;
  const rail = S.runAll(Object.assign({}, hard, { strategy: 'guardrails' })).successRate;
  check('guardrails beat a fixed paycheck on survival', rail > flat + 0.05,
    [(flat * 100).toFixed(1), (rail * 100).toFixed(1)]);

  const o = S.runAll(Object.assign({}, hard, { strategy: 'guardrails' }));
  let leanest = Infinity;
  for (const r of o.runs) for (let y = r.retireYear; y < r.spends.length; y++) {
    if (r.spends[y] < leanest) leanest = r.spends[y];
  }
  // The cuts are multiplicative, so a bad run really does compound them down.
  // If this ever reads "no worse than the plan", the rails have stopped firing.
  check('guardrails really do cut, and deeply, in the worst runs',
    leanest < 55000 * 0.75, Math.round(leanest));

  // Vanguard: ceiling +5%, floor -2.5% (the 2023 spec, and the one Morningstar
  // implements; the 2020 paper's own figures used -1.5%). Year on year the
  // paycheck may not move further than that in real terms.
  const v = S.runCycle(base({ strategy: 'dynamic', annualSpend: 50000, percentRate: 0.05 }), (1929 - 1871) * 12);
  let worstDrop = 0, biggestRise = 0;
  for (let y = v.retireYear + 1; y < v.spends.length; y++) {
    const prev = v.spends[y - 1];
    if (!prev) continue;
    const ch = v.spends[y] / prev - 1;
    if (ch < worstDrop) worstDrop = ch;
    if (ch > biggestRise) biggestRise = ch;
  }
  check('Vanguard smoothing never cuts more than 2.5% in a year',
    worstDrop > -0.0251, (worstDrop * 100).toFixed(2));
  check('...nor raises more than 5%', biggestRise < 0.0501, (biggestRise * 100).toFixed(2));
}

{
  // A glidepath has to actually move the allocation.
  const p = base({ stocks: 0.9, glidepath: { to: 0.3, byAge: 85 } });
  check('a glidepath starts where it says', near(S.stocksAt(p, 65), 0.9, 1e-9), S.stocksAt(p, 65));
  check('...ends where it says', near(S.stocksAt(p, 85), 0.3, 1e-9), S.stocksAt(p, 85));
  check('...and holds after that', near(S.stocksAt(p, 95), 0.3, 1e-9), S.stocksAt(p, 95));
}

{
  // THE SPENDING SMILE. Blanchett's published per-year curve: real spending
  // drifts down through the sixties and seventies, troughs around 79, and turns
  // back up late. Interpolated between the published points rather than fitted
  // to one quadratic — the curve is not symmetric about its trough, and a single
  // parabola throws one arm out by more than a point a year, which compounds.
  check('the smile falls before the trough', S.smileRate(70) < 0, S.smileRate(70));
  check('...bottoms out around 79',
    S.smileRate(79) < S.smileRate(70) && S.smileRate(79) < S.smileRate(90),
    [S.smileRate(70), S.smileRate(79), S.smileRate(90)]);
  check('...and turns back up late', S.smileRate(95) > 0, S.smileRate(95));
  check('...matching the published points', near(S.smileRate(70), -0.010, 0.0005)
    && near(S.smileRate(79), -0.014, 0.0005) && near(S.smileRate(100), 0.024, 0.0005),
    [S.smileRate(70), S.smileRate(79), S.smileRate(100)]);

  const flat = base();
  const smiled = base({ smile: true });
  const sp = S.runCycle(smiled, 0).spends;
  // The multiplier troughs where the RATE crosses zero on the way up — around
  // 87, not at 79 where the rate itself is lowest. Asserting against a fixed
  // age gets that wrong; assert against the actual minimum.
  let lo = 0;
  for (let i = 1; i < sp.length; i++) if (sp[i] < sp[lo]) lo = i;
  check('spending falls to a trough and then turns back up',
    sp[lo] < sp[0] * 0.93 && lo > 15 && lo < sp.length - 1 && sp[sp.length - 1] > sp[lo],
    { troughAge: 65 + lo, first: Math.round(sp[0]), trough: Math.round(sp[lo]), last: Math.round(sp[sp.length - 1]) });
  check('the first year is untouched', near(sp[0], 40000, 1), sp[0]);
  check('the flat plan really is flat', near(S.runCycle(flat, 0).spends[20], 40000, 1));

  // It has to move the safe rate, or it is decoration — and it must move it in
  // the flattering direction, which is exactly why it is off by default.
  const a = S.solveSpend(flat, 1.0, { iters: 18 });
  const b = S.solveSpend(smiled, 1.0, { iters: 18 });
  check('easing off with age raises the safe rate', b > a * 1.04 && b < a * 1.25,
    [(a / 10000).toFixed(2) + '%', (b / 10000).toFixed(2) + '%']);
}

// ---- 5. the advice must be true ----------------------------------------------
//
// The app prints sentences like "retiring at 66 clears 95%". If a suggestion is
// not literally true of the plan it describes, the app is lying with numbers,
// which is worse than saying nothing. So every 'fix' is re-simulated here.

{
  const p = base({
    currentAge: 45, retireAge: 60, endAge: 95, portfolio: 400000,
    annualSavings: 20000, annualSpend: 85000, stocks: 0.6, fees: 0.009,
    incomes: [{ label: 'Social Security', amount: 26000, from: 62, to: null, cola: true }]
  });
  const now = S.runAll(p).successRate;
  check('the test plan is genuinely short of its bar', now < p.target, (now * 100).toFixed(1));

  const list = A.suggest(p, now, p.target, { step: 3 });
  check('advice is offered for a failing plan', list.length > 0, list.length);
  check('every fix is ranked above every help',
    list.every((x, i) => i === 0 || !(x.kind === 'fix' && list[i - 1].kind !== 'fix')),
    list.map((x) => x.kind));

  // Re-measure each claim at FULL resolution, not the sampled resolution the
  // suggester used. A claim that only survives its own sampling is not a claim.
  for (const a of list) {
    if (a.kind !== 'fix' && a.kind !== 'help') continue;
    const q = JSON.parse(JSON.stringify(p));
    let applied = true;
    if (a.id === 'spend') q.annualSpend -= a.cost;
    else if (a.id === 'age') q.retireAge = +/at (\d+)/.exec(a.detail)[1];
    else if (a.id === 'save') q.annualSavings += a.cost;
    else if (a.id === 'mix') q.stocks = +/Hold (\d+)%/.exec(a.title)[1] / 100;
    else if (a.id === 'flex') q.strategy = 'guardrails';
    else if (a.id === 'fees') q.fees = 0.0005;
    else if (a.id === 'defer') {
      const k = q.incomes.findIndex((i) => /social/i.test(i.label));
      q.incomes[k].amount *= A.deferFactor(q.incomes[k].from, 70);
      q.incomes[k].from = 70;
    } else applied = false;
    if (!applied) continue;
    const got = S.runAll(q).successRate;
    if (a.kind === 'fix') {
      // Sampling every third cycle can land a hair under; a quarter of a point
      // is measurement, not a false claim.
      check('"' + a.title + '" really does clear the bar', got >= p.target - 0.0025,
        (got * 100).toFixed(1));
    } else {
      check('"' + a.title + '" really does improve it', got > now,
        [(now * 100).toFixed(1), (got * 100).toFixed(1)]);
    }
  }
}

{
  // US Social Security claiming factors, FRA 67: 70% at 62, 100% at 67, 124% at
  // 70. These are printed as a percentage in the advice card.
  check('claiming at 62 pays 70% of the full benefit', near(A.pcOfFra(62), 0.70, 0.001), A.pcOfFra(62));
  check('claiming at 67 pays 100%', near(A.pcOfFra(67), 1.00, 0.001), A.pcOfFra(67));
  check('claiming at 70 pays 124%', near(A.pcOfFra(70), 1.24, 0.001), A.pcOfFra(70));
  check('62 → 70 is a 77% raise', near(A.deferFactor(62, 70), 1.7714, 0.002), A.deferFactor(62, 70));

  // A plan that already clears its bar is offered room, never fixes.
  const rich = base({ annualSpend: 25000 });
  const list = A.suggest(rich, S.runAll(rich).successRate, 0.95, { step: 4 });
  check('a comfortable plan is offered room, not fixes',
    list.every((x) => x.kind === 'room' || x.kind === 'note'), list.map((x) => x.kind));
}

// ---- a small fake browser, built from the app's OWN index.html -------------
// Every element with an id in the page exists (tag, attributes, hidden), so
// the app's real boot() finds what it would find in a browser; listeners are
// recorded and dispatch() fires them. Canvas contexts are inert recorders and
// toDataURL names the canvas it came from, so a test can tell which picture
// was saved. Network/camera/eval globals are TRAPS that count calls.
function parseAttrs(s) {
  const a = {};
  for (const m of String(s || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) a[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '';
  return a;
}
function miniDom(html) {
  const byId = new Map();
  const imgSrcs = [];
  const created = [];
  let serial = 0;
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'wbr', 'track', 'param']);
  function classes(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }
  function matches(el, sel) {
    return String(sel).split(',').some((one) => {
      one = one.trim();
      if (one === '*') return true;
      const m = /^([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/.exec(one.split(/\s+/).pop());
      if (!m) return false;
      if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
      for (const part of (m[2].match(/[#.][\w-]+/g) || [])) {
        if (part[0] === '#' && el.id !== part.slice(1)) return false;
        if (part[0] === '.' && classes(el).indexOf(part.slice(1)) < 0) return false;
      }
      for (const at of (m[3].match(/\[[^\]]+\]/g) || [])) {
        const [k, v] = at.slice(1, -1).split('=');
        const val = k === 'type' ? el.type : el.getAttribute(k);
        if (val == null) return false;
        if (v != null && String(val) !== v.replace(/^["']|["']$/g, '')) return false;
      }
      return true;
    });
  }
  function camel(k) { return k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase()); }
  function descendants(el) { const out = []; for (const c of el.children || []) { if (c.nodeType !== 1) continue; out.push(c); out.push(...descendants(c)); } return out; }
  function ctx2d(canvas) {
    const calls = [];
    const rec = (name) => function () { calls.push(name); };
    return new Proxy({ canvas, calls,
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
      measureText: (t) => ({ width: String(t).length * 6 }),
      createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}),
    }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? rec(k) : undefined)), set: (t, k, v) => { t[k] = v; return true; } });
  }
  function make(tag, attrs) {
    attrs = attrs || {};
    const el = {
      tagName: String(tag).toUpperCase(), nodeType: 1, attrs: {}, children: [], parentNode: null, serial: ++serial,
      style: { setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } },
      dataset: {}, _l: {}, _text: '', value: attrs.value || '', type: attrs.type || '',
      hidden: 'hidden' in attrs, disabled: 'disabled' in attrs, checked: 'checked' in attrs,
      width: +attrs.width || 300, height: +attrs.height || 150, className: attrs.class || '', files: null,
      clientWidth: 360, clientHeight: 640, offsetWidth: 360, offsetHeight: 640, scrollTop: 0,
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter((g) => g !== f); },
      dispatch(t, ev) {
        // Bubbles like a browser event: this element, its ancestors, then the
        // document's listeners — unless stopPropagation() or bubbles: false.
        const e = Object.assign({ type: t, target: this, currentTarget: this, bubbles: true, cancelable: true, _stop: false,
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, stopImmediatePropagation() { this._stop = true; },
          pointerId: 1, button: 0, clientX: 0, clientY: 0 }, ev || {});
        let node = this;
        while (node) {
          e.currentTarget = node;
          (node._l[t] || []).slice().forEach((f) => f.call(node, e));
          if (typeof node['on' + t] === 'function') node['on' + t](e);
          if (e._stop || e.bubbles === false) return e;
          node = node.parentNode;
        }
        (docL[t] || []).slice().forEach((f) => f(e));
        return e;
      },
      click() { this.clicks = (this.clicks || 0) + 1; return this.dispatch('click'); },
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
      append(...cs) { cs.forEach((c) => (typeof c === 'object' ? this.appendChild(c) : null)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      replaceChildren(...cs) { this.children = []; this.append(...cs); },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') byId.set(String(v), this); if (k === 'class') this.className = String(v); if (k.indexOf('data-') === 0) this.dataset[camel(k)] = String(v); },
      getAttribute(k) {
        if (k === 'class') return this.className;
        if (k.indexOf('data-') === 0 && this.dataset[camel(k)] != null) return String(this.dataset[camel(k)]);
        return k in this.attrs ? this.attrs[k] : null;
      },
      hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
      toggleAttribute(k, on) { if (on === undefined ? !(k in this.attrs) : on) this.attrs[k] = ''; else delete this.attrs[k]; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { return descendants(this).filter((e) => matches(e, sel)); },
      closest(sel) { let e = this; while (e) { if (e.nodeType === 1 && matches(e, sel)) return e; e = e.parentNode; } return null; },
      contains(o) { let e = o; while (e) { if (e === this) return true; e = e.parentNode; } return false; },
      focus() { doc.activeElement = this; }, blur() {}, select() {},
      setPointerCapture(id) { this.captured = id; }, releasePointerCapture() { this.captured = null; }, hasPointerCapture() { return this.captured != null; },
      getBoundingClientRect() { return { left: 0, top: 0, x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; },
      scrollIntoView() {},
      getElementsByClassName(c) { return descendants(this).filter((e) => classes(e).indexOf(c) >= 0); },
      cloneNode() { const c = make(this.tagName.toLowerCase(), Object.assign({}, this.attrs)); if ('src' in this) c.src = this.src; return c; },
      animate() {
        // Web Animations stand-in: play() finishes on the next tick.
        const a = { playState: 'idle', onfinish: null, cancel() { a.playState = 'idle'; }, finish() { a.playState = 'finished'; },
          play() { a.playState = 'running'; setTimeout(() => { a.playState = 'finished'; if (a.onfinish) a.onfinish(); }, 0); } };
        return a;
      },
      getContext(kind) { if (kind && kind !== '2d') return null; return this._ctx || (this._ctx = ctx2d(this)); },
      toDataURL(type) { return 'data:' + (type || 'image/png') + ';base64,' + Buffer.from('canvas#' + this.serial).toString('base64'); },
      toBlob(cb, type) { cb({ type: type || 'image/png', size: 4, canvasSerial: this.serial }); },
    };
    el.classList = {
      add: (...c) => { const s = classes(el); c.forEach((x) => { if (s.indexOf(x) < 0) s.push(x); }); el.className = s.join(' '); },
      remove: (...c) => { el.className = classes(el).filter((x) => c.indexOf(x) < 0).join(' '); },
      toggle: (c, on) => { const has = classes(el).indexOf(c) >= 0; const want = on === undefined ? !has : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
      contains: (c) => classes(el).indexOf(c) >= 0,
    };
    Object.defineProperty(el, 'innerHTML', { get() { return this._html || ''; }, set(v) { this._html = String(v); this.children = []; parseInto(this, this._html, 0); }, configurable: true });
    // textContent: setting it replaces the children (as in a browser);
    // reading it gives the element's own text, else its children's.
    Object.defineProperty(el, 'textContent', {
      get() { return this._text !== '' ? this._text : this.children.map((c) => c.textContent || '').join(''); },
      set(v) { this._text = v == null ? '' : String(v); this.children = []; }, configurable: true,
    });
    Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
    Object.defineProperty(el, 'lastChild', { get() { return this.children[this.children.length - 1] || null; } });
    Object.defineProperty(el, 'id', { get() { return this.attrs.id || ''; }, set(v) { this.setAttribute('id', v); }, configurable: true });
    if (el.tagName === 'IMG') {
      // An <img> in the page loads like new Image(): setting src fires onload.
      let src = attrs.src || '';
      Object.assign(el, { naturalWidth: 64, naturalHeight: 48, width: 64, height: 48, complete: false });
      Object.defineProperty(el, 'src', { get: () => src, set: (v) => { src = String(v); imgSrcs.push(src); setTimeout(() => { el.complete = true; el.dispatch('load'); }, 0); }, configurable: true });
    }
    for (const k of Object.keys(attrs)) {
      if (k === 'class') continue;
      el.attrs[k] = attrs[k];
      if (k.indexOf('data-') === 0) el.dataset[camel(k)] = attrs[k];
    }
    if (attrs.id) byId.set(attrs.id, el);
    return el;
  }
  // Parse markup into elements (tags, attributes, nesting; text lands in the
  // nearest element's textContent). Used for the page AND for innerHTML.
  function parseInto(parent, src, from) {
    const stack = [parent];
    const tagRe = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    tagRe.lastIndex = from || 0;
    let m;
    while ((m = tagRe.exec(src))) {
      if (m[5] != null) { const t = m[5].replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '); if (t.trim()) { const top = stack[stack.length - 1]; if (top !== parent || parent.tagName !== 'BODY') top._text = (top._text ? top._text + ' ' : '') + t.trim(); } continue; }
      if (!m[2]) continue;
      const name = m[2].toLowerCase();
      if (name === 'body' || name === 'html' || name === 'head') { if (name === 'body' && !m[1]) Object.assign(body.attrs, parseAttrs(m[3])); continue; }
      if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === name.toUpperCase()) { stack.length = i; break; } continue; }
      const el = make(name, parseAttrs(m[3]));
      stack[stack.length - 1].appendChild(el);
      if (name === 'script' || name === 'style') { const end = src.indexOf('</' + name, tagRe.lastIndex); if (end > 0) tagRe.lastIndex = end; }
      if (!VOID.has(name) && !m[4] && name !== 'script' && name !== 'style') stack.push(el);
    }
  }
  const body = make('body', {});
  const head = make('head', {});
  const root = make('html', {});
  root.appendChild(head); root.appendChild(body);
  const bodyAt = html.search(/<body\b/i);
  parseInto(body, html, bodyAt < 0 ? 0 : bodyAt);
  const docL = {};
  const doc = {
    nodeType: 9, readyState: 'complete', body, head, documentElement: root, activeElement: body, hidden: false, visibilityState: 'visible',
    getElementById: (id) => byId.get(id) || null,
    querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
    getElementsByTagName: (t) => root.querySelectorAll(t), getElementsByClassName: (c) => root.querySelectorAll('.' + c),
    createElement: (t) => { const e = make(t, {}); created.push(e); return e; }, createElementNS: (ns, t) => make(t, {}),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }), createDocumentFragment: () => make('fragment', {}),
    addEventListener: (t, f) => (docL[t] = docL[t] || []).push(f), removeEventListener: (t, f) => { docL[t] = (docL[t] || []).filter((g) => g !== f); },
    dispatch: (t, ev) => { const e = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {}); (docL[t] || []).slice().forEach((f) => f(e)); return e; },
  };
  return { document: doc, make, byId, matches, imgSrcs, created };
}
// The window an app runs in: the fake document, a fake gifos (db rows kept
// in memory so a second boot can read what the first one saved), and traps.
function fakeWindow(html, o) {
  o = o || {};
  const dom = miniDom(html);
  const traps = { fetch: 0, xhr: 0, ws: 0, eval: 0, fn: 0, gum: 0, worker: 0 };
  const dbs = o.dbs || {};
  const puts = [];
  // gifos.db: rows live in a Map that two windows may SHARE (o.dbs), and
  // subscribe() hears every put from either window — a two-device room.
  const db = (name) => {
    const rows = (dbs[name] = dbs[name] || new Map());
    const subs = rows.subs || (rows.subs = []);
    const list = () => [...rows.values()].map((r) => JSON.parse(JSON.stringify(r)));
    const tell = () => subs.slice().forEach((f) => setTimeout(() => f(list()), 0));
    return {
      get: async (id) => (rows.has(id) ? JSON.parse(JSON.stringify(rows.get(id))) : null),
      put: async (row) => {
        const r = JSON.parse(JSON.stringify(row));
        if (r.id == null) r.id = name + '-' + (rows.size + 1);
        puts.push({ db: name, row: r }); rows.set(r.id, JSON.parse(JSON.stringify(r))); tell(); return JSON.parse(JSON.stringify(r));
      },
      delete: async (id) => { rows.delete(id); tell(); }, del: async (id) => { rows.delete(id); tell(); },
      all: async () => list(), list: async () => list(), query: async () => list(), getAll: async () => list(),
      subscribe: (f) => { subs.push(f); setTimeout(() => f(list()), 0); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
      on: () => () => {}, watch: () => () => {},
    };
  };
  let backHandler = null;
  const winL = {};
  const timers = [];
  const images = dom.imgSrcs;
  const gifos = Object.assign({
    db, onBack: (f) => { backHandler = f; }, info: async () => ({ owner: o.owner !== false }), me: async () => (o.me || { id: 'me', name: 'Tester' }),
    takePhoto: async () => { traps.photo = (traps.photo || 0) + 1; return { bytes: new Uint8Array([255, 216, 255]), mime: 'image/jpeg' }; },
    launch: () => Promise.resolve(o.launch || null), ready: () => {}, setTitle: () => {}, haptic: () => {}, vibrate: () => {},
  }, o.gifos || {});
  const w = {
    document: dom.document, gifos, console: o.quiet ? { log() {}, warn() {}, error() {}, info() {} } : console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Promise, Symbol, Map, Set, WeakMap, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, isFinite,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Buffer,
    encodeURIComponent, decodeURIComponent, atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, o.maxTimer == null ? 50 : o.maxTimer)), clearTimeout, setInterval: (f, ms) => { const t = setInterval(f, Math.max(ms || 0, 10)); timers.push(t); return t; }, clearInterval,
    requestAnimationFrame: (f) => (o.raf ? o.raf(f) : 0), cancelAnimationFrame: () => {},
    innerWidth: 360, innerHeight: 640, devicePixelRatio: 1, matchMedia: () => ({ matches: !!o.touch, addEventListener() {}, addListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'about:blank', hash: '', search: '', reload() {} },
    navigator: { userAgent: 'test', maxTouchPoints: o.touch ? 5 : 0, vibrate: () => true, onLine: true,
      mediaDevices: { getUserMedia: () => { traps.gum++; return Promise.reject(new Error('trap')); } } },
    addEventListener: (t, f) => (winL[t] = winL[t] || []).push(f), removeEventListener: (t, f) => { winL[t] = (winL[t] || []).filter((g) => g !== f); },
    dispatch: (t, ev) => { const e = Object.assign({ type: t, preventDefault() {}, stopPropagation() {} }, ev || {}); (winL[t] || []).slice().forEach((f) => f(e)); return e; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: () => { traps.fetch++; return new Promise(() => {}); },
    XMLHttpRequest: function () { traps.xhr++; throw new Error('trap: no network'); },
    WebSocket: function () { traps.ws++; throw new Error('trap: no network'); },
    Worker: function () { traps.worker++; throw new Error('trap: no worker'); },
    eval: () => { traps.eval++; throw new Error('trap: no eval'); },
    Image: function () { return dom.make('img', {}); }, // a real fake <img>: setting src fires load
    Blob: function (parts, opt) { this.parts = parts; this.type = (opt && opt.type) || ''; this.size = 4; },
    URL: { createObjectURL: () => 'blob:fake/' + Math.random().toString(36).slice(2), revokeObjectURL() {} },
    FileReader: function () { const r = this; r.readAsDataURL = () => setTimeout(() => { r.result = 'data:image/png;base64,AAAA'; if (r.onload) r.onload({ target: r }); }, 0); r.readAsArrayBuffer = () => setTimeout(() => { r.result = new ArrayBuffer(4); if (r.onload) r.onload({ target: r }); }, 0); },
    performance: { now: () => Date.now() },
    AudioContext: undefined, webkitAudioContext: undefined,
  };
  w.window = w; w.self = w; w.globalThis = w; w.top = w; w.parent = w;
  w.Function = new Proxy(Function, { construct: () => { traps.fn++; throw new Error('trap: no Function'); }, apply: () => { traps.fn++; throw new Error('trap: no Function'); } });
  Object.assign(w, o.extra || {});
  const ctx = vm.createContext(w);
  return {
    w, ctx, dom, traps, dbs, puts, images, $: (id) => dom.document.getElementById(id), back: () => (backHandler ? backHandler() : undefined), hasBack: () => !!backHandler,
    run: (file, code) => vm.runInContext(code, ctx, { filename: file }),
    stop: () => timers.forEach(clearInterval),
  };
}
const flushAsync = async (n) => { for (let i = 0; i < (n || 30); i++) await new Promise((r) => setTimeout(r, 0)); };
// ---- CSS as rules: selector -> declarations (structure, not substrings) -----
// Rules inside an @media block carry that block's prelude in `media`.
function cssRules(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const pre = stack.pop();
      if (pre != null && pre[0] !== '@') {
        const decl = {};
        for (const d of buf.split(';')) { const i = d.indexOf(':'); if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim(); }
        const media = stack.filter((x) => x[0] === '@').join(' ');
        for (const sel of pre.split(',')) out.push({ sel: sel.trim().replace(/\s+/g, ' '), decl, media });
      }
      buf = '';
    } else buf += ch;
  }
  return out;
}
// The value a property gets on a selector outside any @media (last rule
// wins), or inside the @media whose prelude matches `media`; null if unset.
function cssValue(rules, selTest, prop, media) {
  let v = null;
  for (const r of rules) {
    if (media ? !media.test(r.media) : r.media) continue;
    if ((typeof selTest === 'string' ? r.sel === selTest : selTest.test(r.sel)) && prop in r.decl) v = r.decl[prop];
  }
  return v;
}
// Boot an app the way its page does: every classic <script src> in index.html,
// in order, inside one fake window.
function bootApp(appDir, o) {
  const html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  const W = fakeWindow(html, o);
  const srcs = Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi), (m) => m[1]);
  for (const s of srcs) W.run(s, fs.readFileSync(path.join(appDir, s), 'utf8'));
  return W;
}

// ---- 6. the app's shipped shape, BOOTED ---------------------------------------
// The page is booted from its own index.html in a fake browser (the real
// sim runs, ~10 s on the gate box) and used: plans saved and named, an
// income and a one-off labelled, the plan menu opened, two plans compared.
// Every user-typed name is a piece of markup; if any of it reached the DOM
// as markup, the fake document would hold an <img> it never should.
const XSS = (n) => '<img src=x' + n + ' onerror=alert(' + n + ')>';
async function shell() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const srcs = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi), (m) => m[1]);
  for (const s of ['data/market.js', 'sim.js', 'chart.js', 'advice.js', 'app.js']) {
    check('index.html loads ' + s, srcs.indexOf(s) !== -1);
  }
  const tags = Array.from(html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link|img|iframe|source)\b([^>]*)>/gi), (m) => parseAttrs(m[2]));
  check('index.html reaches for nothing external', tags.every((a) => !/^(https?:)?\/\//i.test(a.src || a.href || '')));

  const W = bootApp(APP, { quiet: true });
  const settle = async (ms) => { await flushAsync(30); await new Promise((r) => setTimeout(r, ms || 50)); await flushAsync(30); };
  await settle(300);
  const name = async (v) => { const inp = W.$('modalBody').querySelector('input'); inp.value = v; W.$('modalOk').click(); await settle(); };
  W.$('btnSave').click();
  await name(XSS(1));
  const saved = W.puts.filter((p) => p.db === 'scenarios');
  check('the app saves plans through gifos.db(\'scenarios\')', saved.length === 1 && saved[0].row.name === XSS(1) && !!saved[0].row.plan, saved.length);
  check('…and the plan bar shows the saved name as text', W.$('scenLabel').textContent === XSS(1));
  W.$('btnNew').click();
  W.$('modalBody').querySelector('button').click();
  await settle();
  await name(XSS(2));
  W.$('btnAddIncome').click();
  // A label only reaches the charts and tables once it has an amount.
  const incIn = W.$('incomeList').querySelectorAll('input');
  const incName = incIn[0];
  if (incName) { incName.value = XSS(3); incName.dispatch('input'); incIn[1].value = '24000'; incIn[1].dispatch('input'); }
  W.$('btnAddEvent').click();
  const evIn = W.$('eventList').querySelectorAll('input');
  const evName = evIn[0];
  if (evName) { evName.value = XSS(4); evName.dispatch('input'); evIn[1].value = '30000'; evIn[1].dispatch('input'); }
  await settle(1500);
  const shown = W.dom.document.documentElement.querySelectorAll('*').filter((e) => e._text === XSS(3) || e._text === XSS(4) || (e.value === XSS(3)));
  check('the labels are in play (they reach the page as text)', shown.length >= 2, shown.length);
  W.$('btnSave').click();
  await settle();
  W.$('scenPick').click();
  await settle();
  const menuNames = W.$('scenMenu').querySelectorAll('.mi-name').map((n) => n.textContent);
  check('the plan menu lists both names, as text', menuNames.indexOf(XSS(1)) !== -1 && menuNames.indexOf(XSS(2)) !== -1, menuNames);
  W.$('btnCompare').click();
  const pick = W.$('modalBody').querySelectorAll('button')[0];
  if (pick) pick.click();
  await settle(1500);
  check('two plans compare side by side', W.$('cardCompare').hidden === false);
  const all = [W.dom.document.documentElement].concat(W.dom.document.documentElement.querySelectorAll('*'));
  const imgs = all.filter((e) => e.tagName === 'IMG' && /^x\d/.test(e.attrs.src || ''));
  const raw = all.filter((e) => /onerror/i.test(e._html || ''));
  check('user text (plan names, income and one-off labels) never reaches the DOM as markup',
    imgs.length === 0 && raw.length === 0 && !!incName && !!evName, { imgs: imgs.length, raw: raw.map((e) => e.id || e.tagName) });
  check('nothing leaves the browser while it is used', W.traps.fetch + W.traps.xhr + W.traps.ws === 0, W.traps);
  W.stop();
}

{
  const mf = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8'));
  // The listing promises nothing is uploaded. That is only true while these are
  // absent, so it is asserted here as well as in the build.
  for (const cap of ['network', 'pool', 'api', 'ai']) {
    check('no ' + cap + ' capability — nothing may leave the browser', !mf.capabilities[cap]);
  }
  check('scenarios sync on an Invite', mf.data.scenarios.visibility === 'read-write');
  check('prefs stay on the device', mf.data.prefs.visibility === 'private');
}

shell().catch((e) => { failures++; console.log('FAIL — shell crashed: ' + (e && e.stack || e)); }).then(() => {
console.log(failures ? '\n' + failures + ' FAILED' : '\nall good');
  process.exit(failures ? 1 : 0);
});
