"use client";

import { SafeHailMaryParlay } from "@/lib/types";
import { ConfidenceMeter } from "../analysis/ConfidenceMeter";

interface SafeHailMaryProps {
  parlay: SafeHailMaryParlay;
}

export function SafeHailMary({ parlay }: SafeHailMaryProps) {
  const legs = [
    { label: "Safe Leg 1", bet: parlay.safeLeg1, isSafe: true },
    { label: "Safe Leg 2", bet: parlay.safeLeg2, isSafe: true },
    ...(parlay.safeLeg3
      ? [{ label: "Safe Leg 3", bet: parlay.safeLeg3, isSafe: true }]
      : []),
    { label: "Hail Mary", bet: parlay.hailMaryLeg, isSafe: false },
  ];

  return (
    <div className="bg-bg-card border border-accent-amber/30 rounded-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <span className="text-accent-amber">⚡</span>
          Safe Hail Mary Parlay
        </h3>
        <div className="text-right">
          <div className="font-mono text-accent-green font-bold">
            {parlay.combinedOdds}
          </div>
          <div className="text-[10px] text-text-muted">combined odds</div>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {legs.map((leg, i) => (
          <div
            key={i}
            className={`rounded-lg p-3 ${
              leg.isSafe
                ? "bg-bg-hover border border-border-subtle"
                : "bg-accent-amber/5 border border-accent-amber/20"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-[10px] font-medium ${
                  leg.isSafe ? "text-accent-green" : "text-accent-amber"
                }`}
              >
                {leg.label}
              </span>
              <ConfidenceMeter confidence={leg.bet.confidence} size="sm" />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{leg.bet.pick}</span>
              <span className="font-mono text-xs text-text-secondary">
                {leg.bet.bestOdds}
              </span>
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {leg.bet.bestBook} • {leg.bet.edge.toFixed(1)}% edge
            </div>
          </div>
        ))}
      </div>

      {/* Payout example */}
      <div className="bg-bg-hover rounded-lg p-3 flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          ${parlay.examplePayout.wager} bet pays
        </span>
        <span className="font-mono text-lg font-bold text-accent-green">
          ${parlay.examplePayout.payout.toFixed(2)}
        </span>
      </div>

      {/* Reasoning */}
      <p className="text-xs text-text-secondary mt-3 leading-relaxed">
        {parlay.reasoning}
      </p>
    </div>
  );
}
