import { LineupAlert, ValueWindow, OddsSnapshot } from "./types";
import { getTeamInjuries } from "./stats-api";

// In-memory cache for tracking status changes
const statusCache = new Map<
  string,
  Map<string, "active" | "questionable" | "doubtful" | "out">
>();

/**
 * Check for lineup changes for a specific game
 */
export async function checkLineupChanges(
  sportKey: string,
  gameId: string,
  homeTeamId: string,
  awayTeamId: string
): Promise<LineupAlert[]> {
  const alerts: LineupAlert[] = [];

  // Get current injury reports
  const [homeInjuries, awayInjuries] = await Promise.all([
    getTeamInjuries(sportKey, homeTeamId),
    getTeamInjuries(sportKey, awayTeamId),
  ]);

  const allInjuries = [
    ...homeInjuries.map((i) => ({ ...i, teamId: homeTeamId })),
    ...awayInjuries.map((i) => ({ ...i, teamId: awayTeamId })),
  ];

  const cacheKey = gameId;
  const previousStatuses = statusCache.get(cacheKey) ?? new Map();

  for (const injury of allInjuries) {
    const playerKey = `${injury.player}_${injury.teamId}`;
    const normalizedStatus = normalizeStatus(injury.status);
    const previousStatus = previousStatuses.get(playerKey) ?? "active";

    if (normalizedStatus !== previousStatus) {
      alerts.push({
        gameId,
        player: injury.player,
        team: injury.teamId,
        oldStatus: previousStatus,
        newStatus: normalizedStatus,
        timestamp: new Date(),
        oddsBeforeChange: null, // Would need snapshot before
        oddsAfterCheck: null, // Would need current snapshot
        valueWindowOpen: false, // Will be determined by caller
        aiImpactAnalysis: "", // Will be filled by AI
      });
    }

    previousStatuses.set(playerKey, normalizedStatus);
  }

  statusCache.set(cacheKey, previousStatuses);

  return alerts;
}

/**
 * Normalize injury status strings to our enum
 */
function normalizeStatus(
  status: string
): "active" | "questionable" | "doubtful" | "out" {
  const lower = status.toLowerCase();
  if (lower.includes("out") || lower.includes("injured")) return "out";
  if (lower.includes("doubtful")) return "doubtful";
  if (
    lower.includes("questionable") ||
    lower.includes("day-to-day") ||
    lower.includes("probable")
  )
    return "questionable";
  return "active";
}

/**
 * Detect value windows — when odds haven't adjusted after a lineup change
 */
export function detectValueWindows(
  alerts: LineupAlert[],
  currentOdds: OddsSnapshot | null,
  previousOdds: OddsSnapshot | null
): ValueWindow[] {
  const windows: ValueWindow[] = [];

  for (const alert of alerts) {
    // Only flag significant changes (player going from active/questionable to out)
    const isSignificant =
      (alert.oldStatus === "active" || alert.oldStatus === "questionable") &&
      (alert.newStatus === "out" || alert.newStatus === "doubtful");

    if (!isSignificant) continue;

    // Check if odds have moved
    const oddsHaveMoved =
      currentOdds &&
      previousOdds &&
      currentOdds.outcomes.some((curr, i) => {
        const prev = previousOdds.outcomes[i];
        return prev && Math.abs(curr.price - prev.price) > 10;
      });

    if (!oddsHaveMoved) {
      windows.push({
        gameId: alert.gameId,
        alert,
        detectedAt: new Date(),
        stillOpen: true,
        affectedMarkets: ["h2h", "spreads", "totals"],
        recommendedAction: `${alert.player} ruled ${alert.newStatus} but odds haven't adjusted. Check ${alert.team}'s lines for value.`,
      });
    }
  }

  return windows;
}

/**
 * Build pre-game timeline entries
 */
export interface TimelineEntry {
  timestamp: Date;
  type: "lineup" | "odds" | "injury" | "news";
  title: string;
  description: string;
  isValueWindow: boolean;
}

export function buildTimeline(
  alerts: LineupAlert[],
  valueWindows: ValueWindow[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const alert of alerts) {
    entries.push({
      timestamp: alert.timestamp,
      type: "injury",
      title: `${alert.player} status: ${alert.oldStatus} → ${alert.newStatus}`,
      description: alert.aiImpactAnalysis || `${alert.player} (${alert.team}) moved from ${alert.oldStatus} to ${alert.newStatus}`,
      isValueWindow: alert.valueWindowOpen,
    });
  }

  for (const window of valueWindows) {
    entries.push({
      timestamp: window.detectedAt,
      type: "lineup",
      title: `VALUE WINDOW: ${window.alert.player} ${window.alert.newStatus}`,
      description: window.recommendedAction,
      isValueWindow: true,
    });
  }

  return entries.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );
}
