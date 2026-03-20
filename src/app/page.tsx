"use client";

import { useOdds } from "@/hooks/useOdds";
import { useUserStore } from "@/stores/userStore";
import { GameCard } from "@/components/games/GameCard";
import { isGameLive } from "@/lib/utils";

export default function TodaysBoard() {
  const { selectedSport } = useUserStore();
  const { games, loading, error, lastUpdated } = useOdds(selectedSport);

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

      {/* Empty state */}
      {!loading && games.length === 0 && !error && (
        <div className="text-center py-20">
          <h3 className="text-lg font-semibold mb-1">No Games Today</h3>
          <p className="text-sm text-text-muted">
            Check back later or switch sports using the tabs above.
          </p>
        </div>
      )}
    </div>
  );
}
