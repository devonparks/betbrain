import { NextRequest, NextResponse } from "next/server";
import { getOdds, getScores } from "@/lib/odds-api";
import { SportKey, SPORTS } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sport = req.nextUrl.searchParams.get("sport") as SportKey | null;
  const scores = req.nextUrl.searchParams.get("scores") === "true";
  const markets = req.nextUrl.searchParams.get("markets")?.split(",") ?? [
    "h2h",
    "spreads",
    "totals",
  ];
  const bookmakers = req.nextUrl.searchParams.get("bookmakers")?.split(",");

  if (!sport || !(sport in SPORTS)) {
    return NextResponse.json(
      { error: "Invalid or missing sport parameter" },
      { status: 400 }
    );
  }

  try {
    if (scores) {
      const data = await getScores(sport);
      return NextResponse.json(data);
    }
    const data = await getOdds(sport, markets, bookmakers ?? undefined);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Odds API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch odds" },
      { status: 500 }
    );
  }
}
