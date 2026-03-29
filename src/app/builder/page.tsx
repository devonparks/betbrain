"use client";

import { useState } from "react";
import { useOdds } from "@/hooks/useOdds";
import { useUserStore } from "@/stores/userStore";
import { useBlacklistStore } from "@/stores/blacklistStore";
import { useBetSlipStore } from "@/stores/betSlipStore";
import { BetRecommendation, OddsResponse } from "@/lib/types";
import { PredictionParlay } from "@/lib/prediction-engine";
import { formatOdds, extractBestOdds, cn } from "@/lib/utils";
import { SendToFanDuel } from "@/components/betting/SendToFanDuel";

export default function ParlayBuilder() {
  const { selectedSport } = useUserStore();
  const { players: blacklist } = useBlacklistStore();
  const { rawOdds, loading } = useOdds(selectedSport);
  const { legs, addLeg, removeLeg, clearSlip, stake, setStake, getCombinedOdds, getPayout } =
    useBetSlipStore();
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [hailMary, setHailMary] = useState<PredictionParlay | null>(null);
  const [loadingHailMary, setLoadingHailMary] = useState(false);

  async function generateHailMary() {
    setLoadingHailMary(true);
    try {
      const blParam = blacklist.length > 0 ? `&blacklist=${blacklist.join(",")}` : "";
      const res = await fetch(`/api/predict-ou?sport=${selectedSport}${blParam}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setHailMary(data.hailMary ?? null);
      // Auto-add hail mary legs to slip
      if (data.hailMary?.legs) {
        clearSlip();
        for (const leg of data.hailMary.legs) {
          const odds = leg.prediction === "OVER" ? leg.overOdds : leg.underOdds;
          addLeg({
            type: "player_prop",
            pick: `${leg.player} ${leg.prediction} ${leg.line} ${leg.stat}`,
            bestBook: leg.book,
            bestOdds: formatOdds(odds),
            confidence: leg.confidence,
            reasoning: leg.reasoning,
            impliedProbability: 0,
            estimatedTrueProbability: leg.confidence / 100,
            edge: 0,
          });
        }
      }
    } catch {
      // Failed silently
    } finally {
      setLoadingHailMary(false);
    }
  }

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
      {/* ============ SAFE HAIL MARY HERO ============ */}
      <div className="relative rounded-2xl border border-accent-green/20 bg-gradient-to-br from-accent-green/[0.06] via-bg-card to-bg-primary p-8 mb-8 overflow-hidden">
        {/* Background glow effect */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-accent-green/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-accent-green/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-widest text-accent-green">
              AI-Powered
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
            Safe Hail Mary
          </h1>
          <p className="text-sm text-text-secondary max-w-lg mb-6">
            AI auto-builds your best O/U parlay for tonight. We scan every player prop, crunch
            the numbers, and surface the highest-confidence combination.
          </p>

          <button
            onClick={generateHailMary}
            disabled={loadingHailMary}
            className={cn(
              "relative group px-8 py-3.5 rounded-xl text-sm font-bold transition-all",
              "bg-accent-green text-bg-primary",
              "shadow-[0_0_24px_rgba(0,230,118,0.25)] hover:shadow-[0_0_36px_rgba(0,230,118,0.4)]",
              "hover:scale-[1.02] active:scale-[0.98]",
              loadingHailMary && "opacity-80 cursor-wait"
            )}
          >
            {loadingHailMary ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Parlay
              </span>
            )}
          </button>
        </div>

        {/* ---- Hail Mary Results ---- */}
        {hailMary && (
          <div className="relative z-10 mt-8 space-y-3">
            <div className="h-px bg-accent-green/20" />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {hailMary.legs.map((leg, i) => (
                <div
                  key={i}
                  className="bg-bg-card/60 backdrop-blur border border-border-subtle rounded-xl p-4 hover:border-accent-green/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-accent-green uppercase tracking-wide">
                      {leg.prediction}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/20">
                      {leg.confidence}% conf
                    </span>
                  </div>
                  <div className="font-semibold text-sm mb-0.5">{leg.player}</div>
                  <div className="text-xs text-text-secondary mb-2">
                    {leg.prediction} {leg.line} {leg.stat}
                  </div>
                  <p className="text-[11px] text-text-muted leading-relaxed line-clamp-3">
                    {leg.reasoning}
                  </p>
                </div>
              ))}
            </div>

            {/* Combined odds + payout */}
            <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-border-subtle">
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide">Combined Odds</div>
                <div className="font-mono font-bold text-lg text-accent-green">
                  {hailMary.combinedOdds > 0 ? "+" : ""}{hailMary.combinedOdds}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide">$10 Payout</div>
                <div className="font-mono font-bold text-lg text-white">
                  ${hailMary.payout.payout.toFixed(2)}
                </div>
              </div>
              <div className="flex-1 text-right">
                <SendToFanDuel label="Send to FanDuel" className="!text-sm !px-5 !py-2.5" />
              </div>
            </div>

            <p className="text-[11px] text-text-muted">{hailMary.strategy}</p>
          </div>
        )}
      </div>

      {/* ============ MAIN GRID ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ---- Game List ---- */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold tracking-tight">Tonight&apos;s Games</h2>
            <a
              href="/predictions"
              className="text-xs font-semibold text-accent-green hover:underline transition-colors"
            >
              View O/U Predictions
            </a>
          </div>

          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="bg-bg-card border border-border-subtle rounded-xl p-4 animate-pulse">
                <div className="h-5 w-48 bg-bg-hover rounded mb-2" />
                <div className="h-4 w-32 bg-bg-hover rounded" />
              </div>
            ))
          ) : rawOdds.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-sm">
              No games available right now. Check back closer to game time.
            </div>
          ) : (
            rawOdds.map((game) => {
              const isExpanded = expandedGame === game.id;
              const best = extractBestOdds(game);

              return (
                <div
                  key={game.id}
                  className={cn(
                    "bg-bg-card border rounded-xl overflow-hidden transition-colors",
                    isExpanded ? "border-accent-green/30" : "border-border-subtle"
                  )}
                >
                  <button
                    onClick={() => setExpandedGame(isExpanded ? null : game.id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-bg-hover transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-bg-hover flex items-center justify-center text-text-muted">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <circle cx="12" cy="12" r="10" />
                          <path strokeLinecap="round" d="M12 6v6l4 2" />
                        </svg>
                      </div>
                      <div>
                        <span className="font-semibold text-sm">
                          {game.away_team} @ {game.home_team}
                        </span>
                        <div className="text-[10px] text-text-muted mt-0.5">
                          {new Date(game.commence_time).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={cn("w-4 h-4 text-text-muted transition-transform", isExpanded && "rotate-180")}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4">
                      <div className="h-px bg-border-subtle" />

                      {/* Moneyline */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase tracking-wider font-medium">
                          Moneyline
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => addBetFromOdds(game, "h2h", game.away_team, best.moneyline.away.odds)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              {game.away_team}
                            </div>
                            <div className="font-mono text-sm font-semibold text-accent-green">
                              {formatOdds(best.moneyline.away.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() => addBetFromOdds(game, "h2h", game.home_team, best.moneyline.home.odds)}
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              {game.home_team}
                            </div>
                            <div className="font-mono text-sm font-semibold text-accent-green">
                              {formatOdds(best.moneyline.home.odds)}
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Spread */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase tracking-wider font-medium">
                          Spread
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() =>
                              addBetFromOdds(game, "spreads", game.away_team, best.spread.away.odds, best.spread.away.point)
                            }
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              {game.away_team}{" "}
                              {best.spread.away.point > 0 ? "+" : ""}
                              {best.spread.away.point}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.spread.away.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() =>
                              addBetFromOdds(game, "spreads", game.home_team, best.spread.home.odds, best.spread.home.point)
                            }
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              {game.home_team}{" "}
                              {best.spread.home.point > 0 ? "+" : ""}
                              {best.spread.home.point}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.spread.home.odds)}
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Totals */}
                      <div>
                        <div className="text-[10px] text-text-muted mb-1.5 uppercase tracking-wider font-medium">
                          Total
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() =>
                              addBetFromOdds(game, "totals", "Over", best.total.over.odds, best.total.over.point)
                            }
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              Over {best.total.over.point}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                              {formatOdds(best.total.over.odds)}
                            </div>
                          </button>
                          <button
                            onClick={() =>
                              addBetFromOdds(game, "totals", "Under", best.total.under.odds, best.total.under.point)
                            }
                            className="bg-bg-hover border border-border-subtle rounded-lg p-3 hover:border-accent-green/40 transition-colors text-left group"
                          >
                            <div className="text-xs font-medium text-text-secondary group-hover:text-text-primary transition-colors">
                              Under {best.total.under.point}
                            </div>
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

        {/* ---- Bet Slip Sidebar ---- */}
        <div className="lg:col-span-1">
          <div className="sticky top-32 bg-bg-card border border-border-subtle rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Bet Slip
                {legs.length > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-accent-green/10 text-accent-green border border-accent-green/20">
                    {legs.length}
                  </span>
                )}
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
              <div className="text-center py-10">
                <svg className="w-8 h-8 mx-auto text-text-muted/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <p className="text-xs text-text-muted">
                  Click odds to add legs to your parlay
                </p>
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {legs.map((leg, i) => (
                  <div
                    key={i}
                    className="bg-bg-hover rounded-lg p-2.5 flex items-start justify-between group"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{leg.pick}</div>
                      <div className="font-mono text-xs text-accent-green">
                        {leg.bestOdds}
                      </div>
                    </div>
                    <button
                      onClick={() => removeLeg(i)}
                      className="text-text-muted hover:text-accent-red ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    <div className="text-[10px] text-text-muted uppercase tracking-wide">Combined Odds</div>
                    <div className="font-mono font-bold text-accent-green">
                      {getCombinedOdds()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-text-muted uppercase tracking-wide">To Win</div>
                    <div className="font-mono font-bold text-lg text-accent-green">
                      ${getPayout().toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Send to FanDuel */}
                <SendToFanDuel className="w-full justify-center" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
