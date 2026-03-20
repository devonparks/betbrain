"use client";

import { useState } from "react";
import { ESPNPlayerGameLog } from "@/lib/stats-api";
import { cn } from "@/lib/utils";

interface StatsPanelProps {
  playerName: string;
  gameLogs: ESPNPlayerGameLog[];
  opponentAbbr?: string;
}

export function StatsPanel({ playerName, gameLogs, opponentAbbr }: StatsPanelProps) {
  const [view, setView] = useState<"all" | "vs">("all");
  const [count, setCount] = useState(10);

  const displayLogs =
    view === "vs" && opponentAbbr
      ? gameLogs.filter((g) => g.opponent === opponentAbbr)
      : gameLogs.slice(0, count);

  const avgPts = displayLogs.length
    ? displayLogs.reduce((s, g) => s + g.points, 0) / displayLogs.length
    : 0;
  const avgReb = displayLogs.length
    ? displayLogs.reduce((s, g) => s + g.rebounds, 0) / displayLogs.length
    : 0;
  const avgAst = displayLogs.length
    ? displayLogs.reduce((s, g) => s + g.assists, 0) / displayLogs.length
    : 0;

  if (gameLogs.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
      <div className="p-4 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">{playerName} — Game Log</h3>
          <div className="flex gap-1">
            <button
              onClick={() => setView("all")}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-medium",
                view === "all"
                  ? "bg-accent-green text-bg-primary"
                  : "bg-bg-hover text-text-muted"
              )}
            >
              Last {count}
            </button>
            {opponentAbbr && (
              <button
                onClick={() => setView("vs")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium",
                  view === "vs"
                    ? "bg-accent-green text-bg-primary"
                    : "bg-bg-hover text-text-muted"
                )}
              >
                vs {opponentAbbr}
              </button>
            )}
          </div>
        </div>

        {/* Averages bar */}
        <div className="flex gap-4 text-center">
          <div>
            <div className="font-mono text-lg font-bold text-accent-green">
              {avgPts.toFixed(1)}
            </div>
            <div className="text-[10px] text-text-muted">PPG</div>
          </div>
          <div>
            <div className="font-mono text-lg font-bold">{avgReb.toFixed(1)}</div>
            <div className="text-[10px] text-text-muted">RPG</div>
          </div>
          <div>
            <div className="font-mono text-lg font-bold">{avgAst.toFixed(1)}</div>
            <div className="text-[10px] text-text-muted">APG</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-text-muted">
              {displayLogs.length} game{displayLogs.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Game log table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-subtle text-text-muted">
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-2 py-2 font-medium">OPP</th>
              <th className="text-center px-2 py-2 font-medium">RES</th>
              <th className="text-center px-2 py-2 font-medium">MIN</th>
              <th className="text-center px-2 py-2 font-medium text-accent-green">PTS</th>
              <th className="text-center px-2 py-2 font-medium">REB</th>
              <th className="text-center px-2 py-2 font-medium">AST</th>
              <th className="text-center px-2 py-2 font-medium">STL</th>
              <th className="text-center px-2 py-2 font-medium">BLK</th>
              <th className="text-center px-2 py-2 font-medium">FG</th>
              <th className="text-center px-2 py-2 font-medium">3PT</th>
              <th className="text-center px-2 py-2 font-medium">+/-</th>
            </tr>
          </thead>
          <tbody>
            {displayLogs.map((game, i) => (
              <tr
                key={i}
                className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
              >
                <td className="px-3 py-1.5 text-text-muted whitespace-nowrap">
                  {game.date
                    ? new Date(game.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "-"}
                </td>
                <td className="px-2 py-1.5 font-medium">{game.opponent}</td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-center font-medium",
                    game.result?.startsWith("W")
                      ? "text-accent-green"
                      : "text-accent-red"
                  )}
                >
                  {game.result?.charAt(0) ?? "-"}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text-secondary">
                  {game.minutes || "-"}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-center font-mono font-bold",
                    game.points >= 30
                      ? "text-accent-green"
                      : game.points >= 20
                        ? "text-text-primary"
                        : "text-text-secondary"
                  )}
                >
                  {game.points}
                </td>
                <td className="px-2 py-1.5 text-center font-mono">{game.rebounds}</td>
                <td className="px-2 py-1.5 text-center font-mono">{game.assists}</td>
                <td className="px-2 py-1.5 text-center font-mono text-text-muted">
                  {game.steals}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text-muted">
                  {game.blocks}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text-muted">
                  {game.fgm}-{game.fga}
                </td>
                <td className="px-2 py-1.5 text-center font-mono text-text-muted">
                  {game.fg3m}-{game.fg3a}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-center font-mono",
                    game.plusMinus > 0
                      ? "text-accent-green"
                      : game.plusMinus < 0
                        ? "text-accent-red"
                        : "text-text-muted"
                  )}
                >
                  {game.plusMinus > 0 ? "+" : ""}
                  {game.plusMinus}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show more */}
      {view === "all" && gameLogs.length > count && (
        <button
          onClick={() => setCount((c) => c + 10)}
          className="w-full py-2 text-xs text-accent-blue hover:text-accent-green transition-colors border-t border-border-subtle"
        >
          Show more games
        </button>
      )}
    </div>
  );
}
