"use client";

import { ESPNPlayerGameLog } from "@/lib/stats-api";
import { cn } from "@/lib/utils";

interface PropLine {
  player: string;
  market: string; // "points", "rebounds", "assists"
  line: number;
  overOdds: number;
  underOdds: number;
  book: string;
}

interface PlayerPropsCardProps {
  props: PropLine[];
  playerLogs: Record<string, ESPNPlayerGameLog[]>; // keyed by player name
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function PlayerPropsCard({ props, playerLogs }: PlayerPropsCardProps) {
  if (props.length === 0) return null;

  // Group by player
  const byPlayer = new Map<string, PropLine[]>();
  for (const prop of props) {
    if (!byPlayer.has(prop.player)) byPlayer.set(prop.player, []);
    byPlayer.get(prop.player)!.push(prop);
  }

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card p-5">
      <h3 className="font-semibold text-sm mb-4">Player Props — Value Detection</h3>

      <div className="space-y-4">
        {Array.from(byPlayer.entries()).map(([player, playerProps]) => {
          const logs = playerLogs[player] ?? [];
          const last10 = logs.slice(0, 10);

          return (
            <div
              key={player}
              className="border border-border-subtle rounded-lg p-3"
            >
              <div className="font-medium text-sm mb-2">{player}</div>
              <div className="space-y-2">
                {playerProps.map((prop, i) => {
                  // Calculate how often they've gone over this line
                  const statKey =
                    prop.market === "points"
                      ? "points"
                      : prop.market === "rebounds"
                        ? "rebounds"
                        : "assists";
                  const overCount = last10.filter(
                    (g) => g[statKey as keyof ESPNPlayerGameLog] as number > prop.line
                  ).length;
                  const hitRate =
                    last10.length > 0 ? overCount / last10.length : 0;
                  const avg =
                    last10.length > 0
                      ? last10.reduce(
                          (s, g) =>
                            s +
                            (g[statKey as keyof ESPNPlayerGameLog] as number),
                          0
                        ) / last10.length
                      : 0;

                  const isValue = hitRate >= 0.7; // Over hits 70%+ of the time
                  const isFade = hitRate <= 0.3; // Under hits 70%+ of the time

                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center justify-between py-1.5 px-2 rounded",
                        isValue
                          ? "bg-accent-green/5 border border-accent-green/20"
                          : isFade
                            ? "bg-accent-red/5 border border-accent-red/20"
                            : "bg-bg-hover"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-text-muted capitalize w-16">
                          {prop.market}
                        </span>
                        <span className="font-mono text-sm font-semibold">
                          {prop.line}
                        </span>
                        <span className="font-mono text-[10px] text-text-secondary">
                          O {formatOdds(prop.overOdds)} / U{" "}
                          {formatOdds(prop.underOdds)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {last10.length > 0 && (
                          <div className="text-right">
                            <div
                              className={cn(
                                "font-mono text-xs font-bold",
                                isValue
                                  ? "text-accent-green"
                                  : isFade
                                    ? "text-accent-red"
                                    : "text-text-secondary"
                              )}
                            >
                              {overCount}/{last10.length} over
                            </div>
                            <div className="text-[10px] text-text-muted">
                              avg {avg.toFixed(1)} last {last10.length}
                            </div>
                          </div>
                        )}
                        {isValue && (
                          <span className="text-[10px] font-bold text-accent-green px-1.5 py-0.5 bg-accent-green/20 rounded">
                            VALUE
                          </span>
                        )}
                        {isFade && (
                          <span className="text-[10px] font-bold text-accent-red px-1.5 py-0.5 bg-accent-red/20 rounded">
                            FADE
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
