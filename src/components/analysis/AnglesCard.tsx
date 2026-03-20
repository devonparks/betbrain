"use client";

import { BettingAngle } from "@/lib/angles-engine";
import { cn } from "@/lib/utils";

interface AnglesCardProps {
  angles: BettingAngle[];
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  scoring_streak: { label: "STREAK", color: "bg-accent-green/20 text-accent-green" },
  matchup_history: { label: "MATCHUP", color: "bg-accent-blue/20 text-accent-blue" },
  home_away: { label: "HOME/AWAY", color: "bg-accent-amber/20 text-accent-amber" },
  revenge: { label: "REVENGE", color: "bg-accent-red/20 text-accent-red" },
  back_to_back: { label: "B2B", color: "bg-accent-amber/20 text-accent-amber" },
  rest_advantage: { label: "REST", color: "bg-accent-green/20 text-accent-green" },
  injury_cascade: { label: "INJURY", color: "bg-accent-red/20 text-accent-red" },
  trend: { label: "TREND", color: "bg-accent-blue/20 text-accent-blue" },
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "border-accent-green/30",
  medium: "border-accent-amber/30",
  low: "border-border-subtle",
};

export function AnglesCard({ angles }: AnglesCardProps) {
  if (angles.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card p-5">
      <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
        <span className="text-accent-amber">&#9889;</span>
        Betting Angles ({angles.length})
      </h3>
      <div className="space-y-3">
        {angles.map((angle, i) => {
          const typeInfo = TYPE_LABELS[angle.type] ?? {
            label: angle.type.toUpperCase(),
            color: "bg-bg-hover text-text-muted",
          };

          return (
            <div
              key={i}
              className={cn(
                "border rounded-lg p-3",
                CONFIDENCE_STYLES[angle.confidence]
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    typeInfo.color
                  )}
                >
                  {typeInfo.label}
                </span>
                <span className="font-medium text-sm flex-1">
                  {angle.title}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    angle.confidence === "high"
                      ? "text-accent-green"
                      : angle.confidence === "medium"
                        ? "text-accent-amber"
                        : "text-text-muted"
                  )}
                >
                  {angle.confidence.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                {angle.description}
              </p>
              {angle.suggestedBet && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] text-text-muted">Suggested:</span>
                  <span className="text-xs font-medium text-accent-green">
                    {angle.suggestedBet}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
