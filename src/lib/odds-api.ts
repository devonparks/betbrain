import axios from "axios";
import { SPORTS, OddsResponse, ScoreResponse, Sport, SportKey } from "./types";

const BASE_URL = "https://api.the-odds-api.com/v4";
const API_KEY = process.env.ODDS_API_KEY!;

const client = axios.create({
  baseURL: BASE_URL,
  params: { apiKey: API_KEY },
});

export async function getSports(): Promise<Sport[]> {
  const { data } = await client.get<Sport[]>("/sports");
  return data;
}

export async function getOdds(
  sport: SportKey | string,
  markets: string[] = ["h2h", "spreads", "totals"],
  bookmakers?: string[]
): Promise<OddsResponse[]> {
  const sportKey = sport in SPORTS ? SPORTS[sport as SportKey] : sport;
  const params: Record<string, string> = {
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
  };
  if (bookmakers?.length) {
    params.bookmakers = bookmakers.join(",");
  }
  const { data } = await client.get<OddsResponse[]>(
    `/sports/${sportKey}/odds`,
    { params }
  );
  return data;
}

export async function getPlayerProps(
  sport: SportKey | string,
  gameId: string,
  markets: string[] = ["player_points", "player_rebounds", "player_assists"],
  bookmakers?: string[]
): Promise<OddsResponse[]> {
  const sportKey = sport in SPORTS ? SPORTS[sport as SportKey] : sport;
  const params: Record<string, string> = {
    regions: "us",
    markets: markets.join(","),
    oddsFormat: "american",
    eventIds: gameId,
  };
  if (bookmakers?.length) {
    params.bookmakers = bookmakers.join(",");
  }
  const { data } = await client.get<OddsResponse[]>(
    `/sports/${sportKey}/odds`,
    { params }
  );
  return data;
}

export async function getScores(
  sport: SportKey | string,
  daysFrom: number = 1
): Promise<ScoreResponse[]> {
  const sportKey = sport in SPORTS ? SPORTS[sport as SportKey] : sport;
  const { data } = await client.get<ScoreResponse[]>(
    `/sports/${sportKey}/scores`,
    { params: { daysFrom: daysFrom.toString() } }
  );
  return data;
}

export async function getHistoricalOdds(
  sport: SportKey | string,
  date: string,
  markets: string[] = ["h2h", "spreads", "totals"]
): Promise<OddsResponse[]> {
  const sportKey = sport in SPORTS ? SPORTS[sport as SportKey] : sport;
  const { data } = await client.get<OddsResponse[]>(
    `/sports/${sportKey}/odds-history`,
    {
      params: {
        regions: "us",
        markets: markets.join(","),
        oddsFormat: "american",
        date,
      },
    }
  );
  return data;
}
