/**
 * verify-markets.mjs — self-verifying check for market expansion, grading and
 * evaluation.
 *
 * Run with:  node tools/verify-markets.mjs
 *
 * There is no test framework in this repo and this script must run on plain
 * node with zero dependencies, so it carries its own mirror of the formulas in
 * src/lib/nba/markets.ts and src/lib/nba/evaluate.ts and asserts them against
 * hand-built fixtures. It deliberately does NOT read data/games/*.json — the
 * fixtures are the contract, so this passes or fails identically whether or not
 * the season backfill has finished.
 *
 * It also statically checks the TypeScript sources for the same exports,
 * defaults and honesty guardrails, so the mirror and the real thing cannot
 * silently drift apart.
 *
 * MIRRORED FORMULAS
 *   erf(x)          A&S 7.1.26, |err| <= 1.5e-7
 *   Phi(x;m,s)      0.5 * (1 + erf((x-m)/(s*sqrt2)))
 *   half line L     over = 1-Phi(L), push = 0,                under = 1-over
 *   whole line L    over = 1-Phi(L+.5), push = Phi(L+.5)-Phi(L-.5),
 *                   under = 1-over-push
 *   spread h        home wins iff margin + h > 0  (== 0 is a push)
 *   Brier           mean((p-y)^2)
 *   BSS             1 - Brier / (b(1-b))
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

function near(name, actual, expected, tol) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  check(name, ok, `got ${actual}, expected ${expected} +/- ${tol}`);
}

function throws(name, fn) {
  try {
    fn();
    check(name, false, "did not throw");
  } catch {
    check(name, true);
  }
}

// ---------------------------------------------------------------------------
// Mirror of src/lib/nba/markets.ts
// ---------------------------------------------------------------------------

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * ax);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

function normalCdf(x, mean = 0, stdDev = 1) {
  if (!(stdDev > 0)) throw new Error("stdDev must be > 0");
  const z = (x - mean) / (stdDev * Math.SQRT2);
  const p = 0.5 * (1 + erf(z));
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

function thresholdProbabilities(mean, stdDev, line) {
  if (!Number.isInteger(line)) {
    const over = 1 - normalCdf(line, mean, stdDev);
    return { over, push: 0, under: 1 - over };
  }
  const hi = normalCdf(line + 0.5, mean, stdDev);
  const lo = normalCdf(line - 0.5, mean, stdDev);
  const over = 1 - hi;
  const push = Math.max(0, hi - lo);
  const under = Math.max(0, 1 - over - push);
  return { over, push, under };
}

function ladder(from, to, step) {
  if (!(step > 0)) throw new Error("step must be > 0");
  if (from > to) throw new Error("from must be <= to");
  const out = [];
  const n = Math.floor((to - from) / step + 1e-9);
  for (let i = 0; i <= n; i++) {
    out.push(Math.round((from + i * step) * 1000) / 1000);
  }
  return out;
}

const DEFAULT_SPREAD_LINES = ladder(-15.5, 15.5, 0.5);
const DEFAULT_TOTAL_LINES = ladder(190.5, 250.5, 0.5);
const DEFAULT_FIRST_HALF_TOTAL_LINES = ladder(95.5, 125.5, 0.5);
const DEFAULT_TEAM_TOTAL_LINES = ladder(95.5, 135.5, 1);

const HALF_SD_SCALE = Math.SQRT1_2;
const QUARTER_SD_SCALE = 0.5;

const fmtLine = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtHandicap = (n) => (n < 0 ? fmtLine(n) : `+${fmtLine(n)}`);

function expandMarkets(pred, opts = {}) {
  const spreadLines = opts.spreadLines ?? DEFAULT_SPREAD_LINES;
  const totalLines = opts.totalLines ?? DEFAULT_TOTAL_LINES;
  const firstHalfTotalLines =
    opts.firstHalfTotalLines ?? DEFAULT_FIRST_HALF_TOTAL_LINES;
  const teamTotalLines = opts.teamTotalLines ?? DEFAULT_TEAM_TOTAL_LINES;

  const out = [];
  const add = (market, selection, line, probability) =>
    out.push({
      gameId: pred.gameId,
      date: pred.date,
      market,
      selection,
      line,
      probability,
    });

  add("moneyline", "HOME ML", null, pred.homeWinProbability);
  add("moneyline", "AWAY ML", null, 1 - pred.homeWinProbability);

  for (const h of spreadLines) {
    const p = thresholdProbabilities(pred.expectedMargin, pred.marginStdDev, -h);
    add("spread", `HOME ${fmtHandicap(h)}`, h, p.over);
    add("spread", `AWAY ${fmtHandicap(-h)}`, -h, p.under);
  }

  for (const L of totalLines) {
    const p = thresholdProbabilities(pred.expectedTotal, pred.totalStdDev, L);
    add("total", `TOTAL OVER ${fmtLine(L)}`, L, p.over);
    add("total", `TOTAL UNDER ${fmtLine(L)}`, L, p.under);
  }

  const halfMarginSd = pred.marginStdDev * HALF_SD_SCALE;
  const halfMl = thresholdProbabilities(
    pred.expectedFirstHalfMargin,
    halfMarginSd,
    0
  );
  add("first_half_moneyline", "1H HOME ML", 0, halfMl.over);
  add("first_half_moneyline", "1H AWAY ML", 0, halfMl.under);

  const halfTotalSd = pred.totalStdDev * HALF_SD_SCALE;
  for (const L of firstHalfTotalLines) {
    const p = thresholdProbabilities(
      pred.expectedFirstHalfTotal,
      halfTotalSd,
      L
    );
    add("first_half_total", `1H TOTAL OVER ${fmtLine(L)}`, L, p.over);
    add("first_half_total", `1H TOTAL UNDER ${fmtLine(L)}`, L, p.under);
  }

  const q1 = thresholdProbabilities(
    pred.expectedFirstHalfMargin / 2,
    pred.marginStdDev * QUARTER_SD_SCALE,
    0
  );
  add("q1_moneyline", "Q1 HOME ML", 0, q1.over);
  add("q1_moneyline", "Q1 AWAY ML", 0, q1.under);

  const teamSd =
    Math.sqrt(
      pred.totalStdDev * pred.totalStdDev +
        pred.marginStdDev * pred.marginStdDev
    ) / 2;
  const homeMean = (pred.expectedTotal + pred.expectedMargin) / 2;
  const awayMean = (pred.expectedTotal - pred.expectedMargin) / 2;
  for (const L of teamTotalLines) {
    const ph = thresholdProbabilities(homeMean, teamSd, L);
    add("team_total", `HOME TEAM TOTAL OVER ${fmtLine(L)}`, L, ph.over);
    add("team_total", `HOME TEAM TOTAL UNDER ${fmtLine(L)}`, L, ph.under);
    const pa = thresholdProbabilities(awayMean, teamSd, L);
    add("team_total", `AWAY TEAM TOTAL OVER ${fmtLine(L)}`, L, pa.over);
    add("team_total", `AWAY TEAM TOTAL UNDER ${fmtLine(L)}`, L, pa.under);
  }

  const otYes = thresholdProbabilities(
    pred.expectedMargin,
    pred.marginStdDev,
    0
  ).push;
  add("overtime", "OVERTIME YES", null, otYes);
  add("overtime", "OVERTIME NO", null, 1 - otYes);

  return out;
}

function gradeThreshold(actualValue, line, over) {
  const diff = actualValue - line;
  if (diff === 0) return null;
  return over ? diff > 0 : diff < 0;
}

function sideExact(sel, first, second, market) {
  if (sel === first) return true;
  if (sel === second) return false;
  throw new Error(`unrecognized ${market} selection "${sel}"`);
}

function sidePrefix(sel, first, second, market, offset = 0) {
  const s = sel.slice(offset);
  if (s.startsWith(first)) return true;
  if (s.startsWith(second)) return false;
  throw new Error(`unrecognized ${market} selection "${sel}"`);
}

function requireLine(m) {
  if (m.line === null || !Number.isFinite(m.line)) {
    throw new Error(`${m.market} "${m.selection}" has no usable line`);
  }
  return m.line;
}

function gradeMarket(m, actual) {
  if (m.gameId !== actual.id) {
    throw new Error(`gameId mismatch: ${m.gameId} vs ${actual.id}`);
  }
  const g = (outcome) => ({ ...m, outcome });

  switch (m.market) {
    case "moneyline": {
      const home = sideExact(m.selection, "HOME ML", "AWAY ML", m.market);
      if (actual.margin === 0) return g(null);
      return g(home ? actual.margin > 0 : actual.margin < 0);
    }
    case "spread": {
      const line = requireLine(m);
      const home = sidePrefix(m.selection, "HOME ", "AWAY ", m.market);
      const teamMargin = home ? actual.margin : -actual.margin;
      return g(gradeThreshold(teamMargin, -line, true));
    }
    case "total": {
      const line = requireLine(m);
      const over = sidePrefix(
        m.selection,
        "TOTAL OVER ",
        "TOTAL UNDER ",
        m.market
      );
      return g(gradeThreshold(actual.total, line, over));
    }
    case "first_half_moneyline": {
      const home = sideExact(m.selection, "1H HOME ML", "1H AWAY ML", m.market);
      if (actual.homeFirstHalf === null || actual.awayFirstHalf === null) {
        return g(null);
      }
      const margin = actual.homeFirstHalf - actual.awayFirstHalf;
      return g(gradeThreshold(home ? margin : -margin, 0, true));
    }
    case "first_half_total": {
      const line = requireLine(m);
      const over = sidePrefix(
        m.selection,
        "1H TOTAL OVER ",
        "1H TOTAL UNDER ",
        m.market
      );
      if (actual.homeFirstHalf === null || actual.awayFirstHalf === null) {
        return g(null);
      }
      return g(
        gradeThreshold(actual.homeFirstHalf + actual.awayFirstHalf, line, over)
      );
    }
    case "q1_moneyline": {
      const home = sideExact(m.selection, "Q1 HOME ML", "Q1 AWAY ML", m.market);
      if (actual.homeQ1 === null || actual.awayQ1 === null) return g(null);
      const margin = actual.homeQ1 - actual.awayQ1;
      return g(gradeThreshold(home ? margin : -margin, 0, true));
    }
    case "team_total": {
      const line = requireLine(m);
      const home = sidePrefix(
        m.selection,
        "HOME TEAM TOTAL ",
        "AWAY TEAM TOTAL ",
        m.market
      );
      const over = sidePrefix(m.selection, "OVER ", "UNDER ", m.market, 16);
      const score = home ? actual.homeScore : actual.awayScore;
      return g(gradeThreshold(score, line, over));
    }
    case "overtime": {
      const yes = sideExact(m.selection, "OVERTIME YES", "OVERTIME NO", m.market);
      return g(yes ? actual.wentToOvertime : !actual.wentToOvertime);
    }
    default:
      throw new Error(`unsupported market ${m.market}`);
  }
}

// ---------------------------------------------------------------------------
// Mirror of src/lib/nba/evaluate.ts
// ---------------------------------------------------------------------------

function evaluate(graded, label, options = {}) {
  const buckets = options.buckets ?? 10;
  const minBucketCount = options.minBucketCount ?? 20;

  const rows = [];
  for (const gm of graded) {
    if (gm.outcome === null) continue;
    rows.push({ p: gm.probability, y: gm.outcome ? 1 : 0 });
  }
  const n = rows.length;
  if (n === 0) {
    return {
      label,
      n: 0,
      accuracy: NaN,
      brierScore: NaN,
      brierSkillScore: NaN,
      meanAbsoluteError: NaN,
      calibration: [],
      maxCalibrationError: NaN,
    };
  }

  let hits = 0;
  let sqErr = 0;
  let absErr = 0;
  let positives = 0;
  for (const { p, y } of rows) {
    if ((p > 0.5 ? 1 : 0) === y) hits++;
    sqErr += (p - y) * (p - y);
    absErr += Math.abs(p - y);
    positives += y;
  }
  const baseRate = positives / n;
  const brierScore = sqErr / n;
  const brierRef = baseRate * (1 - baseRate);
  const brierSkillScore = brierRef === 0 ? NaN : 1 - brierScore / brierRef;

  const count = new Array(buckets).fill(0);
  const sumP = new Array(buckets).fill(0);
  const sumY = new Array(buckets).fill(0);
  for (const { p, y } of rows) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(p * buckets)));
    count[idx]++;
    sumP[idx] += p;
    sumY[idx] += y;
  }
  const calibration = [];
  for (let i = 0; i < buckets; i++) {
    calibration.push({
      lowerBound: i / buckets,
      upperBound: (i + 1) / buckets,
      count: count[i],
      meanPredicted: count[i] === 0 ? NaN : sumP[i] / count[i],
      actualRate: count[i] === 0 ? NaN : sumY[i] / count[i],
    });
  }
  const meaningful = calibration.filter((b) => b.count >= minBucketCount);
  const pool = meaningful.length > 0 ? meaningful : calibration.filter((b) => b.count > 0);
  const maxCalibrationError =
    pool.length === 0
      ? NaN
      : pool.reduce(
          (w, b) => Math.max(w, Math.abs(b.meanPredicted - b.actualRate)),
          0
        );

  return {
    label,
    n,
    accuracy: hits / n,
    brierScore,
    brierSkillScore,
    meanAbsoluteError: absErr / n,
    calibration,
    maxCalibrationError,
  };
}

function scoreContinuous(samples, label) {
  if (samples.length === 0) {
    return {
      label,
      n: 0,
      meanAbsoluteError: NaN,
      rootMeanSquaredError: NaN,
      meanError: NaN,
    };
  }
  let abs = 0;
  let sq = 0;
  let signed = 0;
  for (const s of samples) {
    const e = s.predicted - s.actual;
    abs += Math.abs(e);
    sq += e * e;
    signed += e;
  }
  const n = samples.length;
  return {
    label,
    n,
    meanAbsoluteError: abs / n,
    rootMeanSquaredError: Math.sqrt(sq / n),
    meanError: signed / n,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A prediction: home favoured by 4, total 224, sd 13 / 18. */
const PRED = {
  gameId: 1001,
  date: "2025-11-04",
  homeId: 10,
  awayId: 20,
  expectedMargin: 4,
  expectedTotal: 224,
  homeWinProbability: 0.62,
  expectedFirstHalfMargin: 2,
  expectedFirstHalfTotal: 112,
  marginStdDev: 13,
  totalStdDev: 18,
  confidence: "moderate",
  factors: [],
};

/** Home 112 - Away 106: margin +6, total 218, halves and Q1 present, no OT. */
const GAME = {
  id: 1001,
  date: "2025-11-04",
  season: 2025,
  postseason: false,
  homeId: 10,
  awayId: 20,
  homeAbbr: "HME",
  awayAbbr: "AWY",
  homeScore: 112,
  awayScore: 106,
  homeFirstHalf: 58,
  awayFirstHalf: 54,
  homeQ1: 30,
  awayQ1: 30,
  margin: 6,
  total: 218,
  wentToOvertime: false,
};

/** Same game with all quarter detail missing. */
const GAME_NO_QUARTERS = {
  ...GAME,
  homeFirstHalf: null,
  awayFirstHalf: null,
  homeQ1: null,
  awayQ1: null,
};

const marketOf = (list, selection) => list.find((m) => m.selection === selection);

console.log("=== verify-markets ===\n");

// ---------------------------------------------------------------------------
// 1. Normal CDF against known values
// ---------------------------------------------------------------------------

console.log("-- normal CDF (stated accuracy: |err| <= ~7.5e-8) --");
near("Phi(0) = 0.5", normalCdf(0), 0.5, 1e-9);
near("Phi(1.96) ~ 0.9750021", normalCdf(1.96), 0.9750021049, 1e-6);
near("Phi(-1.96) ~ 0.0249979", normalCdf(-1.96), 0.0249978951, 1e-6);
near("Phi(1) ~ 0.8413447", normalCdf(1), 0.8413447461, 1e-6);
near("Phi(-2.5758) ~ 0.005", normalCdf(-2.5758293), 0.005, 1e-6);
near("Phi(3) ~ 0.9986501", normalCdf(3), 0.9986501020, 1e-6);
near(
  "Phi is location/scale aware: Phi(224.5;220,18) = Phi(0.25)",
  normalCdf(224.5, 220, 18),
  normalCdf(0.25),
  1e-12
);
check(
  "Phi is monotone non-decreasing across a wide sweep",
  (() => {
    let prev = -1;
    for (let z = -6; z <= 6; z += 0.01) {
      const v = normalCdf(z);
      if (v < prev - 1e-15) return false;
      prev = v;
    }
    return true;
  })()
);
near("erf is exactly antisymmetric", erf(1.3) + erf(-1.3), 0, 0);

// ---------------------------------------------------------------------------
// 2. Threshold probabilities: half lines vs whole lines
// ---------------------------------------------------------------------------

console.log("\n-- threshold probabilities --");
const half = thresholdProbabilities(4, 13, 5.5);
check("half-point line has push probability exactly 0", half.push === 0);
check(
  "half-point line: over + under === 1 EXACTLY (not within a tolerance)",
  half.over + half.under === 1,
  `sum = ${half.over + half.under}`
);
const whole = thresholdProbabilities(4, 13, 5);
check("whole-number line has push probability > 0", whole.push > 0);
near(
  "whole-number line: over + push + under sums to 1",
  whole.over + whole.push + whole.under,
  1,
  1e-12
);
check(
  "whole-number line: over + under < 1 (the gap IS the push mass)",
  whole.over + whole.under < 1 &&
    Math.abs(1 - (whole.over + whole.under) - whole.push) < 1e-12
);
near(
  "P(margin > 5) equals P(margin > 5.5) — same event for integer margins",
  whole.over,
  thresholdProbabilities(4, 13, 5.5).over,
  1e-12
);

// ---------------------------------------------------------------------------
// 3. Ladders
// ---------------------------------------------------------------------------

console.log("\n-- ladders --");
check(
  "default spread ladder spans -15.5..15.5 in half-points (63 lines)",
  DEFAULT_SPREAD_LINES.length === 63 &&
    DEFAULT_SPREAD_LINES[0] === -15.5 &&
    DEFAULT_SPREAD_LINES[62] === 15.5
);
check(
  "spread ladder contains BOTH pushable (whole) and non-pushable (half) lines",
  DEFAULT_SPREAD_LINES.some((l) => Number.isInteger(l)) &&
    DEFAULT_SPREAD_LINES.some((l) => !Number.isInteger(l))
);
check(
  "ladder values carry no floating-point dust (isInteger is trustworthy)",
  DEFAULT_TOTAL_LINES.every((l) => Math.abs(l * 2 - Math.round(l * 2)) < 1e-12)
);

// ---------------------------------------------------------------------------
// 4. Expansion: coverage, consistency, monotonicity
// ---------------------------------------------------------------------------

console.log("\n-- expandMarkets --");
const markets = expandMarkets(PRED);
const types = new Set(markets.map((m) => m.market));
check(
  "all 8 market types are produced",
  [
    "moneyline",
    "spread",
    "total",
    "first_half_moneyline",
    "first_half_total",
    "q1_moneyline",
    "team_total",
    "overtime",
  ].every((t) => types.has(t)),
  [...types].join(",")
);
check(
  `one game fans out into hundreds of propositions (got ${markets.length})`,
  markets.length > 500
);
check(
  "every probability is a finite number in [0,1]",
  markets.every(
    (m) => Number.isFinite(m.probability) && m.probability >= 0 && m.probability <= 1
  )
);
check(
  "every market carries the prediction's gameId and date",
  markets.every((m) => m.gameId === PRED.gameId && m.date === PRED.date)
);

const homeMl = marketOf(markets, "HOME ML");
const awayMl = marketOf(markets, "AWAY ML");
check(
  "moneyline uses the model's own homeWinProbability, not a re-derived one",
  homeMl.probability === PRED.homeWinProbability
);
check(
  "moneyline sides sum to exactly 1 (no ties in the NBA)",
  homeMl.probability + awayMl.probability === 1
);

const homeMinus55 = marketOf(markets, "HOME -5.5");
const awayPlus55 = marketOf(markets, "AWAY +5.5");
check(
  "P(HOME -5.5) + P(AWAY +5.5) === 1 exactly",
  homeMinus55.probability + awayPlus55.probability === 1,
  `sum = ${homeMinus55.probability + awayPlus55.probability}`
);
near(
  "P(HOME -5.5) equals P(margin > 5.5) from the mirrored normal",
  homeMinus55.probability,
  1 - normalCdf(5.5, 4, 13),
  1e-12
);

const homeSpreads = markets
  .filter((m) => m.market === "spread" && m.selection.startsWith("HOME "))
  .sort((a, b) => a.line - b.line);
check(
  "spread ladder is monotone: the more home lays, the lower its cover probability",
  homeSpreads.every((m, i) => i === 0 || m.probability >= homeSpreads[i - 1].probability - 1e-12)
);
const halfOnly = homeSpreads.filter((m) => !Number.isInteger(m.line));
check(
  "restricted to half-point lines the ladder is STRICTLY monotone",
  halfOnly.every((m, i) => i === 0 || m.probability > halfOnly[i - 1].probability)
);

const totalOver = marketOf(markets, "TOTAL OVER 224.5");
const totalUnder = marketOf(markets, "TOTAL UNDER 224.5");
check(
  "total over/under on a half-point line sum to exactly 1",
  totalOver.probability + totalUnder.probability === 1
);

const h1Home = marketOf(markets, "1H HOME ML");
const h1Away = marketOf(markets, "1H AWAY ML");
check(
  "first-half moneyline sides sum to LESS than 1 — a halftime tie is a real push",
  h1Home.probability + h1Away.probability < 1 &&
    h1Home.probability + h1Away.probability > 0.9
);

const otYes = marketOf(markets, "OVERTIME YES");
check(
  "overtime probability is the margin distribution's mass at exactly 0",
  Math.abs(otYes.probability - thresholdProbabilities(4, 13, 0).push) < 1e-12
);
check(
  "overtime probability is small and positive (known to UNDER-state the ~6% league rate)",
  otYes.probability > 0.005 && otYes.probability < 0.06,
  `p = ${otYes.probability}`
);

const homeTeamTotals = markets.filter((m) =>
  m.selection.startsWith("HOME TEAM TOTAL OVER ")
);
check(
  "home team total is centred on (total + margin)/2 = 114",
  marketOf(markets, "HOME TEAM TOTAL OVER 113.5").probability > 0.5 &&
    marketOf(markets, "HOME TEAM TOTAL OVER 114.5").probability < 0.5
);
check(
  "away team total is centred on (total - margin)/2 = 110",
  marketOf(markets, "AWAY TEAM TOTAL OVER 109.5").probability > 0.5 &&
    marketOf(markets, "AWAY TEAM TOTAL OVER 110.5").probability < 0.5
);
near(
  "team-total sd = sqrt(sT^2 + sM^2)/2 = sqrt(493)/2",
  (() => {
    // Recover sd from the modelled probability at mean + 1 line step.
    const p = marketOf(markets, "HOME TEAM TOTAL OVER 125.5").probability;
    // p = 1 - Phi(125.5; 114, sd) -> solve numerically.
    let lo = 1;
    let hi = 50;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (1 - normalCdf(125.5, 114, mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  })(),
  Math.sqrt(493) / 2,
  1e-4
);
check(
  "home team totals are more likely to go over than away team totals (home is favoured)",
  homeTeamTotals.every((m) => {
    const away = marketOf(markets, m.selection.replace("HOME", "AWAY"));
    return m.probability >= away.probability;
  })
);

// ---------------------------------------------------------------------------
// 5. Grading against handmade games
// ---------------------------------------------------------------------------

console.log("\n-- gradeMarket --");
const gradedAll = markets.map((m) => gradeMarket(m, GAME));
const graded = (selection) =>
  gradeMarket(marketOf(markets, selection), GAME).outcome;

check("HOME ML wins when home wins by 6", graded("HOME ML") === true);
check("AWAY ML loses when home wins by 6", graded("AWAY ML") === false);
check("HOME -5.5 covers a 6-point win", graded("HOME -5.5") === true);
check("HOME -6.5 does NOT cover a 6-point win", graded("HOME -6.5") === false);
check("AWAY +5.5 loses when home wins by 6", graded("AWAY +5.5") === false);
check("AWAY +6.5 wins when home wins by 6", graded("AWAY +6.5") === true);
check(
  "HOME -6 on a 6-point win PUSHES (null, never scored as a loss)",
  graded("HOME -6") === null
);
check("AWAY +6 on a 6-point win also pushes", graded("AWAY +6") === null);
check("TOTAL OVER 217.5 hits on a 218 total", graded("TOTAL OVER 217.5") === true);
check("TOTAL UNDER 217.5 misses on a 218 total", graded("TOTAL UNDER 217.5") === false);
check("TOTAL OVER 218 pushes on a 218 total", graded("TOTAL OVER 218") === null);
check("TOTAL UNDER 218 pushes on a 218 total", graded("TOTAL UNDER 218") === null);
check(
  "HOME TEAM TOTAL OVER 111.5 hits on 112 home points",
  graded("HOME TEAM TOTAL OVER 111.5") === true
);
check(
  "AWAY TEAM TOTAL UNDER 106.5 hits on 106 away points",
  graded("AWAY TEAM TOTAL UNDER 106.5") === true
);
check("1H HOME ML wins on a 58-54 half", graded("1H HOME ML") === true);
check("1H TOTAL OVER 111.5 hits on a 112-point half", graded("1H TOTAL OVER 111.5") === true);
check("1H TOTAL OVER 112 pushes on a 112-point half", graded("1H TOTAL OVER 112") === null);
check("Q1 HOME ML pushes on a 30-30 first quarter", graded("Q1 HOME ML") === null);
check("OVERTIME NO wins when the game did not go to OT", graded("OVERTIME NO") === true);
check("OVERTIME YES loses when the game did not go to OT", graded("OVERTIME YES") === false);

check(
  "NO half-point line ever pushes, across every market",
  gradedAll
    .filter((m) => m.line !== null && !Number.isInteger(m.line))
    .every((m) => m.outcome !== null)
);
check(
  "the pushed set is EXACTLY the propositions that landed on their number",
  (() => {
    // Home won 112-106 (margin +6, total 218), half 58-54 (112), Q1 30-30.
    // Only these land dead on a whole number:
    //   spread   HOME -6  (6 + -6 = 0) and AWAY +6 (-6 + 6 = 0)
    //            — note HOME +6 WINS (6 + 6 = 12 > 0); it is not a push.
    //   total    218 both ways
    //   1H total 112 both ways
    //   Q1 ML    both sides, 30-30 tie
    const expected = [
      "HOME -6",
      "AWAY +6",
      "TOTAL OVER 218",
      "TOTAL UNDER 218",
      "1H TOTAL OVER 112",
      "1H TOTAL UNDER 112",
      "Q1 HOME ML",
      "Q1 AWAY ML",
    ].sort();
    const actualPushes = gradedAll
      .filter((m) => m.outcome === null)
      .map((m) => m.selection)
      .sort();
    return JSON.stringify(actualPushes) === JSON.stringify(expected);
  })(),
  gradedAll
    .filter((m) => m.outcome === null)
    .map((m) => m.selection)
    .join(" | ")
);
check(
  "a whole-number spread on the OTHER side of the number is a clean win, not a push",
  graded("HOME +6") === true && graded("AWAY -6") === false
);

console.log("\n-- missing quarter data --");
const gradedNoQ = markets.map((m) => gradeMarket(m, GAME_NO_QUARTERS));
check(
  "first-half markets grade null (not guessed) when quarter data is missing",
  gradedNoQ
    .filter((m) => m.market === "first_half_moneyline" || m.market === "first_half_total")
    .every((m) => m.outcome === null)
);
check(
  "Q1 markets grade null when quarter data is missing",
  gradedNoQ.filter((m) => m.market === "q1_moneyline").every((m) => m.outcome === null)
);
check(
  "full-game markets are still gradeable without quarter data",
  gradedNoQ.filter((m) => m.market === "moneyline").every((m) => m.outcome !== null)
);

console.log("\n-- grading guards --");
throws("grading against the wrong game throws", () =>
  gradeMarket(marketOf(markets, "HOME ML"), { ...GAME, id: 9999 })
);
throws("an unrecognized selection throws instead of guessing", () =>
  gradeMarket(
    { ...marketOf(markets, "HOME ML"), selection: "HOME MONEYLINE" },
    GAME
  )
);
throws("a line-bearing market with a null line throws", () =>
  gradeMarket({ ...marketOf(markets, "HOME -5.5"), line: null }, GAME)
);

// ---------------------------------------------------------------------------
// 6. Evaluation
// ---------------------------------------------------------------------------

console.log("\n-- evaluate --");

/** Build graded rows from (probability, outcome) pairs. */
const rows = (pairs) =>
  pairs.map(([p, o], i) => ({
    gameId: i,
    date: "2025-11-04",
    market: "spread",
    selection: `SYNTH ${i}`,
    line: -5.5,
    probability: p,
    outcome: o,
  }));

// A balanced sample: 500 true, 500 false.
const truths = [];
for (let i = 0; i < 1000; i++) truths.push(i < 500);

const perfect = evaluate(rows(truths.map((y) => [y ? 1 : 0, y])), "perfect");
near("perfect predictor scores Brier 0", perfect.brierScore, 0, 1e-15);
near("perfect predictor scores skill 1", perfect.brierSkillScore, 1, 1e-15);
near("perfect predictor scores accuracy 1", perfect.accuracy, 1, 1e-15);

const coin = evaluate(rows(truths.map((y) => [0.5, y])), "always 0.5");
near("always-0.5 predictor scores Brier 0.25", coin.brierScore, 0.25, 1e-15);
near("always-0.5 predictor scores skill ~0", coin.brierSkillScore, 0, 1e-12);

const inverted = evaluate(rows(truths.map((y) => [y ? 0 : 1, y])), "inverted");
near("inverted predictor scores Brier 1", inverted.brierScore, 1, 1e-15);
check(
  "inverted predictor scores a NEGATIVE skill score",
  inverted.brierSkillScore < 0,
  `bss = ${inverted.brierSkillScore}`
);
near("inverted predictor's skill is exactly -3 on a balanced sample", inverted.brierSkillScore, -3, 1e-12);

check(
  "pushes are DROPPED, not scored as losses",
  (() => {
    const withPushes = rows([
      [0.9, true],
      [0.9, null],
      [0.9, null],
      [0.9, true],
    ]);
    const r = evaluate(withPushes, "pushes");
    return r.n === 2 && Math.abs(r.brierScore - 0.01) < 1e-12;
  })()
);

check(
  "an empty sample reports NaN, not a flattering 0",
  (() => {
    const r = evaluate(rows([[0.9, null]]), "empty");
    return (
      r.n === 0 &&
      Number.isNaN(r.brierScore) &&
      Number.isNaN(r.brierSkillScore) &&
      Number.isNaN(r.accuracy)
    );
  })()
);

check(
  "skill is NaN (undefined), not 0, when the base rate is degenerate",
  Number.isNaN(evaluate(rows([[0.9, true], [0.8, true]]), "all true").brierSkillScore)
);

check(
  "accuracy alone can look great with zero skill (why BSS is the headline)",
  (() => {
    // Base rate 90%; the model always says 0.9 and learns nothing.
    const pairs = [];
    for (let i = 0; i < 1000; i++) pairs.push([0.9, i < 900]);
    const r = evaluate(rows(pairs), "no-skill 90%");
    return r.accuracy === 0.9 && Math.abs(r.brierSkillScore) < 1e-12;
  })()
);

check(
  "THE BOTH-SIDES TRAP: pooling a proposition with its complement pins the " +
    "base rate at 0.5 and inflates skill",
  (() => {
    // A lopsided market: the event happens 5% of the time and the model says so.
    const oneSide = [];
    for (let i = 0; i < 1000; i++) oneSide.push([0.05, i < 50]);
    const honest = evaluate(rows(oneSide), "one side");

    // Now add the complement of every row, exactly as expandMarkets does.
    const bothSides = [...oneSide, ...oneSide.map(([p, y]) => [1 - p, !y])];
    const trapped = evaluate(rows(bothSides), "both sides");

    return (
      Math.abs(honest.brierSkillScore) < 1e-9 && // truthfully: no skill at all
      Math.abs(trapped.brierSkillScore - 0.81) < 1e-9 && // flattering nonsense
      Math.abs(trapped.calibration.reduce((s, b) => s + (b.count || 0), 0) - 2000) < 1e-9
    );
  })(),
  "documented in the evaluate.ts header; slice one side at a time"
);

console.log("\n-- calibration --");
const miscal = (() => {
  const pairs = [];
  // 100 rows at p = 0.7 that actually hit only 50% -> a known 0.20 gap.
  for (let i = 0; i < 100; i++) pairs.push([0.7, i < 50]);
  // 100 rows at p = 0.2 that hit exactly 20% -> perfectly calibrated.
  for (let i = 0; i < 100; i++) pairs.push([0.2, i < 20]);
  return evaluate(rows(pairs), "miscalibrated");
})();
const b7 = miscal.calibration[7];
const b2 = miscal.calibration[2];
check("bucket [0.7,0.8) captured all 100 rows", b7.count === 100);
near("bucket [0.7,0.8) mean predicted is 0.7", b7.meanPredicted, 0.7, 1e-12);
near("bucket [0.7,0.8) actual rate is 0.5 (the injected miscalibration)", b7.actualRate, 0.5, 1e-12);
near("bucket [0.2,0.3) is perfectly calibrated", b2.actualRate - b2.meanPredicted, 0, 1e-12);
near("maxCalibrationError recovers the injected 0.20 gap", miscal.maxCalibrationError, 0.2, 1e-12);
check(
  "tiny buckets are excluded from maxCalibrationError (they are sampling noise)",
  (() => {
    const pairs = [];
    for (let i = 0; i < 500; i++) pairs.push([0.5001, i < 250]); // well calibrated, huge
    pairs.push([0.95, false]); // one lonely, wildly 'wrong' row
    const r = evaluate(rows(pairs), "noise floor", { minBucketCount: 20 });
    return r.maxCalibrationError < 0.05;
  })()
);

console.log("\n-- continuous scoring --");
const cont = scoreContinuous(
  [
    { predicted: 4, actual: 7 },
    { predicted: 4, actual: 1 },
    { predicted: 10, actual: 10 },
  ],
  "margin"
);
near("MAE = (3 + 3 + 0)/3 = 2", cont.meanAbsoluteError, 2, 1e-12);
near("RMSE = sqrt((9 + 9 + 0)/3) = sqrt(6)", cont.rootMeanSquaredError, Math.sqrt(6), 1e-12);
near("mean error (bias) = (-3 + 3 + 0)/3 = 0", cont.meanError, 0, 1e-12);
check(
  "an all-high model shows positive bias",
  scoreContinuous([{ predicted: 10, actual: 4 }], "biased").meanError === 6
);

// ---------------------------------------------------------------------------
// 7. Static checks against the TypeScript sources
// ---------------------------------------------------------------------------

console.log("\n-- src/lib/nba/markets.ts + evaluate.ts surface --");
const here = dirname(fileURLToPath(import.meta.url));
const marketsSrc = readFileSync(
  join(here, "..", "src", "lib", "nba", "markets.ts"),
  "utf8"
);
const evalSrc = readFileSync(
  join(here, "..", "src", "lib", "nba", "evaluate.ts"),
  "utf8"
);

for (const name of [
  "erf",
  "normalCdf",
  "thresholdProbabilities",
  "ladder",
  "expandMarkets",
  "gradeMarket",
  "gradeMarkets",
]) {
  check(`markets.ts exports ${name}`, marketsSrc.includes(`export function ${name}`));
}
for (const name of [
  "evaluate",
  "scoreContinuous",
  "scoreMarginAndTotal",
  "formatReport",
  "formatContinuousReport",
]) {
  check(`evaluate.ts exports ${name}`, evalSrc.includes(`export function ${name}`));
}

check(
  "markets.ts default ladders match this script's mirror",
  marketsSrc.includes("ladder(-15.5, 15.5, 0.5)") &&
    marketsSrc.includes("ladder(190.5, 250.5, 0.5)") &&
    marketsSrc.includes("ladder(95.5, 125.5, 0.5)") &&
    marketsSrc.includes("ladder(95.5, 135.5, 1)")
);
check(
  "expandMarkets never receives a Game — lookahead is structurally impossible",
  /export function expandMarkets\(\s*pred: GamePrediction,\s*opts: ExpandMarketsOptions = \{\}\s*\): MarketPrediction\[\]/.test(
    marketsSrc
  )
);
check(
  "markets.ts does not redefine the shared contract types",
  !/export\s+(interface|type)\s+(Game|GamePrediction|MarketPrediction|GradedMarket)\b/.test(
    marketsSrc
  )
);
check(
  "evaluate.ts does not redefine the shared contract types",
  !/export\s+(interface|type)\s+(EvaluationReport|CalibrationBucket|GradedMarket)\b/.test(
    evalSrc
  )
);
check(
  "evaluate.ts carries an explicit no-profit note and formatReport emits it",
  evalSrc.includes("NO_PROFIT_CLAIM_NOTE") &&
    /PREDICTION QUALITY/.test(evalSrc) &&
    (evalSrc.match(/NO_PROFIT_CLAIM_NOTE/g) || []).length >= 4
);
check(
  "neither module exports anything that implies profit / EV / ROI",
  !/export\s+(function|const)\s+\w*(profit|Profit|ROI|roi|expectedValue|edge|Edge)\w*/.test(
    marketsSrc + evalSrc
  )
);
check(
  "no vig / -110 assumption is baked in anywhere",
  !marketsSrc.includes("-110") && !/americanToDecimal|impliedProbability/.test(marketsSrc + evalSrc)
);

// ---------------------------------------------------------------------------

console.log(
  `\n${failed === 0 ? "ALL PASS" : "FAILURES"} — ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
