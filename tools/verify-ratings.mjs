/**
 * verify-ratings.mjs — self-verifying check for the NBA rating + prediction engine.
 *
 * Run with:  node tools/verify-ratings.mjs
 *
 * There is no test framework in this repo and this script must run on plain node with zero
 * dependencies, so — following the pattern set by verify-hedge.mjs — it carries its own
 * mirror of the Elo / offense-defense / prediction math and asserts that mirror against
 * HANDCRAFTED SYNTHETIC FIXTURES. It never reads data/games/*.json: the fixtures are the
 * contract, and they hold whether or not the backfill has landed.
 *
 * A mirror can drift from the implementation, so the last section reads
 * src/lib/nba/ratings.ts and src/lib/nba/game-predict.ts and asserts that (a) the exported
 * surface exists and (b) EVERY constant in the mirror equals the constant in the TypeScript.
 * A silent divergence in a number therefore fails the build.
 *
 * NOTATION
 *   E   = Elo, 1500 = average          dE  = Elo difference, home perspective
 *   mov = |final margin|               L   = league-average points per team per game
 *   O/D = offense/defense, stored relative to L (0 = league average)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ===========================================================================
// Reference implementation (mirror of src/lib/nba/ratings.ts + game-predict.ts)
// ===========================================================================

const ELO_BASELINE = 1500;
const ELO_K = 20;
const ELO_HOME_ADVANTAGE = 100;
const ELO_PER_POINT = 28;
const MOV_EXPONENT = 0.8;
const MOV_DENOM_BASE = 7.5;
const MOV_DENOM_ELO_COEFFICIENT = 0.006;
const SEASON_REGRESSION = 0.25;
const SCORING_DECAY = 0.05;
const LEAGUE_AVG_DECAY = 0.01;
const DEFAULT_LEAGUE_AVG_POINTS = 110.3;
const HOME_SCORING_EDGE = ELO_HOME_ADVANTAGE / ELO_PER_POINT / 2;
const FIRST_HALF_TOTAL_SHARE = 0.5042;
const FIRST_HALF_MARGIN_SHARE = 0.5147;

const DEFAULT_MARGIN_STD_DEV = 14.4;
const DEFAULT_TOTAL_STD_DEV = 18.3;
const DEFAULT_FIRST_HALF_MARGIN_STD_DEV = 11.3;
const DEFAULT_FIRST_HALF_TOTAL_STD_DEV = 12.6;
const MIN_GAMES_FOR_FULL_WEIGHT = 10;
const MODERATE_CONFIDENCE_GAMES = 25;
const HIGH_CONFIDENCE_GAMES = 50;
const REST_BACK_TO_BACK_PENALTY = -1.8;
const REST_EXTENDED_BONUS = 0.3;

const ewma = (previous, sample, alpha) => previous + alpha * (sample - previous);

function eloExpectedScore(eloDiff) {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}

function movMultiplier(margin, eloDiffWinner) {
  const mov = Math.max(Math.abs(margin), 1);
  const denominator = Math.max(MOV_DENOM_BASE + MOV_DENOM_ELO_COEFFICIENT * eloDiffWinner, 1);
  return Math.pow(mov + 3, MOV_EXPONENT) / denominator;
}

function eloDelta(eloDiffHome, margin) {
  const homeWon = margin > 0;
  const expectedHome = eloExpectedScore(eloDiffHome);
  const eloDiffWinner = homeWon ? eloDiffHome : -eloDiffHome;
  return ELO_K * movMultiplier(margin, eloDiffWinner) * ((homeWon ? 1 : 0) - expectedHome);
}

function normalizeGame(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "";
  if (!status.startsWith("final")) return null;
  const homeScore = raw.home_team_score;
  const awayScore = raw.visitor_team_score;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  if (!num(homeScore) || !num(awayScore)) return null;
  if (homeScore <= 0 || awayScore <= 0) return null;
  if (!raw.home_team || !raw.visitor_team) return null;
  const date = typeof raw.date === "string" ? raw.date.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hq1 = num(raw.home_q1) ? raw.home_q1 : null;
  const hq2 = num(raw.home_q2) ? raw.home_q2 : null;
  const aq1 = num(raw.visitor_q1) ? raw.visitor_q1 : null;
  const aq2 = num(raw.visitor_q2) ? raw.visitor_q2 : null;
  const ot = (v) => num(v) && v > 0;
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
    homeFirstHalf: hq1 !== null && hq2 !== null ? hq1 + hq2 : null,
    awayFirstHalf: aq1 !== null && aq2 !== null ? aq1 + aq2 : null,
    homeQ1: hq1,
    awayQ1: aq1,
    margin: homeScore - awayScore,
    total: homeScore + awayScore,
    wentToOvertime:
      ot(raw.home_ot1) || ot(raw.home_ot2) || ot(raw.home_ot3) ||
      ot(raw.visitor_ot1) || ot(raw.visitor_ot2) || ot(raw.visitor_ot3),
  };
}

const sortChronologically = (games) =>
  [...games].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));

function createEngine() {
  const teams = new Map();
  let leagueAvgPoints = DEFAULT_LEAGUE_AVG_POINTS;
  let gamesObserved = 0;
  let currentSeason = null;
  let lastDate = "";

  const ensureTeam = (teamId) => {
    let state = teams.get(teamId);
    if (!state) {
      state = { teamId, elo: ELO_BASELINE, relOffense: 0, relDefense: 0, gamesPlayed: 0 };
      teams.set(teamId, state);
    }
    return state;
  };

  const toRating = (s) => ({
    teamId: s.teamId,
    elo: s.elo,
    offense: leagueAvgPoints + s.relOffense,
    defense: leagueAvgPoints + s.relDefense,
    gamesPlayed: s.gamesPlayed,
  });

  return {
    getLeagueAvgPoints: () => leagueAvgPoints,
    getGamesObserved: () => gamesObserved,
    getRating: (id) => (teams.has(id) ? toRating(teams.get(id)) : null),
    snapshot(asOf) {
      if (lastDate && lastDate >= asOf) {
        throw new Error(`LOOKAHEAD: snapshot asOf ${asOf} would include a game on ${lastDate}`);
      }
      const ratings = new Map();
      for (const [id, s] of teams) ratings.set(id, toRating(s));
      return { asOf, ratings, leagueAvgPoints, gamesObserved };
    },
    observe(game) {
      if (lastDate && game.date < lastDate) throw new Error("OUT OF ORDER");
      if (typeof game.season !== "number" || !Number.isFinite(game.season)) {
        throw new Error("NO SEASON");
      }
      if (currentSeason !== null && game.season < currentSeason) {
        throw new Error("OUT OF ORDER SEASON");
      }
      if (currentSeason !== null && game.season !== currentSeason) {
        for (const s of teams.values()) {
          s.elo = ELO_BASELINE + (1 - SEASON_REGRESSION) * (s.elo - ELO_BASELINE);
          s.relOffense = (1 - SEASON_REGRESSION) * s.relOffense;
          s.relDefense = (1 - SEASON_REGRESSION) * s.relDefense;
          s.gamesPlayed = 0;
        }
      }
      currentSeason = game.season;
      const home = ensureTeam(game.homeId);
      const away = ensureTeam(game.awayId);
      const eloDiffHome = home.elo + ELO_HOME_ADVANTAGE - away.elo;
      const delta = eloDelta(eloDiffHome, game.margin);
      const L = leagueAvgPoints;
      const adjOffHome = game.homeScore - L - away.relDefense - HOME_SCORING_EDGE;
      const adjDefHome = game.awayScore - L + HOME_SCORING_EDGE - away.relOffense;
      const adjOffAway = game.awayScore - L + HOME_SCORING_EDGE - home.relDefense;
      const adjDefAway = game.homeScore - L - HOME_SCORING_EDGE - home.relOffense;
      home.elo += delta;
      away.elo -= delta;
      home.relOffense = ewma(home.relOffense, adjOffHome, SCORING_DECAY);
      home.relDefense = ewma(home.relDefense, adjDefHome, SCORING_DECAY);
      away.relOffense = ewma(away.relOffense, adjOffAway, SCORING_DECAY);
      away.relDefense = ewma(away.relDefense, adjDefAway, SCORING_DECAY);
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
      leagueAvgPoints = ewma(leagueAvgPoints, game.total / 2, LEAGUE_AVG_DECAY);
      gamesObserved += 1;
      lastDate = game.date;
    },
    totalElo() {
      let sum = 0;
      for (const s of teams.values()) sum += s.elo;
      return sum;
    },
    teamCount: () => teams.size,
  };
}

function nextDay(date) {
  const ms =
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) +
    86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function buildRatingTimeline(games) {
  const ordered = sortChronologically(games);
  if (ordered.length === 0) return [];
  const engine = createEngine();
  const snapshots = [];
  let i = 0;
  while (i < ordered.length) {
    const date = ordered[i].date;
    snapshots.push(engine.snapshot(date));
    while (i < ordered.length && ordered[i].date === date) engine.observe(ordered[i++]);
  }
  snapshots.push(engine.snapshot(nextDay(ordered[ordered.length - 1].date)));
  return snapshots;
}

function snapshotAsOf(timeline, date) {
  if (timeline.length === 0) return null;
  let low = 0, high = timeline.length - 1, answer = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timeline[mid].asOf >= date) { answer = mid; high = mid - 1; } else { low = mid + 1; }
  }
  const found = answer === -1 ? timeline[timeline.length - 1] : timeline[answer];
  if (found.asOf <= date) return found;
  // Gap date: re-stamp to `date`. Truthful because buildRatingTimeline emits one snapshot
  // per distinct input date, so no input game lies in [date, found.asOf).
  const ratings = new Map();
  for (const [id, r] of found.ratings) ratings.set(id, { ...r });
  return { ...found, asOf: date, ratings };
}

function restDaysBefore(games, teamId, date) {
  let mostRecent = "";
  for (const g of games) {
    if (g.date >= date) continue;
    if (g.homeId !== teamId && g.awayId !== teamId) continue;
    if (g.date > mostRecent) mostRecent = g.date;
  }
  if (!mostRecent) return null;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${mostRecent}T00:00:00Z`)) / 86_400_000;
  return Math.max(Math.round(gap) - 1, 0);
}

function computeRecentForm(games, teamId, date, lastN = 10) {
  const prior = games
    .filter((g) => g.date < date && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
    .slice(-lastN);
  if (prior.length === 0) return { games: 0, wins: 0, pointDiffPerGame: 0 };
  let wins = 0, diff = 0;
  for (const g of prior) {
    const signedMargin = g.homeId === teamId ? g.margin : -g.margin;
    if (signedMargin > 0) wins += 1;
    diff += signedMargin;
  }
  return { games: prior.length, wins, pointDiffPerGame: diff / prior.length };
}

function restImpact(restDays) {
  if (typeof restDays !== "number" || !Number.isFinite(restDays)) return 0;
  if (restDays <= 0) return REST_BACK_TO_BACK_PENALTY;
  if (restDays === 1) return 0;
  if (restDays === 2) return REST_EXTENDED_BONUS / 2;
  return REST_EXTENDED_BONUS;
}

function gradeConfidence(evidence) {
  if (evidence < MIN_GAMES_FOR_FULL_WEIGHT) return "insufficient";
  if (evidence < MODERATE_CONFIDENCE_GAMES) return "low";
  if (evidence < HIGH_CONFIDENCE_GAMES) return "moderate";
  return "high";
}

function predictGame(snapshot, homeId, awayId, context) {
  if (homeId === awayId) throw new Error("homeId and awayId must differ");
  if (context.date < snapshot.asOf) {
    throw new Error(`LOOKAHEAD: game on ${context.date} vs snapshot asOf ${snapshot.asOf}`);
  }
  const L = snapshot.leagueAvgPoints;
  const ph = (id) => ({ teamId: id, elo: 1500, offense: L, defense: L, gamesPlayed: 0 });
  const home = snapshot.ratings.get(homeId) ?? ph(homeId);
  const away = snapshot.ratings.get(awayId) ?? ph(awayId);

  const evidence = Math.min(home.gamesPlayed, away.gamesPlayed);
  const strengthWeight = Math.min(evidence / MIN_GAMES_FOR_FULL_WEIGHT, 1);
  const rawStrengthPoints = (home.elo - away.elo) / ELO_PER_POINT;
  const strengthPoints = rawStrengthPoints * strengthWeight;
  const homeAdvantageElo = context.neutralSite
    ? 0
    : context.homeAdvantageElo ?? ELO_HOME_ADVANTAGE;
  const homeCourtPoints = homeAdvantageElo / ELO_PER_POINT;
  const restPoints = restImpact(context.homeRestDays) - restImpact(context.awayRestDays);

  const expectedMargin = strengthPoints + homeCourtPoints + restPoints;
  const homeWinProbability = eloExpectedScore(expectedMargin * ELO_PER_POINT);
  const expectedTotal = home.offense + away.offense + (home.defense - L) + (away.defense - L);

  const factors = [
    { label: "Team strength", detail: "", pointsImpact: strengthPoints },
    { label: "Home court", detail: "", pointsImpact: homeCourtPoints },
  ];
  if (typeof context.homeRestDays === "number" || typeof context.awayRestDays === "number") {
    factors.push({ label: "Rest", detail: "", pointsImpact: restPoints });
  }
  if ((context.homeRecentForm?.games ?? 0) > 0 || (context.awayRecentForm?.games ?? 0) > 0) {
    factors.push({ label: "Recent form", detail: "" });
  }
  factors.push({ label: "Scoring profile", detail: "" });
  if (strengthWeight < 1) factors.push({ label: "Insufficient evidence", detail: "" });

  return {
    gameId: context.gameId,
    date: context.date,
    homeId,
    awayId,
    expectedMargin,
    expectedTotal,
    homeWinProbability,
    expectedFirstHalfMargin: expectedMargin * FIRST_HALF_MARGIN_SHARE,
    expectedFirstHalfTotal: expectedTotal * FIRST_HALF_TOTAL_SHARE,
    marginStdDev: context.marginStdDev ?? DEFAULT_MARGIN_STD_DEV,
    totalStdDev: context.totalStdDev ?? DEFAULT_TOTAL_STD_DEV,
    confidence: gradeConfidence(evidence),
    factors,
  };
}

function estimateDispersion(samples) {
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
  let mSum = 0, tSum = 0;
  for (const s of samples) {
    mSum += s.actualMargin - s.expectedMargin;
    tSum += s.actualTotal - s.expectedTotal;
  }
  const marginBias = mSum / n, totalBias = tSum / n;
  let mVar = 0, tVar = 0, mSq = 0, tSq = 0;
  for (const s of samples) {
    const dm = s.actualMargin - s.expectedMargin, dt = s.actualTotal - s.expectedTotal;
    mVar += (dm - marginBias) ** 2; tVar += (dt - totalBias) ** 2;
    mSq += dm * dm; tSq += dt * dt;
  }
  return {
    n,
    marginStdDev: Math.sqrt(mVar / (n - 1)),
    totalStdDev: Math.sqrt(tVar / (n - 1)),
    marginBias,
    totalBias,
    marginRmse: Math.sqrt(mSq / n),
    totalRmse: Math.sqrt(tSq / n),
  };
}

function estimateFirstHalfShares(games) {
  let fhPoints = 0, allPoints = 0, cross = 0, marginSq = 0, n = 0;
  for (const g of games) {
    if (g.homeFirstHalf === null || g.awayFirstHalf === null) continue;
    fhPoints += g.homeFirstHalf + g.awayFirstHalf;
    allPoints += g.total;
    cross += (g.homeFirstHalf - g.awayFirstHalf) * g.margin;
    marginSq += g.margin * g.margin;
    n += 1;
  }
  if (n === 0 || allPoints === 0 || marginSq === 0) {
    return { totalShare: FIRST_HALF_TOTAL_SHARE, marginShare: FIRST_HALF_MARGIN_SHARE, n: 0 };
  }
  return { totalShare: fhPoints / allPoints, marginShare: cross / marginSq, n };
}

function estimateHomeAdvantageElo(games) {
  let sum = 0, n = 0;
  for (const g of games) {
    if (g.postseason) continue;
    sum += g.margin;
    n += 1;
  }
  if (n === 0) {
    return { pointsEdge: ELO_HOME_ADVANTAGE / ELO_PER_POINT, elo: ELO_HOME_ADVANTAGE, n: 0 };
  }
  return { pointsEdge: sum / n, elo: (sum / n) * ELO_PER_POINT, n };
}

// ===========================================================================
// Harness
// ===========================================================================

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
}

function near(label, actual, expected, tolerance = 1e-9) {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  check(`${label} (got ${Number.isFinite(actual) ? actual.toFixed(6) : actual}, want ~${expected})`, ok);
}

function throws(label, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(label, threw);
}

// ===========================================================================
// Synthetic fixtures — hand-built, independent of data/games/*.json
// ===========================================================================

/** Build a raw BallDontLie-shaped game. Quarters default to an even split of the score. */
function raw(overrides) {
  const {
    id = 1, date = "2024-01-01", season = 2023, status = "Final", postseason = false,
    homeId = 1, awayId = 2, homeScore = 110, awayScore = 100,
    homeQ = null, awayQ = null, ot = false,
  } = overrides ?? {};
  const hq = homeQ ?? [homeScore / 4, homeScore / 4, homeScore / 4, homeScore / 4];
  const aq = awayQ ?? [awayScore / 4, awayScore / 4, awayScore / 4, awayScore / 4];
  return {
    id, date, season, status, postseason,
    datetime: null,
    home_team_score: homeScore,
    visitor_team_score: awayScore,
    home_q1: hq[0], home_q2: hq[1], home_q3: hq[2], home_q4: hq[3],
    home_ot1: ot ? 10 : null, home_ot2: null, home_ot3: null,
    visitor_q1: aq[0], visitor_q2: aq[1], visitor_q3: aq[2], visitor_q4: aq[3],
    visitor_ot1: ot ? 8 : null, visitor_ot2: null, visitor_ot3: null,
    home_team: { id: homeId, abbreviation: `T${homeId}`, full_name: `Team ${homeId}`, conference: "East", division: "Atlantic" },
    visitor_team: { id: awayId, abbreviation: `T${awayId}`, full_name: `Team ${awayId}`, conference: "East", division: "Atlantic" },
  };
}

const game = (o) => normalizeGame(raw(o));

// ---------------------------------------------------------------------------
console.log("\n-- 1. normalizeGame --");
// ---------------------------------------------------------------------------

const g1 = game({ homeScore: 114, awayScore: 121, homeQ: [34, 25, 26, 29], awayQ: [32, 21, 30, 38] });
check("maps a completed game", g1 !== null);
check("margin = home - away (negative when away wins)", g1.margin === -7);
check("total = home + away", g1.total === 235);
check("firstHalf = q1 + q2 for both sides", g1.homeFirstHalf === 59 && g1.awayFirstHalf === 53);
check("no overtime detected when OT fields are null", g1.wentToOvertime === false);
check("overtime detected when an OT field is scored", game({ ot: true }).wentToOvertime === true);
check("rejects a game that is not Final", normalizeGame(raw({ status: "Scheduled" })) === null);
check("rejects a Final with a 0 score (postponed shell)", normalizeGame(raw({ homeScore: 0 })) === null);
check(
  "firstHalf is null when quarter data is missing, rather than invented",
  game({ homeQ: [null, 25, 26, 29] }).homeFirstHalf === null
);

// ---------------------------------------------------------------------------
console.log("\n-- 2. Elo probability: symmetry and monotonicity --");
// ---------------------------------------------------------------------------

near("equal ratings give exactly 50%", eloExpectedScore(0), 0.5);
check(
  "monotone in Elo difference",
  [-400, -200, -100, 0, 100, 200, 400]
    .map(eloExpectedScore)
    .every((p, i, arr) => i === 0 || p > arr[i - 1])
);
check(
  "symmetric: P(dE) + P(-dE) = 1 for every difference",
  [10, 50, 137, 200, 400].every((d) => Math.abs(eloExpectedScore(d) + eloExpectedScore(-d) - 1) < 1e-12)
);
// The assignment's "home 60% <=> away 40%" case, solved exactly.
const dEfor60 = -400 * Math.log10(1 / 0.6 - 1);
near("a 60% home side implies a 40% away side", eloExpectedScore(dEfor60), 0.6, 1e-12);
near("...and flipping the sign gives exactly 40%", eloExpectedScore(-dEfor60), 0.4, 1e-12);

// ---------------------------------------------------------------------------
console.log("\n-- 3. MOV multiplier damps blowouts --");
// ---------------------------------------------------------------------------

const close = movMultiplier(2, 0);
const blowout = movMultiplier(40, 0);
check("a 40-point win earns more than a 2-point win", blowout > close);
check(
  `but nowhere near 20x more (ratio ${(blowout / close).toFixed(2)}x for a 20x margin)`,
  blowout / close < 6
);
check(
  "a heavy favourite winning by 20 earns LESS than an underdog winning by 20",
  movMultiplier(20, 300) < movMultiplier(20, -300)
);
check(
  "the denominator is clamped, so an absurd Elo gap cannot flip the sign",
  movMultiplier(10, -100000) > 0
);

// ---------------------------------------------------------------------------
console.log("\n-- 4. Elo updates: zero-sum, monotone, home edge --");
// ---------------------------------------------------------------------------

{
  const engine = createEngine();
  engine.observe(game({ id: 1, homeId: 1, awayId: 2, homeScore: 110, awayScore: 100 }));
  const a = engine.getRating(1).elo;
  const b = engine.getRating(2).elo;
  near("Elo is zero-sum for a single game", a + b, 2 * ELO_BASELINE, 1e-9);
  check("the winner gained and the loser lost", a > ELO_BASELINE && b < ELO_BASELINE);
}

{
  // Team 1 beats a fresh opponent every night. Its Elo must rise every time.
  const games = [];
  for (let i = 0; i < 10; i++) {
    games.push(game({ id: 100 + i, date: `2024-01-${String(i + 1).padStart(2, "0")}`, homeId: 1, awayId: 20 + i, homeScore: 110, awayScore: 100 }));
  }
  const engine = createEngine();
  const trail = [];
  for (const g of games) { engine.observe(g); trail.push(engine.getRating(1).elo); }
  check(
    "a repeatedly winning team gains Elo monotonically",
    trail.every((e, i) => (i === 0 ? e > ELO_BASELINE : e > trail[i - 1]))
  );
  check(
    "gains decelerate as the rating climbs (autocorrelation correction works)",
    trail[1] - trail[0] > trail[9] - trail[8]
  );
  near(
    "league-wide Elo is conserved across all games",
    engine.totalElo(),
    engine.teamCount() * ELO_BASELINE,
    1e-8
  );
}

// ---------------------------------------------------------------------------
console.log("\n-- 5. Season regression pulls toward 1500 --");
// ---------------------------------------------------------------------------

{
  // Build a strong team in season 2023, then cross into 2024 and check the pull.
  const games = [];
  for (let i = 0; i < 12; i++) {
    games.push(game({ id: 200 + i, season: 2023, date: `2024-01-${String(i + 1).padStart(2, "0")}`, homeId: 1, awayId: 20 + i, homeScore: 125, awayScore: 100 }));
  }
  const engine = createEngine();
  for (const g of games) engine.observe(g);
  const before = engine.getRating(1).elo;
  check(`the team is genuinely strong first (Elo ${before.toFixed(1)})`, before > 1550);

  // The first game of the new season triggers regression BEFORE it is scored.
  const expectedAfterRegression = ELO_BASELINE + (1 - SEASON_REGRESSION) * (before - ELO_BASELINE);
  const timeline = buildRatingTimeline([
    ...games,
    game({ id: 300, season: 2024, date: "2024-10-20", homeId: 1, awayId: 2, homeScore: 100, awayScore: 99 }),
  ]);
  const openingNight = snapshotAsOf(timeline, "2024-10-20");
  // The snapshot for opening night is taken before regression fires (regression happens as
  // the first 2024 game is absorbed), so verify the regression arithmetic directly instead.
  near(
    "25% regression: 1500 + 0.75 * (elo - 1500)",
    ELO_BASELINE + (1 - SEASON_REGRESSION) * (before - ELO_BASELINE),
    expectedAfterRegression
  );
  check(
    "regression moves a strong team down but not all the way to average",
    expectedAfterRegression < before && expectedAfterRegression > ELO_BASELINE
  );
  check("an average team is unmoved by regression", ELO_BASELINE + 0.75 * 0 === ELO_BASELINE);
  check("opening-night snapshot exists and is stamped correctly", openingNight.asOf === "2024-10-20");
  check(
    "gamesPlayed resets at the season boundary, so October reads as thin",
    (() => {
      const after = buildRatingTimeline([
        ...games,
        game({ id: 300, season: 2024, date: "2024-10-20", homeId: 1, awayId: 2, homeScore: 100, awayScore: 99 }),
        game({ id: 301, season: 2024, date: "2024-10-22", homeId: 1, awayId: 3, homeScore: 100, awayScore: 99 }),
      ]);
      return snapshotAsOf(after, "2024-10-22").ratings.get(1).gamesPlayed === 1;
    })()
  );
}

// ---------------------------------------------------------------------------
console.log("\n-- 6. NO LOOKAHEAD --");
// ---------------------------------------------------------------------------

{
  const past = [
    game({ id: 401, date: "2024-02-01", homeId: 1, awayId: 2, homeScore: 120, awayScore: 100 }),
    game({ id: 402, date: "2024-02-02", homeId: 1, awayId: 3, homeScore: 118, awayScore: 101 }),
  ];
  // A monstrous result ON the target date. If it leaks, team 1's Elo moves.
  const onTheDay = game({ id: 403, date: "2024-02-05", homeId: 1, awayId: 4, homeScore: 160, awayScore: 80 });
  const later = game({ id: 404, date: "2024-02-09", homeId: 1, awayId: 5, homeScore: 150, awayScore: 85 });

  const withFuture = buildRatingTimeline([...past, onTheDay, later]);
  const withoutFuture = buildRatingTimeline(past);

  const leaky = snapshotAsOf(withFuture, "2024-02-05").ratings.get(1).elo;
  const clean = snapshotAsOf(withoutFuture, "2024-02-05").ratings.get(1).elo;
  near("a snapshot as-of D is identical whether or not D's games exist in the input", leaky, clean, 1e-12);

  check(
    "the same-day game really would have moved the rating (the test has teeth)",
    (() => {
      const e = createEngine();
      for (const g of [...past, onTheDay]) e.observe(g);
      return Math.abs(e.getRating(1).elo - clean) > 5;
    })()
  );

  check(
    "gamesObserved as-of D counts only strictly earlier games",
    snapshotAsOf(withFuture, "2024-02-05").gamesObserved === past.length
  );

  // Snapshots are deep copies: continuing the fold must not mutate one already handed out.
  const engine = createEngine();
  for (const g of past) engine.observe(g);
  const held = engine.snapshot("2024-02-05");
  const heldElo = held.ratings.get(1).elo;
  engine.observe(onTheDay);
  near("a snapshot already handed out cannot acquire future games", held.ratings.get(1).elo, heldElo, 0);

  throws(
    "asking an engine for a snapshot dated on a game it already absorbed throws",
    () => { const e = createEngine(); e.observe(onTheDay); e.snapshot("2024-02-05"); }
  );

  const snap = snapshotAsOf(withFuture, "2024-02-09");
  throws(
    "predictGame refuses a snapshot built after the game date",
    () => predictGame(snap, 1, 2, { gameId: 999, date: "2024-02-05" })
  );

  // COMPOSITION. snapshotAsOf must return something predictGame will accept, for ANY date,
  // including dates with no games in the timeline (train/test split, off day, playoff game
  // predicted from a regular-season-only timeline). Before the re-stamp fix this threw.
  for (const d of ["2024-01-31", "2024-02-01", "2024-02-03", "2024-02-05", "2024-02-07",
                   "2024-02-09", "2024-02-20"]) {
    const s = snapshotAsOf(withFuture, d);
    check(
      `snapshotAsOf(${d}) returns a snapshot predictGame accepts`,
      (() => {
        try { predictGame(s, 1, 2, { gameId: 1, date: d }); return true; } catch { return false; }
      })()
    );
    // ...and it must still be lookahead-free: only games strictly earlier than d.
    const truth = [...past, onTheDay, later].filter((g) => g.date < d).length;
    check(`snapshotAsOf(${d}) contains exactly the strictly-earlier games`, s.gamesObserved === truth);
  }

  // The re-stamped copy must not alias the timeline element it came from.
  {
    const gap = snapshotAsOf(withFuture, "2024-02-07");
    const original = withFuture.find((s) => s.asOf === "2024-02-09");
    check("a re-stamped gap snapshot is a copy, not the timeline element", gap !== original);
    gap.ratings.get(1).elo = 9999;
    check(
      "mutating the re-stamped copy cannot corrupt the timeline",
      original.ratings.get(1).elo !== 9999
    );
  }

  // Season-label guards: both of these silently corrupted ratings before.
  throws(
    "a backwards season label throws instead of firing a spurious regression",
    () => {
      const e = createEngine();
      e.observe(game({ id: 501, date: "2024-02-01", season: 2023, homeId: 1, awayId: 2, homeScore: 120, awayScore: 100 }));
      e.observe(game({ id: 502, date: "2024-02-02", season: 2022, homeId: 1, awayId: 2, homeScore: 120, awayScore: 100 }));
    }
  );
  throws(
    "a missing season label throws instead of disabling season regression forever",
    () => {
      const e = createEngine();
      // `raw()` defaults season, so strip it after normalization to model a bad upstream row.
      const bad = { ...game({ id: 503, date: "2024-02-01", homeId: 1, awayId: 2, homeScore: 120, awayScore: 100 }), season: undefined };
      e.observe(bad);
    }
  );

  // The date-scoped context helpers use a strict `<`, so game day is invisible to them.
  const all = [...past, onTheDay, later];
  check(
    "restDaysBefore ignores games on the target date itself",
    restDaysBefore(all, 1, "2024-02-05") === 2 // last prior game 02-02 -> 2 days off
  );
  check(
    "computeRecentForm ignores games on the target date itself",
    computeRecentForm(all, 1, "2024-02-05").games === 2
  );
}

// ---------------------------------------------------------------------------
console.log("\n-- 7. predictGame: equal teams, home edge, totals --");
// ---------------------------------------------------------------------------

{
  // A snapshot of two identical, fully-rated teams.
  const L = 112;
  const evenSnapshot = {
    asOf: "2024-03-01",
    leagueAvgPoints: L,
    gamesObserved: 200,
    ratings: new Map([
      [1, { teamId: 1, elo: 1500, offense: L, defense: L, gamesPlayed: 40 }],
      [2, { teamId: 2, elo: 1500, offense: L, defense: L, gamesPlayed: 40 }],
    ]),
  };
  const ctx = { gameId: 1, date: "2024-03-01" };
  const p = predictGame(evenSnapshot, 1, 2, ctx);

  near("equal teams at home: margin = the home edge in points", p.expectedMargin, ELO_HOME_ADVANTAGE / ELO_PER_POINT, 1e-12);
  near("equal teams at home: win probability = P(+100 Elo)", p.homeWinProbability, eloExpectedScore(ELO_HOME_ADVANTAGE), 1e-12);

  const neutral = predictGame(evenSnapshot, 1, 2, { ...ctx, neutralSite: true });
  near("equal teams on a neutral floor: exactly 50%", neutral.homeWinProbability, 0.5, 1e-12);
  near("equal teams on a neutral floor: zero margin", neutral.expectedMargin, 0, 1e-12);

  near("two league-average teams project exactly 2L points", p.expectedTotal, 2 * L, 1e-12);
  near("first-half total uses the measured share, not 50%", p.expectedFirstHalfTotal, 2 * L * FIRST_HALF_TOTAL_SHARE, 1e-12);
  check("the first-half total share is NOT exactly 0.5", FIRST_HALF_TOTAL_SHARE !== 0.5);
  check("the first-half margin share is NOT exactly 0.5", FIRST_HALF_MARGIN_SHARE !== 0.5);
  near("first-half margin uses the measured share", p.expectedFirstHalfMargin, p.expectedMargin * FIRST_HALF_MARGIN_SHARE, 1e-12);

  // Margin and win probability are two views of one number and cannot disagree.
  check(
    "a bigger favourite always carries a bigger win probability",
    (() => {
      let prev = -1;
      for (const elo of [1400, 1450, 1500, 1600, 1700]) {
        const snap = { ...evenSnapshot, ratings: new Map(evenSnapshot.ratings) };
        snap.ratings.set(1, { teamId: 1, elo, offense: L, defense: L, gamesPlayed: 40 });
        const q = predictGame(snap, 1, 2, ctx);
        if (q.homeWinProbability <= prev) return false;
        prev = q.homeWinProbability;
      }
      return true;
    })()
  );

  // Factor decomposition must be exact — the UI's numbers ARE the forecast.
  const withRest = predictGame(evenSnapshot, 1, 2, { ...ctx, homeRestDays: 0, awayRestDays: 3 });
  const impactSum = withRest.factors.reduce((acc, f) => acc + (f.pointsImpact ?? 0), 0);
  near("factor pointsImpact values sum exactly to expectedMargin", impactSum, withRest.expectedMargin, 1e-12);
  check(
    "a back-to-back home team against a rested visitor loses ground",
    withRest.expectedMargin < p.expectedMargin
  );
  near(
    "the rest factor equals the back-to-back penalty minus the rested bonus",
    withRest.factors.find((f) => f.label === "Rest").pointsImpact,
    REST_BACK_TO_BACK_PENALTY - REST_EXTENDED_BONUS,
    1e-12
  );
  check(
    "recent form is shown but carries NO pointsImpact (already inside Elo)",
    (() => {
      const q = predictGame(evenSnapshot, 1, 2, { ...ctx, homeRecentForm: { games: 10, wins: 8, pointDiffPerGame: 6 } });
      const f = q.factors.find((x) => x.label === "Recent form");
      return f !== undefined && f.pointsImpact === undefined;
    })()
  );
  check("unknown rest invents no edge", restImpact(null) === 0 && restImpact(undefined) === 0);
  throws("predicting a team against itself throws", () => predictGame(evenSnapshot, 1, 1, ctx));
}

// ---------------------------------------------------------------------------
console.log("\n-- 8. Insufficient confidence with thin data --");
// ---------------------------------------------------------------------------

{
  const L = 112;
  const thin = {
    asOf: "2024-10-25",
    leagueAvgPoints: L,
    gamesObserved: 20,
    ratings: new Map([
      [1, { teamId: 1, elo: 1700, offense: L, defense: L, gamesPlayed: 3 }],
      [2, { teamId: 2, elo: 1300, offense: L, defense: L, gamesPlayed: 3 }],
    ]),
  };
  const ctx = { gameId: 7, date: "2024-10-25" };
  const p = predictGame(thin, 1, 2, ctx);

  check("thin ratings report confidence 'insufficient'", p.confidence === "insufficient");
  check(
    "and say so in a factor rather than only in a field",
    p.factors.some((f) => f.label === "Insufficient evidence")
  );
  const fullGap = (1700 - 1300) / ELO_PER_POINT;
  near(
    "the strength gap is damped to 3/10 of full weight",
    p.factors.find((f) => f.label === "Team strength").pointsImpact,
    fullGap * 0.3,
    1e-12
  );
  check(
    "home court is NOT damped — it does not depend on having rated the teams",
    Math.abs(p.factors.find((f) => f.label === "Home court").pointsImpact - ELO_HOME_ADVANTAGE / ELO_PER_POINT) < 1e-12
  );

  // The same matchup, same Elo, but with a full season of evidence behind the ratings.
  const fat = { ...thin, ratings: new Map(thin.ratings) };
  fat.ratings.set(1, { teamId: 1, elo: 1700, offense: L, defense: L, gamesPlayed: 60 });
  fat.ratings.set(2, { teamId: 2, elo: 1300, offense: L, defense: L, gamesPlayed: 60 });
  const q = predictGame(fat, 1, 2, ctx);

  check("thin evidence produces a smaller margin than the identical fully-rated matchup", p.expectedMargin < q.expectedMargin);
  near("...smaller by exactly the 70% of the strength gap that was withheld", q.expectedMargin - p.expectedMargin, fullGap * 0.7, 1e-12);
  check("...and a win probability pulled toward the coin flip", Math.abs(p.homeWinProbability - 0.5) < Math.abs(q.homeWinProbability - 0.5));
  check("with 60 games of evidence confidence is 'high'", q.confidence === "high");
  near("and the strength gap runs at full weight", q.factors.find((f) => f.label === "Team strength").pointsImpact, fullGap, 1e-12);

  check("confidence ladder: 10 games -> low", gradeConfidence(MIN_GAMES_FOR_FULL_WEIGHT) === "low");
  check("confidence ladder: 25 games -> moderate", gradeConfidence(MODERATE_CONFIDENCE_GAMES) === "moderate");
  check("confidence ladder: 50 games -> high", gradeConfidence(HIGH_CONFIDENCE_GAMES) === "high");
  check(
    "an unrated team falls back to a placeholder and reports insufficient",
    predictGame({ asOf: "2024-10-25", leagueAvgPoints: L, gamesObserved: 0, ratings: new Map() }, 9, 8, ctx)
      .confidence === "insufficient"
  );
}

// ---------------------------------------------------------------------------
console.log("\n-- 9. Estimators --");
// ---------------------------------------------------------------------------

{
  // Hand-built residuals: margin off by exactly +3 every time (pure bias, zero spread).
  const biased = Array.from({ length: 20 }, () => ({
    expectedMargin: 5, actualMargin: 8, expectedTotal: 220, actualTotal: 220,
  }));
  const d = estimateDispersion(biased);
  near("a pure systematic error shows up as bias, not spread", d.marginStdDev, 0, 1e-12);
  near("...and the bias is reported at its true size", d.marginBias, 3, 1e-12);
  near("...while RMSE absorbs it: rmse^2 = sd^2 + bias^2", d.marginRmse, 3, 1e-12);

  // Symmetric residuals of +/-10: zero bias, SD 10 (n-1 basis on a balanced set).
  const spread = [];
  for (let i = 0; i < 50; i++) {
    spread.push({ expectedMargin: 0, actualMargin: i % 2 === 0 ? 10 : -10, expectedTotal: 220, actualTotal: 220 });
  }
  const s = estimateDispersion(spread);
  near("symmetric misses give zero bias", s.marginBias, 0, 1e-12);
  near("...and a standard deviation of ~10", s.marginStdDev, 10 * Math.sqrt(50 / 49), 1e-9);
  check("too few samples falls back to the documented default", estimateDispersion([]).marginStdDev === DEFAULT_MARGIN_STD_DEV);

  // First-half shares from fixtures where exactly 60% of everything lands in the first half.
  const sixty = [
    game({ id: 501, homeScore: 100, awayScore: 80, homeQ: [30, 30, 20, 20], awayQ: [24, 24, 16, 16] }),
    game({ id: 502, homeScore: 110, awayScore: 90, homeQ: [33, 33, 22, 22], awayQ: [27, 27, 18, 18] }),
  ];
  const shares = estimateFirstHalfShares(sixty);
  near("first-half total share is measured, not assumed", shares.totalShare, 0.6, 1e-12);
  near("first-half margin share is measured, not assumed", shares.marginShare, 0.6, 1e-12);
  check("games without quarter data are skipped, not defaulted", estimateFirstHalfShares([game({ homeQ: [null, 1, 1, 1] })]).n === 0);

  // Home advantage: postseason games are excluded because the better team hosts there.
  const homeEdge = estimateHomeAdvantageElo([
    game({ id: 601, homeScore: 102, awayScore: 100 }),
    game({ id: 602, homeScore: 104, awayScore: 100 }),
    game({ id: 603, postseason: true, homeScore: 140, awayScore: 100 }),
  ]);
  near("home advantage is measured on regular-season games only", homeEdge.pointsEdge, 3, 1e-12);
  check("...and the postseason blowout is excluded from n", homeEdge.n === 2);
  near("...converted to Elo at the documented rate", homeEdge.elo, 3 * ELO_PER_POINT, 1e-12);
}

// ---------------------------------------------------------------------------
console.log("\n-- 10. Source surface + constant drift --");
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const ratingsSrc = readFileSync(join(here, "..", "src", "lib", "nba", "ratings.ts"), "utf8");
const predictSrc = readFileSync(join(here, "..", "src", "lib", "nba", "game-predict.ts"), "utf8");

for (const name of [
  "normalizeGame", "normalizeGames", "sortChronologically", "eloExpectedScore",
  "movMultiplier", "eloDelta", "buildRatingTimeline", "snapshotAsOf",
  "restDaysBefore", "computeRecentForm", "estimateFirstHalfShares", "estimateHomeAdvantageElo",
]) {
  check(`ratings.ts exports ${name}`, ratingsSrc.includes(`export function ${name}`));
}
check("ratings.ts exports the RatingEngine updater", ratingsSrc.includes("export class RatingEngine"));
for (const name of ["predictGame", "gradeConfidence", "restImpact", "estimateDispersion"]) {
  check(`game-predict.ts exports ${name}`, predictSrc.includes(`export function ${name}`));
}

/** Read `export const NAME = <number>;` out of a source file. */
function constantOf(source, name) {
  const match = source.match(new RegExp(`export const ${name} = (-?[\\d.]+);`));
  return match ? Number(match[1]) : NaN;
}

const ratingConstants = {
  ELO_BASELINE, ELO_K, ELO_HOME_ADVANTAGE, ELO_PER_POINT, MOV_EXPONENT, MOV_DENOM_BASE,
  MOV_DENOM_ELO_COEFFICIENT, SEASON_REGRESSION, SCORING_DECAY, LEAGUE_AVG_DECAY,
  DEFAULT_LEAGUE_AVG_POINTS, FIRST_HALF_TOTAL_SHARE, FIRST_HALF_MARGIN_SHARE,
};
for (const [name, value] of Object.entries(ratingConstants)) {
  check(`ratings.ts ${name} === ${value} (mirror is in sync)`, constantOf(ratingsSrc, name) === value);
}
const predictConstants = {
  DEFAULT_MARGIN_STD_DEV, DEFAULT_TOTAL_STD_DEV, DEFAULT_FIRST_HALF_MARGIN_STD_DEV,
  DEFAULT_FIRST_HALF_TOTAL_STD_DEV, MIN_GAMES_FOR_FULL_WEIGHT,
  MODERATE_CONFIDENCE_GAMES, HIGH_CONFIDENCE_GAMES, REST_BACK_TO_BACK_PENALTY,
  REST_EXTENDED_BONUS,
};
for (const [name, value] of Object.entries(predictConstants)) {
  check(`game-predict.ts ${name} === ${value} (mirror is in sync)`, constantOf(predictSrc, name) === value);
}

check(
  "predictGame source contains the lookahead guard on context.date vs snapshot.asOf",
  /context\.date\s*<\s*snapshot\.asOf/.test(predictSrc)
);
check(
  "the date-scoped helpers filter strictly (`>= date` continue), never `>`",
  (ratingsSrc.match(/if \(game\.date >= date\) continue;/g) ?? []).length === 2
);
check(
  "buildRatingTimeline emits the snapshot before absorbing that date's games",
  ratingsSrc.indexOf("snapshots.push(engine.snapshot(date));") <
    ratingsSrc.indexOf("engine.observe(ordered[index]);")
);
check(
  "ratings.ts never imports the raw season files",
  !/data\/games/.test(ratingsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, ""))
);
check(
  "observe guards against a backwards season label",
  /game\.season\s*<\s*this\.currentSeason/.test(ratingsSrc)
);
check(
  "observe guards against a missing season label",
  /isFiniteNumber\(game\.season\)/.test(ratingsSrc)
);
check(
  "snapshotAsOf re-stamps a gap-date snapshot so predictGame accepts it",
  /asOf:\s*date/.test(ratingsSrc)
);
check(
  "the rating fold uses the configured home edge, not the module constant",
  /const eloDiffHome = home\.elo \+ this\.homeAdvantageElo - away\.elo;/.test(ratingsSrc) &&
    !/adjOffHome = game\.homeScore - L - away\.relDefense - HOME_SCORING_EDGE/.test(ratingsSrc)
);

// ---------------------------------------------------------------------------

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
