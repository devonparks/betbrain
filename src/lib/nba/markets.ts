import type {
  Game,
  GamePrediction,
  GradedMarket,
  MarketPrediction,
} from "./types.ts";

/**
 * MARKET EXPANSION + GRADING
 * --------------------------
 * One `GamePrediction` fans out into hundreds of independently gradeable
 * propositions (~660 with the default ladders). Ten games a night is ~6,600
 * rows — Devon's "thousands of bets per night".
 *
 * NOTATION
 *   M  = final margin, homeScore - awayScore. Positive = home won.
 *   T  = final total, homeScore + awayScore.
 *   mu = the model's expected value for the quantity in question
 *   s  = the model's standard deviation for that quantity
 *   L  = a book line
 *   h  = a SPREAD HANDICAP in home terms. "HOME -5.5" has h = -5.5 and wins
 *        iff M + h > 0, i.e. iff M > 5.5. "AWAY +5.5" has h = +5.5 and wins
 *        iff (-M) + h > 0, i.e. iff M < 5.5. One rule grades both sides.
 *
 * === HOW THIS FILE CANNOT SEE THE FUTURE ===
 * `expandMarkets` takes a `GamePrediction` and NOTHING ELSE. It has no `Game`
 * parameter, so it is structurally incapable of reading a score, a quarter, or
 * an overtime flag — the type signature is the enforcement mechanism, not a
 * convention. `gradeMarket` is the only function here that touches a finished
 * `Game`, and it copies `probability` through verbatim (`...m`) and only ever
 * ADDS an `outcome` field. There is no code path in which knowing the result
 * can revise a probability. Grading also hard-fails on a gameId mismatch, so a
 * misaligned join is a thrown error rather than a silently flattering number.
 *
 * === ON PUSHES ===
 * Margins and totals are INTEGERS. A half-point line therefore cannot push; a
 * whole-number line can, and the push probability is real mass that must come
 * out of somewhere. `thresholdProbabilities` models it with a continuity
 * correction, so for a whole line P(over) + P(under) < 1 by exactly the modelled
 * push probability. That is not a bug: pretending a whole line is a 50/50
 * two-way market is how you fool yourself.
 */

// ---------------------------------------------------------------------------
// Normal distribution (no dependencies — we implement erf ourselves)
// ---------------------------------------------------------------------------

/**
 * Error function, Abramowitz & Stegun 7.1.26.
 *
 * `erf(x) ~= 1 - (a1*t + a2*t^2 + a3*t^3 + a4*t^4 + a5*t^5) * exp(-x^2)`
 * with `t = 1 / (1 + p*x)`, evaluated on |x| and mirrored (erf is odd), which
 * makes the implementation exactly antisymmetric by construction.
 *
 * **Stated accuracy: |absolute error| <= 1.5e-7 for all real x** (A&S's own
 * bound for this rational-times-Gaussian form). That is ~7.5e-8 on a normal CDF
 * — three orders of magnitude finer than any sports probability is meaningful
 * to, and far below the model error that dominates everything downstream.
 *
 * @param x Any finite real number.
 * @returns erf(x) in (-1, 1).
 * @throws If x is not a finite number.
 */
export function erf(x: number): number {
  assertFinite(x, "erf(x)");
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

/**
 * Normal CDF: P(X <= x) for X ~ Normal(mean, stdDev^2).
 *
 * `Phi(x) = 0.5 * (1 + erf((x - mean) / (stdDev * sqrt(2))))`. Inherits the erf
 * bound above, so |error| <= ~7.5e-8. The result is clamped into [0, 1] because
 * the approximation can overshoot by ~1e-7 in the far tails and a negative
 * probability downstream is worse than a truncated one.
 *
 * @param x Threshold.
 * @param mean Distribution mean.
 * @param stdDev Distribution standard deviation. Must be > 0.
 * @returns P(X <= x), in [0, 1].
 * @throws If any argument is non-finite or stdDev <= 0.
 *
 * @example
 * normalCdf(0);            // 0.5
 * normalCdf(1.96);         // ~0.9750021
 * normalCdf(224.5, 220, 18); // P(total <= 224.5)
 */
export function normalCdf(x: number, mean = 0, stdDev = 1): number {
  assertFinite(x, "normalCdf(x)");
  assertFinite(mean, "normalCdf(mean)");
  assertPositive(stdDev, "normalCdf(stdDev)");
  const z = (x - mean) / (stdDev * Math.SQRT2);
  const p = 0.5 * (1 + erf(z));
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** The three ways a threshold proposition can land. Always sums to 1. */
export interface ThresholdProbabilities {
  /** P(actual > line). */
  over: number;
  /** P(actual == line). Exactly 0 unless `line` is a whole number. */
  push: number;
  /** P(actual < line). */
  under: number;
}

/**
 * Probability that an integer-valued quantity lands over / on / under a line.
 *
 * Half-point line (L not an integer): no integer equals L, so
 * `over = 1 - Phi(L)`, `push = 0`, `under = 1 - over`. Because `under` is
 * computed as `1 - over`, the two sides sum to exactly 1.0 in IEEE-754 (for any
 * p in [0,1], `fl(p + fl(1 - p)) === 1`), which is what makes the
 * complementary-market guarantee an equality and not an approximation.
 *
 * Whole-number line (L an integer): the outcome L itself has real probability
 * mass. Continuity correction assigns it the interval (L-0.5, L+0.5):
 *   `over  = 1 - Phi(L + 0.5)`     (i.e. the quantity reached L+1 or more)
 *   `push  = Phi(L + 0.5) - Phi(L - 0.5)`
 *   `under = 1 - over - push`
 *
 * JUDGMENT CALL: the continuity correction assumes the discrete distribution is
 * a rounded version of the normal. Real NBA margins are lumpier than that (2s
 * and 3s make certain margins more common, and end-game fouling piles mass onto
 * small margins). So `push` is a decent order-of-magnitude estimate, not a
 * precise one. Calibration on whole-number lines will expose the difference.
 *
 * @param mean Expected value of the quantity.
 * @param stdDev Standard deviation. Must be > 0.
 * @param line The line. Whole numbers are pushable; halves are not.
 * @returns Over / push / under probabilities summing to 1.
 * @throws If any argument is non-finite or stdDev <= 0.
 */
export function thresholdProbabilities(
  mean: number,
  stdDev: number,
  line: number
): ThresholdProbabilities {
  assertFinite(mean, "thresholdProbabilities(mean)");
  assertPositive(stdDev, "thresholdProbabilities(stdDev)");
  assertFinite(line, "thresholdProbabilities(line)");

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

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

/**
 * Build an inclusive ladder of lines.
 *
 * Values are rounded to 3 decimals so that floating-point dust can never make a
 * whole number look like a half number — `Number.isInteger` decides whether a
 * line can push, so that distinction has to be exact.
 *
 * @param from First line (inclusive).
 * @param to Last line (inclusive, up to floating tolerance).
 * @param step Positive increment.
 * @returns Ascending array of lines.
 * @throws If arguments are non-finite, step <= 0, or from > to.
 */
export function ladder(from: number, to: number, step: number): number[] {
  assertFinite(from, "ladder(from)");
  assertFinite(to, "ladder(to)");
  assertPositive(step, "ladder(step)");
  if (from > to) throw new Error(`ladder: from (${from}) must be <= to (${to})`);

  const out: number[] = [];
  const n = Math.floor((to - from) / step + 1e-9);
  for (let i = 0; i <= n; i++) {
    out.push(Math.round((from + i * step) * 1000) / 1000);
  }
  return out;
}

/**
 * Home-team spread handicaps, -15.5 to +15.5 in half-point steps.
 *
 * Half-point steps (rather than whole-point) deliberately include BOTH kinds of
 * line: halves that cannot push and whole numbers that can. A ladder of only
 * half-points would never exercise the push path, and pushes are the single
 * easiest thing to silently score as a loss.
 */
export const DEFAULT_SPREAD_LINES: number[] = ladder(-15.5, 15.5, 0.5);

/** Game totals, 190.5 to 250.5 in half-point steps. */
export const DEFAULT_TOTAL_LINES: number[] = ladder(190.5, 250.5, 0.5);

/** First-half totals, 95.5 to 125.5 in half-point steps. */
export const DEFAULT_FIRST_HALF_TOTAL_LINES: number[] = ladder(95.5, 125.5, 0.5);

/** Single-team totals, 95.5 to 135.5 in whole-point steps. */
export const DEFAULT_TEAM_TOTAL_LINES: number[] = ladder(95.5, 135.5, 1);

/** Optional overrides for the ladders `expandMarkets` walks. */
export interface ExpandMarketsOptions {
  /** Home-team spread handicaps. Default {@link DEFAULT_SPREAD_LINES}. */
  spreadLines?: number[];
  /** Game total lines. Default {@link DEFAULT_TOTAL_LINES}. */
  totalLines?: number[];
  /** First-half total lines. Default {@link DEFAULT_FIRST_HALF_TOTAL_LINES}. */
  firstHalfTotalLines?: number[];
  /** Per-team total lines. Default {@link DEFAULT_TEAM_TOTAL_LINES}. */
  teamTotalLines?: number[];
}

// ---------------------------------------------------------------------------
// Sub-game variance scaling (all judgment calls — stated, not hidden)
// ---------------------------------------------------------------------------

/**
 * A half is half a game. Under a random-walk scoring model variance grows
 * linearly with elapsed time, so sd scales by sqrt(1/2) ~= 0.7071.
 *
 * JUDGMENT CALL: real games are not random walks — rotations, momentum and
 * garbage time all break independent increments — so this understates late-game
 * variance and overstates early-game variance somewhat. It is a defensible
 * first cut, not a fitted parameter. If first-half markets calibrate badly
 * while full-game markets calibrate well, this constant is the suspect.
 */
const HALF_SD_SCALE = Math.SQRT1_2;

/** Same reasoning, one quarter: sqrt(1/4) = 0.5. Same caveat, more so. */
const QUARTER_SD_SCALE = 0.5;

// ---------------------------------------------------------------------------
// Selection string format — the contract between expand and grade
// ---------------------------------------------------------------------------
//
// `gradeMarket` parses these back. The format is fixed and exhaustive:
//
//   moneyline             "HOME ML"                     "AWAY ML"
//   spread                "HOME -5.5"                   "AWAY +5.5"
//   total                 "TOTAL OVER 224.5"            "TOTAL UNDER 224.5"
//   first_half_moneyline  "1H HOME ML"                  "1H AWAY ML"
//   first_half_total      "1H TOTAL OVER 112.5"         "1H TOTAL UNDER 112.5"
//   q1_moneyline          "Q1 HOME ML"                  "Q1 AWAY ML"
//   team_total            "HOME TEAM TOTAL OVER 112.5"   (also UNDER / AWAY)
//   overtime              "OVERTIME YES"                "OVERTIME NO"
//
// Grading NEVER guesses: an unrecognized selection throws.

/** Render a line without trailing-zero noise: 5 -> "5", 5.5 -> "5.5". */
function formatLine(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Render a handicap with an explicit sign: -5.5 -> "-5.5", 5.5 -> "+5.5". */
function formatHandicap(n: number): string {
  return n < 0 ? formatLine(n) : `+${formatLine(n)}`;
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/**
 * Fan one pre-tipoff prediction out into every proposition we can grade.
 *
 * Coverage: moneyline (both sides), a spread ladder (both sides of every
 * handicap), a total ladder (over/under), first-half moneyline, a first-half
 * total ladder, Q1 moneyline, both team totals, and overtime yes/no.
 *
 * Derived quantities, all stated so they can be argued with:
 *  - **Full-game moneyline** uses `pred.homeWinProbability` directly rather than
 *    re-deriving it from the margin distribution. The model already produced a
 *    win probability; silently replacing it with `1 - Phi(0)` would be us
 *    grading a different model than the one that made the prediction.
 *  - **First half**: mean from `expectedFirstHalfMargin` / `expectedFirstHalfTotal`,
 *    sd scaled by {@link HALF_SD_SCALE}.
 *  - **Q1**: mean = half the first-half mean (assumes the two quarters of a half
 *    split evenly — a crude assumption), sd scaled by {@link QUARTER_SD_SCALE}.
 *  - **Team totals**: with H, A the two team scores, T = H+A and M = H-A,
 *      Var(T) = Var(H) + Var(A) + 2Cov(H,A)
 *      Var(M) = Var(H) + Var(A) - 2Cov(H,A)
 *    Adding: Var(T) + Var(M) = 2(Var(H) + Var(A)). Assuming the two teams have
 *    equal variance v gives v = (sT^2 + sM^2) / 4, i.e. sd_team =
 *    sqrt(sT^2 + sM^2) / 2. Means are (T +/- M) / 2. This correctly implies
 *    pace-driven correlation between the two team totals.
 *  - **Two known incoherences at a zero margin, disclosed rather than papered
 *    over.** The margin distribution is a rounded normal, so it puts ~3% of its
 *    mass on a FINAL margin of exactly 0 — an outcome the NBA does not have.
 *    Two consequences, both real, both small, neither fudged:
 *      1. `HOME +0` / `AWAY +0` quote `P(M > 0)` and `P(M < 0)`, which sum to
 *         ~0.97. The missing ~3% sits on a push that can never happen, so both
 *         sides are each roughly 1-1.5 points of probability too low. Grading is
 *         unaffected: a 0 margin never occurs, so the push branch is never taken.
 *      2. `HOME +0` and `HOME ML` are the SAME event ("home wins") priced by two
 *         different mechanisms — the margin distribution and the model's own
 *         `homeWinProbability` — so they will not agree (typically by ~1 point).
 *         Forcing them to agree would mean discarding one of the two, and each
 *         is the honest output of the thing that produced it. If you pool the
 *         spread and moneyline slices in one calibration table, expect to see
 *         this; it is arithmetic, not a bug.
 *  - **Overtime**: P(OT) is approximated by the mass the margin distribution
 *    puts on exactly 0, i.e. `thresholdProbabilities(...).push` at line 0.
 *    KNOWN BIAS: this systematically UNDER-predicts overtime. The league rate is
 *    roughly 6%; a normal with sd ~13 puts ~3% on a dead tie, because real
 *    end-game play (fouling, stalling, a two-for-one) concentrates outcomes at
 *    zero far more than a Gaussian does. We ship the honest raw number and let
 *    the calibration curve show the gap rather than hand-tuning a fudge factor.
 *
 * Volume warning: the defaults produce ~660 rows per game, so a 1,230-game
 * season is ~800k rows. A season-long backtest should grade and aggregate a
 * game at a time rather than materialising every row at once; pass narrower
 * ladders via `opts` if memory matters more than coverage.
 *
 * This function does not filter on `pred.confidence`. Callers should exclude
 * `"insufficient"` predictions from any headline evaluation — grading a
 * prediction the model itself disowned inflates or deflates the numbers for no
 * reason.
 *
 * @param pred A prediction built strictly from games that finished before
 *   `pred.date`. Nothing in this function can check that, which is precisely
 *   why it never sees a `Game`.
 * @param opts Optional ladder overrides.
 * @returns Every proposition, each with a probability in [0, 1].
 * @throws If the prediction contains non-finite numbers, a non-positive
 *   standard deviation, a win probability outside [0, 1], or an empty ladder.
 *
 * @example
 * const markets = expandMarkets(pred);
 * markets.length; // ~662 with the default ladders
 */
export function expandMarkets(
  pred: GamePrediction,
  opts: ExpandMarketsOptions = {}
): MarketPrediction[] {
  assertFinite(pred.expectedMargin, "expectedMargin");
  assertFinite(pred.expectedTotal, "expectedTotal");
  assertFinite(pred.expectedFirstHalfMargin, "expectedFirstHalfMargin");
  assertFinite(pred.expectedFirstHalfTotal, "expectedFirstHalfTotal");
  assertPositive(pred.marginStdDev, "marginStdDev");
  assertPositive(pred.totalStdDev, "totalStdDev");
  assertProbability(pred.homeWinProbability, "homeWinProbability");

  const spreadLines = requireLadder(
    opts.spreadLines ?? DEFAULT_SPREAD_LINES,
    "spreadLines"
  );
  const totalLines = requireLadder(
    opts.totalLines ?? DEFAULT_TOTAL_LINES,
    "totalLines"
  );
  const firstHalfTotalLines = requireLadder(
    opts.firstHalfTotalLines ?? DEFAULT_FIRST_HALF_TOTAL_LINES,
    "firstHalfTotalLines"
  );
  const teamTotalLines = requireLadder(
    opts.teamTotalLines ?? DEFAULT_TEAM_TOTAL_LINES,
    "teamTotalLines"
  );

  const { gameId, date } = pred;
  const out: MarketPrediction[] = [];
  const add = (
    market: MarketPrediction["market"],
    selection: string,
    line: number | null,
    probability: number
  ): void => {
    out.push({ gameId, date, market, selection, line, probability });
  };

  // --- moneyline -----------------------------------------------------------
  // The NBA has no ties, so there is no push side here.
  add("moneyline", "HOME ML", null, pred.homeWinProbability);
  add("moneyline", "AWAY ML", null, 1 - pred.homeWinProbability);

  // --- spread --------------------------------------------------------------
  // Handicap h wins for home iff M > -h. As home lays more points (h more
  // negative) that probability falls, so the home ladder is monotone
  // non-decreasing in h. It is only NON-strict because P(M > 5) and P(M > 5.5)
  // are the same event for integer margins — that tie is arithmetic truth, not
  // a modelling artefact.
  for (const h of spreadLines) {
    const p = thresholdProbabilities(pred.expectedMargin, pred.marginStdDev, -h);
    add("spread", `HOME ${formatHandicap(h)}`, h, p.over);
    add("spread", `AWAY ${formatHandicap(-h)}`, -h, p.under);
  }

  // --- total ---------------------------------------------------------------
  for (const L of totalLines) {
    const p = thresholdProbabilities(pred.expectedTotal, pred.totalStdDev, L);
    add("total", `TOTAL OVER ${formatLine(L)}`, L, p.over);
    add("total", `TOTAL UNDER ${formatLine(L)}`, L, p.under);
  }

  // --- first-half moneyline ------------------------------------------------
  // A halftime tie is a genuine push, so these two probabilities intentionally
  // sum to less than 1.
  const halfMarginSd = pred.marginStdDev * HALF_SD_SCALE;
  const halfMl = thresholdProbabilities(
    pred.expectedFirstHalfMargin,
    halfMarginSd,
    0
  );
  add("first_half_moneyline", "1H HOME ML", 0, halfMl.over);
  add("first_half_moneyline", "1H AWAY ML", 0, halfMl.under);

  // --- first-half total ----------------------------------------------------
  const halfTotalSd = pred.totalStdDev * HALF_SD_SCALE;
  for (const L of firstHalfTotalLines) {
    const p = thresholdProbabilities(
      pred.expectedFirstHalfTotal,
      halfTotalSd,
      L
    );
    add("first_half_total", `1H TOTAL OVER ${formatLine(L)}`, L, p.over);
    add("first_half_total", `1H TOTAL UNDER ${formatLine(L)}`, L, p.under);
  }

  // --- Q1 moneyline --------------------------------------------------------
  const q1Ml = thresholdProbabilities(
    pred.expectedFirstHalfMargin / 2,
    pred.marginStdDev * QUARTER_SD_SCALE,
    0
  );
  add("q1_moneyline", "Q1 HOME ML", 0, q1Ml.over);
  add("q1_moneyline", "Q1 AWAY ML", 0, q1Ml.under);

  // --- team totals ---------------------------------------------------------
  const teamSd =
    Math.sqrt(
      pred.totalStdDev * pred.totalStdDev +
        pred.marginStdDev * pred.marginStdDev
    ) / 2;
  const homeMean = (pred.expectedTotal + pred.expectedMargin) / 2;
  const awayMean = (pred.expectedTotal - pred.expectedMargin) / 2;
  for (const L of teamTotalLines) {
    const ph = thresholdProbabilities(homeMean, teamSd, L);
    add("team_total", `HOME TEAM TOTAL OVER ${formatLine(L)}`, L, ph.over);
    add("team_total", `HOME TEAM TOTAL UNDER ${formatLine(L)}`, L, ph.under);
    const pa = thresholdProbabilities(awayMean, teamSd, L);
    add("team_total", `AWAY TEAM TOTAL OVER ${formatLine(L)}`, L, pa.over);
    add("team_total", `AWAY TEAM TOTAL UNDER ${formatLine(L)}`, L, pa.under);
  }

  // --- overtime ------------------------------------------------------------
  const otYes = thresholdProbabilities(
    pred.expectedMargin,
    pred.marginStdDev,
    0
  ).push;
  add("overtime", "OVERTIME YES", null, otYes);
  add("overtime", "OVERTIME NO", null, 1 - otYes);

  return out;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade one proposition against the finished game.
 *
 * `outcome` is `true` if the proposition happened, `false` if it did not, and
 * `null` when it CANNOT be scored:
 *  - a push (the quantity landed exactly on a whole-number line), or
 *  - missing quarter data for a first-half / Q1 market.
 *
 * A push is never quietly scored as a loss, and missing quarter data is never
 * guessed at — both come back `null` and `evaluate` drops them. Half-point lines
 * can never push, so any `null` on a half-point line would be a bug.
 *
 * The probability is copied through untouched. Nothing about the result can
 * feed back into the prediction.
 *
 * @param m A proposition produced by {@link expandMarkets}.
 * @param actual The finished game. Must be the same game.
 * @returns The proposition with `outcome` attached.
 * @throws If `m.gameId !== actual.id` (a misaligned join is a hard error, not a
 *   silently wrong number), if a line-bearing market has a null line, or if the
 *   selection string is not one this module produces.
 *
 * @example
 * gradeMarket({ ..., market: "spread", selection: "HOME -5.5", line: -5.5 },
 *             { ..., margin: 6 }).outcome; // true
 */
export function gradeMarket(m: MarketPrediction, actual: Game): GradedMarket {
  if (m.gameId !== actual.id) {
    throw new Error(
      `gradeMarket: gameId mismatch — market is for game ${m.gameId} but was ` +
        `handed game ${actual.id}. Refusing to grade a prediction against the ` +
        `wrong game.`
    );
  }

  switch (m.market) {
    case "moneyline": {
      const home = requireSide(m, "HOME ML", "AWAY ML");
      // NBA games cannot end tied; a 0 margin means the data is wrong, so
      // refuse to score it rather than inventing a winner.
      if (actual.margin === 0) return withOutcome(m, null);
      return withOutcome(m, home ? actual.margin > 0 : actual.margin < 0);
    }

    case "spread": {
      const line = requireLine(m);
      const home = requirePrefix(m, "HOME ", "AWAY ");
      const teamMargin = home ? actual.margin : -actual.margin;
      // Cover iff teamMargin + line > 0, i.e. teamMargin > -line.
      return withOutcome(m, gradeThreshold(teamMargin, -line, true));
    }

    case "total": {
      const line = requireLine(m);
      const over = requirePrefix(m, "TOTAL OVER ", "TOTAL UNDER ");
      return withOutcome(m, gradeThreshold(actual.total, line, over));
    }

    case "first_half_moneyline": {
      const home = requireSide(m, "1H HOME ML", "1H AWAY ML");
      const half = firstHalfScores(actual);
      if (half === null) return withOutcome(m, null);
      const margin = half.home - half.away;
      // A halftime tie is a real push.
      return withOutcome(m, gradeThreshold(home ? margin : -margin, 0, true));
    }

    case "first_half_total": {
      const line = requireLine(m);
      const over = requirePrefix(m, "1H TOTAL OVER ", "1H TOTAL UNDER ");
      const half = firstHalfScores(actual);
      if (half === null) return withOutcome(m, null);
      return withOutcome(m, gradeThreshold(half.home + half.away, line, over));
    }

    case "q1_moneyline": {
      const home = requireSide(m, "Q1 HOME ML", "Q1 AWAY ML");
      if (actual.homeQ1 === null || actual.awayQ1 === null) {
        return withOutcome(m, null);
      }
      const margin = actual.homeQ1 - actual.awayQ1;
      return withOutcome(m, gradeThreshold(home ? margin : -margin, 0, true));
    }

    case "team_total": {
      const line = requireLine(m);
      const home = requirePrefix(m, "HOME TEAM TOTAL ", "AWAY TEAM TOTAL ");
      // Both prefixes are exactly 16 characters, so OVER/UNDER starts at 16.
      const over = requirePrefix(m, "OVER ", "UNDER ", 16);
      const score = home ? actual.homeScore : actual.awayScore;
      return withOutcome(m, gradeThreshold(score, line, over));
    }

    case "overtime": {
      const yes = requireSide(m, "OVERTIME YES", "OVERTIME NO");
      return withOutcome(m, yes ? actual.wentToOvertime : !actual.wentToOvertime);
    }

    default: {
      // Exhaustiveness: a new MarketType must be handled here, not defaulted.
      const never: never = m.market;
      throw new Error(`gradeMarket: unsupported market type "${String(never)}"`);
    }
  }
}

/**
 * Grade a batch of propositions that all belong to the same finished game.
 *
 * @param markets Propositions from {@link expandMarkets}.
 * @param actual The finished game they were all made for.
 * @returns Graded rows, same order.
 * @throws If any row belongs to a different game.
 */
export function gradeMarkets(
  markets: MarketPrediction[],
  actual: Game
): GradedMarket[] {
  return markets.map((m) => gradeMarket(m, actual));
}

// ---------------------------------------------------------------------------
// Grading internals
// ---------------------------------------------------------------------------

/**
 * Score an integer quantity against a line.
 * Exactly on the line => `null` (push). Only reachable on whole-number lines.
 */
function gradeThreshold(
  actualValue: number,
  line: number,
  over: boolean
): boolean | null {
  const diff = actualValue - line;
  if (diff === 0) return null;
  return over ? diff > 0 : diff < 0;
}

/** First-half scores, or null when quarter data is missing (never guessed). */
function firstHalfScores(
  actual: Game
): { home: number; away: number } | null {
  if (actual.homeFirstHalf === null || actual.awayFirstHalf === null) {
    return null;
  }
  return { home: actual.homeFirstHalf, away: actual.awayFirstHalf };
}

function withOutcome(m: MarketPrediction, outcome: boolean | null): GradedMarket {
  return { ...m, outcome };
}

/** Exact-match selection: returns true for the first form, false for the second. */
function requireSide(m: MarketPrediction, first: string, second: string): boolean {
  if (m.selection === first) return true;
  if (m.selection === second) return false;
  throw new Error(
    `gradeMarket: unrecognized ${m.market} selection "${m.selection}" ` +
      `(expected "${first}" or "${second}")`
  );
}

/** Prefix-match selection: true for the first prefix, false for the second. */
function requirePrefix(
  m: MarketPrediction,
  first: string,
  second: string,
  offset = 0
): boolean {
  const s = m.selection.slice(offset);
  if (s.startsWith(first)) return true;
  if (s.startsWith(second)) return false;
  throw new Error(
    `gradeMarket: unrecognized ${m.market} selection "${m.selection}" ` +
      `(expected to start with "${first}" or "${second}")`
  );
}

function requireLine(m: MarketPrediction): number {
  if (m.line === null || !Number.isFinite(m.line)) {
    throw new Error(
      `gradeMarket: ${m.market} selection "${m.selection}" has no usable line ` +
        `(got ${String(m.line)})`
    );
  }
  return m.line;
}

// ---------------------------------------------------------------------------
// Input guards (same posture as src/lib/hedge.ts: fail loudly, never coerce)
// ---------------------------------------------------------------------------

function assertFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number (got ${String(value)})`);
  }
}

function assertPositive(value: number, label: string): void {
  assertFinite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than 0 (got ${value})`);
}

function assertProbability(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1 (got ${value})`);
  }
}

function requireLadder(lines: number[], label: string): number[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error(`${label} must be a non-empty array of lines`);
  }
  for (const l of lines) assertFinite(l, `${label} entry`);
  return lines;
}
