"use client";

import { useState, useEffect, useCallback } from "react";
import { OddsResponse, GameCardData, BestOdds, SportKey } from "@/lib/types";
import { extractBestOdds, formatOdds } from "@/lib/utils";

const EMPTY_BEST_ODDS: BestOdds = {
  moneyline: {
    home: { odds: 0, book: "" },
    away: { odds: 0, book: "" },
  },
  spread: {
    home: { odds: 0, point: 0, book: "" },
    away: { odds: 0, point: 0, book: "" },
  },
  total: {
    over: { odds: 0, point: 0, book: "" },
    under: { odds: 0, point: 0, book: "" },
  },
};

export function useOdds(sport: SportKey) {
  const [games, setGames] = useState<GameCardData[]>([]);
  const [rawOdds, setRawOdds] = useState<OddsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchOdds = useCallback(async () => {
    try {
      setLoading(true);

      // Try Odds API first
      const res = await fetch(`/api/odds?sport=${sport}`);
      if (res.ok) {
        const data: OddsResponse[] = await res.json();
        setRawOdds(data);

        const cards: GameCardData[] = data.map((game) => {
          const bestOdds = extractBestOdds(game);
          const spreadPt = bestOdds.spread.home.point;
          const totalPt = bestOdds.total.over.point;

          // Generate a quick take from the odds data
          const favTeam = spreadPt < 0 ? game.home_team : game.away_team;
          const favShort = favTeam.split(" ").pop();
          const absSp = Math.abs(spreadPt);
          let quickTake = "";

          if (absSp >= 12) {
            quickTake = `${favShort} ${formatOdds(spreadPt)} — blowout risk, star props may be capped in 4th`;
          } else if (absSp >= 7) {
            quickTake = `${favShort} should control this one (${formatOdds(spreadPt)}) — look for role player overs`;
          } else if (absSp >= 4) {
            quickTake = `Competitive spread (${formatOdds(spreadPt)}) — both sides have value`;
          } else if (absSp > 0) {
            quickTake = `Coin flip (${formatOdds(spreadPt)}) — props more reliable than the side`;
          } else if (totalPt >= 238) {
            quickTake = `Pace-up game (O/U ${totalPt}) — scoring props likely to hit overs`;
          } else if (totalPt <= 212 && totalPt > 0) {
            quickTake = `Grind-it-out (O/U ${totalPt}) — consider unders on scoring props`;
          }

          // Confidence based on spread clarity
          let confidence = 0;
          if (absSp >= 10) confidence = 75;
          else if (absSp >= 7) confidence = 62;
          else if (absSp >= 4) confidence = 50;
          else if (absSp > 0) confidence = 40;

          return {
            id: game.id,
            sportKey: sport,
            homeTeam: game.home_team,
            awayTeam: game.away_team,
            commenceTime: game.commence_time,
            bestOdds,
            aiConfidence: confidence,
            aiQuickTake: quickTake,
          };
        });

        setGames(cards);
        setLastUpdated(new Date());
        setError(null);
        return;
      }

      // Odds API failed — fall back to ESPN scoreboard
      const espnRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
      );
      if (!espnRes.ok) throw new Error("Both Odds API and ESPN unavailable");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const espnData = await espnRes.json() as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = (espnData.events ?? []) as any[];

      const espnCards: GameCardData[] = events.map((event) => {
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const home = competitors.find((c: any) => c.homeAway === "home");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const away = competitors.find((c: any) => c.homeAway === "away");

        return {
          id: `espn-${event.id}`,
          sportKey: sport,
          homeTeam: home?.team?.displayName ?? "Home",
          awayTeam: away?.team?.displayName ?? "Away",
          commenceTime: event.date ?? new Date().toISOString(),
          bestOdds: EMPTY_BEST_ODDS,
          aiConfidence: 0,
          aiQuickTake: "",
          homeRecord: home?.records?.[0]?.summary,
          awayRecord: away?.records?.[0]?.summary,
        };
      });

      setGames(espnCards);
      setLastUpdated(new Date());
      setError("Odds unavailable — showing games from ESPN");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games");
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    fetchOdds();
  }, [fetchOdds]);

  return { games, rawOdds, loading, error, lastUpdated, refetch: fetchOdds };
}
