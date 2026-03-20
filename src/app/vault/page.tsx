"use client";

import { useState, useEffect } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { VaultProp, LockBuster, detectLockBusters } from "@/lib/lock-buster";
import { ESPNPlayerGameLog } from "@/lib/stats-api";
import { cn } from "@/lib/utils";

const TIER_CONFIG: Record<
  VaultProp["tier"],
  { label: string; color: string; bg: string }
> = {
  lock: {
    label: "LOCK",
    color: "text-accent-green",
    bg: "bg-accent-green/20",
  },
  safe: { label: "SAFE", color: "text-accent-blue", bg: "bg-accent-blue/20" },
  coinflip: {
    label: "COIN FLIP",
    color: "text-accent-amber",
    bg: "bg-accent-amber/20",
  },
  risky: {
    label: "RISKY",
    color: "text-orange-400",
    bg: "bg-orange-400/20",
  },
  hailmary: {
    label: "HAIL MARY",
    color: "text-accent-red",
    bg: "bg-accent-red/20",
  },
};

const STAT_OPTIONS = [
  { value: "points", label: "Points" },
  { value: "rebounds", label: "Rebounds" },
  { value: "assists", label: "Assists" },
  { value: "steals", label: "Steals" },
  { value: "blocks", label: "Blocks" },
  { value: "fg3m", label: "3-Pointers" },
];

const RISK_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  high: { label: "HIGH RISK", color: "text-accent-red", bg: "bg-accent-red/20" },
  medium: {
    label: "MEDIUM RISK",
    color: "text-accent-amber",
    bg: "bg-accent-amber/20",
  },
  low: {
    label: "LOW RISK",
    color: "text-accent-green",
    bg: "bg-accent-green/20",
  },
};

export default function VaultPage() {
  const { props, addProp, removeProp } = useVaultStore();
  const [tab, setTab] = useState<"vault" | "busters">("vault");

  // Add prop form
  const [showAdd, setShowAdd] = useState(false);
  const [player, setPlayer] = useState("");
  const [stat, setStat] = useState<VaultProp["stat"]>("points");
  const [line, setLine] = useState("");
  const [direction, setDirection] = useState<"over" | "under">("over");
  const [note, setNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [addError, setAddError] = useState("");

  // Lock busters
  const [busters, setBusters] = useState<LockBuster[]>([]);
  const [loadingBusters, setLoadingBusters] = useState(false);

  // Load lock busters from today's games
  useEffect(() => {
    if (tab !== "busters") return;
    loadBusters();
  }, [tab]);

  async function loadBusters() {
    setLoadingBusters(true);
    try {
      // Fetch today's games research for key players
      const res = await fetch("/api/odds?sport=nba");
      const games = await res.json();

      const allBusters: LockBuster[] = [];

      // Get research for first 3 games to avoid too many API calls
      for (const game of games.slice(0, 3)) {
        try {
          const researchRes = await fetch(
            `/api/stats/game-research?homeTeam=${encodeURIComponent(game.home_team)}&awayTeam=${encodeURIComponent(game.away_team)}&sport=nba`
          );
          if (!researchRes.ok) continue;
          const data = await researchRes.json();

          if (data.playerLogs && data.gameData) {
            for (const [name, logs] of Object.entries(data.playerLogs)) {
              const playerBusters = detectLockBusters(
                name,
                logs as ESPNPlayerGameLog[],
                data.gameData
              );
              allBusters.push(...playerBusters);
            }
          }
        } catch {
          // Skip failed games
        }
      }

      setBusters(allBusters);
    } catch {
      // Failed to load
    } finally {
      setLoadingBusters(false);
    }
  }

  async function handleAddProp() {
    if (!player || !line) return;
    setSearching(true);
    setAddError("");

    try {
      // Get player game logs to calculate hit rate
      const res = await fetch("/api/odds?sport=nba");
      const games = await res.json();

      // Try to find the player in any game's research
      let playerLogs: ESPNPlayerGameLog[] = [];

      for (const game of games.slice(0, 5)) {
        const researchRes = await fetch(
          `/api/stats/game-research?homeTeam=${encodeURIComponent(game.home_team)}&awayTeam=${encodeURIComponent(game.away_team)}&sport=nba`
        );
        if (!researchRes.ok) continue;
        const data = await researchRes.json();

        if (data.playerLogs?.[player]) {
          playerLogs = data.playerLogs[player];
          break;
        }
      }

      if (playerLogs.length === 0) {
        setAddError(
          "Could not find game logs for this player. Make sure the name matches exactly (e.g., 'Nikola Jokic')."
        );
        setSearching(false);
        return;
      }

      addProp(
        {
          player,
          stat,
          line: parseFloat(line),
          direction,
          note: note || undefined,
        },
        playerLogs
      );

      // Reset form
      setPlayer("");
      setLine("");
      setNote("");
      setShowAdd(false);
    } catch {
      setAddError("Failed to fetch player data. Try again.");
    } finally {
      setSearching(false);
    }
  }

  // Group vault props by tier
  const tiers: VaultProp["tier"][] = [
    "lock",
    "safe",
    "coinflip",
    "risky",
    "hailmary",
  ];
  const propsByTier = tiers.map((tier) => ({
    tier,
    props: props.filter((p) => p.tier === tier),
  }));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Prop Vault</h1>
        <p className="text-sm text-text-muted mt-1">
          Save stat lines, track hit rates, and find locks that could bust
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("vault")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            tab === "vault"
              ? "bg-accent-green text-bg-primary"
              : "bg-bg-card text-text-secondary border border-border-subtle"
          )}
        >
          My Props ({props.length})
        </button>
        <button
          onClick={() => setTab("busters")}
          className={cn(
            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
            tab === "busters"
              ? "bg-accent-red text-white"
              : "bg-bg-card text-text-secondary border border-border-subtle"
          )}
        >
          Lock Busters
        </button>
      </div>

      {/* Vault Tab */}
      {tab === "vault" && (
        <div className="space-y-4">
          {/* Add Prop Button */}
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="w-full bg-bg-card border border-border-subtle border-dashed rounded-card py-4 text-sm text-text-muted hover:border-accent-green hover:text-accent-green transition-colors"
            >
              + Add a Prop
            </button>
          )}

          {/* Add Prop Form */}
          {showAdd && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Add Prop to Vault</h3>
                <button
                  onClick={() => setShowAdd(false)}
                  className="text-xs text-text-muted hover:text-accent-red"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] text-text-muted uppercase mb-1 block">
                    Player Name
                  </label>
                  <input
                    value={player}
                    onChange={(e) => setPlayer(e.target.value)}
                    placeholder="e.g. Nikola Jokic"
                    className="w-full bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-text-muted uppercase mb-1 block">
                    Stat
                  </label>
                  <select
                    value={stat}
                    onChange={(e) =>
                      setStat(e.target.value as VaultProp["stat"])
                    }
                    className="w-full bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green"
                  >
                    {STAT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-text-muted uppercase mb-1 block">
                    Line
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={line}
                      onChange={(e) => setLine(e.target.value)}
                      type="number"
                      step="0.5"
                      placeholder="25.5"
                      className="flex-1 bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green"
                    />
                    <select
                      value={direction}
                      onChange={(e) =>
                        setDirection(e.target.value as "over" | "under")
                      }
                      className="bg-bg-hover border border-border-subtle rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-accent-green"
                    >
                      <option value="over">Over</option>
                      <option value="under">Under</option>
                    </select>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="text-[10px] text-text-muted uppercase mb-1 block">
                    Note (optional)
                  </label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Always goes off vs Cavs"
                    className="w-full bg-bg-hover border border-border-subtle rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-green"
                  />
                </div>
              </div>

              {addError && (
                <p className="text-xs text-accent-red">{addError}</p>
              )}

              <button
                onClick={handleAddProp}
                disabled={searching || !player || !line}
                className="w-full bg-accent-green text-bg-primary rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searching ? "Analyzing..." : "Add to Vault"}
              </button>
            </div>
          )}

          {/* Tier List */}
          {props.length === 0 && !showAdd && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
              <p className="text-sm text-text-muted">
                No props saved yet. Add a prop to start building your vault.
              </p>
            </div>
          )}

          {propsByTier
            .filter((t) => t.props.length > 0)
            .map(({ tier, props: tierProps }) => {
              const config = TIER_CONFIG[tier];
              return (
                <div key={tier}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded",
                        config.bg,
                        config.color
                      )}
                    >
                      {config.label}
                    </span>
                    <span className="text-xs text-text-muted">
                      {tierProps.length} prop
                      {tierProps.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {tierProps.map((prop) => (
                      <div
                        key={prop.id}
                        className="bg-bg-card border border-border-subtle rounded-lg p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {prop.player}
                            </span>
                            <span className="font-mono text-sm text-text-secondary">
                              {prop.direction === "over" ? "O" : "U"}{" "}
                              {prop.line}{" "}
                              {STAT_OPTIONS.find((s) => s.value === prop.stat)
                                ?.label ?? prop.stat}
                            </span>
                          </div>
                          {prop.note && (
                            <p className="text-[10px] text-text-muted mt-0.5">
                              {prop.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div
                              className={cn(
                                "font-mono text-sm font-bold",
                                config.color
                              )}
                            >
                              {(prop.hitRate * 100).toFixed(0)}%
                            </div>
                            <div className="text-[10px] text-text-muted">
                              avg {prop.avg.toFixed(1)} / L{prop.lastN}
                            </div>
                          </div>
                          <button
                            onClick={() => removeProp(prop.id)}
                            className="text-text-muted hover:text-accent-red text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Lock Busters Tab */}
      {tab === "busters" && (
        <div className="space-y-4">
          <div className="bg-bg-card border border-accent-red/20 rounded-card p-4">
            <h3 className="font-semibold text-sm mb-1">
              Locks Most Likely to Bust
            </h3>
            <p className="text-xs text-text-muted">
              Props that look like automatic hits but have hidden risk factors.
              These are the &quot;sure things&quot; that could burn you.
            </p>
          </div>

          {loadingBusters && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
              <div className="w-8 h-8 border-2 border-accent-red border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-text-secondary">
                Analyzing today&apos;s &quot;locks&quot; for bust potential...
              </p>
            </div>
          )}

          {!loadingBusters && busters.length === 0 && (
            <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
              <p className="text-sm text-text-muted">
                No lock busters detected for today&apos;s games. Either the
                data isn&apos;t available yet or today&apos;s locks look solid.
              </p>
              <button
                onClick={loadBusters}
                className="mt-3 text-xs text-accent-blue hover:underline"
              >
                Refresh
              </button>
            </div>
          )}

          {busters.map((buster, i) => {
            const risk = RISK_CONFIG[buster.riskLevel];
            return (
              <div
                key={i}
                className="bg-bg-card border border-border-subtle rounded-card p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {buster.player}
                    </span>
                    <span className="font-mono text-sm text-text-secondary">
                      O {buster.line} {buster.stat}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded",
                      risk.bg,
                      risk.color
                    )}
                  >
                    {risk.label}
                  </span>
                </div>

                <div className="flex items-center gap-4 mb-3 text-xs">
                  <span className="text-text-muted">
                    Hit rate:{" "}
                    <span className="font-mono text-accent-green font-bold">
                      {(buster.hitRate * 100).toFixed(0)}%
                    </span>
                  </span>
                  <span className="text-text-muted">
                    Avg:{" "}
                    <span className="font-mono">
                      {buster.avgStat.toFixed(1)}
                    </span>
                  </span>
                  <span className="text-text-muted">
                    Min:{" "}
                    <span className="font-mono">{buster.minStat}</span>
                  </span>
                  <span className="text-text-muted">
                    Busted:{" "}
                    <span className="font-mono text-accent-red">
                      {buster.gamesUnder}/{buster.totalGames}
                    </span>
                  </span>
                </div>

                <div className="space-y-1.5 mb-3">
                  {buster.bustFactors.map((factor, j) => (
                    <div
                      key={j}
                      className="flex items-start gap-2 text-xs text-text-secondary"
                    >
                      <span className="text-accent-red mt-0.5">!</span>
                      <span>{factor}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-bg-hover rounded-lg px-3 py-2">
                  <p className="text-xs text-text-secondary">
                    {buster.verdict}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
