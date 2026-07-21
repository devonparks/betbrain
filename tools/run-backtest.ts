/**
 * THE BACKTEST — Devon's loop, run over whole historical seasons.
 *
 *   "Make thousands of bets per night, then go back the next day and keep track
 *    of what hit and what didn't."
 *
 * Run it:  node tools/run-backtest.ts [--seasons 2021,2022] [--test 0.3]
 *
 * ── How the no-lookahead guarantee actually holds ────────────────────────────
 * Games are grouped by calendar date and processed oldest-first. For each date D:
 *   1. take a rating snapshot as-of D  (RatingEngine.snapshot throws if any game
 *      dated >= D has been absorbed — a hard runtime guard, not a comment)
 *   2. predict EVERY game on D from that one snapshot
 *   3. only then feed D's results back into the engine
 * So a game is never used to predict itself, and games later the same night are
 * never used to predict games earlier that night.
 *
 * ── Two passes ───────────────────────────────────────────────────────────────
 * FIT pass runs walk-forward over the training period to measure how far the
 * model actually misses by (dispersion) and the real home-court edge. Those
 * fitted numbers then drive the TEST pass. The test period is strictly in the
 * future of the fit period, so nothing that shapes the model has seen it.
 *
 * ── What this measures, and what it does not ─────────────────────────────────
 * Predictive skill and calibration. NOT profit. Beating a sportsbook requires
 * the book's line, which costs money we haven't spent yet. A model has to be
 * well-calibrated before "is it +EV" is even a meaningful question.
 */
import { loadGames, chronologicalSplit } from "../src/lib/nba/loader.ts";
import {
  RatingEngine,
  restDaysBefore,
  estimateHomeAdvantageElo,
} from "../src/lib/nba/ratings.ts";
import {
  predictGame,
  estimateDispersion,
  type DispersionSample,
} from "../src/lib/nba/game-predict.ts";
import { expandMarkets, gradeMarkets } from "../src/lib/nba/markets.ts";
import {
  evaluate,
  scoreMarginAndTotal,
  formatReport,
  formatContinuousReport,
  NO_PROFIT_CLAIM_NOTE,
} from "../src/lib/nba/evaluate.ts";
import type {
  Game,
  GamePrediction,
  GradedMarket,
  MarketType,
} from "../src/lib/nba/types.ts";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const seasonsArg = arg("seasons");
const seasons = seasonsArg ? seasonsArg.split(",").map(Number) : undefined;
const testFraction = Number(arg("test") ?? 0.3);

// ── load ────────────────────────────────────────────────────────────────────
const { games, seasons: loadedSeasons, skipped } = loadGames(seasons);
if (games.length === 0) {
  console.error(
    "No games found. Run `node tools/backfill-games.mjs` first (free tier, ~15 min)."
  );
  process.exit(1);
}
const { train, test, splitDate } = chronologicalSplit(games, testFraction);

console.log("=".repeat(78));
console.log("BETBRAIN — NBA WALK-FORWARD BACKTEST");
console.log("=".repeat(78));
console.log(`seasons        : ${loadedSeasons.join(", ")}`);
console.log(`games          : ${games.length} (${skipped} unplayed/malformed rows skipped)`);
console.log(`fit period     : ${train[0]?.date} -> ${train[train.length - 1]?.date}  (${train.length} games)`);
console.log(`test period    : ${splitDate} -> ${test[test.length - 1]?.date}  (${test.length} games)`);
console.log();

// ── group by date, preserving chronological order ───────────────────────────
function byDate(gs: Game[]): Map<string, Game[]> {
  const m = new Map<string, Game[]>();
  for (const g of gs) {
    const arr = m.get(g.date);
    if (arr) arr.push(g);
    else m.set(g.date, [g]);
  }
  return m;
}

interface WalkOptions {
  homeAdvantageElo?: number;
  marginStdDev?: number;
  totalStdDev?: number;
  /** Only games on/after this date are recorded; earlier ones just train. */
  recordFrom?: string;
  collectMarkets: boolean;
}

interface WalkResult {
  samples: DispersionSample[];
  graded: GradedMarket[];
  /** Prediction paired with the game it was made for, for continuous scoring. */
  pairs: { prediction: GamePrediction; actual: Game }[];
  homeWinProbs: { p: number; homeWon: boolean }[];
  skippedInsufficient: number;
}

/**
 * One chronological pass over the whole game list. Everything before
 * `recordFrom` is used only to train the ratings; from that date on, results
 * are recorded too.
 */
function walkForward(all: Game[], opts: WalkOptions): WalkResult {
  // The home edge must be given to BOTH the rating fold and the predictor. Passing
  // it only to predictGame leaves the offense/defense fold still crediting the
  // ~2x-too-high default, so the two halves disagree about what home court is
  // worth and a systematic margin bias survives the fit.
  const engine = new RatingEngine({ homeAdvantageElo: opts.homeAdvantageElo });
  const dates = byDate(all);
  const out: WalkResult = {
    samples: [],
    graded: [],
    pairs: [],
    homeWinProbs: [],
    skippedInsufficient: 0,
  };
  // History used only for rest-day lookups; sliced to the past on every call.
  const seenGames: Game[] = [];

  for (const [date, dayGames] of dates) {
    const snapshot = engine.snapshot(date); // throws on any lookahead
    const record = !opts.recordFrom || date >= opts.recordFrom;

    for (const g of dayGames) {
      const pred = predictGame(snapshot, g.homeId, g.awayId, {
        gameId: g.id,
        date: g.date,
        homeAbbr: g.homeAbbr,
        awayAbbr: g.awayAbbr,
        homeRestDays: restDaysBefore(seenGames, g.homeId, g.date),
        awayRestDays: restDaysBefore(seenGames, g.awayId, g.date),
        homeAdvantageElo: opts.homeAdvantageElo,
        marginStdDev: opts.marginStdDev,
        totalStdDev: opts.totalStdDev,
      });

      if (pred.confidence === "insufficient") {
        // Early-season games where a team has almost no history. Counting these
        // would flatter nothing and distort everything — the model itself says
        // it doesn't know, so we take it at its word.
        if (record) out.skippedInsufficient++;
        continue;
      }

      if (record) {
        out.samples.push({
          expectedMargin: pred.expectedMargin,
          actualMargin: g.margin,
          expectedTotal: pred.expectedTotal,
          actualTotal: g.total,
        });
        out.pairs.push({ prediction: pred, actual: g });
        out.homeWinProbs.push({ p: pred.homeWinProbability, homeWon: g.margin > 0 });

        if (opts.collectMarkets) {
          out.graded.push(...gradeMarkets(expandMarkets(pred), g));
        }
      }
    }

    // Results become visible only after every game that night was predicted.
    for (const g of dayGames) {
      engine.observe(g);
      seenGames.push(g);
    }
  }
  return out;
}

// ── PASS 1: fit on the training period only ─────────────────────────────────
console.log("PASS 1 — fitting dispersion + home edge on the FIT period only...");
const ha = estimateHomeAdvantageElo(train);
// Fit dispersion with the home edge ALREADY corrected, otherwise the residuals
// we measure carry a bias the test pass won't have, and every threshold
// probability downstream inherits the mismatch.
const fitPass = walkForward(train, {
  homeAdvantageElo: ha.elo,
  collectMarkets: false,
});
const disp = estimateDispersion(fitPass.samples);

console.log(`  home advantage : ${ha.elo.toFixed(1)} Elo  (~${(ha.elo / 28).toFixed(2)} pts)`);
console.log(`  margin  sd/bias: ${disp.marginStdDev.toFixed(2)} / ${disp.marginBias.toFixed(2)}`);
console.log(`  total   sd/bias: ${disp.totalStdDev.toFixed(2)} / ${disp.totalBias.toFixed(2)}`);
console.log(`  fitted on      : ${disp.n} games`);
console.log();

// ── PASS 2: evaluate on the unseen test period ──────────────────────────────
console.log("PASS 2 — walking the full timeline, recording only the TEST period...");
const testPass = walkForward(games, {
  homeAdvantageElo: ha.elo,
  marginStdDev: disp.marginStdDev,
  totalStdDev: disp.totalStdDev,
  recordFrom: splitDate,
  collectMarkets: true,
});
console.log(
  `  graded ${testPass.graded.length.toLocaleString()} propositions across ` +
    `${testPass.homeWinProbs.length.toLocaleString()} test games ` +
    `(${testPass.skippedInsufficient} skipped as insufficient)`
);
console.log();

// ── headline: moneyline skill ───────────────────────────────────────────────
const mlGraded: GradedMarket[] = testPass.homeWinProbs.map((r, i) => ({
  gameId: i,
  date: "",
  market: "moneyline" as MarketType,
  selection: "HOME ML",
  line: null,
  probability: r.p,
  outcome: r.homeWon,
}));

console.log("=".repeat(78));
console.log("HEADLINE — CAN IT PREDICT WHO WINS?");
console.log("=".repeat(78));
console.log(formatReport(evaluate(mlGraded, "Home moneyline (test period)")));

const homeBase = mlGraded.filter((m) => m.outcome).length / mlGraded.length;
console.log(`\nBASELINE TO BEAT — "always pick the home team": ${(homeBase * 100).toFixed(1)}%`);
console.log(
  "A Brier skill score above 0 means the model knows something beyond that base rate.\n"
);

// ── continuous accuracy ─────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("HOW CLOSE ARE THE NUMBERS?");
console.log("=".repeat(78));
const cont = scoreMarginAndTotal(testPass.pairs);
console.log(formatContinuousReport(cont.margin));
console.log(formatContinuousReport(cont.total));

// ── per-market breakdown ────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("EVERY MARKET TYPE");
console.log("=".repeat(78));
const byMarket = new Map<MarketType, GradedMarket[]>();
for (const g of testPass.graded) {
  const arr = byMarket.get(g.market);
  if (arr) arr.push(g);
  else byMarket.set(g.market, [g]);
}
const rows: string[] = [];
rows.push(
  "market".padEnd(24) +
    "n".padStart(9) +
    "base".padStart(8) +
    "acc".padStart(8) +
    "brier".padStart(9) +
    "skill".padStart(9) +
    "maxCalErr".padStart(11)
);
rows.push("-".repeat(78));
for (const [market, list] of [...byMarket.entries()].sort()) {
  const r = evaluate(list, market);
  const gradeable = list.filter((g) => g.outcome !== null);
  const base = gradeable.filter((g) => g.outcome).length / (gradeable.length || 1);
  rows.push(
    market.padEnd(24) +
      r.n.toLocaleString().padStart(9) +
      base.toFixed(3).padStart(8) +
      `${(r.accuracy * 100).toFixed(1)}%`.padStart(8) +
      r.brierScore.toFixed(4).padStart(9) +
      r.brierSkillScore.toFixed(4).padStart(9) +
      `${(r.maxCalibrationError * 100).toFixed(1)}%`.padStart(11)
  );
}
console.log(rows.join("\n"));

console.log(
  "\n" +
    [
      "READ THE 'base' COLUMN BEFORE THE 'skill' COLUMN.",
      "expandMarkets emits BOTH sides of every proposition (HOME ML and AWAY ML,",
      "OVERTIME YES and OVERTIME NO). Pooling both sides forces the base rate to",
      "~0.500 by construction, and skill is measured against that base rate — so a",
      "two-sided market is being compared to a coin flip, not to its natural rate.",
      "",
      "That inflates skill wherever the real-world rate is lopsided. 'overtime' is",
      "the clearest case: the model says ~3% / ~97% and is right, which is worth",
      "little — overtime is simply rare. Its high skill number reflects the 0.500",
      "reference, NOT an ability to pick which games go to overtime.",
      "",
      "The honest headline is the moneyline block above, scored on the home side",
      "only against its true 0.548 base rate.",
    ].join("\n")
);

const pushes = testPass.graded.filter((g) => g.outcome === null).length;
console.log(
  `\n${pushes.toLocaleString()} propositions graded as pushes (excluded from scoring, not counted as losses).`
);
console.log(`\n${NO_PROFIT_CLAIM_NOTE}`);
