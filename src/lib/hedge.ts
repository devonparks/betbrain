import { americanToDecimal as americanOddsToDecimal } from "./utils";

/**
 * HEDGE / "ASSURANCE BET" MATH
 * ---------------------------
 * You have an open bet (usually the last leg of a parlay). It is still alive and the
 * book shows a pending return. You can bet the OTHER side now to convert some of that
 * upside into a guaranteed number.
 *
 * Notation used throughout this module:
 *   S = originalStake  — money already sunk into the open bet (unrecoverable)
 *   R = pendingReturn  — TOTAL return if the open bet wins, stake INCLUDED
 *                        (the "to return" / "to pay" number the book shows)
 *   H = hedgeStake     — money staked on the opposite side right now
 *   d = decimal odds of the hedge side (total return per unit staked, stake included)
 *
 * Two outcomes:
 *   A) original bet wins, hedge loses:  net = R - S - H
 *   B) original bet loses, hedge wins:  net = H*d - H - S
 *
 * WHY H = R / d MAXIMIZES THE GUARANTEED (WORST-CASE) PROFIT
 *   A(H) = R - S - H          is strictly DECREASING in H (slope -1)
 *   B(H) = H*(d - 1) - S      is strictly INCREASING in H (slope d - 1 > 0, since d > 1)
 *   g(H) = min(A(H), B(H)) is therefore the minimum of an increasing and a decreasing
 *   line, i.e. a concave piecewise-linear function: it rises with slope (d - 1) while
 *   B < A, then falls with slope -1 once B > A. A concave function's maximum sits at
 *   the kink, which is exactly where the two lines cross:
 *       R - S - H = H*(d - 1) - S   =>   R = H*d   =>   H = R / d
 *   At that point A = B = R - S - R/d, so equalizing is simultaneously the "same profit
 *   either way" hedge AND the hedge with the best possible worst case. Any other H makes
 *   one outcome better and the guaranteed number strictly worse. QED.
 *
 * A consequence used below: because H = R/d is the best achievable worst case, a
 * no-lose ("lock in break-even") hedge exists if and only if R - S - R/d >= 0.
 */

/** A hedge scenario: an open bet plus a stake on the other side. */
export interface HedgeInput {
  /** Money already sunk into the open bet. Must be > 0. */
  originalStake: number;
  /** Total return if the open bet wins, stake included. Must be > 0. */
  pendingReturn: number;
  /** American odds of the side you are hedging onto (e.g. -110, +400). */
  hedgeOdds: number;
  /** Money staked on the hedge side. 0 means "no hedge". Must be >= 0. */
  hedgeStake: number;
}

/** Net profit/loss (relative to the sunk original stake) in each outcome. */
export interface HedgeOutcomes {
  /** Net profit if the ORIGINAL bet wins and the hedge loses. */
  ifOriginalWins: number;
  /** Net profit if the ORIGINAL bet loses and the hedge wins. */
  ifHedgeWins: number;
  /** The worst case of the two — what you are actually guaranteed. */
  guaranteed: number;
}

/** Result of solving for the hedge stake that pays the same either way. */
export interface EqualizedHedge {
  /** The stake H = R / d that makes both outcomes identical. */
  hedgeStake: number;
  /** Profit you collect no matter which side wins: R - S - R/d. */
  profitEitherWay: number;
  /**
   * True when that profit is >= 0, i.e. a genuine no-lose lock is available.
   * False when the pending return is too small relative to the sunk stake —
   * you can still even out the two outcomes, but both of them are losses.
   */
  isPossible: boolean;
}

/** Result of solving for the smallest hedge that cannot lose money. */
export interface BreakEvenHedge {
  /** Smallest stake H = S / (d - 1) with min(outcomes) >= 0, or 0 when impossible. */
  hedgeStake: number;
  /** True when a hedge exists that loses nothing in either outcome. */
  isPossible: boolean;
  /** Plain-English explanation, always populated (useful when isPossible is false). */
  note: string;
}

/** One row of the tradeoff curve the UI renders. */
export interface HedgeLadderRow extends HedgeOutcomes {
  /** The hedge stake this row assumes. */
  hedgeStake: number;
  /** True on the row that sits exactly at the equalized stake. */
  isEqualized: boolean;
}

/** Inputs for the ladder sweep (same as HedgeInput minus the stake). */
export interface HedgeLadderInput {
  originalStake: number;
  pendingReturn: number;
  hedgeOdds: number;
  /** Number of steps from 0 to 1.5x the equalized stake. Default 12. */
  steps?: number;
}

/** Format a money value for the human-readable `note` strings. */
function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Round a money value to whole cents (and normalize -0 to 0). */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number (got ${String(value)})`);
  }
}

function assertPositive(value: number, label: string): void {
  assertFinite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than 0 (got ${value})`);
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new Error(`${label} cannot be negative (got ${value})`);
}

/**
 * Convert American odds to decimal odds (total return per unit staked, stake included).
 *
 * `+X` -> `1 + X/100`, `-Y` -> `1 + 100/Y`. Validates the input first; the conversion
 * itself is delegated to the shared helper in `@/lib/utils` so there is one implementation.
 *
 * @param american American odds. Must be finite and at least 100 away from zero
 *   (odds strictly between -100 and +100 do not exist).
 * @returns Decimal odds, always > 1.
 * @throws If the odds are NaN/Infinite or inside the impossible (-100, 100) band.
 *
 * @example
 * americanToDecimal(+400); // 5
 * americanToDecimal(-110); // 1.909090...
 */
export function americanToDecimal(american: number): number {
  assertFinite(american, "hedgeOdds");
  if (american > -100 && american < 100) {
    throw new Error(
      `American odds must be <= -100 or >= +100 (got ${american})`
    );
  }
  return americanOddsToDecimal(american);
}

/**
 * Score a specific hedge: what you net in each outcome, and what you are guaranteed.
 *
 * @param input Open bet (stake + pending return), hedge odds, and the hedge stake.
 * @returns Net profit if the original bet wins, net profit if the hedge wins, and the
 *   worst case of the two. All values are rounded to cents and are NET of the sunk stake.
 * @throws On non-finite, zero, or negative money inputs, or invalid American odds.
 *
 * @example
 * // Devon's Warriors parlay: $100 in, $10,000 to return, $2,000 on the Heat at +400
 * hedgeOutcomes({ originalStake: 100, pendingReturn: 10000, hedgeOdds: 400, hedgeStake: 2000 });
 * // => { ifOriginalWins: 7900, ifHedgeWins: 7900, guaranteed: 7900 }
 */
export function hedgeOutcomes(input: HedgeInput): HedgeOutcomes {
  const { originalStake, pendingReturn, hedgeOdds, hedgeStake } = input;
  assertPositive(originalStake, "originalStake");
  assertPositive(pendingReturn, "pendingReturn");
  assertNonNegative(hedgeStake, "hedgeStake");
  const d = americanToDecimal(hedgeOdds);

  const ifOriginalWins = pendingReturn - originalStake - hedgeStake;
  const ifHedgeWins = hedgeStake * d - hedgeStake - originalStake;

  return {
    ifOriginalWins: round2(ifOriginalWins),
    ifHedgeWins: round2(ifHedgeWins),
    guaranteed: round2(Math.min(ifOriginalWins, ifHedgeWins)),
  };
}

/**
 * Solve for the hedge stake that pays exactly the same whichever side wins.
 *
 * H = R / d, giving profit R - S - R/d in both outcomes. As proved in the header
 * comment, this also maximizes the guaranteed (worst-case) profit.
 *
 * @param input Open bet stake, pending return, and the American odds of the hedge side.
 * @returns The equalized stake, the profit collected either way, and whether that
 *   profit is actually non-negative (`isPossible`). When `isPossible` is false the
 *   pending return is too small to escape a loss at any hedge size.
 * @throws On non-finite, zero, or negative money inputs, or invalid American odds.
 *
 * @example
 * equalizedHedge({ originalStake: 100, pendingReturn: 10000, hedgeOdds: 400 });
 * // => { hedgeStake: 2000, profitEitherWay: 7900, isPossible: true }
 */
export function equalizedHedge(input: {
  originalStake: number;
  pendingReturn: number;
  hedgeOdds: number;
}): EqualizedHedge {
  const { originalStake, pendingReturn, hedgeOdds } = input;
  assertPositive(originalStake, "originalStake");
  assertPositive(pendingReturn, "pendingReturn");
  const d = americanToDecimal(hedgeOdds);

  const hedgeStake = pendingReturn / d;
  const profitEitherWay = pendingReturn - originalStake - hedgeStake;

  return {
    hedgeStake: round2(hedgeStake),
    profitEitherWay: round2(profitEitherWay),
    isPossible: round2(profitEitherWay) >= 0,
  };
}

/**
 * Solve for the SMALLEST hedge that cannot lose money — "lock in break-even".
 *
 * The hedge win outcome is H*(d-1) - S, so it first reaches zero at H = S / (d - 1).
 * That is only a real lock if the other outcome survives it: R - S - H >= 0. Since the
 * equalized hedge maximizes the worst case, the lock exists exactly when
 * `equalizedHedge(...).profitEitherWay >= 0`.
 *
 * @param input Open bet stake, pending return, and the American odds of the hedge side.
 * @returns The smallest no-lose stake (0 when impossible), a possibility flag, and a note.
 * @throws On non-finite, zero, or negative money inputs, or invalid American odds.
 *
 * @example
 * breakEvenHedge({ originalStake: 100, pendingReturn: 10000, hedgeOdds: 400 });
 * // => { hedgeStake: 25, isPossible: true, note: "..." }
 */
export function breakEvenHedge(input: {
  originalStake: number;
  pendingReturn: number;
  hedgeOdds: number;
}): BreakEvenHedge {
  const { originalStake, pendingReturn, hedgeOdds } = input;
  assertPositive(originalStake, "originalStake");
  assertPositive(pendingReturn, "pendingReturn");
  const d = americanToDecimal(hedgeOdds);

  const equalized = equalizedHedge(input);
  if (!equalized.isPossible) {
    return {
      hedgeStake: 0,
      isPossible: false,
      note:
        `No hedge can guarantee break-even here. The best possible worst case is ` +
        `${money(equalized.profitEitherWay)} at a ${money(equalized.hedgeStake)} hedge. ` +
        `The pending return is too small relative to the ${money(originalStake)} already staked.`,
    };
  }

  const hedgeStake = originalStake / (d - 1);
  return {
    hedgeStake: round2(hedgeStake),
    isPossible: true,
    note:
      `Staking ${money(round2(hedgeStake))} on the hedge side recovers the original ` +
      `${money(originalStake)} exactly if the open bet loses, and still leaves ` +
      `${money(round2(pendingReturn - originalStake - hedgeStake))} if it wins.`,
  };
}

/**
 * Sweep hedge stakes from 0 up to ~1.5x the equalized stake so the UI can draw the
 * tradeoff curve: small hedges keep the upside, big hedges buy certainty.
 *
 * With the default 12 steps the equalized stake lands exactly on row index 8.
 *
 * @param input Open bet stake, pending return, hedge odds, and optional step count.
 * @returns Rows of { hedgeStake, ifOriginalWins, ifHedgeWins, guaranteed, isEqualized },
 *   ordered from no hedge to an over-hedge, `steps + 1` rows total.
 * @throws On non-finite, zero, or negative money inputs, invalid odds, or steps < 1.
 *
 * @example
 * hedgeLadder({ originalStake: 100, pendingReturn: 10000, hedgeOdds: 400 })[0];
 * // => { hedgeStake: 0, ifOriginalWins: 9900, ifHedgeWins: -100, guaranteed: -100, ... }
 */
export function hedgeLadder(input: HedgeLadderInput): HedgeLadderRow[] {
  const { originalStake, pendingReturn, hedgeOdds, steps = 12 } = input;
  assertFinite(steps, "steps");
  if (steps < 1 || !Number.isInteger(steps)) {
    throw new Error(`steps must be an integer >= 1 (got ${steps})`);
  }

  const equalizedStake = equalizedHedge({
    originalStake,
    pendingReturn,
    hedgeOdds,
  }).hedgeStake;
  const maxStake = equalizedStake * 1.5;

  const rows: HedgeLadderRow[] = [];
  for (let i = 0; i <= steps; i++) {
    const hedgeStake = round2((maxStake * i) / steps);
    const outcomes = hedgeOutcomes({
      originalStake,
      pendingReturn,
      hedgeOdds,
      hedgeStake,
    });
    rows.push({
      hedgeStake,
      ...outcomes,
      isEqualized: Math.abs(hedgeStake - equalizedStake) < 0.005,
    });
  }
  return rows;
}
