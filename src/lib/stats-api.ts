import axios from "axios";
import {
  Player,
  GameLog,
  SeasonAverages,
  Game,
  RecentForm,
  Injury,
  Team,
} from "./types";

// ============ Ball Don't Lie API (NBA) ============

const BDL_BASE = "https://api.balldontlie.io/v1";
const bdlClient = axios.create({
  baseURL: BDL_BASE,
  headers: { Authorization: process.env.BALLDONTLIE_API_KEY! },
});

export async function searchPlayers(query: string): Promise<Player[]> {
  const { data } = await bdlClient.get("/players", {
    params: { search: query, per_page: 10 },
  });
  return data.data;
}

export async function getPlayerGameLogs(
  playerId: number,
  lastN: number = 10,
  season?: number
): Promise<GameLog[]> {
  const currentSeason = season ?? new Date().getFullYear();
  const { data } = await bdlClient.get("/stats", {
    params: {
      player_ids: [playerId],
      seasons: [currentSeason],
      per_page: lastN,
      sort: "-game.date",
    },
  });
  return data.data;
}

export async function getPlayerAverages(
  playerId: number,
  season?: number
): Promise<SeasonAverages | null> {
  const currentSeason = season ?? new Date().getFullYear();
  const { data } = await bdlClient.get("/season_averages", {
    params: { player_ids: [playerId], season: currentSeason },
  });
  return data.data[0] ?? null;
}

export async function getPlayerVsTeam(
  playerId: number,
  opponentTeamId: number,
  lastN: number = 10
): Promise<GameLog[]> {
  const logs = await getPlayerGameLogs(playerId, 100);
  return logs
    .filter(
      (log) =>
        log.game.home_team.id === opponentTeamId ||
        log.game.visitor_team.id === opponentTeamId
    )
    .slice(0, lastN);
}

export async function getHeadToHead(
  team1Id: number,
  team2Id: number,
  lastN: number = 10
): Promise<Game[]> {
  const { data } = await bdlClient.get("/games", {
    params: {
      team_ids: [team1Id],
      per_page: 100,
      sort: "-date",
    },
  });
  const games: Game[] = data.data;
  return games
    .filter(
      (g) =>
        g.home_team.id === team2Id || g.visitor_team.id === team2Id
    )
    .slice(0, lastN);
}

export async function getRecentForm(
  teamId: number,
  lastN: number = 10
): Promise<RecentForm> {
  const { data } = await bdlClient.get("/games", {
    params: {
      team_ids: [teamId],
      per_page: lastN,
      sort: "-date",
    },
  });
  const games: Game[] = data.data;
  const team = games[0]?.home_team.id === teamId
    ? games[0].home_team
    : games[0]?.visitor_team;

  let wins = 0;
  let losses = 0;
  let totalFor = 0;
  let totalAgainst = 0;
  let streakType: "W" | "L" = "W";
  let streakCount = 0;
  let streakSet = false;

  for (const g of games) {
    const isHome = g.home_team.id === teamId;
    const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
    const oppScore = isHome ? g.visitor_team_score : g.home_team_score;
    const won = teamScore > oppScore;

    if (won) wins++;
    else losses++;
    totalFor += teamScore;
    totalAgainst += oppScore;

    if (!streakSet) {
      streakType = won ? "W" : "L";
      streakCount = 1;
      streakSet = true;
    } else if ((won && streakType === "W") || (!won && streakType === "L")) {
      streakCount++;
    }
  }

  return {
    team: team as Team,
    lastN: games,
    record: { wins, losses },
    avgPointsFor: games.length ? totalFor / games.length : 0,
    avgPointsAgainst: games.length ? totalAgainst / games.length : 0,
    streak: { type: streakType, count: streakCount },
  };
}

// ============ ESPN API (Multi-Sport) ============

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

const ESPN_SPORT_MAP: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  nfl: { sport: "football", league: "nfl" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
  ncaab: { sport: "basketball", league: "mens-college-basketball" },
  ncaaf: { sport: "football", league: "college-football" },
  soccer_epl: { sport: "soccer", league: "eng.1" },
  ufc: { sport: "mma", league: "ufc" },
};

function espnUrl(sportKey: string, endpoint: string): string {
  const mapping = ESPN_SPORT_MAP[sportKey];
  if (!mapping) throw new Error(`No ESPN mapping for sport: ${sportKey}`);
  return `${ESPN_BASE}/${mapping.sport}/${mapping.league}/${endpoint}`;
}

export async function getESPNScoreboard(sportKey: string): Promise<unknown> {
  const { data } = await axios.get(espnUrl(sportKey, "scoreboard"));
  return data;
}

export async function getESPNGameSummary(
  sportKey: string,
  gameId: string
): Promise<unknown> {
  const { data } = await axios.get(espnUrl(sportKey, `summary?event=${gameId}`));
  return data;
}

export async function getTeamInjuries(
  sportKey: string,
  teamId: string
): Promise<Injury[]> {
  try {
    const { data } = await axios.get(
      espnUrl(sportKey, `teams/${teamId}/injuries`)
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = data?.items ?? data?.team?.injuries ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => ({
      player: item.athlete?.displayName ?? item.name ?? "Unknown",
      position: item.athlete?.position?.abbreviation ?? "",
      status: item.status ?? item.type?.description ?? "Unknown",
      description: item.details?.detail ?? item.longComment ?? "",
      lastUpdate: item.date ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export async function getTeamRoster(
  sportKey: string,
  teamId: string
): Promise<unknown> {
  const { data } = await axios.get(espnUrl(sportKey, `teams/${teamId}/roster`));
  return data;
}

export async function getESPNNews(sportKey: string): Promise<string[]> {
  try {
    const { data } = await axios.get(espnUrl(sportKey, "news"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.articles ?? []).slice(0, 10).map((a: any) => a.headline as string);
  } catch {
    return [];
  }
}

export async function getGameNarrative(
  sportKey: string,
  gameId: string
): Promise<string> {
  try {
    const summary = await getESPNGameSummary(sportKey, gameId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const article = (summary as any)?.article;
    if (article?.story) return article.story;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const news = (summary as any)?.news?.articles;
    if (news?.length) return news[0].headline;
    return "";
  } catch {
    return "";
  }
}

export async function getLineupStatus(
  sportKey: string,
  gameId: string
): Promise<{
  homeTeam: { confirmed: string[]; questionable: string[]; out: string[] };
  awayTeam: { confirmed: string[]; questionable: string[]; out: string[] };
}> {
  try {
    const summary = await getESPNGameSummary(sportKey, gameId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rosters = (summary as any)?.rosters ?? [];
    const result = {
      homeTeam: { confirmed: [] as string[], questionable: [] as string[], out: [] as string[] },
      awayTeam: { confirmed: [] as string[], questionable: [] as string[], out: [] as string[] },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rosters.forEach((roster: any, idx: number) => {
      const team = idx === 0 ? result.homeTeam : result.awayTeam;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (roster.roster ?? []).forEach((p: any) => {
        const name = p.athlete?.displayName ?? "";
        const status = p.status?.type ?? "active";
        if (status === "active") team.confirmed.push(name);
        else if (status === "day-to-day" || status === "questionable") team.questionable.push(name);
        else team.out.push(name);
      });
    });
    return result;
  } catch {
    return {
      homeTeam: { confirmed: [], questionable: [], out: [] },
      awayTeam: { confirmed: [], questionable: [], out: [] },
    };
  }
}
