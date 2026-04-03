"use client";

import { useState, useEffect } from "react";
import { DailyPick } from "@/lib/types";
import { ConfidenceMeter } from "@/components/analysis/ConfidenceMeter";

export default function DailyPickPage() {
  const [pick, setPick] = useState<DailyPick | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPick() {
      try {
        const res = await fetch("/api/daily-pick");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setPick(data);
      } catch {
        setError("Could not load today's pick");
      } finally {
        setLoading(false);
      }
    }
    fetchPick();
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-pick/generate", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate pick");
      }
      const data = await res.json();
      setPick(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate pick");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Daily Safe Pick</h1>
      <p className="text-sm text-text-muted mb-6">
        One free pick every day — the highest-confidence bet on the board
      </p>

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4 mb-4">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

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
          <p className="text-sm text-text-muted mb-4">
            The daily pick is generated each morning at 10 AM ET.
            <br />
            Check back soon for today&apos;s highest-confidence bet.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2.5 bg-accent-green text-bg-primary font-semibold text-sm rounded-lg hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating...
              </span>
            ) : (
              "Generate Now"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
