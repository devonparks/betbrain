"use client";

import { useState, useEffect } from "react";
import { useOdds } from "@/hooks/useOdds";
import { useUserStore } from "@/stores/userStore";
import { GameCard } from "@/components/games/GameCard";
import { ConfidenceMeter } from "@/components/analysis/ConfidenceMeter";
import { isGameLive, cn } from "@/lib/utils";
import { DailyPick, DailyRecap } from "@/lib/types";

export default function TodaysBoard() {
  const { selectedSport } = useUserStore();
  const { games, loading, error, lastUpdated } = useOdds(selectedSport);

  const [dailyPick, setDailyPick] = useState<DailyPick | null>(null);
  const [pickLoading, setPickLoading] = useState(true);
  const [recap, setRecap] = useState<DailyRecap | null>(null);
  const [recapLoading, setRecapLoading] = useState(true);

  useEffect(() => {
    async function fetchDailyPick() {
      try {
        const res = await fetch("/api/daily-pick");
        if (res.ok) {
          const data = await res.json();
          setDailyPick(data);
        }
      } catch {
        // Silent fail — pick just won't show
      } finally {
        setPickLoading(false);
      }
    }
    fetchDailyPick();
  }, []);

  useEffect(() => {
    async function fetchRecap() {
      try {
        const res = await fetch("/api/recap");
        if (res.ok) {
          const data = await res.json();
          setRecap(data);
        }
      } catch {
        // Silent fail
      } finally {
        setRecapLoading(false);
      }
    }
    fetchRecap();
  }, []);

  const liveGames = games.filter((g) => isGameLive(g.commenceTime));
  const upcomingGames = games.filter((g) => !isGameLive(g.commenceTime));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today&apos;s Board</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {games.length} games •{" "}
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : "Loading..."}
          </p>
        </div>
      </div>

      {/* Daily Pick Spotlight */}
      {!pickLoading && (
        <div className="bg-bg-card border border-accent-green/30 rounded-card p-5 mb-6">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent-green"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            Today&apos;s Pick
          </h2>
          {dailyPick ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold">{dailyPick.pick.pick}</span>
                <span className="font-mono text-sm text-text-secondary">
                  {dailyPick.pick.bestOdds}
                </span>
              </div>
              <ConfidenceMeter confidence={dailyPick.pick.confidence} size="lg" />
              <p className="text-sm text-text-secondary leading-relaxed">
                {dailyPick.pick.reasoning}
              </p>
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              Daily pick generates at 10 AM ET
            </p>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4 mb-6">
          <p className="text-sm text-accent-red">{error}</p>
          <p className="text-xs text-text-muted mt-1">
            Showing cached data if available. Check your API key configuration.
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse"
            >
              <div className="h-3 w-24 bg-bg-hover rounded mb-4" />
              <div className="space-y-3">
                <div className="h-4 w-40 bg-bg-hover rounded" />
                <div className="h-4 w-36 bg-bg-hover rounded" />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="h-12 bg-bg-hover rounded-lg" />
                <div className="h-12 bg-bg-hover rounded-lg" />
                <div className="h-12 bg-bg-hover rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live Games */}
      {liveGames.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-accent-green mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            Live Games
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Games */}
      {!loading && upcomingGames.length > 0 && (
        <div>
          {liveGames.length > 0 && (
            <h2 className="text-sm font-semibold text-text-secondary mb-3">
              Upcoming
            </h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}

      {/* Send to FanDuel link */}
      {!loading && games.length > 0 && (
        <div className="mt-6 text-center">
          <a
            href="https://www.fanduel.com/sportsbook"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Send to FanDuel
          </a>
        </div>
      )}

      {/* Empty state */}
      {!loading && games.length === 0 && !error && (
        <div className="text-center py-20">
          <h3 className="text-lg font-semibold mb-1">No Games Today</h3>
          <p className="text-sm text-text-muted">
            Check back later or switch sports using the tabs above.
          </p>
        </div>
      )}

      {/* Yesterday's Results */}
      {!recapLoading && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-5 mt-8">
          <h2 className="font-semibold text-sm mb-3">Yesterday&apos;s Results</h2>
          {recap ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-mono">
                  <span className="text-accent-green font-bold">{recap.record.wins}W</span>
                  {" - "}
                  <span className="text-accent-red font-bold">{recap.record.losses}L</span>
                  {recap.record.pushes > 0 && (
                    <>
                      {" - "}
                      <span className="text-text-muted font-bold">{recap.record.pushes}P</span>
                    </>
                  )}
                </span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold",
                    recap.units >= 0 ? "text-accent-green" : "text-accent-red"
                  )}
                >
                  {recap.units >= 0 ? "+" : ""}
                  {recap.units.toFixed(1)}u
                </span>
              </div>
              <div className="space-y-2">
                {recap.results.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 border-b border-border-subtle last:border-0"
                  >
                    <span className="text-sm text-text-secondary">{r.bet.pick}</span>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded",
                        r.result === "won"
                          ? "bg-accent-green/20 text-accent-green"
                          : r.result === "lost"
                            ? "bg-accent-red/20 text-accent-red"
                            : "bg-text-muted/20 text-text-muted"
                      )}
                    >
                      {r.result === "won" ? "W" : r.result === "lost" ? "L" : r.result.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              Results tracked after games complete
            </p>
          )}
        </div>
      )}
    </div>
  );
}
