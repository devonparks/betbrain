import { ESPNPlayerGameLog, ESPNGameData, ESPNPlayer } from "./stats-api";

export interface BettingAngle {
  type:
    | "scoring_streak"
    | "matchup_history"
    | "home_away"
    | "revenge"
    | "back_to_back"
    | "rest_advantage"
    | "injury_cascade"
    | "trend";
  title: string;
  description: string;
  confidence: "high" | "medium" | "low";
  relevantStat: string;
  suggestedBet?: string;
}

/**
 * Detect scoring streaks — "Player X has scored 30+ in 7 of last 10"
 */
export function detectScoringStreaks(
  playerName: string,
  gameLogs: ESPNPlayerGameLog[],
  thresholds: number[] = [20, 25, 30, 35]
): BettingAngle[] {
  const angles: BettingAngle[] = [];
  const last10 = gameLogs.slice(0, 10);
  if (last10.length < 5) return angles;

  for (const threshold of thresholds) {
    const gamesOver = last10.filter((g) => g.points >= threshold).length;
    const ratio = gamesOver / last10.length;

    if (ratio >= 0.7) {
      // Hit 70%+ of the time = strong trend
      const suggestedLine = threshold - 5; // Suggest a line 5 below the streak
      angles.push({
        type: "scoring_streak",
        title: `${playerName} ${threshold}+ pts in ${gamesOver}/${last10.length}`,
        description: `${playerName} has scored ${threshold}+ points in ${gamesOver} of the last ${last10.length} games. Average: ${(last10.reduce((s, g) => s + g.points, 0) / last10.length).toFixed(1)} PPG over that stretch.`,
        confidence: ratio >= 0.8 ? "high" : "medium",
        relevantStat: `${gamesOver}/${last10.length} games over ${threshold} pts`,
        suggestedBet: `Over ${suggestedLine}.5 points`,
      });
      break; // Only show the highest relevant threshold
    }
  }

  // Also check rebounds and assists streaks
  const avgReb =
    last10.reduce((s, g) => s + g.rebounds, 0) / last10.length;
  const avgAst =
    last10.reduce((s, g) => s + g.assists, 0) / last10.length;

  if (avgReb >= 8) {
    const over8 = last10.filter((g) => g.rebounds >= 8).length;
    if (over8 >= 7) {
      angles.push({
        type: "trend",
        title: `${playerName} averaging ${avgReb.toFixed(1)} RPG last 10`,
        description: `Hit 8+ rebounds in ${over8}/10 games. Consistent on the boards.`,
        confidence: "medium",
        relevantStat: `${avgReb.toFixed(1)} RPG last 10`,
        suggestedBet: `Over ${Math.floor(avgReb) - 1}.5 rebounds`,
      });
    }
  }

  if (avgAst >= 6) {
    const over6 = last10.filter((g) => g.assists >= 6).length;
    if (over6 >= 7) {
      angles.push({
        type: "trend",
        title: `${playerName} averaging ${avgAst.toFixed(1)} APG last 10`,
        description: `Hit 6+ assists in ${over6}/10 games. Consistently creating.`,
        confidence: "medium",
        relevantStat: `${avgAst.toFixed(1)} APG last 10`,
        suggestedBet: `Over ${Math.floor(avgAst) - 1}.5 assists`,
      });
    }
  }

  return angles;
}

/**
 * Detect player vs team matchup angles — "KD averages 32 PPG against CLE"
 */
export function detectMatchupAngles(
  playerName: string,
  gameLogs: ESPNPlayerGameLog[],
  opponentAbbr: string
): BettingAngle[] {
  const angles: BettingAngle[] = [];
  const vsOpponent = gameLogs.filter(
    (g) => g.opponent === opponentAbbr
  );

  if (vsOpponent.length < 2) return angles;

  const avgPts =
    vsOpponent.reduce((s, g) => s + g.points, 0) / vsOpponent.length;
  const avgReb =
    vsOpponent.reduce((s, g) => s + g.rebounds, 0) / vsOpponent.length;
  const avgAst =
    vsOpponent.reduce((s, g) => s + g.assists, 0) / vsOpponent.length;

  // Check if they tend to go off against this team
  const overallAvg =
    gameLogs.slice(0, 20).reduce((s, g) => s + g.points, 0) /
    Math.min(gameLogs.length, 20);

  if (avgPts > overallAvg * 1.15 && vsOpponent.length >= 2) {
    const allScored30 = vsOpponent.filter((g) => g.points >= 30).length;
    angles.push({
      type: "matchup_history",
      title: `${playerName} averages ${avgPts.toFixed(1)} PPG vs ${opponentAbbr}`,
      description: `In ${vsOpponent.length} games against ${opponentAbbr}, ${playerName} averages ${avgPts.toFixed(1)} pts, ${avgReb.toFixed(1)} reb, ${avgAst.toFixed(1)} ast. ${allScored30 > 0 ? `Scored 30+ in ${allScored30} of those games.` : ""} That's ${((avgPts / overallAvg - 1) * 100).toFixed(0)}% above their season average.`,
      confidence:
        vsOpponent.length >= 4 && avgPts > overallAvg * 1.2
          ? "high"
          : "medium",
      relevantStat: `${avgPts.toFixed(1)} PPG in ${vsOpponent.length} games vs ${opponentAbbr}`,
      suggestedBet: `Over ${Math.floor(avgPts) - 3}.5 points`,
    });
  }

  return angles;
}

/**
 * Detect home/away streaks — "Warriors haven't lost at home this season"
 */
export function detectHomeAwayAngles(
  teamName: string,
  homeRecord: string,
  awayRecord: string
): BettingAngle[] {
  const angles: BettingAngle[] = [];

  const parseRecord = (rec: string) => {
    const parts = rec.split("-").map(Number);
    return { wins: parts[0] || 0, losses: parts[1] || 0 };
  };

  if (homeRecord) {
    const home = parseRecord(homeRecord);
    const totalHome = home.wins + home.losses;
    if (totalHome >= 5) {
      const winPct = home.wins / totalHome;
      if (winPct >= 0.85) {
        angles.push({
          type: "home_away",
          title: `${teamName} is ${homeRecord} at home`,
          description: `${teamName} has been dominant at home with a ${homeRecord} record (${(winPct * 100).toFixed(0)}% win rate). ${home.losses === 0 ? "They haven't lost a home game yet this season." : `Only ${home.losses} home loss${home.losses > 1 ? "es" : ""} all season.`}`,
          confidence: winPct >= 0.9 ? "high" : "medium",
          relevantStat: `${homeRecord} home record`,
          suggestedBet: `${teamName} ML at home`,
        });
      }
      if (winPct <= 0.3) {
        angles.push({
          type: "home_away",
          title: `${teamName} is ${homeRecord} at home — fade them`,
          description: `${teamName} has struggled at home with a ${homeRecord} record. Home court isn't helping.`,
          confidence: "medium",
          relevantStat: `${homeRecord} home record`,
        });
      }
    }
  }

  if (awayRecord) {
    const away = parseRecord(awayRecord);
    const totalAway = away.wins + away.losses;
    if (totalAway >= 5) {
      const winPct = away.wins / totalAway;
      if (winPct <= 0.25) {
        angles.push({
          type: "home_away",
          title: `${teamName} is ${awayRecord} on the road — bad travelers`,
          description: `${teamName} only has ${away.wins} wins in ${totalAway} road games. They can't win away from home.`,
          confidence: "medium",
          relevantStat: `${awayRecord} away record`,
          suggestedBet: `Fade ${teamName} on the road`,
        });
      }
    }
  }

  return angles;
}

/**
 * Detect injury cascade angles — "With X out, Y's usage goes up"
 */
export function detectInjuryCascadeAngles(
  gameData: ESPNGameData
): BettingAngle[] {
  const angles: BettingAngle[] = [];

  for (const team of [gameData.homeTeam, gameData.awayTeam]) {
    const injuredStarters = team.players.filter(
      (p) => p.starter && p.injuries?.status
    );
    const outPlayers = team.injuries.filter(
      (i) =>
        i.status.toLowerCase().includes("out") ||
        i.status.toLowerCase().includes("doubtful")
    );

    if (outPlayers.length > 0) {
      for (const injured of outPlayers) {
        // Check if this is a key player (starter or significant)
        const isStarter = team.players.find(
          (p) =>
            p.name.includes(injured.player) ||
            injured.player.includes(p.name)
        )?.starter;

        if (isStarter) {
          // Find likely beneficiaries — other starters/key players at same position
          const activePlayers = team.players
            .filter(
              (p) =>
                !p.injuries?.status &&
                p.name !== injured.player
            )
            .slice(0, 3);

          const beneficiaries = activePlayers
            .map((p) => p.name)
            .join(", ");

          angles.push({
            type: "injury_cascade",
            title: `${injured.player} OUT — ${team.name} usage shift`,
            description: `${injured.player} (${injured.position}) is ${injured.status.toLowerCase()} for ${team.name}. ${injured.description ? `Reason: ${injured.description}.` : ""} With ${injured.player} out, expect increased usage/shots for remaining players${beneficiaries ? ` like ${beneficiaries}` : ""}. Check their prop lines — they may not have adjusted.`,
            confidence: "high",
            relevantStat: `${injured.player} (${injured.status})`,
            suggestedBet: beneficiaries
              ? `Look at overs for ${activePlayers[0]?.name}`
              : undefined,
          });
        }
      }
    }
  }

  return angles;
}

/**
 * Detect revenge game angles
 */
export function detectRevengeAngle(
  teamName: string,
  opponentName: string,
  recentResults: { winner: string; score: string; date: string }[]
): BettingAngle[] {
  const angles: BettingAngle[] = [];
  if (recentResults.length === 0) return angles;

  // Check if team lost the last meeting
  const lastGame = recentResults[0];
  if (lastGame && lastGame.winner !== teamName) {
    // Lost last meeting
    const lossesInRow = recentResults.filter(
      (r) => r.winner !== teamName
    ).length;

    if (lossesInRow >= 2) {
      angles.push({
        type: "revenge",
        title: `Revenge game: ${teamName} lost last ${lossesInRow} vs ${opponentName}`,
        description: `${teamName} has dropped ${lossesInRow} straight to ${opponentName}. Last result: ${lastGame.score} on ${lastGame.date}. Revenge spot — teams tend to show up in these.`,
        confidence: "low",
        relevantStat: `${lossesInRow} straight losses to ${opponentName}`,
        suggestedBet: `Watch for ${teamName} to cover`,
      });
    }
  }

  return angles;
}

/**
 * Aggregate all angles for a game
 */
export function aggregateAngles(...angleSets: BettingAngle[][]): BettingAngle[] {
  const all = angleSets.flat();
  // Sort: high confidence first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  return all.sort((a, b) => order[a.confidence] - order[b.confidence]);
}
