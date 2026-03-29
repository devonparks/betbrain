"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/stores/userStore";
import { useBlacklistStore } from "@/stores/blacklistStore";
import { useBetSlipStore } from "@/stores/betSlipStore";
import { OUPrediction, PredictionParlay } from "@/lib/prediction-engine";
import { BetRecommendation } from "@/lib/types";
import { cn, formatOdds } from "@/lib/utils";

type StatFilter = "all" | "points" | "rebounds" | "assists" | "threes";
type SortBy = "confidence" | "line" | "player";

export default function PredictionsPage() {
  const { selectedSport } = useUserStore();
  const { players: blacklist } = useBlacklistStore();
  const { addLeg } = useBetSlipStore();

  const [predictions, setPredictions] = useState<OUPrediction[]>([]);
  const [hailMary, setHailMary] = useState<PredictionParlay | null>(null);
  const [megaParlay, setMegaParlay] = useState<PredictionParlay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statFilter, setStatFilter] = useState<StatFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("confidence");
  const [selectedLegs, setSelectedLegs] = useState<Set<number>>(new Set());
  const [showHailMary, setShowHailMary] = useState(false);
  const [showMegaParlay, setShowMegaParlay] = useState(false);

  useEffect(() => {
    fetchPredictions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  async function fetchPredictions() {
    setLoading(true);
    setError(null);
    try {
      const blParam = blacklist.length > 0 ? `&blacklist=${blacklist.join(",")}` : "";
      const res = await fetch(`/api/predict-ou?sport=${selectedSport}${blParam}`);
      if (!res.ok) throw new Error("Failed to load predictions");
      const data = await res.json();
      setPredictions(data.predictions ?? []);
      setHailMary(data.hailMary ?? null);
      setMegaParlay(data.megaParlay ?? null);
    } catch {
      setError("Failed to generate predictions. Props may not be available yet.");
    } finally {
      setLoading(false);
    }
  }

  // Filter and sort
  const filtered = predictions
    .filter((p) => statFilter === "all" || p.stat === statFilter)
    .sort((a, b) => {
      if (sortBy === "confidence") return b.confidence - a.confidence;
      if (sortBy === "line") return b.line - a.line;
      return a.player.localeCompare(b.player);
    });

  const overCount = filtered.filter((p) => p.prediction === "OVER").length;
  const underCount = filtered.filter((p) => p.prediction === "UNDER").length;
  const avgConfidence = filtered.length > 0
    ? Math.round(filtered.reduce((s, p) => s + p.confidence, 0) / filtered.length)
    : 0;

  function toggleLeg(index: number) {
    setSelectedLegs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function addSelectedToSlip() {
    for (const idx of Array.from(selectedLegs)) {
      const p = filtered[idx];
      if (!p) continue;
      const odds = p.prediction === "OVER" ? p.overOdds : p.underOdds;
      const bet: BetRecommendation = {
        type: "player_prop",
        pick: `${p.player} ${p.prediction} ${p.line} ${p.stat}`,
        bestBook: p.book,
        bestOdds: formatOdds(odds),
        confidence: p.confidence,
        reasoning: p.reasoning,
        impliedProbability: 0,
        estimatedTrueProbability: p.confidence / 100,
        edge: 0,
      };
      addLeg(bet);
    }
    setSelectedLegs(new Set());
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">O/U Predictions</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Every player prop line analyzed with trend-backed predictions
          </p>
        </div>
        <button
          onClick={fetchPredictions}
          disabled={loading}
          className="px-4 py-2 bg-bg-card border border-border-subtle rounded-lg text-xs font-medium hover:border-accent-green transition-colors disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Stats summary bar */}
      {!loading && predictions.length > 0 && (
        <div className="flex items-center gap-4 mb-6 text-xs">
          <span className="text-text-muted">
            {predictions.length} props analyzed
          </span>
          <span className="text-accent-green font-mono">
            {overCount} OVER
          </span>
          <span className="text-accent-red font-mono">
            {underCount} UNDER
          </span>
          <span className="text-text-secondary">
            Avg confidence: <span className="font-mono font-bold">{avgConfidence}%</span>
          </span>
        </div>
      )}

      {/* Quick actions */}
      {!loading && predictions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setShowHailMary(!showHailMary)}
            className={cn(
              "px-4 py-2.5 rounded-lg text-sm font-semibold transition-all",
              showHailMary
                ? "bg-accent-amber text-bg-primary"
                : "bg-accent-amber/10 border border-accent-amber/30 text-accent-amber hover:bg-accent-amber/20"
            )}
          >
            Safe Hail Mary
          </button>
          <button
            onClick={() => setShowMegaParlay(!showMegaParlay)}
            className={cn(
              "px-4 py-2.5 rounded-lg text-sm font-semibold transition-all",
              showMegaParlay
                ? "bg-accent-green text-bg-primary"
                : "bg-accent-green/10 border border-accent-green/30 text-accent-green hover:bg-accent-green/20"
            )}
          >
            O/U Mega Parlay
          </button>
          {selectedLegs.size > 0 && (
            <button
              onClick={addSelectedToSlip}
              className="px-4 py-2.5 bg-accent-green text-bg-primary rounded-lg text-sm font-semibold"
            >
              Add {selectedLegs.size} to Slip
            </button>
          )}
        </div>
      )}

      {/* Safe Hail Mary card */}
      {showHailMary && hailMary && (
        <div className="bg-bg-card border border-accent-amber/30 rounded-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <span className="text-accent-amber">&#9889;</span>
              Safe Hail Mary Parlay
            </h3>
            <div className="text-right">
              <div className="font-mono text-accent-green font-bold text-lg">
                {hailMary.combinedOdds > 0 ? "+" : ""}{hailMary.combinedOdds}
              </div>
              <div className="text-[10px] text-text-muted">
                ${hailMary.payout.wager} wins ${hailMary.payout.payout.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {hailMary.legs.map((leg, i) => {
              const odds = leg.prediction === "OVER" ? leg.overOdds : leg.underOdds;
              const isSafe = leg.confidence >= 70;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between py-2 px-3 rounded-lg",
                    isSafe
                      ? "bg-bg-hover border border-border-subtle"
                      : "bg-accent-amber/5 border border-accent-amber/20"
                  )}
                >
                  <div>
                    <span className={cn("text-[10px] font-bold uppercase", isSafe ? "text-accent-green" : "text-accent-amber")}>
                      {isSafe ? "SAFE" : "HAIL MARY"}
                    </span>
                    <div className="text-sm font-medium">
                      {leg.player} {leg.prediction} {leg.line} {leg.stat}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs">{formatOdds(odds)}</div>
                    <div className="text-[10px] text-text-muted">{leg.confidence}% conf</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary mt-3 leading-relaxed">
            {hailMary.strategy}
          </p>
        </div>
      )}

      {/* Mega Parlay card */}
      {showMegaParlay && megaParlay && (
        <div className="bg-bg-card border border-accent-green/30 rounded-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <span className="text-accent-green">&#128640;</span>
              O/U Mega Parlay — {megaParlay.legs.length} legs
            </h3>
            <div className="text-right">
              <div className="font-mono text-accent-green font-bold text-lg">
                {megaParlay.combinedOdds > 0 ? "+" : ""}{megaParlay.combinedOdds.toLocaleString()}
              </div>
              <div className="text-[10px] text-text-muted">
                ${megaParlay.payout.wager} wins ${megaParlay.payout.payout.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {megaParlay.legs.map((leg, i) => {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-1.5 px-2.5 rounded bg-bg-hover text-xs"
                >
                  <span className="font-medium truncate mr-2">
                    <span className={cn("font-bold mr-1", leg.prediction === "OVER" ? "text-accent-green" : "text-accent-red")}>
                      {leg.prediction === "OVER" ? "O" : "U"}
                    </span>
                    {leg.player} {leg.line} {leg.stat}
                  </span>
                  <span className="font-mono text-text-secondary flex-shrink-0">
                    {leg.confidence}%
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-text-secondary mt-3">{megaParlay.strategy}</p>
        </div>
      )}

      {/* Filters */}
      {!loading && predictions.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-1">
            {(["all", "points", "rebounds", "assists", "threes"] as StatFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStatFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all capitalize",
                  statFilter === f
                    ? "bg-accent-green text-bg-primary"
                    : "bg-bg-card text-text-secondary border border-border-subtle hover:border-accent-green"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-bg-card border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-secondary ml-auto"
          >
            <option value="confidence">Sort: Confidence</option>
            <option value="line">Sort: Line</option>
            <option value="player">Sort: Player</option>
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4 mb-6">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          <div className="bg-bg-card border border-border-subtle rounded-card p-6 text-center">
            <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-text-secondary">
              Analyzing player props across all games...
            </p>
            <p className="text-xs text-text-muted mt-1">
              Pulling game logs, calculating trends, running predictions
            </p>
          </div>
        </div>
      )}

      {/* Predictions table */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map((pred, i) => {
            const odds = pred.prediction === "OVER" ? pred.overOdds : pred.underOdds;
            const isSelected = selectedLegs.has(i);
            const last5 = pred.last10.slice(0, 5);

            return (
              <button
                key={`${pred.player}-${pred.stat}-${pred.line}-${i}`}
                onClick={() => toggleLeg(i)}
                className={cn(
                  "w-full text-left bg-bg-card border rounded-lg p-3 transition-all hover:border-accent-green/50",
                  isSelected
                    ? "border-accent-green bg-accent-green/5"
                    : "border-border-subtle"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Left: Player + prediction */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          pred.prediction === "OVER"
                            ? "bg-accent-green/20 text-accent-green"
                            : "bg-accent-red/20 text-accent-red"
                        )}
                      >
                        {pred.prediction}
                      </span>
                      <span className="font-medium text-sm truncate">
                        {pred.player}
                      </span>
                      {pred.blowoutRisk && (
                        <span className="text-[10px] text-accent-amber font-bold">
                          BLOWOUT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span className="capitalize">{pred.stat}</span>
                      <span className="font-mono font-semibold text-text-primary">
                        {pred.line}
                      </span>
                      <span className="font-mono">{formatOdds(odds)}</span>
                      <span className="text-text-muted">@ {pred.book}</span>
                    </div>
                  </div>

                  {/* Middle: Last 5 mini chart */}
                  <div className="hidden sm:flex items-end gap-0.5 h-6">
                    {last5.map((val, j) => {
                      const isOver = val > pred.line;
                      const maxVal = Math.max(...last5, pred.line);
                      const height = maxVal > 0 ? (val / maxVal) * 24 : 12;
                      return (
                        <div
                          key={j}
                          className={cn(
                            "w-1.5 rounded-t-sm",
                            isOver ? "bg-accent-green" : "bg-accent-red/60"
                          )}
                          style={{ height: `${Math.max(4, height)}px` }}
                          title={`${val} ${pred.stat}`}
                        />
                      );
                    })}
                  </div>

                  {/* Right: Confidence + hit rate */}
                  <div className="text-right flex-shrink-0">
                    <div
                      className={cn(
                        "font-mono text-sm font-bold",
                        pred.confidence >= 75
                          ? "text-accent-green"
                          : pred.confidence >= 55
                            ? "text-accent-amber"
                            : "text-text-secondary"
                      )}
                    >
                      {pred.confidence}%
                    </div>
                    <div className="text-[10px] text-text-muted font-mono">
                      {pred.overCount}/{pred.last10.length} over
                    </div>
                    <div className="text-[10px] text-text-muted">
                      avg {pred.fullAvg.toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Reasoning (shown for high confidence) */}
                {pred.confidence >= 70 && (
                  <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">
                    {pred.reasoning}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-20">
          <h3 className="text-lg font-semibold mb-1">No Props Available</h3>
          <p className="text-sm text-text-muted">
            Player props typically become available 1-2 hours before game time.
          </p>
        </div>
      )}
    </div>
  );
}
