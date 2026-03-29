import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getOdds } from "@/lib/odds-api";
import { searchESPNPlayer, getESPNPlayerGameLog, getESPNTodayGames } from "@/lib/stats-api";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are BetBrain AI — an elite sports betting analyst with access to LIVE data.

CRITICAL RULES:
- NEVER rely on your training data for rosters, trades, or player stats. ONLY use the data injected below.
- ALWAYS cite specific recent stats: "Johnson scored 29 and 27 in his last 2 games" not "Johnson has been playing well"
- Be honest about uncertainty. A 55% confidence pick should sound different from a 90% pick.
- If data wasn't injected for a player, say "I don't have current data on this player — let me know and I can look it up."

ANALYSIS STYLE:
- Casual but sharp — like a smart friend who watches every game
- Think about angles casual bettors miss: rest days, back-to-backs, blowout risk, travel
- Factor injury ripple effects — who benefits when a star sits?
- Detect traps — "This looks good on paper but they're on a back-to-back after traveling from the West Coast"

O/U PREDICTIONS:
- Weight last 3 games more than games 7-10
- Season averages lie — always check the recent trend
- A player trending down (33 → 7 → 10 → 13 → 2) is NOT the same as a player averaging 18
- Blowouts kill star props — if spread is 15+, warn about 4th quarter rest
- Home/away matters — some players score 5+ more at home

VALUE DETECTION:
- Value = true probability > implied probability from odds
- A likely outcome at bad odds is NOT value
- Look for "stale lines" — when a book hasn't adjusted after injury news

FORMATTING:
- Use line breaks and structure for readability
- Bold key recommendations with **text**
- Use numbers and specific data points, never vague statements`;

// Detect player names and sport keywords in the user message
function detectEntities(message: string): {
  playerNames: string[];
  sport: string;
  wantsOdds: boolean;
  wantsParlay: boolean;
  wantsComparison: boolean;
} {
  const lower = message.toLowerCase();

  // Sport detection
  let sport = "nba"; // default
  if (lower.includes("nfl") || lower.includes("football")) sport = "nfl";
  else if (lower.includes("mlb") || lower.includes("baseball")) sport = "mlb";
  else if (lower.includes("nhl") || lower.includes("hockey")) sport = "nhl";
  else if (lower.includes("ufc") || lower.includes("mma")) sport = "ufc";

  // Intent detection
  const wantsOdds = /odds|line|spread|moneyline|over.under|o\/u|total/i.test(message);
  const wantsParlay = /parlay|hail mary|safe|builder|build me/i.test(message);
  const wantsComparison = /compare|vs|versus|fanduel.*draftkings|draftkings.*fanduel/i.test(message);

  // Extract potential player names (capitalized words, likely 2+ words)
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const matches = message.match(namePattern) ?? [];

  // Also check for common single-name references
  const singleNames = /\b(Wemby|Luka|Jokic|Giannis|Steph|Curry|LeBron|KD|Booker|Tatum|Brunson|SGA|Ant|Towns|Randle|DeRozan)\b/gi;
  const singleMatches = message.match(singleNames) ?? [];

  const playerNames = Array.from(new Set([...matches, ...singleMatches]));

  return { playerNames, sport, wantsOdds, wantsParlay, wantsComparison };
}

// Fetch live context data based on what the user is asking about
async function fetchLiveContext(entities: ReturnType<typeof detectEntities>): Promise<string> {
  const contextParts: string[] = [];

  try {
    // Always include today's games
    const todayGames = await getESPNTodayGames(entities.sport);
    if (todayGames.length > 0) {
      contextParts.push(
        `TODAY'S ${entities.sport.toUpperCase()} GAMES:\n` +
        todayGames.map((g) =>
          `${g.awayTeam.name} (${g.awayTeam.record}) @ ${g.homeTeam.name} (${g.homeTeam.record}) — ${new Date(g.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        ).join("\n")
      );
    }

    // Fetch odds if wanted
    if (entities.wantsOdds || entities.wantsComparison) {
      const odds = await getOdds(entities.sport);
      if (odds.length > 0) {
        const oddsLines = odds.slice(0, 8).map((game) => {
          const books = game.bookmakers.slice(0, 3);
          const lines = books.map((b) => {
            const ml = b.markets.find((m) => m.key === "h2h");
            const spread = b.markets.find((m) => m.key === "spreads");
            const total = b.markets.find((m) => m.key === "totals");
            return `  ${b.title}: ML ${ml?.outcomes.map((o) => `${o.name} ${o.price > 0 ? "+" : ""}${o.price}`).join(" / ") ?? "N/A"} | Spread ${spread?.outcomes[0]?.point ?? "N/A"} | O/U ${total?.outcomes[0]?.point ?? "N/A"}`;
          });
          return `${game.away_team} @ ${game.home_team}\n${lines.join("\n")}`;
        });
        contextParts.push("LIVE ODDS:\n" + oddsLines.join("\n\n"));
      }
    }

    // Fetch player data for mentioned players
    for (const name of entities.playerNames.slice(0, 3)) {
      const espnPlayer = await searchESPNPlayer(name);
      if (espnPlayer) {
        const logs = await getESPNPlayerGameLog(espnPlayer.id);
        const last10 = logs.slice(0, 10);
        if (last10.length > 0) {
          const avg = (stat: keyof typeof last10[0]) =>
            (last10.reduce((s, g) => s + (g[stat] as number), 0) / last10.length).toFixed(1);

          const gameLines = last10.slice(0, 5).map((g) =>
            `  ${g.date.slice(5, 10)} vs ${g.opponent}: ${g.points}pts ${g.rebounds}reb ${g.assists}ast ${g.fg3m}threes (${g.result})`
          ).join("\n");

          contextParts.push(
            `PLAYER DATA — ${espnPlayer.name} (${espnPlayer.team}, ${espnPlayer.position}):\n` +
            `Last 10 avg: ${avg("points")} pts, ${avg("rebounds")} reb, ${avg("assists")} ast, ${avg("fg3m")} 3PM\n` +
            `Last 5 games:\n${gameLines}`
          );
        }
      }
    }
  } catch (err) {
    console.error("Context fetch error:", err);
  }

  return contextParts.length > 0
    ? "\n\n===== LIVE DATA (use this, NOT your training data) =====\n\n" + contextParts.join("\n\n---\n\n")
    : "";
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
      });
    }

    // Get the latest user message
    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    let liveContext = "";

    if (lastUserMsg) {
      const entities = detectEntities(lastUserMsg.content);
      liveContext = await fetchLiveContext(entities);
    }

    // Inject live data into the system prompt
    const systemWithData = SYSTEM_PROMPT + liveContext;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemWithData,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      stream: true,
    });

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return new Response(JSON.stringify({ error: "Chat failed" }), {
      status: 500,
    });
  }
}
