"use client";

import { useState, useEffect, useRef } from "react";
import { ESPNPlayerGameLog } from "@/lib/stats-api";
import { StatsPanel } from "@/components/analysis/StatsPanel";
import { cn } from "@/lib/utils";

// ===== TYPES =====

interface LeaderEntry {
  name: string;
  team: string;
  position: string;
  id: string;
  ppg: number;
  rpg: number;
  apg: number;
  threes: number;
  spg: number;
  bpg: number;
  last5: number[];
}

interface LeaderData {
  points: LeaderEntry[];
  rebounds: LeaderEntry[];
  assists: LeaderEntry[];
  threes: LeaderEntry[];
  steals: LeaderEntry[];
  blocks: LeaderEntry[];
}

interface PlayerResult {
  id: string;
  name: string;
  team: string;
  position: string;
  ppg: number;
  rpg: number;
  apg: number;
  threes: number;
  gameLogs: ESPNPlayerGameLog[];
}

interface StandingsTeam {
  name: string;
  abbreviation: string;
  wins: string;
  losses: string;
  winPct: string;
  gb: string;
  streak: string;
  ppg: string;
  oppPpg: string;
}

interface Conference {
  name: string;
  teams: StandingsTeam[];
}

// ===== HELPERS =====

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#E53935", "#8E24AA", "#1E88E5", "#00897B", "#F4511E", "#6D4C41", "#546E7A", "#D81B60"];
function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ===== COMPONENT =====

export default function StatsPage() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [playerResult, setPlayerResult] = useState<PlayerResult | null>(null);
  const [leaders, setLeaders] = useState<LeaderData | null>(null);
  const [loadingLeaders, setLoadingLeaders] = useState(true);
  const [standings, setStandings] = useState<Conference[]>([]);
  const [showStandings, setShowStandings] = useState(false);
  const [activeTab, setActiveTab] = useState<"leaders" | "standings">("leaders");
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Fetch league leaders on mount
  useEffect(() => {
    async function fetchLeaders() {
      try {
        const res = await fetch("/api/stats/player?leaders=true");
        if (res.ok) {
          setLeaders(await res.json());
        }
      } catch {
        // Best effort
      } finally {
        setLoadingLeaders(false);
      }
    }
    fetchLeaders();
  }, []);

  // Search with debounce
  function handleSearch(value: string) {
    setQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (value.length < 2) {
      setPlayerResult(null);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stats/player?search=${encodeURIComponent(value)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.results?.length > 0) {
            setPlayerResult(data.results[0]);
          } else {
            setPlayerResult(null);
          }
        }
      } catch {
        // Best effort
      } finally {
        setSearching(false);
      }
    }, 500);
  }

  // Fetch standings on demand
  async function fetchStandings() {
    if (standings.length > 0) {
      setShowStandings(!showStandings);
      return;
    }
    try {
      const res = await fetch("/api/stats/player?standings=true");
      if (res.ok) {
        const data = await res.json();
        setStandings(data.conferences ?? []);
        setShowStandings(true);
      }
    } catch {
      // Best effort
    }
  }

  const LEADER_CATEGORIES: { key: keyof LeaderData; label: string; stat: string }[] = [
    { key: "points", label: "Points", stat: "ppg" },
    { key: "rebounds", label: "Rebounds", stat: "rpg" },
    { key: "assists", label: "Assists", stat: "apg" },
    { key: "threes", label: "3-Pointers", stat: "threes" },
    { key: "steals", label: "Steals", stat: "spg" },
    { key: "blocks", label: "Blocks", stat: "bpg" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* ===== SEARCH BAR ===== */}
      <div className="mb-8">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search any player... Giannis, LeBron, Wemby"
            className="w-full bg-bg-card border-2 border-border-subtle rounded-2xl pl-12 pr-4 py-4 text-lg outline-none focus:border-accent-green transition-colors placeholder:text-text-muted"
          />
          {searching && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <p className="text-xs text-text-muted mt-2 ml-1">
          Search by player name to see their full stat profile and game log
        </p>
      </div>

      {/* ===== PLAYER RESULT ===== */}
      {playerResult && (
        <div className="mb-8">
          {/* Player header */}
          <div className="bg-bg-card border border-accent-green/30 rounded-card p-5 mb-4">
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
                style={{ backgroundColor: avatarColor(playerResult.name) }}
              >
                {getInitials(playerResult.name)}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold">{playerResult.name}</h2>
                <p className="text-sm text-text-muted">
                  {playerResult.team} · {playerResult.position}
                </p>
              </div>
            </div>

            {/* Season averages */}
            <div className="grid grid-cols-4 gap-4 mt-5">
              {[
                { label: "PPG", value: playerResult.ppg, color: "text-accent-green" },
                { label: "RPG", value: playerResult.rpg, color: "text-text-primary" },
                { label: "APG", value: playerResult.apg, color: "text-text-primary" },
                { label: "3PM", value: playerResult.threes, color: "text-text-primary" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className={cn("font-mono text-2xl font-bold", stat.color)}>
                    {stat.value.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Game log (reuse StatsPanel) */}
          <StatsPanel
            playerName={playerResult.name}
            gameLogs={playerResult.gameLogs}
          />
        </div>
      )}

      {/* ===== NO RESULT MESSAGE ===== */}
      {query.length >= 2 && !searching && !playerResult && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-6 text-center mb-8">
          <p className="text-sm text-text-muted">
            No player found for &quot;{query}&quot;. Try a different name.
          </p>
        </div>
      )}

      {/* ===== TABS: LEADERS / STANDINGS ===== */}
      {!playerResult && (
        <>
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab("leaders")}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                activeTab === "leaders"
                  ? "bg-accent-green text-bg-primary"
                  : "bg-bg-card text-text-secondary border border-border-subtle hover:border-accent-green"
              )}
            >
              League Leaders
            </button>
            <button
              onClick={() => {
                setActiveTab("standings");
                if (standings.length === 0) fetchStandings();
              }}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                activeTab === "standings"
                  ? "bg-accent-green text-bg-primary"
                  : "bg-bg-card text-text-secondary border border-border-subtle hover:border-accent-green"
              )}
            >
              Standings
            </button>
          </div>

          {/* ===== LEAGUE LEADERS ===== */}
          {activeTab === "leaders" && (
            <>
              {loadingLeaders ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="bg-bg-card border border-border-subtle rounded-card p-4 animate-pulse">
                      <div className="h-4 w-24 bg-bg-hover rounded mb-4" />
                      <div className="space-y-3">
                        {[...Array(3)].map((_, j) => (
                          <div key={j} className="h-3 w-full bg-bg-hover rounded" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : leaders ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {LEADER_CATEGORIES.map(({ key, label, stat }) => (
                    <div key={key} className="bg-bg-card border border-border-subtle rounded-card p-4">
                      <h3 className="font-semibold text-sm text-text-secondary mb-3 uppercase tracking-wider">
                        {label}
                      </h3>
                      <div className="space-y-2.5">
                        {(leaders[key] ?? []).map((player, i) => {
                          const value = player[stat as keyof LeaderEntry] as number;
                          return (
                            <button
                              key={player.id}
                              onClick={() => handleSearch(player.name)}
                              className="w-full flex items-center gap-3 py-1 hover:bg-bg-hover rounded-lg px-1 -mx-1 transition-colors text-left"
                            >
                              <span className={cn(
                                "font-mono text-sm font-bold w-5 text-center",
                                i === 0 ? "text-accent-green" : i < 3 ? "text-accent-amber" : "text-text-muted"
                              )}>
                                {i + 1}
                              </span>
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                                style={{ backgroundColor: avatarColor(player.name) }}
                              >
                                {getInitials(player.name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium truncate">{player.name}</div>
                                <div className="text-[10px] text-text-muted">{player.team}</div>
                              </div>
                              <span className={cn(
                                "font-mono text-sm font-bold",
                                i === 0 ? "text-accent-green" : "text-text-primary"
                              )}>
                                {value.toFixed(1)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
                  <p className="text-sm text-text-muted">Could not load league leaders</p>
                </div>
              )}
            </>
          )}

          {/* ===== STANDINGS ===== */}
          {activeTab === "standings" && (
            <div className="space-y-6">
              {standings.length === 0 ? (
                <div className="bg-bg-card border border-border-subtle rounded-card p-6 text-center">
                  <div className="w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-text-muted">Loading standings...</p>
                </div>
              ) : (
                standings.map((conf) => (
                  <div key={conf.name} className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-border-subtle">
                      <h3 className="font-semibold text-sm">{conf.name}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border-subtle text-text-muted">
                            <th className="text-left px-4 py-2 font-medium w-8">#</th>
                            <th className="text-left px-2 py-2 font-medium">Team</th>
                            <th className="text-center px-2 py-2 font-medium">W</th>
                            <th className="text-center px-2 py-2 font-medium">L</th>
                            <th className="text-center px-2 py-2 font-medium">PCT</th>
                            <th className="text-center px-2 py-2 font-medium">GB</th>
                            <th className="text-center px-2 py-2 font-medium">STRK</th>
                            <th className="text-center px-2 py-2 font-medium">PPG</th>
                            <th className="text-center px-2 py-2 font-medium">OPP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conf.teams.map((team, i) => (
                            <tr key={team.abbreviation} className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
                              <td className="px-4 py-2 font-mono text-text-muted">{i + 1}</td>
                              <td className="px-2 py-2 font-medium whitespace-nowrap">
                                <span className="font-mono text-text-muted mr-1.5">{team.abbreviation}</span>
                                <span className="hidden sm:inline">{team.name}</span>
                              </td>
                              <td className="px-2 py-2 text-center font-mono text-accent-green">{team.wins}</td>
                              <td className="px-2 py-2 text-center font-mono text-accent-red">{team.losses}</td>
                              <td className="px-2 py-2 text-center font-mono">{team.winPct}</td>
                              <td className="px-2 py-2 text-center font-mono text-text-muted">{team.gb}</td>
                              <td className={cn(
                                "px-2 py-2 text-center font-mono text-xs",
                                team.streak?.startsWith("W") ? "text-accent-green" : "text-accent-red"
                              )}>
                                {team.streak}
                              </td>
                              <td className="px-2 py-2 text-center font-mono">{team.ppg}</td>
                              <td className="px-2 py-2 text-center font-mono text-text-muted">{team.oppPpg}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
