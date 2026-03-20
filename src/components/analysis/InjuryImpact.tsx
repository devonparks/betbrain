"use client";

import { InjuryRipple } from "@/lib/types";

interface InjuryImpactProps {
  injuries: InjuryRipple[];
}

export function InjuryImpact({ injuries }: InjuryImpactProps) {
  if (injuries.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card p-5">
      <h3 className="font-semibold text-sm mb-4">Injury Ripple Effects</h3>
      <div className="space-y-4">
        {injuries.map((injury, i) => (
          <div key={i} className="border-b border-border-subtle last:border-0 pb-4 last:pb-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-sm">{injury.injuredPlayer}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                injury.status.toLowerCase().includes("out")
                  ? "bg-accent-red/20 text-accent-red"
                  : injury.status.toLowerCase().includes("doubtful")
                    ? "bg-accent-amber/20 text-accent-amber"
                    : "bg-accent-amber/10 text-accent-amber"
              }`}>
                {injury.status}
              </span>
            </div>
            <p className="text-sm text-text-secondary mb-2">{injury.directImpact}</p>
            <div className="ml-4 space-y-1">
              {injury.rippleEffects.map((effect, j) => (
                <div key={j} className="flex items-start gap-2 text-xs text-text-muted">
                  <span className="text-accent-blue">→</span>
                  {effect}
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs font-medium text-accent-green">
              {injury.bettingImplication}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
