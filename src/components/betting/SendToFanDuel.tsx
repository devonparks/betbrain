"use client";

import { cn } from "@/lib/utils";

interface SendToFanDuelProps {
  label?: string;
  compact?: boolean;
  className?: string;
}

/**
 * FanDuel deep link button.
 * The Odds API returns addToBetslip URLs when available — for now we link to
 * FanDuel's sportsbook home so the user can search for their bet.
 * When we have marketId + selectionId we'll construct the full deep link:
 * https://sportsbook.fanduel.com/addToBetslip?marketId=X&selectionId=Y
 */
export function SendToFanDuel({ label, compact, className }: SendToFanDuelProps) {
  const url = "https://sportsbook.fanduel.com/sports";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold transition-all",
        compact
          ? "text-[10px] px-2 py-1 rounded bg-[#1493FF]/10 text-[#1493FF] hover:bg-[#1493FF]/20 border border-[#1493FF]/20"
          : "text-xs px-3 py-2 rounded-lg bg-[#1493FF] text-white hover:bg-[#1493FF]/90",
        className
      )}
    >
      <svg className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
      {label ?? (compact ? "FanDuel" : "Send to FanDuel")}
    </a>
  );
}
