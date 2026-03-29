"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface BettingWindowTimerProps {
  commenceTime: string;
  compact?: boolean;
}

type WindowPhase =
  | "props_unavailable"
  | "optimal_window"
  | "final_reports"
  | "lock_bets"
  | "live";

function getPhase(commence: Date): {
  phase: WindowPhase;
  label: string;
  sublabel: string;
  color: string;
  pulse: boolean;
} {
  const now = new Date();
  const diff = commence.getTime() - now.getTime();
  const hoursUntil = diff / (1000 * 60 * 60);
  const minsUntil = diff / (1000 * 60);

  if (diff < 0) {
    const hoursElapsed = Math.abs(diff) / (1000 * 60 * 60);
    if (hoursElapsed < 4) {
      return {
        phase: "live",
        label: "LIVE",
        sublabel: "Live betting only",
        color: "text-accent-red",
        pulse: true,
      };
    }
    return {
      phase: "live",
      label: "FINAL",
      sublabel: "Game completed",
      color: "text-text-muted",
      pulse: false,
    };
  }

  if (minsUntil <= 30) {
    return {
      phase: "lock_bets",
      label: "LOCK BETS",
      sublabel: `${Math.ceil(minsUntil)}m to tip`,
      color: "text-accent-red",
      pulse: true,
    };
  }

  if (hoursUntil <= 1) {
    return {
      phase: "final_reports",
      label: "FINAL REPORTS",
      sublabel: `${Math.ceil(minsUntil)}m — injury reports finalizing`,
      color: "text-accent-amber",
      pulse: true,
    };
  }

  if (hoursUntil <= 8) {
    return {
      phase: "optimal_window",
      label: "PROPS OPEN",
      sublabel: `Optimal window — ${Math.floor(hoursUntil)}h ${Math.round(minsUntil % 60)}m to tip`,
      color: "text-accent-green",
      pulse: false,
    };
  }

  return {
    phase: "props_unavailable",
    label: "UPCOMING",
    sublabel: `Props not yet available — ${Math.floor(hoursUntil)}h until tip`,
    color: "text-text-muted",
    pulse: false,
  };
}

export function BettingWindowTimer({ commenceTime, compact }: BettingWindowTimerProps) {
  const [info, setInfo] = useState(() => getPhase(new Date(commenceTime)));

  useEffect(() => {
    const interval = setInterval(() => {
      setInfo(getPhase(new Date(commenceTime)));
    }, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, [commenceTime]);

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
          info.color
        )}
      >
        {info.pulse && (
          <span className={cn("w-1.5 h-1.5 rounded-full", info.phase === "live" ? "bg-accent-red" : info.phase === "lock_bets" ? "bg-accent-red" : "bg-accent-amber", "animate-pulse")} />
        )}
        {info.label}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
        info.phase === "live"
          ? "bg-accent-red/10 border border-accent-red/20"
          : info.phase === "lock_bets"
            ? "bg-accent-red/10 border border-accent-red/20"
            : info.phase === "final_reports"
              ? "bg-accent-amber/10 border border-accent-amber/20"
              : info.phase === "optimal_window"
                ? "bg-accent-green/10 border border-accent-green/20"
                : "bg-bg-hover border border-border-subtle"
      )}
    >
      {info.pulse && (
        <span
          className={cn(
            "w-2 h-2 rounded-full animate-pulse",
            info.phase === "live" || info.phase === "lock_bets"
              ? "bg-accent-red"
              : "bg-accent-amber"
          )}
        />
      )}
      <div>
        <span className={cn("font-bold uppercase tracking-wider", info.color)}>
          {info.label}
        </span>
        <span className="text-text-muted ml-2">{info.sublabel}</span>
      </div>
    </div>
  );
}
