"use client";

import { useState, useEffect } from "react";
import { DailyRecap } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function RecapPage() {
  const [recap, setRecap] = useState<DailyRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRecap() {
      try {
        const res = await fetch("/api/recap");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setRecap(data);
      } catch {
        setError("Could not load recap");
      } finally {
        setLoading(false);
      }
    }
    fetchRecap();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Daily Recap</h1>
      <p className="text-sm text-text-muted mb-6">
        Yesterday&apos;s results and AI performance tracking
      </p>

      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4 mb-4">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse">
              <div className="h-5 w-40 bg-bg-hover rounded mb-2" />
              <div className="h-4 w-64 bg-bg-hover rounded" />
            </div>
          ))}
        </div>
      ) : recap ? (
        <div className="space-y-6">
          {/* Record summary */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h3 className="font-semibold text-sm mb-3">Yesterday&apos;s Record</h3>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="font-mono text-2xl font-bold text-accent-green">
                  {recap.record.wins}
                </div>
                <div className="text-xs text-text-muted">Wins</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-accent-red">
                  {recap.record.losses}
                </div>
                <div className="text-xs text-text-muted">Losses</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-text-secondary">
                  {recap.record.pushes}
                </div>
                <div className="text-xs text-text-muted">Pushes</div>
              </div>
              <div>
                <div className={cn(
                  "font-mono text-2xl font-bold",
                  recap.units >= 0 ? "text-accent-green" : "text-accent-red"
                )}>
                  {recap.units >= 0 ? "+" : ""}{recap.units.toFixed(1)}u
                </div>
                <div className="text-xs text-text-muted">Units</div>
              </div>
            </div>
          </div>

          {/* Results list */}
          <div className="bg-bg-card border border-border-subtle rounded-card p-5">
            <h3 className="font-semibold text-sm mb-3">All Picks</h3>
            <div className="space-y-2">
              {recap.results.map((result, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-xs font-mono font-bold px-2 py-0.5 rounded",
                      result.result === "won" ? "bg-accent-green/20 text-accent-green" :
                      result.result === "lost" ? "bg-accent-red/20 text-accent-red" :
                      "bg-text-muted/20 text-text-muted"
                    )}>
                      {result.result.toUpperCase()}
                    </span>
                    <span className="text-sm">{result.bet.pick}</span>
                  </div>
                  <span className="font-mono text-xs text-text-secondary">
                    {result.bet.bestOdds}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Self-Analysis */}
          {recap.aiSelfAnalysis && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-5">
              <h3 className="font-semibold text-sm mb-3">AI Self-Analysis</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {recap.aiSelfAnalysis}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
          <h3 className="font-semibold mb-2">No Recap Yet</h3>
          <p className="text-sm text-text-muted">
            Recaps are generated after games complete. Check back tomorrow morning.
          </p>
        </div>
      )}
    </div>
  );
}
