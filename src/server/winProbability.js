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

// Shared enumeration core for simulateWinChance and winChanceBreakdown — runs
// the exact same 2^k loop once and hands back both the probability-weighted
// answer and the raw outcome counts behind it, so the "how was this
// calculated" popup can cite the literal masks that were counted instead of
// re-deriving (and risking drifting out of sync with) the real number.
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
    return { callerWinProbability: 0, totalOutcomes, winningOutcomes: 0, winningProbability: 0 };
  }

  let callerWinProbability = 0;
  let winningOutcomes = 0;

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

    if (leaders.includes(callerUid)) {
      callerWinProbability += maskProbability;
      winningOutcomes++;
    }
  }

  return { callerWinProbability, totalOutcomes, winningOutcomes };
}

/**
 * @param leagueSeasonPicks Map<uid, Map<week, {teamsPicked, bonusPick}>> — the whole league's picks
 * @param gamesForWeek this week's games from the poller
 * @param week e.g. "week3"
 * @param callerUid whose win% we want
 * @returns number 0-100
 */
export function simulateWinChance(leagueSeasonPicks, gamesForWeek, week, callerUid) {
  const { callerWinProbability } = enumerateOutcomes(leagueSeasonPicks, gamesForWeek, week, callerUid);
  return Math.round(callerWinProbability * 100);
}

// Human-facing breakdown of simulateWinChance's own inputs and outputs (the
// "how was this calculated?" popup): the caller's locked-in total, the live
// win probability behind each of their still-undecided picks, and — the part
// that actually shows where the % number itself comes from — the literal
// count of enumerated outcomes (out of every combination of the remaining
// games) in which the caller finishes with the most points, plus the total
// probability weight of that share. Both are produced by the exact same
// enumeration simulateWinChance runs, not re-derived, so they can't drift.
export function winChanceBreakdown(leagueSeasonPicks, gamesForWeek, week, callerUid) {
  const undecidedGames = gamesForWeek.filter((g) => !isGameDecided(g));
  const undecidedGameIndex = new Map(undecidedGames.map((g, i) => [g, i]));
  const homeWinProbs = undecidedGames.map(scoreDiffToWinProb);

  const weekData = leagueSeasonPicks.get(callerUid)?.get(week);
  if (!weekData) return null;
  const { decidedTotal, swingPicks } = splitPicks(weekData, gamesForWeek, undecidedGameIndex);

  const picks = swingPicks.map(({ gameIdx, isHomeTeamPick }) => {
    const game = undecidedGames[gameIdx];
    const winProb = isHomeTeamPick ? homeWinProbs[gameIdx] : 1 - homeWinProbs[gameIdx];
    const isLive = game.status === "In Progress" && game.period != null && game.clockSeconds != null;
    const hasOdds = game.homeMoneyline != null && game.awayMoneyline != null;
    return {
      team: isHomeTeamPick ? game.homeTeam : game.awayTeam,
      opponent: isHomeTeamPick ? game.awayTeam : game.homeTeam,
      status: game.status,
      winPct: Math.round(winProb * 100),
      // What the % is actually sourced from, so the popup can label it
      // instead of showing an unexplained number: "live" once the game has
      // started (score + clock), "odds" from the book's pre-game line, or
      // "even" only if a book hasn't posted a line for this game yet.
      source: isLive ? "live" : hasOdds ? "odds" : "even",
    };
  });

  const { totalOutcomes, winningOutcomes, callerWinProbability } = enumerateOutcomes(
    leagueSeasonPicks,
    gamesForWeek,
    week,
    callerUid
  );

  return {
    decidedTotal,
    picks,
    playerCount: leagueSeasonPicks.size,
    totalOutcomes,
    winningOutcomes,
    winProbabilityPct: Math.round(callerWinProbability * 100),
  };
}
