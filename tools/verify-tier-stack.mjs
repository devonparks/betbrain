/**
 * Self-verifying harness for src/lib/tier-stack.ts
 *
 * Run:  node tools/verify-tier-stack.mjs
 *
 * No test framework, no new dependencies, no network. It is JULY 2026 (NBA
 * offseason) — every input below is a handcrafted fixture, nothing is fetched.
 *
 * The module is loaded directly from TypeScript: first via Node's built-in type
 * stripping, and if that is unavailable it falls back to transpiling with the
 * `typescript` compiler that already ships in node_modules (used by `npx tsc`).
 * Either way the assertions run against the REAL module, not a copy of it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(HERE, "..", "src", "lib", "tier-stack.ts");

async function loadModule() {
  try {
    return await import(pathToFileURL(MODULE_PATH).href);
  } catch (directErr) {
    try {
      const ts = (await import("typescript")).default;
      const src = readFileSync(MODULE_PATH, "utf8");
      const js = ts.transpileModule(src, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
      const b64 = Buffer.from(js, "utf8").toString("base64");
      return await import(`data:text/javascript;base64,${b64}`);
    } catch (fallbackErr) {
      console.error("Could not load src/lib/tier-stack.ts");
      console.error("  direct import:", directErr.message);
      console.error("  ts transpile :", fallbackErr.message);
      process.exit(1);
    }
  }
}

// ============ TINY ASSERT HARNESS ============

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}, got ${actual}`);
}

function near(name, actual, expected, tol = 1e-6) {
  check(
    name,
    Math.abs(actual - expected) <= tol,
    `expected ~${expected}, got ${actual}`
  );
}

// ============ FIXTURE BUILDERS ============

/**
 * Build a game log list (most recent first).
 * `points` drives the stat under test; DNPs are entered as null.
 */
function logs(points, opts = {}) {
  const { minutes = 34, minutesList = null, opponent = "OPP" } = opts;
  return points.map((p, i) => {
    if (p === null) {
      return {
        points: 0,
        rebounds: 0,
        assists: 0,
        threes: 0,
        minutes: 0,
        wasHome: i % 2 === 0,
        opponent,
        didNotPlay: true,
      };
    }
    return {
      points: p,
      rebounds: Math.round(p / 4),
      assists: Math.round(p / 5),
      threes: Math.round(p / 9),
      minutes: minutesList ? minutesList[i] : minutes,
      wasHome: i % 2 === 0,
      opponent,
    };
  });
}

function player(playerId, name, points, opts = {}) {
  return {
    playerId,
    name,
    team: opts.team ?? "CLE",
    logs: logs(points, opts),
    isStarter: opts.isStarter ?? true,
    usageRate: opts.usageRate,
    upcomingGameId: opts.upcomingGameId,
  };
}

const STAR_LINE = [28, 31, 24, 26, 33, 22, 29, 27, 30, 25, 34, 23, 26, 28, 31];
const SQUEAKER_LINE = [11, 12, 10, 13, 11, 10, 12, 11, 13, 10, 12, 11, 10, 12, 11];

// ============ RUN ============

const M = await loadModule();
const { clearedRate, floorScore, buildTierStack, suggestTiers } = M;

console.log("tier-stack verification (offline fixtures, July 2026 offseason)\n");

// --- 1. DNP exclusion from the denominator ---
{
  // 6 entries, 2 of them DNPs. 4 played, 3 of those cleared 20+.
  const l = logs([25, null, 22, 18, null, 21]);
  const r = clearedRate(l, "points", 20, 15);
  eq("DNPs excluded from denominator (played === 4)", r.played, 4);
  eq("cleared counted correctly (3 of 4)", r.cleared, 3);
  near("rate is 3/4, not 3/6", r.rate, 0.75);
}

// --- 2. plus-threshold uses >= (a game exactly on the number clears) ---
{
  const r = clearedRate(logs([10, 10, 10]), "points", 10, 15);
  eq('"10+" counts a 10-point game as cleared', r.cleared, 3);
}

// --- 3. lastN window applies to PLAYED games ---
{
  // 5 played games (30,30,30,5,5) interleaved with DNPs; window of 3 sees only 30s.
  const l = logs([30, null, 30, null, 30, 5, 5]);
  const r = clearedRate(l, "points", 20, 3);
  eq("lastN windows the last N played games (played === 3)", r.played, 3);
  eq("lastN window ignores older games (cleared === 3)", r.cleared, 3);
}

// --- 4. margin beats a squeaker at an identical hit rate ---
{
  const star = player("p-star", "Wide Margin", STAR_LINE);
  const squeaker = player("p-sq", "Barely There", SQUEAKER_LINE);
  const rStar = clearedRate(star.logs, "points", 10, 15);
  const rSq = clearedRate(squeaker.logs, "points", 10, 15);
  const sStar = floorScore(star, "points", 10);
  const sSq = floorScore(squeaker, "points", 10);
  check(
    "both players are 15/15 at 10+ (identical hit rate)",
    rStar.rate === 1 && rSq.rate === 1,
    `star ${rStar.rate}, squeaker ${rSq.rate}`
  );
  check(
    "wide margin scores higher than squeaker at same hit rate",
    sStar > sSq,
    `wide ${sStar} vs squeaker ${sSq}`
  );
}

// --- 5. minutes stability matters ---
{
  const steady = player("p-steady", "Steady Minutes", STAR_LINE, {
    minutesList: new Array(15).fill(34),
  });
  const erratic = player("p-erratic", "Erratic Minutes", STAR_LINE, {
    minutesList: [12, 40, 8, 44, 15, 41, 10, 43, 13, 39, 9, 45, 14, 38, 11],
  });
  check(
    "stable minutes score higher than erratic minutes on identical scoring",
    floorScore(steady, "points", 10) > floorScore(erratic, "points", 10),
    `steady ${floorScore(steady, "points", 10)} vs erratic ${floorScore(erratic, "points", 10)}`
  );
}

// --- 6. a player who never played scores 0 ---
{
  const ghost = player("p-ghost", "Never Played", [null, null, null]);
  eq("player with zero played games scores 0", floorScore(ghost, "points", 10), 0);
}

// --- 7. banned players are absent; maxLegs respected ---
{
  const pool = [
    player("a", "Alpha", STAR_LINE, { team: "CLE", upcomingGameId: "g1" }),
    player("b", "Bravo", STAR_LINE, { team: "BOS", upcomingGameId: "g2" }),
    player("c", "Charlie", STAR_LINE, { team: "DEN", upcomingGameId: "g3" }),
    player("d", "Delta", STAR_LINE, { team: "MIA", upcomingGameId: "g4" }),
  ];
  const stack = buildTierStack({
    players: pool,
    stat: "points",
    threshold: 10,
    maxLegs: 2,
    excludePlayerIds: ["b"],
  });
  eq("maxLegs respected (2 legs)", stack.legs.length, 2);
  check(
    "excluded player absent from legs",
    !stack.legs.some((l) => l.playerId === "b"),
    stack.legs.map((l) => l.playerId).join(",")
  );
  check(
    "banned-player exclusion is surfaced in warnings",
    stack.warnings.some((w) => w.includes("banned") && w.includes("Bravo")),
    JSON.stringify(stack.warnings)
  );
  check(
    "legs sorted by floorScore descending",
    stack.legs.every(
      (l, i) => i === 0 || stack.legs[i - 1].floorScore >= l.floorScore
    ),
    stack.legs.map((l) => l.floorScore).join(",")
  );
}

// --- 8. correlation warning always fires, even with disjoint games ---
{
  const pool = [
    player("a", "Alpha", STAR_LINE, { team: "CLE", upcomingGameId: "g1" }),
    player("b", "Bravo", STAR_LINE, { team: "BOS", upcomingGameId: "g2" }),
  ];
  const stack = buildTierStack({ players: pool, stat: "points", threshold: 10 });
  check(
    "independence warning is unconditional",
    stack.warnings.some((w) => w.includes("naiveCombinedProbability")),
    JSON.stringify(stack.warnings)
  );
  eq("no same-game groups when games are disjoint", stack.correlatedGroups.length, 0);
}

// --- 9. same-game correlation warning fires and names the players ---
{
  const pool = [
    player("a", "Alpha", STAR_LINE, { team: "CLE", upcomingGameId: "CLE@BOS" }),
    player("b", "Bravo", STAR_LINE, { team: "BOS", upcomingGameId: "CLE@BOS" }),
    player("c", "Charlie", STAR_LINE, { team: "DEN", upcomingGameId: "DEN@MIA" }),
  ];
  const stack = buildTierStack({ players: pool, stat: "points", threshold: 10 });
  eq("one correlated group detected", stack.correlatedGroups.length, 1);
  check(
    "correlated group names both same-game players",
    stack.correlatedGroups[0].playerNames.includes("Alpha") &&
      stack.correlatedGroups[0].playerNames.includes("Bravo"),
    JSON.stringify(stack.correlatedGroups)
  );
  check(
    "same-game warning text fires",
    stack.warnings.some((w) => w.includes("same game") && w.includes("CLE@BOS")),
    JSON.stringify(stack.warnings)
  );
}

// --- 10. naive product math + it is never presented as certainty ---
{
  const pool = [
    player("a", "Alpha", STAR_LINE, { team: "CLE", upcomingGameId: "g1" }),
    player("b", "Bravo", STAR_LINE, { team: "BOS", upcomingGameId: "g2" }),
    player("c", "Charlie", STAR_LINE, { team: "DEN", upcomingGameId: "g3" }),
  ];
  const stack = buildTierStack({ players: pool, stat: "points", threshold: 10 });
  const product = stack.legs.reduce((acc, l) => acc * l.legProbability, 1);
  near(
    "naiveCombinedProbability equals the product of leg probabilities",
    stack.naiveCombinedProbability,
    Math.round(product * 1e6) / 1e6,
    1e-6
  );
  check(
    "a perfect 15/15 leg is smoothed below 1.0",
    stack.legs.every((l) => l.hitRate === 1 && l.legProbability < 1),
    stack.legs.map((l) => `${l.hitRate}/${l.legProbability}`).join(",")
  );
  check(
    "naive probability is below the weakest single leg",
    stack.naiveCombinedProbability <
      Math.min(...stack.legs.map((l) => l.legProbability)),
    `${stack.naiveCombinedProbability}`
  );
}

// --- 11. minFloorScore filters weak legs ---
{
  const pool = [
    player("a", "Alpha", STAR_LINE, { team: "CLE", upcomingGameId: "g1" }),
    // clears 10+ only about half the time
    player("w", "Weak Sauce", [8, 12, 7, 14, 6, 11, 9, 13, 5, 10, 8, 12, 7, 9, 11], {
      team: "SAS",
      upcomingGameId: "g9",
      minutes: 18,
    }),
  ];
  const stack = buildTierStack({
    players: pool,
    stat: "points",
    threshold: 10,
    minFloorScore: 70,
  });
  check(
    "low floorScore player filtered out by minFloorScore",
    stack.legs.length === 1 && stack.legs[0].playerId === "a",
    stack.legs.map((l) => `${l.playerId}:${l.floorScore}`).join(",")
  );
}

// --- 12. degenerate / empty inputs do not throw ---
{
  const empty = buildTierStack({ players: [], stat: "points", threshold: 10 });
  eq("empty player pool yields 0 legs", empty.legs.length, 0);
  eq("empty pool naiveCombinedProbability is 0", empty.naiveCombinedProbability, 0);
  check(
    "empty pool still warns",
    empty.warnings.some((w) => w.includes("No players supplied")),
    JSON.stringify(empty.warnings)
  );

  const degenerate = buildTierStack({
    players: [player("a", "Alpha", STAR_LINE, { upcomingGameId: "g1" })],
    stat: "points",
    threshold: 0,
  });
  check(
    "threshold of 0 is flagged as degenerate",
    degenerate.warnings.some((w) => w.includes("degenerate")),
    JSON.stringify(degenerate.warnings)
  );

  const allDnp = buildTierStack({
    players: [player("g", "Ghost", [null, null, null], { upcomingGameId: "g1" })],
    stat: "points",
    threshold: 10,
  });
  eq("all-DNP player produces no legs", allDnp.legs.length, 0);
}

// --- 13. thin-sample warning ---
{
  const stack = buildTierStack({
    players: [player("t", "Two Games", [30, 28], { upcomingGameId: "g1" })],
    stat: "points",
    threshold: 10,
    minFloorScore: 0,
  });
  check(
    "thin sample is warned about",
    stack.warnings.some((w) => w.includes("Thin sample")),
    JSON.stringify(stack.warnings)
  );
}

// --- 14. suggestTiers derives a ladder from the data ---
{
  const scorers = [
    player("a", "Alpha", STAR_LINE, { upcomingGameId: "g1" }),
    player("b", "Bravo", [26, 22, 30, 19, 27, 24, 33, 21, 25, 29, 18, 31, 23, 26, 20], {
      upcomingGameId: "g2",
    }),
    player("c", "Charlie", [21, 27, 14, 25, 30, 17, 24, 28, 13, 26, 22, 32, 16, 29, 23], {
      upcomingGameId: "g3",
    }),
  ];
  const tiers = suggestTiers(scorers, "points");
  eq("suggestTiers returns three tiers", tiers.length, 3);
  check(
    "tier thresholds strictly increase",
    tiers[0].threshold < tiers[1].threshold &&
      tiers[1].threshold < tiers[2].threshold,
    tiers.map((t) => t.threshold).join(" < ")
  );
  check(
    "floor tier hit rate is at least the reach tier hit rate",
    tiers[0].medianHitRate >= tiers[2].medianHitRate,
    `${tiers[0].medianHitRate} vs ${tiers[2].medianHitRate}`
  );

  const roleGuys = [
    player("r1", "Role One", [9, 11, 7, 12, 8, 10, 6, 13, 9, 11, 7, 10, 8, 12, 9], {
      upcomingGameId: "g4",
    }),
    player("r2", "Role Two", [8, 10, 12, 6, 11, 9, 7, 10, 13, 8, 9, 11, 7, 12, 10], {
      upcomingGameId: "g5",
    }),
  ];
  const lowTiers = suggestTiers(roleGuys, "points");
  check(
    "ladder is derived from the pool, not hardcoded (stars ladder > role-player ladder)",
    tiers[2].threshold > lowTiers[2].threshold,
    `stars reach ${tiers[2].threshold}, role guys reach ${lowTiers[2].threshold}`
  );
  eq("suggestTiers on an empty pool returns []", suggestTiers([], "points").length, 0);
  eq(
    "suggestTiers ignores players with no played games",
    suggestTiers([player("g", "Ghost", [null, null])], "points").length,
    0
  );
}

// --- 15. leg payload sanity (form + home/away split + why string) ---
{
  const stack = buildTierStack({
    players: [player("a", "Alpha", STAR_LINE, { upcomingGameId: "g1" })],
    stat: "points",
    threshold: 10,
  });
  const leg = stack.legs[0];
  check(
    "leg carries home/away split",
    typeof leg.homeAwaySplit.home === "number" &&
      typeof leg.homeAwaySplit.away === "number" &&
      leg.homeAwaySplit.home > 0 &&
      leg.homeAwaySplit.away > 0,
    JSON.stringify(leg.homeAwaySplit)
  );
  check(
    "leg carries recent form direction",
    ["up", "down", "stable"].includes(leg.recentForm.direction),
    leg.recentForm.direction
  );
  check(
    "why string explains the floor",
    leg.why.includes("10+ points") && leg.why.includes("cushion"),
    leg.why
  );
}

// --- 16. big-stack warning (Devon's 25-leg ticket) ---
{
  const pool = Array.from({ length: 12 }, (_, i) =>
    player(`p${i}`, `Player ${i}`, STAR_LINE, {
      team: `T${i}`,
      upcomingGameId: `g${i}`,
    })
  );
  const stack = buildTierStack({ players: pool, stat: "points", threshold: 10 });
  eq("all 12 disjoint-game legs make the stack", stack.legs.length, 12);
  check(
    "10+ leg stack triggers the stacking-risk warning",
    stack.warnings.some((w) => w.includes("legs stacked")),
    JSON.stringify(stack.warnings)
  );
}

// --- 17. availability haircut spans the RAW games the window covers ---
{
  // P D P D P D P with lastN=3: the 3 played games span the first 5 raw logs,
  // which contain 2 DNPs. Availability is 3/5, NOT 3/4.
  const p = player("a", "Alpha", [28, null, 31, null, 24, null, 26]);
  const expected = 100 * (3 / 8) * (0.85 + 0.15 * (3 / 5)); // 35.25
  near(
    "availability counts every DNP inside the window's raw span",
    floorScore(p, "points", 10, 3),
    Math.round(expected * 10) / 10,
    0.05
  );
}

// --- 18. a long stack does not collapse to a flat 0 ---
{
  const coinflips = Array.from({ length: 25 }, (_, i) =>
    player(`p${i}`, `P${i}`, [12, 8, 12, 8, 12, 8, 12, 8, 12, 8, 12, 8, 12, 8, 11], {
      team: `T${i}`,
      upcomingGameId: `g${i}`,
    })
  );
  const stack = buildTierStack({
    players: coinflips,
    stat: "points",
    threshold: 10,
    minFloorScore: 0,
  });
  eq("25 coin-flip legs all make the stack", stack.legs.length, 25);
  check(
    "tiny combined probability is reported, not rounded away to 0",
    stack.naiveCombinedProbability > 0,
    `${stack.naiveCombinedProbability}`
  );
  const truth = Math.pow(stack.legs[0].legProbability, 25);
  check(
    "tiny combined probability is within 0.01% of the true product",
    Math.abs(stack.naiveCombinedProbability - truth) / truth < 1e-4,
    `${stack.naiveCombinedProbability} vs ${truth}`
  );
}

// --- 19. maxLegs=0 does not claim nobody qualified ---
{
  const stack = buildTierStack({
    players: [player("a", "Alpha", STAR_LINE, { upcomingGameId: "g1" })],
    stat: "points",
    threshold: 10,
    maxLegs: 0,
  });
  eq("maxLegs 0 yields no legs", stack.legs.length, 0);
  check(
    "maxLegs 0 does not falsely claim nobody hit the floorScore bar",
    !stack.warnings.some((w) => w.includes("No player reached")),
    JSON.stringify(stack.warnings)
  );
}

// --- 20. missing upcomingGameId degrades correlation detection LOUDLY ---
{
  const stack = buildTierStack({
    players: [
      player("a", "Alpha", STAR_LINE, { team: "CLE" }),
      player("b", "Bravo", STAR_LINE, { team: "BOS" }),
    ],
    stat: "points",
    threshold: 10,
  });
  eq("no gameId means no cross-team group is detected", stack.correlatedGroups.length, 0);
  check(
    "the undetectable-correlation gap is warned about, not hidden",
    stack.warnings.some(
      (w) => w.includes("no upcomingGameId") && w.includes("OPPOSING")
    ),
    JSON.stringify(stack.warnings)
  );
}

// --- 21. non-finite threshold never leaks NaN into a score ---
{
  const p = player("a", "Alpha", STAR_LINE, { upcomingGameId: "g1" });
  eq("NaN threshold scores 0, not NaN", floorScore(p, "points", NaN), 0);
  const stack = buildTierStack({ players: [p], stat: "points", threshold: NaN });
  check(
    "NaN threshold produces no legs and no NaN probability",
    stack.legs.length === 0 && Number.isFinite(stack.naiveCombinedProbability),
    `${stack.legs.length} / ${stack.naiveCombinedProbability}`
  );
}

// ============ SUMMARY ============

console.log("");
console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
process.exit(0);
