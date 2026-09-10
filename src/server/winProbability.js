// "Chance to win the week" — exact enumeration, not Monte Carlo sampling,
// weighted by a per-game win-probability estimate.
//
// A not-yet-started game is weighted by the actual DraftKings moneyline ESPN's
// scoreboard endpoint returns alongside the score/clock it's already polling
// (see mapGames.js's parseMoneyline) — real market odds, not a coin flip,
// falling back to 50/50 only if a book hasn't posted a line yet. Once a game
// is actually in progress, scoreDiffToWinProb() below takes over instead,
// using the live score + time remaining — this is what makes a team you
// picked currently losing nudge your % down mid-game, the same way a fantasy
// platform's live projection moves as games play out. ESPN's scoreboard
// endpoint doesn't expose its own modeled *live* win probability through this
// app's poller (that lives on a separate, heavier endpoint), so the
// in-progress estimate is self-computed from score margin + time remaining,
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

// American odds ("-162" / "+136", already parsed to a number by mapGames.js)
// -> implied win probability. Negative = favorite (risk $|odds| to win $100),
// positive = underdog (risk $100 to win $odds).
function moneylineToProb(odds) {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// The book's actual pre-game line for a game that hasn't kicked off yet, with
// the vig removed: moneylineToProb() on each side alone sums to > 1 (that gap
// is the book's cut), so normalizing home/(home+away) rescales back to a true
// probability pair. Falls back to a flat 50/50 if a book hasn't posted odds
// for this game yet.
function preGameWinProb(game) {
  if (game.homeMoneyline == null || game.awayMoneyline == null) return 0.5;
  const home = moneylineToProb(game.homeMoneyline);
  const away = moneylineToProb(game.awayMoneyline);
  return home / (home + away);
}

// Inverse of the logistic function — converts a probability back to the
// log-odds ("z") scale so it can be added to the score-margin term below.
function logit(p) {
  const clamped = Math.min(MAX_LIVE_PROB, Math.max(MIN_LIVE_PROB, p));
  return Math.log(clamped / (1 - clamped));
}

// Home team's win probability for a still-undecided game: the market's
// pre-game line if it hasn't kicked off yet. Once live, anchors the logistic
// curve at that same pre-game line (as a log-odds offset) instead of a flat
// 50/50, so the % doesn't jump the instant kickoff happens — a 72% pre-game
// favorite is still ~72% at 0-0 in the first minute, then the score term
// (which grows as fractionRemaining shrinks) increasingly overrides that
// prior as the game actually tells you something a static line couldn't.
export function scoreDiffToWinProb(game) {
  const preGameProb = preGameWinProb(game);
  if (game.status !== "In Progress" || game.period == null || game.clockSeconds == null) {
    return preGameProb;
  }

  const secondsIntoPeriod = 15 * 60 - game.clockSeconds;
  const secondsElapsed = Math.min(REGULATION_SECONDS, (game.period - 1) * 15 * 60 + secondsIntoPeriod);
  const fractionRemaining = Math.max(0.01, 1 - secondsElapsed / REGULATION_SECONDS);

  const scoreDiff = game.homeScore - game.awayScore;
  const z = logit(preGameProb) + scoreDiff / (MARGIN_SENSITIVITY * Math.sqrt(fractionRemaining));
  const raw = 1 / (1 + Math.exp(-z));

  return Math.min(MAX_LIVE_PROB, Math.max(MIN_LIVE_PROB, raw));
}

// A team's expected final score implied by the closing spread + total —
// same market data moneylineToProb already reads, just the other two
// numbers off the same line. Standard split: favorite's implied score is
// half the total plus half the (positive) margin. Returns null if this
// book hasn't posted a spread/total yet (same gap moneylineToProb can hit).
function impliedTeamScore(game, isHomeTeam) {
  if (game.spread == null || game.overUnder == null) return null;
  const homeImplied = (game.overUnder - game.spread) / 2;
  const awayImplied = (game.overUnder + game.spread) / 2;
  return isHomeTeam ? homeImplied : awayImplied;
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
      const isHomeTeamPick = game.homeTeam.includes(pick.team);
      const isBonus = pick.team === picks.bonusPick;
      // A correct bonus pick on a still-undecided game used to be credited
      // a flat 10, same as any other pick — undervaluing it relative to an
      // already-decided bonus pick's real 10 + actual score, and making an
      // early already-banked bonus (like a completed game's) look far more
      // dominant than a same-caliber bonus pick that just hasn't kicked
      // off yet. Using the implied score keeps that comparison honest;
      // falls back to the old flat 10 if this book hasn't posted a
      // spread/total for the game yet.
      let pointsIfCorrect = 10;
      if (isBonus) {
        const implied = impliedTeamScore(game, isHomeTeamPick);
        if (implied != null) pointsIfCorrect = 10 + Math.round(implied);
      }
      swingPicks.push({ gameIdx: undecidedGameIndex.get(game), isHomeTeamPick, pointsIfCorrect });
    }
  }

  return { decidedTotal, swingPicks };
}

// Enumeration core for simulateWeekChances — walks every 2^k combination of
// the week's still-undecided games once and returns the probability-weighted
// share in which the caller finishes with the most points (outright win),
// plus the share in which they finish in a top-3 (competition-ranked, ties
// share a rank) position — both computed from the same single pass over
// every outcome rather than running the enumeration twice.
function enumerateOutcomes(leagueSeasonPicks, gamesForWeek, week, callerUid) {
  const undecidedGames = gamesForWeek.filter((g) => !isGameDecided(g));
  const undecidedGameIndex = new Map(undecidedGames.map((g, i) => [g, i]));
  const homeWinProbs = undecidedGames.map(scoreDiffToWinProb);

  const players = [];
  for (const [uid, weeksMap] of leagueSeasonPicks.entries()) {
    const weekData = weeksMap.get(week);
    if (!weekData) continue;
    players.push({ uid, ...splitPicks(weekData, gamesForWeek, undecidedGameIndex) });
  }

  const totalOutcomes = 1 << undecidedGames.length; // 2^k, k <= 16 games/week
  if (players.length === 0) {
    return { callerWinProbability: 0, callerTop3Probability: 0, totalOutcomes, winningOutcomes: 0 };
  }

  let callerWinProbability = 0;
  let callerTop3Probability = 0;
  let winningOutcomes = 0;

  for (let mask = 0; mask < totalOutcomes; mask++) {
    let maskProbability = 1;
    for (let i = 0; i < undecidedGames.length; i++) {
      const homeWon = (mask >> i) & 1;
      maskProbability *= homeWon ? homeWinProbs[i] : 1 - homeWinProbs[i];
    }
    if (maskProbability === 0) continue;

    const totals = players.map((player) => {
      let total = player.decidedTotal;
      for (const sp of player.swingPicks) {
        const homeWon = (mask >> sp.gameIdx) & 1;
        if (homeWon === (sp.isHomeTeamPick ? 1 : 0)) total += sp.pointsIfCorrect;
      }
      return { uid: player.uid, total };
    });
    totals.sort((a, b) => b.total - a.total);

    // Competition ranking (1224) — tied players share the rank they're
    // tied for, same rule used everywhere else scores are ranked in this
    // app (leaderboard, "T-4th of 16 players", etc.).
    let currentRank = 0;
    let prevTotal = null;
    let callerRank = null;
    for (let i = 0; i < totals.length; i++) {
      if (totals[i].total !== prevTotal) currentRank = i + 1;
      prevTotal = totals[i].total;
      if (totals[i].uid === callerUid) callerRank = currentRank;
    }

    if (callerRank === 1) {
      callerWinProbability += maskProbability;
      winningOutcomes++;
    }
    if (callerRank !== null && callerRank <= 3) {
      callerTop3Probability += maskProbability;
    }
  }

  return { callerWinProbability, callerTop3Probability, totalOutcomes, winningOutcomes };
}

/**
 * @param leagueSeasonPicks Map<uid, Map<week, {teamsPicked, bonusPick}>> — the whole league's picks
 * @param gamesForWeek this week's games from the poller
 * @param week e.g. "week3"
 * @param callerUid whose chances we want
 * @returns { winChancePct, top3ChancePct } both 0-100 — outright-win chance
 * alone reads as needlessly bleak early in a week (a single already-decided
 * game — e.g. someone else's bonus pick — can crater it to single digits
 * before the caller's own games have even kicked off), so top3ChancePct is
 * shown alongside it as a steadier, still-honest read on how someone's
 * actually doing.
 */
export function simulateWeekChances(leagueSeasonPicks, gamesForWeek, week, callerUid) {
  const { callerWinProbability, callerTop3Probability } = enumerateOutcomes(leagueSeasonPicks, gamesForWeek, week, callerUid);
  return {
    winChancePct: Math.round(callerWinProbability * 100),
    top3ChancePct: Math.round(callerTop3Probability * 100),
  };
}

