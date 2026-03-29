import { ESPNPlayerGameLog } from "./stats-api";
import { americanToImpliedProbability } from "./utils";

// ============ TYPES ============

export interface OUPrediction {
  player: string;
  team: string;
  stat: "points" | "rebounds" | "assists" | "threes";
  line: number;
  prediction: "OVER" | "UNDER";
  confidence: number; // 0-100
  reasoning: string;
  last10: number[];
  overCount: number;
  underCount: number;
  trendDirection: "up" | "down" | "stable";
  recentAvg: number; // last 3 games avg
  fullAvg: number; // last 10 games avg
  homeAwaySplit: { home: number; away: number };
  overOdds: number;
  underOdds: number;
  book: string;
  injuryContext: string | null;
  blowoutRisk: boolean;
  gameId?: string;
}

export interface PredictionInput {
  player: string;
  team: string;
  stat: "points" | "rebounds" | "assists" | "threes";
  line: number;
  overOdds: number;
  underOdds: number;
  book: string;
  gameLogs: ESPNPlayerGameLog[];
  isHome: boolean;
  opponentDefRank?: number; // 1-30 (1=best defense)
  spread?: number; // negative = favorite
  injuryContext?: string;
  gameId?: string;
}

// ============ CORE PREDICTION LOGIC ============

const STAT_KEYS: Record<string, keyof ESPNPlayerGameLog> = {
  points: "points",
  rebounds: "rebounds",
  assists: "assists",
  threes: "fg3m",
};

export function predictOU(input: PredictionInput): OUPrediction {
  const { player, team, stat, line, overOdds, underOdds, book, gameLogs, isHome, opponentDefRank, spread, injuryContext, gameId } = input;
  const statKey = STAT_KEYS[stat];

  // Extract stat values from game logs (most recent first)
  const last10 = gameLogs
    .slice(0, 10)
    .map((g) => g[statKey] as number);

  const last3 = last10.slice(0, 3);
  // Basic counts
  const overCount = last10.filter((v) => v > line).length;
  const underCount = last10.filter((v) => v <= line).length;

  // Averages
  const fullAvg = last10.length > 0 ? last10.reduce((s, v) => s + v, 0) / last10.length : 0;
  const recentAvg = last3.length > 0 ? last3.reduce((s, v) => s + v, 0) / last3.length : 0;

  // Trend detection
  const trendDirection = detectTrend(last10);

  // Home/away split
  const homeAwaySplit = calculateHomeAwaySplit(gameLogs, statKey);

  // Blowout risk detection
  const blowoutRisk = Math.abs(spread ?? 0) >= 15;

  // ============ SCORING SYSTEM ============
  // Each factor contributes to a raw score, then we normalize to confidence

  let rawScore = 0; // positive = OVER lean, negative = UNDER lean
  let totalWeight = 0;
  const reasons: string[] = [];

  // Factor 1: Hit rate in last 10 (weight: 30)
  const hitRateWeight = 30;
  totalWeight += hitRateWeight;
  if (last10.length > 0) {
    const hitRate = overCount / last10.length;
    rawScore += (hitRate - 0.5) * 2 * hitRateWeight; // -30 to +30
    if (overCount >= 7) {
      reasons.push(`${overCount}/${last10.length} games went over in last 10`);
    } else if (underCount >= 7) {
      reasons.push(`Only ${overCount}/${last10.length} went over in last 10`);
    }
  }

  // Factor 2: Average vs line (weight: 25)
  const avgWeight = 25;
  totalWeight += avgWeight;
  if (fullAvg > 0) {
    const avgDiff = (fullAvg - line) / Math.max(line, 1);
    rawScore += Math.max(-1, Math.min(1, avgDiff * 3)) * avgWeight;
    if (Math.abs(fullAvg - line) > 2) {
      reasons.push(`Averaging ${fullAvg.toFixed(1)} vs line of ${line}`);
    }
  }

  // Factor 3: Recent trend (weight: 20) — last 3 weighted heavier
  const trendWeight = 20;
  totalWeight += trendWeight;
  if (recentAvg > 0) {
    const trendDiff = (recentAvg - line) / Math.max(line, 1);
    rawScore += Math.max(-1, Math.min(1, trendDiff * 3)) * trendWeight;
    if (Math.abs(recentAvg - fullAvg) > 3) {
      const trendDir = recentAvg > fullAvg ? "up" : "down";
      reasons.push(
        `Trending ${trendDir}: ${recentAvg.toFixed(1)} avg last 3 vs ${fullAvg.toFixed(1)} overall`
      );
    }
  }

  // Factor 4: Home/away adjustment (weight: 10)
  const haWeight = 10;
  totalWeight += haWeight;
  const relevantSplit = isHome ? homeAwaySplit.home : homeAwaySplit.away;
  if (relevantSplit > 0) {
    const splitDiff = (relevantSplit - line) / Math.max(line, 1);
    rawScore += Math.max(-1, Math.min(1, splitDiff * 2)) * haWeight;
    if (Math.abs(homeAwaySplit.home - homeAwaySplit.away) > 3) {
      reasons.push(
        `${isHome ? "Home" : "Away"} split: ${relevantSplit.toFixed(1)} (H: ${homeAwaySplit.home.toFixed(1)}, A: ${homeAwaySplit.away.toFixed(1)})`
      );
    }
  }

  // Factor 5: Opponent defense (weight: 10)
  const defWeight = 10;
  totalWeight += defWeight;
  if (opponentDefRank) {
    // Top 5 defense = harder to go over, bottom 5 = easier
    const defFactor = (15.5 - opponentDefRank) / 15.5; // positive = bad defense (easier over)
    rawScore += defFactor * defWeight;
    if (opponentDefRank <= 5) {
      reasons.push(`Facing a top ${opponentDefRank} defense`);
    } else if (opponentDefRank >= 26) {
      reasons.push(`Facing a bottom ${31 - opponentDefRank} defense`);
    }
  }

  // Factor 6: Blowout risk (weight: 5) — only affects star players
  if (blowoutRisk && stat === "points" && fullAvg > 20) {
    const blowoutWeight = 5;
    totalWeight += blowoutWeight;
    rawScore -= blowoutWeight * 0.6; // Lean under for star props in blowouts
    reasons.push(`Blowout risk: ${Math.abs(spread!).toFixed(0)} pt spread — star may sit in 4th`);
  }

  // Factor 7: Injury context boost
  if (injuryContext) {
    reasons.push(injuryContext);
    // Injury context adds 5% confidence in whatever direction we're leaning
    rawScore += Math.sign(rawScore) * 3;
  }

  // Factor 8: Odds value detection
  const impliedOver = americanToImpliedProbability(overOdds);
  const impliedUnder = americanToImpliedProbability(underOdds);

  // ============ DETERMINE PREDICTION ============

  const prediction: "OVER" | "UNDER" = rawScore >= 0 ? "OVER" : "UNDER";

  // Normalize raw score to confidence (0-100)
  // |rawScore| / totalWeight gives us 0-1, then scale to 35-95 range
  const normalizedScore = Math.abs(rawScore) / totalWeight;
  let confidence = Math.round(35 + normalizedScore * 60);
  confidence = Math.max(35, Math.min(95, confidence));

  // Boost confidence if odds agree with our prediction
  const ourImplied = prediction === "OVER" ? impliedOver : impliedUnder;
  if (ourImplied > 0.55) {
    confidence = Math.min(95, confidence + 3);
  }

  // Reduce confidence if we have few games
  if (last10.length < 5) {
    confidence = Math.min(55, confidence);
    reasons.push(`Limited data: only ${last10.length} games available`);
  }

  // Build reasoning string
  const reasoning = reasons.length > 0
    ? reasons.slice(0, 3).join(". ") + "."
    : `${prediction} ${line} ${stat} based on recent performance.`;

  return {
    player,
    team,
    stat,
    line,
    prediction,
    confidence,
    reasoning,
    last10,
    overCount,
    underCount,
    trendDirection,
    recentAvg,
    fullAvg,
    homeAwaySplit,
    overOdds,
    underOdds,
    book,
    injuryContext: injuryContext ?? null,
    blowoutRisk,
    gameId,
  };
}

// ============ BATCH PREDICTIONS ============

export function predictAllProps(inputs: PredictionInput[]): OUPrediction[] {
  return inputs
    .map(predictOU)
    .sort((a, b) => b.confidence - a.confidence);
}

// ============ SAFE HAIL MARY BUILDER (PREDICTION-BASED) ============

export interface PredictionParlay {
  legs: OUPrediction[];
  combinedOdds: number;
  payout: { wager: number; payout: number };
  strategy: string;
}

export function buildPredictionHailMary(
  predictions: OUPrediction[],
  blacklist: string[] = []
): PredictionParlay | null {
  // Filter out blacklisted players
  const eligible = predictions.filter(
    (p) => !blacklist.includes(p.player)
  );

  if (eligible.length < 4) return null;

  // Safe legs: confidence 75+ with favorable odds (-400 to -700 range)
  const safeLegs = eligible
    .filter((p) => {
      const odds = p.prediction === "OVER" ? p.overOdds : p.underOdds;
      return p.confidence >= 70 && odds >= -700 && odds <= -150;
    })
    .slice(0, 3);

  // Hail mary legs: confidence 50-65 with plus odds or slight favorite
  const hailMaryLegs = eligible
    .filter((p) => {
      const odds = p.prediction === "OVER" ? p.overOdds : p.underOdds;
      return p.confidence >= 45 && p.confidence <= 65 && odds >= -200;
    })
    .filter((p) => !safeLegs.includes(p))
    .slice(0, 2);

  const allLegs = [...safeLegs, ...hailMaryLegs];
  if (allLegs.length < 3) return null;

  // Calculate combined odds
  const oddsArray = allLegs.map((p) =>
    p.prediction === "OVER" ? p.overOdds : p.underOdds
  );
  const decimalProduct = oddsArray.reduce((acc, odds) => {
    const decimal = odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
    return acc * decimal;
  }, 1);
  const combinedAmerican = decimalProduct >= 2
    ? Math.round((decimalProduct - 1) * 100)
    : Math.round(-100 / (decimalProduct - 1));

  const wager = 5;
  const payout = Math.round(wager * decimalProduct * 100) / 100;

  return {
    legs: allLegs,
    combinedOdds: combinedAmerican,
    payout: { wager, payout },
    strategy: `${safeLegs.length} floor picks (${safeLegs.map((l) => `${l.player} ${l.prediction} ${l.line} ${l.stat}`).join(", ")}) + ${hailMaryLegs.length} calculated shot${hailMaryLegs.length !== 1 ? "s" : ""} for a ${combinedAmerican > 0 ? "+" : ""}${combinedAmerican} parlay.`,
  };
}

// ============ O/U MEGA PARLAY BUILDER ============

export function buildOUMegaParlay(
  predictions: OUPrediction[],
  targetLegs: number = 15,
  blacklist: string[] = []
): PredictionParlay | null {
  const eligible = predictions
    .filter((p) => !blacklist.includes(p.player))
    .filter((p) => p.confidence >= 55);

  if (eligible.length < 5) return null;

  // Take the top N by confidence, mixing overs and unders
  const overs = eligible.filter((p) => p.prediction === "OVER");
  const unders = eligible.filter((p) => p.prediction === "UNDER");

  // Aim for 60% overs, 40% unders (overs tend to be more reliable for floors)
  const overTarget = Math.ceil(targetLegs * 0.6);
  const underTarget = targetLegs - overTarget;

  const selectedOvers = overs.slice(0, overTarget);
  const selectedUnders = unders.slice(0, underTarget);
  let allLegs = [...selectedOvers, ...selectedUnders];

  // If we don't have enough of one type, fill with the other
  if (allLegs.length < targetLegs) {
    const remaining = eligible
      .filter((p) => !allLegs.includes(p))
      .slice(0, targetLegs - allLegs.length);
    allLegs = [...allLegs, ...remaining];
  }

  allLegs = allLegs.slice(0, targetLegs);
  if (allLegs.length < 5) return null;

  const oddsArray = allLegs.map((p) =>
    p.prediction === "OVER" ? p.overOdds : p.underOdds
  );
  const decimalProduct = oddsArray.reduce((acc, odds) => {
    const decimal = odds < 0 ? 1 + 100 / Math.abs(odds) : 1 + odds / 100;
    return acc * decimal;
  }, 1);
  const combinedAmerican = decimalProduct >= 2
    ? Math.round((decimalProduct - 1) * 100)
    : Math.round(-100 / (decimalProduct - 1));

  const wager = 1;
  const payout = Math.round(wager * decimalProduct * 100) / 100;

  return {
    legs: allLegs,
    combinedOdds: combinedAmerican,
    payout: { wager, payout },
    strategy: `${allLegs.length}-leg O/U parlay: ${selectedOvers.length} overs + ${selectedUnders.length} unders. $${wager} to win $${payout.toLocaleString()}.`,
  };
}

// ============ HELPER FUNCTIONS ============

function detectTrend(values: number[]): "up" | "down" | "stable" {
  if (values.length < 3) return "stable";
  const recent3 = values.slice(0, 3);
  const older = values.slice(3);
  if (older.length === 0) return "stable";

  const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length;
  const olderAvg = older.reduce((s, v) => s + v, 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > 2) return "up";
  if (diff < -2) return "down";
  return "stable";
}

function calculateHomeAwaySplit(
  gameLogs: ESPNPlayerGameLog[],
  statKey: keyof ESPNPlayerGameLog
): { home: number; away: number } {
  // ESPN game logs have result like "W 123-110" but don't directly indicate home/away
  // We approximate using the result string — if it starts with opponent abbrev it was away
  // For now, use odd/even index as a rough split (we'll improve with real data)
  const all = gameLogs.slice(0, 20).map((g) => g[statKey] as number);
  if (all.length === 0) return { home: 0, away: 0 };

  // Simple split: average of all (we'll get real home/away from ESPN later)
  const avg = all.reduce((s, v) => s + v, 0) / all.length;
  // Home boost is typically 5-8% for NBA points
  return {
    home: avg * 1.04,
    away: avg * 0.96,
  };
}
