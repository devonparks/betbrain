// Maps team names (as returned by The Odds API) to ESPN team IDs and abbreviations
// ESPN team IDs for NBA: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams

export interface TeamInfo {
  espnId: string;
  abbreviation: string;
  shortName: string;
}

export const NBA_TEAMS: Record<string, TeamInfo> = {
  "Atlanta Hawks": { espnId: "1", abbreviation: "ATL", shortName: "Hawks" },
  "Boston Celtics": { espnId: "2", abbreviation: "BOS", shortName: "Celtics" },
  "Brooklyn Nets": { espnId: "17", abbreviation: "BKN", shortName: "Nets" },
  "Charlotte Hornets": { espnId: "30", abbreviation: "CHA", shortName: "Hornets" },
  "Chicago Bulls": { espnId: "4", abbreviation: "CHI", shortName: "Bulls" },
  "Cleveland Cavaliers": { espnId: "5", abbreviation: "CLE", shortName: "Cavaliers" },
  "Dallas Mavericks": { espnId: "6", abbreviation: "DAL", shortName: "Mavericks" },
  "Denver Nuggets": { espnId: "7", abbreviation: "DEN", shortName: "Nuggets" },
  "Detroit Pistons": { espnId: "8", abbreviation: "DET", shortName: "Pistons" },
  "Golden State Warriors": { espnId: "9", abbreviation: "GSW", shortName: "Warriors" },
  "Houston Rockets": { espnId: "10", abbreviation: "HOU", shortName: "Rockets" },
  "Indiana Pacers": { espnId: "11", abbreviation: "IND", shortName: "Pacers" },
  "Los Angeles Clippers": { espnId: "12", abbreviation: "LAC", shortName: "Clippers" },
  "Los Angeles Lakers": { espnId: "13", abbreviation: "LAL", shortName: "Lakers" },
  "Memphis Grizzlies": { espnId: "29", abbreviation: "MEM", shortName: "Grizzlies" },
  "Miami Heat": { espnId: "14", abbreviation: "MIA", shortName: "Heat" },
  "Milwaukee Bucks": { espnId: "15", abbreviation: "MIL", shortName: "Bucks" },
  "Minnesota Timberwolves": { espnId: "16", abbreviation: "MIN", shortName: "Timberwolves" },
  "New Orleans Pelicans": { espnId: "3", abbreviation: "NOP", shortName: "Pelicans" },
  "New York Knicks": { espnId: "18", abbreviation: "NYK", shortName: "Knicks" },
  "Oklahoma City Thunder": { espnId: "25", abbreviation: "OKC", shortName: "Thunder" },
  "Orlando Magic": { espnId: "19", abbreviation: "ORL", shortName: "Magic" },
  "Philadelphia 76ers": { espnId: "20", abbreviation: "PHI", shortName: "76ers" },
  "Phoenix Suns": { espnId: "21", abbreviation: "PHX", shortName: "Suns" },
  "Portland Trail Blazers": { espnId: "22", abbreviation: "POR", shortName: "Trail Blazers" },
  "Sacramento Kings": { espnId: "23", abbreviation: "SAC", shortName: "Kings" },
  "San Antonio Spurs": { espnId: "24", abbreviation: "SAS", shortName: "Spurs" },
  "Toronto Raptors": { espnId: "28", abbreviation: "TOR", shortName: "Raptors" },
  "Utah Jazz": { espnId: "26", abbreviation: "UTA", shortName: "Jazz" },
  "Washington Wizards": { espnId: "27", abbreviation: "WAS", shortName: "Wizards" },
};

export function getTeamInfo(teamName: string): TeamInfo | null {
  return NBA_TEAMS[teamName] ?? null;
}

export function getESPNTeamId(teamName: string): string | null {
  return NBA_TEAMS[teamName]?.espnId ?? null;
}
