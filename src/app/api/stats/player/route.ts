import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import {
  searchESPNPlayer,
  getESPNPlayerGameLog,
  getESPNPlayerStats,
  getESPNTodayGames,
} from "@/lib/stats-api";
import { rateLimit, getIP, rateLimitResponse } from "@/lib/rate-limit";

// Cache leaders for 30 minutes
let leadersCache: { data: unknown; timestamp: number } | null = null;
const LEADERS_CACHE_TTL = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const rl = rateLimit("stats-player", ip, 30, 60000);
  if (rl.limited) return rateLimitResponse(rl.resetIn);

  const search = req.nextUrl.searchParams.get("search");
  const playerId = req.nextUrl.searchParams.get("playerId");
  const leaders = req.nextUrl.searchParams.get("leaders");
  const standings = req.nextUrl.searchParams.get("standings");

  try {
    // ===== LEAGUE LEADERS =====
    if (leaders === "true") {
      if (leadersCache && Date.now() - leadersCache.timestamp < LEADERS_CACHE_TTL) {
        return NextResponse.json(leadersCache.data);
      }

      // Use known star player IDs (ESPN search is unreliable)
      const STAR_PLAYERS = [
        { id: "4868666", name: "Victor Wembanyama", team: "SA", position: "C" },
        { id: "4395725", name: "Luka Doncic", team: "LAL", position: "G" },
        { id: "4278073", name: "Shai Gilgeous-Alexander", team: "OKC", position: "G" },
        { id: "4065648", name: "Jayson Tatum", team: "BOS", position: "F" },
        { id: "3032977", name: "Giannis Antetokounmpo", team: "MIL", position: "F" },
        { id: "4432166", name: "Anthony Edwards", team: "MIN", position: "G" },
        { id: "1966", name: "LeBron James", team: "LAL", position: "F" },
        { id: "3975", name: "Stephen Curry", team: "GS", position: "G" },
        { id: "3202", name: "Kevin Durant", team: "PHX", position: "F" },
        { id: "3112335", name: "Nikola Jokic", team: "DEN", position: "C" },
        { id: "3934672", name: "Jalen Brunson", team: "NY", position: "G" },
        { id: "4066328", name: "Tyrese Haliburton", team: "IND", position: "G" },
        { id: "3136193", name: "Devin Booker", team: "PHX", position: "G" },
        { id: "4277905", name: "Trae Young", team: "ATL", position: "G" },
        { id: "6583", name: "Anthony Davis", team: "LAL", position: "F" },
        { id: "4066259", name: "De'Aaron Fox", team: "SAC", position: "G" },
        { id: "3908809", name: "Donovan Mitchell", team: "CLE", position: "G" },
        { id: "4279888", name: "Ja Morant", team: "MEM", position: "G" },
        { id: "4432166", name: "Cade Cunningham", team: "DET", position: "G" },
        { id: "4433255", name: "Paolo Banchero", team: "ORL", position: "F" },
      ];

      // Fetch game logs by ID (much faster than searching by name)
      const playerStats: {
        name: string;
        team: string;
        position: string;
        id: string;
        ppg: number;
        rpg: number;
        apg: number;
        threes: number;
        spg: number;
        bpg: number;
        last5: number[];
      }[] = [];

      const batchSize = 5;
      for (let i = 0; i < STAR_PLAYERS.length; i += batchSize) {
        const batch = STAR_PLAYERS.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (player) => {
            try {
              const logs = await getESPNPlayerGameLog(player.id);
              if (logs.length < 5) return null;

              const last20 = logs.slice(0, 20);
              const avg = (key: "points" | "rebounds" | "assists" | "fg3m" | "steals" | "blocks") =>
                last20.reduce((s, g) => s + g[key], 0) / last20.length;

              return {
                name: player.name,
                team: player.team,
                position: player.position,
                id: player.id,
                ppg: Math.round(avg("points") * 10) / 10,
                rpg: Math.round(avg("rebounds") * 10) / 10,
                apg: Math.round(avg("assists") * 10) / 10,
                threes: Math.round(avg("fg3m") * 10) / 10,
                spg: Math.round(avg("steals") * 10) / 10,
                bpg: Math.round(avg("blocks") * 10) / 10,
                last5: logs.slice(0, 5).map((g) => g.points),
              };
            } catch {
              return null;
            }
          })
        );
        playerStats.push(
          ...results.filter((r): r is NonNullable<typeof r> => r !== null)
        );
      }

      const leaderData = {
        points: [...playerStats].sort((a, b) => b.ppg - a.ppg).slice(0, 5),
        rebounds: [...playerStats].sort((a, b) => b.rpg - a.rpg).slice(0, 5),
        assists: [...playerStats].sort((a, b) => b.apg - a.apg).slice(0, 5),
        threes: [...playerStats].sort((a, b) => b.threes - a.threes).slice(0, 5),
        steals: [...playerStats].sort((a, b) => b.spg - a.spg).slice(0, 5),
        blocks: [...playerStats].sort((a, b) => b.bpg - a.bpg).slice(0, 5),
      };

      leadersCache = { data: leaderData, timestamp: Date.now() };
      return NextResponse.json(leaderData);
    }

    // ===== STANDINGS =====
    if (standings === "true") {
      try {
        const { data } = await axios.get(
          "https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2026"
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conferences = (data.children ?? []).map((conf: any) => ({
          name: conf.name,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          teams: (conf.standings?.entries ?? []).map((entry: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const getStat = (name: string) => entry.stats?.find((s: any) => s.name === name)?.displayValue ?? "0";
            return {
              name: entry.team?.displayName ?? "",
              abbreviation: entry.team?.abbreviation ?? "",
              logo: entry.team?.logos?.[0]?.href ?? "",
              wins: getStat("wins"),
              losses: getStat("losses"),
              winPct: getStat("winPercent"),
              gb: getStat("gamesBehind"),
              streak: getStat("streak"),
              ppg: getStat("avgPointsFor"),
              oppPpg: getStat("avgPointsAgainst"),
            };
          }),
        }));
        return NextResponse.json({ conferences });
      } catch {
        return NextResponse.json({ conferences: [] });
      }
    }

    // ===== PLAYER PROFILE =====
    if (playerId) {
      const [logs, stats] = await Promise.all([
        getESPNPlayerGameLog(playerId),
        getESPNPlayerStats(playerId),
      ]);

      return NextResponse.json({
        playerId,
        gameLogs: logs,
        seasonAverages: stats?.seasonAverages ?? {},
        splits: stats?.splits ?? { home: {}, away: {} },
      });
    }

    // ===== PLAYER SEARCH =====
    if (search && search.length >= 2) {
      // Try ESPN search first
      const searchLower = search.toLowerCase();
      let player = await searchESPNPlayer(search);

      // Fallback: search through today's game rosters
      if (!player) {
        const todayGames = await getESPNTodayGames("nba");

        // Get team IDs from today's games
        const teamIds = todayGames.flatMap((g) => [g.homeTeam.id, g.awayTeam.id]).filter(Boolean);
        const teamAbbrMap = new Map<string, string>();
        for (const g of todayGames) {
          teamAbbrMap.set(g.homeTeam.id, g.homeTeam.abbreviation);
          teamAbbrMap.set(g.awayTeam.id, g.awayTeam.abbreviation);
        }

        // Search through rosters (check max 6 teams)
        for (const teamId of teamIds.slice(0, 6)) {
          try {
            const { data } = await axios.get(
              `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const athletes = (data.athletes ?? []) as any[];
            const match = athletes.find(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (a: any) => a.displayName?.toLowerCase().includes(searchLower)
            );
            if (match) {
              player = {
                id: match.id,
                name: match.displayName,
                team: teamAbbrMap.get(teamId) ?? "",
                position: match.position?.abbreviation ?? "",
              };
              break;
            }
          } catch { /* continue searching */ }
        }
      }

      // Still try well-known player IDs as last resort
      if (!player) {
        const KNOWN_PLAYERS: Record<string, { id: string; name: string; team: string; position: string }> = {
          giannis: { id: "3032977", name: "Giannis Antetokounmpo", team: "MIL", position: "F" },
          lebron: { id: "1966", name: "LeBron James", team: "LAL", position: "F" },
          curry: { id: "3975", name: "Stephen Curry", team: "GS", position: "G" },
          steph: { id: "3975", name: "Stephen Curry", team: "GS", position: "G" },
          luka: { id: "4395725", name: "Luka Doncic", team: "LAL", position: "G" },
          jokic: { id: "3112335", name: "Nikola Jokic", team: "DEN", position: "C" },
          wemby: { id: "4868666", name: "Victor Wembanyama", team: "SA", position: "C" },
          wembanyama: { id: "4868666", name: "Victor Wembanyama", team: "SA", position: "C" },
          tatum: { id: "4065648", name: "Jayson Tatum", team: "BOS", position: "F" },
          sga: { id: "4278073", name: "Shai Gilgeous-Alexander", team: "OKC", position: "G" },
          ant: { id: "4432166", name: "Anthony Edwards", team: "MIN", position: "G" },
          edwards: { id: "4432166", name: "Anthony Edwards", team: "MIN", position: "G" },
          booker: { id: "3136193", name: "Devin Booker", team: "PHX", position: "G" },
          brunson: { id: "3934672", name: "Jalen Brunson", team: "NY", position: "G" },
          durant: { id: "3202", name: "Kevin Durant", team: "PHX", position: "F" },
          kd: { id: "3202", name: "Kevin Durant", team: "PHX", position: "F" },
          davis: { id: "6583", name: "Anthony Davis", team: "LAL", position: "F" },
          morant: { id: "4279888", name: "Ja Morant", team: "MEM", position: "G" },
          fox: { id: "4066259", name: "De'Aaron Fox", team: "SAC", position: "G" },
          harden: { id: "3992", name: "James Harden", team: "LAC", position: "G" },
          mitchell: { id: "3908809", name: "Donovan Mitchell", team: "CLE", position: "G" },
          young: { id: "4277905", name: "Trae Young", team: "ATL", position: "G" },
          cunningham: { id: "4432166", name: "Cade Cunningham", team: "DET", position: "G" },
        };

        const matchKey = Object.keys(KNOWN_PLAYERS).find((k) =>
          searchLower.includes(k)
        );
        if (matchKey) player = KNOWN_PLAYERS[matchKey];
      }

      if (!player) {
        return NextResponse.json({ results: [] });
      }

      // Get game logs for the found player
      const logs = await getESPNPlayerGameLog(player.id);
      const last10 = logs.slice(0, 10);
      const avg = (key: "points" | "rebounds" | "assists" | "fg3m") =>
        last10.length > 0
          ? Math.round(
              (last10.reduce((s, g) => s + g[key], 0) / last10.length) * 10
            ) / 10
          : 0;

      return NextResponse.json({
        results: [
          {
            id: player.id,
            name: player.name,
            team: player.team,
            position: player.position,
            ppg: avg("points"),
            rpg: avg("rebounds"),
            apg: avg("assists"),
            threes: avg("fg3m"),
            gameLogs: logs,
          },
        ],
      });
    }

    return NextResponse.json({ error: "Provide search, playerId, leaders, or standings parameter" }, { status: 400 });
  } catch (err) {
    console.error("Stats player error:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
