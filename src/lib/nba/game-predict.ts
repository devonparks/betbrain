import type { GamePrediction, PredictionFactor, RatingSnapshot, TeamRating } from "./types.ts";
import {
  ELO_BASELINE,
  ELO_HOME_ADVANTAGE,
  ELO_PER_POINT,
  FIRST_HALF_MARGIN_SHARE,
  FIRST_HALF_TOTAL_SHARE,
  eloExpectedScore,
  type RecentForm,
} from "./ratings.ts";

/**
 * PRE-TIPOFF GAME PREDICTION
 * -------------------------
 * Turns a `RatingSnapshot` into the numbers every downstream market is derived from:
 * an expected margin, an expected total, a win probability, their first-half counterparts,
 * and the two standard deviations that convert all of that into threshold probabilities.
 *
 * THE NO-LOOKAHEAD GUARANTEE — how it is mechanically enforced here
 *   This module cannot leak on its own because it never sees a `Game`. Its only inputs are
 *   a snapshot (built by `ratings.ts` exclusively from earlier games) and a context of
 *   pre-tipoff facts. There is no code path that can reach a score.
 *
 *   The one way a CALLER could leak is by handing over a snapshot built too late — a
 *   snapshot stamped 2021-12-05 used to predict a game on 2021-12-01 has already absorbed
 *   four days of results including the game itself. `predictGame` therefore asserts
 *   `context.date >= snapshot.asOf` and throws otherwise. Since `asOf` is exclusive, that
 *   inequality is exactly the statement "the snapshot saw nothing on or after game day".
 *   It is a hard throw, not a warning: a silent leak is worse than a crashed backtest.
 *
 * NOTATION
 *   dE  = effective Elo difference, home perspective (strength + home court + rest)
 *   m   = expected margin  = dE / 28
 *   T   = expected total
 *   L   = league-average points per team per game
 *
 * ⚠️ `homeWinProbability` AND `marginStdDev` DESCRIBE DIFFERENT DISTRIBUTIONS. READ THIS
 * BEFORE USING BOTH IN THE SAME BREATH.
 *
 * The win probability is the Elo logistic, `1 / (1 + 10^(-m*28/400))`. On the points scale
 * that is a logistic with scale s = 400 / (28 * ln 10) = 6.204, whose standard deviation is
 * s*pi/sqrt(3) = 11.25 points. But `marginStdDev` ships as 14.4 — the measured residual
 * spread. So the object hands out two mutually inconsistent statements about how uncertain
 * the same margin is, and the logistic is the SHARPER of the two.
 *
 * The size of the disagreement, measured over 1,166 walk-forward 2021 predictions:
 * `homeWinProbability` and `1 - Phi(0 | m, marginStdDev)` — literally the same event, "the
 * home team wins" — differ by a mean of 4.6 and a maximum of 7.8 percentage points. Anything
 * downstream that prices a moneyline one way and a 0-handicap spread the other WILL show
 * this, and it is not rounding.
 *
 * This is NOT a claim that the logistic is wrong. Measured, it is the better of the two:
 * with the home-court constant corrected to its measured value, Brier over 1,166 games is
 * 0.22021 for the logistic against 0.22223 for `Phi(m / marginStdDev)`, and a sweep of the
 * Elo-per-point conversion (28 / 24 / 22 / 20 / 18 / 16, implying margin SDs of 11.3 through
 * 19.7) found 28 to be the best of them. Real margins are fatter-tailed than a normal, which
 * is exactly why the well-fitting logistic implies a narrower SD than the measured one.
 *
 * What is wrong is only ever pretending the two agree. Pick one mechanism per market and say
 * which; do not average them, and do not "reconcile" them by shrinking `marginStdDev` to
 * 11.25, because 11.25 is not how far this model actually misses by.
 *
 * EVERY CONSTANT BELOW IS A TUNABLE JUDGMENT CALL. Where a number was measured, the sample
 * it was measured on is named. Where it was not, the comment says so outright.
 */

// ============================================================================
// Tunable constants
// ============================================================================

/**
 * Residual standard deviation of the margin — actual minus predicted, NOT the raw spread
 * of final margins.
 *
 * Measured at 14.39 over the 1,166 walk-forward predictions this model could make on
 * `data/games/2021.json` — every game where both teams had 10+ games of evidence, each
 * predicted from a snapshot as-of its own date, with rest adjustments applied.
 *
 * For scale: the unconditional SD of final margins in that same file is 15.32, and a
 * sportsbook's residual against the closing spread is nearer 12.5-13. Ours sits between,
 * which is the honest position for a ratings-only model with no injury, lineup, or travel
 * information. Do not shrink it to make probabilities look sharper.
 *
 * CONFIRMED ON THE FULL BACKFILL: 14.218 over 5,833 walk-forward predictions across all five
 * season files. The 2021-only figure was not a fluke, and 14.4 is a fair shipped value.
 * Note the margin residual carries a -1.66 point bias over that same sample (see
 * `ELO_HOME_ADVANTAGE`); this SD is measured about that bias, not about zero.
 */
export const DEFAULT_MARGIN_STD_DEV = 14.4;

/**
 * Residual standard deviation of the total. Measured at 18.32 on the same 1,166 predictions
 * (bias +0.05, i.e. essentially unbiased).
 */
export const DEFAULT_TOTAL_STD_DEV = 18.3;

/**
 * Residual SD of the first-half margin. Measured at 11.29 on the same sample (bias -1.09,
 * which is the home-court bias below flowing through the first-half share).
 * Exported because `GamePrediction` has no field for it and the market layer needs it to
 * price first-half spreads.
 */
export const DEFAULT_FIRST_HALF_MARGIN_STD_DEV = 11.3;

/** Residual SD of the first-half total. Measured at 12.56 on the same sample (bias -0.02). */
export const DEFAULT_FIRST_HALF_TOTAL_STD_DEV = 12.6;

/**
 * Games of evidence required before a rating is trusted at full weight. Below this the
 * strength gap is damped and confidence is reported as "insufficient".
 *
 * Because `TeamRating.gamesPlayed` is counted per season (see `ratings.ts`), this makes
 * roughly the first ten games of every October come back as insufficient. That is intended.
 * JUDGMENT CALL — 10 is a round number, not a derived threshold.
 */
export const MIN_GAMES_FOR_FULL_WEIGHT = 10;

/** Games of evidence for "low" -> "moderate". JUDGMENT CALL. */
export const MODERATE_CONFIDENCE_GAMES = 25;

/** Games of evidence for "moderate" -> "high". JUDGMENT CALL. */
export const HIGH_CONFIDENCE_GAMES = 50;

/**
 * Points a team loses for playing on zero days' rest (a back-to-back).
 *
 * Partially measured, and honestly not well. Pooling both directions in
 * `data/games/2021.json` gives about -2.2 points, but the two halves of that pool disagree
 * badly — a home team on a back-to-back underperformed by 4.9 points (n=124) while an away
 * team on one underperformed by only 0.5 (n=200). With a residual SD of ~14.5 those cells
 * carry standard errors above 1 point each, so the split is not something one season can
 * resolve. Published estimates cluster at 1.5-2.0 points.
 *
 * -1.8 is a deliberately conservative middle. RE-FIT THIS on the full backfill before
 * leaning on rest as a signal.
 */
export const REST_BACK_TO_BACK_PENALTY = -1.8;

/**
 * Points gained for three or more days off (two days off gets half of it).
 * NOT MEASURED — the 2021 file has too few long-rest games to say anything. It is set small
 * on the reasoning that rest beyond the normal one day off has little further upside, which
 * is an assumption, not a finding.
 */
export const REST_EXTENDED_BONUS = 0.3;

// ============================================================================
// Context
// ============================================================================

/**
 * Everything known about a matchup before tipoff that is not already in the snapshot.
 *
 * Every field here is required to be a PRE-TIPOFF fact. `ratings.ts` provides
 * `restDaysBefore` and `computeRecentForm`, both of which filter on `date < gameDate`
 * strictly — use them rather than hand-rolling, because a `<=` in that filter is precisely
 * the bug this whole design exists to prevent.
 */
export interface PredictionContext {
  gameId: number;
  /** "YYYY-MM-DD" of the game. Must be >= `snapshot.asOf` or `predictGame` throws. */
  date: string;
  /** Days off before this game; 0 = back-to-back. Null/undefined = unknown, treated as neutral. */
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  /** Display-only recent form. Carries no points impact — see `predictGame`. */
  homeRecentForm?: RecentForm | null;
  awayRecentForm?: RecentForm | null;
  /** Team codes for human-readable factor text. Default "HOME"/"AWAY". */
  homeAbbr?: string;
  awayAbbr?: string;
  /** True for a neutral floor: home-court advantage is dropped entirely. */
  neutralSite?: boolean;
  /**
   * Override the home-court edge, in Elo. Provide this once you have re-fit it with
   * `estimateHomeAdvantageElo` — the shipped default of 100 is known to be ~2x too high
   * for the modern NBA (measured 55 Elo over 6,177 regular-season games).
   *
   * PASS THE SAME VALUE TO THE RATING FOLD. `new RatingEngine({ homeAdvantageElo })` /
   * `buildRatingTimeline(games, { homeAdvantageElo })` use it to decide how much of a home
   * team's scoring to discount when updating offense/defense. Setting it here only, which
   * is what the plumbing allowed before, leaves the ratings adjusted for a 3.57-point home
   * court while the predictor prices a 1.96-point one.
   */
  homeAdvantageElo?: number;
  /** Override the dispersion, e.g. with the output of `estimateDispersion` on your own data. */
  marginStdDev?: number;
  totalStdDev?: number;
}

// ============================================================================
// Prediction
// ============================================================================

/** A team with no rating yet: dead average, and zero evidence behind it. */
function placeholderRating(teamId: number, leagueAvgPoints: number): TeamRating {
  return {
    teamId,
    elo: ELO_BASELINE,
    offense: leagueAvgPoints,
    defense: leagueAvgPoints,
    gamesPlayed: 0,
  };
}

/**
 * Points of edge attributable to rest. 1 day off is the modal case and is the baseline (0).
 *
 * @param restDays Days off, or null/undefined when unknown.
 * @returns A signed points adjustment; 0 when rest is unknown, so an unknown never invents
 *   an edge in either direction.
 */
export function restImpact(restDays: number | null | undefined): number {
  if (typeof restDays !== "number" || !Number.isFinite(restDays)) return 0;
  if (restDays <= 0) return REST_BACK_TO_BACK_PENALTY;
  if (restDays === 1) return 0;
  if (restDays === 2) return REST_EXTENDED_BONUS / 2;
  return REST_EXTENDED_BONUS;
}

/**
 * Predict a game from a snapshot that has provably not seen it.
 *
 * The margin and the win probability are deliberately derived from the SAME effective Elo
 * difference, so they can never disagree — a 7-point favourite always carries the win
 * probability that a 7-point edge implies. The total comes from the offense/defense ratings
 * instead, which is a genuinely separate estimate.
 *
 * Team totals should be derived downstream as `(T + m) / 2` and `(T - m) / 2` rather than
 * from the ratings' own scoring split, so that every market stays consistent with the two
 * headline numbers.
 *
 * THIN DATA: when either team has fewer than `MIN_GAMES_FOR_FULL_WEIGHT` games this season,
 * the strength gap is damped toward zero in proportion to the evidence available, and
 * `confidence` is "insufficient". Home court and rest are NOT damped — they do not depend on
 * having rated the teams. So an early-October prediction degrades to "the home team is
 * favoured by home court and rest, and we do not yet know anything else", which is the true
 * state of knowledge rather than a confident-looking number.
 *
 * @param snapshot League ratings as of a date at or before the game.
 * @param homeId Home team id.
 * @param awayId Away team id.
 * @param context Pre-tipoff facts. `context.date` must be >= `snapshot.asOf`.
 * @returns The full prediction, including the factor breakdown the UI renders.
 * @throws If `homeId === awayId`, or if `context.date < snapshot.asOf` (a lookahead leak).
 *
 * @example
 * const snap = snapshotAsOf(timeline, game.date)!;
 * predictGame(snap, game.homeId, game.awayId, { gameId: game.id, date: game.date });
 */
export function predictGame(
  snapshot: RatingSnapshot,
  homeId: number,
  awayId: number,
  context: PredictionContext
): GamePrediction {
  if (homeId === awayId) {
    throw new Error(`homeId and awayId must differ (both were ${homeId})`);
  }
  // THE LOOKAHEAD GUARD. `asOf` is exclusive, so date >= asOf means the snapshot contains
  // nothing from game day or later. A snapshot from AFTER the game has already seen it.
  if (context.date < snapshot.asOf) {
    throw new Error(
      `LOOKAHEAD: cannot predict a game on ${context.date} with a snapshot as-of ` +
        `${snapshot.asOf} — that snapshot already contains games from on or after game day.`
    );
  }

  const L = snapshot.leagueAvgPoints;
  const home = snapshot.ratings.get(homeId) ?? placeholderRating(homeId, L);
  const away = snapshot.ratings.get(awayId) ?? placeholderRating(awayId, L);
  const homeAbbr = context.homeAbbr ?? "HOME";
  const awayAbbr = context.awayAbbr ?? "AWAY";

  // --- evidence weight
  const evidence = Math.min(home.gamesPlayed, away.gamesPlayed);
  const strengthWeight = Math.min(evidence / MIN_GAMES_FOR_FULL_WEIGHT, 1);

  // --- the three margin components, in points
  const rawStrengthPoints = (home.elo - away.elo) / ELO_PER_POINT;
  const strengthPoints = rawStrengthPoints * strengthWeight;
  const homeAdvantageElo = context.neutralSite
    ? 0
    : context.homeAdvantageElo ?? ELO_HOME_ADVANTAGE;
  const homeCourtPoints = homeAdvantageElo / ELO_PER_POINT;
  const restPoints = restImpact(context.homeRestDays) - restImpact(context.awayRestDays);

  const expectedMargin = strengthPoints + homeCourtPoints + restPoints;
  // Same number, expressed back in Elo, so probability and margin cannot drift apart.
  const homeWinProbability = eloExpectedScore(expectedMargin * ELO_PER_POINT);

  // --- total: O[h] + O[a] + D[h] + D[a] - 2L
  //
  // Expanding: expected home points = O[h] + (D[a] - L), expected away points = O[a] +
  // (D[h] - L). Each team's own offense is credited, then adjusted by how much better or
  // worse than average the opponent's defense is. The home scoring bonus cancels out of the
  // sum, so the total is the same at a neutral site. Two league-average teams give exactly 2L.
  const expectedTotal = home.offense + away.offense + (home.defense - L) + (away.defense - L);

  // --- first half, from empirically measured shares rather than an assumed 50/50 split
  const expectedFirstHalfMargin = expectedMargin * FIRST_HALF_MARGIN_SHARE;
  const expectedFirstHalfTotal = expectedTotal * FIRST_HALF_TOTAL_SHARE;

  const factors = buildFactors({
    homeAbbr,
    awayAbbr,
    home,
    away,
    evidence,
    strengthWeight,
    rawStrengthPoints,
    strengthPoints,
    homeCourtPoints,
    restPoints,
    expectedTotal,
    leagueAvgPoints: L,
    neutralSite: Boolean(context.neutralSite),
    homeRestDays: context.homeRestDays,
    awayRestDays: context.awayRestDays,
    homeRecentForm: context.homeRecentForm,
    awayRecentForm: context.awayRecentForm,
  });

  return {
    gameId: context.gameId,
    date: context.date,
    homeId,
    awayId,
    expectedMargin,
    expectedTotal,
    homeWinProbability,
    expectedFirstHalfMargin,
    expectedFirstHalfTotal,
    marginStdDev: context.marginStdDev ?? DEFAULT_MARGIN_STD_DEV,
    totalStdDev: context.totalStdDev ?? DEFAULT_TOTAL_STD_DEV,
    confidence: gradeConfidence(evidence),
    factors,
  };
}

/**
 * Map games of evidence onto the confidence ladder.
 *
 * @param evidence The smaller of the two teams' `gamesPlayed`.
 * @returns "insufficient" below `MIN_GAMES_FOR_FULL_WEIGHT`, then low / moderate / high.
 */
export function gradeConfidence(evidence: number): GamePrediction["confidence"] {
  if (evidence < MIN_GAMES_FOR_FULL_WEIGHT) return "insufficient";
  if (evidence < MODERATE_CONFIDENCE_GAMES) return "low";
  if (evidence < HIGH_CONFIDENCE_GAMES) return "moderate";
  return "high";
}

/** Format a signed points value the way a human reads a spread. */
function signed(points: number): string {
  return `${points >= 0 ? "+" : "-"}${Math.abs(points).toFixed(1)}`;
}

/**
 * Build the factor list.
 *
 * INVARIANT, asserted in tools/verify-ratings.mjs: the `pointsImpact` values that are
 * present sum to `expectedMargin`. The factor list is a genuine decomposition of the
 * prediction, not a pile of decorative talking points — if a factor carries a number, that
 * number is really in the forecast.
 *
 * Which is why RECENT FORM CARRIES NO `pointsImpact`. Every one of those recent games
 * already moved the Elo rating; attaching points to it again would double-count it and
 * inflate the apparent evidence behind a pick. It is shown because Devon wants to see it,
 * and labelled as already counted.
 */
function buildFactors(input: {
  homeAbbr: string;
  awayAbbr: string;
  home: TeamRating;
  away: TeamRating;
  evidence: number;
  strengthWeight: number;
  rawStrengthPoints: number;
  strengthPoints: number;
  homeCourtPoints: number;
  restPoints: number;
  expectedTotal: number;
  leagueAvgPoints: number;
  neutralSite: boolean;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  homeRecentForm?: RecentForm | null;
  awayRecentForm?: RecentForm | null;
}): PredictionFactor[] {
  const {
    homeAbbr,
    awayAbbr,
    home,
    away,
    evidence,
    strengthWeight,
    rawStrengthPoints,
    strengthPoints,
    homeCourtPoints,
    restPoints,
    expectedTotal,
    leagueAvgPoints,
    neutralSite,
  } = input;
  const factors: PredictionFactor[] = [];

  // 1. Team strength (the damped value is the one that is really in the forecast)
  const stronger = rawStrengthPoints >= 0 ? homeAbbr : awayAbbr;
  const eloGap = Math.abs(home.elo - away.elo);
  factors.push({
    label: "Team strength",
    detail:
      `${homeAbbr} ${Math.round(home.elo)} vs ${awayAbbr} ${Math.round(away.elo)} Elo — ` +
      `${stronger} is ${eloGap.toFixed(0)} points stronger, worth ` +
      `${Math.abs(rawStrengthPoints).toFixed(1)} points of margin` +
      (strengthWeight < 1
        ? `, damped to ${Math.round(strengthWeight * 100)}% on ${evidence} games of evidence`
        : ""),
    pointsImpact: strengthPoints,
  });

  // 2. Home court
  factors.push({
    label: "Home court",
    detail: neutralSite
      ? "Neutral floor — no home-court edge applied"
      : `${homeAbbr} is at home, worth ${homeCourtPoints.toFixed(1)} points at the ` +
        `currently configured home-court setting`,
    pointsImpact: homeCourtPoints,
  });

  // 3. Rest — only claimed when at least one side's rest is actually known
  const homeRestKnown = typeof input.homeRestDays === "number";
  const awayRestKnown = typeof input.awayRestDays === "number";
  if (homeRestKnown || awayRestKnown) {
    factors.push({
      label: "Rest",
      detail:
        `${homeAbbr} ${describeRest(input.homeRestDays)}, ` +
        `${awayAbbr} ${describeRest(input.awayRestDays)}` +
        (restPoints === 0 ? " — no net edge" : ` — ${signed(restPoints)} to ${homeAbbr}`),
      pointsImpact: restPoints,
    });
  }

  // 4. Recent form — DISPLAY ONLY, deliberately no pointsImpact (already inside Elo)
  const homeForm = input.homeRecentForm;
  const awayForm = input.awayRecentForm;
  if ((homeForm && homeForm.games > 0) || (awayForm && awayForm.games > 0)) {
    factors.push({
      label: "Recent form",
      detail:
        `${homeAbbr} ${describeForm(homeForm)}, ${awayAbbr} ${describeForm(awayForm)}. ` +
        `Already reflected in the Elo ratings above — not counted again here.`,
    });
  }

  // 5. Scoring profile — explains the total, which is not a margin driver
  const pace = expectedTotal - 2 * leagueAvgPoints;
  factors.push({
    label: "Scoring profile",
    detail:
      `Projected total ${expectedTotal.toFixed(1)} against a league average of ` +
      `${(2 * leagueAvgPoints).toFixed(1)} (${signed(pace)}). ` +
      `${homeAbbr} offense ${home.offense.toFixed(1)} / defense ${home.defense.toFixed(1)}, ` +
      `${awayAbbr} offense ${away.offense.toFixed(1)} / defense ${away.defense.toFixed(1)}.`,
  });

  // 6. The honesty factor — fires exactly when confidence is "insufficient"
  if (strengthWeight < 1) {
    factors.push({
      label: "Insufficient evidence",
      detail:
        `Only ${evidence} game${evidence === 1 ? "" : "s"} of ratings history for the ` +
        `thinner-rated side this season. The strength gap has been damped to ` +
        `${Math.round(strengthWeight * 100)}% and this projection should not be trusted ` +
        `as a number — it is closer to "we do not know yet".`,
    });
  }

  return factors;
}

/** Plain-English rest description. */
function describeRest(restDays: number | null | undefined): string {
  if (typeof restDays !== "number" || !Number.isFinite(restDays)) return "rest unknown";
  if (restDays <= 0) return "on a back-to-back";
  if (restDays === 1) return "on 1 day of rest";
  return `on ${restDays} days of rest`;
}

/** Plain-English recent-form description. */
function describeForm(form: RecentForm | null | undefined): string {
  if (!form || form.games === 0) return "no recent games on record";
  return (
    `${form.wins}-${form.games - form.wins} in its last ${form.games} ` +
    `(${signed(form.pointDiffPerGame)} per game)`
  );
}

// ============================================================================
// Dispersion
// ============================================================================

/** One graded prediction: what was forecast, and what happened. */
export interface DispersionSample {
  expectedMargin: number;
  actualMargin: number;
  expectedTotal: number;
  actualTotal: number;
}

/** Measured spread and systematic error of a set of graded predictions. */
export interface DispersionEstimate {
  n: number;
  /** SD of the margin residual ABOUT ITS MEAN — bias excluded on purpose. */
  marginStdDev: number;
  totalStdDev: number;
  /** Mean residual (actual - predicted). Non-zero = the model is systematically off. */
  marginBias: number;
  totalBias: number;
  /** Root mean squared error, which DOES include the bias. rmse^2 = sd^2 + bias^2. */
  marginRmse: number;
  totalRmse: number;
}

/**
 * Estimate the dispersion that drives every threshold probability downstream.
 *
 * It takes graded RESIDUALS rather than a `Game[]`, and that is a deliberate refusal. The
 * unconditional spread of final margins (15.32 on `data/games/2021.json`) is the wrong
 * number: it contains variance the ratings can actually explain, so using it would widen
 * every interval and understate the model. The right number is how far the model misses by,
 * which requires knowing what the model said. Build the samples walk-forward — one per game,
 * each predicted from a snapshot as-of that game's date — and pass them here.
 *
 * Bias is reported SEPARATELY from the standard deviation rather than being absorbed into
 * it. Folding a systematic error into the spread makes a model that is consistently wrong in
 * one direction look merely uncertain, which is the exact self-flattery this tool exists to
 * prevent. `rmse^2 ~= sd^2 + bias^2` — check that the bias term is small before trusting the
 * sd. That relation is APPROXIMATE, not an identity, because `sd` uses the sample variance
 * (divide by n-1) while `rmse` divides by n; exactly, `rmse^2 = sd^2*(n-1)/n + bias^2`. The
 * gap is negligible at backtest sizes (0.005 points at n=1,166) and obvious at n=5.
 *
 * @param samples Graded predictions. Fewer than 2 gives back the documented defaults.
 * @returns Measured SDs, biases, and RMSEs, plus `n`.
 *
 * @example
 * estimateDispersion(samples);
 * // 2021 season, 1166 walk-forward predictions, actually observed:
 * // { n: 1166, marginStdDev: 14.39, marginBias: -1.944, marginRmse: 14.515,
 * //   totalStdDev: 18.322, totalBias: 0.052, totalRmse: 18.314 }
 * // The -1.94 margin bias is the home-court constant being too high, not noise — which is
 * // exactly the kind of thing reporting bias separately from spread is meant to expose.
 */
export function estimateDispersion(samples: DispersionSample[]): DispersionEstimate {
  const n = samples.length;
  if (n < 2) {
    return {
      n,
      marginStdDev: DEFAULT_MARGIN_STD_DEV,
      totalStdDev: DEFAULT_TOTAL_STD_DEV,
      marginBias: 0,
      totalBias: 0,
      marginRmse: DEFAULT_MARGIN_STD_DEV,
      totalRmse: DEFAULT_TOTAL_STD_DEV,
    };
  }

  let marginSum = 0;
  let totalSum = 0;
  for (const s of samples) {
    marginSum += s.actualMargin - s.expectedMargin;
    totalSum += s.actualTotal - s.expectedTotal;
  }
  const marginBias = marginSum / n;
  const totalBias = totalSum / n;

  let marginVar = 0;
  let totalVar = 0;
  let marginSq = 0;
  let totalSq = 0;
  for (const s of samples) {
    const dm = s.actualMargin - s.expectedMargin;
    const dt = s.actualTotal - s.expectedTotal;
    marginVar += (dm - marginBias) ** 2;
    totalVar += (dt - totalBias) ** 2;
    marginSq += dm * dm;
    totalSq += dt * dt;
  }

  return {
    n,
    marginStdDev: Math.sqrt(marginVar / (n - 1)),
    totalStdDev: Math.sqrt(totalVar / (n - 1)),
    marginBias,
    totalBias,
    marginRmse: Math.sqrt(marginSq / n),
    totalRmse: Math.sqrt(totalSq / n),
  };
}
