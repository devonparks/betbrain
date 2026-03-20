import { BetRecommendation, SafeHailMaryParlay } from "./types";
import { calculateParlayOdds, calculatePayout, formatOdds } from "./utils";

/**
 * Build a Safe Hail Mary parlay from a pool of recommendations
 */
export function buildSafeHailMary(
  recommendations: BetRecommendation[]
): SafeHailMaryParlay | null {
  if (recommendations.length < 3) return null;

  // Sort by confidence
  const sorted = [...recommendations].sort(
    (a, b) => b.confidence - a.confidence
  );

  // Safe legs: highest confidence picks (75%+)
  const safeCandidates = sorted.filter((r) => r.confidence >= 75);
  // Hail mary: 30-45% confidence with positive edge
  const hailMaryCandidates = sorted.filter(
    (r) => r.confidence >= 30 && r.confidence <= 45 && r.edge > 3
  );

  if (safeCandidates.length < 2 || hailMaryCandidates.length < 1) {
    // Fallback: relax constraints
    const fallbackSafe = sorted.filter((r) => r.confidence >= 65);
    const fallbackHail = sorted.filter(
      (r) => r.confidence >= 25 && r.confidence <= 50
    );

    if (fallbackSafe.length < 2 || fallbackHail.length < 1) return null;

    return assembleSafeHailMary(
      fallbackSafe.slice(0, 3),
      fallbackHail[0]
    );
  }

  return assembleSafeHailMary(
    safeCandidates.slice(0, 3),
    hailMaryCandidates[0]
  );
}

function assembleSafeHailMary(
  safeLegs: BetRecommendation[],
  hailMary: BetRecommendation
): SafeHailMaryParlay {
  const allLegs = [...safeLegs.slice(0, 3), hailMary];
  const oddsArray = allLegs.map((l) => parseInt(l.bestOdds));
  const combinedOdds = calculateParlayOdds(oddsArray);
  const wager = 10;
  const payout = calculatePayout(wager, combinedOdds);

  return {
    safeLeg1: safeLegs[0],
    safeLeg2: safeLegs[1],
    safeLeg3: safeLegs[2],
    hailMaryLeg: hailMary,
    combinedOdds: formatOdds(combinedOdds),
    reasoning: `This parlay anchors on ${safeLegs.length} high-confidence picks (${safeLegs.map((l) => `${l.pick} at ${l.confidence}%`).join(", ")}), then adds ${hailMary.pick} as a calculated long shot. The hail mary leg has a ${hailMary.confidence}% chance but ${hailMary.edge.toFixed(1)}% edge over the implied odds.`,
    examplePayout: { wager, payout },
  };
}

/**
 * Calculate combined parlay info for user-built parlays
 */
export function calculateParlay(legs: BetRecommendation[]): {
  combinedOdds: string;
  impliedProbability: number;
  payout: { wager: number; payout: number };
} {
  const oddsArray = legs.map((l) => parseInt(l.bestOdds));
  const combinedOdds = calculateParlayOdds(oddsArray);
  const impliedProb = legs.reduce(
    (acc, l) => acc * l.impliedProbability,
    1
  );

  return {
    combinedOdds: formatOdds(combinedOdds),
    impliedProbability: impliedProb,
    payout: { wager: 10, payout: calculatePayout(10, combinedOdds) },
  };
}

/**
 * Get AI feedback on a user's parlay (returns prompt for Claude)
 */
export function buildParlayFeedbackPrompt(
  legs: BetRecommendation[]
): string {
  return `Analyze this parlay the user is building:

${legs
  .map(
    (l, i) =>
      `Leg ${i + 1}: ${l.pick} (${l.bestOdds} at ${l.bestBook}) — ${l.confidence}% confidence, ${l.edge.toFixed(1)}% edge`
  )
  .join("\n")}

Combined odds: ${formatOdds(calculateParlayOdds(legs.map((l) => parseInt(l.bestOdds))))}

Provide:
1. Quick take on each leg (good pick? any concerns?)
2. Are any legs correlated? (If so, is that good or bad here?)
3. Overall assessment — would you make this parlay?
4. Any suggested swaps to improve it?

Keep it conversational and specific.`;
}
