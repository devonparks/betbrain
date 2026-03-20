// ============ ODDS & SPORTS ============

export const SPORTS = {
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  ncaab: "basketball_ncaab",
  ncaaf: "americanfootball_ncaaf",
  ufc: "mma_mixed_martial_arts",
  soccer_epl: "soccer_epl",
} as const;

export type SportKey = keyof typeof SPORTS;
export type SportApiKey = (typeof SPORTS)[SportKey];

export interface Sport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export interface Bookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: Market[];
}

export interface Market {
  key: string; // "h2h", "spreads", "totals", "player_props"
  last_update: string;
  outcomes: Outcome[];
}

export interface Outcome {
  name: string;
  price: number;
  point?: number; // For spreads and totals
  description?: string; // For player props
}

export interface OddsResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

export interface ScoreResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
}

// ============ ODDS SNAPSHOTS ============

export interface OddsSnapshot {
  timestamp: Date;
  bookmaker: string;
  market: string;
  outcomes: Outcome[];
}

export interface BestOdds {
  moneyline: { home: { odds: number; book: string }; away: { odds: number; book: string } };
  spread: {
    home: { odds: number; point: number; book: string };
    away: { odds: number; point: number; book: string };
  };
  total: {
    over: { odds: number; point: number; book: string };
    under: { odds: number; point: number; book: string };
  };
}

// ============ STATS ============

export interface Player {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: Team;
}

export interface Team {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface GameLog {
  id: number;
  date: string;
  player: Player;
  team: Team;
  game: { id: number; date: string; home_team: Team; visitor_team: Team };
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  min: string;
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  pf: number;
}

export interface SeasonAverages {
  player_id: number;
  season: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  min: string;
  games_played: number;
  fg_pct: number;
  fg3_pct: number;
  ft_pct: number;
}

export interface Game {
  id: number;
  date: string;
  home_team: Team;
  visitor_team: Team;
  home_team_score: number;
  visitor_team_score: number;
  status: string;
  period: number;
  time: string;
  postseason: boolean;
}

export interface RecentForm {
  team: Team;
  lastN: Game[];
  record: { wins: number; losses: number };
  avgPointsFor: number;
  avgPointsAgainst: number;
  streak: { type: "W" | "L"; count: number };
}

export interface Injury {
  player: string;
  position: string;
  status: "Out" | "Doubtful" | "Questionable" | "Probable" | "Day-To-Day";
  description: string;
  lastUpdate: string;
}

// ============ LINEUP MONITOR ============

export interface LineupAlert {
  gameId: string;
  player: string;
  team: string;
  oldStatus: "active" | "questionable" | "doubtful" | "out";
  newStatus: "active" | "questionable" | "doubtful" | "out";
  timestamp: Date;
  oddsBeforeChange: OddsSnapshot | null;
  oddsAfterCheck: OddsSnapshot | null;
  valueWindowOpen: boolean;
  aiImpactAnalysis: string;
}

export interface LineupStatus {
  gameId: string;
  homeTeam: {
    confirmed: string[];
    questionable: string[];
    out: string[];
  };
  awayTeam: {
    confirmed: string[];
    questionable: string[];
    out: string[];
  };
  lastUpdated: Date;
}

export interface ValueWindow {
  gameId: string;
  alert: LineupAlert;
  detectedAt: Date;
  stillOpen: boolean;
  affectedMarkets: string[];
  recommendedAction: string;
}

// ============ AI ANALYSIS ============

export interface GameAnalysis {
  summary: string;
  bestBet: BetRecommendation;
  valueBets: BetRecommendation[];
  safeHailMary: SafeHailMaryParlay;
  keyFactors: string[];
  injuryImpact: InjuryRipple[];
  trapWarnings: string[];
  confidence: number;
  lastUpdated: Date;
  dataSourcesUsed: string[];
}

export interface BetRecommendation {
  type: "moneyline" | "spread" | "total" | "player_prop" | "parlay";
  pick: string;
  bestBook: string;
  bestOdds: string;
  confidence: number;
  reasoning: string;
  impliedProbability: number;
  estimatedTrueProbability: number;
  edge: number;
}

export interface SafeHailMaryParlay {
  safeLeg1: BetRecommendation;
  safeLeg2: BetRecommendation;
  safeLeg3?: BetRecommendation;
  hailMaryLeg: BetRecommendation;
  combinedOdds: string;
  reasoning: string;
  examplePayout: {
    wager: number;
    payout: number;
  };
}

export interface InjuryRipple {
  injuredPlayer: string;
  status: string;
  directImpact: string;
  rippleEffects: string[];
  bettingImplication: string;
}

// ============ DAILY PICK ============

export interface DailyPick {
  date: string;
  pick: BetRecommendation;
  fullAnalysis: string;
  historicalAccuracy: {
    allTime: PickRecord;
    last30Days: PickRecord;
    last7Days: PickRecord;
  };
  result?: "won" | "lost" | "push" | "pending";
}

export interface PickRecord {
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
}

// ============ RECAP ============

export interface BetResult {
  bet: BetRecommendation;
  result: "won" | "lost" | "push" | "void";
  actualOutcome: string;
  payout?: number;
}

export interface DailyRecap {
  date: string;
  picks: BetRecommendation[];
  results: BetResult[];
  record: { wins: number; losses: number; pushes: number };
  units: number;
  biggestWin: BetResult | null;
  aiSelfAnalysis: string;
}

// ============ PERFORMANCE ============

export interface PerformanceRecord {
  wins: number;
  losses: number;
  pushes: number;
  units: number;
  roi: number;
}

export interface AIPerformance {
  allTime: PerformanceRecord;
  bySport: Record<string, PerformanceRecord>;
  byBetType: Record<string, PerformanceRecord>;
  byConfidence: Record<string, PerformanceRecord>;
  byMonth: Record<string, PerformanceRecord>;
}

// ============ USER ============

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  preferences: {
    favoriteSports: SportKey[];
    defaultBook: string;
    notifications: {
      lineupAlerts: boolean;
      oddsMovement: boolean;
      dailyPick: boolean;
      groupActivity: boolean;
    };
  };
  betHistory: BetRecord[];
  savedParlays: SavedParlay[];
  record: PerformanceRecord;
  groups: string[];
  bankroll?: {
    current: number;
    starting: number;
    deposits: number;
    withdrawals: number;
  };
}

export interface BetRecord {
  id: string;
  date: string;
  bet: BetRecommendation;
  stake: number;
  result: "won" | "lost" | "push" | "pending";
  payout: number;
}

export interface SavedParlay {
  id: string;
  createdAt: Date;
  legs: BetRecommendation[];
  combinedOdds: string;
  stake?: number;
  result?: "won" | "lost" | "push" | "pending";
}

// ============ GROUPS ============

export interface Group {
  id: string;
  name: string;
  createdBy: string;
  members: Record<
    string,
    {
      displayName: string;
      role: "owner" | "admin" | "member";
      joinedAt: Date;
    }
  >;
  inviteCode: string;
  settings: {
    maxMembers: number;
    isPublic: boolean;
  };
}

export interface GroupMessage {
  id: string;
  author: string;
  authorName: string;
  text: string;
  timestamp: Date;
  type: "chat" | "parlay_share" | "pick" | "reaction";
  attachedParlay?: SavedParlay;
}

export interface GroupLeaderboardEntry {
  uid: string;
  displayName: string;
  record: { wins: number; losses: number; pushes: number };
  units: number;
  streak: number;
  lastPick: Date;
}

// ============ GAME CARD (UI) ============

export interface GameCardData {
  id: string;
  sportKey: SportKey;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bestOdds: BestOdds;
  aiConfidence: number;
  aiQuickTake: string;
  homeRecord?: string;
  awayRecord?: string;
  homeForm?: string; // "WWLWL"
  awayForm?: string;
  isLive?: boolean;
  homeScore?: number;
  awayScore?: number;
}
