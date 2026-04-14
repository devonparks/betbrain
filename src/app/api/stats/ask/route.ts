import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  getESPNPlayerGameLog,
  getESPNTodayGames,
} from "@/lib/stats-api";
import { rateLimit, getIP, rateLimitResponse } from "@/lib/rate-limit";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Known NBA player IDs for instant lookup (no search API needed)
const PLAYER_DB: Record<string, { id: string; name: string; team: string; pos: string }> = {
  "giannis": { id: "3032977", name: "Giannis Antetokounmpo", team: "MIL", pos: "F" },
  "antetokounmpo": { id: "3032977", name: "Giannis Antetokounmpo", team: "MIL", pos: "F" },
  "lebron": { id: "1966", name: "LeBron James", team: "LAL", pos: "F" },
  "james": { id: "1966", name: "LeBron James", team: "LAL", pos: "F" },
  "curry": { id: "3975", name: "Stephen Curry", team: "GS", pos: "G" },
  "steph": { id: "3975", name: "Stephen Curry", team: "GS", pos: "G" },
  "luka": { id: "4395725", name: "Luka Doncic", team: "LAL", pos: "G" },
  "doncic": { id: "4395725", name: "Luka Doncic", team: "LAL", pos: "G" },
  "jokic": { id: "3112335", name: "Nikola Jokic", team: "DEN", pos: "C" },
  "nikola": { id: "3112335", name: "Nikola Jokic", team: "DEN", pos: "C" },
  "wemby": { id: "4868666", name: "Victor Wembanyama", team: "SA", pos: "C" },
  "wembanyama": { id: "4868666", name: "Victor Wembanyama", team: "SA", pos: "C" },
  "victor": { id: "4868666", name: "Victor Wembanyama", team: "SA", pos: "C" },
  "tatum": { id: "4065648", name: "Jayson Tatum", team: "BOS", pos: "F" },
  "sga": { id: "4278073", name: "Shai Gilgeous-Alexander", team: "OKC", pos: "G" },
  "shai": { id: "4278073", name: "Shai Gilgeous-Alexander", team: "OKC", pos: "G" },
  "edwards": { id: "4432816", name: "Anthony Edwards", team: "MIN", pos: "G" },
  "ant": { id: "4432816", name: "Anthony Edwards", team: "MIN", pos: "G" },
  "booker": { id: "3136193", name: "Devin Booker", team: "PHX", pos: "G" },
  "brunson": { id: "3934672", name: "Jalen Brunson", team: "NY", pos: "G" },
  "durant": { id: "3202", name: "Kevin Durant", team: "PHX", pos: "F" },
  "kd": { id: "3202", name: "Kevin Durant", team: "PHX", pos: "F" },
  "davis": { id: "6583", name: "Anthony Davis", team: "LAL", pos: "F" },
  "morant": { id: "4279888", name: "Ja Morant", team: "MEM", pos: "G" },
  "ja": { id: "4279888", name: "Ja Morant", team: "MEM", pos: "G" },
  "fox": { id: "4066259", name: "De'Aaron Fox", team: "SAC", pos: "G" },
  "harden": { id: "3992", name: "James Harden", team: "LAC", pos: "G" },
  "mitchell": { id: "3908809", name: "Donovan Mitchell", team: "CLE", pos: "G" },
  "young": { id: "4277905", name: "Trae Young", team: "ATL", pos: "G" },
  "trae": { id: "4277905", name: "Trae Young", team: "ATL", pos: "G" },
  "cunningham": { id: "4432166", name: "Cade Cunningham", team: "DET", pos: "G" },
  "cade": { id: "4432166", name: "Cade Cunningham", team: "DET", pos: "G" },
  "banchero": { id: "4433255", name: "Paolo Banchero", team: "ORL", pos: "F" },
  "paolo": { id: "4433255", name: "Paolo Banchero", team: "ORL", pos: "F" },
  "haliburton": { id: "4066328", name: "Tyrese Haliburton", team: "IND", pos: "G" },
  "lamelo": { id: "4432816", name: "LaMelo Ball", team: "CHA", pos: "G" },
  "ball": { id: "4432816", name: "LaMelo Ball", team: "CHA", pos: "G" },
  "towns": { id: "3136195", name: "Karl-Anthony Towns", team: "NY", pos: "C" },
  "kat": { id: "3136195", name: "Karl-Anthony Towns", team: "NY", pos: "C" },
  "randle": { id: "3064514", name: "Julius Randle", team: "MIN", pos: "F" },
  "embiid": { id: "3059318", name: "Joel Embiid", team: "PHI", pos: "C" },
  "lillard": { id: "6606", name: "Damian Lillard", team: "MIL", pos: "G" },
  "dame": { id: "6606", name: "Damian Lillard", team: "MIL", pos: "G" },
  "maxey": { id: "4431678", name: "Tyrese Maxey", team: "PHI", pos: "G" },
  "bam": { id: "4066261", name: "Bam Adebayo", team: "MIA", pos: "C" },
  "adebayo": { id: "4066261", name: "Bam Adebayo", team: "MIA", pos: "C" },
  "butler": { id: "6430", name: "Jimmy Butler", team: "MIA", pos: "F" },
  "jimmy": { id: "6430", name: "Jimmy Butler", team: "MIA", pos: "F" },
  "george": { id: "6580", name: "Paul George", team: "PHI", pos: "F" },
  "pg": { id: "6580", name: "Paul George", team: "PHI", pos: "F" },
  "kawhi": { id: "6450", name: "Kawhi Leonard", team: "LAC", pos: "F" },
  "leonard": { id: "6450", name: "Kawhi Leonard", team: "LAC", pos: "F" },
  "garland": { id: "4395651", name: "Darius Garland", team: "CLE", pos: "G" },
  "murray": { id: "3936299", name: "Jamal Murray", team: "DEN", pos: "G" },
  "zion": { id: "4395628", name: "Zion Williamson", team: "NO", pos: "F" },
  "ingram": { id: "4065663", name: "Brandon Ingram", team: "NO", pos: "F" },
};

function findPlayer(query: string): { id: string; name: string; team: string; pos: string } | null {
  const lower = query.toLowerCase();
  for (const [key, player] of Object.entries(PLAYER_DB)) {
    if (lower.includes(key)) return player;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const rl = rateLimit("stats-ask", ip, 15, 60000);
  if (rl.limited) return rateLimitResponse(rl.resetIn);

  const query = req.nextUrl.searchParams.get("q");
  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  try {
    // Step 1: Find any players mentioned in the query
    const player = findPlayer(query);
    let playerData = "";

    if (player) {
      const logs = await getESPNPlayerGameLog(player.id);
      const last10 = logs.slice(0, 10);
      const last5 = logs.slice(0, 5);

      if (last10.length > 0) {
        const avg = (key: "points" | "rebounds" | "assists" | "fg3m" | "steals" | "blocks" | "minutes") =>
          (last10.reduce((s, g) => s + g[key], 0) / last10.length).toFixed(1);

        playerData = `\n\nPLAYER DATA — ${player.name} (${player.team}, ${player.pos}):
Season averages (last ${last10.length} games): ${avg("points")} PPG, ${avg("rebounds")} RPG, ${avg("assists")} APG, ${avg("fg3m")} 3PM, ${avg("steals")} SPG, ${avg("blocks")} BPG, ${avg("minutes")} MPG
Last 5 games:
${last5.map((g) => `  ${g.date?.slice(5, 10) ?? "?"} vs ${g.opponent}: ${g.points}pts ${g.rebounds}reb ${g.assists}ast ${g.fg3m}threes ${g.minutes}min (${g.result})`).join("\n")}
Last 10 points: [${last10.map((g) => g.points).join(", ")}]
Last 10 rebounds: [${last10.map((g) => g.rebounds).join(", ")}]
Last 10 assists: [${last10.map((g) => g.assists).join(", ")}]
Last 10 threes: [${last10.map((g) => g.fg3m).join(", ")}]`;
      }
    }

    // Step 2: Get today's games for context
    let todayContext = "";
    try {
      const games = await getESPNTodayGames("nba");
      if (games.length > 0) {
        todayContext = `\n\nTODAY'S NBA GAMES:\n${games.map((g) => `${g.awayTeam.name} (${g.awayTeam.record}) @ ${g.homeTeam.name} (${g.homeTeam.record})`).join("\n")}`;
      }
    } catch { /* ok */ }

    // Step 3: Ask Claude to answer the question using the data
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: `You are a sports stats assistant. Answer questions using ONLY the data provided below. Be concise and specific — cite exact numbers.

RESPONSE FORMAT: Return a JSON object with this structure:
{
  "answer": "The main answer text (1-3 sentences, cite specific stats)",
  "headline": "Short bold headline (e.g., 'LeBron James — 18.4 PPG this season')",
  "stats": [{"label": "PPG", "value": "18.4"}, {"label": "RPG", "value": "8.3"}],
  "gamelog": [{"date": "Apr 9", "opp": "GS", "pts": 26, "reb": 8, "ast": 7, "result": "W"}],
  "type": "player_stats" | "comparison" | "leaders" | "general"
}

Keep gamelog to last 5 games max. Stats should be the 3-4 most relevant stats for the question.
If you don't have the data to answer, set type to "general" and give your best answer with a note that you need current data.

ONLY return valid JSON. No markdown, no code blocks.${playerData}${todayContext}`,
      messages: [{ role: "user", content: query }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Parse the JSON response
    try {
      // Strip any markdown code fences if present
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);

      return NextResponse.json({
        ...parsed,
        player: player ? { name: player.name, team: player.team, position: player.pos, id: player.id } : null,
      });
    } catch {
      // If JSON parsing fails, return the raw text as a general answer
      return NextResponse.json({
        type: "general",
        headline: query,
        answer: text,
        stats: [],
        gamelog: [],
        player: player ? { name: player.name, team: player.team, position: player.pos, id: player.id } : null,
      });
    }
  } catch (err) {
    console.error("Stats ask error:", err);
    return NextResponse.json({ error: "Failed to process question" }, { status: 500 });
  }
}
