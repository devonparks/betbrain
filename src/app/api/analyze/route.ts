import { NextRequest, NextResponse } from "next/server";
import { analyzeGame } from "@/lib/claude";
import { getOdds } from "@/lib/odds-api";

import { OddsResponse } from "@/lib/types";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gameId, sport, forceRefresh } = body;

    if (!gameId || !sport) {
      return NextResponse.json(
        { error: "gameId and sport are required" },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `${sport}_${gameId}_${today}`;

    // Check cache unless force refresh
    if (!forceRefresh) {
      try {
        const cached = await getDoc(doc(db, "analyses", cacheKey));
        if (cached.exists()) {
          const data = cached.data();
          const updatedAt = data.updatedAt?.toDate?.() ?? new Date(data.updatedAt);
          const ageMinutes = (Date.now() - updatedAt.getTime()) / 1000 / 60;
          if (ageMinutes < 30) {
            return NextResponse.json(data.aiAnalysis);
          }
        }
      } catch {
        // Cache miss — proceed with fresh analysis
      }
    }

    // Fetch fresh odds for this game
    const allOdds = await getOdds(sport);
    const gameOdds = allOdds.find((g: OddsResponse) => g.id === gameId);
    if (!gameOdds) {
      return NextResponse.json(
        { error: "Game not found in odds data" },
        { status: 404 }
      );
    }

    // Get injuries (best effort)
    const injuries = { home: [] as never[], away: [] as never[] };
    try {
      // ESPN team IDs would need mapping — using empty for now
      // In production, maintain a team name → ESPN ID mapping
    } catch {
      // Continue without injuries
    }

    // Build stats context
    const statsContext = `Game: ${gameOdds.away_team} @ ${gameOdds.home_team}\nTime: ${gameOdds.commence_time}`;

    const analysis = await analyzeGame(gameOdds, injuries, statsContext);

    // Cache the analysis
    try {
      await setDoc(doc(db, "analyses", cacheKey), {
        gameData: {
          id: gameOdds.id,
          homeTeam: gameOdds.home_team,
          awayTeam: gameOdds.away_team,
          commenceTime: gameOdds.commence_time,
        },
        aiAnalysis: analysis,
        createdAt: new Date(),
        updatedAt: new Date(),
        result: "pending",
      });
    } catch {
      // Cache write failed — analysis still returned
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("Analysis error:", err);
    return NextResponse.json(
      { error: "Failed to generate analysis" },
      { status: 500 }
    );
  }
}
