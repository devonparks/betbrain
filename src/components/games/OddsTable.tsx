"use client";

import { OddsResponse } from "@/lib/types";
import { formatOdds, cn } from "@/lib/utils";

interface OddsTableProps {
  game: OddsResponse;
}

export function OddsTable({ game }: OddsTableProps) {
  // Find best odds for highlighting
  const bestByOutcome = new Map<string, { market: string; odds: number; book: string }>();

  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        const key = `${market.key}_${outcome.name}_${outcome.point ?? ""}`;
        const current = bestByOutcome.get(key);
        if (!current || outcome.price > current.odds) {
          bestByOutcome.set(key, {
            market: market.key,
            odds: outcome.price,
            book: bookmaker.title,
          });
        }
      }
    }
  }

  const markets = ["h2h", "spreads", "totals"];
  const marketLabels: Record<string, string> = {
    h2h: "Moneyline",
    spreads: "Spread",
    totals: "Total",
  };

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
      <div className="p-4 border-b border-border-subtle">
        <h3 className="font-semibold text-sm">Odds Comparison</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Best line highlighted in green
        </p>
      </div>

      <div className="overflow-x-auto">
        {markets.map((market) => {
          const booksWithMarket = game.bookmakers.filter((b) =>
            b.markets.some((m) => m.key === market)
          );
          if (booksWithMarket.length === 0) return null;

          return (
            <div key={market} className="border-b border-border-subtle last:border-0">
              <div className="px-4 py-2 bg-bg-hover">
                <span className="text-xs font-medium text-text-secondary">
                  {marketLabels[market]}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left px-4 py-2 text-text-muted font-medium w-32">
                      Book
                    </th>
                    {market === "totals" ? (
                      <>
                        <th className="text-center px-3 py-2 text-text-muted font-medium">Over</th>
                        <th className="text-center px-3 py-2 text-text-muted font-medium">Under</th>
                      </>
                    ) : (
                      <>
                        <th className="text-center px-3 py-2 text-text-muted font-medium">
                          {game.away_team}
                        </th>
                        <th className="text-center px-3 py-2 text-text-muted font-medium">
                          {game.home_team}
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {booksWithMarket.map((bookmaker) => {
                    const mkt = bookmaker.markets.find((m) => m.key === market);
                    if (!mkt) return null;

                    return (
                      <tr
                        key={bookmaker.key}
                        className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                      >
                        <td className="px-4 py-2 text-text-secondary">
                          {bookmaker.title}
                        </td>
                        {mkt.outcomes.map((outcome) => {
                          const key = `${market}_${outcome.name}_${outcome.point ?? ""}`;
                          const isBest = bestByOutcome.get(key)?.book === bookmaker.title;

                          return (
                            <td
                              key={outcome.name}
                              className={cn(
                                "text-center px-3 py-2 font-mono",
                                isBest
                                  ? "text-accent-green font-semibold"
                                  : "text-text-primary"
                              )}
                            >
                              {outcome.point !== undefined && (
                                <span className="text-text-muted mr-1">
                                  {outcome.point > 0 ? "+" : ""}{outcome.point}
                                </span>
                              )}
                              {formatOdds(outcome.price)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
