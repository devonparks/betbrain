"use client";

import Link from "next/link";
import { GameCardData } from "@/lib/types";
import { formatOdds, formatGameTime, isGameLive, cn } from "@/lib/utils";

interface GameCardProps {
  game: GameCardData;
  injuries?: number; // number of players out
}

function hasOdds(odds: number): boolean {
  return isFinite(odds) && odds !== 0;
}

function confidenceColor(confidence: number): string {
  if (confidence > 65) return "bg-accent-green";
  if (confidence >= 40) return "bg-accent-amber";
  return "bg-accent-red";
}

export function GameCard({ game, injuries }: GameCardProps) {
  const live = isGameLive(game.commenceTime);

  return (
    <Link href={`/game/${game.id}?sport=${game.sportKey}`}>
      <div className="bg-bg-card border border-border-subtle rounded-card p-4 hover:border-border-hover transition-all group cursor-pointer">
        {/* Top row: time/live badge + injuries + confidence dot */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {live ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="text-xs text-text-muted">
                {formatGameTime(game.commenceTime)}
              </span>
            )}
            {injuries && injuries > 0 && (
              <span className="text-[10px] font-bold text-accent-red bg-accent-red/10 px-1.5 py-0.5 rounded">
                {injuries} OUT
              </span>
            )}
          </div>
          {game.aiConfidence > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-muted font-mono">{game.aiConfidence}%</span>
              <span className={cn("w-2 h-2 rounded-full", confidenceColor(game.aiConfidence))} />
            </div>
          )}
        </div>

        {/* Teams */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{game.awayTeam}</span>
              {game.awayRecord && (
                <span className="text-xs text-text-muted">{game.awayRecord}</span>
              )}
              {game.awayForm && (
                <span className="text-xs text-text-muted font-mono">
                  {game.awayForm.split("").map((c, i) => (
                    <span key={i} className={c === "W" ? "text-accent-green" : "text-accent-red"}>
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {live && game.awayScore !== undefined && (
              <span className="font-mono font-bold text-lg">{game.awayScore}</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{game.homeTeam}</span>
              {game.homeRecord && (
                <span className="text-xs text-text-muted">{game.homeRecord}</span>
              )}
              {game.homeForm && (
                <span className="text-xs text-text-muted font-mono">
                  {game.homeForm.split("").map((c, i) => (
                    <span key={i} className={c === "W" ? "text-accent-green" : "text-accent-red"}>
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {live && game.homeScore !== undefined && (
              <span className="font-mono font-bold text-lg">{game.homeScore}</span>
            )}
          </div>
        </div>

        {/* Odds grid: 2-column (spread + total) */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {/* Spread */}
          <div className="bg-bg-hover rounded-lg p-2 text-center">
            <div className="text-[10px] text-text-muted mb-0.5">SPREAD</div>
            {hasOdds(game.bestOdds.spread.home.odds) ? (
              <>
                <div className="font-mono text-xs font-medium">
                  {game.bestOdds.spread.home.point > 0 ? "+" : ""}
                  {game.bestOdds.spread.home.point}
                </div>
                <div className="font-mono text-[10px] text-text-secondary">
                  {formatOdds(game.bestOdds.spread.home.odds)}
                </div>
              </>
            ) : (
              <div className="font-mono text-xs text-text-muted">&mdash;</div>
            )}
          </div>
          {/* Total */}
          <div className="bg-bg-hover rounded-lg p-2 text-center">
            <div className="text-[10px] text-text-muted mb-0.5">TOTAL</div>
            {hasOdds(game.bestOdds.total.over.odds) ? (
              <>
                <div className="font-mono text-xs font-medium">
                  O/U {game.bestOdds.total.over.point}
                </div>
                <div className="font-mono text-[10px] text-text-secondary">
                  {formatOdds(game.bestOdds.total.over.odds)}
                </div>
              </>
            ) : (
              <div className="font-mono text-xs text-text-muted">&mdash;</div>
            )}
          </div>
        </div>

        {/* AI quick take */}
        {game.aiQuickTake && (
          <p className="text-xs text-accent-green leading-relaxed border-t border-border-subtle pt-2 mb-1">
            {game.aiQuickTake}
          </p>
        )}

        {/* View analysis link */}
        <div className="mt-2 text-xs text-accent-blue group-hover:text-accent-green transition-colors">
          View analysis &rarr;
        </div>
      </div>
    </Link>
  );
}
