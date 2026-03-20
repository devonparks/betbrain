import { NextRequest, NextResponse } from "next/server";
import { getPlayerProps } from "@/lib/odds-api";
import { SportKey, SPORTS } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sport = req.nextUrl.searchParams.get("sport") as SportKey | null;
  const gameId = req.nextUrl.searchParams.get("gameId");

  if (!sport || !(sport in SPORTS) || !gameId) {
    return NextResponse.json(
      { error: "sport and gameId are required" },
      { status: 400 }
    );
  }

  try {
    const data = await getPlayerProps(sport, gameId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Player props error:", err);
    return NextResponse.json(
      { error: "Failed to fetch player props" },
      { status: 500 }
    );
  }
}
