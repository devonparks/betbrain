/**
 * verify-usage-model.mjs
 *
 * Dependency-free verification for src/lib/usage-model.ts.
 * Run:  node tools/verify-usage-model.mjs
 *
 * There is no test framework in this repo and we are not allowed to add one, so
 * this script does two things:
 *
 *   1. MIRROR — re-implements the model's math in plain JS (below) and runs
 *      handcrafted fixtures against it. The mirror is a line-for-line port of
 *      src/lib/usage-model.ts with the types removed.
 *   2. SOURCE SYNC — reads src/lib/usage-model.ts as TEXT and asserts the real
 *      module still exports the expected functions and still declares the exact
 *      thresholds the mirror assumes. If someone retunes the TS constants and
 *      forgets the mirror, these assertions go red.
 *
 * It is July 2026 (NBA offseason), so every fixture is handcrafted. Nothing here
 * touches the network.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(HERE, "..", "src", "lib", "usage-model.ts");

// ===================== MIRROR OF src/lib/usage-model.ts =====================

const CONFIDENCE_THRESHOLDS = { MIN_SAMPLE: 4, LOW: 4, MODERATE: 6, HIGH: 10 };
const CONFIDENCE_WEIGHT = { insufficient: 0, low: 0.5, moderate: 0.8, high: 1 };
const OVERLAP_DECAY = 0.5;
const USAGE_SIGNAL_PCT = 5;
const MIN_MINUTES_TO_COUNT = 0;

const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

function pctChange(from, to) {
  if (from === 0) return 0;
  return r1(((to - from) / Math.abs(from)) * 100);
}

function playedGames(logs) {
  return logs.filter((g) => g.didNotPlay !== true && g.minutes > MIN_MINUTES_TO_COUNT);
}

function buildArm(logs, stat) {
  if (logs.length === 0) return { games: 0, mean: 0, perMinute: 0, meanMinutes: 0 };
  const totalStat = logs.reduce((s, g) => s + g[stat], 0);
  const totalMinutes = logs.reduce((s, g) => s + g.minutes, 0);
  return {
    games: logs.length,
    mean: r1(totalStat / logs.length),
    perMinute: totalMinutes > 0 ? r3(totalStat / totalMinutes) : 0,
    meanMinutes: r1(totalMinutes / logs.length),
  };
}

function armUsageRate(logs) {
  if (logs.length === 0) return null;
  if (logs.some((g) => g.usageRate === undefined)) return null;
  return r1(logs.reduce((s, g) => s + g.usageRate, 0) / logs.length);
}

function confidenceForSample(sampleSize) {
  if (sampleSize >= CONFIDENCE_THRESHOLDS.HIGH) return "high";
  if (sampleSize >= CONFIDENCE_THRESHOLDS.MODERATE) return "moderate";
  if (sampleSize >= CONFIDENCE_THRESHOLDS.LOW) return "low";
  return "insufficient";
}

const STAT_LABEL = {
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  threes: "threes",
};

function withWithoutSplit(logs, teammateId, stat, playerId = "player") {
  const played = playedGames(logs);
  const without = played.filter((g) => g.teammatesOut.includes(teammateId));
  const withHim = played.filter((g) => !g.teammatesOut.includes(teammateId));

  const withArm = buildArm(withHim, stat);
  const withoutArm = buildArm(without, stat);

  const delta = r1(withoutArm.mean - withArm.mean);
  const perMinuteDelta = r3(withoutArm.perMinute - withArm.perMinute);
  const perMinutePercentChange = pctChange(withArm.perMinute, withoutArm.perMinute);

  const withUsage = armUsageRate(withHim);
  const withoutUsage = armUsageRate(without);

  const usageDriven =
    delta !== 0 &&
    Math.abs(perMinutePercentChange) >= USAGE_SIGNAL_PCT &&
    Math.sign(perMinuteDelta) === Math.sign(delta);

  const sampleSize = Math.min(withArm.games, withoutArm.games);

  return {
    playerId,
    teammateId,
    stat,
    withTeammate: withArm,
    withoutTeammate: withoutArm,
    delta,
    percentChange: pctChange(withArm.mean, withoutArm.mean),
    perMinuteDelta,
    perMinutePercentChange,
    minutesDelta: r1(withoutArm.meanMinutes - withArm.meanMinutes),
    usageRateDelta:
      withUsage !== null && withoutUsage !== null ? r1(withoutUsage - withUsage) : null,
    usageDriven,
    sampleSize,
    confidence: confidenceForSample(sampleSize),
  };
}

function buildExplanation(playerId, label, base, projected, adjustment, confidence, splits) {
  const thin = splits.filter((s) => s.confidence === "insufficient");
  const usable = splits.filter((s) => s.confidence !== "insufficient");

  if (usable.length === 0) {
    const detail = thin
      .map((s) => `only ${s.sampleSize} usable game${s.sampleSize === 1 ? "" : "s"} without ${s.teammateId}`)
      .join(", ");
    return `Not enough history to project ${playerId}: ${detail} (minimum ${CONFIDENCE_THRESHOLDS.MIN_SAMPLE}). No adjustment applied — holding the baseline ${base} ${label}. Confidence: insufficient.`;
  }

  const parts = usable.map((s) => {
    const dir = s.delta >= 0 ? "up" : "down";
    const mins = `${s.minutesDelta >= 0 ? "+" : ""}${s.minutesDelta} min`;
    const ratePct = `${s.perMinutePercentChange >= 0 ? "+" : ""}${s.perMinutePercentChange}%`;
    const rate = s.usageDriven
      ? `per-minute rate moved too (${s.withTeammate.perMinute} to ${s.withoutTeammate.perMinute}), so this is real usage`
      : Math.abs(s.perMinutePercentChange) >= USAGE_SIGNAL_PCT
        ? `per-minute rate moved ${ratePct} (${s.withTeammate.perMinute} to ${s.withoutTeammate.perMinute}) but not in step with the per-game change, so this is a minutes effect (${mins}) and it is fragile`
        : `per-minute rate barely moved (${s.withTeammate.perMinute} to ${s.withoutTeammate.perMinute}), so this is mostly a minutes effect (${mins})`;
    return `Without ${s.teammateId} he averages ${s.withoutTeammate.mean} ${label} vs ${s.withTeammate.mean} (${dir} ${Math.abs(s.delta)}, ${s.percentChange >= 0 ? "+" : ""}${s.percentChange}%) over ${s.sampleSize} comparable games; ${rate}.`;
  });

  const thinNote =
    thin.length > 0
      ? ` Ignored ${thin.map((s) => `${s.teammateId} (${s.sampleSize}-game sample)`).join(", ")} — below the ${CONFIDENCE_THRESHOLDS.MIN_SAMPLE}-game minimum.`
      : "";

  const stacked =
    usable.length > 1
      ? ` Multiple absences are stacked with diminishing returns (each additional teammate counts at ${OVERLAP_DECAY * 100}% of the previous one).`
      : "";

  return `${playerId} projects for ${projected} ${label} (baseline ${base}, ${adjustment >= 0 ? "+" : ""}${adjustment}). ${parts.join(" ")}${stacked}${thinNote} Confidence: ${confidence}.`;
}

function projectWithTeammateOut(input) {
  const { player, teammatesOut, stat, baseline } = input;
  const played = playedGames(player.logs);

  const seasonMean =
    played.length > 0 ? r1(played.reduce((s, g) => s + g[stat], 0) / played.length) : 0;
  const base = baseline !== undefined ? baseline : seasonMean;
  const label = STAT_LABEL[stat];

  if (teammatesOut.length === 0) {
    return {
      playerId: player.playerId,
      stat,
      baseline: base,
      projected: base,
      adjustment: 0,
      confidence: confidenceForSample(played.length),
      contributions: [],
      explanation: `No teammates ruled out for ${player.playerId}. Projection holds at the baseline ${base} ${label} over ${played.length} games played.`,
    };
  }

  const splits = teammatesOut.map((id) => withWithoutSplit(player.logs, id, stat, player.playerId));

  const shrunk = splits.map((s) => ({
    split: s,
    weighted: r1(s.delta * CONFIDENCE_WEIGHT[s.confidence]),
  }));
  shrunk.sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted));

  let decayIndex = 0;
  const contributions = shrunk.map(({ split, weighted }) => {
    let applied = 0;
    if (split.confidence !== "insufficient" && weighted !== 0) {
      applied = r1(weighted * Math.pow(OVERLAP_DECAY, decayIndex));
      decayIndex += 1;
    }
    return {
      teammateId: split.teammateId,
      delta: split.delta,
      perMinuteDelta: split.perMinuteDelta,
      sampleSize: split.sampleSize,
      confidence: split.confidence,
      usageDriven: split.usageDriven,
      appliedDelta: applied,
    };
  });

  const adjustment = r1(contributions.reduce((s, c) => s + c.appliedDelta, 0));
  const projected = r1(base + adjustment);

  const usable = splits.filter((s) => s.confidence !== "insufficient");
  const confidence =
    usable.length === 0
      ? "insufficient"
      : usable
          .map((s) => s.confidence)
          .reduce((weakest, c) => (CONFIDENCE_WEIGHT[c] < CONFIDENCE_WEIGHT[weakest] ? c : weakest));

  return {
    playerId: player.playerId,
    stat,
    baseline: base,
    projected,
    adjustment,
    confidence,
    contributions,
    explanation: buildExplanation(player.playerId, label, base, projected, adjustment, confidence, splits),
  };
}

function rankBeneficiaries(teamPlayers, outTeammateId, stat) {
  const rows = [];

  for (const p of teamPlayers) {
    if (p.playerId === outTeammateId) continue;
    const split = withWithoutSplit(p.logs, outTeammateId, stat, p.playerId);
    if (split.withTeammate.games === 0 && split.withoutTeammate.games === 0) continue;

    const adjustedDelta = r1(split.delta * CONFIDENCE_WEIGHT[split.confidence]);

    let note;
    if (split.confidence === "insufficient") {
      note = `Only ${split.sampleSize} comparable game${split.sampleSize === 1 ? "" : "s"} — not enough to trust.`;
    } else if (split.usageDriven) {
      note = `Real usage bump: ${split.withTeammate.perMinute} to ${split.withoutTeammate.perMinute} per minute.`;
    } else if (Math.abs(split.perMinutePercentChange) >= USAGE_SIGNAL_PCT) {
      note = `Minutes, not usage: ${split.minutesDelta >= 0 ? "+" : ""}${split.minutesDelta} min/game while the per-minute rate moved ${split.perMinutePercentChange >= 0 ? "+" : ""}${split.perMinutePercentChange}% the other way — fragile.`;
    } else if (Math.abs(split.minutesDelta) >= 2) {
      note = `Mostly minutes: ${split.minutesDelta >= 0 ? "+" : ""}${split.minutesDelta} min/game, per-minute rate flat.`;
    } else {
      note = `No meaningful change in rate or minutes.`;
    }

    rows.push({
      playerId: p.playerId,
      delta: split.delta,
      percentChange: split.percentChange,
      perMinuteDelta: split.perMinuteDelta,
      minutesDelta: split.minutesDelta,
      adjustedDelta,
      sampleSize: split.sampleSize,
      confidence: split.confidence,
      usageDriven: split.usageDriven,
      note,
    });
  }

  return rows.sort((a, b) => {
    const aThin = a.confidence === "insufficient" ? 1 : 0;
    const bThin = b.confidence === "insufficient" ? 1 : 0;
    if (aThin !== bThin) return aThin - bThin;
    if (b.adjustedDelta !== a.adjustedDelta) return b.adjustedDelta - a.adjustedDelta;
    return b.sampleSize - a.sampleSize;
  });
}

// ============================ TINY ASSERT HARNESS ============================

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ================================ FIXTURES ==================================

let gameCounter = 0;
/** Build n identical games. `out` is the list of teammates missing that night. */
function games(n, { pts, min, out = [], reb = 0, ast = 0, threes = 0, dnp = false }) {
  return Array.from({ length: n }, () => ({
    gameId: `g${++gameCounter}`,
    points: pts,
    rebounds: reb,
    assists: ast,
    threes,
    minutes: min,
    teammatesOut: out,
    wasHome: gameCounter % 2 === 0,
    opponent: "OPP",
    didNotPlay: dnp,
  }));
}

const STAR = "LeBron James";

// A) Real usage bump: more points AND a higher per-minute rate.
const davisLogs = [
  ...games(6, { pts: 22, min: 34 }),
  ...games(6, { pts: 30, min: 36, out: [STAR] }),
];

// B) Minutes mirage: per-game mean rises 12 -> 19, but per-minute is 0.5 both ways.
const ruiLogs = [
  ...games(5, { pts: 12, min: 24 }),
  ...games(5, { pts: 19, min: 38, out: [STAR] }),
];

// C) Tiny sample: huge apparent bump off two games.
const reddishLogs = [
  ...games(8, { pts: 6, min: 14 }),
  ...games(2, { pts: 18, min: 30, out: [STAR] }),
];

// D) Same as (A) plus DNPs that must be ignored entirely.
const davisLogsWithDnps = [
  ...davisLogs,
  ...games(3, { pts: 0, min: 0, out: [STAR], dnp: true }),
];

// E) Small, honest gainer.
const vandoLogs = [
  ...games(6, { pts: 7, min: 26 }),
  ...games(6, { pts: 8, min: 27, out: [STAR] }),
];

// F) Two different teammates missing on different nights.
const X = "Star X";
const Y = "Star Y";
const stackedLogs = [
  ...games(6, { pts: 20, min: 32 }),
  ...games(6, { pts: 28, min: 34, out: [X] }),
  ...games(6, { pts: 26, min: 33, out: [Y] }),
];

// ================================= TESTS ====================================

console.log("=== usage-model verification (handcrafted fixtures, no live data) ===\n");

console.log("-- withWithoutSplit: real usage bump --");
const davisSplit = withWithoutSplit(davisLogs, STAR, "points", "Anthony Davis");
eq("A1 with-arm mean is 22.0", davisSplit.withTeammate.mean, 22);
eq("A2 without-arm mean is 30.0", davisSplit.withoutTeammate.mean, 30);
eq("A3 per-game delta is +8.0", davisSplit.delta, 8);
check(
  "A4 per-minute rate also rises (0.647 -> 0.833)",
  davisSplit.withoutTeammate.perMinute > davisSplit.withTeammate.perMinute &&
    davisSplit.perMinuteDelta > 0.1,
  `perMinuteDelta=${davisSplit.perMinuteDelta}`
);
eq("A5 flagged as a genuine usage bump", davisSplit.usageDriven, true);
eq("A6 confidence is moderate on a 6-game sample", davisSplit.confidence, "moderate");

console.log("\n-- withWithoutSplit: minutes mirage (the whole point of normalizing) --");
const ruiSplit = withWithoutSplit(ruiLogs, STAR, "points", "Rui Hachimura");
eq("B1 raw per-game mean rises 12 -> 19", ruiSplit.delta, 7);
eq("B2 per-minute rate is flat (0.5 both arms)", ruiSplit.perMinuteDelta, 0);
eq("B3 with-arm per-minute", ruiSplit.withTeammate.perMinute, 0.5);
eq("B4 without-arm per-minute", ruiSplit.withoutTeammate.perMinute, 0.5);
eq("B5 NOT flagged as usage-driven despite the +7 PPG", ruiSplit.usageDriven, false);
eq("B6 minutes delta exposes the real cause (+14 min)", ruiSplit.minutesDelta, 14);

console.log("\n-- withWithoutSplit: small samples must refuse to speak --");
const reddishSplit = withWithoutSplit(reddishLogs, STAR, "points", "Cam Reddish");
eq("C1 two-game without-arm reports sampleSize 2", reddishSplit.sampleSize, 2);
eq("C2 confidence is insufficient", reddishSplit.confidence, "insufficient");
check("C3 the raw delta is still large (+12) and therefore tempting", reddishSplit.delta === 12);

console.log("\n-- confidence ladder boundaries --");
eq("D1 3 games -> insufficient", confidenceForSample(3), "insufficient");
eq("D2 4 games -> low", confidenceForSample(4), "low");
eq("D3 5 games -> low", confidenceForSample(5), "low");
eq("D4 6 games -> moderate", confidenceForSample(6), "moderate");
eq("D5 9 games -> moderate", confidenceForSample(9), "moderate");
eq("D6 10 games -> high", confidenceForSample(10), "high");

console.log("\n-- DNP exclusion --");
const dnpSplit = withWithoutSplit(davisLogsWithDnps, STAR, "points", "Anthony Davis");
eq("E1 3 DNPs do not inflate the without-arm game count", dnpSplit.withoutTeammate.games, 6);
eq("E2 without-arm mean not dragged down by 0-point DNPs", dnpSplit.withoutTeammate.mean, 30);
eq("E3 split is identical to the DNP-free fixture", dnpSplit.delta, davisSplit.delta);
eq("E4 confidence unchanged by DNPs", dnpSplit.confidence, davisSplit.confidence);

console.log("\n-- projectWithTeammateOut --");
const davisProj = projectWithTeammateOut({
  player: { playerId: "Anthony Davis", logs: davisLogs },
  teammatesOut: [STAR],
  stat: "points",
  baseline: 22,
});
eq("F1 +8.0 delta shrunk by moderate weight (0.8) -> +6.4", davisProj.adjustment, 6.4);
eq("F2 projected = 22 + 6.4", davisProj.projected, 28.4);
eq("F3 projection confidence is moderate", davisProj.confidence, "moderate");
check("F4 explanation names the absent teammate", davisProj.explanation.includes(STAR));
check("F5 explanation calls it real usage", davisProj.explanation.includes("real usage"));

const ruiProj = projectWithTeammateOut({
  player: { playerId: "Rui Hachimura", logs: ruiLogs },
  teammatesOut: [STAR],
  stat: "points",
  baseline: 12,
});
check(
  "F6 minutes-driven projection is labelled a minutes effect, not usage",
  ruiProj.explanation.includes("minutes effect"),
  ruiProj.explanation
);

console.log("\n-- projection refuses to guess from a tiny sample --");
const thinProj = projectWithTeammateOut({
  player: { playerId: "Cam Reddish", logs: reddishLogs },
  teammatesOut: [STAR],
  stat: "points",
  baseline: 6,
});
eq("G1 confidence is insufficient", thinProj.confidence, "insufficient");
eq("G2 no adjustment applied", thinProj.adjustment, 0);
eq("G3 projection holds at the baseline", thinProj.projected, 6);
check("G4 explanation says so in plain English", thinProj.explanation.startsWith("Not enough history"));
eq("G5 the thin contribution is surfaced but zeroed", thinProj.contributions[0].appliedDelta, 0);

console.log("\n-- stacking two absences with diminishing returns --");
const stackProj = projectWithTeammateOut({
  player: { playerId: "Rotation Guy", logs: stackedLogs },
  teammatesOut: [X, Y],
  stat: "points",
  baseline: 20,
});
eq("H1 biggest absence applied at full shrunk weight (5.0 * 0.8)", stackProj.contributions[0].appliedDelta, 4);
eq("H2 second absence halved (2.0 * 0.8 * 0.5)", stackProj.contributions[1].appliedDelta, 0.8);
eq("H3 total adjustment 4.8, not a naive 5.6", stackProj.adjustment, 4.8);
eq("H4 projected = 20 + 4.8", stackProj.projected, 24.8);
check("H5 explanation mentions diminishing returns", stackProj.explanation.includes("diminishing returns"));

console.log("\n-- rankBeneficiaries --");
const roster = [
  { playerId: "Anthony Davis", logs: davisLogs },
  { playerId: "Rui Hachimura", logs: ruiLogs },
  { playerId: "Jarred Vanderbilt", logs: vandoLogs },
  { playerId: "Cam Reddish", logs: reddishLogs },
];
const ranked = rankBeneficiaries(roster, STAR, "points");
eq("I1 four teammates ranked", ranked.length, 4);
eq("I2 top beneficiary is Anthony Davis", ranked[0].playerId, "Anthony Davis");
eq("I3 second is Rui Hachimura", ranked[1].playerId, "Rui Hachimura");
eq("I4 third is Jarred Vanderbilt", ranked[2].playerId, "Jarred Vanderbilt");
eq("I5 the 2-game mirage (+12) sorts LAST, not first", ranked[3].playerId, "Cam Reddish");
check(
  "I6 ranking sorted by confidence-shrunk delta, descending",
  ranked[0].adjustedDelta >= ranked[1].adjustedDelta &&
    ranked[1].adjustedDelta >= ranked[2].adjustedDelta,
  ranked.map((r) => `${r.playerId}:${r.adjustedDelta}`).join(", ")
);
eq("I7 Davis note calls out the real usage bump", ranked[0].usageDriven, true);
check("I8 Rui note calls out minutes", ranked[1].note.includes("Mostly minutes"), ranked[1].note);
check("I9 the out player himself is never ranked", !ranked.some((r) => r.playerId === STAR));

console.log("\n-- volume up, EFFICIENCY DOWN: must never be described as 'flat' --");
// 20 pts in 30 min (0.667/min) -> 24 pts in 40 min (0.600/min). The per-game line
// rises +4 while the per-minute rate FALLS 10%. This is the most fragile signal in
// the model and the text must say so rather than claiming the rate was flat.
const fragileLogs = [
  ...games(6, { pts: 20, min: 30 }),
  ...games(6, { pts: 24, min: 40, out: [STAR] }),
];
const fragileSplit = withWithoutSplit(fragileLogs, STAR, "points", "Volume Guy");
eq("L1 per-game mean still rises +4", fragileSplit.delta, 4);
eq("L2 per-minute rate actually falls", fragileSplit.perMinutePercentChange, -10);
eq("L3 correctly NOT flagged as usage-driven", fragileSplit.usageDriven, false);
const fragileNote = rankBeneficiaries([{ playerId: "Volume Guy", logs: fragileLogs }], STAR, "points")[0].note;
check("L4 ranking note does NOT claim the rate is flat", !fragileNote.includes("flat"), fragileNote);
check("L5 ranking note calls the bump fragile", fragileNote.includes("fragile"), fragileNote);
check("L6 ranking note reports the real rate move (-10%)", fragileNote.includes("-10%"), fragileNote);
const fragileExp = projectWithTeammateOut({
  player: { playerId: "Volume Guy", logs: fragileLogs },
  teammatesOut: [STAR],
  stat: "points",
  baseline: 20,
}).explanation;
check("L7 explanation does NOT claim the rate barely moved", !fragileExp.includes("barely moved"), fragileExp);
check("L8 explanation calls it fragile", fragileExp.includes("fragile"), fragileExp);
check("L9 a genuinely flat rate still reads 'barely moved'", ruiProj.explanation.includes("barely moved"), ruiProj.explanation);

console.log("\n-- no teammates out --");
const noneOut = projectWithTeammateOut({
  player: { playerId: "Anthony Davis", logs: davisLogs },
  teammatesOut: [],
  stat: "points",
});
eq("J1 baseline defaults to the season per-game mean (26.0)", noneOut.baseline, 26);
eq("J2 projection equals the baseline", noneOut.projected, 26);
eq("J3 no contributions", noneOut.contributions.length, 0);

console.log("\n-- source sync with src/lib/usage-model.ts --");
const src = readFileSync(MODULE_PATH, "utf8");
for (const name of [
  "export function withWithoutSplit",
  "export function projectWithTeammateOut",
  "export function rankBeneficiaries",
  "export function confidenceForSample",
  "export interface GameLogWithContext",
]) {
  check(`K  module declares \`${name}\``, src.includes(name));
}
check("K1 MIN_SAMPLE still 4", /MIN_SAMPLE:\s*4/.test(src));
check("K2 LOW still 4", /LOW:\s*4/.test(src));
check("K3 MODERATE still 6", /MODERATE:\s*6/.test(src));
check("K4 HIGH still 10", /HIGH:\s*10/.test(src));
check("K5 OVERLAP_DECAY still 0.5", /OVERLAP_DECAY\s*=\s*0\.5/.test(src));
check("K6 USAGE_SIGNAL_PCT still 5", /USAGE_SIGNAL_PCT\s*=\s*5/.test(src));
check(
  "K7 confidence weights still insufficient:0 low:0.5 moderate:0.8 high:1",
  /insufficient:\s*0,\s*\n?\s*low:\s*0\.5,\s*\n?\s*moderate:\s*0\.8,\s*\n?\s*high:\s*1,/.test(src)
);

// ================================ SUMMARY ===================================

console.log(`\n=== ${passed} passed, ${failed} failed, ${passed + failed} assertions ===`);
if (failed > 0) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
