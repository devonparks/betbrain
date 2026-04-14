"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { StatsPanel } from "@/components/analysis/StatsPanel";
import { ESPNPlayerGameLog } from "@/lib/stats-api";

// ===== TYPES =====

interface StatItem {
  label: string;
  value: string;
}

interface GameLogEntry {
  date: string;
  opp: string;
  pts: number;
  reb: number;
  ast: number;
  result: string;
}

interface AskResponse {
  type: "player_stats" | "comparison" | "leaders" | "general";
  headline: string;
  answer: string;
  stats: StatItem[];
  gamelog: GameLogEntry[];
  player?: { name: string; team: string; position: string; id: string } | null;
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

// ===== SUGGESTED QUERIES =====

const SUGGESTIONS = [
  "LeBron James this season",
  "Giannis last 10 games",
  "Who leads the NBA in scoring?",
  "Jokic stats this month",
  "Trae Young vs Celtics",
  "Wemby blocks per game",
  "Steph Curry 3-pointers this season",
  "Shai Gilgeous-Alexander averages",
];

// ===== TRENDING PLAYERS =====

const TRENDING = [
  { name: "Victor Wembanyama", team: "SA", color: "#000000", textColor: "#ffffff", query: "Wembanyama this season" },
  { name: "Nikola Jokic", team: "DEN", color: "#FFC72C", textColor: "#0C2340", query: "Jokic this season" },
  { name: "Shai Gilgeous-Alexander", team: "OKC", color: "#007AC1", textColor: "#ffffff", query: "SGA this season" },
  { name: "Jayson Tatum", team: "BOS", color: "#007A33", textColor: "#ffffff", query: "Tatum this season" },
  { name: "Anthony Edwards", team: "MIN", color: "#0C2340", textColor: "#78BE20", query: "Anthony Edwards this season" },
  { name: "Luka Doncic", team: "LAL", color: "#552583", textColor: "#FDB927", query: "Luka this season" },
];

// ===== COMPONENT =====

export default function StatsPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [fullGameLogs, setFullGameLogs] = useState<ESPNPlayerGameLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ query: string; result: AskResponse }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleAsk(q?: string) {
    const searchQuery = q ?? query.trim();
    if (!searchQuery || loading) return;

    setQuery(searchQuery);
    setLoading(true);
    setError(null);
    setFullGameLogs(null);

    try {
      const res = await fetch(`/api/stats/ask?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error("Failed");
      const data: AskResponse = await res.json();
      setResult(data);

      // Save to history
      setHistory((prev) => [{ query: searchQuery, result: data }, ...prev.slice(0, 9)]);

      // If we got a player, fetch their full game logs for the detail view
      if (data.player?.id) {
        try {
          const logsRes = await fetch(`/api/stats/player?playerId=${data.player.id}`);
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            setFullGameLogs(logsData.gameLogs ?? null);
          }
        } catch { /* optional */ }
      }
    } catch {
      setError("Could not process your question. Try rephrasing.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAsk();
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ===== SEARCH BAR ===== */}
      <div className="mb-6">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... LeBron last 10 games, who leads in 3PM"
            className="w-full bg-bg-card border-2 border-border-subtle rounded-2xl pl-12 pr-24 py-4 text-lg outline-none focus:border-accent-green transition-colors placeholder:text-text-muted"
          />
          <button
            onClick={() => handleAsk()}
            disabled={!query.trim() || loading}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
              query.trim() && !loading
                ? "bg-accent-green text-bg-primary"
                : "bg-bg-hover text-text-muted"
            )}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-bg-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              "Ask"
            )}
          </button>
        </div>
      </div>

      {/* ===== LOADING STATE ===== */}
      {loading && (
        <div className="bg-bg-card border border-accent-green/30 rounded-card p-8 text-center mb-6">
          <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-text-secondary">Looking up stats...</p>
        </div>
      )}

      {/* ===== ERROR ===== */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4 mb-6">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      {/* ===== RESULT CARD ===== */}
      {result && !loading && (
        <div className="mb-8 space-y-4">
          {/* Headline card */}
          <div className={cn(
            "rounded-card p-5 border",
            result.player
              ? "bg-bg-card border-accent-green/30"
              : "bg-bg-card border-border-subtle"
          )}>
            {/* Player header */}
            {result.player && (
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: avatarColor(result.player.name) }}
                >
                  {getInitials(result.player.name)}
                </div>
                <div>
                  <h2 className="text-lg font-bold">{result.player.name}</h2>
                  <p className="text-xs text-text-muted">
                    {result.player.team} · {result.player.position}
                  </p>
                </div>
              </div>
            )}

            {/* Headline */}
            {!result.player && (
              <h2 className="text-lg font-bold mb-3">{result.headline}</h2>
            )}

            {/* Stats grid */}
            {result.stats.length > 0 && (
              <div className={cn(
                "grid gap-4 mb-4",
                result.stats.length <= 3 ? "grid-cols-3" : "grid-cols-4"
              )}>
                {result.stats.map((stat, i) => (
                  <div key={i} className="text-center">
                    <div className={cn(
                      "font-mono text-2xl font-bold",
                      i === 0 ? "text-accent-green" : "text-text-primary"
                    )}>
                      {stat.value}
                    </div>
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Answer text */}
            <p className="text-sm text-text-secondary leading-relaxed">
              {result.answer}
            </p>
          </div>

          {/* Mini game log from AI response */}
          {result.gamelog && result.gamelog.length > 0 && (
            <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border-subtle">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Recent Games</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-subtle text-text-muted">
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-2 py-2 font-medium">OPP</th>
                      <th className="text-center px-2 py-2 font-medium">RES</th>
                      <th className="text-center px-2 py-2 font-medium text-accent-green">PTS</th>
                      <th className="text-center px-2 py-2 font-medium">REB</th>
                      <th className="text-center px-2 py-2 font-medium">AST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.gamelog.map((g, i) => (
                      <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
                        <td className="px-3 py-1.5 text-text-muted">{g.date}</td>
                        <td className="px-2 py-1.5 font-medium">{g.opp}</td>
                        <td className={cn(
                          "px-2 py-1.5 text-center font-medium",
                          g.result?.startsWith("W") ? "text-accent-green" : "text-accent-red"
                        )}>
                          {g.result?.charAt(0) ?? "-"}
                        </td>
                        <td className={cn(
                          "px-2 py-1.5 text-center font-mono font-bold",
                          g.pts >= 30 ? "text-accent-green" : g.pts >= 20 ? "text-text-primary" : "text-text-secondary"
                        )}>
                          {g.pts}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono">{g.reb}</td>
                        <td className="px-2 py-1.5 text-center font-mono">{g.ast}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Full game log (from ESPN, after AI response loads) */}
          {fullGameLogs && fullGameLogs.length > 0 && result.player && (
            <StatsPanel
              playerName={result.player.name}
              gameLogs={fullGameLogs}
            />
          )}
        </div>
      )}

      {/* ===== DEFAULT VIEW (no result) ===== */}
      {!result && !loading && (
        <>
          {/* Trending players */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
              Trending Players
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TRENDING.map((player) => (
                <button
                  key={player.name}
                  onClick={() => {
                    setQuery(player.query);
                    handleAsk(player.query);
                  }}
                  className="relative rounded-2xl px-3 py-4 overflow-hidden text-left transition-all hover:brightness-90 active:scale-[0.98]"
                  style={{ backgroundColor: player.color, color: player.textColor }}
                >
                  <div className="font-bold text-sm leading-tight">{player.name}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{player.team}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Suggested queries */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
              Try asking
            </h2>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuery(s);
                    handleAsk(s);
                  }}
                  className="px-3 py-2 bg-bg-card border border-border-subtle rounded-full text-xs text-text-secondary hover:border-accent-green hover:text-accent-green transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Search history */}
          {history.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wider">
                Recent Searches
              </h2>
              <div className="space-y-2">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(h.query);
                      setResult(h.result);
                    }}
                    className="w-full text-left bg-bg-card border border-border-subtle rounded-lg px-4 py-3 hover:border-accent-green/30 transition-colors"
                  >
                    <div className="text-sm font-medium">{h.query}</div>
                    <div className="text-xs text-text-muted mt-0.5 truncate">
                      {h.result.answer?.slice(0, 80)}...
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
