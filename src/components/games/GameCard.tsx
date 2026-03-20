"use client";

import Link from "next/link";
import { GameCardData } from "@/lib/types";
import { formatOdds, formatGameTime, isGameLive } from "@/lib/utils";
import { ConfidenceMeter } from "../analysis/ConfidenceMeter";

interface GameCardProps {
  game: GameCardData;
}

function hasOdds(odds: number): boolean {
  return isFinite(odds) && odds !== 0;
}

export function GameCard({ game }: GameCardProps) {
  const live = isGameLive(game.commenceTime);

  return (
    <Link href={`/game/${game.id}?sport=${game.sportKey}`}>
      <div className="bg-bg-card border border-border-subtle rounded-card p-4 hover:border-border-hover transition-all group cursor-pointer">
        {/* Live badge or game time */}
        <div className="flex items-center justify-between mb-3">
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
          {game.aiConfidence > 0 && (
            <ConfidenceMeter confidence={game.aiConfidence} size="sm" />
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

        {/* Odds grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
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
              <div className="font-mono text-xs text-text-muted">—</div>
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
              <div className="font-mono text-xs text-text-muted">—</div>
            )}
          </div>
          {/* Moneyline */}
          <div className="bg-bg-hover rounded-lg p-2 text-center">
            <div className="text-[10px] text-text-muted mb-0.5">ML</div>
            {hasOdds(game.bestOdds.moneyline.home.odds) ? (
              <>
                <div className="font-mono text-xs font-medium">
                  {formatOdds(game.bestOdds.moneyline.home.odds)}
                </div>
                <div className="text-[10px] text-accent-green">
                  {game.bestOdds.moneyline.home.book}
                </div>
              </>
            ) : (
              <div className="font-mono text-xs text-text-muted">—</div>
            )}
          </div>
        </div>

        {/* AI quick take */}
        {game.aiQuickTake && (
          <p className="text-xs text-text-secondary leading-relaxed border-t border-border-subtle pt-2">
            {game.aiQuickTake}
          </p>
        )}

        {/* View analysis link */}
        <div className="mt-2 text-xs text-accent-blue group-hover:text-accent-green transition-colors">
          View full analysis →
        </div>
      </div>
    </Link>
  );
}
