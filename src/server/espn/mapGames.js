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
    };
  });

  return { week: weekNumber, games };
}
