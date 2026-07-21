/**
 * Loads backfilled historical games off disk and hands the rest of the pipeline
 * a clean, chronologically-sorted list.
 *
 * Chronological order is not a convenience here — it is the safety property the
 * whole backtest depends on. Every downstream consumer assumes that walking the
 * array forward means walking time forward, so a prediction made at index i can
 * only ever have seen games at indices < i.
 */
import fs from "node:fs";
import path from "node:path";
import type { Game, RawGame } from "./types.ts";

const DATA_DIR = path.join(process.cwd(), "data", "games");

/** Which seasons have been backfilled and are complete. */
export function availableSeasons(dir: string = DATA_DIR): number[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => Number(f.replace(".json", "")))
    .filter((season) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, `${season}.json`), "utf8"));
        return raw?.complete === true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a - b);
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Map the BallDontLie payload onto the model-facing Game.
 * Returns null for anything not actually finished — an unplayed or postponed
 * game must never enter the training set.
 */
export function normalizeGame(raw: RawGame): Game | null {
  if (raw?.status !== "Final") return null;
  const homeScore = num(raw.home_team_score);
  const awayScore = num(raw.visitor_team_score);
  if (homeScore === null || awayScore === null) return null;
  // A real NBA game is never 0-0; guards against placeholder rows.
  if (homeScore === 0 && awayScore === 0) return null;

  const hq1 = num(raw.home_q1);
  const hq2 = num(raw.home_q2);
  const aq1 = num(raw.visitor_q1);
  const aq2 = num(raw.visitor_q2);

  const homeFirstHalf = hq1 !== null && hq2 !== null ? hq1 + hq2 : null;
  const awayFirstHalf = aq1 !== null && aq2 !== null ? aq1 + aq2 : null;

  const wentToOvertime =
    num(raw.home_ot1) !== null ||
    num(raw.visitor_ot1) !== null ||
    num(raw.home_ot2) !== null ||
    num(raw.visitor_ot2) !== null;

  return {
    id: raw.id,
    date: raw.date,
    season: raw.season,
    postseason: Boolean(raw.postseason),
    homeId: raw.home_team.id,
    awayId: raw.visitor_team.id,
    homeAbbr: raw.home_team.abbreviation,
    awayAbbr: raw.visitor_team.abbreviation,
    homeScore,
    awayScore,
    homeFirstHalf,
    awayFirstHalf,
    homeQ1: hq1,
    awayQ1: aq1,
    margin: homeScore - awayScore,
    total: homeScore + awayScore,
    wentToOvertime,
  };
}

export interface LoadResult {
  games: Game[];
  seasons: number[];
  /** Raw rows that were dropped (unplayed, postponed, malformed). */
  skipped: number;
}

/**
 * Load the requested seasons, normalized and sorted oldest-first.
 * Ties on date are broken by game id so the ordering is deterministic across runs —
 * a backtest that shuffles on every run is not reproducible.
 */
export function loadGames(
  seasons?: number[],
  dir: string = DATA_DIR
): LoadResult {
  const wanted = seasons?.length ? seasons : availableSeasons(dir);
  const games: Game[] = [];
  let skipped = 0;

  for (const season of wanted) {
    const file = path.join(dir, `${season}.json`);
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
      games?: RawGame[];
    };
    for (const raw of payload.games ?? []) {
      const g = normalizeGame(raw);
      if (g) games.push(g);
      else skipped++;
    }
  }

  games.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  return { games, seasons: wanted, skipped };
}

/**
 * Split chronologically for walk-forward validation.
 *
 * Deliberately NOT a random split. Randomly holding out games would let the
 * model train on March to predict January — a leak that makes results look
 * great and mean nothing. The test set must lie strictly in the future of the
 * training set.
 */
export function chronologicalSplit(
  games: Game[],
  testFraction = 0.3
): { train: Game[]; test: Game[]; splitDate: string } {
  if (games.length === 0) return { train: [], test: [], splitDate: "" };
  const cut = Math.floor(games.length * (1 - testFraction));
  const train = games.slice(0, cut);
  const test = games.slice(cut);
  return { train, test, splitDate: test[0]?.date ?? "" };
}
