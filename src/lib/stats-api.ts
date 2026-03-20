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

// ============ ESPN Enhanced Endpoints ============

export interface ESPNPlayer {
  id: string;
  name: string;
  position: string;
  jersey: string;
  starter: boolean;
  stats?: Record<string, string>;
  headshot?: string;
  injuries?: { status: string; detail: string };
}

export interface ESPNTeamData {
  id: string;
  name: string;
  abbreviation: string;
  record: string;
  logo: string;
  players: ESPNPlayer[];
  injuries: Injury[];
}

export interface ESPNGameData {
  id: string;
  status: string; // "pre" | "in" | "post"
  homeTeam: ESPNTeamData;
  awayTeam: ESPNTeamData;
  venue: string;
  broadcast: string;
  odds?: { spread: string; overUnder: string; details: string };
  lastFiveGames?: { home: string[]; away: string[] };
  leaders?: {
    home: { name: string; stat: string; value: string }[];
    away: { name: string; stat: string; value: string }[];
  };
}

export interface ESPNPlayerGameLog {
  date: string;
  opponent: string;
  result: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  plusMinus: number;
}

/**
 * Get full game data from ESPN including rosters, injuries, and odds
 */
export async function getESPNGameData(
  sportKey: string,
  espnGameId: string
): Promise<ESPNGameData | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = (await getESPNGameSummary(sportKey, espnGameId)) as any;

    const header = summary?.header;
    const competitions = header?.competitions?.[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseTeam = (competitor: any, idx: number): ESPNTeamData => {
      const team = competitor?.team;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rosterData = summary?.rosters?.[idx]?.roster ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const players: ESPNPlayer[] = rosterData.map((p: any) => ({
        id: p.athlete?.id ?? "",
        name: p.athlete?.displayName ?? "",
        position: p.athlete?.position?.abbreviation ?? "",
        jersey: p.athlete?.jersey ?? "",
        starter: p.starter ?? false,
        headshot: p.athlete?.headshot?.href,
        injuries: p.athlete?.injuries?.[0]
          ? {
              status: p.athlete.injuries[0].status,
              detail: p.athlete.injuries[0].details?.detail ?? "",
            }
          : undefined,
      }));

      return {
        id: team?.id ?? "",
        name: team?.displayName ?? "",
        abbreviation: team?.abbreviation ?? "",
        record: competitor?.record?.[0]?.displayValue ?? "",
        logo: team?.logos?.[0]?.href ?? "",
        players,
        injuries: [],
      };
    };

    const competitors = competitions?.competitors ?? [];
    const homeComp = competitors.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.homeAway === "home"
    );
    const awayComp = competitors.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.homeAway === "away"
    );
    const homeIdx = competitors.indexOf(homeComp);
    const awayIdx = competitors.indexOf(awayComp);

    const homeTeam = parseTeam(homeComp, homeIdx);
    const awayTeam = parseTeam(awayComp, awayIdx);

    // Get injuries for both teams
    const [homeInjuries, awayInjuries] = await Promise.all([
      getTeamInjuries(sportKey, homeTeam.id),
      getTeamInjuries(sportKey, awayTeam.id),
    ]);
    homeTeam.injuries = homeInjuries;
    awayTeam.injuries = awayInjuries;

    // Parse odds from ESPN
    const pickcenter = summary?.pickcenter?.[0];
    const odds = pickcenter
      ? {
          spread: pickcenter.details ?? "",
          overUnder: pickcenter.overUnder?.toString() ?? "",
          details: pickcenter.provider?.name ?? "",
        }
      : undefined;

    // Parse leaders
    const leadersData = summary?.leaders;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseLeaders = (teamLeaders: any) => {
      if (!teamLeaders?.leaders) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return teamLeaders.leaders.slice(0, 3).map((l: any) => ({
        name: l.leaders?.[0]?.athlete?.displayName ?? "",
        stat: l.displayName ?? "",
        value: l.leaders?.[0]?.displayValue ?? "",
      }));
    };

    return {
      id: espnGameId,
      status: header?.competitions?.[0]?.status?.type?.state ?? "pre",
      homeTeam,
      awayTeam,
      venue: competitions?.venue?.fullName ?? "",
      broadcast: competitions?.broadcasts?.[0]?.media?.shortName ?? "",
      odds,
      leaders: leadersData
        ? {
            home: parseLeaders(leadersData[homeIdx]),
            away: parseLeaders(leadersData[awayIdx]),
          }
        : undefined,
    };
  } catch (err) {
    console.error("ESPN game data error:", err);
    return null;
  }
}

/**
 * Get player game log from ESPN
 */
export async function getESPNPlayerGameLog(
  playerId: string,
  season?: number
): Promise<ESPNPlayerGameLog[]> {
  try {
    const yr = season ?? new Date().getFullYear();
    const { data } = await axios.get(
      `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${yr}`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = data?.events ?? {};
    const logs: ESPNPlayerGameLog[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [, event] of Object.entries(events) as [string, any][]) {
      const stats = event?.stats ?? [];
      if (stats.length === 0) continue;

      logs.push({
        date: event?.gameDate ?? "",
        opponent: event?.opponent?.abbreviation ?? "",
        result: event?.gameResult ?? "",
        minutes: parseFloat(stats[0]) || 0,
        fgm: parseFloat(stats[1]) || 0,
        fga: parseFloat(stats[2]) || 0,
        fg3m: parseFloat(stats[4]) || 0,
        fg3a: parseFloat(stats[5]) || 0,
        ftm: parseFloat(stats[7]) || 0,
        fta: parseFloat(stats[8]) || 0,
        rebounds: parseFloat(stats[10]) || 0,
        assists: parseFloat(stats[11]) || 0,
        steals: parseFloat(stats[13]) || 0,
        blocks: parseFloat(stats[12]) || 0,
        turnovers: parseFloat(stats[14]) || 0,
        points: parseFloat(stats[15]) || 0,
        plusMinus: parseFloat(stats[16]) || 0,
      });
    }

    return logs.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Get player stats overview from ESPN
 */
export async function getESPNPlayerStats(
  playerId: string
): Promise<{
  seasonAverages: Record<string, string>;
  splits: { home: Record<string, string>; away: Record<string, string> };
} | null> {
  try {
    const { data } = await axios.get(
      `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/stats`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories = data?.categories ?? [];
    const seasonAverages: Record<string, string> = {};
    const home: Record<string, string> = {};
    const away: Record<string, string> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const cat of categories) {
      const names: string[] = cat.names ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totals = cat.totals ?? [];
      names.forEach((name: string, i: number) => {
        if (totals[i] !== undefined) seasonAverages[name] = totals[i];
      });
    }

    return { seasonAverages, splits: { home, away } };
  } catch {
    return null;
  }
}

/**
 * Get today's ESPN scoreboard with team records, game IDs, etc.
 */
export async function getESPNTodayGames(sportKey: string): Promise<
  {
    espnGameId: string;
    homeTeam: { name: string; abbreviation: string; record: string; id: string };
    awayTeam: { name: string; abbreviation: string; record: string; id: string };
    status: string;
    startTime: string;
    venue: string;
  }[]
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoreboard = (await getESPNScoreboard(sportKey)) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (scoreboard?.events ?? []).map((event: any) => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const home = competitors.find((c: any) => c.homeAway === "home");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const away = competitors.find((c: any) => c.homeAway === "away");
      return {
        espnGameId: event.id,
        homeTeam: {
          name: home?.team?.displayName ?? "",
          abbreviation: home?.team?.abbreviation ?? "",
          record: home?.records?.[0]?.summary ?? "",
          id: home?.team?.id ?? "",
        },
        awayTeam: {
          name: away?.team?.displayName ?? "",
          abbreviation: away?.team?.abbreviation ?? "",
          record: away?.records?.[0]?.summary ?? "",
          id: away?.team?.id ?? "",
        },
        status: event.status?.type?.state ?? "pre",
        startTime: event.date ?? "",
        venue: competition?.venue?.fullName ?? "",
      };
    });
  } catch {
    return [];
  }
}

/**
 * Find ESPN game ID from team names (matches Odds API game to ESPN game)
 */
export async function findESPNGameId(
  sportKey: string,
  homeTeam: string,
  awayTeam: string
): Promise<string | null> {
  const games = await getESPNTodayGames(sportKey);
  const match = games.find(
    (g) =>
      (g.homeTeam.name.includes(homeTeam) || homeTeam.includes(g.homeTeam.name) ||
       g.homeTeam.abbreviation === homeTeam) &&
      (g.awayTeam.name.includes(awayTeam) || awayTeam.includes(g.awayTeam.name) ||
       g.awayTeam.abbreviation === awayTeam)
  );
  return match?.espnGameId ?? null;
}

/**
 * Search for ESPN player by name and get their ID
 */
export async function searchESPNPlayer(
  name: string
): Promise<{ id: string; name: string; team: string; position: string } | null> {
  try {
    const { data } = await axios.get(
      `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes?limit=5&search=${encodeURIComponent(name)}`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const athlete = data?.items?.[0] ?? data?.athletes?.[0];
    if (!athlete) return null;
    return {
      id: athlete.id,
      name: athlete.displayName ?? athlete.fullName ?? name,
      team: athlete.team?.abbreviation ?? "",
      position: athlete.position?.abbreviation ?? "",
    };
  } catch {
    return null;
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
