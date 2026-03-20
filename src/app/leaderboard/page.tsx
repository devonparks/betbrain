"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LeaderboardData {
  aiRecord: {
    wins: number;
    losses: number;
    pushes: number;
    units: number;
    winRate: number;
  } | null;
  topUsers: {
    uid: string;
    displayName: string;
    record: { wins: number; losses: number; pushes: number; units: number };
  }[];
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch("/api/leaderboard");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // Best effort
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  const aiRecord = data?.aiRecord ?? {
    wins: 0,
    losses: 0,
    pushes: 0,
    units: 0,
    winRate: 0,
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Leaderboard</h1>
      <p className="text-sm text-text-muted mb-6">
        AI performance tracking and community rankings
      </p>

      {loading ? (
        <div className="space-y-4">
          <div className="bg-bg-card border border-border-subtle rounded-card p-8 animate-pulse">
            <div className="h-6 w-40 bg-bg-hover rounded mb-4" />
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-bg-hover rounded" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* AI Season Record */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5 mb-6">
            <h2 className="font-semibold text-sm mb-4">AI Season Record</h2>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="font-mono text-2xl font-bold text-accent-green">
                  {aiRecord.wins}
                </div>
                <div className="text-xs text-text-muted">Wins</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-accent-red">
                  {aiRecord.losses}
                </div>
                <div className="text-xs text-text-muted">Losses</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-text-secondary">
                  {aiRecord.pushes}
                </div>
                <div className="text-xs text-text-muted">Pushes</div>
              </div>
              <div>
                <div
                  className={cn(
                    "font-mono text-2xl font-bold",
                    aiRecord.units >= 0
                      ? "text-accent-green"
                      : "text-accent-red"
                  )}
                >
                  {aiRecord.units >= 0 ? "+" : ""}
                  {aiRecord.units.toFixed(1)}u
                </div>
                <div className="text-xs text-text-muted">Units</div>
              </div>
            </div>
            {aiRecord.wins + aiRecord.losses > 0 && (
              <div className="mt-4 pt-3 border-t border-border-subtle text-center">
                <span className="text-xs text-text-muted">Win Rate: </span>
                <span className="font-mono text-sm font-bold text-accent-green">
                  {(aiRecord.winRate * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          {/* Community Leaderboard */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h2 className="font-semibold text-sm mb-4">
              Community Leaderboard
            </h2>
            {data?.topUsers && data.topUsers.length > 0 ? (
              <div className="space-y-2">
                {data.topUsers.map((user, i) => {
                  const totalBets =
                    user.record.wins + user.record.losses + user.record.pushes;
                  const winRate =
                    totalBets > 0
                      ? (user.record.wins / (user.record.wins + user.record.losses)) * 100
                      : 0;
                  return (
                    <div
                      key={user.uid}
                      className={cn(
                        "flex items-center justify-between py-3 px-3 rounded-lg",
                        i === 0
                          ? "bg-accent-green/5 border border-accent-green/20"
                          : i < 3
                            ? "bg-bg-hover"
                            : ""
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "font-mono text-sm font-bold w-6 text-center",
                            i === 0
                              ? "text-accent-green"
                              : i < 3
                                ? "text-accent-amber"
                                : "text-text-muted"
                          )}
                        >
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium">
                          {user.displayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-text-secondary">
                          {user.record.wins}-{user.record.losses}
                          {user.record.pushes > 0 ? `-${user.record.pushes}` : ""}
                        </span>
                        {totalBets > 0 && (
                          <span className="font-mono text-xs text-text-muted">
                            {winRate.toFixed(0)}%
                          </span>
                        )}
                        <span
                          className={cn(
                            "font-mono text-sm font-bold min-w-[4rem] text-right",
                            user.record.units >= 0
                              ? "text-accent-green"
                              : "text-accent-red"
                          )}
                        >
                          {user.record.units >= 0 ? "+" : ""}
                          {user.record.units.toFixed(1)}u
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-sm text-text-muted">
                  No users on the leaderboard yet. Sign up and start tracking
                  your bets to appear here.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
