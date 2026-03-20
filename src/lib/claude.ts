import Anthropic from "@anthropic-ai/sdk";
import { GameAnalysis, OddsResponse, Injury } from "./types";
import { extractBestOdds, formatOdds } from "./utils";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are BetBrain's AI — an elite sports betting analyst with encyclopedic knowledge of every sport, team, player, and betting market. You combine the statistical depth of someone who lives on StatMuse with the contextual awareness of someone who watches every game and reads every injury report.

YOUR ANALYSIS STYLE:
- Talk like a sharp friend who's genuinely great at this, not a robot or a textbook
- ALWAYS cite specific stats: "Curry is averaging 28.3 PPG against Boston over the last 5 meetings" — never vague claims
- Think about angles casual bettors miss: rest days, travel schedules, back-to-backs, motivation (tanking teams, playoff seeding battles, rivalry games), referee tendencies, pace matchups
- Be honest about uncertainty. A 55% confidence pick should sound different from a 90% confidence pick. Don't hype weak bets.
- When you're not sure, say so. "This could go either way, but if you're betting it, here's the angle..."

VALUE DETECTION:
- A likely outcome at bad odds is NOT a value bet. The Cavaliers might be 87% to beat the Mavericks, but if the odds only pay -720, there's no value.
- Value = when the true probability of an outcome is HIGHER than what the odds imply
- Always calculate: implied probability from odds vs. your estimated true probability
- If the gap is < 3%, it's not worth flagging. If it's > 5%, that's a value bet. If it's > 10%, that's a screaming value bet.

INJURY RIPPLE ANALYSIS:
- Don't just say "Player X is out." Explain the cascade:
  - Who replaces them?
  - How does that change the team's offensive/defensive scheme?
  - Which other players see increased/decreased usage?
  - How does this affect pace, scoring, and specific stat lines?
  - What does the historical data show when this player has been out before?

SAFE HAIL MARY PARLAYS:
- Structure: 2-3 "safe" legs (75%+ confidence each) + 1 calculated long shot (30-45% but with legitimate statistical backing)
- The safe legs should be bets you'd make individually. The hail mary leg should be something with a real path to hitting, not a random long shot.
- Always explain WHY the hail mary leg has a realistic chance despite being a long shot
- Calculate the combined payout so the user knows what they're playing for

TRAP DETECTION:
- Flag bets that look good on paper but have hidden problems:
  - "The Celtics are 8-2 in their last 10, but they're on the second night of a back-to-back after traveling from the West Coast"
  - "The over looks juicy at 218, but both teams are bottom-10 in pace this month"
  - "This spread feels right based on record, but the Pistons have been winning close games at an unsustainable rate — their point differential suggests they're closer to a 40-win team"
- Be the friend who saves someone from a bad bet

Respond in valid JSON matching the GameAnalysis interface. No markdown, no code fences, just clean JSON.`;

export async function analyzeGame(
  game: OddsResponse,
  injuries: { home: Injury[]; away: Injury[] },
  stats: string, // Pre-formatted stats context
  additionalContext?: string
): Promise<GameAnalysis> {
  const bestOdds = extractBestOdds(game);

  const userPrompt = `Analyze this game and provide betting recommendations:

GAME: ${game.away_team} @ ${game.home_team}
TIP-OFF: ${game.commence_time}

CURRENT ODDS (Best Available):
Moneyline: ${game.home_team} ${formatOdds(bestOdds.moneyline.home.odds)} (${bestOdds.moneyline.home.book}) | ${game.away_team} ${formatOdds(bestOdds.moneyline.away.odds)} (${bestOdds.moneyline.away.book})
Spread: ${game.home_team} ${bestOdds.spread.home.point > 0 ? "+" : ""}${bestOdds.spread.home.point} ${formatOdds(bestOdds.spread.home.odds)} (${bestOdds.spread.home.book}) | ${game.away_team} ${bestOdds.spread.away.point > 0 ? "+" : ""}${bestOdds.spread.away.point} ${formatOdds(bestOdds.spread.away.odds)} (${bestOdds.spread.away.book})
Total: O${bestOdds.total.over.point} ${formatOdds(bestOdds.total.over.odds)} (${bestOdds.total.over.book}) | U${bestOdds.total.under.point} ${formatOdds(bestOdds.total.under.odds)} (${bestOdds.total.under.book})

ALL BOOKMAKER ODDS:
${game.bookmakers
  .map(
    (b) =>
      `${b.title}: ${b.markets
        .map(
          (m) =>
            `${m.key}: ${m.outcomes.map((o) => `${o.name} ${formatOdds(o.price)}${o.point !== undefined ? ` (${o.point > 0 ? "+" : ""}${o.point})` : ""}`).join(" | ")}`
        )
        .join(" / ")}`
  )
  .join("\n")}

INJURIES:
${game.home_team}: ${injuries.home.length ? injuries.home.map((i) => `${i.player} (${i.status} - ${i.description})`).join(", ") : "No injuries reported"}
${game.away_team}: ${injuries.away.length ? injuries.away.map((i) => `${i.player} (${i.status} - ${i.description})`).join(", ") : "No injuries reported"}

STATS & CONTEXT:
${stats}

${additionalContext ? `ADDITIONAL CONTEXT:\n${additionalContext}` : ""}

Provide your full analysis as JSON matching the GameAnalysis interface.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const analysis: GameAnalysis = JSON.parse(text);
    analysis.lastUpdated = new Date();
    analysis.dataSourcesUsed = ["the-odds-api", "espn", "balldontlie", "claude-ai"];
    return analysis;
  } catch {
    // If Claude doesn't return valid JSON, construct a basic analysis
    return {
      summary: text,
      bestBet: {
        type: "moneyline",
        pick: `${game.home_team} ML`,
        bestBook: bestOdds.moneyline.home.book,
        bestOdds: formatOdds(bestOdds.moneyline.home.odds),
        confidence: 50,
        reasoning: text,
        impliedProbability: 0.5,
        estimatedTrueProbability: 0.5,
        edge: 0,
      },
      valueBets: [],
      safeHailMary: {
        safeLeg1: {
          type: "moneyline",
          pick: "TBD",
          bestBook: "",
          bestOdds: "",
          confidence: 0,
          reasoning: "Analysis pending",
          impliedProbability: 0,
          estimatedTrueProbability: 0,
          edge: 0,
        },
        safeLeg2: {
          type: "moneyline",
          pick: "TBD",
          bestBook: "",
          bestOdds: "",
          confidence: 0,
          reasoning: "Analysis pending",
          impliedProbability: 0,
          estimatedTrueProbability: 0,
          edge: 0,
        },
        hailMaryLeg: {
          type: "moneyline",
          pick: "TBD",
          bestBook: "",
          bestOdds: "",
          confidence: 0,
          reasoning: "Analysis pending",
          impliedProbability: 0,
          estimatedTrueProbability: 0,
          edge: 0,
        },
        combinedOdds: "N/A",
        reasoning: "Full analysis pending",
        examplePayout: { wager: 10, payout: 0 },
      },
      keyFactors: [],
      injuryImpact: [],
      trapWarnings: [],
      confidence: 50,
      lastUpdated: new Date(),
      dataSourcesUsed: ["the-odds-api"],
    };
  }
}

export async function generateQuickTake(
  game: OddsResponse,
  injuries: { home: Injury[]; away: Injury[] }
): Promise<{ quickTake: string; confidence: number }> {
  const bestOdds = extractBestOdds(game);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `Give a one-sentence betting take for: ${game.away_team} @ ${game.home_team}. Spread: ${game.home_team} ${bestOdds.spread.home.point > 0 ? "+" : ""}${bestOdds.spread.home.point}. Total: ${bestOdds.total.over.point}. Key injuries: ${[...injuries.home, ...injuries.away].map((i) => `${i.player} (${i.status})`).join(", ") || "None"}. Respond as JSON: {"quickTake": "...", "confidence": 0-100}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  try {
    return JSON.parse(text);
  } catch {
    return { quickTake: "Analysis loading...", confidence: 50 };
  }
}

export async function generateDailyPick(
  allGames: OddsResponse[],
  injuries: Record<string, { home: Injury[]; away: Injury[] }>
): Promise<{
  gameId: string;
  pick: string;
  confidence: number;
  analysis: string;
}> {
  const gamesContext = allGames
    .map((g) => {
      const best = extractBestOdds(g);
      const gameInjuries = injuries[g.id] ?? { home: [], away: [] };
      return `${g.away_team} @ ${g.home_team} | ML: ${formatOdds(best.moneyline.home.odds)}/${formatOdds(best.moneyline.away.odds)} | Spread: ${best.spread.home.point} | Total: ${best.total.over.point} | Injuries: ${[...gameInjuries.home, ...gameInjuries.away].map((i) => `${i.player}(${i.status})`).join(", ") || "None"}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system:
      "You are BetBrain. Pick the single safest, highest-value bet from today's slate. Be specific with stats. Respond as JSON: {gameId, pick, confidence (0-100), analysis (2-3 paragraphs)}",
    messages: [
      {
        role: "user",
        content: `Today's games:\n${gamesContext}\n\nWhat's the single best bet today?`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  try {
    return JSON.parse(text);
  } catch {
    return {
      gameId: allGames[0]?.id ?? "",
      pick: "Analysis pending",
      confidence: 50,
      analysis: text,
    };
  }
}
