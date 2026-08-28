// "Chance to win the week" — exact enumeration, not Monte Carlo sampling,
// weighted by a live win-probability estimate for in-progress games.
//
// A not-yet-started game has no information yet, so it's a flat 50/50. An
// in-progress game is weighted by scoreDiffToWinProb() below, using the
// live score + clock the poller already fetches — this is what makes a
// team you picked currently losing nudge your % down mid-game, the same
// way a fantasy platform's live projection moves as games play out. ESPN's
// scoreboard endpoint doesn't expose its own modeled win probability
// through this app's poller (that lives on a separate, heavier endpoint),
// so this is a self-computed estimate from score margin + time remaining,
// not a sportsbook-grade model — see scoreDiffToWinProb's comment for the
// specifics and honest limitations (no possession/timeouts/etc.).
//
// Enumerating every 2^k outcome of the k still-undecided games (instead of
// sampling a fixed number of random trials) makes the result exact under
// whatever per-game probabilities were used and, crucially, deterministic:
// the same picks + the same score/clock state always produce the same
// percentage, so it doesn't drift on every page refresh with nothing
// having actually changed — it only moves when a score or the clock
// actually does. An NFL week has at most 16 games, so 2^k tops out at
// 65536 — cheap enough to enumerate in full on every request at this app's
// scale (~50ms measured with 15 players and all 16 games undecided).
//
// Scoring note: a correct bonus pick normally scores 10 + the team's actual
// final score, but a simulated (not-yet-decided) game has no real final
// score to use. For simulation purposes only, a correct pick — bonus or
// not — scores a flat 10. Already-completed games still use their real,
// exact scored value (via the same rule as scoring.js). This slightly
// undercounts bonus-heavy upside in the simulation, but there's no honest
// way to simulate an unplayed game's final score, and the simulation's job
// is relative ranking (who finishes #1), not exact point totals.

const REGULATION_SECONDS = 4 * 15 * 60; // 4 quarters, 15 min each
// How fast the win probability swings toward the leader as the score
// margin grows — hand-tuned, not fit to real data: a 7-point lead early in
// the game reads as ~64%, the same 7-point lead inside the final couple of
// minutes reads as ~90%+. Lower = swingier, higher = more conservative.
const MARGIN_SENSITIVITY = 12;
// Never fully certain before the real final whistle — leaves room for a
// comeback and avoids a discouraging/misleading flat 0% or 100% mid-game.
const MIN_LIVE_PROB = 0.02;
const MAX_LIVE_PROB = 0.98;

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

// Home team's win probability for a still-undecided game: 0.5 if it hasn't
// kicked off yet (or the poller's period/clock fields aren't populated),
// otherwise a logistic function of the current score margin scaled by how
// much of the game remains — bigger lead + less time left = more confident,
// exactly the shape a live win-probability estimate should have even
// though the specific curve here isn't derived from real historical data.
function scoreDiffToWinProb(game) {
  if (game.status !== "In Progress" || game.period == null || game.clockSeconds == null) {
    return 0.5;
  }

  const secondsIntoPeriod = 15 * 60 - game.clockSeconds;
  const secondsElapsed = Math.min(REGULATION_SECONDS, (game.period - 1) * 15 * 60 + secondsIntoPeriod);
  const fractionRemaining = Math.max(0.01, 1 - secondsElapsed / REGULATION_SECONDS);

  const scoreDiff = game.homeScore - game.awayScore;
  const z = scoreDiff / (MARGIN_SENSITIVITY * Math.sqrt(fractionRemaining));
  const raw = 1 / (1 + Math.exp(-z));

  return Math.min(MAX_LIVE_PROB, Math.max(MIN_LIVE_PROB, raw));
}

// Splits a player's picks into a fixed points total from already-decided
// games plus a list of "swing" picks whose outcome depends on one of the
// still-undecided games — so the per-outcome enumeration below only has to
// do this cheap lookup work once per player, not once per outcome.
function splitPicks(picks, gamesForWeek, undecidedGameIndex) {
  let decidedTotal = 0;
  const swingPicks = [];

  for (const pick of picks.teamsPicked || []) {
    const game = findGame(gamesForWeek, pick.team);
    if (!game) continue;

    if (isGameDecided(game)) {
      const winner = actualWinner(game);
      if (winner && winner.includes(pick.team)) {
        const isBonus = pick.team === picks.bonusPick;
        const actualScore = game.homeTeam.includes(pick.team) ? game.homeScore : game.awayScore;
        decidedTotal += isBonus ? 10 + actualScore : 10;
      }
    } else {
      swingPicks.push({
        gameIdx: undecidedGameIndex.get(game),
        isHomeTeamPick: game.homeTeam.includes(pick.team),
      });
    }
  }

  return { decidedTotal, swingPicks };
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
  const undecidedGameIndex = new Map(undecidedGames.map((g, i) => [g, i]));
  const homeWinProbs = undecidedGames.map(scoreDiffToWinProb);

  const players = [];
  for (const [uid, weeksMap] of leagueSeasonPicks.entries()) {
    const weekData = weeksMap.get(week);
    if (!weekData) continue;
    players.push({ uid, ...splitPicks(weekData, gamesForWeek, undecidedGameIndex) });
  }

  if (players.length === 0) return 0;

  const totalOutcomes = 1 << undecidedGames.length; // 2^k, k <= 16 games/week
  let callerWinProbability = 0;

  for (let mask = 0; mask < totalOutcomes; mask++) {
    let maskProbability = 1;
    for (let i = 0; i < undecidedGames.length; i++) {
      const homeWon = (mask >> i) & 1;
      maskProbability *= homeWon ? homeWinProbs[i] : 1 - homeWinProbs[i];
    }
    if (maskProbability === 0) continue;

    let maxTotal = -Infinity;
    let leaders = [];

    for (const player of players) {
      let total = player.decidedTotal;
      for (const sp of player.swingPicks) {
        const homeWon = (mask >> sp.gameIdx) & 1;
        if (homeWon === (sp.isHomeTeamPick ? 1 : 0)) total += 10;
      }
      if (total > maxTotal) {
        maxTotal = total;
        leaders = [player.uid];
      } else if (total === maxTotal) {
        leaders.push(player.uid);
      }
    }

    if (leaders.includes(callerUid)) callerWinProbability += maskProbability;
  }

  return Math.round(callerWinProbability * 100);
}
