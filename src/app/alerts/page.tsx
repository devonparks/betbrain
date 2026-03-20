"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { OddsResponse } from "@/lib/types";
import { detectValueBets, ValueBet } from "@/lib/value-detector";

interface AlertItem {
  id: string;
  type: "lineup" | "odds" | "value";
  title: string;
  description: string;
  timestamp: string;
  isValueWindow: boolean;
  sport: string;
  gameId?: string;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      // Fetch today's odds to detect value bets
      const oddsRes = await fetch("/api/odds?sport=nba");
      if (!oddsRes.ok) return;
      const games: OddsResponse[] = await oddsRes.json();

      const newAlerts: AlertItem[] = [];

      // Detect value bets from cross-book discrepancies
      const valueBets: ValueBet[] = detectValueBets(games);
      for (const vb of valueBets) {
        newAlerts.push({
          id: `value-${vb.gameId}-${vb.outcome}-${vb.market}`,
          type: "value",
          title: `${vb.edge.toFixed(1)}% edge on ${vb.outcome}`,
          description: `${vb.bestBook} has ${vb.outcome} ${vb.market === "h2h" ? "ML" : vb.market} at ${vb.bestOdds > 0 ? "+" : ""}${vb.bestOdds} — ${vb.edge.toFixed(1)}% above consensus. ${vb.homeTeam} vs ${vb.awayTeam}.`,
          timestamp: new Date().toLocaleTimeString(),
          isValueWindow: vb.edge >= 5,
          sport: "nba",
          gameId: vb.gameId,
        });
      }

      // Fetch game research for injury alerts from all games
      for (const game of games.slice(0, 5)) {
        try {
          const researchRes = await fetch(
            `/api/stats/game-research?homeTeam=${encodeURIComponent(game.home_team)}&awayTeam=${encodeURIComponent(game.away_team)}&sport=nba`
          );
          if (!researchRes.ok) continue;
          const data = await researchRes.json();
          if (data.gameData) {
            // Check for significant injuries
            for (const team of [data.gameData.homeTeam, data.gameData.awayTeam]) {
              const outPlayers = team.injuries?.filter(
                (i: { status: string; player: string; position: string }) =>
                  i.status.toLowerCase().includes("out") ||
                  i.status.toLowerCase().includes("doubtful")
              ) ?? [];
              for (const injury of outPlayers) {
                newAlerts.push({
                  id: `injury-${game.id}-${injury.player}`,
                  type: "lineup",
                  title: `${injury.player} ${injury.status}`,
                  description: `${injury.player} (${injury.position}) is ${injury.status.toLowerCase()} for ${team.name}. ${game.away_team} @ ${game.home_team}.`,
                  timestamp: "Today",
                  isValueWindow: false,
                  sport: "nba",
                  gameId: game.id,
                });
              }
            }
          }
        } catch {
          // Individual game research failures are okay
        }
      }

      setAlerts(newAlerts);
      setLastRefresh(new Date());
    } catch {
      // Alerts are best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    // Refresh every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const valueAlerts = alerts.filter((a) => a.isValueWindow);
  const recentAlerts = alerts.filter((a) => !a.isValueWindow);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        <button
          onClick={fetchAlerts}
          className="text-xs text-text-muted hover:text-accent-green transition-colors"
        >
          {lastRefresh
            ? `Updated ${lastRefresh.toLocaleTimeString()}`
            : "Refresh"}
        </button>
      </div>
      <p className="text-sm text-text-muted mb-6">
        Lineup changes, odds movement, and value windows
      </p>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse"
            >
              <div className="h-4 w-48 bg-bg-hover rounded mb-2" />
              <div className="h-3 w-64 bg-bg-hover rounded" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Value Windows section */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-accent-green mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              Active Value Windows
            </h2>
            {valueAlerts.length > 0 ? (
              <div className="space-y-3">
                {valueAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-accent-green/5 border border-accent-green/30 rounded-card p-4"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm text-accent-green">
                        {alert.title}
                      </span>
                      <span className="text-xs text-text-muted">
                        {alert.timestamp}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary">
                      {alert.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-bg-card border border-border-subtle rounded-card p-4 text-center">
                <p className="text-xs text-text-muted">
                  No active value windows right now
                </p>
              </div>
            )}
          </div>

          {/* Recent Alerts */}
          <div>
            <h2 className="text-sm font-semibold text-text-secondary mb-3">
              Recent Activity
            </h2>
            {recentAlerts.length > 0 ? (
              <div className="space-y-2">
                {recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-bg-card border border-border-subtle rounded-card p-4 hover:border-border-hover transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          "text-[10px] font-medium px-2 py-0.5 rounded-full",
                          alert.type === "lineup"
                            ? "bg-accent-amber/20 text-accent-amber"
                            : alert.type === "odds"
                              ? "bg-accent-blue/20 text-accent-blue"
                              : "bg-accent-green/20 text-accent-green"
                        )}
                      >
                        {alert.type.toUpperCase()}
                      </span>
                      <span className="font-medium text-sm">{alert.title}</span>
                    </div>
                    <p className="text-xs text-text-muted">
                      {alert.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
                <svg
                  className="w-10 h-10 text-text-muted mx-auto mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <h3 className="font-semibold mb-1">No Alerts</h3>
                <p className="text-sm text-text-muted">
                  Alerts appear when lineup changes or significant odds movement
                  are detected before game time.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
