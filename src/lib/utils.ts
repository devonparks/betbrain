import { BestOdds, OddsResponse } from "./types";

/**
 * Convert American odds to implied probability
 */
export function americanToImpliedProbability(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
  return 100 / (odds + 100);
}

/**
 * Convert American odds to decimal odds
 */
export function americanToDecimal(odds: number): number {
  if (odds < 0) {
    return 1 + 100 / Math.abs(odds);
  }
  return 1 + odds / 100;
}

/**
 * Calculate parlay odds from array of American odds
 */
export function calculateParlayOdds(legs: number[]): number {
  const decimalProduct = legs.reduce(
    (acc, odds) => acc * americanToDecimal(odds),
    1
  );
  // Convert back to American
  if (decimalProduct >= 2) {
    return Math.round((decimalProduct - 1) * 100);
  }
  return Math.round(-100 / (decimalProduct - 1));
}

/**
 * Calculate payout for a given stake and American odds
 */
export function calculatePayout(stake: number, americanOdds: number): number {
  const decimal = americanToDecimal(americanOdds);
  return Math.round(stake * decimal * 100) / 100;
}

/**
 * Format American odds with + or - prefix
 */
export function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/**
 * Extract best odds across all bookmakers for a game
 */
export function extractBestOdds(game: OddsResponse): BestOdds {
  const best: BestOdds = {
    moneyline: {
      home: { odds: -Infinity, book: "" },
      away: { odds: -Infinity, book: "" },
    },
    spread: {
      home: { odds: -Infinity, point: 0, book: "" },
      away: { odds: -Infinity, point: 0, book: "" },
    },
    total: {
      over: { odds: -Infinity, point: 0, book: "" },
      under: { odds: -Infinity, point: 0, book: "" },
    },
  };

  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      if (market.key === "h2h") {
        for (const outcome of market.outcomes) {
          if (outcome.name === game.home_team) {
            if (outcome.price > best.moneyline.home.odds) {
              best.moneyline.home = { odds: outcome.price, book: bookmaker.title };
            }
          } else {
            if (outcome.price > best.moneyline.away.odds) {
              best.moneyline.away = { odds: outcome.price, book: bookmaker.title };
            }
          }
        }
      } else if (market.key === "spreads") {
        for (const outcome of market.outcomes) {
          if (outcome.name === game.home_team) {
            if (outcome.price > best.spread.home.odds) {
              best.spread.home = {
                odds: outcome.price,
                point: outcome.point ?? 0,
                book: bookmaker.title,
              };
            }
          } else {
            if (outcome.price > best.spread.away.odds) {
              best.spread.away = {
                odds: outcome.price,
                point: outcome.point ?? 0,
                book: bookmaker.title,
              };
            }
          }
        }
      } else if (market.key === "totals") {
        for (const outcome of market.outcomes) {
          if (outcome.name === "Over") {
            if (outcome.price > best.total.over.odds) {
              best.total.over = {
                odds: outcome.price,
                point: outcome.point ?? 0,
                book: bookmaker.title,
              };
            }
          } else {
            if (outcome.price > best.total.under.odds) {
              best.total.under = {
                odds: outcome.price,
                point: outcome.point ?? 0,
                book: bookmaker.title,
              };
            }
          }
        }
      }
    }
  }

  return best;
}

/**
 * Find value bets by comparing odds across bookmakers
 */
export function findOddsDiscrepancies(
  game: OddsResponse,
  market: string = "h2h"
): {
  outcome: string;
  highBook: string;
  highOdds: number;
  lowBook: string;
  lowOdds: number;
  spread: number;
}[] {
  const outcomeMap = new Map<
    string,
    { book: string; odds: number }[]
  >();

  for (const bookmaker of game.bookmakers) {
    const mkt = bookmaker.markets.find((m) => m.key === market);
    if (!mkt) continue;
    for (const outcome of mkt.outcomes) {
      const key = outcome.point !== undefined
        ? `${outcome.name}|${outcome.point}`
        : outcome.name;
      if (!outcomeMap.has(key)) outcomeMap.set(key, []);
      outcomeMap.get(key)!.push({ book: bookmaker.title, odds: outcome.price });
    }
  }

  const discrepancies: {
    outcome: string;
    highBook: string;
    highOdds: number;
    lowBook: string;
    lowOdds: number;
    spread: number;
  }[] = [];

  for (const [outcome, books] of Array.from(outcomeMap.entries())) {
    if (books.length < 2) continue;
    books.sort((a, b) => b.odds - a.odds);
    const high = books[0];
    const low = books[books.length - 1];
    const spread =
      americanToImpliedProbability(low.odds) -
      americanToImpliedProbability(high.odds);
    if (spread > 0.03) {
      discrepancies.push({
        outcome,
        highBook: high.book,
        highOdds: high.odds,
        lowBook: low.book,
        lowOdds: low.odds,
        spread: Math.round(spread * 1000) / 10,
      });
    }
  }

  return discrepancies.sort((a, b) => b.spread - a.spread);
}

/**
 * Format date for display
 */
export function formatGameTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Check if a game is live (started but not completed)
 */
export function isGameLive(commenceTime: string): boolean {
  const now = new Date();
  const start = new Date(commenceTime);
  const hoursElapsed = (now.getTime() - start.getTime()) / (1000 * 60 * 60);
  return start <= now && hoursElapsed < 4; // Most games < 4 hours
}

/**
 * Generate a short form string like "WWLWL" from recent games
 */
export function formString(
  games: { home_team_score: number; visitor_team_score: number; home_team: { id: number } }[],
  teamId: number,
  count: number = 5
): string {
  return games
    .slice(0, count)
    .map((g) => {
      const isHome = g.home_team.id === teamId;
      const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
      const oppScore = isHome ? g.visitor_team_score : g.home_team_score;
      return teamScore > oppScore ? "W" : "L";
    })
    .join("");
}

/**
 * CN utility for conditional classnames
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
