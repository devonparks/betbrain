"use client";

import { useState, useEffect, useMemo } from "react";
import { useUserStore } from "@/stores/userStore";
import { useBlacklistStore } from "@/stores/blacklistStore";
import { useBetSlipStore } from "@/stores/betSlipStore";
import { OUPrediction, PredictionParlay } from "@/lib/prediction-engine";
import { BetRecommendation } from "@/lib/types";
import { cn, formatOdds } from "@/lib/utils";
import { SendToFanDuel } from "@/components/betting/SendToFanDuel";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StatFilter = "all" | "points" | "rebounds" | "assists" | "threes";
type SortBy = "confidence" | "line" | "player";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** First letter of first name + first letter of last name */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic pastel-ish color from a string */
function avatarColor(name: string): string {
  const colors = [
    "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
    "#f43f5e", "#ef4444", "#f97316", "#eab308", "#84cc16",
    "#22c55e", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/** Confidence bar color */
function confColor(c: number): string {
  if (c >= 65) return "#00E676";
  if (c >= 40) return "#FFD600";
  return "#FF5252";
}

/* ------------------------------------------------------------------ */
/*  Sample data for empty state                                        */
/* ------------------------------------------------------------------ */

const SAMPLE_ROWS: OUPrediction[] = [
  {
    player: "Jayson Tatum", team: "BOS", stat: "points", line: 27.5,
    prediction: "OVER", confidence: 78, reasoning: "",
    last10: [31, 27, 33, 22, 29, 26, 35, 28, 24, 30],
    overCount: 7, underCount: 3, trendDirection: "up",
    recentAvg: 30.3, fullAvg: 28.5,
    homeAwaySplit: { home: 29.2, away: 27.8 },
    overOdds: -115, underOdds: -105, book: "FanDuel",
    injuryContext: null, blowoutRisk: false,
  },
  {
    player: "Luka Doncic", team: "DAL", stat: "assists", line: 8.5,
    prediction: "OVER", confidence: 72, reasoning: "",
    last10: [9, 11, 7, 8, 10, 9, 12, 8, 7, 10],
    overCount: 6, underCount: 4, trendDirection: "stable",
    recentAvg: 9.0, fullAvg: 9.1,
    homeAwaySplit: { home: 9.4, away: 8.8 },
    overOdds: -110, underOdds: -110, book: "FanDuel",
    injuryContext: null, blowoutRisk: false,
  },
  {
    player: "Anthony Edwards", team: "MIN", stat: "threes", line: 2.5,
    prediction: "UNDER", confidence: 64, reasoning: "",
    last10: [2, 3, 1, 4, 2, 1, 3, 2, 0, 3],
    overCount: 4, underCount: 6, trendDirection: "down",
    recentAvg: 2.0, fullAvg: 2.1,
    homeAwaySplit: { home: 2.3, away: 1.9 },
    overOdds: -105, underOdds: -115, book: "FanDuel",
    injuryContext: null, blowoutRisk: false,
  },
  {
    player: "Nikola Jokic", team: "DEN", stat: "rebounds", line: 12.5,
    prediction: "OVER", confidence: 81, reasoning: "",
    last10: [14, 11, 15, 13, 12, 16, 10, 14, 13, 15],
    overCount: 7, underCount: 3, trendDirection: "up",
    recentAvg: 13.3, fullAvg: 13.3,
    homeAwaySplit: { home: 13.8, away: 12.8 },
    overOdds: -120, underOdds: +100, book: "FanDuel",
    injuryContext: null, blowoutRisk: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Prediction Row (shared between real + sample)                      */
/* ------------------------------------------------------------------ */

function PredictionRow({
  pred,
  isSample,
  onAddToParlay,
}: {
  pred: OUPrediction;
  isSample?: boolean;
  onAddToParlay?: () => void;
}) {
  const initials = getInitials(pred.player);
  const bgCol = avatarColor(pred.player);
  const last5 = pred.last10.slice(0, 5);
  const isOver = pred.prediction === "OVER";

  return (
    <div
      className={cn(
        "bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3 transition-all",
        !isSample && "hover:border-[#00E676]/40 hover:bg-[rgba(255,255,255,0.05)]",
        isSample && "opacity-50 pointer-events-none select-none"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ backgroundColor: bgCol }}
        >
          {initials}
        </div>

        {/* Player + team + stat line */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">
              {pred.player}
            </span>
            <span className="text-[10px] font-mono text-[rgba(255,255,255,0.4)] uppercase">
              {pred.team}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[rgba(255,255,255,0.5)] capitalize">
              {pred.stat}
            </span>
            <span className="font-mono text-xs font-bold text-white">
              {pred.line}
            </span>
          </div>
        </div>

        {/* Prediction badge */}
        <div
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wide flex-shrink-0",
            isOver
              ? "bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/20"
              : "bg-[#FF5252]/15 text-[#FF5252] border border-[#FF5252]/20"
          )}
        >
          {pred.prediction}
        </div>

        {/* Confidence bar */}
        <div className="hidden sm:flex flex-col items-end gap-0.5 w-24 flex-shrink-0">
          <span
            className="font-mono text-xs font-bold"
            style={{ color: confColor(pred.confidence) }}
          >
            {pred.confidence}%
          </span>
          <div className="w-full h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pred.confidence}%`,
                backgroundColor: confColor(pred.confidence),
              }}
            />
          </div>
        </div>

        {/* Last 5 games */}
        <div className="hidden md:flex items-center gap-1 flex-shrink-0">
          {last5.map((val, j) => (
            <span
              key={j}
              className={cn(
                "font-mono text-[10px] w-6 text-center rounded py-0.5",
                val > pred.line
                  ? "text-[#00E676] bg-[#00E676]/10"
                  : "text-[#FF5252] bg-[#FF5252]/10"
              )}
            >
              {val}
            </span>
          ))}
        </div>

        {/* Actions */}
        {!isSample && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAddToParlay?.();
              }}
              className="text-[10px] font-semibold px-2 py-1 rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.6)] hover:border-[#00E676]/40 hover:text-[#00E676] transition-all"
            >
              + Parlay
            </button>
            <SendToFanDuel compact />
          </div>
        )}
      </div>

      {/* Mobile confidence (visible on small screens) */}
      <div className="flex sm:hidden items-center gap-2 mt-2">
        <div className="flex-1 h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pred.confidence}%`,
              backgroundColor: confColor(pred.confidence),
            }}
          />
        </div>
        <span
          className="font-mono text-[10px] font-bold"
          style={{ color: confColor(pred.confidence) }}
        >
          {pred.confidence}%
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

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
  const [showHailMary, setShowHailMary] = useState(false);
  const [showMegaParlay, setShowMegaParlay] = useState(false);

  /* ---- Fetch ---- */

  useEffect(() => {
    fetchPredictions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport]);

  async function fetchPredictions() {
    setLoading(true);
    setError(null);
    try {
      const blParam =
        blacklist.length > 0 ? `&blacklist=${blacklist.join(",")}` : "";
      const res = await fetch(
        `/api/predict-ou?sport=${selectedSport}${blParam}`
      );
      if (!res.ok) throw new Error("Failed to load predictions");
      const data = await res.json();
      setPredictions(data.predictions ?? []);
      setHailMary(data.hailMary ?? null);
      setMegaParlay(data.megaParlay ?? null);
    } catch {
      setError(
        "Failed to generate predictions. Props may not be available yet."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ---- Filter + Sort ---- */

  const filtered = useMemo(() => {
    return predictions
      .filter((p) => statFilter === "all" || p.stat === statFilter)
      .sort((a, b) => {
        if (sortBy === "confidence") return b.confidence - a.confidence;
        if (sortBy === "line") return b.line - a.line;
        return a.player.localeCompare(b.player);
      });
  }, [predictions, statFilter, sortBy]);

  const overCount = filtered.filter((p) => p.prediction === "OVER").length;
  const underCount = filtered.filter((p) => p.prediction === "UNDER").length;
  const avgConfidence =
    filtered.length > 0
      ? Math.round(
          filtered.reduce((s, p) => s + p.confidence, 0) / filtered.length
        )
      : 0;

  const hasPredictions = !loading && predictions.length > 0;
  const isEmpty = !loading && predictions.length === 0 && !error;

  /* ---- Add single prediction to parlay ---- */

  function handleAddToParlay(pred: OUPrediction) {
    const odds =
      pred.prediction === "OVER" ? pred.overOdds : pred.underOdds;
    const bet: BetRecommendation = {
      type: "player_prop",
      pick: `${pred.player} ${pred.prediction} ${pred.line} ${pred.stat}`,
      bestBook: pred.book,
      bestOdds: formatOdds(odds),
      confidence: pred.confidence,
      reasoning: pred.reasoning,
      impliedProbability: 0,
      estimatedTrueProbability: pred.confidence / 100,
      edge: 0,
    };
    addLeg(bet);
  }

  /* ---- Countdown text ---- */

  function getCountdownText(): string {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 12) return "Props typically drop around 5-6 PM ET. Check back later this afternoon.";
    if (hour < 17) return "Props usually available 1-2 hours before tip. Check back closer to game time.";
    if (hour < 19) return "Lines should be dropping soon. Check back in 30-60 minutes.";
    return "Props typically available 1-2 hours before tip-off.";
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 font-sans">
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            O/U Predictions
          </h1>
          <p className="text-sm text-[rgba(255,255,255,0.45)] mt-0.5">
            Every player prop line analyzed with trend-backed AI predictions
          </p>
        </div>
        <button
          onClick={fetchPredictions}
          disabled={loading}
          className="px-4 py-2 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs font-medium text-[rgba(255,255,255,0.6)] hover:border-[#00E676]/40 hover:text-[#00E676] transition-all disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* ---- Stats summary bar (always show) ---- */}
      <div className="flex items-center gap-3 flex-wrap mb-5 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl">
        <span className="text-xs text-[rgba(255,255,255,0.45)]">
          <span className="font-mono font-bold text-white">
            {hasPredictions ? filtered.length : 0}
          </span>{" "}
          props analyzed
        </span>
        <span className="w-px h-3 bg-[rgba(255,255,255,0.1)]" />
        <span className="text-xs font-mono font-bold text-[#00E676]">
          {hasPredictions ? overCount : 0} OVER
        </span>
        <span className="text-xs font-mono font-bold text-[#FF5252]">
          {hasPredictions ? underCount : 0} UNDER
        </span>
        <span className="w-px h-3 bg-[rgba(255,255,255,0.1)]" />
        <span className="text-xs text-[rgba(255,255,255,0.45)]">
          Avg confidence:{" "}
          <span className="font-mono font-bold text-white">
            {hasPredictions ? avgConfidence : 0}%
          </span>
        </span>
      </div>

      {/* ---- Quick action buttons (always show) ---- */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setShowHailMary(!showHailMary)}
          className={cn(
            "px-5 py-2.5 rounded-xl text-sm font-bold transition-all",
            showHailMary
              ? "bg-[#FFD600] text-[#08080e] shadow-[0_0_20px_rgba(255,214,0,0.3)]"
              : "bg-[#FFD600]/10 border border-[#FFD600]/25 text-[#FFD600] hover:bg-[#FFD600]/20"
          )}
        >
          Safe Hail Mary
        </button>
        <button
          onClick={() => setShowMegaParlay(!showMegaParlay)}
          className={cn(
            "px-5 py-2.5 rounded-xl text-sm font-bold transition-all",
            showMegaParlay
              ? "bg-[#00E676] text-[#08080e] shadow-[0_0_20px_rgba(0,230,118,0.3)]"
              : "bg-[#00E676]/10 border border-[#00E676]/25 text-[#00E676] hover:bg-[#00E676]/20"
          )}
        >
          O/U Mega Parlay
        </button>
      </div>

      {/* ---- Safe Hail Mary card ---- */}
      {showHailMary && hailMary && (
        <div className="bg-[rgba(255,214,0,0.04)] border border-[#FFD600]/20 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-[#FFD600] flex items-center gap-2">
              <span>&#9889;</span> Safe Hail Mary Parlay
            </h3>
            <div className="text-right">
              <div className="font-mono text-[#00E676] font-bold text-lg">
                {hailMary.combinedOdds > 0 ? "+" : ""}
                {hailMary.combinedOdds}
              </div>
              <div className="text-[10px] text-[rgba(255,255,255,0.4)]">
                ${hailMary.payout.wager} wins $
                {hailMary.payout.payout.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            {hailMary.legs.map((leg, i) => {
              const odds =
                leg.prediction === "OVER" ? leg.overOdds : leg.underOdds;
              const isSafe = leg.confidence >= 70;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between py-2 px-3 rounded-lg",
                    isSafe
                      ? "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]"
                      : "bg-[#FFD600]/5 border border-[#FFD600]/15"
                  )}
                >
                  <div>
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase",
                        isSafe ? "text-[#00E676]" : "text-[#FFD600]"
                      )}
                    >
                      {isSafe ? "SAFE" : "HAIL MARY"}
                    </span>
                    <div className="text-sm font-medium text-white">
                      {leg.player} {leg.prediction} {leg.line} {leg.stat}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs text-white">
                      {formatOdds(odds)}
                    </div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.4)]">
                      {leg.confidence}% conf
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.5)] mt-3 leading-relaxed">
            {hailMary.strategy}
          </p>
        </div>
      )}

      {/* ---- Mega Parlay card ---- */}
      {showMegaParlay && megaParlay && (
        <div className="bg-[rgba(0,230,118,0.04)] border border-[#00E676]/20 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-[#00E676] flex items-center gap-2">
              <span>&#128640;</span> O/U Mega Parlay &mdash;{" "}
              {megaParlay.legs.length} legs
            </h3>
            <div className="text-right">
              <div className="font-mono text-[#00E676] font-bold text-lg">
                {megaParlay.combinedOdds > 0 ? "+" : ""}
                {megaParlay.combinedOdds.toLocaleString()}
              </div>
              <div className="text-[10px] text-[rgba(255,255,255,0.4)]">
                ${megaParlay.payout.wager} wins $
                {megaParlay.payout.payout.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {megaParlay.legs.map((leg, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-[rgba(255,255,255,0.04)] text-xs"
              >
                <span className="font-medium truncate mr-2 text-white">
                  <span
                    className={cn(
                      "font-bold mr-1",
                      leg.prediction === "OVER"
                        ? "text-[#00E676]"
                        : "text-[#FF5252]"
                    )}
                  >
                    {leg.prediction === "OVER" ? "O" : "U"}
                  </span>
                  {leg.player} {leg.line} {leg.stat}
                </span>
                <span className="font-mono text-[rgba(255,255,255,0.5)] flex-shrink-0">
                  {leg.confidence}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.5)] mt-3">
            {megaParlay.strategy}
          </p>
        </div>
      )}

      {/* ---- Filter pills + Sort (always show) ---- */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex gap-1.5">
          {(
            ["all", "points", "rebounds", "assists", "threes"] as StatFilter[]
          ).map((f) => (
            <button
              key={f}
              onClick={() => setStatFilter(f)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all capitalize",
                statFilter === f
                  ? "bg-[#00E676] text-[#08080e]"
                  : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.08)] hover:border-[#00E676]/40 hover:text-[#00E676]"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] ml-auto appearance-none cursor-pointer hover:border-[rgba(255,255,255,0.15)] transition-colors"
        >
          <option value="confidence">Sort: Confidence</option>
          <option value="line">Sort: Line</option>
          <option value="player">Sort: Player</option>
        </select>
      </div>

      {/* ---- Error ---- */}
      {error && (
        <div className="bg-[#FF5252]/8 border border-[#FF5252]/25 rounded-xl p-4 mb-5">
          <p className="text-sm text-[#FF5252]">{error}</p>
        </div>
      )}

      {/* ---- Loading ---- */}
      {loading && (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-10 text-center">
          <div className="w-10 h-10 border-2 border-[#00E676] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[rgba(255,255,255,0.7)] font-medium">
            Analyzing player props across all games...
          </p>
          <p className="text-xs text-[rgba(255,255,255,0.35)] mt-1.5">
            Pulling game logs, calculating trends, running predictions
          </p>
        </div>
      )}

      {/* ---- Predictions list ---- */}
      {hasPredictions && (
        <div className="space-y-2">
          {filtered.map((pred, i) => (
            <PredictionRow
              key={`${pred.player}-${pred.stat}-${pred.line}-${i}`}
              pred={pred}
              onAddToParlay={() => handleAddToParlay(pred)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-[rgba(255,255,255,0.4)]">
                No predictions match the current filter.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/*  EMPTY STATE                                                      */}
      {/* ================================================================ */}

      {isEmpty && (
        <div className="space-y-6">
          {/* Countdown / availability notice */}
          <div className="bg-[rgba(255,214,0,0.04)] border border-[#FFD600]/15 rounded-xl p-5 text-center">
            <div className="w-10 h-10 rounded-full bg-[#FFD600]/10 flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-5 h-5 text-[#FFD600]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              Waiting for Props
            </h3>
            <p className="text-sm text-[rgba(255,255,255,0.5)] max-w-md mx-auto">
              {getCountdownText()}
            </p>
          </div>

          {/* AI record */}
          <div className="text-center">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] text-xs text-[rgba(255,255,255,0.45)]">
              <span className="w-2 h-2 rounded-full bg-[#00E676] animate-pulse" />
              0-0 record (tracking begins with first prediction)
            </span>
          </div>

          {/* How It Works */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
            <h3 className="text-sm font-bold text-white mb-3">
              How It Works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#6366f1]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-[#6366f1]">1</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    Lines Imported
                  </p>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5">
                    We pull every player prop from FanDuel as soon as they
                    post.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#00E676]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-[#00E676]">2</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    AI Analyzes
                  </p>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5">
                    Game logs, trends, matchups, and splits are crunched into
                    a confidence score.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#FFD600]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-[#FFD600]">3</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    You Pick
                  </p>
                  <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5">
                    Add picks to your parlay or send straight to FanDuel with
                    one tap.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Sample prediction rows */}
          <div className="relative">
            {/* Overlay label */}
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <span className="px-4 py-2 rounded-lg bg-[#08080e]/90 border border-[rgba(255,255,255,0.1)] text-xs font-bold text-[rgba(255,255,255,0.6)] uppercase tracking-wider backdrop-blur-sm">
                Sample &mdash; real predictions load before game time
              </span>
            </div>
            <div className="space-y-2">
              {SAMPLE_ROWS.map((row, i) => (
                <PredictionRow key={i} pred={row} isSample />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
