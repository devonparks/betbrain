/**
 * Shared contract for the NBA prediction + backtest pipeline.
 *
 * The whole system is built around one rule: **a prediction may only ever use
 * information that existed before that game tipped off.** Every type here is
 * shaped to make violating that rule awkward.
 */

// ============ RAW DATA (as returned by BallDontLie /games, free tier) ============

/** A completed game with quarter-by-quarter detail. */
export interface RawGame {
  id: number;
  date: string; // "2025-10-21"
  datetime: string | null;
  season: number;
  status: string; // "Final" when played
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_q1: number | null;
  home_q2: number | null;
  home_q3: number | null;
  home_q4: number | null;
  home_ot1: number | null;
  home_ot2: number | null;
  home_ot3: number | null;
  visitor_q1: number | null;
  visitor_q2: number | null;
  visitor_q3: number | null;
  visitor_q4: number | null;
  visitor_ot1: number | null;
  visitor_ot2: number | null;
  visitor_ot3: number | null;
  home_team: RawTeam;
  visitor_team: RawTeam;
}

export interface RawTeam {
  id: number;
  abbreviation: string;
  full_name: string;
  conference: string;
  division: string;
}

/** The normalized, model-facing view of a finished game. */
export interface Game {
  id: number;
  date: string;
  season: number;
  postseason: boolean;
  homeId: number;
  awayId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  /** Points in the first half only (q1 + q2). Null when quarter data is missing. */
  homeFirstHalf: number | null;
  awayFirstHalf: number | null;
  homeQ1: number | null;
  awayQ1: number | null;
  /** homeScore - awayScore. Positive = home won. */
  margin: number;
  total: number;
  wentToOvertime: boolean;
}

// ============ RATINGS ============

/** A team's strength at a point in time. */
export interface TeamRating {
  teamId: number;
  /** Elo-style strength. 1500 is league average. */
  elo: number;
  /** Points scored per game, opponent-adjusted. */
  offense: number;
  /** Points allowed per game, opponent-adjusted. */
  defense: number;
  /** Games this rating has been trained on. Low = untrustworthy. */
  gamesPlayed: number;
}

/**
 * The full rating state of the league at one moment. A prediction is always made
 * against a snapshot built exclusively from earlier games.
 */
export interface RatingSnapshot {
  /** ISO date this snapshot is valid as-of (exclusive: games ON this date are unseen). */
  asOf: string;
  ratings: Map<number, TeamRating>;
  /** League-average points per team per game, for baselining totals. */
  leagueAvgPoints: number;
  gamesObserved: number;
}

// ============ PREDICTIONS ============

/** What the model thinks will happen, before the game is played. */
export interface GamePrediction {
  gameId: number;
  date: string;
  homeId: number;
  awayId: number;
  /** Expected homeScore - awayScore. Positive favours home. */
  expectedMargin: number;
  /** Expected combined points. */
  expectedTotal: number;
  /** P(home team wins), 0..1. */
  homeWinProbability: number;
  /** Expected home-away margin at halftime. */
  expectedFirstHalfMargin: number;
  /** Expected combined first-half points. */
  expectedFirstHalfTotal: number;
  /** Spread of the margin distribution — drives every threshold probability. */
  marginStdDev: number;
  totalStdDev: number;
  /** How much to trust this at all. Early-season games have thin ratings. */
  confidence: "insufficient" | "low" | "moderate" | "high";
  /** Human-readable drivers — this is what the product SHOWS the user. */
  factors: PredictionFactor[];
}

/**
 * One reason behind a prediction. BetBrain shows these instead of telling the
 * user what to bet — it is the entire product philosophy in one type.
 */
export interface PredictionFactor {
  label: string;
  detail: string;
  /** Signed contribution to expected margin, in points, where meaningful. */
  pointsImpact?: number;
}

// ============ MARKETS ============

export type MarketType =
  | "moneyline"
  | "spread"
  | "total"
  | "first_half_moneyline"
  | "first_half_total"
  | "q1_moneyline"
  | "team_total"
  | "overtime";

/**
 * A single graded-able proposition. This is the "thousands of bets per night"
 * unit: one game fans out into many of these.
 */
export interface MarketPrediction {
  gameId: number;
  date: string;
  market: MarketType;
  /** e.g. "HOME -5.5", "TOTAL over 224.5", "1H LAL ML" */
  selection: string;
  /** The threshold this proposition is measured against (spread/total line). */
  line: number | null;
  /** Model probability this proposition wins, 0..1. */
  probability: number;
}

/** The same proposition after the game finished. */
export interface GradedMarket extends MarketPrediction {
  /** true = the proposition happened, false = it didn't, null = push/ungradeable. */
  outcome: boolean | null;
}

// ============ EVALUATION ============

/** One bucket of a reliability curve: "when we said ~70%, what actually happened?" */
export interface CalibrationBucket {
  lowerBound: number;
  upperBound: number;
  count: number;
  meanPredicted: number;
  actualRate: number;
}

export interface EvaluationReport {
  label: string;
  n: number;
  /** Fraction correct when treating p>0.5 as a pick. */
  accuracy: number;
  /** Mean squared error of the probability. Lower is better; 0.25 = coin flip. */
  brierScore: number;
  /**
   * How much better than always guessing the base rate. >0 means real skill.
   * This is the number that actually matters.
   */
  brierSkillScore: number;
  /** Mean |predicted - actual| for continuous targets (margin, total). */
  meanAbsoluteError?: number;
  calibration: CalibrationBucket[];
  /** Worst-case honesty: the largest gap between predicted and actual in any bucket. */
  maxCalibrationError: number;
}
