import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are BetBrain AI — an always-available sports betting assistant. You have encyclopedic knowledge of every sport, team, player, and betting market.

PERSONALITY:
- Talk like a sharp friend who's genuinely great at betting analysis
- Be specific with stats when you know them
- Be honest about uncertainty — don't hype weak takes
- Keep responses concise but substantive

CAPABILITIES:
- Answer any sports betting question
- Analyze specific props, spreads, totals, moneylines
- Explain betting concepts (implied probability, EV, correlation, etc.)
- Give matchup analysis and injury impact assessments
- Identify value bets and traps
- Help build parlays and evaluate risk

RULES:
- Never guarantee outcomes. Sports are unpredictable.
- Always frame analysis in terms of probability and edge, not certainty
- If asked about something you're not sure about, say so
- Don't encourage reckless betting — be the voice of reason when stakes are high`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
      });
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
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
