import { ESPNPlayerGameLog } from "@/lib/stats-api";

// ============ TYPES ============

export interface InjuryRippleEffect {
  injuredPlayer: string;
  injuredPlayerStatus: string;
  teammates: {
    name: string;
    team: string;
    stat: string; // "points", "rebounds", "assists"
    withPlayer: number; // avg when injured player played
    withoutPlayer: number; // avg when injured player was out
    boost: number; // withoutPlayer - withPlayer
    gamesWithout: number; // sample size
  }[];
  summary: string; // "Without Edwards, Randle averages 24.2 PPG (up from 19.8)"
}

// ============ HELPERS ============

/** Normalize date string to YYYY-MM-DD for comparison */
function normalizeDate(dateStr: string): string {
  // Handle various formats: "2024-01-15", "Mon 1/15", "Jan 15, 2024", etc.
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}

/** Get the set of dates the injured player actually played */
function getPlayedDates(logs: ESPNPlayerGameLog[]): Set<string> {
  const dates = new Set<string>();
  for (const log of logs) {
    // Consider "played" if they logged meaningful minutes (> 5)
    if (log.minutes > 5) {
      dates.add(normalizeDate(log.date));
    }
  }
  return dates;
}

/** Calculate average of a stat from a set of game logs */
function avg(logs: ESPNPlayerGameLog[], stat: keyof ESPNPlayerGameLog): number {
  if (logs.length === 0) return 0;
  const sum = logs.reduce((total, g) => total + (Number(g[stat]) || 0), 0);
  return sum / logs.length;
}

/** Round to 1 decimal place */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ============ CORE ENGINE ============

/**
 * Analyze how a player's absence ripples through their teammates' stats.
 *
 * Compares each teammate's averages in games where the injured player
 * was active vs. games where the injured player did NOT play that day.
 * Returns teammates with meaningful stat boosts, sorted by impact.
 */
export function analyzeInjuryRipple(
  injuredPlayerName: string,
  injuredPlayerStatus: string,
  teammates: { name: string; team: string; logs: ESPNPlayerGameLog[] }[],
  injuredPlayerLogs: ESPNPlayerGameLog[]
): InjuryRippleEffect {
  const playedDates = getPlayedDates(injuredPlayerLogs);

  // For each teammate, split their games into with/without the injured player
  const allBoosts: InjuryRippleEffect["teammates"] = [];

  for (const teammate of teammates) {
    if (teammate.name === injuredPlayerName) continue;
    if (teammate.logs.length < 3) continue; // not enough data

    const gamesWith: ESPNPlayerGameLog[] = [];
    const gamesWithout: ESPNPlayerGameLog[] = [];

    for (const game of teammate.logs) {
      // Only consider games where the teammate actually played
      if (game.minutes <= 5) continue;

      const gameDate = normalizeDate(game.date);
      if (playedDates.has(gameDate)) {
        gamesWith.push(game);
      } else {
        gamesWithout.push(game);
      }
    }

    // Need at least 2 games without to have meaningful data
    if (gamesWithout.length < 2) continue;
    if (gamesWith.length < 2) continue;

    const stats: { stat: string; key: keyof ESPNPlayerGameLog; threshold: number }[] = [
      { stat: "points", key: "points", threshold: 2 },
      { stat: "rebounds", key: "rebounds", threshold: 1 },
      { stat: "assists", key: "assists", threshold: 1 },
    ];

    for (const { stat, key, threshold } of stats) {
      const withAvg = r1(avg(gamesWith, key));
      const withoutAvg = r1(avg(gamesWithout, key));
      const boost = r1(withoutAvg - withAvg);

      if (boost >= threshold) {
        allBoosts.push({
          name: teammate.name,
          team: teammate.team,
          stat,
          withPlayer: withAvg,
          withoutPlayer: withoutAvg,
          boost,
          gamesWithout: gamesWithout.length,
        });
      }
    }
  }

  // Sort by boost magnitude (points weighted more heavily)
  allBoosts.sort((a, b) => {
    const weightA = a.stat === "points" ? a.boost * 1.5 : a.boost;
    const weightB = b.stat === "points" ? b.boost * 1.5 : b.boost;
    return weightB - weightA;
  });

  // Generate summary from top beneficiary
  let summary = "";
  if (allBoosts.length > 0) {
    const top = allBoosts[0];
    const statLabel =
      top.stat === "points" ? "PPG" : top.stat === "rebounds" ? "RPG" : "APG";
    summary = `Without ${injuredPlayerName}, ${top.name} averages ${top.withoutPlayer} ${statLabel} (up from ${top.withPlayer})`;
    if (allBoosts.length > 1) {
      const second = allBoosts[1];
      const secondLabel =
        second.stat === "points"
          ? "PPG"
          : second.stat === "rebounds"
            ? "RPG"
            : "APG";
      summary += `. ${second.name} also sees a bump to ${second.withoutPlayer} ${secondLabel}.`;
    }
  }

  return {
    injuredPlayer: injuredPlayerName,
    injuredPlayerStatus,
    teammates: allBoosts,
    summary,
  };
}
