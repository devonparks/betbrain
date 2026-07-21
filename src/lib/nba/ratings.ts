import type { Game, RawGame, RatingSnapshot, TeamRating } from "./types.ts";

/**
 * WALK-FORWARD NBA TEAM RATINGS
 * ----------------------------
 * Elo, plus opponent-adjusted offense/defense for totals. Ratings are folded over the
 * games in strict chronological order, and a snapshot is emitted BEFORE each new date's
 * games are absorbed.
 *
 * THE NO-LOOKAHEAD GUARANTEE — how it is mechanically enforced here
 *   1. `buildRatingTimeline` sorts by (date, id) and, for each distinct date D, emits the
 *      snapshot FIRST and only then folds in the games played on D. So the snapshot stamped
 *      `asOf = D` has provably absorbed only games with `date < D`. `asOf` is exclusive.
 *   2. Every emitted snapshot is a deep copy — `RatingEngine.snapshot` builds a fresh Map of
 *      fresh `TeamRating` objects via `toTeamRating`. The fold keeps mutating its own private
 *      state afterwards; without that copy, a snapshot handed to a caller would keep growing
 *      and silently acquire future games. It is the single most important detail in the file,
 *      and `tools/verify-ratings.mjs` asserts it directly.
 *   3. The date-scoped helpers (`restDaysBefore`, `computeRecentForm`) all filter with the
 *      strict comparison `g.date < asOf` — never `<=` — so a game can never inform its own
 *      prediction, and neither can any other game tipping off the same day.
 *   4. There is deliberately NO function here that takes a `Game` and returns anything about
 *      that game. If you want a rating "including" game X, you have to fold it yourself.
 *
 * NOTATION
 *   E     = Elo rating, 1500 = league average
 *   dE    = Elo difference from the home team's perspective, home-court included
 *   mov   = margin of victory, absolute value, from the WINNER's perspective
 *   L     = league-average points per team per game
 *   O[t]  = points team t would score on a league-average defense
 *   D[t]  = points team t would allow to a league-average offense
 *
 * EVERY CONSTANT BELOW IS A TUNABLE JUDGMENT CALL, NOT A FACT. They are starting values
 * borrowed from FiveThirtyEight's (now retired) NBA Elo model plus measurements taken from
 * this repo's own 2021 game file. They have NOT been re-fit on Devon's full data set. Treat
 * them as priors to be tuned by the backtest, and do not quote them as if they were measured
 * truths.
 */

// ============================================================================
// Tunable constants
// ============================================================================

/** Elo assigned to a team the first time it is seen. League average by definition. */
export const ELO_BASELINE = 1500;

/**
 * Elo K-factor: how far a single result can move a rating.
 * 20 is FiveThirtyEight's NBA value. Higher = faster to react and noisier;
 * lower = more stable and slower to catch a genuine mid-season change.
 * JUDGMENT CALL — worth re-fitting against Brier score.
 */
export const ELO_K = 20;

/**
 * Home-court edge expressed in Elo. 100 Elo / 28 Elo-per-point ~= 3.57 points.
 *
 * ⚠️ THIS DEFAULT IS MEASURABLY TOO HIGH FOR THE MODERN NBA AND IS THE MODEL'S LARGEST
 * KNOWN DEFECT. 100 is FiveThirtyEight's value from an era when home court really was worth
 * ~3.5 points.
 *
 * MEASURED ON THE FULL BACKFILL (all five season files, 6,605 games, 6,177 of them regular
 * season). `estimateHomeAdvantageElo` returns +1.963 points = 55 Elo. Running the whole
 * walk-forward pipeline over those five seasons with this default leaves a systematic
 * -1.66 point bias on expected margin across 5,833 predictions, and the bias is present in
 * EVERY individual season (2021 -1.94, 2022 -1.06, 2023 -1.40, 2024 -1.80, 2025 -2.10), so
 * it is not one season's noise.
 *
 * The probability consequence is the part that matters for honesty, and it is larger than
 * the points bias makes it sound. With this default, predictions in the p >= 0.70 bucket
 * came in at a mean 0.787 against an actual 0.710 — a 7.1 percentage point overstatement
 * across 37% of all predictions — and the worst reliability bucket was off by 0.085.
 *
 * Sensitivity, measured (5 seasons, n = 5,833, same walk-forward, only this constant varied):
 *
 *   ELO_HOME_ADVANTAGE   Brier      BSS      marginBias   maxCalErr   p>=.70 error
 *   100 (shipped)        0.22006    0.1100      -1.66       0.085        +0.071
 *    70                  0.21612    0.1259      -0.59       0.054        +0.042
 *    55 (measured)       0.21512    0.1300      -0.05       0.033        +0.031
 *    50                  0.21494    0.1307      +0.12       0.027        +0.021
 *
 * It is STILL kept at 100, deliberately, because re-fitting a model constant is Devon's
 * call and not a reviewer's — but the "one partial season is not enough evidence" argument
 * that originally justified leaving it is now void: the full backfill has landed and it
 * agrees with the single-season measurement. Setting this to ~50-55 is the single highest-
 * value change available to this model. Either edit it here or pass it per prediction via
 * `PredictionContext.homeAdvantageElo` AND `RatingEngineOptions.homeAdvantageElo` — both,
 * or the scoring fold and the predictor will disagree about what home court is worth.
 */
export const ELO_HOME_ADVANTAGE = 100;

/**
 * Elo points per point of expected margin. 28 is FiveThirtyEight's conversion.
 * JUDGMENT CALL. It couples `expectedMargin` and `homeWinProbability`, so changing it
 * changes both.
 */
export const ELO_PER_POINT = 28;

/** Exponent in the margin-of-victory multiplier. FiveThirtyEight's value. */
export const MOV_EXPONENT = 0.8;

/** Constant term in the MOV multiplier's denominator. FiveThirtyEight's value. */
export const MOV_DENOM_BASE = 7.5;

/**
 * Elo-difference coefficient in the MOV denominator. This is the autocorrelation
 * correction: a heavy favourite blowing out a bad team earns LESS than an underdog
 * winning by the same margin. FiveThirtyEight's value.
 */
export const MOV_DENOM_ELO_COEFFICIENT = 0.006;

/**
 * Fraction of the distance to 1500 that every team is dragged at a season boundary.
 * 0.25 = "keep 75% of last season's rating". Models roster turnover and the draft.
 * JUDGMENT CALL — a real fit would regress by team, weighted by continuity of minutes.
 */
export const SEASON_REGRESSION = 0.25;

/**
 * EWMA weight on the newest game for the offense/defense ratings.
 * 0.05 means the most recent game gets 5% weight; half-life = ln(0.5)/ln(0.95) ~= 13.5
 * games, effective window ~20 games. JUDGMENT CALL — fast enough to track a trade,
 * slow enough not to chase one hot shooting night.
 */
export const SCORING_DECAY = 0.05;

/**
 * EWMA weight for the running league-average points-per-team-per-game.
 * Deliberately much slower (half-life ~69 games) because league pace moves over eras,
 * not over weeks. Seeded at DEFAULT_LEAGUE_AVG_POINTS.
 */
export const LEAGUE_AVG_DECAY = 0.01;

/**
 * Seed for the league scoring average, in points per team per game.
 * Measured at 110.3 over the 1,323 completed 2021-season games in `data/games/2021.json`.
 * It is only a seed — the EWMA moves off it within a couple of weeks of real games.
 */
export const DEFAULT_LEAGUE_AVG_POINTS = 110.3;

/**
 * How much of the home-court edge shows up as the HOME team scoring more (as opposed to
 * the away team scoring less). Half of the total edge, in points.
 * JUDGMENT CALL — split evenly for want of a measurement. It cancels out of expectedTotal
 * entirely and only affects the offense/defense bookkeeping, so the cost of being wrong
 * here is small.
 *
 * This is the value used when a `RatingEngine` is built with no options. When you override
 * the home edge, `homeScoringEdge` below derives the matching value — do NOT reach for this
 * constant in that case, or the fold and the predictor end up assuming different things.
 */
export const HOME_SCORING_EDGE = ELO_HOME_ADVANTAGE / ELO_PER_POINT / 2;

/** The scoring half-share of an arbitrary home-court edge, in points. */
function homeScoringEdge(homeAdvantageElo: number): number {
  return homeAdvantageElo / ELO_PER_POINT / 2;
}

// ============================================================================
// Normalization
// ============================================================================

/** True when the value is a real, finite number (rejects null/undefined/NaN/strings). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A BallDontLie overtime field: null when not played, a score when it was. */
function playedOvertime(period: number | null | undefined): boolean {
  return isFiniteNumber(period) && period > 0;
}

/**
 * Map a raw BallDontLie game onto the model-facing `Game` shape.
 *
 * Rejects (returns null) anything that cannot be graded honestly: non-final games,
 * postponed shells, and rows with missing or nonsensical scores. Quarter data is allowed
 * to be missing — `homeFirstHalf` / `awayFirstHalf` simply come back null, and downstream
 * first-half work must skip those games rather than invent numbers for them.
 *
 * @param raw One element of `data/games/{season}.json`'s `games` array.
 * @returns The normalized game, or null when the row is not a usable completed game.
 *
 * @example
 * normalizeGame({ status: "Final", home_team_score: 114, visitor_team_score: 121, ... });
 * // => { margin: -7, total: 235, wentToOvertime: false, ... }
 */
export function normalizeGame(raw: RawGame): Game | null {
  if (!raw || typeof raw !== "object") return null;

  // Only completed games. BallDontLie writes "Final"; be tolerant of "Final/OT" variants.
  const status = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
  if (!status.startsWith("final")) return null;

  const homeScore = raw.home_team_score;
  const awayScore = raw.visitor_team_score;
  // A "Final" with a zero score is a postponed/abandoned shell, not a played game.
  if (!isFiniteNumber(homeScore) || !isFiniteNumber(awayScore)) return null;
  if (homeScore <= 0 || awayScore <= 0) return null;

  if (!raw.home_team || !raw.visitor_team) return null;
  if (!isFiniteNumber(raw.home_team.id) || !isFiniteNumber(raw.visitor_team.id)) return null;

  // Dates arrive as "YYYY-MM-DD"; tolerate a full ISO timestamp by taking the date part.
  const date = typeof raw.date === "string" ? raw.date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const homeQ1 = isFiniteNumber(raw.home_q1) ? raw.home_q1 : null;
  const homeQ2 = isFiniteNumber(raw.home_q2) ? raw.home_q2 : null;
  const awayQ1 = isFiniteNumber(raw.visitor_q1) ? raw.visitor_q1 : null;
  const awayQ2 = isFiniteNumber(raw.visitor_q2) ? raw.visitor_q2 : null;

  return {
    id: raw.id,
    date,
    season: raw.season,
    postseason: Boolean(raw.postseason),
    homeId: raw.home_team.id,
    awayId: raw.visitor_team.id,
    homeAbbr: raw.home_team.abbreviation,
    awayAbbr: raw.visitor_team.abbreviation,
    homeScore,
    awayScore,
    homeFirstHalf: homeQ1 !== null && homeQ2 !== null ? homeQ1 + homeQ2 : null,
    awayFirstHalf: awayQ1 !== null && awayQ2 !== null ? awayQ1 + awayQ2 : null,
    homeQ1,
    awayQ1,
    margin: homeScore - awayScore,
    total: homeScore + awayScore,
    wentToOvertime:
      playedOvertime(raw.home_ot1) ||
      playedOvertime(raw.home_ot2) ||
      playedOvertime(raw.home_ot3) ||
      playedOvertime(raw.visitor_ot1) ||
      playedOvertime(raw.visitor_ot2) ||
      playedOvertime(raw.visitor_ot3),
  };
}

/**
 * Normalize a whole raw season file, dropping unusable rows, sorted chronologically.
 *
 * @param raws The `games` array from a season file.
 * @returns Usable games ordered by (date, id) — the order the rating fold requires.
 */
export function normalizeGames(raws: RawGame[]): Game[] {
  const out: Game[] = [];
  for (const raw of raws) {
    const game = normalizeGame(raw);
    if (game) out.push(game);
  }
  return sortChronologically(out);
}

/**
 * Sort games by date then id. Dates are "YYYY-MM-DD", so a plain string comparison IS
 * chronological — no Date parsing, no timezone hazard. The id tiebreak only makes the
 * order deterministic; games on the same date are never allowed to see each other anyway.
 *
 * @param games Games in any order. Not mutated.
 * @returns A new, chronologically ordered array.
 */
export function sortChronologically(games: Game[]): Game[] {
  return [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
}

// ============================================================================
// Elo mechanics
// ============================================================================

/**
 * Logistic expected score: the probability the team with the Elo edge `eloDiff` wins.
 *
 *   P = 1 / (1 + 10^(-dE / 400))
 *
 * The 400 is the definition of the Elo scale (a 400-point edge is 10:1), not a fitted value.
 *
 * @param eloDiff Elo difference from the perspective of the team whose win probability you want,
 *   with any home-court adjustment already folded in.
 * @returns A probability in (0, 1). Symmetric: `eloExpectedScore(-d) === 1 - eloExpectedScore(d)`.
 * @throws If `eloDiff` is not finite.
 */
export function eloExpectedScore(eloDiff: number): number {
  if (!isFiniteNumber(eloDiff)) {
    throw new Error(`eloDiff must be a finite number (got ${String(eloDiff)})`);
  }
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

/**
 * Margin-of-victory multiplier — the reason a 40-point blowout does not move a rating
 * twenty times as far as a 2-point win.
 *
 *   mult = (mov + 3)^0.8 / (7.5 + 0.006 * dE_winner)
 *
 * Two things are happening:
 *   - the 0.8 exponent makes the response concave, so extra margin has diminishing value;
 *   - the denominator's dE term is the autocorrelation correction. `dE_winner` is the
 *     Elo edge FROM THE WINNER'S SIDE, so a big favourite winning has a large positive dE,
 *     a bigger denominator, and therefore earns a smaller update. Without it, good teams
 *     ratchet upward forever simply because good teams win big.
 *
 * @param margin Final margin. Sign is ignored; |margin| is floored at 1 (NBA games cannot tie,
 *   and a 0 would make the multiplier collapse toward (3)^0.8 rather than error).
 * @param eloDiffWinner Pre-game Elo difference from the winner's perspective, home-court included.
 * @returns A positive multiplier, typically ~0.7 (2-pt win) to ~2.5 (40-pt upset).
 * @throws If either input is not finite.
 */
export function movMultiplier(margin: number, eloDiffWinner: number): number {
  if (!isFiniteNumber(margin)) {
    throw new Error(`margin must be a finite number (got ${String(margin)})`);
  }
  if (!isFiniteNumber(eloDiffWinner)) {
    throw new Error(`eloDiffWinner must be a finite number (got ${String(eloDiffWinner)})`);
  }
  const mov = Math.max(Math.abs(margin), 1);
  // Guard the denominator. Real NBA Elo gaps never approach -1250, but a corrupt input
  // must not silently flip the sign of every rating update in the league.
  const denominator = Math.max(MOV_DENOM_BASE + MOV_DENOM_ELO_COEFFICIENT * eloDiffWinner, 1);
  return Math.pow(mov + 3, MOV_EXPONENT) / denominator;
}

/**
 * The signed Elo change applied to the HOME team for one game. The away team receives the
 * exact negation, which is what makes the system zero-sum (league Elo is conserved, so
 * "the league got better" can never be an artifact).
 *
 * @param eloDiffHome Pre-game home-minus-away Elo, home-court advantage already added.
 * @param margin Final home-minus-away margin. Positive = home won.
 * @returns Elo delta for the home team. Positive when home won.
 */
export function eloDelta(eloDiffHome: number, margin: number): number {
  const homeWon = margin > 0;
  const expectedHome = eloExpectedScore(eloDiffHome);
  const actualHome = homeWon ? 1 : 0;
  const eloDiffWinner = homeWon ? eloDiffHome : -eloDiffHome;
  return ELO_K * movMultiplier(margin, eloDiffWinner) * (actualHome - expectedHome);
}

// ============================================================================
// The rating fold
// ============================================================================

/** Mutable per-team state. Only `elo`, `offense`, `defense`, `gamesPlayed` escape. */
interface TeamState {
  teamId: number;
  elo: number;
  /**
   * Offense RELATIVE to the contemporaneous league average, in points. 0 = average.
   *
   * Storing the relative value rather than the absolute one is not a style choice, it is a
   * bias fix. League scoring trends within a season — over 2021-22 it climbed from 214.4
   * points per game in November to 227.3 in March, then fell to 210 in the playoffs. An
   * absolute EWMA with a ~13.5-game half-life lags that trend by roughly a month, and every
   * predicted total inherits the lag. Measured on `data/games/2021.json`, absolute ratings
   * produced a +1.90 point bias on totals (the model was systematically UNDER the actual);
   * the relative formulation below cuts that to +0.01 and also improves RMSE from 18.70 to
   * 18.31, because the fast-moving league average now carries the league-wide trend and the
   * slow-moving team ratings only carry team-specific deviation.
   */
  relOffense: number;
  /** Defense relative to the contemporaneous league average, in points. Negative = good. */
  relDefense: number;
  /**
   * Games played SINCE THE LAST SEASON BOUNDARY, not career games.
   *
   * DELIBERATE READING of `TeamRating.gamesPlayed` ("games this rating has been trained
   * on"). A rating that carried over from last season has been regressed 25% toward 1500
   * and sits on top of a roster that may have turned over completely — so as far as THIS
   * season's team is concerned it has been trained on nothing. Counting per-season means
   * roughly the first ten games of every October come back as `confidence: "insufficient"`.
   * That is the intended, conservative behaviour: it errs toward refusing to project.
   */
  gamesPlayed: number;
}

/**
 * Snapshot one team as an immutable-by-copy `TeamRating`.
 *
 * Internally offense/defense are stored relative to the league average; the contract in
 * types.ts asks for absolute "points scored/allowed per game", so the current league average
 * is added back here. Absolute is what escapes; relative is what is maintained.
 */
function toTeamRating(state: TeamState, leagueAvgPoints: number): TeamRating {
  return {
    teamId: state.teamId,
    elo: state.elo,
    offense: leagueAvgPoints + state.relOffense,
    defense: leagueAvgPoints + state.relDefense,
    gamesPlayed: state.gamesPlayed,
  };
}

/** Construction options for {@link RatingEngine} and {@link buildRatingTimeline}. */
export interface RatingEngineOptions {
  /** Home-court edge in Elo. Defaults to {@link ELO_HOME_ADVANTAGE} (which is ~2x too high). */
  homeAdvantageElo?: number;
}

/**
 * A stateful walk-forward rating fold.
 *
 * Create one, push games at it in chronological order, and take a snapshot whenever you
 * need the league's state. The engine has no concept of "the future": it can only ever
 * report what it has already been shown, so a leak has to be introduced by feeding it
 * games out of order.
 *
 * Most callers should use `buildRatingTimeline` instead, which does the ordering and the
 * before-the-date snapshotting for you.
 */
export class RatingEngine {
  private readonly teams = new Map<number, TeamState>();
  private leagueAvgPoints = DEFAULT_LEAGUE_AVG_POINTS;
  private gamesObserved = 0;
  private currentSeason: number | null = null;
  private lastDate = "";
  private readonly homeAdvantageElo: number;
  private readonly homeScoringEdgePoints: number;

  /**
   * @param options.homeAdvantageElo Home-court edge in Elo. Defaults to
   *   {@link ELO_HOME_ADVANTAGE}. Pass the SAME value you pass to
   *   `PredictionContext.homeAdvantageElo`: the fold uses it to decide how much of a home
   *   team's scoring to discount, and the predictor uses it to set expected margin. If the
   *   two disagree, the offense/defense ratings are being adjusted for a home court the
   *   predictor does not believe in, and nothing will tell you.
   */
  constructor(options: RatingEngineOptions = {}) {
    const hae = options.homeAdvantageElo ?? ELO_HOME_ADVANTAGE;
    if (!isFiniteNumber(hae)) {
      throw new Error(`homeAdvantageElo must be a finite number (got ${String(hae)})`);
    }
    this.homeAdvantageElo = hae;
    this.homeScoringEdgePoints = homeScoringEdge(hae);
  }

  /** Points per team per game, EWMA. Exposed so the predictor can baseline totals. */
  getLeagueAvgPoints(): number {
    return this.leagueAvgPoints;
  }

  /** How many games this engine has absorbed. */
  getGamesObserved(): number {
    return this.gamesObserved;
  }

  /**
   * Current rating for a team, or null if it has never been seen.
   * Returns a copy — callers cannot reach in and mutate the fold's state.
   */
  getRating(teamId: number): TeamRating | null {
    const state = this.teams.get(teamId);
    return state ? toTeamRating(state, this.leagueAvgPoints) : null;
  }

  /**
   * Take an immutable snapshot valid as-of `asOf`, which is EXCLUSIVE: it asserts that no
   * game dated on or after `asOf` has been folded in. The assertion is real — feeding the
   * engine a game and then asking for a snapshot stamped on that game's own date throws.
   *
   * @param asOf "YYYY-MM-DD". Must be strictly after the last game absorbed.
   * @returns A deep copy of the league's rating state.
   * @throws If `asOf` is not a date string, or if a game on/after `asOf` has been absorbed.
   */
  snapshot(asOf: string): RatingSnapshot {
    if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new Error(`asOf must be a "YYYY-MM-DD" date string (got ${String(asOf)})`);
    }
    if (this.lastDate && this.lastDate >= asOf) {
      throw new Error(
        `LOOKAHEAD: snapshot asOf ${asOf} would include a game dated ${this.lastDate}. ` +
          `asOf is exclusive — every absorbed game must be strictly earlier.`
      );
    }
    const ratings = new Map<number, TeamRating>();
    for (const [teamId, state] of this.teams) {
      ratings.set(teamId, toTeamRating(state, this.leagueAvgPoints));
    }
    return {
      asOf,
      ratings,
      leagueAvgPoints: this.leagueAvgPoints,
      gamesObserved: this.gamesObserved,
    };
  }

  /**
   * Absorb one completed game. Must be called in chronological order.
   *
   * Order of operations matters and is the reason this is one method rather than several:
   * the offense/defense update uses the opponent's PRE-game ratings, so both teams' new
   * values are computed from the old ones before either is written back.
   *
   * @param game A normalized, completed game.
   * @throws If the game predates the last game absorbed (that would corrupt the walk-forward
   *   ordering, and silently produce ratings that no snapshot could honestly describe).
   * @throws If `game.season` is not a finite number, or moves backwards. Both were silent
   *   corruptions before: a missing season label meant the season boundary NEVER fired (so
   *   ratings compounded across a decade with no regression and every October read as
   *   fully-evidenced), and a backwards label fired a spurious 25% regression mid-stream.
   *   Neither is recoverable after the fact, so they are hard throws.
   */
  observe(game: Game): void {
    if (this.lastDate && game.date < this.lastDate) {
      throw new Error(
        `OUT OF ORDER: game ${game.id} dated ${game.date} arrived after ${this.lastDate}. ` +
          `Sort with sortChronologically() before folding.`
      );
    }
    if (!isFiniteNumber(game.season)) {
      throw new Error(
        `game ${game.id} has no usable season (${String(game.season)}). Without it the ` +
          `season boundary never fires and ratings compound across seasons unregressed.`
      );
    }
    if (this.currentSeason !== null && game.season < this.currentSeason) {
      throw new Error(
        `OUT OF ORDER: game ${game.id} is season ${game.season} but season ` +
          `${this.currentSeason} has already been absorbed. A backwards season label ` +
          `silently triggers a spurious 25% regression.`
      );
    }

    // --- season boundary: regress everyone toward the mean, reset the "trained on" count
    if (this.currentSeason !== null && game.season !== this.currentSeason) {
      this.regressToMean();
    }
    this.currentSeason = game.season;

    const home = this.ensureTeam(game.homeId);
    const away = this.ensureTeam(game.awayId);

    // --- Elo (uses pre-game values for both sides)
    const eloDiffHome = home.elo + this.homeAdvantageElo - away.elo;
    const delta = eloDelta(eloDiffHome, game.margin);

    // --- opponent-adjusted offense / defense (also pre-game values for both sides)
    //
    // "How good was this scoring performance, really?" A team that hangs 120 on the best
    // defense in the league did something much better than 120 against the worst. So the
    // performance is credited relative to the league average L, then corrected for how good
    // the opponent was and for home court. Everything is kept in RELATIVE points (0 = league
    // average) — see the TeamState.relOffense comment for why that matters:
    //
    //   adjOff_home = (homeScore - L) - relDef[away] - homeScoringEdge
    //   adjDef_home = (awayScore - L) + homeScoringEdge - relOff[away]
    //
    // The mirror image applies to the away team. Note this uses FINAL scores including
    // overtime: OT points are noise for rating a team, but totals markets settle including
    // OT, so leaving them in keeps the ratings on the same scale as the thing being bet.
    // JUDGMENT CALL — ~4.5% of games are affected.
    const L = this.leagueAvgPoints;
    const edge = this.homeScoringEdgePoints;
    const adjOffHome = game.homeScore - L - away.relDefense - edge;
    const adjDefHome = game.awayScore - L + edge - away.relOffense;
    const adjOffAway = game.awayScore - L + edge - home.relDefense;
    const adjDefAway = game.homeScore - L - edge - home.relOffense;

    home.elo += delta;
    away.elo -= delta; // zero-sum by construction
    home.relOffense = ewma(home.relOffense, adjOffHome, SCORING_DECAY);
    home.relDefense = ewma(home.relDefense, adjDefHome, SCORING_DECAY);
    away.relOffense = ewma(away.relOffense, adjOffAway, SCORING_DECAY);
    away.relDefense = ewma(away.relDefense, adjDefAway, SCORING_DECAY);
    home.gamesPlayed += 1;
    away.gamesPlayed += 1;

    this.leagueAvgPoints = ewma(this.leagueAvgPoints, game.total / 2, LEAGUE_AVG_DECAY);
    this.gamesObserved += 1;
    this.lastDate = game.date;
  }

  /**
   * Pull every team `SEASON_REGRESSION` of the way toward the league mean, and reset the
   * per-season games-played counters. Offense/defense regress toward 0 (i.e. toward league
   * average, since they are stored relative) for the same reason Elo regresses toward 1500.
   */
  private regressToMean(): void {
    for (const state of this.teams.values()) {
      state.elo = ELO_BASELINE + (1 - SEASON_REGRESSION) * (state.elo - ELO_BASELINE);
      state.relOffense = (1 - SEASON_REGRESSION) * state.relOffense;
      state.relDefense = (1 - SEASON_REGRESSION) * state.relDefense;
      state.gamesPlayed = 0;
    }
  }

  /** First sighting of a team: average in every respect, zero evidence behind it. */
  private ensureTeam(teamId: number): TeamState {
    let state = this.teams.get(teamId);
    if (!state) {
      state = {
        teamId,
        elo: ELO_BASELINE,
        relOffense: 0,
        relDefense: 0,
        gamesPlayed: 0,
      };
      this.teams.set(teamId, state);
    }
    return state;
  }
}

/** Exponentially weighted moving average: pull `previous` a fraction `alpha` toward `sample`. */
function ewma(previous: number, sample: number, alpha: number): number {
  return previous + alpha * (sample - previous);
}

/**
 * Build one snapshot per distinct game date, each excluding that date's games.
 *
 * This is the primary entry point for a backtest: `timeline[i].asOf` is a date on which
 * games were played, and `timeline[i].ratings` provably contains only information from
 * strictly earlier dates. Predicting `date = timeline[i].asOf` against `timeline[i]` is
 * lookahead-free by construction.
 *
 * A terminal snapshot is appended, stamped the day after the final game, holding the
 * complete ratings — that is the "where do things stand now" state.
 *
 * @param games Completed games, any order (they are sorted internally).
 * @param options Forwarded to the `RatingEngine` — notably `homeAdvantageElo`.
 * @returns Snapshots in ascending date order. Empty array for an empty input.
 *
 * @example
 * const timeline = buildRatingTimeline(games);
 * const snap = timeline.find((s) => s.asOf === "2021-11-04"); // knows nothing about 11-04
 */
export function buildRatingTimeline(
  games: Game[],
  options: RatingEngineOptions = {}
): RatingSnapshot[] {
  const ordered = sortChronologically(games);
  if (ordered.length === 0) return [];

  const engine = new RatingEngine(options);
  const snapshots: RatingSnapshot[] = [];
  let index = 0;

  while (index < ordered.length) {
    const date = ordered[index].date;
    // Emit BEFORE absorbing this date's games. This line is the no-lookahead guarantee.
    snapshots.push(engine.snapshot(date));
    while (index < ordered.length && ordered[index].date === date) {
      engine.observe(ordered[index]);
      index += 1;
    }
  }

  snapshots.push(engine.snapshot(nextDay(ordered[ordered.length - 1].date)));
  return snapshots;
}

/**
 * Look up the snapshot to use when predicting a game on `date`.
 *
 * Returns the snapshot with the SMALLEST `asOf` that is >= `date`. That sounds backwards
 * until you remember `asOf` is exclusive: the snapshot stamped `asOf = date` is exactly
 * "everything before date". If no games were played on `date` itself, the next snapshot up
 * holds exactly the same games, and is RE-STAMPED to `date` before being returned.
 *
 * WHY THE RE-STAMP IS TRUTHFUL AND NOT A FUDGE. `buildRatingTimeline` emits one snapshot per
 * distinct date in its input. So if the timeline has no snapshot stamped `date`, the input
 * contained no games on `date`. Let `s` be the smallest asOf > `date`; by the same argument
 * the input contains no games on any date in `(date, s)` either, and by construction `s`
 * holds exactly the games earlier than `s`. Therefore
 *   { games in the input earlier than s } == { games in the input earlier than date }
 * and stamping it `date` states something true about it. PRECONDITION: `timeline` came from
 * `buildRatingTimeline` over the game set you are predicting from. Hand-assemble a timeline
 * with dates missing and this reasoning does not hold.
 *
 * Without the re-stamp this function returns a snapshot that `predictGame` then rejects with
 * a LOOKAHEAD error, because `predictGame` (correctly) refuses any snapshot stamped after
 * game day. That made the documented `snapshotAsOf` -> `predictGame` pipeline throw on any
 * date with no games in the timeline — a train/test split, a regular-season-only timeline
 * used on a playoff game, or a prediction for an off day. It failed closed rather than
 * leaking, but it failed.
 *
 * @param timeline Output of `buildRatingTimeline`, ascending by `asOf`.
 * @param date "YYYY-MM-DD" of the game being predicted.
 * @returns A snapshot whose `asOf` is <= `date` and which contains only games strictly
 *   earlier than `date`, or null for an empty timeline.
 */
export function snapshotAsOf(timeline: RatingSnapshot[], date: string): RatingSnapshot | null {
  if (timeline.length === 0) return null;
  let low = 0;
  let high = timeline.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timeline[mid].asOf >= date) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  // `date` is past every snapshot: the last one holds all games, all of them earlier. Safe,
  // and its asOf is already <= date, so it needs no re-stamp.
  const found = answer === -1 ? timeline[timeline.length - 1] : timeline[answer];
  if (found.asOf <= date) return found;
  // Gap date. Copy rather than mutate — the timeline element must stay as it was, and the
  // copy must not share TeamRating objects with it.
  const ratings = new Map<number, TeamRating>();
  for (const [teamId, rating] of found.ratings) ratings.set(teamId, { ...rating });
  return { ...found, asOf: date, ratings };
}

/** Add one UTC day to a "YYYY-MM-DD" string. */
function nextDay(date: string): string {
  const ms =
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    ) + 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ============================================================================
// Date-scoped context helpers (rest, recent form)
// ============================================================================

/** A team's recent results. Purely descriptive — the Elo already contains this information. */
export interface RecentForm {
  /** How many games this summary is based on. 0 = nothing to say. */
  games: number;
  wins: number;
  /** Average (points scored - points allowed) over those games. */
  pointDiffPerGame: number;
}

/**
 * Days off before a game: 0 = back-to-back (played yesterday), 1 = the modal one day off.
 *
 * NO-LOOKAHEAD: filters on `g.date < date`, strictly. A game can never see itself, and two
 * games on the same day cannot see each other.
 *
 * @param games Any set of completed games (typically the whole season).
 * @param teamId Team to look up.
 * @param date "YYYY-MM-DD" of the upcoming game.
 * @returns Days off, or null when the team has no earlier game on record (season opener).
 */
export function restDaysBefore(games: Game[], teamId: number, date: string): number | null {
  let mostRecent = "";
  for (const game of games) {
    if (game.date >= date) continue; // strict: today's games are invisible
    if (game.homeId !== teamId && game.awayId !== teamId) continue;
    if (game.date > mostRecent) mostRecent = game.date;
  }
  if (!mostRecent) return null;
  const dayMs = 86_400_000;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${mostRecent}T00:00:00Z`)) / dayMs;
  return Math.max(Math.round(gap) - 1, 0);
}

/**
 * A team's last `lastN` results before `date`.
 *
 * NO-LOOKAHEAD: same strict `g.date < date` filter as `restDaysBefore`.
 *
 * This exists for DISPLAY. Recent form is already baked into Elo — every one of those games
 * moved the rating — so surfacing it as an extra points impact would double-count it. See
 * `predictGame`, where the recent-form factor deliberately carries no `pointsImpact`.
 *
 * @param games Any set of completed games.
 * @param teamId Team to summarize.
 * @param date "YYYY-MM-DD" of the upcoming game.
 * @param lastN How many games back to look. Default 10.
 * @returns The summary; `games: 0` when there is no history.
 */
export function computeRecentForm(
  games: Game[],
  teamId: number,
  date: string,
  lastN = 10
): RecentForm {
  const prior: Game[] = [];
  for (const game of games) {
    if (game.date >= date) continue; // strict
    if (game.homeId !== teamId && game.awayId !== teamId) continue;
    prior.push(game);
  }
  prior.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const window = prior.slice(-lastN);
  if (window.length === 0) return { games: 0, wins: 0, pointDiffPerGame: 0 };

  let wins = 0;
  let diff = 0;
  for (const game of window) {
    const isHome = game.homeId === teamId;
    const signed = isHome ? game.margin : -game.margin;
    if (signed > 0) wins += 1;
    diff += signed;
  }
  return {
    games: window.length,
    wins,
    pointDiffPerGame: diff / window.length,
  };
}

/**
 * Empirical first-half shares, measured from quarter data rather than assumed to be 50%.
 *
 * Two different shares come out of this and they are NOT the same number:
 *   - totalShare  = sum(first-half points) / sum(all points). Below 50% mainly because
 *     overtime points land in the denominator and never in the numerator.
 *   - marginShare = a least-squares slope through the origin of first-half margin on final
 *     margin, i.e. "what fraction of the eventual margin has typically been built by half".
 *     Above 50%, which is a real effect — leads compress late as starters sit.
 *
 * Games without quarter data are skipped, not defaulted.
 *
 * @param games Completed games.
 * @returns The two shares plus the sample size behind them. `n: 0` means nothing was
 *   measurable, and both shares fall back to the module defaults.
 */
export function estimateFirstHalfShares(games: Game[]): {
  totalShare: number;
  marginShare: number;
  n: number;
} {
  let firstHalfPoints = 0;
  let allPoints = 0;
  let crossProduct = 0;
  let marginSquares = 0;
  let n = 0;

  for (const game of games) {
    if (game.homeFirstHalf === null || game.awayFirstHalf === null) continue;
    const fhTotal = game.homeFirstHalf + game.awayFirstHalf;
    const fhMargin = game.homeFirstHalf - game.awayFirstHalf;
    firstHalfPoints += fhTotal;
    allPoints += game.total;
    crossProduct += fhMargin * game.margin;
    marginSquares += game.margin * game.margin;
    n += 1;
  }

  if (n === 0 || allPoints === 0 || marginSquares === 0) {
    return { totalShare: FIRST_HALF_TOTAL_SHARE, marginShare: FIRST_HALF_MARGIN_SHARE, n: 0 };
  }
  return {
    totalShare: firstHalfPoints / allPoints,
    marginShare: crossProduct / marginSquares,
    n,
  };
}

/**
 * Default first-half share of TOTAL points.
 *
 * Shipped value is the 2021-only fit: 0.5042 over the 1,323 games in `data/games/2021.json`.
 * The full backfill has since landed and disagrees slightly — `estimateFirstHalfShares` over
 * all five season files (6,605 games) returns 0.502118. Left at the 2021 value rather than
 * silently re-fit; the difference is ~0.4 points on a 224-point total, so it is real but
 * small. Re-fit deliberately, or override per prediction.
 */
export const FIRST_HALF_TOTAL_SHARE = 0.5042;

/**
 * Measure the home-court edge from a game set, in points and in Elo.
 *
 * Postseason games are EXCLUDED and that exclusion is the whole subtlety: in the playoffs
 * the better team hosts by construction, so the raw home margin there (+4.05 in the 2021
 * file, versus +1.72 in the regular season) is mostly seeding, not home court. Over a full
 * regular season every team hosts and visits 41 times, so the schedule is balanced and the
 * mean home margin is a clean estimate.
 *
 * @param games Completed games. Regular-season rows are used; postseason rows are dropped.
 * @returns `pointsEdge` (mean home margin), the same value converted to Elo via
 *   `ELO_PER_POINT`, and `n`. When no regular-season games are supplied, the module
 *   defaults come back with `n: 0` — no invented estimate.
 *
 * @example
 * estimateHomeAdvantageElo(games2021);
 * // => { pointsEdge: 1.72, elo: 48.2, n: 1230 }  -> the shipped default of 100 is ~2x high
 */
export function estimateHomeAdvantageElo(games: Game[]): {
  pointsEdge: number;
  elo: number;
  n: number;
} {
  let sum = 0;
  let n = 0;
  for (const game of games) {
    if (game.postseason) continue;
    sum += game.margin;
    n += 1;
  }
  if (n === 0) {
    return { pointsEdge: ELO_HOME_ADVANTAGE / ELO_PER_POINT, elo: ELO_HOME_ADVANTAGE, n: 0 };
  }
  const pointsEdge = sum / n;
  return { pointsEdge, elo: pointsEdge * ELO_PER_POINT, n };
}

/**
 * Default first-half share of MARGIN.
 *
 * Shipped value is the 2021-only fit: 0.5147 over 1,323 games by least squares through the
 * origin. It is above 0.5, not at it — assuming exactly half would understate every
 * first-half spread. The full backfill puts it slightly higher still: 0.522965 over all five
 * season files (6,605 games). Left at the 2021 value rather than silently re-fit.
 */
export const FIRST_HALF_MARGIN_SHARE = 0.5147;
