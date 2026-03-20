import { NextRequest, NextResponse } from "next/server";
import {
  getESPNGameData,
  getESPNPlayerGameLog,
  getESPNTodayGames,
  ESPNPlayerGameLog,
} from "@/lib/stats-api";
import { getTeamInfo } from "@/lib/team-map";
import {
  detectScoringStreaks,
  detectMatchupAngles,
  detectHomeAwayAngles,
  detectInjuryCascadeAngles,
  aggregateAngles,
  BettingAngle,
} from "@/lib/angles-engine";

export async function GET(req: NextRequest) {
  const homeTeam = req.nextUrl.searchParams.get("homeTeam") ?? "";
  const awayTeam = req.nextUrl.searchParams.get("awayTeam") ?? "";
  const sport = req.nextUrl.searchParams.get("sport") ?? "nba";

  if (!homeTeam || !awayTeam) {
    return NextResponse.json(
      { error: "homeTeam and awayTeam are required" },
      { status: 400 }
    );
  }

  try {
    // Find ESPN game ID
    const todayGames = await getESPNTodayGames(sport);
    const espnGame = todayGames.find(
      (g) =>
        g.homeTeam.name === homeTeam ||
        g.awayTeam.name === awayTeam ||
        homeTeam.includes(g.homeTeam.abbreviation) ||
        awayTeam.includes(g.awayTeam.abbreviation)
    );

    if (!espnGame) {
      return NextResponse.json({
        gameData: null,
        playerLogs: {},
        angles: [],
        error: "Could not find ESPN game match",
      });
    }

    // Get full game data
    const gameData = await getESPNGameData(sport, espnGame.espnGameId);

    if (!gameData) {
      return NextResponse.json({
        gameData: null,
        playerLogs: {},
        angles: [],
        error: "Could not fetch game data",
      });
    }

    // Get game logs for key players (starters from both teams)
    const allStarters = [
      ...gameData.homeTeam.players.filter((p) => p.starter),
      ...gameData.awayTeam.players.filter((p) => p.starter),
    ];

    // Limit to avoid too many API calls — get top 6 players
    const keyPlayers = allStarters.slice(0, 6);
    const playerLogs: Record<string, ESPNPlayerGameLog[]> = {};

    await Promise.all(
      keyPlayers.map(async (player) => {
        if (!player.id) return;
        const logs = await getESPNPlayerGameLog(player.id);
        if (logs.length > 0) {
          playerLogs[player.name] = logs;
        }
      })
    );

    // Generate betting angles
    const homeInfo = getTeamInfo(homeTeam);
    const awayInfo = getTeamInfo(awayTeam);

    const allAngles: BettingAngle[][] = [];

    // Player scoring streaks + matchup history
    for (const [name, logs] of Object.entries(playerLogs)) {
      allAngles.push(detectScoringStreaks(name, logs));

      // Detect matchup angles against the opponent
      const isHomePlr = gameData.homeTeam.players.some((p) => p.name === name);
      const opponentAbbr = isHomePlr
        ? awayInfo?.abbreviation ?? gameData.awayTeam.abbreviation
        : homeInfo?.abbreviation ?? gameData.homeTeam.abbreviation;
      allAngles.push(detectMatchupAngles(name, logs, opponentAbbr));
    }

    // Home/away angles
    allAngles.push(
      detectHomeAwayAngles(
        homeTeam,
        espnGame.homeTeam.record,
        ""
      )
    );
    allAngles.push(
      detectHomeAwayAngles(
        awayTeam,
        "",
        espnGame.awayTeam.record
      )
    );

    // Injury cascade angles
    allAngles.push(detectInjuryCascadeAngles(gameData));

    const angles = aggregateAngles(...allAngles);

    return NextResponse.json({
      gameData,
      playerLogs,
      angles,
      espnGameId: espnGame.espnGameId,
      homeRecord: espnGame.homeTeam.record,
      awayRecord: espnGame.awayTeam.record,
    });
  } catch (err) {
    console.error("Game research error:", err);
    return NextResponse.json(
      { error: "Failed to fetch game research data" },
      { status: 500 }
    );
  }
}
