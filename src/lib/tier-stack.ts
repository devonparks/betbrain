/**
 * TIER-STACK GENERATOR
 * --------------------
 * Devon's signature method, in code.
 *
 * The idea: instead of projecting a player's mean, you bet their FLOOR. A
 * high-usage star who plays 35 minutes a night is close to certain to reach
 * "10+ points" — the odds are terrible precisely because it is nerfed, but the
 * leg almost never misses. You stack a lot of those legs, then repeat the
 * exercise one tier up (15+), then again around their actual averages (20+/25+).
 *
 * IMPORTANT SEMANTICS: a threshold here is a PLUS threshold ("10+"), so a game
 * clears when value >= threshold. That is the same thing a sportsbook prices as
 * "over 9.5".
 *
 * ANALYTICS ONLY. Nothing in this file places or facilitates a bet.
 *
 * Everything is pure logic over inputs defined below — no API calls, no clock,
 * no randomness — so it can be verified with fixtures (tools/verify-tier-stack.mjs).
 */

// ============ TYPES ============

export type TierStat = "points" | "rebounds" | "assists" | "threes";

export interface PlayerGameLog {
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  minutes: number;
  wasHome: boolean;
  opponent: string;
  /** True when the player was out (injury, rest, DNP-CD). Excluded from rates. */
  didNotPlay?: boolean;
}

export interface PlayerSeason {
  playerId: string;
  name: string;
  team: string;
  /** Most recent game first. */
  logs: PlayerGameLog[];
  isStarter?: boolean;
  usageRate?: number;
  /** Id of the game this player is in TONIGHT — used to detect correlated legs. */
  upcomingGameId?: string;
}

export interface ClearedRate {
  /** Games in the window where value >= threshold. */
  cleared: number;
  /** Games in the window the player actually played. DNPs are NOT counted. */
  played: number;
  /** cleared / played, 0 when the player never played. */
  rate: number;
}

export interface TierStackLeg {
  playerId: string;
  name: string;
  team: string;
  stat: TierStat;
  threshold: number;
  /** Raw cleared/played over the window. */
  hitRate: number;
  cleared: number;
  played: number;
  /**
   * Laplace-smoothed estimate (cleared + 1) / (played + 2). Used for the naive
   * product so a 12-for-12 sample does not get treated as a literal 100%.
   */
  legProbability: number;
  recentForm: {
    last5Avg: number;
    windowAvg: number;
    direction: "up" | "down" | "stable";
  };
  homeAwaySplit: {
    home: number;
    away: number;
    homeRate: number;
    awayRate: number;
  };
  floorScore: number;
  /** Grouping key used for correlation detection (game id, else team). */
  correlationKey: string;
  why: string;
}

export interface CorrelatedGroup {
  key: string;
  playerNames: string[];
}

export interface TierStackInput {
  players: PlayerSeason[];
  stat: TierStat;
  threshold: number;
  /** Devon stacks ~25. Default 25. */
  maxLegs?: number;
  /** Minimum floorScore to make the ticket. Default 70. */
  minFloorScore?: number;
  /** Devon's banned list — players he refuses to bet on. */
  excludePlayerIds?: string[];
  /** Size of the recent-games window. Default 15 played games. */
  lastN?: number;
}

export interface TierStack {
  stat: TierStat;
  threshold: number;
  legs: TierStackLeg[];
  /**
   * Product of the leg probabilities. NAIVE on purpose: it assumes the legs are
   * independent, which they are not. Always read the warnings with it.
   */
  naiveCombinedProbability: number;
  correlatedGroups: CorrelatedGroup[];
  warnings: string[];
}

export interface TierSuggestion {
  tier: "floor" | "mid" | "reach";
  threshold: number;
  /** Players in the pool with floorScore >= 70 at this threshold. */
  qualifyingPlayers: number;
  /** Median cleared-rate across the pool at this threshold. */
  medianHitRate: number;
  rationale: string;
}

// ============ CONSTANTS ============

const DEFAULT_LAST_N = 15;
const DEFAULT_MAX_LEGS = 25;
const DEFAULT_MIN_FLOOR_SCORE = 70;
const QUALIFYING_FLOOR_SCORE = 70;

/** Rounding step used when suggesting a tier ladder, per stat. */
const TIER_STEP: Record<TierStat, number> = {
  points: 5,
  rebounds: 2,
  assists: 2,
  threes: 1,
};

export const CORRELATION_WARNING =
  "naiveCombinedProbability multiplies the legs together and assumes they are independent. " +
  "They are not: legs share game pace, a blowout benches every starter in that game at once, " +
  "and one injury reshuffles usage for a whole team. The real probability is LOWER than this number. " +
  "Treat it as a ceiling, never as the odds.";

// ============ CORE ============

function isDidNotPlay(log: PlayerGameLog): boolean {
  return log.didNotPlay === true || log.minutes <= 0;
}

function statValue(log: PlayerGameLog, stat: TierStat): number {
  return log[stat];
}

function playedLogs(logs: PlayerGameLog[], lastN: number): PlayerGameLog[] {
  // DNPs are dropped BEFORE the window is taken, so "last 15" means the last 15
  // games the player was actually available for.
  return logs.filter((l) => !isDidNotPlay(l)).slice(0, Math.max(0, lastN));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round(v: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(v * f) / f;
}

/**
 * Round to N significant digits. Used for the combined probability: a 25-leg
 * stack of coin flips is ~1e-7, and fixed-decimal rounding would report that as
 * a flat 0 — indistinguishable from "there are no legs", and it reads as
 * "impossible" rather than "vanishingly unlikely".
 */
function roundSignificant(v: number, digits: number): number {
  if (!Number.isFinite(v) || v === 0) return 0;
  const exp = Math.ceil(Math.log10(Math.abs(v)));
  const f = Math.pow(10, digits - exp);
  return Math.round(v * f) / f;
}

/**
 * Hit rate for a plus-threshold ("10+ points") over the last N games the player
 * PLAYED. Games he missed are excluded from the denominator — a missed game is
 * not a missed threshold, and counting it as one understates every star who has
 * ever had a rest night.
 */
export function clearedRate(
  logs: PlayerGameLog[],
  stat: TierStat,
  threshold: number,
  lastN: number = DEFAULT_LAST_N
): ClearedRate {
  const window = playedLogs(logs, lastN);
  const cleared = window.filter((l) => statValue(l, stat) >= threshold).length;
  const played = window.length;
  return {
    cleared,
    played,
    rate: played === 0 ? 0 : cleared / played,
  };
}

interface FloorParts {
  consistency: number;
  margin: number;
  minutes: number;
  sampleFactor: number;
  availabilityFactor: number;
  total: number;
  windowAvg: number;
  minutesAvg: number;
  dnps: number;
  rate: ClearedRate;
}

/**
 * Weighting (documented on purpose — this is the opinionated part):
 *
 *   consistency  0-55  hit rate over the window. The method lives or dies here.
 *   margin       0-30  how far ABOVE the threshold he typically lands.
 *                      cushion = (windowAvg - threshold) / threshold, clamped to
 *                      [0,1] then scaled. Averaging 25 on a 10+ line (cushion
 *                      1.5 -> capped) scores the full 30; averaging 11 on the
 *                      same line (cushion 0.1) scores 3. This is the difference
 *                      between a bet and a coin flip that happens to be 12-0.
 *   minutes      0-15  minutes stability x minutes volume. A floor bet is really
 *                      a bet on playing time: stability = 1 - cv/0.35 (cv =
 *                      stdev/mean of minutes), volume = min(minutes/28, 1).
 *
 * Then two multiplicative haircuts:
 *   sampleFactor        min(played/8, 1)   — 3 games is not evidence.
 *   availabilityFactor  0.85 + 0.15 * (played / totalGames) — a guy who misses
 *                       half the schedule is a worse leg even when he does play.
 */
function floorParts(
  player: PlayerSeason,
  stat: TierStat,
  threshold: number,
  lastN: number = DEFAULT_LAST_N
): FloorParts {
  const window = playedLogs(player.logs, lastN);
  const rate = clearedRate(player.logs, stat, threshold, lastN);
  const values = window.map((l) => statValue(l, stat));
  const minutesValues = window.map((l) => l.minutes);
  const windowAvg = mean(values);
  const minutesAvg = mean(minutesValues);

  const consistency = rate.rate * 55;

  const safeThreshold = Math.max(threshold, 1);
  const cushion = (windowAvg - threshold) / safeThreshold;
  const margin = clamp(cushion, 0, 1) * 30;

  const cv = minutesAvg > 0 ? stdev(minutesValues) / minutesAvg : 1;
  const stability = clamp(1 - cv / 0.35, 0, 1);
  const volume = clamp(minutesAvg / 28, 0, 1);
  const minutes = stability * volume * 15;

  // Availability is measured over the RAW span the window actually covers: walk
  // the logs until we have collected window.length played games and count the
  // DNPs in that same stretch. (Taking the first `lastN` raw logs instead
  // undercounts DNPs and flatters exactly the injury-prone players this haircut
  // exists to penalise.)
  let dnps = 0;
  let seenPlayed = 0;
  for (const log of player.logs) {
    if (seenPlayed >= window.length) break;
    if (isDidNotPlay(log)) dnps++;
    else seenPlayed++;
  }
  const totalGames = window.length + dnps;

  const sampleFactor = window.length === 0 ? 0 : clamp(window.length / 8, 0, 1);
  const availabilityFactor =
    totalGames === 0 ? 0 : 0.85 + 0.15 * (window.length / totalGames);

  const raw = (consistency + margin + minutes) * sampleFactor * availabilityFactor;
  // A non-finite threshold makes the score meaningless — return 0, never NaN.
  const total = Number.isFinite(raw) ? clamp(raw, 0, 100) : 0;

  return {
    consistency,
    margin,
    minutes,
    sampleFactor,
    availabilityFactor,
    total,
    windowAvg,
    minutesAvg,
    dnps,
    rate,
  };
}

/**
 * 0-100 consistency score for "this player clears this threshold". See
 * floorParts() above for the weighting and why each piece is there.
 */
export function floorScore(
  player: PlayerSeason,
  stat: TierStat,
  threshold: number,
  lastN: number = DEFAULT_LAST_N
): number {
  return round(floorParts(player, stat, threshold, lastN).total, 1);
}

function buildLeg(
  player: PlayerSeason,
  stat: TierStat,
  threshold: number,
  lastN: number
): TierStackLeg {
  const parts = floorParts(player, stat, threshold, lastN);
  const window = playedLogs(player.logs, lastN);
  const values = window.map((l) => statValue(l, stat));
  const last5Avg = mean(values.slice(0, 5));
  const windowAvg = parts.windowAvg;

  let direction: "up" | "down" | "stable" = "stable";
  if (values.length >= 5) {
    if (last5Avg - windowAvg > 1.5) direction = "up";
    else if (windowAvg - last5Avg > 1.5) direction = "down";
  }

  const homeLogs = window.filter((l) => l.wasHome);
  const awayLogs = window.filter((l) => !l.wasHome);
  const homeVals = homeLogs.map((l) => statValue(l, stat));
  const awayVals = awayLogs.map((l) => statValue(l, stat));

  const cushion = windowAvg - threshold;
  const dnpNote = parts.dnps > 0 ? ` (${parts.dnps} DNP excluded)` : "";
  const why =
    `Cleared ${threshold}+ ${stat} in ${parts.rate.cleared}/${parts.rate.played} played` +
    `${dnpNote}, averaging ${round(windowAvg, 1)} ` +
    `(${cushion >= 0 ? "+" : ""}${round(cushion, 1)} cushion) on ` +
    `${round(parts.minutesAvg, 1)} min a night.`;

  return {
    playerId: player.playerId,
    name: player.name,
    team: player.team,
    stat,
    threshold,
    hitRate: round(parts.rate.rate, 4),
    cleared: parts.rate.cleared,
    played: parts.rate.played,
    legProbability: round(
      (parts.rate.cleared + 1) / (parts.rate.played + 2),
      4
    ),
    recentForm: {
      last5Avg: round(last5Avg, 1),
      windowAvg: round(windowAvg, 1),
      direction,
    },
    homeAwaySplit: {
      home: round(mean(homeVals), 1),
      away: round(mean(awayVals), 1),
      homeRate:
        homeVals.length === 0
          ? 0
          : round(
              homeVals.filter((v) => v >= threshold).length / homeVals.length,
              4
            ),
      awayRate:
        awayVals.length === 0
          ? 0
          : round(
              awayVals.filter((v) => v >= threshold).length / awayVals.length,
              4
            ),
    },
    floorScore: round(parts.total, 1),
    correlationKey: player.upcomingGameId ?? `team:${player.team}`,
    why,
  };
}

/**
 * Build one tier of the stack: every eligible player at a single threshold,
 * ranked by floorScore, capped at maxLegs.
 */
export function buildTierStack(input: TierStackInput): TierStack {
  const {
    players,
    stat,
    threshold,
    maxLegs = DEFAULT_MAX_LEGS,
    minFloorScore = DEFAULT_MIN_FLOOR_SCORE,
    excludePlayerIds = [],
    lastN = DEFAULT_LAST_N,
  } = input;

  const warnings: string[] = [];
  // The independence warning is unconditional. The naive number must never be
  // presented on its own.
  warnings.push(CORRELATION_WARNING);

  const banned = new Set(excludePlayerIds);

  if (!Array.isArray(players) || players.length === 0) {
    warnings.push("No players supplied — nothing to stack.");
    return {
      stat,
      threshold,
      legs: [],
      naiveCombinedProbability: 0,
      correlatedGroups: [],
      warnings,
    };
  }

  if (!Number.isFinite(threshold) || threshold <= 0) {
    warnings.push(
      `Threshold ${threshold} is degenerate — every played game clears it, so the hit rates below carry no information.`
    );
  }

  if (maxLegs <= 0) {
    warnings.push("maxLegs is 0 or negative — returning an empty stack.");
  }

  const candidates = players
    .filter((p) => !banned.has(p.playerId))
    .map((p) => buildLeg(p, stat, threshold, lastN))
    .filter((leg) => leg.played > 0 && leg.floorScore >= minFloorScore)
    .sort(
      (a, b) =>
        b.floorScore - a.floorScore ||
        b.hitRate - a.hitRate ||
        b.recentForm.windowAvg - a.recentForm.windowAvg
    );

  const legs = maxLegs > 0 ? candidates.slice(0, maxLegs) : [];

  if (banned.size > 0) {
    const hits = players.filter((p) => banned.has(p.playerId));
    if (hits.length > 0) {
      warnings.push(
        `${hits.length} banned player${hits.length === 1 ? "" : "s"} excluded: ${hits
          .map((p) => p.name)
          .join(", ")}.`
      );
    }
  }

  if (legs.length === 0 && maxLegs > 0) {
    warnings.push(
      `No player reached a floorScore of ${minFloorScore} at ${threshold}+ ${stat}. Drop the threshold a tier or loosen minFloorScore.`
    );
  }

  // --- correlation grouping ---
  const groups = new Map<string, string[]>();
  for (const leg of legs) {
    const list = groups.get(leg.correlationKey) ?? [];
    list.push(leg.name);
    groups.set(leg.correlationKey, list);
  }
  const correlatedGroups: CorrelatedGroup[] = Array.from(groups.entries())
    .filter(([, names]) => names.length > 1)
    .map(([key, playerNames]) => ({ key, playerNames }));

  for (const group of correlatedGroups) {
    const source = group.key.startsWith("team:")
      ? `the same team, and therefore the same game (${group.key.slice(5)})`
      : `the same game (${group.key})`;
    warnings.push(
      `${group.playerNames.length} legs come from ${source}: ${group.playerNames.join(", ")}. ` +
        "A blowout, a slow pace, or an early foul-out hits all of them at once — these legs are positively correlated, so the stack is riskier than the math suggests."
    );
  }

  // Being blunt about a FALSE NEGATIVE in the correlation detector: without a
  // game id, two players on OPPOSING teams in the same game look independent.
  const fallbackLegs = legs.filter((l) => l.correlationKey.startsWith("team:"));
  if (fallbackLegs.length > 0) {
    warnings.push(
      `${fallbackLegs.length} legs have no upcomingGameId, so same-game detection fell back to grouping by team. ` +
        "Two players on OPPOSING teams in the same game will NOT be flagged as correlated. Supply upcomingGameId to catch them."
    );
  }

  const thinSamples = legs.filter((l) => l.played < 5);
  if (thinSamples.length > 0) {
    warnings.push(
      `Thin sample on ${thinSamples.map((l) => `${l.name} (${l.played} played)`).join(", ")} — the hit rate is not yet meaningful.`
    );
  }

  const naiveCombinedProbability =
    legs.length === 0
      ? 0
      : roundSignificant(
          legs.reduce((acc, leg) => acc * leg.legProbability, 1),
          6
        );

  if (legs.length >= 10) {
    warnings.push(
      `${legs.length} legs stacked. Even at a genuine 95% per leg the ticket is ~${round(
        Math.pow(0.95, legs.length) * 100,
        1
      )}% — one star two points short before a late foul kills the whole thing.`
    );
  }

  return {
    stat,
    threshold,
    legs,
    naiveCombinedProbability,
    correlatedGroups,
    warnings,
  };
}

// ============ TIER LADDER ============

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function roundDownToStep(value: number, step: number): number {
  return Math.max(step, Math.floor(value / step) * step);
}

/**
 * Recommend the 10+/15+/20+ style ladder from the actual pool instead of
 * hardcoding numbers. Pools every played game from every player, then reads the
 * ladder off the distribution:
 *
 *   floor  5th percentile   — the number they basically always reach
 *   mid    30th percentile  — the nerfed-but-not-free tier
 *   reach  55th percentile  — around their typical output
 *
 * Each is rounded DOWN to a sane step (5 for points, 2 for boards/dimes, 1 for
 * threes) and forced strictly increasing.
 */
export function suggestTiers(
  players: PlayerSeason[],
  stat: TierStat,
  lastN: number = DEFAULT_LAST_N
): TierSuggestion[] {
  if (!Array.isArray(players) || players.length === 0) return [];

  const pool: number[] = [];
  for (const player of players) {
    for (const log of playedLogs(player.logs, lastN)) {
      pool.push(statValue(log, stat));
    }
  }
  if (pool.length === 0) return [];

  const sorted = [...pool].sort((a, b) => a - b);
  const step = TIER_STEP[stat];

  const floorT = roundDownToStep(quantile(sorted, 0.05), step);
  const midT = Math.max(roundDownToStep(quantile(sorted, 0.3), step), floorT + step);
  const reachT = Math.max(roundDownToStep(quantile(sorted, 0.55), step), midT + step);

  const specs: { tier: "floor" | "mid" | "reach"; threshold: number; blurb: string }[] = [
    {
      tier: "floor",
      threshold: floorT,
      blurb: "the nerfed tier — awful odds, near-certain legs. This is the base of the stack.",
    },
    {
      tier: "mid",
      threshold: midT,
      blurb: "one tier up for the guys who actually score. Real odds, still a floor bet.",
    },
    {
      tier: "reach",
      threshold: reachT,
      blurb: "around their averages. This is the tier that pays when all three hit on the same night.",
    },
  ];

  return specs.map((spec) => {
    const rates = players
      .map((p) => clearedRate(p.logs, stat, spec.threshold, lastN))
      .filter((r) => r.played > 0)
      .map((r) => r.rate);
    const qualifying = players.filter(
      (p) => floorScore(p, stat, spec.threshold, lastN) >= QUALIFYING_FLOOR_SCORE
    ).length;

    return {
      tier: spec.tier,
      threshold: spec.threshold,
      qualifyingPlayers: qualifying,
      medianHitRate: round(median(rates), 4),
      rationale: `${spec.threshold}+ ${stat} — ${spec.blurb} ${qualifying} of ${players.length} players score 70+ on floor consistency here.`,
    };
  });
}
