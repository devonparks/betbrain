"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { OddsResponse, GameAnalysis, SportKey } from "@/lib/types";
import { extractBestOdds, formatOdds } from "@/lib/utils";
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
import { SendToFanDuel } from "@/components/betting/SendToFanDuel";
import { detectValueBets, ValueBet } from "@/lib/value-detector";
import { useUserStore } from "@/stores/userStore";
import { OUPrediction } from "@/lib/prediction-engine";
import { analyzeInjuryRipple, InjuryRippleEffect } from "@/lib/injury-ripple";
import { cn } from "@/lib/utils";

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

  // Value bets
  const [valueBets, setValueBets] = useState<ValueBet[]>([]);

  // O/U Predictions
  const [ouPredictions, setOuPredictions] = useState<OUPrediction[]>([]);

  // Injury ripple effects
  const [injuryRipples, setInjuryRipples] = useState<InjuryRippleEffect[]>([]);

  // Odds table collapsed state
  const [oddsExpanded, setOddsExpanded] = useState(false);

  // Selected player
  const [selectedPlayer, setSelectedPlayer] = useState<{
    name: string;
    logs: ESPNPlayerGameLog[];
  } | null>(null);

  // Auto-load AI analysis on mount
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);

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
        // Research data is supplementary
      } finally {
        setLoadingResearch(false);
      }
    }
    fetchResearch();
  }, [game, sport]);

  // Fetch player props + predictions + value bets
  useEffect(() => {
    if (!game) return;
    async function fetchPlayerProps() {
      try {
        const res = await fetch(`/api/odds/player-props?sport=${sport}&gameId=${gameId}`);
        if (!res.ok) return;
        const data: OddsResponse[] = await res.json();
        const props: typeof playerProps = [];
        for (const g of data) {
          for (const bookmaker of g.bookmakers) {
            for (const market of bookmaker.markets) {
              const marketName = market.key.replace("player_", "").replace("_alternate", "");
              const overOutcome = market.outcomes.find((o) => o.name === "Over");
              const underOutcome = market.outcomes.find((o) => o.name === "Under");
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
        const bestProps = new Map<string, (typeof props)[0]>();
        for (const p of props) {
          const key = `${p.player}-${p.market}-${p.line}`;
          const existing = bestProps.get(key);
          if (!existing || p.overOdds > existing.overOdds) bestProps.set(key, p);
        }
        setPlayerProps(Array.from(bestProps.values()));
      } catch { /* supplementary */ }
    }
    fetchPlayerProps();

    async function fetchOUPredictions() {
      try {
        const res = await fetch(`/api/predict-ou?sport=${sport}&gameId=${gameId}`);
        if (!res.ok) return;
        const data = await res.json();
        setOuPredictions(data.predictions ?? []);
      } catch { /* supplementary */ }
    }
    fetchOUPredictions();

    async function fetchValueBets() {
      try {
        const res = await fetch(`/api/odds?sport=${sport}`);
        if (!res.ok) return;
        const allGames: OddsResponse[] = await res.json();
        const thisGame = allGames.filter((g) => g.id === gameId);
        setValueBets(detectValueBets(thisGame));
      } catch { /* supplementary */ }
    }
    fetchValueBets();
  }, [game, sport, gameId]);

  // Auto-trigger AI analysis once research data loads
  useEffect(() => {
    if (game && !autoAnalyzed && !loadingResearch && !analysis) {
      setAutoAnalyzed(true);
      loadAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, loadingResearch]);

  // Compute injury ripple effects when ESPN data + player logs are available
  useEffect(() => {
    if (!espnData || Object.keys(playerLogs).length === 0) return;

    const allTeams = [espnData.homeTeam, espnData.awayTeam];
    const ripples: InjuryRippleEffect[] = [];

    for (const teamData of allTeams) {
      // Find players marked as "Out" in injuries list
      const outPlayers = teamData.injuries.filter(
        (inj) => inj.status === "Out"
      );

      for (const injury of outPlayers) {
        const injuredName = injury.player;
        const injuredLogs = playerLogs[injuredName];
        if (!injuredLogs || injuredLogs.length < 3) continue;

        // Gather teammate logs (players on same team who have logs)
        const teammates: { name: string; team: string; logs: ESPNPlayerGameLog[] }[] = [];
        for (const player of teamData.players) {
          if (player.name === injuredName) continue;
          const logs = playerLogs[player.name];
          if (logs && logs.length >= 3) {
            teammates.push({ name: player.name, team: teamData.name, logs });
          }
        }

        if (teammates.length === 0) continue;

        const ripple = analyzeInjuryRipple(
          injuredName,
          injury.status,
          teammates,
          injuredLogs
        );

        if (ripple.teammates.length > 0) {
          ripples.push(ripple);
        }
      }
    }

    setInjuryRipples(ripples);
  }, [espnData, playerLogs]);

  const handlePlayerClick = (player: ESPNPlayer) => {
    const logs = playerLogs[player.name];
    if (logs && logs.length > 0) setSelectedPlayer({ name: player.name, logs });
  };

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
      setAnalysis(await res.json());
    } catch {
      setAnalysisError("Failed to load analysis. Try again.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const getOpponentAbbr = (playerName: string) => {
    if (!espnData) return undefined;
    const isHome = espnData.homeTeam.players.some((p) => p.name === playerName);
    return isHome ? espnData.awayTeam.abbreviation : espnData.homeTeam.abbreviation;
  };

  // Loading skeleton
  if (loadingOdds) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-bg-card rounded-card" />
          <div className="h-48 bg-bg-card rounded-card" />
          <div className="h-64 bg-bg-card rounded-card" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <h2 className="text-lg font-semibold mb-2">Game Not Found</h2>
        <p className="text-sm text-text-muted">This game may have ended or been removed.</p>
      </div>
    );
  }

  const bestOdds = extractBestOdds(game);
  const hasFiniteOdds = (n: number) => isFinite(n) && n !== 0;
  const totalInjuries = espnData
    ? espnData.homeTeam.injuries.length + espnData.awayTeam.injuries.length
    : 0;

  // Blowout detection — spread >= 12 points
  const homeSpread = bestOdds.spread.home.point;
  const absSpread = Math.abs(homeSpread);
  const isBlowoutRisk = hasFiniteOdds(bestOdds.spread.home.odds) && absSpread >= 12;
  const blowoutFavorite = homeSpread < 0 ? game.home_team : game.away_team;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

      {/* ===== SECTION 1: GAME HEADER ===== */}
      <div className="bg-bg-card border border-border-subtle rounded-card p-5">
        <div className="flex items-center justify-between mb-2">
          <BettingWindowTimer commenceTime={game.commence_time} />
          {espnData?.venue && (
            <span className="text-[10px] text-text-muted hidden sm:block">{espnData.venue}</span>
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold">{game.away_team}</h1>
              {espnData?.awayTeam.record && (
                <span className="text-sm text-text-muted">({espnData.awayTeam.record})</span>
              )}
            </div>
            <span className="text-text-muted text-sm">@</span>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-xl font-bold">{game.home_team}</h1>
              {espnData?.homeTeam.record && (
                <span className="text-sm text-text-muted">({espnData.homeTeam.record})</span>
              )}
            </div>
          </div>
          <div className="text-right space-y-1.5">
            {hasFiniteOdds(bestOdds.spread.home.odds) && (
              <div className="font-mono text-sm">
                <span className="text-[10px] text-text-muted mr-1.5">SPREAD</span>
                <span className="font-semibold">{bestOdds.spread.home.point > 0 ? "+" : ""}{bestOdds.spread.home.point}</span>
                <span className="text-text-muted ml-1 text-xs">{formatOdds(bestOdds.spread.home.odds)}</span>
              </div>
            )}
            {hasFiniteOdds(bestOdds.total.over.odds) && (
              <div className="font-mono text-sm">
                <span className="text-[10px] text-text-muted mr-1.5">O/U</span>
                <span className="font-semibold">{bestOdds.total.over.point}</span>
                <span className="text-text-muted ml-1 text-xs">{formatOdds(bestOdds.total.over.odds)}</span>
              </div>
            )}
            {hasFiniteOdds(bestOdds.moneyline.home.odds) && (
              <div className="font-mono text-sm">
                <span className="text-[10px] text-text-muted mr-1.5">ML</span>
                <span className="text-accent-green font-semibold">{formatOdds(bestOdds.moneyline.home.odds)}</span>
                <span className="text-text-muted mx-1">/</span>
                <span>{formatOdds(bestOdds.moneyline.away.odds)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick info row */}
        <div className="flex items-center gap-3 mt-3 text-xs text-text-muted">
          {espnData?.broadcast && <span>TV: {espnData.broadcast}</span>}
          {totalInjuries > 0 && (
            <span className="text-accent-red flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {totalInjuries} injured
            </span>
          )}
          <SendToFanDuel compact />
        </div>
      </div>

      {/* ===== BLOWOUT WARNING ===== */}
      {isBlowoutRisk && (
        <div className="bg-accent-amber/10 border-2 border-accent-amber/40 rounded-card p-4 flex items-start gap-3">
          <span className="text-accent-amber text-xl leading-none mt-0.5">&#9888;</span>
          <div>
            <h4 className="font-bold text-sm text-accent-amber">BLOWOUT RISK</h4>
            <p className="text-sm text-text-secondary mt-0.5">
              {blowoutFavorite} favored by {absSpread}. Star players may sit in the 4th quarter, capping their stat lines.
            </p>
          </div>
        </div>
      )}

      {/* ===== SECTION 2: AI ANALYSIS (most prominent) ===== */}
      <div className="bg-bg-card border-2 border-accent-green/30 rounded-card p-5">
        {loadingAnalysis && (
          <div className="flex items-center gap-3 py-4">
            <div className="w-6 h-6 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
            <div>
              <p className="text-sm font-medium text-accent-green">Generating AI Analysis...</p>
              <p className="text-xs text-text-muted">Analyzing odds, injuries, and {angles.length} betting angles</p>
            </div>
          </div>
        )}

        {analysisError && (
          <div className="py-4">
            <p className="text-sm text-accent-red mb-2">{analysisError}</p>
            <button onClick={loadAnalysis} className="text-xs text-accent-green hover:underline">
              Retry Analysis
            </button>
          </div>
        )}

        {!analysis && !loadingAnalysis && !analysisError && (
          <button
            onClick={loadAnalysis}
            className="w-full py-4 text-center"
          >
            <div className="text-accent-green font-semibold text-sm">Generate AI Analysis</div>
            <div className="text-xs text-text-muted mt-0.5">
              Deep dive with betting angles, injury impact, and value detection
            </div>
          </button>
        )}

        {analysis && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-accent-green" />
              <h3 className="font-semibold text-sm text-accent-green">AI Analysis</h3>
              <span className="text-[10px] text-text-muted ml-auto">
                {analysis.confidence}% confidence
              </span>
            </div>
            <AISummary analysis={analysis} />

            {/* Best bet call-to-action */}
            {analysis.bestBet && (
              <div className="bg-accent-green/5 border border-accent-green/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-accent-green font-bold uppercase">Best Bet</div>
                  <div className="text-sm font-medium">{analysis.bestBet.pick}</div>
                  <div className="text-xs text-text-muted">
                    {analysis.bestBet.bestBook} · {analysis.bestBet.bestOdds} · {analysis.bestBet.edge.toFixed(1)}% edge
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SendToFanDuel compact />
                  {user && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/bets", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ userId: user.uid, bet: analysis.bestBet }),
                          });
                          if (res.ok) setBetTracked(true);
                        } catch { /* best effort */ }
                      }}
                      disabled={betTracked}
                      className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded transition-colors",
                        betTracked
                          ? "bg-accent-green/10 text-accent-green"
                          : "bg-accent-green text-bg-primary hover:bg-accent-green/90"
                      )}
                    >
                      {betTracked ? "Tracked" : "Track"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {analysis.safeHailMary.safeLeg1.confidence > 0 && (
              <SafeHailMary parlay={analysis.safeHailMary} />
            )}
          </div>
        )}
      </div>

      {/* Value Bets */}
      {valueBets.length > 0 && (
        <div className="bg-bg-card border border-accent-green/30 rounded-card p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
            Value Bets Detected
          </h3>
          <div className="space-y-1.5">
            {valueBets.map((vb, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-accent-green/5 border border-accent-green/10">
                <div>
                  <span className="text-sm font-medium">{vb.outcome}</span>
                  <span className="text-xs text-text-muted ml-2">
                    {vb.market === "h2h" ? "ML" : vb.market === "spreads" ? "Spread" : "Total"}
                  </span>
                </div>
                <div className="font-mono text-sm font-bold text-accent-green">
                  {vb.edge.toFixed(1)}% edge
                  <span className="text-[10px] text-text-muted font-normal ml-1.5">{vb.bestBook}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== SECTION 3: PLAYER PROPS + O/U PREDICTIONS ===== */}
      {(playerProps.length > 0 || ouPredictions.length > 0) && (
        <div className="space-y-4">
          {playerProps.length > 0 && (
            <PlayerPropsCard props={playerProps} playerLogs={playerLogs} />
          )}

          {ouPredictions.length > 0 && (
            <div className="bg-bg-card border-2 border-accent-green/20 rounded-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-accent-green" />
                <h3 className="font-bold text-sm">Player Prop Predictions</h3>
                <span className="text-[10px] text-text-muted ml-auto">{ouPredictions.length} predictions</span>
              </div>
              <div className="space-y-2">
                {ouPredictions.slice(0, 15).map((pred, i) => {
                  const isOver = pred.prediction === "OVER";
                  const last5 = pred.last10?.slice(0, 5) ?? [];
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-bg-hover border border-border-subtle">
                      {/* OVER/UNDER badge */}
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded shrink-0 w-14 text-center",
                        isOver ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"
                      )}>
                        {pred.prediction}
                      </span>

                      {/* Player + stat + line */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{pred.player}</div>
                        <div className="text-xs text-text-muted capitalize">
                          {pred.stat} {pred.line}
                          {pred.book && <span className="ml-1.5 text-text-muted/60">({pred.book})</span>}
                        </div>
                      </div>

                      {/* Confidence */}
                      <div className="shrink-0 text-right">
                        <div className={cn(
                          "font-mono text-sm font-bold",
                          pred.confidence >= 70 ? "text-accent-green" : pred.confidence >= 50 ? "text-accent-amber" : "text-text-secondary"
                        )}>
                          {pred.confidence}%
                        </div>
                        <div className="text-[10px] text-text-muted">confidence</div>
                      </div>

                      {/* Last 5 games sparkline */}
                      {last5.length > 0 && (
                        <div className="hidden sm:flex items-end gap-0.5 shrink-0 h-6">
                          {last5.map((val, j) => {
                            const hitLine = isOver ? val > pred.line : val < pred.line;
                            const maxVal = Math.max(...last5, pred.line);
                            const height = maxVal > 0 ? Math.max(4, (val / maxVal) * 24) : 4;
                            return (
                              <div
                                key={j}
                                className={cn(
                                  "w-1.5 rounded-sm",
                                  hitLine ? "bg-accent-green" : "bg-accent-red/50"
                                )}
                                style={{ height: `${height}px` }}
                                title={`${val}`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {ouPredictions.length > 15 && (
                <p className="text-[10px] text-text-muted text-center mt-3">
                  Showing top 15 of {ouPredictions.length} predictions
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== SECTION 4: ODDS COMPARISON (collapsible) ===== */}
      <div className="bg-bg-card border border-border-subtle rounded-card overflow-hidden">
        <button
          onClick={() => setOddsExpanded(!oddsExpanded)}
          className="w-full px-5 py-3 flex items-center justify-between hover:bg-bg-hover transition-colors"
        >
          <h3 className="font-semibold text-sm">Odds Comparison — {game.bookmakers.length} books</h3>
          <svg className={cn("w-4 h-4 text-text-muted transition-transform", oddsExpanded && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {oddsExpanded && (
          <div className="px-5 pb-4 overflow-x-auto">
            <OddsTable game={game} />
          </div>
        )}
      </div>

      {/* ===== SECTION 5: INJURIES + LINEUPS ===== */}
      {loadingResearch && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">Loading lineups, injuries, and stats...</span>
          </div>
        </div>
      )}

      {analysis && analysis.injuryImpact.length > 0 && (
        <InjuryImpact injuries={analysis.injuryImpact} />
      )}

      {/* ===== INJURY RIPPLE EFFECTS ===== */}
      {injuryRipples.length > 0 && (
        <div className="bg-bg-card border border-accent-amber/30 rounded-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-accent-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="font-bold text-sm text-accent-amber">Injury Impact</h3>
            <span className="text-[10px] text-text-muted ml-auto">Stat shifts when key players are out</span>
          </div>
          <div className="space-y-4">
            {injuryRipples.map((ripple, ri) => (
              <div key={ri}>
                <div className="text-xs text-text-muted mb-2">
                  <span className="font-semibold text-accent-red">{ripple.injuredPlayer}</span>
                  <span className="ml-1.5 text-[10px] bg-accent-red/20 text-accent-red px-1.5 py-0.5 rounded">
                    {ripple.injuredPlayerStatus}
                  </span>
                </div>
                {ripple.summary && (
                  <p className="text-sm text-text-secondary mb-2">{ripple.summary}</p>
                )}
                <div className="space-y-1">
                  {ripple.teammates.slice(0, 5).map((tm, ti) => {
                    const statLabel = tm.stat === "points" ? "PPG" : tm.stat === "rebounds" ? "RPG" : "APG";
                    return (
                      <div key={ti} className="flex items-center justify-between py-1.5 px-2.5 rounded bg-bg-hover">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tm.name}</span>
                          <span className="text-xs text-text-muted capitalize">{tm.stat}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs text-text-muted">{tm.withPlayer} {statLabel}</span>
                          <svg className="w-3 h-3 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                          <span className="font-mono text-sm font-bold text-accent-green">{tm.withoutPlayer} {statLabel}</span>
                          <span className="text-[10px] text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded font-bold">
                            +{tm.boost}
                          </span>
                          <span className="text-[10px] text-text-muted">({tm.gamesWithout}g)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {espnData && (
        <LineupsPanel gameData={espnData} onPlayerClick={handlePlayerClick} />
      )}

      {/* Betting Angles */}
      {angles.length > 0 && <AnglesCard angles={angles} />}

      {/* Player Stats Panel */}
      {selectedPlayer && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Player Research</h3>
            <button onClick={() => setSelectedPlayer(null)} className="text-xs text-text-muted hover:text-accent-red">
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

      {/* Player buttons */}
      {Object.keys(playerLogs).length > 0 && !selectedPlayer && (
        <div className="bg-bg-card border border-border-subtle rounded-card p-4">
          <h3 className="font-semibold text-sm mb-3">Player Research — tap a player</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(playerLogs).map(([name, logs]) => (
              <button
                key={name}
                onClick={() => setSelectedPlayer({ name, logs })}
                className="px-3 py-1.5 bg-bg-hover border border-border-subtle rounded-lg text-xs font-medium hover:border-accent-green transition-colors"
              >
                {name}
                <span className="ml-1.5 text-text-muted font-mono">
                  {(logs.slice(0, 10).reduce((s, g) => s + g.points, 0) / Math.min(logs.length, 10)).toFixed(1)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
