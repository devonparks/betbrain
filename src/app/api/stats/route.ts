import { NextRequest, NextResponse } from "next/server";
import {
  searchPlayers,
  getPlayerGameLogs,
  getPlayerAverages,
  getHeadToHead,
  getRecentForm,
  getTeamInjuries,
  getESPNScoreboard,
} from "@/lib/stats-api";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");

  try {
    switch (type) {
      case "search-players": {
        const query = req.nextUrl.searchParams.get("q") ?? "";
        const data = await searchPlayers(query);
        return NextResponse.json(data);
      }
      case "player-logs": {
        const playerId = parseInt(req.nextUrl.searchParams.get("id") ?? "0");
        const lastN = parseInt(req.nextUrl.searchParams.get("lastN") ?? "10");
        const data = await getPlayerGameLogs(playerId, lastN);
        return NextResponse.json(data);
      }
      case "player-averages": {
        const playerId = parseInt(req.nextUrl.searchParams.get("id") ?? "0");
        const data = await getPlayerAverages(playerId);
        return NextResponse.json(data);
      }
      case "head-to-head": {
        const team1 = parseInt(req.nextUrl.searchParams.get("team1") ?? "0");
        const team2 = parseInt(req.nextUrl.searchParams.get("team2") ?? "0");
        const lastN = parseInt(req.nextUrl.searchParams.get("lastN") ?? "10");
        const data = await getHeadToHead(team1, team2, lastN);
        return NextResponse.json(data);
      }
      case "recent-form": {
        const teamId = parseInt(req.nextUrl.searchParams.get("teamId") ?? "0");
        const lastN = parseInt(req.nextUrl.searchParams.get("lastN") ?? "10");
        const data = await getRecentForm(teamId, lastN);
        return NextResponse.json(data);
      }
      case "injuries": {
        const sport = req.nextUrl.searchParams.get("sport") ?? "nba";
        const teamId = req.nextUrl.searchParams.get("teamId") ?? "";
        const data = await getTeamInjuries(sport, teamId);
        return NextResponse.json(data);
      }
      case "scoreboard": {
        const sport = req.nextUrl.searchParams.get("sport") ?? "nba";
        const data = await getESPNScoreboard(sport);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json(
          { error: "Invalid type parameter" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("Stats API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
