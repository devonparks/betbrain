"use client";

import { GameAnalysis } from "@/lib/types";
import { ConfidenceMeter } from "./ConfidenceMeter";

interface AISummaryProps {
  analysis: GameAnalysis;
}

export function AISummary({ analysis }: AISummaryProps) {
  return (
    <div className="space-y-6">
      {/* Main Summary */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green" />
            AI Analysis
          </h3>
          <ConfidenceMeter confidence={analysis.confidence} size="md" />
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
          {analysis.summary}
        </p>
      </div>

      {/* Best Bet */}
      <div className="bg-bg-card border border-accent-green/30 rounded-card p-5">
        <h3 className="font-semibold text-sm text-accent-green mb-3">
          Best Bet
        </h3>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">{analysis.bestBet.pick}</span>
          <span className="font-mono text-accent-green font-bold">
            {analysis.bestBet.bestOdds}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-secondary mb-2">
          <span>Book: {analysis.bestBet.bestBook}</span>
          <span>Edge: {analysis.bestBet.edge.toFixed(1)}%</span>
          <ConfidenceMeter confidence={analysis.bestBet.confidence} size="sm" />
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          {analysis.bestBet.reasoning}
        </p>
      </div>

      {/* Value Bets */}
      {analysis.valueBets.length > 0 && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-5">
          <h3 className="font-semibold text-sm mb-3">Value Bets</h3>
          <div className="space-y-3">
            {analysis.valueBets.map((bet, i) => (
              <div
                key={i}
                className="flex items-start justify-between border-b border-border-subtle last:border-0 pb-3 last:pb-0"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{bet.pick}</span>
                    <span className="font-mono text-xs text-accent-green">
                      {bet.bestOdds}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">{bet.reasoning}</p>
                </div>
                <div className="ml-4 text-right">
                  <div className="text-xs text-text-muted">{bet.bestBook}</div>
                  <div className="font-mono text-xs text-accent-green">
                    +{bet.edge.toFixed(1)}% edge
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Factors */}
      {analysis.keyFactors.length > 0 && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-5">
          <h3 className="font-semibold text-sm mb-3">Key Factors</h3>
          <ul className="space-y-2">
            {analysis.keyFactors.map((factor, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-accent-blue mt-0.5">•</span>
                {factor}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trap Warnings */}
      {analysis.trapWarnings.length > 0 && (
        <div className="bg-bg-card border border-accent-red/30 rounded-card p-5">
          <h3 className="font-semibold text-sm text-accent-red mb-3">
            Trap Warnings
          </h3>
          <ul className="space-y-2">
            {analysis.trapWarnings.map((warning, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-accent-red mt-0.5">⚠</span>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
