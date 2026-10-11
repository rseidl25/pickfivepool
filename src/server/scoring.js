// Same scoring rules the old app used (ported from calculate_scores.js):
// correct pick = 10 points; correct bonus pick = 10 + that team's actual
// final score; incorrect pick or a tie = 0; not-yet-completed games keep
// showing 0 until they finish.

export function computeScores(leaguePicksMap, gamesData) {
  const scores = {};

  for (const [uid, weeksMap] of leaguePicksMap.entries()) {
    const weeks = {};
    let overall = 0;

    for (const [week, weekData] of weeksMap.entries()) {
      const weekNum = parseInt(week.replace("week", ""), 10);
      const gamesForWeek = gamesData.find((w) => w.week === weekNum)?.games || [];
      const teams = {};
      let weekTotal = 0;

      for (const pick of weekData.teamsPicked || []) {
        const { team } = pick;
        const isBonus = team === weekData.bonusPick;
        let points = 0;

        const game = gamesForWeek.find(
          (g) => g.homeTeam.includes(team) || g.awayTeam.includes(team)
        );

        if (game && game.status === "Completed") {
          // A tie must fall through to neither branch — the old `homeWin ?
          // homeTeam : awayTeam` ternary silently credited the away team as
          // "winner" whenever scores were equal, awarding points to anyone
          // who picked them in what was actually a tied (0-point) game.
          const winner = game.homeScore > game.awayScore ? game.homeTeam
            : game.awayScore > game.homeScore ? game.awayTeam
            : null;

          if (winner && winner.includes(team)) {
            if (isBonus) {
              const actualScore = game.homeTeam.includes(team) ? game.homeScore : game.awayScore;
              points = 10 + actualScore;
            } else {
              points = 10;
            }
          }
        }

        teams[team] = { points, bonus: isBonus };
        weekTotal += points;
      }

      weeks[week] = { teams, total: weekTotal };
      overall += weekTotal;
    }

    scores[uid] = { weeks, overall };
  }

  return scores;
}
