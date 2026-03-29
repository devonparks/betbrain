"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OddsResponse, GameAnalysis, SportKey } from "@/lib/types";
import { extractBestOdds, formatOdds, formatGameTime } from "@/lib/utils";
import { ESPNGameData, ESPNPlayerGameLog, ESPNPlayer } from "@/lib/stats-api";
import { BettingAngle } from "@/lib/angles-engine";
import { OddsTable } from "@/components/games/OddsTable";
import { AISummary } from "@/components/analysis/AISummary";
import { InjuryImpact } from "@/components/analysis/InjuryImpact";
import { SafeHailMary } from "@/components/betting/SafeHailMary";
import { LineupsPanel } from "@/components/analysis/LineupsPanel";
import { StatsPanel } from "@/components/analysis/StatsPanel";
import { AnglesCard } from "@/components/analysis/AnglesCard";
import { PlayerPropsCard } from "@/components/analysis/PlayerPropsCard";
import { BettingWindowTimer } from "@/components/games/BettingWindowTimer";
import { detectValueBets, ValueBet } from "@/lib/value-detector";
import { useUserStore } from "@/stores/userStore";
import { OUPrediction } from "@/lib/prediction-engine";

export default function GameDeepDive() {
  const params = useParams();
  const searchParams = useSearchParams();
  const gameId = params.id as string;
  const sport = (searchParams.get("sport") ?? "nba") as SportKey;
  const user = useUserStore((s) => s.user);
  const [betTracked, setBetTracked] = useState(false);

  // Odds data
  const [game, setGame] = useState<OddsResponse | null>(null);
  const [loadingOdds, setLoadingOdds] = useState(true);

  // AI analysis
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Research data (ESPN + angles)
  const [espnData, setEspnData] = useState<ESPNGameData | null>(null);
  const [playerLogs, setPlayerLogs] = useState<Record<string, ESPNPlayerGameLog[]>>({});
  const [angles, setAngles] = useState<BettingAngle[]>([]);
  const [loadingResearch, setLoadingResearch] = useState(false);

  // Player props from odds API
  const [playerProps, setPlayerProps] = useState<
    { player: string; market: string; line: number; overOdds: number; underOdds: number; book: string }[]
  >([]);

  // Value bets detected from cross-book discrepancies
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);

  // O/U Predictions for this game
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [ouPredictions, setOuPredictions] = useState<OUPrediction[]>([]);

  // Selected player for stats panel
  const [selectedPlayer, setSelectedPlayer] = useState<{
    name: string;
    logs: ESPNPlayerGameLog[];
  } | null>(null);

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

  // Fetch research data when game loads
  useEffect(() => {
    if (!game) return;
    async function fetchResearch() {
      setLoadingResearch(true);
      try {
        const res = await fetch(
          `/api/stats/game-research?homeTeam=${encodeURIComponent(game!.home_team)}&awayTeam=${encodeURIComponent(game!.away_team)}&sport=${sport}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.gameData) setEspnData(data.gameData);
          if (data.playerLogs) setPlayerLogs(data.playerLogs);
          if (data.angles) setAngles(data.angles);
        }
      } catch {
        // Research data is supplementary — don't block
      } finally {
        setLoadingResearch(false);
      }
    }
    fetchResearch();
  }, [game, sport]);

  // Fetch player props when game loads
  useEffect(() => {
    if (!game) return;
    async function fetchPlayerProps() {
      try {
        const res = await fetch(
          `/api/odds/player-props?sport=${sport}&gameId=${gameId}`
        );
        if (!res.ok) return;
        const data: OddsResponse[] = await res.json();
        // Extract prop lines from the response
        const props: typeof playerProps = [];
        for (const g of data) {
          for (const bookmaker of g.bookmakers) {
            for (const market of bookmaker.markets) {
              // player_points, player_rebounds, player_assists
              const marketName = market.key
                .replace("player_", "")
                .replace("_alternate", "");
              const overOutcome = market.outcomes.find(
                (o) => o.name === "Over"
              );
              const underOutcome = market.outcomes.find(
                (o) => o.name === "Under"
              );
              if (overOutcome?.description && overOutcome.point !== undefined) {
                props.push({
                  player: overOutcome.description,
                  market: marketName,
                  line: overOutcome.point,
                  overOdds: overOutcome.price,
                  underOdds: underOutcome?.price ?? 0,
                  book: bookmaker.title,
                });
              }
            }
          }
        }
        // Deduplicate: keep the best over odds per player+market+line
        const bestProps = new Map<string, (typeof props)[0]>();
        for (const p of props) {
          const key = `${p.player}-${p.market}-${p.line}`;
          const existing = bestProps.get(key);
          if (!existing || p.overOdds > existing.overOdds) {
            bestProps.set(key, p);
          }
        }
        setPlayerProps(Array.from(bestProps.values()));
      } catch {
        // Player props are supplementary
      }
    }
    fetchPlayerProps();

    // Fetch O/U predictions for this game
    async function fetchOUPredictions() {
      try {
        const res = await fetch(`/api/predict-ou?sport=${sport}&gameId=${gameId}`);
        if (!res.ok) return;
        const data = await res.json();
        setOuPredictions(data.predictions ?? []);
      } catch {
        // Predictions are supplementary
      }
    }
    fetchOUPredictions();

    // Detect value bets from odds discrepancies
    async function fetchValueBets() {
      try {
        const res = await fetch(`/api/odds?sport=${sport}`);
        if (!res.ok) return;
        const allGames: OddsResponse[] = await res.json();
        const thisGame = allGames.filter((g) => g.id === gameId);
        const detected = detectValueBets(thisGame);
        setValueBets(detected);
      } catch {
        // Value detection is supplementary
      }
    }
    fetchValueBets();
  }, [game, sport, gameId]);

  // Handle player click from lineups
  const handlePlayerClick = (player: ESPNPlayer) => {
    const logs = playerLogs[player.name];
    if (logs && logs.length > 0) {
      setSelectedPlayer({ name: player.name, logs });
    }
  };

  // Fetch AI analysis
  const loadAnalysis = async () => {
    if (!game) return;
    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          sport,
          angles: angles.map((a) => `${a.title}: ${a.description}`).join("\n"),
        }),
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
      <div className="max-w-5xl mx-auto px-4 py-8">
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
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <h2 className="text-lg font-semibold mb-2">Game Not Found</h2>
        <p className="text-sm text-text-muted">
          This game may have ended or been removed.
        </p>
      </div>
    );
  }

  const bestOdds = extractBestOdds(game);
  const hasFiniteOdds = (n: number) => isFinite(n) && n !== 0;

  // Get opponent abbreviation for selected player
  const getOpponentAbbr = (playerName: string) => {
    if (!espnData) return undefined;
    const isHome = espnData.homeTeam.players.some((p) => p.name === playerName);
    return isHome
      ? espnData.awayTeam.abbreviation
      : espnData.homeTeam.abbreviation;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Game Header */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-text-muted">
            {formatGameTime(game.commence_time)}
          </div>
          {espnData?.venue && (
            <div className="text-xs text-text-muted">{espnData.venue}</div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold">{game.away_team}</h1>
              {espnData?.awayTeam.record && (
                <span className="text-sm text-text-muted">
                  ({espnData.awayTeam.record})
                </span>
              )}
            </div>
            <span className="text-text-muted text-sm">@</span>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-xl font-bold">{game.home_team}</h1>
              {espnData?.homeTeam.record && (
                <span className="text-sm text-text-muted">
                  ({espnData.homeTeam.record})
                </span>
              )}
            </div>
          </div>
          <div className="text-right space-y-1">
            {hasFiniteOdds(bestOdds.moneyline.home.odds) && (
              <div className="font-mono text-sm">
                <span className="text-text-muted mr-2">ML</span>
                <span className="text-accent-green">
                  {formatOdds(bestOdds.moneyline.home.odds)}
                </span>
                <span className="text-text-muted mx-1">/</span>
                <span>{formatOdds(bestOdds.moneyline.away.odds)}</span>
              </div>
            )}
            {hasFiniteOdds(bestOdds.spread.home.odds) && (
              <div className="font-mono text-sm">
                <span className="text-text-muted mr-2">Spread</span>
                <span>
                  {bestOdds.spread.home.point > 0 ? "+" : ""}
                  {bestOdds.spread.home.point}
                </span>
              </div>
            )}
            {hasFiniteOdds(bestOdds.total.over.odds) && (
              <div className="font-mono text-sm">
                <span className="text-text-muted mr-2">O/U</span>
                <span>{bestOdds.total.over.point}</span>
              </div>
            )}
          </div>
        </div>
        {espnData?.broadcast && (
          <div className="mt-3 text-xs text-text-muted">
            TV: {espnData.broadcast}
          </div>
        )}
        <div className="mt-3">
          <BettingWindowTimer commenceTime={game.commence_time} />
        </div>
      </div>

      {/* Starting Lineups & Injuries */}
      {loadingResearch && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">
              Loading lineups, injuries, and stats...
            </span>
          </div>
        </div>
      )}

      {espnData && (
        <LineupsPanel gameData={espnData} onPlayerClick={handlePlayerClick} />
      )}

      {/* Betting Angles */}
      {angles.length > 0 && <AnglesCard angles={angles} />}

      {/* Player Stats Panel (click a player to see their logs) */}
      {selectedPlayer && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Player Research</h3>
            <button
              onClick={() => setSelectedPlayer(null)}
              className="text-xs text-text-muted hover:text-accent-red"
            >
              Close
            </button>
          </div>
          <StatsPanel
            playerName={selectedPlayer.name}
            gameLogs={selectedPlayer.logs}
            opponentAbbr={getOpponentAbbr(selectedPlayer.name)}
          />
        </div>
      )}

      {/* Quick player buttons — click to load stats */}
      {Object.keys(playerLogs).length > 0 && !selectedPlayer && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-4">
          <h3 className="font-semibold text-sm mb-3">
            Player Research — tap a player
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(playerLogs).map(([name, logs]) => (
              <button
                key={name}
                onClick={() => setSelectedPlayer({ name, logs })}
                className="px-3 py-1.5 bg-bg-hover border border-border-subtle rounded-lg text-xs font-medium hover:border-accent-green transition-colors"
              >
                {name}
                <span className="ml-1.5 text-text-muted font-mono">
                  {(
                    logs.slice(0, 10).reduce((s, g) => s + g.points, 0) /
                    Math.min(logs.length, 10)
                  ).toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Player Props with Value Detection */}
      {playerProps.length > 0 && (
        <PlayerPropsCard props={playerProps} playerLogs={playerLogs} />
      )}

      {/* Value Bets from Cross-Book Discrepancies */}
      {valueBets.length > 0 && (
        <div className="bg-bg-card border border-accent-green/30 rounded-card p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            Value Bets Detected
          </h3>
          <div className="space-y-2">
            {valueBets.map((vb, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-accent-green/5 border border-accent-green/10"
              >
                <div>
                  <span className="text-sm font-medium">{vb.outcome}</span>
                  <span className="text-xs text-text-muted ml-2">
                    {vb.market === "h2h" ? "ML" : vb.market === "spreads" ? "Spread" : "Total"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-accent-green">
                      {vb.edge.toFixed(1)}% edge
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {vb.bestBook} · {vb.bestOdds > 0 ? "+" : ""}{vb.bestOdds}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            {angles.length > 0 && (
              <span className="block text-xs font-normal mt-0.5 text-accent-green/70">
                Includes {angles.length} detected betting angle{angles.length !== 1 ? "s" : ""}
              </span>
            )}
          </button>
        )}

        {loadingAnalysis && (
          <div className="bg-bg-card border border-border-subtle rounded-card p-8 text-center">
            <div className="w-8 h-8 border-2 border-accent-green border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-text-secondary">
              Analyzing game data, odds, injuries, and {angles.length} betting angles...
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

            {/* Track Best Bet */}
            {user && analysis.bestBet && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/bets", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        userId: user.uid,
                        bet: analysis.bestBet,
                      }),
                    });
                    if (res.ok) setBetTracked(true);
                  } catch {
                    // Best effort
                  }
                }}
                disabled={betTracked}
                className={
                  betTracked
                    ? "w-full py-3 rounded-card text-sm font-medium bg-accent-green/10 text-accent-green border border-accent-green/30"
                    : "w-full py-3 rounded-card text-sm font-semibold bg-accent-green text-bg-primary hover:bg-accent-green/90 transition-colors"
                }
              >
                {betTracked
                  ? "Bet Tracked — check your Profile"
                  : `Track Best Bet: ${analysis.bestBet.pick}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
