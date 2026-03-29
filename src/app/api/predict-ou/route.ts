import { NextRequest, NextResponse } from "next/server";
import { getOdds, getPlayerProps } from "@/lib/odds-api";
import { getESPNTodayGames, getESPNPlayerGameLog, searchESPNPlayer } from "@/lib/stats-api";
import { predictAllProps, PredictionInput, OUPrediction, buildPredictionHailMary, buildOUMegaParlay, PredictionParlay } from "@/lib/prediction-engine";
import { SportKey } from "@/lib/types";

// Cache predictions for 10 minutes
let cache: { data: { predictions: OUPrediction[]; hailMary: PredictionParlay | null; megaParlay: PredictionParlay | null }; timestamp: number; sport: string } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const sport = (req.nextUrl.searchParams.get("sport") ?? "nba") as SportKey;
  const gameId = req.nextUrl.searchParams.get("gameId");
  const blacklistParam = req.nextUrl.searchParams.get("blacklist");
  const blacklist = blacklistParam ? blacklistParam.split(",") : [];

  try {
    // Check cache
    if (cache && cache.sport === sport && Date.now() - cache.timestamp < CACHE_TTL && !gameId) {
      // Filter blacklist from cached results
      const filtered = cache.data.predictions.filter(
        (p) => !blacklist.includes(p.player)
      );
      return NextResponse.json({
        predictions: filtered,
        hailMary: cache.data.hailMary,
        megaParlay: cache.data.megaParlay,
        cached: true,
      });
    }

    // Step 1: Get today's odds with player props
    const [odds, espnGames] = await Promise.all([
      getOdds(sport),
      getESPNTodayGames(sport),
    ]);

    // Filter to specific game if requested
    const targetGames = gameId
      ? odds.filter((g) => g.id === gameId)
      : odds;

    if (targetGames.length === 0) {
      return NextResponse.json({ predictions: [], hailMary: null, megaParlay: null });
    }

    // Step 2: Fetch player props for each game
    const allInputs: PredictionInput[] = [];

    // Process games in parallel (max 3 at a time to be nice to the API)
    const batchSize = 3;
    for (let i = 0; i < targetGames.length; i += batchSize) {
      const batch = targetGames.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (game) => {
          try {
            // Get player props from The Odds API
            const propsData = await getPlayerProps(sport, game.id);

            // Extract prop lines
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
                game.home_team.includes(eg.homeTeam.name.split(" ").pop()!) ||
                eg.homeTeam.name.includes(game.home_team.split(" ").pop()!)
            );

            // Get spread for blowout detection
            const spreadMarket = game.bookmakers[0]?.markets.find(
              (m) => m.key === "spreads"
            );
            const homeSpread = spreadMarket?.outcomes.find(
              (o) => o.name === game.home_team
            )?.point;

            // Get game logs for each player with props
            const uniquePlayers = Array.from(
              new Set(Array.from(bestProps.values()).map((p) => p.player))
            );

            const playerLogMap: Record<string, Awaited<ReturnType<typeof getESPNPlayerGameLog>>> = {};

            // Fetch player logs in parallel (max 5 at a time)
            for (let j = 0; j < uniquePlayers.length; j += 5) {
              const playerBatch = uniquePlayers.slice(j, j + 5);
              const logResults = await Promise.all(
                playerBatch.map(async (playerName) => {
                  const espnPlayer = await searchESPNPlayer(playerName);
                  if (!espnPlayer) return { name: playerName, logs: [] };
                  const logs = await getESPNPlayerGameLog(espnPlayer.id);
                  return { name: playerName, logs };
                })
              );
              for (const result of logResults) {
                playerLogMap[result.name] = result.logs;
              }
            }

            // Build prediction inputs
            const inputs: PredictionInput[] = [];
            for (const prop of Array.from(bestProps.values())) {
              const logs = playerLogMap[prop.player];
              if (!logs || logs.length < 3) continue;

              const statType = prop.market === "points"
                ? "points"
                : prop.market === "rebounds"
                  ? "rebounds"
                  : prop.market === "assists"
                    ? "assists"
                    : prop.market === "threes"
                      ? "threes"
                      : null;

              if (!statType) continue;

              // Determine home/away (simple heuristic — will refine with full roster data)
              const isHome = game.home_team.includes(prop.player.split(" ").pop()!) ||
                !!espnMatch?.homeTeam.name;

              inputs.push({
                player: prop.player,
                team: "", // Will be populated from ESPN data
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
            console.error(`Error processing game ${game.id}:`, err);
            return [];
          }
        })
      );

      allInputs.push(...batchResults.flat());
    }

    // Step 3: Run predictions
    const predictions = predictAllProps(allInputs);

    // Step 4: Build Safe Hail Mary and Mega Parlay
    const hailMary = buildPredictionHailMary(predictions, blacklist);
    const megaParlay = buildOUMegaParlay(predictions, 15, blacklist);

    // Cache results
    if (!gameId) {
      cache = {
        data: { predictions, hailMary, megaParlay },
        timestamp: Date.now(),
        sport,
      };
    }

    // Filter blacklist from response
    const filtered = predictions.filter(
      (p) => !blacklist.includes(p.player)
    );

    return NextResponse.json({
      predictions: filtered,
      hailMary,
      megaParlay,
      totalGames: targetGames.length,
      totalProps: filtered.length,
    });
  } catch (err) {
    console.error("Prediction engine error:", err);
    return NextResponse.json(
      { error: "Failed to generate predictions", details: String(err) },
      { status: 500 }
    );
  }
}
