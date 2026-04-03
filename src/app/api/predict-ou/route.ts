import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getOdds, getPlayerProps } from "@/lib/odds-api";
import {
  getESPNTodayGames,
  findESPNGameId,
  getESPNPlayerGameLog,
  searchESPNPlayer,
  ESPNPlayerGameLog,
} from "@/lib/stats-api";
import {
  predictAllProps,
  PredictionInput,
  OUPrediction,
  buildPredictionHailMary,
  buildOUMegaParlay,
  PredictionParlay,
} from "@/lib/prediction-engine";
import { SportKey } from "@/lib/types";

// Cache predictions for 15 minutes
let cache: {
  data: {
    predictions: OUPrediction[];
    hailMary: PredictionParlay | null;
    megaParlay: PredictionParlay | null;
    source: "api" | "synthetic";
  };
  timestamp: number;
  sport: string;
} | null = null;
const CACHE_TTL = 15 * 60 * 1000;

const MAX_GAMES = 4;
const MAX_PLAYERS_PER_GAME = 8;
const SYNTHETIC_STATS: { stat: PredictionInput["stat"]; logKey: keyof ESPNPlayerGameLog }[] = [
  { stat: "points", logKey: "points" },
  { stat: "rebounds", logKey: "rebounds" },
  { stat: "assists", logKey: "assists" },
  { stat: "threes", logKey: "fg3m" },
];

// ============ HELPERS ============

/** Round a number to the nearest 0.5 */
function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Calculate average of a stat over game logs */
function statAverage(logs: ESPNPlayerGameLog[], key: keyof ESPNPlayerGameLog): number {
  if (logs.length === 0) return 0;
  const sum = logs.reduce((acc, g) => acc + (g[key] as number), 0);
  return sum / logs.length;
}

/** Match an Odds API team name to an ESPN game using fuzzy last-word matching */
function matchTeamName(oddsTeam: string, espnTeam: string): boolean {
  const oddsLast = oddsTeam.split(" ").pop()!.toLowerCase();
  const espnLast = espnTeam.split(" ").pop()!.toLowerCase();
  return (
    oddsLast === espnLast ||
    oddsTeam.toLowerCase().includes(espnTeam.toLowerCase()) ||
    espnTeam.toLowerCase().includes(oddsTeam.toLowerCase())
  );
}

// ============ REAL PROPS FROM ODDS API ============

async function fetchRealProps(
  sport: SportKey,
  targetGames: Awaited<ReturnType<typeof getOdds>>,
  espnGames: Awaited<ReturnType<typeof getESPNTodayGames>>
): Promise<PredictionInput[]> {
  const allInputs: PredictionInput[] = [];

  const batchSize = 3;
  for (let i = 0; i < targetGames.length; i += batchSize) {
    const batch = targetGames.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (game) => {
        try {
          const propsData = await getPlayerProps(sport, game.id);

          // Extract prop lines from all bookmakers
          const propLines: {
            player: string;
            market: string;
            line: number;
            overOdds: number;
            underOdds: number;
            book: string;
          }[] = [];

          for (const g of propsData) {
            for (const bookmaker of g.bookmakers) {
              for (const market of bookmaker.markets) {
                const marketName = market.key
                  .replace("player_", "")
                  .replace("_alternate", "");
                const overOutcome = market.outcomes.find((o) => o.name === "Over");
                const underOutcome = market.outcomes.find((o) => o.name === "Under");
                if (overOutcome?.description && overOutcome.point !== undefined) {
                  propLines.push({
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

          if (propLines.length === 0) return [];

          // Deduplicate: best odds per player+market+line
          const bestProps = new Map<string, (typeof propLines)[0]>();
          for (const p of propLines) {
            const key = `${p.player}-${p.market}-${p.line}`;
            const existing = bestProps.get(key);
            if (!existing || p.overOdds > existing.overOdds) {
              bestProps.set(key, p);
            }
          }

          // Match ESPN game
          const espnMatch = espnGames.find(
            (eg) =>
              matchTeamName(game.home_team, eg.homeTeam.name) ||
              matchTeamName(game.away_team, eg.awayTeam.name)
          );

          // Get spread for blowout detection
          const spreadMarket = game.bookmakers[0]?.markets.find(
            (m) => m.key === "spreads"
          );
          const homeSpread = spreadMarket?.outcomes.find(
            (o) => o.name === game.home_team
          )?.point;

          // Get game logs for each unique player
          const uniquePlayers = Array.from(
            new Set(Array.from(bestProps.values()).map((p) => p.player))
          );

          const playerLogMap: Record<string, ESPNPlayerGameLog[]> = {};
          const playerTeamMap: Record<string, string> = {};
          for (let j = 0; j < uniquePlayers.length; j += 5) {
            const playerBatch = uniquePlayers.slice(j, j + 5);
            const logResults = await Promise.all(
              playerBatch.map(async (playerName) => {
                const espnPlayer = await searchESPNPlayer(playerName);
                if (!espnPlayer) return { name: playerName, logs: [] as ESPNPlayerGameLog[], teamAbbr: "" };
                const logs = await getESPNPlayerGameLog(espnPlayer.id);
                return { name: playerName, logs, teamAbbr: espnPlayer.team ?? "" };
              })
            );
            for (const result of logResults) {
              playerLogMap[result.name] = result.logs;
              playerTeamMap[result.name] = result.teamAbbr;
            }
          }

          // Build prediction inputs
          const inputs: PredictionInput[] = [];
          for (const prop of Array.from(bestProps.values())) {
            const logs = playerLogMap[prop.player];
            if (!logs || logs.length < 3) continue;

            const statType =
              prop.market === "points"
                ? "points"
                : prop.market === "rebounds"
                  ? "rebounds"
                  : prop.market === "assists"
                    ? "assists"
                    : prop.market === "threes"
                      ? "threes"
                      : null;

            if (!statType) continue;

            // Determine team abbreviation from ESPN player search or ESPN match data
            const playerTeamAbbr = playerTeamMap[prop.player] || "";
            const isHome = playerTeamAbbr
              ? (espnMatch?.homeTeam.abbreviation ?? "").toUpperCase() === playerTeamAbbr.toUpperCase()
              : !!espnMatch?.homeTeam.name;

            // Fall back to ESPN match abbreviation if player search didn't return team
            const team = playerTeamAbbr
              || (isHome
                ? (espnMatch?.homeTeam.abbreviation ?? "")
                : (espnMatch?.awayTeam.abbreviation ?? ""));

            inputs.push({
              player: prop.player,
              team,
              stat: statType as PredictionInput["stat"],
              line: prop.line,
              overOdds: prop.overOdds,
              underOdds: prop.underOdds,
              book: prop.book,
              gameLogs: logs,
              isHome: !!isHome,
              spread: homeSpread,
              gameId: game.id,
            });
          }

          return inputs;
        } catch (err) {
          console.error(`Error fetching real props for game ${game.id}:`, err);
          return [];
        }
      })
    );

    allInputs.push(...batchResults.flat());
  }

  return allInputs;
}

// ============ SYNTHETIC PROPS FROM ESPN GAME LOGS ============

async function generateSyntheticProps(
  sport: SportKey,
  targetGames: Awaited<ReturnType<typeof getOdds>>,
  espnGames: Awaited<ReturnType<typeof getESPNTodayGames>>
): Promise<PredictionInput[]> {
  const allInputs: PredictionInput[] = [];

  // Limit to MAX_GAMES to keep API usage reasonable
  const gamesToProcess = targetGames.slice(0, MAX_GAMES);

  const gameResults = await Promise.all(
    gamesToProcess.map(async (game) => {
      try {
        // Step 1: Match this Odds API game to an ESPN game
        // Try both-team match first, then single-team match
        let espnMatch = espnGames.find(
          (eg) =>
            matchTeamName(game.home_team, eg.homeTeam.name) &&
            matchTeamName(game.away_team, eg.awayTeam.name)
        );
        if (!espnMatch) {
          // Fallback: match on either team name
          espnMatch = espnGames.find(
            (eg) =>
              matchTeamName(game.home_team, eg.homeTeam.name) ||
              matchTeamName(game.away_team, eg.awayTeam.name) ||
              matchTeamName(game.home_team, eg.awayTeam.name) ||
              matchTeamName(game.away_team, eg.homeTeam.name)
          );
        }

        let espnGameId = espnMatch?.espnGameId ?? null;
        if (!espnGameId) {
          espnGameId = await findESPNGameId(sport, game.home_team, game.away_team);
        }

        // Step 2: Get spread for blowout detection
        const spreadMarket = game.bookmakers[0]?.markets.find(
          (m) => m.key === "spreads"
        );
        const homeSpread = spreadMarket?.outcomes.find(
          (o) => o.name === game.home_team
        )?.point;

        // Step 3: Get players from ESPN team rosters (works even before game time)
        // Use the matched ESPN game to get team IDs, or search by name
        const homeTeamId = espnMatch?.homeTeam.id;
        const awayTeamId = espnMatch?.awayTeam.id;

        interface RosterPlayer { id: string; name: string; position: string; teamAbbr: string; teamName: string; isHome: boolean }
        const allPlayers: RosterPlayer[] = [];

        // Fetch rosters using team IDs from ESPN scoreboard
        if (homeTeamId || awayTeamId) {
          const fetchRoster = async (teamId: string, teamAbbr: string, teamName: string, isHome: boolean) => {
            try {
              const { data } = await axios.get(
                `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`
              );
              const athletes = (data.athletes ?? []) as { id: string; displayName: string; position?: { abbreviation?: string } }[];
              return athletes.slice(0, Math.ceil(MAX_PLAYERS_PER_GAME / 2)).map((a) => ({
                id: a.id,
                name: a.displayName,
                position: a.position?.abbreviation ?? "",
                teamAbbr,
                teamName,
                isHome,
              }));
            } catch {
              return [];
            }
          };

          if (homeTeamId) {
            const homePlayers = await fetchRoster(
              homeTeamId,
              espnMatch?.homeTeam.abbreviation ?? "",
              espnMatch?.homeTeam.name ?? game.home_team,
              true
            );
            allPlayers.push(...homePlayers);
          }
          if (awayTeamId) {
            const awayPlayers = await fetchRoster(
              awayTeamId,
              espnMatch?.awayTeam.abbreviation ?? "",
              espnMatch?.awayTeam.name ?? game.away_team,
              false
            );
            allPlayers.push(...awayPlayers);
          }
        }

        if (allPlayers.length === 0) {
          console.warn(`No roster players for: ${game.away_team} @ ${game.home_team}`);
          return [];
        }

        // Step 5: Fetch game logs for each player (parallel, batched)
        const playerInputs: PredictionInput[] = [];
        const playerBatchSize = 4;

        for (let j = 0; j < allPlayers.length; j += playerBatchSize) {
          const playerBatch = allPlayers.slice(j, j + playerBatchSize);
          const logResults = await Promise.all(
            playerBatch.map(async (player) => {
              try {
                // ESPN game data already gives us the player ID
                const logs = await getESPNPlayerGameLog(player.id);
                return { player, logs };
              } catch {
                // If direct ID fails, try searching by name
                try {
                  const found = await searchESPNPlayer(player.name);
                  if (!found) return { player, logs: [] as ESPNPlayerGameLog[] };
                  const logs = await getESPNPlayerGameLog(found.id);
                  return { player, logs };
                } catch {
                  return { player, logs: [] as ESPNPlayerGameLog[] };
                }
              }
            })
          );

          // Step 6: Generate synthetic lines from game logs
          for (const { player, logs } of logResults) {
            if (logs.length < 3) continue; // Need at least 3 games of data

            const last10 = logs.slice(0, 10);

            // Skip players with very low minutes (likely bench players)
            const avgMinutes = statAverage(last10, "minutes");
            if (avgMinutes < 15) continue;

            for (const { stat, logKey } of SYNTHETIC_STATS) {
              const avg = statAverage(last10, logKey);

              // Skip stats with very low averages (not meaningful lines)
              if (stat === "points" && avg < 5) continue;
              if (stat === "rebounds" && avg < 2) continue;
              if (stat === "assists" && avg < 1.5) continue;
              if (stat === "threes" && avg < 0.5) continue;

              const line = roundToHalf(avg);
              if (line <= 0) continue;

              playerInputs.push({
                player: player.name,
                team: player.teamAbbr,
                stat,
                line,
                overOdds: -110,
                underOdds: -110,
                book: "Synthetic",
                gameLogs: logs,
                isHome: player.isHome,
                spread: homeSpread,
                gameId: game.id,
              });
            }
          }
        }

        return playerInputs;
      } catch (err) {
        console.error(
          `Error generating synthetic props for ${game.away_team} @ ${game.home_team}:`,
          err
        );
        return [];
      }
    })
  );

  allInputs.push(...gameResults.flat());
  return allInputs;
}

// ============ MAIN ROUTE ============

export async function GET(req: NextRequest) {
  const sport = (req.nextUrl.searchParams.get("sport") ?? "nba") as SportKey;
  const gameId = req.nextUrl.searchParams.get("gameId");
  const blacklistParam = req.nextUrl.searchParams.get("blacklist");
  const blacklist = blacklistParam ? blacklistParam.split(",") : [];

  try {
    // Check cache
    if (
      cache &&
      cache.sport === sport &&
      Date.now() - cache.timestamp < CACHE_TTL &&
      !gameId
    ) {
      const filtered = cache.data.predictions.filter(
        (p) => !blacklist.includes(p.player)
      );
      return NextResponse.json({
        predictions: filtered,
        hailMary: cache.data.hailMary,
        megaParlay: cache.data.megaParlay,
        cached: true,
        source: cache.data.source,
      });
    }

    // Step 1: Get ESPN games (always free) + try Odds API (may be rate-limited)
    const espnGames = await getESPNTodayGames(sport);

    let odds: Awaited<ReturnType<typeof getOdds>> = [];
    try {
      odds = await getOdds(sport);
    } catch (err) {
      console.warn("Odds API unavailable (likely quota exceeded), using ESPN only:", String(err).slice(0, 100));
    }

    // Filter to specific game if requested
    const targetGames = gameId
      ? odds.filter((g) => g.id === gameId)
      : odds;

    // Step 2: Try real player props from The Odds API first (only if odds loaded)
    let allInputs: PredictionInput[] = [];
    let source: "api" | "synthetic" = "api";

    if (targetGames.length > 0) {
      try {
        allInputs = await fetchRealProps(sport, targetGames, espnGames);
      } catch (err) {
        console.warn("Real props fetch failed:", String(err).slice(0, 100));
      }
    }

    // Step 3: If no real props, generate synthetic lines from ESPN game logs
    if (allInputs.length === 0) {
      console.log(
        `No real props for ${sport} — generating synthetic O/U lines from ESPN`
      );
      source = "synthetic";

      // If we have odds games, use those for matching; otherwise ESPN games are all we have
      if (targetGames.length > 0) {
        allInputs = await generateSyntheticProps(sport, targetGames, espnGames);
      } else if (espnGames.length > 0) {
        // Create minimal "fake" game objects from ESPN data so synthetic generation can work
        const fakeGames = espnGames.map((eg) => ({
          id: eg.espnGameId,
          sport_key: sport,
          sport_title: "NBA",
          commence_time: eg.startTime,
          home_team: eg.homeTeam.name,
          away_team: eg.awayTeam.name,
          bookmakers: [] as Awaited<ReturnType<typeof getOdds>>[0]["bookmakers"],
        }));
        allInputs = await generateSyntheticProps(sport, fakeGames, espnGames);
      }
    }

    if (allInputs.length === 0) {
      return NextResponse.json({
        predictions: [],
        hailMary: null,
        megaParlay: null,
        source: "none",
        message: "No player data available. Games may not have started yet.",
      });
    }

    // Step 4: Run predictions
    const predictions = predictAllProps(allInputs);

    // Step 5: Build parlays
    const hailMary = buildPredictionHailMary(predictions, blacklist);
    const megaParlay = buildOUMegaParlay(predictions, 15, blacklist);

    // Cache results (only for non-game-specific requests)
    if (!gameId) {
      cache = {
        data: { predictions, hailMary, megaParlay, source },
        timestamp: Date.now(),
        sport,
      };
    }

    // Filter blacklisted players from response
    const filtered = predictions.filter(
      (p) => !blacklist.includes(p.player)
    );

    return NextResponse.json({
      predictions: filtered,
      hailMary,
      megaParlay,
      totalGames: targetGames.length,
      totalProps: filtered.length,
      source,
    });
  } catch (err) {
    console.error("Prediction engine error:", err);
    return NextResponse.json(
      { error: "Failed to generate predictions", details: String(err) },
      { status: 500 }
    );
  }
}
