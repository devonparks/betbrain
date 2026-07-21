/**
 * VERIFY — markets.ts + evaluate.ts, driving the REAL MODULES.
 *
 * Companion to tools/verify-markets.mjs, which re-implements every formula in
 * plain JS. That mirror is a genuinely independent second opinion on the MATH,
 * but it can pass while the shipped TypeScript is wrong, because not one of its
 * arithmetic assertions executes src/lib/nba/*.ts. This script closes that hole:
 * it imports the actual exported functions (Node >= 22 type stripping, same
 * mechanism tools/run-backtest.ts already relies on) and re-derives every number
 * from an INDEPENDENT high-precision normal CDF — Marsaglia's Taylor series,
 * ~1e-15, sharing no code or coefficients with the module's A&S 7.1.26 erf.
 *
 * The centrepiece is section 3. For every proposition expandMarkets emits, it
 * computes sum over integer outcomes k of P(outcome = k) restricted to the k for
 * which the REAL gradeMarket returns true, and asserts that equals the quoted
 * probability. A side swap, a sign error, an off-by-one on a push, or any
 * disagreement between what expansion MEANS by a selection string and what
 * grading THINKS it means, all show up here as a large gap. No fixture can be
 * written that passes this while being wrong.
 *
 * Run: node tools/verify-markets-live.mjs   (from the repo root)
 * Exits non-zero on any failure.
 */
import {
  erf,
  normalCdf,
  thresholdProbabilities,
  expandMarkets,
  gradeMarket,
  gradeMarkets,
} from "../src/lib/nba/markets.ts";
import {
  evaluate,
  scoreContinuous,
  scoreMarginAndTotal,
  formatReport,
} from "../src/lib/nba/evaluate.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS ", m); } else { fail++; console.log("FAIL ", m); } };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}  (got ${a}, want ${b}, tol ${tol})`);

// ---------------------------------------------------------------------------
// INDEPENDENT normal CDF — Marsaglia (2004) Taylor series. Nothing to do with
// Abramowitz & Stegun; accurate to ~1e-15 for |z| < 8.
// ---------------------------------------------------------------------------
function PhiStd(z) {
  if (z < -8) return 0;
  if (z > 8) return 1;
  let s = z, t = 0, b = z, q = z * z, i = 1;
  while (s !== t) { t = s; b *= q / (i += 2); s += b; }
  return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178);
}
const Phi = (x, mu = 0, sd = 1) => PhiStd((x - mu) / sd);

console.log("== 1. normal CDF vs an INDEPENDENT implementation ==");
for (const z of [-4, -2.5758293035489, -1.96, -1, -0.3, 0, 0.5, 1, 1.96, 3, 5]) {
  near(normalCdf(z), PhiStd(z), 8e-8, `normalCdf(${z}) matches Marsaglia series`);
}
near(normalCdf(1.959963985), 0.975, 1e-7, "Phi(1.959964) = 0.975 (hand value)");
near(normalCdf(-2.326347874), 0.01, 1e-7, "Phi(-2.3263479) = 0.01 (hand value)");
near(erf(0.5), 0.5204998778130465, 2e-7, "erf(0.5) vs textbook 0.5204998778");
ok(erf(-1.234) === -erf(1.234), "erf is exactly antisymmetric");
near(normalCdf(224.5, 220, 18), PhiStd(0.25), 8e-8, "normalCdf with mean/sd");

console.log("\n== 2. thresholdProbabilities re-derived independently ==");
{
  const mu = 3.4, sd = 13.1;
  const half = thresholdProbabilities(mu, sd, 5.5);
  near(half.over, 1 - Phi(5.5, mu, sd), 1e-7, "half-line over = 1-Phi(5.5)");
  ok(half.push === 0, "half-line push is exactly 0");
  ok(half.over + half.under === 1, "half-line sides sum to EXACTLY 1");
  const whole = thresholdProbabilities(mu, sd, 6);
  near(whole.over, 1 - Phi(6.5, mu, sd), 1e-7, "whole-line over = 1-Phi(6.5)");
  near(whole.push, Phi(6.5, mu, sd) - Phi(5.5, mu, sd), 1e-7, "whole-line push = Phi(6.5)-Phi(5.5)");
  near(whole.under, Phi(5.5, mu, sd), 1e-7, "whole-line under = Phi(5.5)");
  near(whole.over + whole.push + whole.under, 1, 1e-12, "over+push+under = 1");
  ok(whole.over + whole.under < 1, "whole line: two sides sum to LESS than 1");
}

// ---------------------------------------------------------------------------
// 3. THE BIG ONE — end-to-end consistency between the quoted probability and
//    the REAL grader, using an independent discrete convolution.
// ---------------------------------------------------------------------------
console.log("\n== 3. quoted probability == P(real grader says true), independently computed ==");

const pred = {
  gameId: 777,
  date: "2025-12-01",
  homeId: 1,
  awayId: 2,
  expectedMargin: 4.3,
  expectedTotal: 227.4,
  homeWinProbability: 0.631,
  expectedFirstHalfMargin: 2.1,
  expectedFirstHalfTotal: 113.9,
  marginStdDev: 12.6,
  totalStdDev: 19.4,
  confidence: "moderate",
  factors: [],
};

const markets = expandMarkets(pred);
ok(markets.length === 662, `expandMarkets emits 662 rows (got ${markets.length})`);
ok(markets.every((m) => m.probability >= 0 && m.probability <= 1), "all probabilities in [0,1]");
ok(markets.every((m) => m.gameId === 777 && m.date === "2025-12-01"), "ids/dates propagate");

/** Discrete pmf of an integer quantity under the module's own rounded-normal assumption. */
function pmf(mu, sd, lo, hi) {
  const out = new Map();
  for (let k = lo; k <= hi; k++) out.set(k, Phi(k + 0.5, mu, sd) - Phi(k - 0.5, mu, sd));
  return out;
}
/** Build a synthetic finished Game with the fields a given family of markets reads. */
function game(over) {
  return {
    id: 777, date: "2025-12-01", season: 2025, postseason: false,
    homeId: 1, awayId: 2, homeAbbr: "H", awayAbbr: "A",
    homeScore: 0, awayScore: 0,
    homeFirstHalf: 0, awayFirstHalf: 0, homeQ1: 0, awayQ1: 0,
    margin: 0, total: 0, wentToOvertime: false,
    ...over,
  };
}

function checkFamily(name, rows, lo, hi, mu, sd, makeGame) {
  const P = pmf(mu, sd, lo, hi);
  const mass = [...P.values()].reduce((a, b) => a + b, 0);
  ok(mass > 0.999999, `${name}: enumeration covers the distribution (mass ${mass.toFixed(9)})`);
  let worst = 0, worstSel = "";
  for (const m of rows) {
    let p = 0;
    for (const [k, w] of P) {
      if (gradeMarket(m, makeGame(k)).outcome === true) p += w;
    }
    const d = Math.abs(p - m.probability);
    if (d > worst) { worst = d; worstSel = m.selection; }
  }
  ok(worst < 2e-7, `${name}: every quoted probability == P(grader true); worst gap ${worst.toExponential(2)} on "${worstSel}"`);
}

checkFamily("spread (126 rows)", markets.filter((m) => m.market === "spread"),
  -120, 120, pred.expectedMargin, pred.marginStdDev, (k) => game({ margin: k }));

checkFamily("total (242 rows)", markets.filter((m) => m.market === "total"),
  60, 400, pred.expectedTotal, pred.totalStdDev, (k) => game({ total: k }));

checkFamily("1H total (122 rows)", markets.filter((m) => m.market === "first_half_total"),
  -20, 300, pred.expectedFirstHalfTotal, pred.totalStdDev * Math.SQRT1_2,
  (k) => game({ homeFirstHalf: k, awayFirstHalf: 0 }));

checkFamily("1H moneyline", markets.filter((m) => m.market === "first_half_moneyline"),
  -120, 120, pred.expectedFirstHalfMargin, pred.marginStdDev * Math.SQRT1_2,
  (k) => game({ homeFirstHalf: k, awayFirstHalf: 0 }));

checkFamily("Q1 moneyline", markets.filter((m) => m.market === "q1_moneyline"),
  -100, 100, pred.expectedFirstHalfMargin / 2, pred.marginStdDev * 0.5,
  (k) => game({ homeQ1: k, awayQ1: 0 }));

{
  const teamSd = Math.sqrt(pred.totalStdDev ** 2 + pred.marginStdDev ** 2) / 2;
  const homeMean = (pred.expectedTotal + pred.expectedMargin) / 2;
  const awayMean = (pred.expectedTotal - pred.expectedMargin) / 2;
  checkFamily("team total HOME", markets.filter((m) => m.market === "team_total" && m.selection.startsWith("HOME")),
    0, 300, homeMean, teamSd, (k) => game({ homeScore: k }));
  checkFamily("team total AWAY", markets.filter((m) => m.market === "team_total" && m.selection.startsWith("AWAY")),
    0, 300, awayMean, teamSd, (k) => game({ awayScore: k }));
  near(teamSd, Math.sqrt(19.4 ** 2 + 12.6 ** 2) / 2, 1e-12, "team sd = sqrt(sT^2+sM^2)/2 (hand)");
}

// moneyline + overtime, checked directly
{
  const ml = markets.filter((m) => m.market === "moneyline");
  const home = ml.find((m) => m.selection === "HOME ML");
  const away = ml.find((m) => m.selection === "AWAY ML");
  ok(home.probability === 0.631, "HOME ML uses the model's OWN win probability, not 1-Phi(0)");
  ok(home.probability + away.probability === 1, "ML sides sum to exactly 1");
  ok(gradeMarket(home, game({ margin: 7 })).outcome === true, "HOME ML wins when home wins");
  ok(gradeMarket(away, game({ margin: 7 })).outcome === false, "AWAY ML loses when home wins");
  ok(gradeMarket(home, game({ margin: 0 })).outcome === null, "impossible 0 margin grades null, not a guess");

  const otY = markets.find((m) => m.selection === "OVERTIME YES");
  const otN = markets.find((m) => m.selection === "OVERTIME NO");
  near(otY.probability, Phi(0.5, 4.3, 12.6) - Phi(-0.5, 4.3, 12.6), 1e-7, "P(OT) = margin mass at exactly 0");
  ok(otY.probability + otN.probability === 1, "OT sides sum to exactly 1");
  ok(gradeMarket(otY, game({ wentToOvertime: true })).outcome === true, "OT YES grades true on an OT game");
  ok(gradeMarket(otN, game({ wentToOvertime: true })).outcome === false, "OT NO grades false on an OT game");
  ok(otY.probability > 0.02 && otY.probability < 0.05,
    `P(OT) is the KNOWN-BIASED ~3% (got ${otY.probability.toFixed(4)}), real league rate ~6%`);
}

// These pin the two KNOWN incoherences documented in expandMarkets' TSDoc. They
// are not "correct" values — they are the current, disclosed behaviour, asserted
// so that it cannot silently change (in either direction) without a test failing.
console.log("\n== 3b. the disclosed zero-margin incoherences (pinned, not endorsed) ==");
{
  const s = (x) => markets.find((m) => m.selection === x).probability;
  ok(s("HOME +0") + s("AWAY +0") < 1,
    `HOME +0 and AWAY +0 sum to ${(s("HOME +0") + s("AWAY +0")).toFixed(4)} — ~3% parked on an IMPOSSIBLE 0 final margin`);
  const gap = Math.abs(s("HOME ML") - s("HOME +0"));
  ok(gap > 0.005 && gap < 0.05,
    `HOME ML (${s("HOME ML").toFixed(4)}) and HOME +0 (${s("HOME +0").toFixed(4)}) price the SAME event ${gap.toFixed(4)} apart — two mechanisms, disclosed`);
  ok(Math.abs(s("OVERTIME YES") - (1 - s("HOME +0") - s("AWAY +0"))) < 1e-12,
    "P(OT) is exactly that same orphaned 0-margin mass — one assumption, two markets");
}

console.log("\n== 4. push handling: nothing on a half-point line may ever push ==");
{
  // Sweep every plausible finished game against the whole fan-out.
  let halfPointPushes = 0, wholePushes = 0;
  for (let margin = -40; margin <= 40; margin += 7) {
    for (let total = 190; total <= 250; total += 11) {
      const home = (total + margin) / 2, away = (total - margin) / 2;
      if (!Number.isInteger(home)) continue;
      const g = game({
        margin, total, homeScore: home, awayScore: away,
        homeFirstHalf: Math.round(home / 2), awayFirstHalf: Math.round(away / 2),
        homeQ1: Math.round(home / 4), awayQ1: Math.round(away / 4),
      });
      for (const gm of gradeMarkets(markets, g)) {
        if (gm.outcome !== null) continue;
        if (gm.line !== null && !Number.isInteger(gm.line)) halfPointPushes++;
        else wholePushes++;
      }
    }
  }
  ok(halfPointPushes === 0, `no half-point line ever pushed across the whole sweep (got ${halfPointPushes})`);
  ok(wholePushes > 0, `whole-number lines DO push (${wholePushes} pushes seen) — push path is exercised`);
}

console.log("\n== 5. hand-graded cases (112-106, half 58-54, Q1 30-30) ==");
{
  const g = game({
    homeScore: 112, awayScore: 106, margin: 6, total: 218,
    homeFirstHalf: 58, awayFirstHalf: 54, homeQ1: 30, awayQ1: 30,
  });
  const s = (sel) => markets.find((m) => m.selection === sel);
  const grade = (sel) => gradeMarket(s(sel), g).outcome;
  ok(grade("HOME -5.5") === true, "HOME -5.5 wins on a 6-point win");
  ok(grade("HOME -6") === null, "HOME -6 PUSHES on a 6-point win");
  ok(grade("HOME -6.5") === false, "HOME -6.5 loses on a 6-point win");
  ok(grade("AWAY +5.5") === false, "AWAY +5.5 loses on a 6-point win");
  ok(grade("AWAY +6") === null, "AWAY +6 pushes");
  ok(grade("AWAY +6.5") === true, "AWAY +6.5 wins");
  ok(grade("HOME +6") === true, "HOME +6 is a clean WIN, not a push");
  ok(grade("TOTAL OVER 218") === null && grade("TOTAL UNDER 218") === null, "TOTAL 218 pushes both ways");
  ok(grade("TOTAL OVER 217.5") === true && grade("TOTAL UNDER 217.5") === false, "TOTAL 217.5 graded correctly");
  ok(grade("1H TOTAL OVER 112") === null, "1H TOTAL 112 pushes (58+54)");
  ok(grade("1H HOME ML") === true, "1H HOME ML wins 58-54");
  ok(grade("Q1 HOME ML") === null && grade("Q1 AWAY ML") === null, "Q1 tie pushes both sides");
  ok(grade("HOME TEAM TOTAL OVER 111.5") === true, "HOME TEAM TOTAL OVER 111.5 wins on 112");
  ok(grade("AWAY TEAM TOTAL UNDER 106.5") === true, "AWAY TEAM TOTAL UNDER 106.5 wins on 106");
  ok(grade("HOME TEAM TOTAL UNDER 111.5") === false, "HOME TEAM TOTAL UNDER 111.5 loses");

  // missing quarter data
  const noQ = game({ homeScore: 112, awayScore: 106, margin: 6, total: 218,
    homeFirstHalf: null, awayFirstHalf: null, homeQ1: null, awayQ1: null });
  ok(gradeMarket(s("1H HOME ML"), noQ).outcome === null, "missing 1H data grades null");
  ok(gradeMarket(s("Q1 HOME ML"), noQ).outcome === null, "missing Q1 data grades null");
  ok(gradeMarket(s("HOME -5.5"), noQ).outcome === true, "full-game markets still grade without quarter data");
}

console.log("\n== 6. lookahead hunt ==");
{
  ok(expandMarkets.length <= 2, `expandMarkets arity ${expandMarkets.length} — no Game slot`);
  // Attempt a leak: hand expandMarkets a prediction object that ALSO carries the
  // finished game's fields. If any of them are read, probabilities would change.
  const clean = expandMarkets(pred);
  const poisoned = expandMarkets({
    ...pred,
    homeScore: 112, awayScore: 106, margin: 6, total: 218, wentToOvertime: true,
    homeFirstHalf: 58, awayFirstHalf: 54, homeQ1: 30, awayQ1: 30,
    id: 777, actual: game({ margin: 6 }),
  });
  ok(JSON.stringify(clean) === JSON.stringify(poisoned),
    "smuggling result fields into the prediction object changes NOTHING — no hidden reads");

  // Attempt a leak: does gradeMarket ever alter probability?
  const before = markets.map((m) => m.probability);
  const gr = gradeMarkets(markets, game({ margin: 6, total: 218, homeScore: 112, awayScore: 106,
    homeFirstHalf: 58, awayFirstHalf: 54, homeQ1: 30, awayQ1: 30 }));
  ok(gr.every((g, i) => g.probability === before[i]), "gradeMarket copies probability through verbatim");
  ok(markets.every((m, i) => m.probability === before[i]), "gradeMarket does not mutate its input rows");

  // Join integrity
  let threw = false;
  try { gradeMarket(markets[0], game({ id: 999 })); } catch { threw = true; }
  ok(threw, "gameId mismatch THROWS rather than grading against the wrong game");

  let threw2 = false;
  try { gradeMarket({ ...markets[0], market: "spread", selection: "SIDEWAYS 3", line: 3 }, game({})); }
  catch { threw2 = true; }
  ok(threw2, "unrecognized selection throws rather than being guessed");
}

console.log("\n== 7. evaluate() — hand-computed ==");
{
  const row = (p, outcome) => ({ gameId: 1, date: "d", market: "total", selection: "s", line: null, probability: p, outcome });
  // Hand: p=[0.9,0.9,0.1,0.1], y=[1,1,0,0]
  // Brier = (0.01+0.01+0.01+0.01)/4 = 0.01; b=0.5; ref=0.25; BSS = 1-0.04 = 0.96
  const r = evaluate([row(0.9, true), row(0.9, true), row(0.1, false), row(0.1, false)], "hand");
  near(r.brierScore, 0.01, 1e-12, "Brier = 0.01 by hand");
  near(r.brierSkillScore, 0.96, 1e-12, "BSS = 1 - 0.01/0.25 = 0.96 by hand");
  near(r.accuracy, 1, 1e-12, "accuracy = 1");
  near(r.meanAbsoluteError, 0.1, 1e-12, "mean abs prob err = 0.1");

  // Hand #2: p=[0.8,0.8,0.8,0.3], y=[1,1,0,0]
  // Brier = (0.04+0.04+0.64+0.09)/4 = 0.81/4 = 0.2025
  // b = 0.5, ref = 0.25 -> BSS = 1 - 0.81 = 0.19
  const r2 = evaluate([row(0.8, true), row(0.8, true), row(0.8, false), row(0.3, false)], "hand2");
  near(r2.brierScore, 0.2025, 1e-12, "Brier = 0.2025 by hand");
  near(r2.brierSkillScore, 0.19, 1e-12, "BSS = 0.19 by hand");
  near(r2.accuracy, 0.75, 1e-12, "accuracy = 3/4");

  // Hand #3: lopsided base rate, zero-skill constant forecaster.
  // 90 wins @ p=0.9, 10 losses @ p=0.9 -> Brier = (90*0.01 + 10*0.81)/100 = 0.09
  // b=0.9, ref=0.09 -> BSS = 0 exactly.
  const rows3 = [];
  for (let i = 0; i < 90; i++) rows3.push(row(0.9, true));
  for (let i = 0; i < 10; i++) rows3.push(row(0.9, false));
  const r3 = evaluate(rows3, "hand3");
  near(r3.brierScore, 0.09, 1e-12, "Brier = 0.09 by hand (lopsided market)");
  near(r3.brierSkillScore, 0, 1e-12, "BSS = 0 exactly — 0.90 accuracy with ZERO skill");
  near(r3.accuracy, 0.9, 1e-12, "accuracy 0.90 despite no skill (the trap the header warns about)");

  // pushes dropped, not counted as losses
  const withPush = evaluate([row(0.9, true), row(0.9, null), row(0.9, null)], "push");
  ok(withPush.n === 1, "pushes are DROPPED from n, not scored as losses");
  near(withPush.brierScore, 0.01, 1e-12, "push rows contribute nothing to Brier");

  // empty + degenerate
  const empty = evaluate([], "empty");
  ok(Number.isNaN(empty.brierScore) && Number.isNaN(empty.accuracy) && empty.n === 0,
    "empty sample returns NaN, NOT a flattering 0");
  const deg = evaluate([row(0.9, true), row(0.8, true)], "degenerate");
  ok(Number.isNaN(deg.brierSkillScore), "degenerate base rate -> BSS NaN, not 0");

  // inverted forecaster
  const inv = evaluate([row(0, true), row(1, false), row(0, true), row(1, false)], "inverted");
  near(inv.brierScore, 1, 1e-12, "perfectly wrong -> Brier 1");
  near(inv.brierSkillScore, -3, 1e-12, "perfectly wrong -> BSS exactly -3");

  // probability out of range rejected
  let threw = false;
  try { evaluate([row(1.2, true)], "bad"); } catch { threw = true; }
  ok(threw, "out-of-range probability throws");

  // no-profit note present in the rendered report
  ok(formatReport(r).includes("nothing here is a profit, ROI or edge estimate"),
    "formatReport ends with the no-profit disclaimer");
  ok(formatReport(evaluate([], "none")).includes("profit"),
    "even the empty report carries the disclaimer");
}

console.log("\n== 8. continuous scoring ==");
{
  const c = scoreContinuous([{ predicted: 4, actual: 7 }, { predicted: 10, actual: 7 }, { predicted: 7, actual: 7 }], "m");
  near(c.meanAbsoluteError, 2, 1e-12, "MAE = 2 by hand");
  near(c.rootMeanSquaredError, Math.sqrt(6), 1e-12, "RMSE = sqrt(6) by hand");
  near(c.meanError, 0, 1e-12, "bias = 0 by hand");
  let threw = false;
  try { scoreMarginAndTotal([{ prediction: pred, actual: game({ id: 5 }) }]); } catch { threw = true; }
  ok(threw, "scoreMarginAndTotal throws on a misjoined pair");
}

console.log("\n== 9. THE BOTH-SIDES TRAP, reproduced on the real modules ==");
{
  // A market that is genuinely 95/5, forecast with a CONSTANT 0.95 — zero information.
  const rows = [];
  for (let i = 0; i < 950; i++) {
    rows.push({ gameId: 1, date: "d", market: "overtime", selection: "OVERTIME NO", line: null, probability: 0.95, outcome: true });
    rows.push({ gameId: 1, date: "d", market: "overtime", selection: "OVERTIME YES", line: null, probability: 0.05, outcome: false });
  }
  for (let i = 0; i < 50; i++) {
    rows.push({ gameId: 1, date: "d", market: "overtime", selection: "OVERTIME NO", line: null, probability: 0.95, outcome: false });
    rows.push({ gameId: 1, date: "d", market: "overtime", selection: "OVERTIME YES", line: null, probability: 0.05, outcome: true });
  }
  const oneSide = evaluate(rows.filter((r) => r.selection === "OVERTIME NO"), "one side");
  const bothSides = evaluate(rows, "both sides");
  near(oneSide.brierSkillScore, 0, 1e-12, "ONE side of a true-95% market: BSS exactly 0 (correct — no skill)");
  near(bothSides.brierScore, 0.0475, 1e-12, "pooled Brier = 0.0475");
  near(bothSides.brierSkillScore, 0.81, 1e-12, "BOTH sides pooled: BSS +0.81 out of thin air — the documented trap is REAL");
  near(inferBase(bothSides), 0.5, 1e-12, "pooled base rate pinned at exactly 0.5000 (the tell)");
  function inferBase(r) {
    let t = 0, p = 0;
    for (const b of r.calibration) { if (!b.count) continue; t += b.count; p += b.count * b.actualRate; }
    return p / t;
  }
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
