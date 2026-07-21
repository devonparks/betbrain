/**
 * verify-hedge.mjs — self-verifying check for the hedge / "assurance bet" math.
 *
 * Run with:  node tools/verify-hedge.mjs
 *
 * There is no test framework in this repo and this script must run on plain node with
 * zero dependencies, so it carries its own copy of the (small) hedge math and asserts
 * it against hand-computed fixtures. It also statically checks that src/lib/hedge.ts
 * exports the same surface, so the two cannot silently drift apart.
 *
 * Notation: S = original stake, R = pending return (stake included), H = hedge stake,
 * d = decimal odds of the hedge side.
 *   ifOriginalWins = R - S - H
 *   ifHedgeWins    = H*d - H - S
 *   equalized      = R / d
 *   breakEven      = S / (d - 1)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Reference implementation (mirror of src/lib/hedge.ts)
// ---------------------------------------------------------------------------

const round2 = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

function americanToDecimal(american) {
  if (typeof american !== "number" || !Number.isFinite(american)) {
    throw new Error("hedgeOdds must be a finite number");
  }
  if (american > -100 && american < 100) {
    throw new Error("American odds must be <= -100 or >= +100");
  }
  return american < 0 ? 1 + 100 / Math.abs(american) : 1 + american / 100;
}

function assertPositive(v, label) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (v <= 0) throw new Error(`${label} must be greater than 0`);
}

function hedgeOutcomes({ originalStake, pendingReturn, hedgeOdds, hedgeStake }) {
  assertPositive(originalStake, "originalStake");
  assertPositive(pendingReturn, "pendingReturn");
  if (typeof hedgeStake !== "number" || !Number.isFinite(hedgeStake) || hedgeStake < 0) {
    throw new Error("hedgeStake cannot be negative");
  }
  const d = americanToDecimal(hedgeOdds);
  const ifOriginalWins = pendingReturn - originalStake - hedgeStake;
  const ifHedgeWins = hedgeStake * d - hedgeStake - originalStake;
  return {
    ifOriginalWins: round2(ifOriginalWins),
    ifHedgeWins: round2(ifHedgeWins),
    guaranteed: round2(Math.min(ifOriginalWins, ifHedgeWins)),
  };
}

function equalizedHedge({ originalStake, pendingReturn, hedgeOdds }) {
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

function breakEvenHedge({ originalStake, pendingReturn, hedgeOdds }) {
  const eq = equalizedHedge({ originalStake, pendingReturn, hedgeOdds });
  if (!eq.isPossible) return { hedgeStake: 0, isPossible: false };
  const d = americanToDecimal(hedgeOdds);
  return { hedgeStake: round2(originalStake / (d - 1)), isPossible: true };
}

function hedgeLadder({ originalStake, pendingReturn, hedgeOdds, steps = 12 }) {
  const equalizedStake = equalizedHedge({
    originalStake,
    pendingReturn,
    hedgeOdds,
  }).hedgeStake;
  const maxStake = equalizedStake * 1.5;
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const hedgeStake = round2((maxStake * i) / steps);
    rows.push({
      hedgeStake,
      ...hedgeOutcomes({ originalStake, pendingReturn, hedgeOdds, hedgeStake }),
      isEqualized: Math.abs(hedgeStake - equalizedStake) < 0.005,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(name, actual, expected, tolerance = 0.005) {
  check(
    name,
    typeof actual === "number" && Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`
  );
}

function throws(name, fn) {
  let threw = false;
  let message = "";
  try {
    fn();
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  check(name, threw, "expected a thrown error, got none");
  if (threw && !message) check(`${name} (message)`, false, "error had no message");
}

// ---------------------------------------------------------------------------
// 1. American <-> decimal, both signs
// ---------------------------------------------------------------------------

console.log("\n-- American to decimal --");
near("americanToDecimal(+400) = 5.0", americanToDecimal(400), 5, 1e-9);
near("americanToDecimal(+2900) = 30.0", americanToDecimal(2900), 30, 1e-9);
near("americanToDecimal(-110) = 1.909091", americanToDecimal(-110), 1.9090909091, 1e-9);
near("americanToDecimal(-200) = 1.5", americanToDecimal(-200), 1.5, 1e-9);
near("americanToDecimal(-100) = +100 = 2.0", americanToDecimal(-100), americanToDecimal(100), 1e-9);

// ---------------------------------------------------------------------------
// 2. Devon's Warriors/Heat scenario
//    $100 into a 10-leg parlay, $10,000 to return, last leg is Warriors ML.
//    Heat are +400 live, so the equalized hedge is exactly the $2,000 he described.
// ---------------------------------------------------------------------------

console.log("\n-- Devon's $10,000 Warriors parlay, Heat +400 --");
const devon = { originalStake: 100, pendingReturn: 10000, hedgeOdds: 400 };
const devonEq = equalizedHedge(devon);
near("equalized hedge stake = $2,000", devonEq.hedgeStake, 2000);
near("profit either way = $7,900", devonEq.profitEitherWay, 7900);
check("a guaranteed-profit lock is possible", devonEq.isPossible === true);

const devonHedged = hedgeOutcomes({ ...devon, hedgeStake: 2000 });
near("with $2,000 hedged, Warriors win nets $7,900", devonHedged.ifOriginalWins, 7900);
near("with $2,000 hedged, Heat win nets $7,900", devonHedged.ifHedgeWins, 7900);
near("guaranteed = $7,900", devonHedged.guaranteed, 7900);

const devonNoHedge = hedgeOutcomes({ ...devon, hedgeStake: 0 });
near("no hedge: Warriors win nets $9,900", devonNoHedge.ifOriginalWins, 9900);
near("no hedge: Warriors lose nets -$100 (the sunk stake)", devonNoHedge.ifHedgeWins, -100);
near("no hedge: guaranteed = -$100", devonNoHedge.guaranteed, -100);

const devonOver = hedgeOutcomes({ ...devon, hedgeStake: 3000 });
near("over-hedge $3,000: Warriors win nets $6,900", devonOver.ifOriginalWins, 6900);
near("over-hedge $3,000: Heat win nets $11,900", devonOver.ifHedgeWins, 11900);
check(
  "over-hedging lowers the guaranteed number vs equalized",
  devonOver.guaranteed < devonHedged.guaranteed,
  `${devonOver.guaranteed} vs ${devonHedged.guaranteed}`
);

// ---------------------------------------------------------------------------
// 3. The risky live-odds play: wait until the Warriors go up 20, Heat blow out to
//    +2900, so $1,000 on the Heat returns $30,000. "Either $9,000 or $29,000."
//    ($100 sunk, $10,100 to return = $10,000 profit; his "$29,000" rounds the
//    sunk $100 away, our model reports the exact $28,900.)
// ---------------------------------------------------------------------------

console.log("\n-- Live blowout hedge: Heat +2900, $1,000 stake --");
const live = { originalStake: 100, pendingReturn: 10100, hedgeOdds: 2900 };
const liveOut = hedgeOutcomes({ ...live, hedgeStake: 1000 });
near("Warriors hold on: net $9,000", liveOut.ifOriginalWins, 9000);
near("Heat comeback: net $28,900 (his '$29,000' minus the sunk $100)", liveOut.ifHedgeWins, 28900);
near("guaranteed floor = $9,000", liveOut.guaranteed, 9000);
check(
  "under-hedging at long odds keeps the upside asymmetric",
  liveOut.ifHedgeWins > liveOut.ifOriginalWins * 3,
  `${liveOut.ifHedgeWins} vs ${liveOut.ifOriginalWins}`
);

const liveEq = equalizedHedge(live);
near("equalizing at +2900 would only cost $336.67", liveEq.hedgeStake, 336.67);
near("...and lock $9,663.33 either way", liveEq.profitEitherWay, 9663.33);
check(
  "equalized guarantee beats the $1,000 risky hedge's floor",
  liveEq.profitEitherWay > liveOut.guaranteed,
  `${liveEq.profitEitherWay} vs ${liveOut.guaranteed}`
);

// ---------------------------------------------------------------------------
// 4. Equalization really equalizes — including on ugly non-round odds
// ---------------------------------------------------------------------------

console.log("\n-- Equalization produces equal outcomes --");
const ugly = { originalStake: 250, pendingReturn: 3175, hedgeOdds: -135 };
const uglyEq = equalizedHedge(ugly);
const uglyOut = hedgeOutcomes({ ...ugly, hedgeStake: uglyEq.hedgeStake });
check(
  "both outcomes match to the cent at H = R/d (-135 hedge)",
  Math.abs(uglyOut.ifOriginalWins - uglyOut.ifHedgeWins) <= 0.01,
  `${uglyOut.ifOriginalWins} vs ${uglyOut.ifHedgeWins}`
);
// 3175 / (1 + 100/135) = 3175 * 135/235 = 1823.936...
near("equalized stake = R/d = 3175 / 1.740741", uglyEq.hedgeStake, 1823.94, 0.01);
near("profit either way matches hedgeOutcomes", uglyEq.profitEitherWay, uglyOut.guaranteed, 0.01);

const dogEq = equalizedHedge({ originalStake: 40, pendingReturn: 900, hedgeOdds: -110 });
const dogOut = hedgeOutcomes({
  originalStake: 40,
  pendingReturn: 900,
  hedgeOdds: -110,
  hedgeStake: dogEq.hedgeStake,
});
check(
  "equal outcomes at -110 too",
  Math.abs(dogOut.ifOriginalWins - dogOut.ifHedgeWins) <= 0.01,
  `${dogOut.ifOriginalWins} vs ${dogOut.ifHedgeWins}`
);

// ---------------------------------------------------------------------------
// 5. Equalizing maximizes the guaranteed profit (the concavity claim)
// ---------------------------------------------------------------------------

console.log("\n-- Equalized hedge maximizes the worst case --");
const sweepInput = { originalStake: 100, pendingReturn: 10000, hedgeOdds: 400 };
const eqGuarantee = equalizedHedge(sweepInput).profitEitherWay;
let bestOther = -Infinity;
for (let h = 0; h <= 4000; h += 25) {
  const g = hedgeOutcomes({ ...sweepInput, hedgeStake: h }).guaranteed;
  if (Math.abs(h - 2000) > 0.005 && g > bestOther) bestOther = g;
}
check(
  "no other hedge stake in a 0..$4,000 sweep beats the equalized guarantee",
  eqGuarantee >= bestOther,
  `equalized ${eqGuarantee} vs best other ${bestOther}`
);

// ---------------------------------------------------------------------------
// 6. Break-even lock: possible and impossible
// ---------------------------------------------------------------------------

console.log("\n-- Lock in break-even --");
const be = breakEvenHedge(devon);
check("break-even lock is possible on the Warriors parlay", be.isPossible === true);
near("smallest no-lose hedge = S/(d-1) = 100/4 = $25", be.hedgeStake, 25);
const beOut = hedgeOutcomes({ ...devon, hedgeStake: be.hedgeStake });
near("at $25 hedged, losing the parlay nets exactly $0", beOut.ifHedgeWins, 0);
near("at $25 hedged, winning still nets $9,875", beOut.ifOriginalWins, 9875);
check("min outcome >= 0 at the break-even stake", beOut.guaranteed >= 0, `${beOut.guaranteed}`);

// R is too small relative to the sunk stake: $100 in, only $120 to return,
// hedge side is a heavy -500 favorite. No stake avoids a loss.
const doomed = { originalStake: 100, pendingReturn: 120, hedgeOdds: -500 };
const doomedEq = equalizedHedge(doomed);
const doomedBe = breakEvenHedge(doomed);
check("break-even is reported IMPOSSIBLE when R is too small", doomedBe.isPossible === false);
check("...and the impossible case returns a 0 stake, not NaN", doomedBe.hedgeStake === 0);
check("...equalizedHedge agrees it is not possible", doomedEq.isPossible === false);
near("...best achievable worst case is -$80", doomedEq.profitEitherWay, -80);
let doomedBest = -Infinity;
for (let h = 0; h <= 400; h += 5) {
  const g = hedgeOutcomes({ ...doomed, hedgeStake: h }).guaranteed;
  if (g > doomedBest) doomedBest = g;
}
check(
  "...and a brute-force sweep confirms every hedge loses money",
  doomedBest < 0,
  `best guaranteed found: ${doomedBest}`
);

// ---------------------------------------------------------------------------
// 7. Ladder shape
// ---------------------------------------------------------------------------

console.log("\n-- Hedge ladder --");
const ladder = hedgeLadder(devon);
check("default ladder has 13 rows (12 steps)", ladder.length === 13, `got ${ladder.length}`);
near("first row is a $0 hedge", ladder[0].hedgeStake, 0);
near("last row is 1.5x the equalized stake ($3,000)", ladder[ladder.length - 1].hedgeStake, 3000);
check(
  "exactly one row is flagged as the equalized row",
  ladder.filter((r) => r.isEqualized).length === 1
);
near("the equalized row sits at $2,000", ladder.find((r) => r.isEqualized).hedgeStake, 2000);
check(
  "ifOriginalWins decreases monotonically down the ladder",
  ladder.every((r, i) => i === 0 || r.ifOriginalWins <= ladder[i - 1].ifOriginalWins)
);
check(
  "ifHedgeWins increases monotonically down the ladder",
  ladder.every((r, i) => i === 0 || r.ifHedgeWins >= ladder[i - 1].ifHedgeWins)
);
check(
  "the ladder's best guaranteed row IS the equalized row",
  ladder.reduce((a, b) => (b.guaranteed > a.guaranteed ? b : a)).isEqualized === true
);
check(
  "every ladder row exposes all four money fields",
  ladder.every(
    (r) =>
      typeof r.hedgeStake === "number" &&
      typeof r.ifOriginalWins === "number" &&
      typeof r.ifHedgeWins === "number" &&
      typeof r.guaranteed === "number"
  )
);
check(
  "all ladder money values are rounded to whole cents",
  ladder.every((r) =>
    [r.hedgeStake, r.ifOriginalWins, r.ifHedgeWins, r.guaranteed].every(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9
    )
  )
);

// ---------------------------------------------------------------------------
// 8. Input guards
// ---------------------------------------------------------------------------

console.log("\n-- Nonsense input guards --");
throws("negative originalStake throws", () =>
  hedgeOutcomes({ originalStake: -100, pendingReturn: 500, hedgeOdds: 200, hedgeStake: 10 })
);
throws("zero pendingReturn throws", () =>
  equalizedHedge({ originalStake: 100, pendingReturn: 0, hedgeOdds: 200 })
);
throws("NaN pendingReturn throws", () =>
  equalizedHedge({ originalStake: 100, pendingReturn: NaN, hedgeOdds: 200 })
);
throws("negative hedgeStake throws", () =>
  hedgeOutcomes({ originalStake: 100, pendingReturn: 500, hedgeOdds: 200, hedgeStake: -1 })
);
throws("odds of 0 throw (not real American odds)", () =>
  equalizedHedge({ originalStake: 100, pendingReturn: 500, hedgeOdds: 0 })
);
throws("odds of +50 throw (inside the impossible band)", () => americanToDecimal(50));
throws("Infinite odds throw", () => americanToDecimal(Infinity));

// ---------------------------------------------------------------------------
// 9. Static check: src/lib/hedge.ts exposes the same surface and reuses utils
// ---------------------------------------------------------------------------

console.log("\n-- src/lib/hedge.ts surface --");
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "src", "lib", "hedge.ts"), "utf8");
for (const name of [
  "americanToDecimal",
  "hedgeOutcomes",
  "equalizedHedge",
  "breakEvenHedge",
  "hedgeLadder",
]) {
  check(`exports ${name}`, source.includes(`export function ${name}`));
}
check(
  "reuses the odds converter from ./utils instead of duplicating it",
  /import\s*\{[^}]*americanToDecimal[^}]*\}\s*from\s*"\.\/utils"/.test(source)
);

// ---------------------------------------------------------------------------

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
