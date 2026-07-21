/**
 * USAGE-RATE / TEAMMATE-OUT MODEL
 *
 * Answers the question Devon asks by hand every night:
 * "The other star is out tonight — somebody has to take those shots. Who absorbs
 *  the usage, and how much more should I expect him to score?"
 *
 * This is a WITH/WITHOUT split model over historical game logs. It is PURE LOGIC:
 * you hand it logs, it hands you splits, projections, and a ranking. No API calls.
 *
 * ---------------------------------------------------------------------------
 * WHY WE NORMALIZE BY MINUTES (read this before "improving" the math)
 * ---------------------------------------------------------------------------
 * A player who scores 19 in 38 minutes instead of 12 in 24 minutes did NOT get
 * more usage — he got more MINUTES. His per-minute scoring rate is identical
 * (0.50 both ways). That distinction matters for betting: a minutes bump is
 * fragile (blowout, foul trouble, load management wipes it out), while a real
 * usage bump (higher rate per minute of floor time) survives a shorter night.
 *
 * So every split reports BOTH:
 *   - `mean`      : per-game average, which is what a prop line is priced on
 *   - `perMinute` : pooled rate (total stat / total minutes), the usage signal
 * and `usageDriven` flags whether the per-minute rate actually moved. Callers
 * can then tell a real usage story apart from a minutes story.
 *
 * ---------------------------------------------------------------------------
 * WHY SMALL SAMPLES ARE REFUSED
 * ---------------------------------------------------------------------------
 * A 2-game "without" sample is noise wearing a suit. Thresholds are explicit
 * (see CONFIDENCE_THRESHOLDS below) and driven by the SMALLER of the two arms —
 * a 60-game "with" arm cannot rescue a 2-game "without" arm. Below the minimum
 * we return confidence "insufficient", apply NO adjustment, and say so in plain
 * English in the explanation string.
 */

// ============ TYPES ============

/** Counting stats this model splits on. Minutes are context, not a target. */
export type UsageStat = "points" | "rebounds" | "assists" | "threes";

export type SplitConfidence = "insufficient" | "low" | "moderate" | "high";

/**
 * One historical game for one player, plus the context we need to split on.
 * `teammatesOut` is the list of teammate ids/names who did NOT play that night.
 */
export interface GameLogWithContext {
  gameId: string;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  minutes: number;
  /** Optional true usage rate (%) if the caller has it. Purely informational. */
  usageRate?: number;
  teammatesOut: string[];
  wasHome: boolean;
  opponent: string;
  /** True when the player himself sat. Excluded from every calculation. */
  didNotPlay?: boolean;
}

/** One side of a with/without split. */
export interface SplitArm {
  games: number;
  /** Per-game average of the stat. This is what a prop line is priced on. */
  mean: number;
  /** Pooled rate: total stat / total minutes. This is the usage signal. */
  perMinute: number;
  /** Per-game average minutes, so callers can see the minutes story. */
  meanMinutes: number;
}

export interface WithWithoutSplit {
  playerId: string;
  teammateId: string;
  stat: UsageStat;
  withTeammate: SplitArm;
  withoutTeammate: SplitArm;
  /** withoutTeammate.mean - withTeammate.mean (per game). */
  delta: number;
  /** Percent change of the per-game mean. 0 when the "with" mean is 0. */
  percentChange: number;
  /** withoutTeammate.perMinute - withTeammate.perMinute. */
  perMinuteDelta: number;
  perMinutePercentChange: number;
  /** How much the minutes themselves moved. Big number here = minutes story. */
  minutesDelta: number;
  /** Change in reported usage rate, or null when logs don't carry usageRate. */
  usageRateDelta: number | null;
  /** True when the per-minute RATE moved in the same direction as the mean. */
  usageDriven: boolean;
  /** The smaller of the two arms — the one that limits what we can claim. */
  sampleSize: number;
  confidence: SplitConfidence;
}

export interface PlayerSeason {
  playerId: string;
  logs: GameLogWithContext[];
}

export interface ProjectionInput {
  player: PlayerSeason;
  /** Teammates ruled out for the game being projected. */
  teammatesOut: string[];
  stat: UsageStat;
  /**
   * Optional baseline to adjust from — pass the book's prop line or your own
   * number. Defaults to the player's per-game mean across all games he played.
   */
  baseline?: number;
}

export interface ProjectionContribution {
  teammateId: string;
  /** Raw per-game delta from the with/without split. */
  delta: number;
  perMinuteDelta: number;
  sampleSize: number;
  confidence: SplitConfidence;
  usageDriven: boolean;
  /** Delta actually added to the baseline after shrinkage + overlap decay. */
  appliedDelta: number;
}

export interface UsageProjection {
  playerId: string;
  stat: UsageStat;
  baseline: number;
  projected: number;
  /** projected - baseline. */
  adjustment: number;
  confidence: SplitConfidence;
  contributions: ProjectionContribution[];
  explanation: string;
}

export interface BeneficiaryRanking {
  playerId: string;
  delta: number;
  percentChange: number;
  perMinuteDelta: number;
  minutesDelta: number;
  /** delta shrunk by confidence — what the ranking actually sorts on. */
  adjustedDelta: number;
  sampleSize: number;
  confidence: SplitConfidence;
  usageDriven: boolean;
  note: string;
}

// ============ TUNING CONSTANTS (all thresholds explicit on purpose) ============

/**
 * Sample-size ladder, evaluated against the SMALLER arm of the split.
 * Below MIN_SAMPLE we refuse to project at all.
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Fewer than this many games in the smaller arm => "insufficient". */
  MIN_SAMPLE: 4,
  /** >= this => "low" (4-5 games). */
  LOW: 4,
  /** >= this => "moderate" (6-9 games). */
  MODERATE: 6,
  /** >= this => "high" (10+ games). */
  HIGH: 10,
} as const;

/**
 * Shrinkage toward zero by confidence. A low-confidence delta is real-ish but
 * half of it is probably noise, so we only bank half of it.
 */
const CONFIDENCE_WEIGHT: Record<SplitConfidence, number> = {
  insufficient: 0,
  low: 0.5,
  moderate: 0.8,
  high: 1,
};

/**
 * Two stars out does not double the bump — the absences overlap, and there is a
 * ceiling on how many shots one man can take. Each additional teammate-out
 * contributes at half the weight of the previous one.
 */
const OVERLAP_DECAY = 0.5;

/** Per-minute rate must move at least this much (%) to count as a usage signal. */
const USAGE_SIGNAL_PCT = 5;

/** A game only counts if the player actually took the floor. */
const MIN_MINUTES_TO_COUNT = 0;

// ============ HELPERS ============

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return r1(((to - from) / Math.abs(from)) * 100);
}

/** DNPs and zero-minute games are excluded everywhere. */
function playedGames(logs: GameLogWithContext[]): GameLogWithContext[] {
  return logs.filter((g) => g.didNotPlay !== true && g.minutes > MIN_MINUTES_TO_COUNT);
}

function statValue(log: GameLogWithContext, stat: UsageStat): number {
  return log[stat];
}

function buildArm(logs: GameLogWithContext[], stat: UsageStat): SplitArm {
  if (logs.length === 0) {
    return { games: 0, mean: 0, perMinute: 0, meanMinutes: 0 };
  }
  const totalStat = logs.reduce((s, g) => s + statValue(g, stat), 0);
  const totalMinutes = logs.reduce((s, g) => s + g.minutes, 0);
  return {
    games: logs.length,
    mean: r1(totalStat / logs.length),
    // Pooled rate rather than mean-of-ratios: pooling is far more stable when a
    // player has a 6-minute cameo in the sample.
    perMinute: totalMinutes > 0 ? r3(totalStat / totalMinutes) : 0,
    meanMinutes: r1(totalMinutes / logs.length),
  };
}

/** Mean reported usage rate, or null if any game in the arm lacks it. */
function armUsageRate(logs: GameLogWithContext[]): number | null {
  if (logs.length === 0) return null;
  if (logs.some((g) => g.usageRate === undefined)) return null;
  return r1(logs.reduce((s, g) => s + (g.usageRate as number), 0) / logs.length);
}

/**
 * Confidence from the SMALLER arm. Documented ladder:
 *   0-3 games  -> insufficient (no projection is emitted)
 *   4-5 games  -> low
 *   6-9 games  -> moderate
 *   10+ games  -> high
 */
export function confidenceForSample(sampleSize: number): SplitConfidence {
  if (sampleSize >= CONFIDENCE_THRESHOLDS.HIGH) return "high";
  if (sampleSize >= CONFIDENCE_THRESHOLDS.MODERATE) return "moderate";
  if (sampleSize >= CONFIDENCE_THRESHOLDS.LOW) return "low";
  return "insufficient";
}

const STAT_LABEL: Record<UsageStat, string> = {
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  threes: "threes",
};

// ============ CORE: WITH / WITHOUT SPLIT ============

/**
 * Split a player's game logs into games the given teammate played vs. games he
 * sat, and compare the player's production across the two.
 *
 * `logs` are the PLAYER's logs; each log carries `teammatesOut`, so we never
 * need the teammate's own logs.
 */
export function withWithoutSplit(
  logs: GameLogWithContext[],
  teammateId: string,
  stat: UsageStat,
  playerId: string = "player"
): WithWithoutSplit {
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

  // "Usage driven" means the RATE moved, not just the clock. Same-sign check
  // keeps a rate drop from being read as support for a per-game bump.
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

// ============ CORE: PROJECTION ============

/**
 * Project a stat line for a game where one or more teammates are ruled out.
 *
 * Combining rule: each teammate's split delta is shrunk by its confidence, the
 * contributions are sorted by magnitude, and each successive one is halved
 * (OVERLAP_DECAY) because absences overlap and shots are finite. Splits below
 * the minimum sample contribute nothing at all.
 */
export function projectWithTeammateOut(input: ProjectionInput): UsageProjection {
  const { player, teammatesOut, stat, baseline } = input;
  const played = playedGames(player.logs);

  const seasonMean =
    played.length > 0
      ? r1(played.reduce((s, g) => s + statValue(g, stat), 0) / played.length)
      : 0;
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

  // Shrink first, then sort by shrunk magnitude, then decay the extras.
  const shrunk = splits.map((s) => ({
    split: s,
    weighted: r1(s.delta * CONFIDENCE_WEIGHT[s.confidence]),
  }));
  shrunk.sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted));

  let decayIndex = 0;
  const contributions: ProjectionContribution[] = shrunk.map(({ split, weighted }) => {
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
  // The projection is only as trustworthy as its weakest ingredient.
  const confidence: SplitConfidence =
    usable.length === 0
      ? "insufficient"
      : usable
          .map((s) => s.confidence)
          .reduce((weakest, c) =>
            CONFIDENCE_WEIGHT[c] < CONFIDENCE_WEIGHT[weakest] ? c : weakest
          );

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

function buildExplanation(
  playerId: string,
  label: string,
  base: number,
  projected: number,
  adjustment: number,
  confidence: SplitConfidence,
  splits: WithWithoutSplit[]
): string {
  const thin = splits.filter((s) => s.confidence === "insufficient");
  const usable = splits.filter((s) => s.confidence !== "insufficient");

  if (usable.length === 0) {
    const detail = thin
      .map(
        (s) =>
          `only ${s.sampleSize} usable game${s.sampleSize === 1 ? "" : "s"} without ${s.teammateId}`
      )
      .join(", ");
    return `Not enough history to project ${playerId}: ${detail} (minimum ${CONFIDENCE_THRESHOLDS.MIN_SAMPLE}). No adjustment applied — holding the baseline ${base} ${label}. Confidence: insufficient.`;
  }

  const parts = usable.map((s) => {
    const dir = s.delta >= 0 ? "up" : "down";
    const mins = `${s.minutesDelta >= 0 ? "+" : ""}${s.minutesDelta} min`;
    const ratePct = `${s.perMinutePercentChange >= 0 ? "+" : ""}${s.perMinutePercentChange}%`;
    // Three cases, and the middle one must never be described as "flat": a rate
    // that moved MEANINGFULLY but not in step with the per-game change is the
    // most fragile signal there is (more counting stats purely on volume, at
    // worse efficiency). Calling that "barely moved" would be a lie.
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

// ============ CORE: BENEFICIARY RANKING ============

/**
 * "LeBron is out — who absorbs the usage?"
 *
 * Runs the with/without split for every teammate and ranks them by the
 * confidence-shrunk delta. Splits that fail the sample minimum are still
 * returned (transparency) but always sort last, so a 2-game mirage can never
 * outrank a real 12-game signal.
 */
export function rankBeneficiaries(
  teamPlayers: PlayerSeason[],
  outTeammateId: string,
  stat: UsageStat
): BeneficiaryRanking[] {
  const rows: BeneficiaryRanking[] = [];

  for (const p of teamPlayers) {
    if (p.playerId === outTeammateId) continue;
    const split = withWithoutSplit(p.logs, outTeammateId, stat, p.playerId);
    if (split.withTeammate.games === 0 && split.withoutTeammate.games === 0) continue;

    const adjustedDelta = r1(split.delta * CONFIDENCE_WEIGHT[split.confidence]);

    let note: string;
    if (split.confidence === "insufficient") {
      note = `Only ${split.sampleSize} comparable game${split.sampleSize === 1 ? "" : "s"} — not enough to trust.`;
    } else if (split.usageDriven) {
      note = `Real usage bump: ${split.withTeammate.perMinute} to ${split.withoutTeammate.perMinute} per minute.`;
    } else if (Math.abs(split.perMinutePercentChange) >= USAGE_SIGNAL_PCT) {
      // Rate moved, but not in step with the per-game change. Do NOT call this
      // flat — it is the fragile case (volume up, efficiency down, or vice versa).
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
    if (aThin !== bThin) return aThin - bThin; // trustworthy rows first
    if (b.adjustedDelta !== a.adjustedDelta) return b.adjustedDelta - a.adjustedDelta;
    return b.sampleSize - a.sampleSize; // tie-break on the bigger sample
  });
}
