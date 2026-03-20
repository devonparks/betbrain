"use client";

import { cn } from "@/lib/utils";

const MOCK_AI_RECORD = {
  overall: { wins: 0, losses: 0, pushes: 0, winRate: 0, units: 0 },
  bySport: {} as Record<string, { wins: number; losses: number; winRate: number }>,
  byType: {} as Record<string, { wins: number; losses: number; winRate: number }>,
};

export default function LeaderboardPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Leaderboard</h1>
      <p className="text-sm text-text-muted mb-6">
        AI performance tracking and community rankings
      </p>

      {/* AI Season Record */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5 mb-6">
        <h2 className="font-semibold text-sm mb-4">AI Season Record</h2>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="font-mono text-2xl font-bold text-accent-green">
              {MOCK_AI_RECORD.overall.wins}
            </div>
            <div className="text-xs text-text-muted">Wins</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-accent-red">
              {MOCK_AI_RECORD.overall.losses}
            </div>
            <div className="text-xs text-text-muted">Losses</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-text-secondary">
              {MOCK_AI_RECORD.overall.pushes}
            </div>
            <div className="text-xs text-text-muted">Pushes</div>
          </div>
          <div>
            <div className={cn(
              "font-mono text-2xl font-bold",
              MOCK_AI_RECORD.overall.units >= 0 ? "text-accent-green" : "text-accent-red"
            )}>
              {MOCK_AI_RECORD.overall.units >= 0 ? "+" : ""}
              {MOCK_AI_RECORD.overall.units.toFixed(1)}u
            </div>
            <div className="text-xs text-text-muted">Units</div>
          </div>
        </div>
      </div>

      {/* Placeholder for accuracy breakdowns */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
        <h3 className="font-semibold mb-2">Performance Data Building</h3>
        <p className="text-sm text-text-muted">
          Detailed accuracy breakdowns by sport, bet type, and confidence level will appear here as the AI builds its track record.
        </p>
      </div>
    </div>
  );
}
