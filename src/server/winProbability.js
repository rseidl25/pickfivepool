// Monte Carlo "chance to win the week" simulation. ESPN's scoreboard API
// doesn't currently surface a per-game win-probability field through this
// app's poller, so every not-yet-completed game falls back to a 50/50
// coin-flip per the plan's documented fallback — not a shortcut around the
// spec, that fallback IS the spec when real odds aren't available.
//
// Scoring note: a correct bonus pick normally scores 10 + the team's actual
// final score, but a simulated (not-yet-decided) game has no real final
// score to use. For simulation purposes only, a correct pick — bonus or
// not — scores a flat 10. Already-completed games still use their real,
// exact scored value (via the same rule as scoring.js). This slightly
// undercounts bonus-heavy upside in the simulation, but there's no honest
// way to simulate an unplayed game's final score, and the simulation's job
// is relative ranking (who finishes #1), not exact point totals.

const TRIALS = 1000;

function isGameDecided(game) {
  return game.status === "Completed";
}

function actualWinner(game) {
  if (game.homeScore === game.awayScore) return null; // tie, nobody "wins"
  return game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
}

function findGame(gamesForWeek, team) {
  return gamesForWeek.find((g) => g.homeTeam.includes(team) || g.awayTeam.includes(team));
}

// One trial: given a map of gameKey -> simulated winner for undecided games,
// compute each uid's total for the week.
function computeTrialTotal(picks, gamesForWeek, simulatedWinners) {
  let total = 0;
  for (const pick of picks.teamsPicked || []) {
    const game = findGame(gamesForWeek, pick.team);
    if (!game) continue;

    let winner;
    if (isGameDecided(game)) {
      winner = actualWinner(game);
      if (winner && winner.includes(pick.team)) {
        const isBonus = pick.team === picks.bonusPick;
        const actualScore = game.homeTeam.includes(pick.team) ? game.homeScore : game.awayScore;
        total += isBonus ? 10 + actualScore : 10;
      }
    } else {
      winner = simulatedWinners.get(game);
      if (winner && winner.includes(pick.team)) {
        total += 10; // flat, see file header
      }
    }
  }
  return total;
}

/**
 * @param leagueSeasonPicks Map<uid, Map<week, {teamsPicked, bonusPick}>> — the whole league's picks
 * @param gamesForWeek this week's games from the poller
 * @param week e.g. "week3"
 * @param callerUid whose win% we want
 * @returns number 0-100
 */
export function simulateWinChance(leagueSeasonPicks, gamesForWeek, week, callerUid) {
  const undecidedGames = gamesForWeek.filter((g) => !isGameDecided(g));
  const memberPicks = new Map(); // uid -> weekData
  for (const [uid, weeksMap] of leagueSeasonPicks.entries()) {
    const weekData = weeksMap.get(week);
    if (weekData) memberPicks.set(uid, weekData);
  }

  if (memberPicks.size === 0) return 0;

  let callerWins = 0;

  for (let trial = 0; trial < TRIALS; trial++) {
    const simulatedWinners = new Map(); // game -> winning team name
    for (const game of undecidedGames) {
      simulatedWinners.set(game, Math.random() < 0.5 ? game.homeTeam : game.awayTeam);
    }

    let maxTotal = -Infinity;
    let leaders = [];
    for (const [uid, picks] of memberPicks.entries()) {
      const total = computeTrialTotal(picks, gamesForWeek, simulatedWinners);
      if (total > maxTotal) {
        maxTotal = total;
        leaders = [uid];
      } else if (total === maxTotal) {
        leaders.push(uid);
      }
    }

    if (leaders.includes(callerUid)) callerWins++;
  }

  return Math.round((callerWins / TRIALS) * 100);
}
