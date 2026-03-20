"use client";

import { useState } from "react";
import { useOdds } from "@/hooks/useOdds";
import { useUserStore } from "@/stores/userStore";
import { useBetSlipStore } from "@/stores/betSlipStore";
import { BetRecommendation, OddsResponse } from "@/lib/types";
import { formatOdds, extractBestOdds, cn } from "@/lib/utils";

export default function ParlayBuilder() {
  const { selectedSport } = useUserStore();
  const { rawOdds, loading } = useOdds(selectedSport);
  const { legs, addLeg, removeLeg, clearSlip, stake, setStake, getCombinedOdds, getPayout } =
    useBetSlipStore();
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  function addBetFromOdds(
    game: OddsResponse,
    market: string,
    outcomeName: string,
    odds: number,
    point?: number
  ) {
    const bet: BetRecommendation = {
      type: market === "h2h" ? "moneyline" : market === "spreads" ? "spread" : "total",
      pick:
        market === "totals"
          ? `${outcomeName} ${point}`
          : market === "spreads"
            ? `${outcomeName} ${(point ?? 0) > 0 ? "+" : ""}${point}`
            : outcomeName,
      bestBook: "Best Available",
      bestOdds: formatOdds(odds),
      confidence: 0,
      reasoning: "",
      impliedProbability: 0,
      estimatedTrueProbability: 0,
      edge: 0,
    };
    addLeg(bet);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Parlay Builder</h1>
      <p className="text-sm text-text-muted mb-6">
        Build custom parlays with AI-assisted feedback
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Game list */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse">
                <div className="h-5 w-48 bg-bg-hover rounded mb-2" />
                <div className="h-4 w-32 bg-bg-hover rounded" />
              </div>
            ))
          ) : (
            rawOdds.map((game) => {
              const isExpanded = expandedGame === game.id;
              const best = extractBestOdds(game);

              return (
                <div key={game.id} className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
                  <button
                    onClick={() => setExpandedGame(isExpanded ? null : game.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-bg-hover transition-colors text-left"
                  >
                    <div>
                      <span className="font-semibold text-sm">
                        {game.away_team} @ {game.home_team}
                      </span>
                    </div>
                    <svg
                      className={cn("w-4 h-4 text-text-muted transition-transform", isExpanded && "rotate-180")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Moneyline */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase">Moneyline</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => addBetFromOdds(game, "h2h", game.away_team, best.moneyline.away.odds)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">{game.away_team}</div>
                            <div className="font-mono text-sm font-semibold text-accent-green">
                              {formatOdds(best.moneyline.away.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() => addBetFromOdds(game, "h2h", game.home_team, best.moneyline.home.odds)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">{game.home_team}</div>
                            <div className="font-mono text-sm font-semibold text-accent-green">
                              {formatOdds(best.moneyline.home.odds)}
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Spread */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase">Spread</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => addBetFromOdds(game, "spreads", game.away_team, best.spread.away.odds, best.spread.away.point)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">
                              {game.away_team} {best.spread.away.point > 0 ? "+" : ""}{best.spread.away.point}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.spread.away.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() => addBetFromOdds(game, "spreads", game.home_team, best.spread.home.odds, best.spread.home.point)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">
                              {game.home_team} {best.spread.home.point > 0 ? "+" : ""}{best.spread.home.point}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.spread.home.odds)}
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Totals */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase">Total</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => addBetFromOdds(game, "totals", "Over", best.total.over.odds, best.total.over.point)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">Over {best.total.over.point}</div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.total.over.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() => addBetFromOdds(game, "totals", "Under", best.total.under.odds, best.total.under.point)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-2.5 hover:border-accent-green transition-colors text-left"
                          >
                            <div className="text-xs font-medium">Under {best.total.under.point}</div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.total.under.odds)}
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bet Slip */}
        <div className="lg:col-span-1">
          <div className="sticky top-32 bg-bg-card border border-border-subtle rounded-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">
                Bet Slip ({legs.length})
              </h2>
              {legs.length > 0 && (
                <button
                  onClick={clearSlip}
                  className="text-xs text-accent-red hover:underline"
                >
                  Clear
                </button>
              )}
            </div>

            {legs.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-8">
                Click odds to add legs to your parlay
              </p>
            ) : (
              <div className="space-y-2 mb-4">
                {legs.map((leg, i) => (
                  <div
                    key={i}
                    className="bg-bg-hover rounded-lg p-2.5 flex items-start justify-between"
                  >
                    <div>
                      <div className="text-xs font-medium">{leg.pick}</div>
                      <div className="font-mono text-xs text-accent-green">
                        {leg.bestOdds}
                      </div>
                    </div>
                    <button
                      onClick={() => removeLeg(i)}
                      className="text-text-muted hover:text-accent-red ml-2"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {legs.length > 0 && (
              <>
                {/* Stake input */}
                <div className="mb-4">
                  <label className="text-xs text-text-muted mb-1 block">Wager</label>
                  <div className="flex items-center bg-bg-hover rounded-lg border border-border-subtle">
                    <span className="px-3 text-text-muted">$</span>
                    <input
                      type="number"
                      value={stake}
                      onChange={(e) => setStake(Number(e.target.value))}
                      className="bg-transparent flex-1 py-2 pr-3 font-mono text-sm outline-none"
                      min={1}
                    />
                  </div>
                </div>

                {/* Payout */}
                <div className="bg-bg-hover rounded-lg p-3 flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs text-text-muted">Combined Odds</div>
                    <div className="font-mono font-bold text-accent-green">
                      {getCombinedOdds()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-text-muted">To Win</div>
                    <div className="font-mono font-bold text-lg text-accent-green">
                      ${getPayout().toFixed(2)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
