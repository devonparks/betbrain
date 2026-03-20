import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export interface ParlayLeg {
  pick: string;
  odds: string;
  type: string; // "spread" | "moneyline" | "total" | "player_prop"
}

export interface GradedLeg {
  pick: string;
  odds: string;
  grade: string; // A+ through F
  confidence: number;
  analysis: string;
  risk: string;
}

export interface ParlayGrade {
  legs: GradedLeg[];
  overallGrade: string;
  overallAnalysis: string;
  correlationWarnings: string[];
  suggestions: string[];
  estimatedHitRate: number;
  verdict: string;
}

export async function POST(req: NextRequest) {
  try {
    const { legs } = (await req.json()) as { legs: ParlayLeg[] };

    if (!legs || legs.length === 0) {
      return NextResponse.json({ error: "legs required" }, { status: 400 });
    }

    const prompt = `Grade this parlay. For each leg, assign a letter grade (A+ through F) based on how likely it is to hit and whether there's value. Then grade the overall parlay.

PARLAY LEGS:
${legs.map((l, i) => `${i + 1}. ${l.pick} (${l.odds}) [${l.type}]`).join("\n")}

Consider:
- Individual leg probability and value
- Correlation between legs (same-game legs, related outcomes)
- Overall parlay math — is the combined payout worth the risk?
- Hidden risks: back-to-backs, injuries, pace matchups, motivation
- Whether any legs are traps (look good on paper but have hidden problems)

Respond in valid JSON matching this format:
{
  "legs": [
    {
      "pick": "string",
      "odds": "string",
      "grade": "A+ to F",
      "confidence": 0-100,
      "analysis": "1-2 sentence analysis",
      "risk": "main risk factor"
    }
  ],
  "overallGrade": "A+ to F",
  "overallAnalysis": "2-3 sentence overall analysis",
  "correlationWarnings": ["any correlation risks between legs"],
  "suggestions": ["swap suggestions to improve the parlay"],
  "estimatedHitRate": 0-100,
  "verdict": "1 sentence final verdict — would you bet this?"
}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system:
        "You are BetBrain's parlay grading engine. Grade parlays honestly — most parlays are bad bets and you should say so. Be specific with stats and reasoning. Respond in valid JSON only, no markdown.",
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    try {
      const grade: ParlayGrade = JSON.parse(text);
      return NextResponse.json(grade);
    } catch {
      return NextResponse.json({
        legs: legs.map((l) => ({
          pick: l.pick,
          odds: l.odds,
          grade: "C",
          confidence: 50,
          analysis: "Could not fully analyze this leg.",
          risk: "Insufficient data",
        })),
        overallGrade: "C",
        overallAnalysis: text,
        correlationWarnings: [],
        suggestions: [],
        estimatedHitRate: 30,
        verdict: "Parlay needs more analysis.",
      });
    }
  } catch (err) {
    console.error("Grade error:", err);
    return NextResponse.json(
      { error: "Failed to grade parlay" },
      { status: 500 }
    );
  }
}
