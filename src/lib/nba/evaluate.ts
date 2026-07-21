import type {
  CalibrationBucket,
  EvaluationReport,
  Game,
  GamePrediction,
  GradedMarket,
} from "./types.ts";

/**
 * EVALUATION — "was the model actually any good?"
 * -----------------------------------------------
 * This module exists to stop Devon fooling himself. Everything here is chosen
 * so that a model which looks good but isn't will be caught.
 *
 * NOTATION
 *   p_i = the probability the model gave proposition i, in [0, 1]
 *   y_i = 1 if the proposition happened, 0 if it did not (nulls are DROPPED)
 *   b   = the base rate, mean(y)
 *
 * THE THREE NUMBERS
 *   accuracy = mean( (p_i > 0.5) == y_i )
 *     Cheapest and most misleading number here. On a market whose base rate is
 *     90%, always saying "yes" scores 90% accuracy with zero skill.
 *
 *   Brier    = mean( (p_i - y_i)^2 )
 *     Mean squared error of the probability. 0 is perfect, 0.25 is what you get
 *     for saying 0.5 to everything, 1 is perfectly and confidently wrong. Unlike
 *     accuracy it punishes overconfidence.
 *
 *   BSS      = 1 - Brier / Brier_ref,  Brier_ref = mean( (b - y_i)^2 )
 *     **This is the number that matters.** The reference forecaster knows the
 *     base rate and nothing else. BSS > 0 means the model beat that. BSS <= 0
 *     means every bit of apparent accuracy came from the base rate, not from
 *     the model. Note Brier_ref uses the base rate OF THE SAMPLE BEING SCORED,
 *     which is itself a mild look-ahead in the reference — it makes the
 *     reference slightly too strong, i.e. it is the conservative direction.
 *
 * === THE BOTH-SIDES TRAP (read this before trusting a BSS) ===
 * `expandMarkets` emits BOTH sides of every proposition, so a set built from a
 * whole fan-out contains each event and its own complement. Its base rate is
 * then pinned at exactly 0.500 no matter how lopsided the underlying market is,
 * and the base-rate reference forecaster degenerates into a coin flip.
 *
 * Measured on 300 real 2021 games with a CONSTANT model (home +3, total 224,
 * identical for every game — a model with no information in it at all), the
 * overtime slice scored accuracy 0.947 and BSS +0.796. That is not skill. It is
 * "OVERTIME NO happens ~95% of the time" beating a coin flip, and it is exactly
 * the kind of number that would fool you.
 *
 * So: evaluate ONE SIDE at a time (e.g. only the OVER rows, only HOME rows), or
 * slice by market and line. A base rate that comes back as exactly 0.5000 on a
 * market you know is lopsided is the tell that you have both sides in the pool.
 *
 * === WHAT THIS CANNOT TELL YOU ===
 * Nothing in this file measures profit, edge, ROI, expected value, or whether a
 * bet is worth making. Beating a sportsbook requires the sportsbook's line, and
 * we do not have historical odds. A model can be beautifully calibrated and
 * still lose money against -110 forever. No vig is assumed, no -110 is assumed,
 * no fake closing line is invented. `formatReport` says this out loud on every
 * single report, on purpose.
 */

/** Tunables for {@link evaluate}. */
export interface EvaluateOptions {
  /** Number of equal-width probability buckets. Default 10. */
  buckets?: number;
  /**
   * Minimum rows for a bucket to count toward `maxCalibrationError`. Default 20.
   *
   * A bucket's observed rate has standard error sqrt(r(1-r)/n): at n = 5 that is
   * ~0.22, so a "22% calibration error" in a 5-row bucket is pure sampling
   * noise. Without a floor, the headline worst-case number is decided by the
   * emptiest bucket in the table, which makes a good model look broken and,
   * worse, makes the metric unstable run to run.
   */
  minBucketCount?: number;
}

/**
 * Score a batch of graded propositions.
 *
 * Rows with `outcome === null` (pushes, ungradeable first-half markets) are
 * DROPPED, not counted as losses — `n` is the number of rows that actually
 * survived, and every metric is computed over those only.
 *
 * When nothing is gradeable the metrics come back `NaN` rather than 0. A zero
 * Brier score means "perfect", and reporting perfection for an empty sample is
 * exactly the kind of flattering lie this module exists to prevent.
 * `brierSkillScore` is likewise `NaN` when the base rate is 0 or 1, because the
 * reference forecaster is then already perfect and skill relative to it is
 * undefined rather than zero.
 *
 * Pass ONE SIDE of a market, not a whole fan-out — see "the both-sides trap" in
 * the module header. Feeding in every proposition and its complement forces the
 * base rate to 0.5 and turns the skill score into "did we beat a coin flip",
 * which even a model containing no information can win.
 *
 * @param graded Propositions after {@link import("./markets").gradeMarket}.
 * @param label Human name for this slice, e.g. "spread — half-point lines".
 * @param options Bucket count and minimum bucket size.
 * @returns The report. `meanAbsoluteError` is mean |p - y|, i.e. the mean
 *   absolute probability error, which is on the same scale as a probability and
 *   easier to read than Brier even though Brier is the better metric.
 * @throws If `buckets` or `minBucketCount` are not sensible integers, or a row
 *   carries a probability outside [0, 1].
 *
 * @example
 * evaluate(gradedSpreads, "spread").brierSkillScore; // > 0 means real skill
 */
export function evaluate(
  graded: GradedMarket[],
  label: string,
  options: EvaluateOptions = {}
): EvaluationReport {
  const buckets = options.buckets ?? 10;
  const minBucketCount = options.minBucketCount ?? 20;
  if (!Number.isInteger(buckets) || buckets < 1) {
    throw new Error(`buckets must be an integer >= 1 (got ${buckets})`);
  }
  if (!Number.isInteger(minBucketCount) || minBucketCount < 1) {
    throw new Error(
      `minBucketCount must be an integer >= 1 (got ${minBucketCount})`
    );
  }

  const rows: Array<{ p: number; y: number }> = [];
  for (const g of graded) {
    if (g.outcome === null) continue;
    if (
      typeof g.probability !== "number" ||
      !Number.isFinite(g.probability) ||
      g.probability < 0 ||
      g.probability > 1
    ) {
      throw new Error(
        `evaluate: probability must be in [0,1] (got ${String(g.probability)} ` +
          `for "${g.selection}" on game ${g.gameId})`
      );
    }
    rows.push({ p: g.probability, y: g.outcome ? 1 : 0 });
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
    // p exactly 0.5 is an abstention we are forced to score; it is treated as a
    // "no" pick. Arbitrary, and noted so nobody reads meaning into it.
    if ((p > 0.5 ? 1 : 0) === y) hits++;
    sqErr += (p - y) * (p - y);
    absErr += Math.abs(p - y);
    positives += y;
  }

  const baseRate = positives / n;
  const brierScore = sqErr / n;

  // Brier_ref = mean((b - y)^2) = b(1-b) exactly; computed in closed form.
  const brierRef = baseRate * (1 - baseRate);
  const brierSkillScore = brierRef === 0 ? NaN : 1 - brierScore / brierRef;

  const calibration = buildCalibration(rows, buckets);
  const maxCalibrationError = worstCalibrationGap(calibration, minBucketCount);

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

/** Equal-width reliability buckets over [0, 1]; p === 1 lands in the last one. */
function buildCalibration(
  rows: Array<{ p: number; y: number }>,
  buckets: number
): CalibrationBucket[] {
  const count = new Array<number>(buckets).fill(0);
  const sumP = new Array<number>(buckets).fill(0);
  const sumY = new Array<number>(buckets).fill(0);

  for (const { p, y } of rows) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(p * buckets)));
    count[idx]++;
    sumP[idx] += p;
    sumY[idx] += y;
  }

  const out: CalibrationBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    out.push({
      lowerBound: i / buckets,
      upperBound: (i + 1) / buckets,
      count: count[i],
      meanPredicted: count[i] === 0 ? NaN : sumP[i] / count[i],
      actualRate: count[i] === 0 ? NaN : sumY[i] / count[i],
    });
  }
  return out;
}

/**
 * Largest |meanPredicted - actualRate| over buckets with enough rows to mean
 * anything. If no bucket clears the floor we fall back to every non-empty
 * bucket and the number is noisy — reporting 0 there would claim perfect
 * calibration on evidence that does not exist.
 */
function worstCalibrationGap(
  calibration: CalibrationBucket[],
  minBucketCount: number
): number {
  const meaningful = calibration.filter((b) => b.count >= minBucketCount);
  const pool = meaningful.length > 0 ? meaningful : calibration.filter((b) => b.count > 0);
  if (pool.length === 0) return NaN;
  return pool.reduce(
    (worst, b) => Math.max(worst, Math.abs(b.meanPredicted - b.actualRate)),
    0
  );
}

// ---------------------------------------------------------------------------
// Continuous targets (margin, total)
// ---------------------------------------------------------------------------

/** Error summary for a continuous prediction such as margin or total. */
export interface ContinuousReport {
  label: string;
  n: number;
  /** mean |predicted - actual|, in points. Robust, easy to read. */
  meanAbsoluteError: number;
  /** sqrt(mean((predicted - actual)^2)), in points. Punishes big misses. */
  rootMeanSquaredError: number;
  /**
   * mean(predicted - actual), in points. This is BIAS, not accuracy: positive
   * means the model runs high. A model can have zero bias and be useless, and a
   * biased model is usually trivially fixable — so read it alongside MAE, never
   * instead of it.
   */
  meanError: number;
}

/**
 * Score continuous predictions against what happened.
 *
 * @param samples Paired predicted/actual values.
 * @param label Human name, e.g. "margin".
 * @returns MAE, RMSE and mean signed error. All `NaN` when there are no samples.
 * @throws If any pair contains a non-finite number.
 *
 * @example
 * scoreContinuous([{ predicted: 4, actual: 7 }], "margin").meanAbsoluteError; // 3
 */
export function scoreContinuous(
  samples: Array<{ predicted: number; actual: number }>,
  label: string
): ContinuousReport {
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
    if (!Number.isFinite(s.predicted) || !Number.isFinite(s.actual)) {
      throw new Error(
        `scoreContinuous(${label}): non-finite sample ` +
          `(predicted=${String(s.predicted)}, actual=${String(s.actual)})`
      );
    }
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

/**
 * Score the two headline continuous targets — margin and total — over a set of
 * prediction/result pairs.
 *
 * @param pairs Each prediction with the game it was made for.
 * @returns One {@link ContinuousReport} per target.
 * @throws If any pair's prediction and game are not the same game. (A misjoined
 *   pair would quietly produce nonsense error numbers, so it is a hard error.)
 *
 * @example
 * const { margin, total } = scoreMarginAndTotal(pairs);
 * margin.meanAbsoluteError; // ~9-11 points is typical for a decent NBA model
 */
export function scoreMarginAndTotal(
  pairs: Array<{ prediction: GamePrediction; actual: Game }>
): { margin: ContinuousReport; total: ContinuousReport } {
  const marginSamples: Array<{ predicted: number; actual: number }> = [];
  const totalSamples: Array<{ predicted: number; actual: number }> = [];

  for (const { prediction, actual } of pairs) {
    if (prediction.gameId !== actual.id) {
      throw new Error(
        `scoreMarginAndTotal: prediction is for game ${prediction.gameId} but ` +
          `was paired with game ${actual.id}`
      );
    }
    marginSamples.push({
      predicted: prediction.expectedMargin,
      actual: actual.margin,
    });
    totalSamples.push({
      predicted: prediction.expectedTotal,
      actual: actual.total,
    });
  }

  return {
    margin: scoreContinuous(marginSamples, "margin"),
    total: scoreContinuous(totalSamples, "total"),
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** The disclaimer that appears on every report. Exported so callers can reuse it. */
export const NO_PROFIT_CLAIM_NOTE =
  "NOTE: these numbers measure PREDICTION QUALITY and CALIBRATION only. " +
  "Without historical sportsbook lines there is no way to tell whether any of " +
  "this beats a market — nothing here is a profit, ROI or edge estimate.";

const CURVE_COLS = 41; // x resolution: 0.000 .. 1.000 in steps of 0.025
const CURVE_ROWS = 11; // y resolution: 1.0 down to 0.0 in steps of 0.1
const REPORT_WIDTH = 74;

/** Greedy word wrap so the disclaimer stays inside the report's box. */
function wrap(text: string, width: number, indent = " "): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length + indent.length <= width) line += ` ${word}`;
    else {
      out.push(indent + line);
      line = word;
    }
  }
  if (line.length > 0) out.push(indent + line);
  return out;
}

/**
 * Render a report as readable CLI text: headline metrics, a calibration table,
 * and an ASCII reliability curve.
 *
 * The curve plots observed rate (y) against predicted probability (x). Perfect
 * calibration is the diagonal drawn with `.`; observed buckets are `*`. Points
 * ABOVE the diagonal mean the model was too pessimistic at that probability,
 * below means too confident.
 *
 * @param report A report from {@link evaluate}.
 * @returns Multi-line string, always ending with {@link NO_PROFIT_CLAIM_NOTE}.
 *
 * @example
 * console.log(formatReport(evaluate(graded, "spread")));
 */
export function formatReport(report: EvaluationReport): string {
  const lines: string[] = [];
  const rule = "=".repeat(REPORT_WIDTH);

  lines.push(rule);
  lines.push(` EVALUATION — ${report.label}`);
  lines.push(rule);

  if (report.n === 0) {
    lines.push(" No gradeable rows. Every proposition was a push or ungradeable.");
    lines.push(" (Metrics are NaN rather than 0: nothing was measured.)");
    lines.push("");
    lines.push(...wrap(NO_PROFIT_CLAIM_NOTE, REPORT_WIDTH));
    return lines.join("\n");
  }

  const baseRate = inferBaseRate(report);
  lines.push(` gradeable rows      ${report.n.toLocaleString("en-US")}`);
  lines.push(
    ` base rate           ${num(baseRate)}   how often the proposition happened`
  );
  lines.push(
    ` accuracy            ${num(report.accuracy)}   p>0.5 treated as a pick`
  );
  lines.push(
    ` Brier score         ${num(report.brierScore)}   lower is better; 0.25 = coin flip`
  );
  lines.push(
    ` Brier (base rate)   ${num(baseRate * (1 - baseRate))}   what "always guess the base rate" scores`
  );
  lines.push(
    ` BRIER SKILL SCORE  ${signedNum(report.brierSkillScore)}   >0 = real skill, <=0 = no better than the base rate`
  );
  if (report.meanAbsoluteError !== undefined) {
    lines.push(
      ` mean abs prob err   ${num(report.meanAbsoluteError)}   mean |predicted - outcome|`
    );
  }
  lines.push(
    ` max calibration err ${num(report.maxCalibrationError)}   worst bucket gap (see table)`
  );

  lines.push("");
  lines.push(" CALIBRATION");
  lines.push("   bucket            n     predicted    actual       gap");
  lines.push("   " + "-".repeat(55));
  for (const b of report.calibration) {
    const range = `${b.lowerBound.toFixed(2)}-${b.upperBound.toFixed(2)}`;
    if (b.count === 0) {
      lines.push(`   ${range}          0            —         —         —`);
      continue;
    }
    const gap = b.actualRate - b.meanPredicted;
    lines.push(
      `   ${range}  ${String(b.count).padStart(10)}    ` +
        `${num(b.meanPredicted)}    ${num(b.actualRate)}   ${signedNum(gap)}`
    );
  }

  lines.push("");
  lines.push(" RELIABILITY CURVE   '*' = observed, '.' = perfectly calibrated");
  lines.push(...asciiReliabilityCurve(report.calibration));

  lines.push("");
  lines.push(...wrap(NO_PROFIT_CLAIM_NOTE, REPORT_WIDTH));
  return lines.join("\n");
}

/**
 * Render a continuous report as CLI text.
 *
 * @param report A report from {@link scoreContinuous} or {@link scoreMarginAndTotal}.
 * @returns Multi-line string, always ending with {@link NO_PROFIT_CLAIM_NOTE}.
 */
export function formatContinuousReport(report: ContinuousReport): string {
  const lines: string[] = [];
  lines.push("-".repeat(REPORT_WIDTH));
  lines.push(` CONTINUOUS ACCURACY — ${report.label}`);
  lines.push("-".repeat(REPORT_WIDTH));
  if (report.n === 0) {
    lines.push(" No samples.");
  } else {
    lines.push(` samples             ${report.n.toLocaleString("en-US")}`);
    lines.push(` mean abs error      ${report.meanAbsoluteError.toFixed(3)} pts`);
    lines.push(` RMSE                ${report.rootMeanSquaredError.toFixed(3)} pts`);
    lines.push(
      ` mean error (bias)  ${report.meanError >= 0 ? "+" : "-"}` +
        `${Math.abs(report.meanError).toFixed(3)} pts   + = model runs high`
    );
  }
  lines.push("");
  lines.push(...wrap(NO_PROFIT_CLAIM_NOTE, REPORT_WIDTH));
  return lines.join("\n");
}

/** Recover the base rate from the calibration table (count-weighted actuals). */
function inferBaseRate(report: EvaluationReport): number {
  let total = 0;
  let positives = 0;
  for (const b of report.calibration) {
    if (b.count === 0) continue;
    total += b.count;
    positives += b.count * b.actualRate;
  }
  return total === 0 ? NaN : positives / total;
}

/** ASCII scatter of actualRate (y) vs meanPredicted (x), with the diagonal. */
function asciiReliabilityCurve(calibration: CalibrationBucket[]): string[] {
  const grid: string[][] = [];
  for (let r = 0; r < CURVE_ROWS; r++) {
    grid.push(new Array<string>(CURVE_COLS).fill(" "));
  }

  // Perfect-calibration diagonal.
  for (let r = 0; r < CURVE_ROWS; r++) {
    const y = 1 - r / (CURVE_ROWS - 1);
    grid[r][Math.round(y * (CURVE_COLS - 1))] = ".";
  }

  // Observed buckets.
  for (const b of calibration) {
    if (b.count === 0) continue;
    const col = clampIndex(Math.round(b.meanPredicted * (CURVE_COLS - 1)), CURVE_COLS);
    const row = clampIndex(
      Math.round((1 - b.actualRate) * (CURVE_ROWS - 1)),
      CURVE_ROWS
    );
    grid[row][col] = "*";
  }

  const out: string[] = [];
  for (let r = 0; r < CURVE_ROWS; r++) {
    const y = 1 - r / (CURVE_ROWS - 1);
    out.push(`  ${y.toFixed(1)} |${grid[r].join("")}|`);
  }
  out.push(`      +${"-".repeat(CURVE_COLS)}+`);
  out.push("       0.0            0.5             1.0    predicted");
  out.push("       (y axis = what actually happened)");
  return out;
}

function clampIndex(i: number, size: number): number {
  return i < 0 ? 0 : i > size - 1 ? size - 1 : i;
}

function num(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4).padStart(7) : "    n/a";
}

function signedNum(v: number): string {
  if (!Number.isFinite(v)) return "     n/a";
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(4)}`.padStart(8);
}
