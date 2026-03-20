"use client";

import { useState, useEffect } from "react";
import { DailyPick } from "@/lib/types";
import { ConfidenceMeter } from "@/components/analysis/ConfidenceMeter";

export default function DailyPickPage() {
  const [pick] = useState<DailyPick | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production this would fetch from /api/daily-pick
    // For now, show a placeholder
    setLoading(false);
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Daily Safe Pick</h1>
      <p className="text-sm text-text-muted mb-6">
        One free pick every day — the highest-confidence bet on the board
      </p>

      {loading ? (
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 animate-pulse">
          <div className="h-6 w-48 bg-bg-hover rounded mb-4" />
          <div className="h-4 w-64 bg-bg-hover rounded mb-2" />
          <div className="h-4 w-56 bg-bg-hover rounded" />
        </div>
      ) : pick ? (
        <div className="space-y-6">
          {/* Today's Pick */}
          <div className="bg-bg-card border border-accent-green/30 rounded-card p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-text-muted">{pick.date}</span>
              <ConfidenceMeter confidence={pick.pick.confidence} size="md" />
            </div>
            <h2 className="text-xl font-bold mb-1">{pick.pick.pick}</h2>
            <div className="flex items-center gap-3 text-sm text-text-secondary mb-4">
              <span className="font-mono text-accent-green">{pick.pick.bestOdds}</span>
              <span>{pick.pick.bestBook}</span>
              <span>{pick.pick.edge.toFixed(1)}% edge</span>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {pick.fullAnalysis}
            </p>
          </div>

          {/* Historical Accuracy */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h3 className="font-semibold text-sm mb-4">Pick Accuracy</h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "All Time", record: pick.historicalAccuracy.allTime },
                { label: "Last 30 Days", record: pick.historicalAccuracy.last30Days },
                { label: "Last 7 Days", record: pick.historicalAccuracy.last7Days },
              ].map((period) => (
                <div key={period.label} className="text-center">
                  <div className="text-xs text-text-muted mb-1">{period.label}</div>
                  <div className="font-mono text-lg font-bold text-accent-green">
                    {(period.record.winRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-text-secondary">
                    {period.record.wins}-{period.record.losses}-{period.record.pushes}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
          <h3 className="font-semibold mb-2">Today&apos;s Pick Coming Soon</h3>
          <p className="text-sm text-text-muted">
            The daily pick is generated each morning at 10 AM ET.
            <br />
            Check back soon for today&apos;s highest-confidence bet.
          </p>
        </div>
      )}
    </div>
  );
}
