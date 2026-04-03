import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  // 1. Fetch predictions from our engine
  const baseUrl = new URL(req.url).origin;
  const predRes = await fetch(`${baseUrl}/api/predict-ou?sport=nba`);
  const predData = await predRes.json();

  if (!predData.predictions?.length) {
    return NextResponse.json({ error: "No predictions available" }, { status: 404 });
  }

  // 2. Pick the highest confidence prediction
  const best = predData.predictions[0]; // already sorted by confidence

  // 3. Generate analysis with Claude
  const analysis = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Generate a 2-3 sentence analysis for this betting pick: ${best.player} ${best.prediction} ${best.line} ${best.stat} (${best.confidence}% confidence). Recent avg: ${best.fullAvg?.toFixed(1)}. Last 5: [${best.last10?.slice(0, 5).join(', ')}]. ${best.reasoning}. Be specific and cite numbers.`
    }]
  });

  const fullAnalysis = analysis.content[0].type === 'text' ? analysis.content[0].text : '';

  // 4. Build the daily pick object
  const pick = {
    date: new Date().toISOString().split('T')[0],
    pick: {
      type: "player_prop" as const,
      pick: `${best.player} ${best.prediction} ${best.line} ${best.stat}`,
      bestBook: best.book ?? "Synthetic",
      bestOdds: best.prediction === "OVER" ? String(best.overOdds) : String(best.underOdds),
      confidence: best.confidence,
      reasoning: best.reasoning,
      impliedProbability: 0,
      estimatedTrueProbability: best.confidence / 100,
      edge: 0,
    },
    fullAnalysis,
    historicalAccuracy: {
      allTime: { wins: 0, losses: 0, pushes: 0, winRate: 0 },
      last30Days: { wins: 0, losses: 0, pushes: 0, winRate: 0 },
      last7Days: { wins: 0, losses: 0, pushes: 0, winRate: 0 },
    },
  };

  // 5. Try to store in Firestore (silent fail if not configured)
  try {
    const { db } = await import("@/lib/firebase");
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(db, "dailyPicks", pick.date), pick);
  } catch {
    // Firestore not available, that's fine
  }

  return NextResponse.json(pick);
}
