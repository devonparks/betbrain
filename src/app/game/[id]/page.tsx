"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OddsResponse, GameAnalysis, SportKey } from "@/lib/types";
import { extractBestOdds, formatOdds, formatGameTime } from "@/lib/utils";
import { OddsTable } from "@/components/games/OddsTable";
import { AISummary } from "@/components/analysis/AISummary";
import { InjuryImpact } from "@/components/analysis/InjuryImpact";
import { SafeHailMary } from "@/components/betting/SafeHailMary";

export default function GameDeepDive() {
  const params = useParams();
  const searchParams = useSearchParams();
  const gameId = params.id as string;
  const sport = (searchParams.get("sport") ?? "nba") as SportKey;

  const [game, setGame] = useState<OddsResponse | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [loadingOdds, setLoadingOdds] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Fetch game odds
  useEffect(() => {
    async function fetchGame() {
      try {
        const res = await fetch(`/api/odds?sport=${sport}`);
        const data: OddsResponse[] = await res.json();
        const found = data.find((g) => g.id === gameId);
        setGame(found ?? null);
      } catch {
        // Failed to load
      } finally {
        setLoadingOdds(false);
      }
    }
    fetchGame();
  }, [gameId, sport]);

  // Fetch AI analysis
  const loadAnalysis = async () => {
    if (!game) return;
    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, sport }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setAnalysis(data);
    } catch {
      setAnalysisError("Failed to load analysis. Try again.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  if (loadingOdds) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-bg-hover rounded" />
          <div className="h-4 w-48 bg-bg-hover rounded" />
          <div className="h-64 bg-bg-card rounded-card" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-lg font-semibold mb-2">Game Not Found</h2>
        <p className="text-sm text-text-muted">This game may have ended or been removed.</p>
      </div>
    );
  }

  const bestOdds = extractBestOdds(game);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Game Header */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-6">
        <div className="text-xs text-text-muted mb-3">
          {formatGameTime(game.commence_time)}
        </div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">{game.away_team}</h1>
            <span className="text-text-muted text-sm">@</span>
            <h1 className="text-xl font-bold">{game.home_team}</h1>
          </div>
          <div className="text-right space-y-1">
            <div className="font-mono text-sm">
              <span className="text-text-muted mr-2">ML</span>
              <span className="text-accent-green">{formatOdds(bestOdds.moneyline.home.odds)}</span>
              <span className="text-text-muted mx-1">/</span>
              <span>{formatOdds(bestOdds.moneyline.away.odds)}</span>
            </div>
            <div className="font-mono text-sm">
              <span className="text-text-muted mr-2">Spread</span>
              <span>{bestOdds.spread.home.point > 0 ? "+" : ""}{bestOdds.spread.home.point}</span>
            </div>
            <div className="font-mono text-sm">
              <span className="text-text-muted mr-2">O/U</span>
              <span>{bestOdds.total.over.point}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Odds Comparison Table */}
      <OddsTable game={game} />

      {/* AI Analysis Section */}
      <div>
        {!analysis && !loadingAnalysis && (
          <button
            onClick={loadAnalysis}
            className="w-full bg-accent-green/10 border border-accent-green/30 text-accent-green rounded-card py-4 font-semibold text-sm hover:bg-accent-green/20 transition-colors"
          >
            Generate AI Analysis
          </button>
        )}

        {loadingAnalysis && (
          <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
            <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-text-secondary">
              Analyzing game data, odds, and matchup context...
            </p>
          </div>
        )}

        {analysisError && (
          <div className="bg-accent-red/10 border border-accent-red/30 rounded-card p-4">
            <p className="text-sm text-accent-red">{analysisError}</p>
            <button
              onClick={loadAnalysis}
              className="mt-2 text-xs text-accent-blue hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            <AISummary analysis={analysis} />
            <InjuryImpact injuries={analysis.injuryImpact} />
            {analysis.safeHailMary.safeLeg1.confidence > 0 && (
              <SafeHailMary parlay={analysis.safeHailMary} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
