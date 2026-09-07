const STATUS_MAP = {
  pre: "Scheduled",
  in: "In Progress",
  post: "Completed",
};

function formatWeekday(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(isoDate));
}

function formatGameTime(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoDate));
}

// American-odds moneyline as a plain number ("-162" / "+136" -> -162 / 136),
// or null if this book hasn't posted one (bye-adjacent or very early-week
// games sometimes lack odds briefly). Only meaningful pre-kickoff — used by
// winProbability.js as the pre-game win estimate instead of a flat coin
// flip; once the game is actually in progress, the live score/clock is a
// better signal and takes over instead.
function parseMoneyline(sideOdds) {
  const raw = sideOdds?.close?.odds ?? sideOdds?.open?.odds;
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

// Maps one ESPN scoreboard API response (single week) to the shape
// games.json has always used: { week, games: [{ homeTeam, homeScore,
// awayTeam, awayScore, weekday, gameTime, status }] }.
export function mapEspnWeekToGames(espnResponse, weekNumber) {
  const events = espnResponse?.events || [];

  const games = events.map((event) => {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");

    const state = competition?.status?.type?.state;
    const status = STATUS_MAP[state] || "Scheduled";

    // First odds provider ESPN lists (currently always DraftKings) — good
    // enough for a pre-game estimate; not trying to shop/average books.
    const moneyline = competition?.odds?.[0]?.moneyline;

    return {
      homeTeam: home?.team?.displayName || "",
      homeScore: parseInt(home?.score, 10) || 0,
      awayTeam: away?.team?.displayName || "",
      awayScore: parseInt(away?.score, 10) || 0,
      weekday: formatWeekday(event.date),
      gameTime: status === "Scheduled" ? formatGameTime(event.date) : null,
      status,
      // Only meaningful mid-game — used by winProbability.js to weight a
      // live game's simulated outcome by its current score/clock instead
      // of a flat coin flip. period: 1-4 regulation, 5+ overtime.
      period: competition?.status?.period ?? null,
      clockSeconds: typeof competition?.status?.clock === "number" ? competition.status.clock : null,
      homeMoneyline: parseMoneyline(moneyline?.home),
      awayMoneyline: parseMoneyline(moneyline?.away),
    };
  });

  return { week: weekNumber, games };
}
