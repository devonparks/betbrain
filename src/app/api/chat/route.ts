import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getOdds } from "@/lib/odds-api";
import {
  searchESPNPlayer,
  getESPNPlayerGameLog,
  getESPNTodayGames,
} from "@/lib/stats-api";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are BetBrain AI — an elite sports betting analyst with access to LIVE data injected below.

CRITICAL RULES:
- You have LIVE DATA injected below this prompt. ONLY use that data. NEVER rely on training data for scores, records, rosters, or stats.
- When referencing predictions, cite them specifically: "Our prediction engine shows Giannis OVER 28.5 points at 72% confidence"
- ALWAYS cite specific recent stats: "Johnson scored 29 and 27 in his last 2 games" not "Johnson has been playing well"
- Be honest about uncertainty. A 55% confidence pick should sound different from a 90% pick.
- If data wasn't injected for a player, say "I don't have current data on this player — let me know and I can look it up."

RESPONSE STYLE:
- Keep responses to 2-3 paragraphs max. Be concise and punchy.
- Casual but sharp — like a smart friend who watches every game
- Think about angles casual bettors miss: rest days, back-to-backs, blowout risk, travel
- Factor injury ripple effects — who benefits when a star sits?
- Detect traps — "This looks good on paper but they're on a back-to-back after traveling from the West Coast"

O/U ANALYSIS:
- Weight last 3 games more than games 7-10
- Season averages lie — always check the recent trend
- A player trending down (33 -> 7 -> 10 -> 13 -> 2) is NOT the same as a player averaging 18
- Blowouts kill star props — if spread is 15+, warn about 4th quarter rest

FORMATTING:
- Use line breaks and structure for readability
- Bold key recommendations with **text**
- Use numbers and specific data points, never vague statements
- NO 500-word essays. Get to the point.`;

// Detect player names and sport keywords in the user message
function detectEntities(message: string): {
  playerNames: string[];
  sport: string;
  wantsLiveData: boolean;
} {
  const lower = message.toLowerCase();

  // Sport detection
  let sport = "nba"; // default
  if (lower.includes("nfl") || lower.includes("football")) sport = "nfl";
  else if (lower.includes("mlb") || lower.includes("baseball")) sport = "mlb";
  else if (lower.includes("nhl") || lower.includes("hockey")) sport = "nhl";
  else if (lower.includes("ufc") || lower.includes("mma")) sport = "ufc";

  // Broad intent detection — almost anything should trigger live data
  const wantsLiveData =
    /bet|pick|prop|parlay|over|under|o\/u|odds|line|spread|moneyline|total|tonight|today|game|play|score|who|best|safe|lock|value|trap|trend|hot|cold|streak|compare|vs|versus|fanduel|draftkings|hail mary|builder|build me|player|team|matchup|slate|card|injury|rest|back.to.back|stat|point|rebound|assist|three|steal|block/i.test(
      message
    );

  // Extract potential player names (capitalized words, likely 2+ words)
  const namePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const matches = message.match(namePattern) ?? [];

  // Also check for common single-name references
  const singleNames =
    /\b(Wemby|Luka|Jokic|Giannis|Steph|Curry|LeBron|KD|Booker|Tatum|Brunson|SGA|Ant|Towns|Randle|DeRozan|Dame|Harden|Embiid|Bam|Fox|Murray|Edwards|Morant|Ja|Chet|Paolo|Lauri|Sabonis|Doncic|Lillard)\b/gi;
  const singleMatches = message.match(singleNames) ?? [];

  const playerNames = Array.from(new Set([...matches, ...singleMatches]));

  return { playerNames, sport, wantsLiveData };
}

// Fetch O/U predictions from our internal predict-ou endpoint
async function fetchPredictions(
  baseUrl: string,
  sport: string
): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/predict-ou?sport=${sport}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      console.warn(`predict-ou returned ${res.status}`);
      return "";
    }

    const data = await res.json();
    const predictions = data.predictions ?? [];

    if (predictions.length === 0) return "";

    // Sort by confidence descending, take top 10
    const top = predictions
      .sort(
        (a: { confidence: number }, b: { confidence: number }) =>
          b.confidence - a.confidence
      )
      .slice(0, 10);

    const lines = top.map(
      (p: {
        player: string;
        stat: string;
        line: number;
        prediction: string;
        confidence: number;
        recentAvg: number;
        fullAvg: number;
        trendDirection: string;
        last10: number[];
        reasoning: string;
      }) => {
        const last5 = (p.last10 ?? []).slice(0, 5).join(", ");
        return (
          `  ${p.player} — ${p.stat.toUpperCase()} ${p.prediction} ${p.line} (${p.confidence}% confidence)\n` +
          `    Recent avg: ${p.recentAvg?.toFixed(1) ?? "?"} | Season avg: ${p.fullAvg?.toFixed(1) ?? "?"} | Trend: ${p.trendDirection ?? "?"}\n` +
          `    Last 5: [${last5}]\n` +
          `    ${p.reasoning ?? ""}`
        );
      }
    );

    const source = data.source === "synthetic" ? " (ESPN-derived lines)" : "";
    return `TOP O/U PREDICTIONS FROM OUR ENGINE${source}:\n${lines.join("\n\n")}`;
  } catch (err) {
    console.warn("Failed to fetch predictions:", err);
    return "";
  }
}

// Fetch live context data — ALWAYS injects today's games and predictions
async function fetchLiveContext(
  entities: ReturnType<typeof detectEntities>,
  reqUrl: string
): Promise<string> {
  const contextParts: string[] = [];
  const baseUrl = new URL(reqUrl).origin;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  contextParts.push(`TODAY: ${today}`);

  try {
    // 1. ALWAYS fetch today's games from ESPN
    const todayGames = await getESPNTodayGames(entities.sport);
    if (todayGames.length > 0) {
      const gameLines = todayGames.map((g) => {
        const time = new Date(g.startTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        });
        const statusLabel =
          g.status === "in"
            ? " [LIVE]"
            : g.status === "post"
              ? " [FINAL]"
              : "";
        return `  ${g.awayTeam.name} (${g.awayTeam.record}) @ ${g.homeTeam.name} (${g.homeTeam.record}) — ${time} ET${statusLabel}`;
      });
      contextParts.push(
        `TODAY'S ${entities.sport.toUpperCase()} GAMES (${todayGames.length} games):\n${gameLines.join("\n")}`
      );
    } else {
      contextParts.push(
        `No ${entities.sport.toUpperCase()} games scheduled today.`
      );
    }

    // 2. ALWAYS fetch O/U predictions from our engine
    const predictions = await fetchPredictions(baseUrl, entities.sport);
    if (predictions) {
      contextParts.push(predictions);
    }

    // 3. If specific players mentioned, fetch their game logs
    for (const name of entities.playerNames.slice(0, 3)) {
      try {
        const espnPlayer = await searchESPNPlayer(name);
        if (espnPlayer) {
          const logs = await getESPNPlayerGameLog(espnPlayer.id);
          const last10 = logs.slice(0, 10);
          if (last10.length > 0) {
            const avg = (stat: keyof (typeof last10)[0]) =>
              (
                last10.reduce((s, g) => s + (g[stat] as number), 0) /
                last10.length
              ).toFixed(1);

            const gameLines = last10
              .slice(0, 5)
              .map(
                (g) =>
                  `  ${g.date.slice(5, 10)} vs ${g.opponent}: ${g.points}pts ${g.rebounds}reb ${g.assists}ast ${g.fg3m}threes (${g.result})`
              )
              .join("\n");

            contextParts.push(
              `PLAYER DATA — ${espnPlayer.name} (${espnPlayer.team}, ${espnPlayer.position}):\n` +
                `Last 10 avg: ${avg("points")} pts, ${avg("rebounds")} reb, ${avg("assists")} ast, ${avg("fg3m")} 3PM\n` +
                `Last 5 games:\n${gameLines}`
            );
          }
        }
      } catch (playerErr) {
        console.warn(`Failed to fetch player data for ${name}:`, playerErr);
      }
    }

    // 4. Try odds (silently catch errors — Odds API is likely quota-exceeded)
    try {
      const odds = await getOdds(entities.sport);
      if (odds.length > 0) {
        const oddsLines = odds.slice(0, 6).map((game) => {
          const book = game.bookmakers[0];
          if (!book) return `${game.away_team} @ ${game.home_team}: No lines`;
          const spread = book.markets.find((m) => m.key === "spreads");
          const total = book.markets.find((m) => m.key === "totals");
          const ml = book.markets.find((m) => m.key === "h2h");
          return (
            `  ${game.away_team} @ ${game.home_team} (${book.title}):\n` +
            `    Spread: ${spread?.outcomes[0]?.point ?? "N/A"} | O/U: ${total?.outcomes[0]?.point ?? "N/A"} | ML: ${ml?.outcomes.map((o) => `${o.name} ${o.price > 0 ? "+" : ""}${o.price}`).join(" / ") ?? "N/A"}`
          );
        });
        contextParts.push("LIVE ODDS:\n" + oddsLines.join("\n"));
      }
    } catch {
      // Odds API quota exceeded — that's fine, we have ESPN + predictions
    }
  } catch (err) {
    console.error("Context fetch error:", err);
    // Even if everything fails, we still have the date
    contextParts.push(
      "NOTE: Live data feeds are temporarily unavailable. Respond based on general knowledge but warn the user that data may not be current."
    );
  }

  return (
    "\n\n===== LIVE DATA (use ONLY this data, NOT your training data) =====\n\n" +
    contextParts.join("\n\n---\n\n")
  );
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
    const lastUserMsg = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");

    let liveContext = "";

    if (lastUserMsg) {
      const entities = detectEntities(lastUserMsg.content);
      // ALWAYS inject live context — every response gets today's data
      liveContext = await fetchLiveContext(entities, req.url);
    }

    // Inject live data into the system prompt
    const systemWithData = SYSTEM_PROMPT + liveContext;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
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
              encoder.encode(
                `data: ${JSON.stringify({ text: event.delta.text })}\n\n`
              )
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
