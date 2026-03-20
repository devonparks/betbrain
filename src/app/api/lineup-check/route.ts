import { NextRequest, NextResponse } from "next/server";
import { checkLineupChanges } from "@/lib/lineup-monitor";

export async function GET(req: NextRequest) {
  const sport = req.nextUrl.searchParams.get("sport") ?? "nba";
  const gameId = req.nextUrl.searchParams.get("gameId");
  const homeTeamId = req.nextUrl.searchParams.get("homeTeamId");
  const awayTeamId = req.nextUrl.searchParams.get("awayTeamId");

  if (!gameId || !homeTeamId || !awayTeamId) {
    return NextResponse.json(
      { error: "gameId, homeTeamId, and awayTeamId are required" },
      { status: 400 }
    );
  }

  try {
    const alerts = await checkLineupChanges(sport, gameId, homeTeamId, awayTeamId);
    return NextResponse.json(alerts);
  } catch (err) {
    console.error("Lineup check error:", err);
    return NextResponse.json(
      { error: "Failed to check lineups" },
      { status: 500 }
    );
  }
}
