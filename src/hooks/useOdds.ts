"use client";

import { useState, useEffect, useCallback } from "react";
import { OddsResponse, GameCardData, SportKey } from "@/lib/types";
import { extractBestOdds } from "@/lib/utils";

export function useOdds(sport: SportKey) {
  const [games, setGames] = useState<GameCardData[]>([]);
  const [rawOdds, setRawOdds] = useState<OddsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchOdds = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/odds?sport=${sport}`);
      if (!res.ok) throw new Error("Failed to fetch odds");
      const data: OddsResponse[] = await res.json();
      setRawOdds(data);

      const cards: GameCardData[] = data.map((game) => {
        const bestOdds = extractBestOdds(game);
        return {
          id: game.id,
          sportKey: sport,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: game.commence_time,
          bestOdds,
          aiConfidence: 0,
          aiQuickTake: "",
        };
      });

      setGames(cards);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    fetchOdds();
  }, [fetchOdds]);

  return { games, rawOdds, loading, error, lastUpdated, refetch: fetchOdds };
}
