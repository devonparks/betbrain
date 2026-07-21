/**
 * Backfill historical NBA games from BallDontLie into data/games/{season}.json
 *
 * Works on the FREE tier: the /games endpoint returns final score AND
 * quarter-by-quarter scores, which is everything needed to grade every
 * game-level market (moneyline, spread, total, halftime, quarters, alt spreads).
 * Player-level logs need the paid tier and are NOT fetched here.
 *
 * Free tier is 5 requests/minute, so this is deliberately slow and resumable —
 * kill it and re-run and it picks up where it left off.
 *
 *   node tools/backfill-games.mjs                 # default seasons
 *   node tools/backfill-games.mjs 2022 2023       # specific seasons
 */
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "data", "games");
const DEFAULT_SEASONS = [2021, 2022, 2023, 2024, 2025];
const BASE = "https://api.balldontlie.io/v1/games";

// Free tier is 5/min. Pace at ~4/min so a clock skew can't trip a 429.
const MIN_GAP_MS = 15_000;

function apiKey() {
  const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const m = env.match(/^BALLDONTLIE_API_KEY=(.+)$/m);
  if (!m) throw new Error("BALLDONTLIE_API_KEY not found in .env.local");
  return m[1].trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;

async function throttledGet(url, key) {
  const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await sleep(wait);

  for (let attempt = 1; attempt <= 6; attempt++) {
    lastCallAt = Date.now();
    const res = await fetch(url, { headers: { Authorization: key } });

    if (res.status === 429) {
      // Honour the reset header when present, else back off exponentially.
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      const backoff = Number.isFinite(reset) && reset > Date.now()
        ? reset - Date.now() + 1000
        : Math.min(60_000, 2 ** attempt * 2000);
      console.log(`    429 — backing off ${Math.round(backoff / 1000)}s (attempt ${attempt})`);
      await sleep(backoff);
      continue;
    }
    if (res.status === 401) {
      throw new Error("401 Unauthorized — this endpoint needs a paid BallDontLie tier.");
    }
    if (!res.ok) {
      const backoff = Math.min(30_000, 2 ** attempt * 1000);
      console.log(`    HTTP ${res.status} — retrying in ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    return res.json();
  }
  throw new Error(`giving up on ${url}`);
}

async function fetchSeason(season, key) {
  const outFile = path.join(OUT_DIR, `${season}.json`);
  if (fs.existsSync(outFile)) {
    const existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (existing.complete) {
      console.log(`season ${season}: already complete (${existing.games.length} games) — skipping`);
      return existing.games.length;
    }
  }

  console.log(`season ${season}: fetching...`);
  const games = [];
  const seen = new Set();
  let cursor = null;
  let page = 0;

  while (true) {
    const url =
      `${BASE}?per_page=100&seasons[]=${season}` + (cursor ? `&cursor=${cursor}` : "");
    const body = await throttledGet(url, key);
    const rows = body.data ?? [];
    page++;

    for (const g of rows) {
      if (!seen.has(g.id)) {
        seen.add(g.id);
        games.push(g);
      }
    }
    process.stdout.write(`  page ${page}: +${rows.length} (total ${games.length})\n`);

    cursor = body.meta?.next_cursor ?? null;
    if (!cursor || rows.length === 0) break;

    // Checkpoint each page so a kill mid-season loses at most one request.
    fs.writeFileSync(
      outFile,
      JSON.stringify({ season, complete: false, games }, null, 0)
    );
  }

  const finals = games.filter((g) => g.status === "Final");
  fs.writeFileSync(
    outFile,
    JSON.stringify({ season, complete: true, fetchedGames: games.length, games }, null, 0)
  );
  console.log(`season ${season}: DONE — ${games.length} games (${finals.length} final)`);
  return games.length;
}

async function main() {
  const args = process.argv.slice(2).map(Number).filter(Boolean);
  const seasons = args.length ? args : DEFAULT_SEASONS;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const key = apiKey();

  console.log(`Backfilling seasons: ${seasons.join(", ")}`);
  console.log(`Pacing at one request / ${MIN_GAP_MS / 1000}s (free tier = 5/min)\n`);

  let total = 0;
  for (const s of seasons) {
    total += await fetchSeason(s, key);
  }
  console.log(`\nALL DONE — ${total} games across ${seasons.length} seasons -> data/games/`);
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e.message);
  process.exit(1);
});
