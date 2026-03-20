import { OddsResponse } from "./types";
import {
  americanToImpliedProbability,
  extractBestOdds,
  findOddsDiscrepancies,
} from "./utils";

export interface ValueBet {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  outcome: string;
  bestBook: string;
  bestOdds: number;
  impliedProbability: number;
  consensusImpliedProbability: number;
  edge: number; // percentage points
  isStale: boolean; // odds haven't moved after news
}

/**
 * Scan all games for value bets based on cross-book odds discrepancies
 */
export function detectValueBets(games: OddsResponse[]): ValueBet[] {
  const valueBets: ValueBet[] = [];

  for (const game of games) {
    for (const market of ["h2h", "spreads", "totals"]) {
      const discrepancies = findOddsDiscrepancies(game, market);

      for (const disc of discrepancies) {
        if (disc.spread >= 3) {
          valueBets.push({
            gameId: game.id,
            homeTeam: game.home_team,
            awayTeam: game.away_team,
            market,
            outcome: disc.outcome,
            bestBook: disc.highBook,
            bestOdds: disc.highOdds,
            impliedProbability: americanToImpliedProbability(disc.highOdds),
            consensusImpliedProbability: americanToImpliedProbability(disc.lowOdds),
            edge: disc.spread,
            isStale: false,
          });
        }
      }
    }
  }

  return valueBets.sort((a, b) => b.edge - a.edge);
}

/**
 * Compare AI's estimated probability against book odds to find value
 */
export function findAIValueBets(
  gameId: string,
  homeTeam: string,
  awayTeam: string,
  game: OddsResponse,
  aiEstimates: {
    homeWinProb: number;
    awayWinProb: number;
    overProb?: number;
    underProb?: number;
  }
): ValueBet[] {
  const valueBets: ValueBet[] = [];
  const best = extractBestOdds(game);

  // Check moneyline value
  const homeImplied = americanToImpliedProbability(best.moneyline.home.odds);
  const awayImplied = americanToImpliedProbability(best.moneyline.away.odds);

  const homeEdge = (aiEstimates.homeWinProb - homeImplied) * 100;
  if (homeEdge > 5) {
    valueBets.push({
      gameId,
      homeTeam,
      awayTeam,
      market: "h2h",
      outcome: homeTeam,
      bestBook: best.moneyline.home.book,
      bestOdds: best.moneyline.home.odds,
      impliedProbability: homeImplied,
      consensusImpliedProbability: homeImplied,
      edge: Math.round(homeEdge * 10) / 10,
      isStale: false,
    });
  }

  const awayEdge = (aiEstimates.awayWinProb - awayImplied) * 100;
  if (awayEdge > 5) {
    valueBets.push({
      gameId,
      homeTeam,
      awayTeam,
      market: "h2h",
      outcome: awayTeam,
      bestBook: best.moneyline.away.book,
      bestOdds: best.moneyline.away.odds,
      impliedProbability: awayImplied,
      consensusImpliedProbability: awayImplied,
      edge: Math.round(awayEdge * 10) / 10,
      isStale: false,
    });
  }

  return valueBets;
}

/**
 * Detect stale lines — odds that haven't moved after news
 * Call this after a lineup change is detected
 */
export function detectStaleLines(
  preNewsOdds: OddsResponse,
  postNewsOdds: OddsResponse,
  significantChange: boolean // Was the news significant (star player out, etc.)
): {
  book: string;
  market: string;
  oldOdds: number;
  currentOdds: number;
  isStale: boolean;
}[] {
  if (!significantChange) return [];

  const staleLines: {
    book: string;
    market: string;
    oldOdds: number;
    currentOdds: number;
    isStale: boolean;
  }[] = [];

  for (const postBook of postNewsOdds.bookmakers) {
    const preBook = preNewsOdds.bookmakers.find(
      (b) => b.key === postBook.key
    );
    if (!preBook) continue;

    for (const postMarket of postBook.markets) {
      const preMarket = preBook.markets.find((m) => m.key === postMarket.key);
      if (!preMarket) continue;

      for (const postOutcome of postMarket.outcomes) {
        const preOutcome = preMarket.outcomes.find(
          (o) => o.name === postOutcome.name
        );
        if (!preOutcome) continue;

        const movement = Math.abs(postOutcome.price - preOutcome.price);
        // If a significant news event happened but the line barely moved, it's stale
        if (movement < 10) {
          staleLines.push({
            book: postBook.title,
            market: postMarket.key,
            oldOdds: preOutcome.price,
            currentOdds: postOutcome.price,
            isStale: true,
          });
        }
      }
    }
  }

  return staleLines;
}

/**
 * Track line movement over time
 */
export function analyzeLineMovement(
  snapshots: { timestamp: Date; odds: number }[]
): {
  totalMovement: number;
  direction: "up" | "down" | "stable";
  significantMoves: { timestamp: Date; from: number; to: number }[];
} {
  if (snapshots.length < 2) {
    return { totalMovement: 0, direction: "stable", significantMoves: [] };
  }

  const sorted = [...snapshots].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  const first = sorted[0].odds;
  const last = sorted[sorted.length - 1].odds;
  const totalMovement = last - first;

  const significantMoves: { timestamp: Date; from: number; to: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const move = Math.abs(sorted[i].odds - sorted[i - 1].odds);
    if (move >= 20) {
      significantMoves.push({
        timestamp: sorted[i].timestamp,
        from: sorted[i - 1].odds,
        to: sorted[i].odds,
      });
    }
  }

  return {
    totalMovement,
    direction:
      totalMovement > 10 ? "up" : totalMovement < -10 ? "down" : "stable",
    significantMoves,
  };
}
