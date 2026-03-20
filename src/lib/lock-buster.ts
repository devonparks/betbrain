import { ESPNPlayerGameLog, ESPNGameData } from "./stats-api";

export interface VaultProp {
  id: string;
  player: string;
  stat: "points" | "rebounds" | "assists" | "steals" | "blocks" | "fg3m";
  line: number;
  direction: "over" | "under";
  tier: "lock" | "safe" | "coinflip" | "risky" | "hailmary";
  hitRate: number; // 0-1
  avg: number;
  lastN: number; // how many games used
  note?: string;
  createdAt: string;
}

export interface LockBuster {
  player: string;
  stat: string;
  line: number;
  hitRate: number; // how often this "lock" actually hits (high = safe)
  bustRate: number; // how often it fails
  bustFactors: string[];
  riskLevel: "low" | "medium" | "high"; // risk of busting
  avgStat: number;
  minStat: number;
  gamesUnder: number;
  totalGames: number;
  verdict: string;
}

const STAT_LABELS: Record<string, string> = {
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  steals: "STL",
  blocks: "BLK",
  fg3m: "3PM",
};

/**
 * Calculate tier based on hit rate
 */
export function calculateTier(
  hitRate: number
): VaultProp["tier"] {
  if (hitRate >= 0.9) return "lock";
  if (hitRate >= 0.7) return "safe";
  if (hitRate >= 0.5) return "coinflip";
  if (hitRate >= 0.3) return "risky";
  return "hailmary";
}

/**
 * Calculate hit rate for a stat line over game logs
 */
export function calculateHitRate(
  logs: ESPNPlayerGameLog[],
  stat: VaultProp["stat"],
  line: number,
  direction: "over" | "under"
): { hitRate: number; avg: number; hits: number; total: number } {
  if (logs.length === 0) return { hitRate: 0, avg: 0, hits: 0, total: 0 };

  let hits = 0;
  let total = 0;

  for (const log of logs) {
    const value = log[stat] as number;
    if (value === undefined) continue;
    total++;
    if (direction === "over" && value > line) hits++;
    if (direction === "under" && value < line) hits++;
  }

  const avg =
    logs.reduce((s, g) => s + ((g[stat] as number) ?? 0), 0) / logs.length;

  return {
    hitRate: total > 0 ? hits / total : 0,
    avg,
    hits,
    total,
  };
}

/**
 * Detect "locks most likely to bust" — props that look automatic
 * but have hidden risk factors
 */
export function detectLockBusters(
  playerName: string,
  logs: ESPNPlayerGameLog[],
  gameData?: ESPNGameData | null
): LockBuster[] {
  if (logs.length < 5) return [];

  const busters: LockBuster[] = [];
  const last15 = logs.slice(0, 15);
  const last5 = logs.slice(0, 5);

  // Check common "lock" stat lines
  const lockChecks: { stat: keyof ESPNPlayerGameLog; lines: number[] }[] = [
    { stat: "points", lines: [10, 15, 20, 25] },
    { stat: "rebounds", lines: [4, 6, 8, 10] },
    { stat: "assists", lines: [3, 5, 7, 10] },
    { stat: "fg3m", lines: [1, 2, 3] },
  ];

  for (const check of lockChecks) {
    for (const line of check.lines) {
      const values = last15.map((g) => g[check.stat] as number);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;

      // Only look at lines that SEEM like locks (hit 80%+ of the time)
      const overCount = values.filter((v) => v > line).length;
      const hitRate = overCount / values.length;

      if (hitRate < 0.8) continue; // Not a "lock" — skip

      // Now analyze bust risk
      const bustFactors: string[] = [];
      const minVal = Math.min(...values);
      const recentValues = last5.map((g) => g[check.stat] as number);
      const recentAvg =
        recentValues.reduce((a, b) => a + b, 0) / recentValues.length;

      // Factor 1: Recent trend is declining
      if (recentAvg < avg * 0.85) {
        bustFactors.push(
          `Trending down: ${recentAvg.toFixed(1)} avg last 5 vs ${avg.toFixed(1)} overall`
        );
      }

      // Factor 2: Minutes variance — if minutes drop, stats drop
      const avgMinutes =
        last15.reduce((s, g) => s + g.minutes, 0) / last15.length;
      const recentMinutes =
        last5.reduce((s, g) => s + g.minutes, 0) / last5.length;
      if (recentMinutes < avgMinutes * 0.9) {
        bustFactors.push(
          `Minutes dipping: ${recentMinutes.toFixed(0)} recent vs ${avgMinutes.toFixed(0)} avg`
        );
      }

      // Factor 3: Has busted this line recently despite being a "lock"
      const recentBusts = recentValues.filter((v) => v <= line).length;
      if (recentBusts >= 1) {
        bustFactors.push(
          `Failed ${recentBusts}x in last 5 games despite 80%+ overall hit rate`
        );
      }

      // Factor 4: Blowout risk — in blowouts, stars sit 4th quarter
      const blowoutGames = last15.filter((g) => {
        const result = g.result ?? "";
        const margin = parseInt(result.replace(/[WL]\s*/, "")) || 0;
        return margin > 20;
      });
      if (blowoutGames.length >= 3) {
        const blowoutAvg =
          blowoutGames.reduce((s, g) => s + (g[check.stat] as number), 0) /
          blowoutGames.length;
        if (blowoutAvg < avg * 0.85) {
          bustFactors.push(
            `In blowouts, avg drops to ${blowoutAvg.toFixed(1)} (sits in garbage time)`
          );
        }
      }

      // Factor 5: How close to the line is the average?
      const margin = avg - line;
      const marginPct = margin / line;
      if (marginPct < 0.25) {
        bustFactors.push(
          `Average (${avg.toFixed(1)}) is only ${margin.toFixed(1)} above the line — thin margin`
        );
      }

      // Factor 6: Variance — high variance means more bust potential
      const stdDev = Math.sqrt(
        values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length
      );
      if (stdDev > avg * 0.35) {
        bustFactors.push(
          `High variance (±${stdDev.toFixed(1)}) — inconsistent performer`
        );
      }

      // Factor 7: Opponent matchup
      if (gameData) {
        const isHomePlr = gameData.homeTeam.players.some(
          (p) => p.name === playerName
        );
        const opponent = isHomePlr
          ? gameData.awayTeam.name
          : gameData.homeTeam.name;

        // Check historical vs this opponent
        const vsOpponent = last15.filter((g) =>
          g.opponent?.includes(
            isHomePlr
              ? gameData.awayTeam.abbreviation
              : gameData.homeTeam.abbreviation
          )
        );
        if (vsOpponent.length >= 2) {
          const vsAvg =
            vsOpponent.reduce((s, g) => s + (g[check.stat] as number), 0) /
            vsOpponent.length;
          if (vsAvg < avg * 0.85) {
            bustFactors.push(
              `Averages only ${vsAvg.toFixed(1)} ${STAT_LABELS[check.stat]} vs ${opponent}`
            );
          }
        }
      }

      if (bustFactors.length === 0) continue; // Actually safe — no bust risk

      const bustRate = 1 - hitRate;
      const riskLevel: LockBuster["riskLevel"] =
        bustFactors.length >= 3
          ? "high"
          : bustFactors.length >= 2
            ? "medium"
            : "low";

      let verdict: string;
      if (riskLevel === "high") {
        verdict = `This "lock" has ${bustFactors.length} red flags. Consider fading or reducing stake.`;
      } else if (riskLevel === "medium") {
        verdict = `Looks safe but has risk factors. Worth noting before you lock it in.`;
      } else {
        verdict = `Probably still safe, but keep an eye on ${bustFactors[0]?.toLowerCase()}.`;
      }

      busters.push({
        player: playerName,
        stat: STAT_LABELS[check.stat] ?? check.stat,
        line,
        hitRate,
        bustRate,
        bustFactors,
        riskLevel,
        avgStat: avg,
        minStat: minVal,
        gamesUnder: values.length - overCount,
        totalGames: values.length,
        verdict,
      });
    }
  }

  // Sort by risk level (high first) then by bust factor count
  return busters.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.bustFactors.length - a.bustFactors.length;
  });
}
