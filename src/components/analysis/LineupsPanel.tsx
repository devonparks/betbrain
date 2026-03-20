"use client";

import { ESPNGameData, ESPNPlayer } from "@/lib/stats-api";
import { cn } from "@/lib/utils";

interface LineupsPanelProps {
  gameData: ESPNGameData;
  onPlayerClick?: (player: ESPNPlayer) => void;
}

export function LineupsPanel({ gameData, onPlayerClick }: LineupsPanelProps) {
  const { homeTeam, awayTeam } = gameData;

  return (
    <div className="bg-bg-card border border-border-subtle rounded-card p-5">
      <h3 className="font-semibold text-sm mb-4">Starting Lineups & Injuries</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Away Team */}
        <TeamLineup
          team={awayTeam}
          label="Away"
          onPlayerClick={onPlayerClick}
        />

        {/* Home Team */}
        <TeamLineup
          team={homeTeam}
          label="Home"
          onPlayerClick={onPlayerClick}
        />
      </div>
    </div>
  );
}

function TeamLineup({
  team,
  label,
  onPlayerClick,
}: {
  team: ESPNGameData["homeTeam"];
  label: string;
  onPlayerClick?: (player: ESPNPlayer) => void;
}) {
  const starters = team.players.filter((p) => p.starter);
  const injuredPlayers = team.injuries.filter(
    (i) =>
      i.status.toLowerCase().includes("out") ||
      i.status.toLowerCase().includes("doubtful") ||
      i.status.toLowerCase().includes("questionable") ||
      i.status.toLowerCase().includes("day-to-day")
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-semibold text-sm">{team.name}</span>
          {team.record && (
            <span className="text-xs text-text-muted ml-2">({team.record})</span>
          )}
        </div>
        <span className="text-[10px] text-text-muted uppercase">{label}</span>
      </div>

      {/* Starters */}
      {starters.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-text-muted mb-1.5 uppercase">
            Starters
          </div>
          <div className="space-y-1">
            {starters.map((player) => (
              <button
                key={player.id}
                onClick={() => onPlayerClick?.(player)}
                className="w-full flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-hover transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-4 font-mono">
                    #{player.jersey}
                  </span>
                  <span className="text-sm font-medium">{player.name}</span>
                  {player.injuries && (
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded",
                        player.injuries.status.toLowerCase().includes("out")
                          ? "bg-accent-red/20 text-accent-red"
                          : "bg-accent-amber/20 text-accent-amber"
                      )}
                    >
                      {player.injuries.status}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-text-muted">
                  {player.position}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {starters.length === 0 && (
        <div className="text-xs text-text-muted py-3 text-center bg-bg-hover rounded-lg mb-3">
          Starters not yet confirmed
        </div>
      )}

      {/* Injuries */}
      {injuredPlayers.length > 0 && (
        <div>
          <div className="text-[10px] text-text-muted mb-1.5 uppercase">
            Injury Report
          </div>
          <div className="space-y-1">
            {injuredPlayers.map((injury, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 px-2 rounded bg-bg-hover"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{injury.player}</span>
                  <span className="text-[10px] text-text-muted">
                    {injury.position}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded",
                      injury.status.toLowerCase().includes("out")
                        ? "bg-accent-red/20 text-accent-red"
                        : injury.status.toLowerCase().includes("doubtful")
                          ? "bg-accent-red/10 text-accent-red"
                          : "bg-accent-amber/20 text-accent-amber"
                    )}
                  >
                    {injury.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
