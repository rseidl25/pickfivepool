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
// Enumerating every combination of the k still-undecided games (instead of
// sampling a fixed number of random trials) makes the result exact under
// whatever per-game probabilities were used and, crucially, deterministic:
// the same picks + the same score/clock state always produce the same
// percentage, so it doesn't drift on every page refresh with nothing
// having actually changed — it only moves when a score or the clock
// actually does. A game nobody has as their bonus pick still only has 2
// possible states (win/lose), same as a plain 2^k bitmask always did; a
// game where someone's live bonus pick lives has a few more (see
// buildGameStates) since that side's actual score, not just win/lose, now
// matters for a correct-bonus payout — the combination count grows with
// how many *distinct games* are anyone's bonus pick, not with the number
// of players, so it stays cheap even in a large league.
//
// Scoring note: a correct pick — bonus or not — on an already-completed
// game uses its real, exact scored value (10 + actual score for the bonus
// team, via the same rule as scoring.js). A non-bonus pick always scores a
// flat 10 regardless of margin — that's the game's actual rule, not an
// approximation, so there's nothing to simulate there. A correct bonus pick
// on a still-undecided game is the one genuinely simulated piece: instead
// of a single flat point estimate, its payout is drawn from a small set of
// discrete score buckets around the market's implied score (see
// BONUS_SCORE_BUCKETS) — capturing that a real final score has real spread
// around its expected value, which specifically matters here since "who
// wins the week" is a question about tails, not medians.

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

// A single implied score is still just a guess at the mean — real NFL
// final scores land all over the place around that number, and "who wins
// the week" is inherently a tail-outcome question, not a median one.
// Discretizing into a few buckets around the implied score (instead of one
// flat point estimate) captures that spread while staying an exact,
// deterministic enumeration — no random sampling. Offsets are the 25th/75th
// percentile points of a normal curve (z = ±0.6745) at a hand-picked
// spread-of-outcomes of 10 points (roughly the real spread NFL team scores
// show around their expected value) — probably not fittable more precisely
// than that without real historical score-distribution data, but "some
// spread" beats "none" for a question about which tail you land in.
const BONUS_SCORE_BUCKETS = [
  { offset: -7, weight: 0.25 },
  { offset: 0, weight: 0.5 },
  { offset: 7, weight: 0.25 },
];

// Splits a player's picks into a fixed points total from already-decided
// games plus a list of "swing" picks whose outcome depends on one of the
// still-undecided games — so the per-outcome enumeration below only has to
// do this cheap lookup work once per player, not once per outcome. Bonus
// scoring for a still-undecided game is resolved later, per-outcome, by
// buildGameStates — it's a property of the *game* (shared by anyone who
// picked that team as their bonus), not something to precompute per player.
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
      swingPicks.push({ gameIdx: undecidedGameIndex.get(game), isHomeTeamPick, isBonus });
    }
  }

  return { decidedTotal, swingPicks };
}

// One side's (home or away) possible resolutions when it wins, given its
// bonus "mode": "none" (nobody's bonus pick — a single state, bonusPoints
// never read), "point" (someone else's live bonus pick — the point-estimate
// fix from earlier, one state worth 10 + the implied score), or "bucketed"
// (the caller's own live bonus pick — several discrete states spread around
// that same implied score instead of collapsing to one number).
function bonusStatesForSide(game, isHomeTeam, winProb, mode) {
  if (mode === "none") return [{ prob: winProb, bonusPoints: null }];
  const implied = impliedTeamScore(game, isHomeTeam);
  if (mode === "point" || implied == null) {
    return [{ prob: winProb, bonusPoints: implied != null ? 10 + Math.round(implied) : 10 }];
  }
  return BONUS_SCORE_BUCKETS.map((b) => ({ prob: winProb * b.weight, bonusPoints: 10 + Math.round(implied + b.offset) }));
}

// One undecided game's possible resolutions, as a small list of mutually
// exclusive {homeWon, prob, bonusPoints} states summing to 1 — 2 states
// (plain win/lose) for a game where neither side is bucket-mode, expanding
// only for whichever side is the caller's own live bonus pick.
function buildGameStates(game, homeWinProb, homeMode, awayMode) {
  const homeStates = bonusStatesForSide(game, true, homeWinProb, homeMode).map((s) => ({ homeWon: true, prob: s.prob, bonusPoints: s.bonusPoints }));
  const awayStates = bonusStatesForSide(game, false, 1 - homeWinProb, awayMode).map((s) => ({ homeWon: false, prob: s.prob, bonusPoints: s.bonusPoints }));
  return [...homeStates, ...awayStates];
}

// Enumeration core for simulateWeekChances — walks every combination of the
// week's still-undecided games once (mixed-radix, not a plain 2^k bitmask,
// since a game where somebody's bonus pick lives has more than 2 possible
// states — see buildGameStates) and returns the probability-weighted share
// in which the caller finishes with the most points (outright win), plus
// the share in which they finish in a top-3 (competition-ranked, ties share
// a rank) position — both computed from the same single pass over every
// combination rather than running the enumeration twice.
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

  if (players.length === 0) {
    return { callerWinProbability: 0, callerTop3Probability: 0, totalOutcomes: 1 << undecidedGames.length, winningOutcomes: 0 };
  }

  // Bucket only the *caller's own* live bonus pick, not everyone's — an
  // earlier version bucketed every player's bonus game and measured ~4s for
  // a single request on real league data (bucket states compound
  // multiplicatively across every distinct bonus-relevant game, and this
  // app runs on a Raspberry Pi, not a server). The caller's own bonus
  // uncertainty is also the dominant piece of "how sure am I about my own
  // outcome" anyway; everyone else's still uses the point-estimate fix
  // ("point" mode) rather than collapsing all the way back to a flat 10.
  // This keeps the combination count at essentially the same order of
  // magnitude as the original plain-2^k version (one game gets a few extra
  // states instead of 2, nothing else changes) regardless of how many other
  // players also have a live bonus pick.
  const homeMode = new Array(undecidedGames.length).fill("none");
  const awayMode = new Array(undecidedGames.length).fill("none");
  for (const player of players) {
    const isCaller = player.uid === callerUid;
    for (const sp of player.swingPicks) {
      if (!sp.isBonus) continue;
      const modes = sp.isHomeTeamPick ? homeMode : awayMode;
      // "bucketed" wins over "point" if somehow both apply to the same side
      // (can't happen in practice — that would mean the caller and someone
      // else both have the same team as their bonus, in which case they'd
      // already share "bucketed" — kept as a max() for clarity/safety).
      if (isCaller) modes[sp.gameIdx] = "bucketed";
      else if (modes[sp.gameIdx] === "none") modes[sp.gameIdx] = "point";
    }
  }

  const gameStates = undecidedGames.map((game, i) => buildGameStates(game, homeWinProbs[i], homeMode[i], awayMode[i]));
  const stateCounts = gameStates.map((s) => s.length);
  const totalOutcomes = stateCounts.reduce((a, b) => a * b, 1);

  let callerWinProbability = 0;
  let callerTop3Probability = 0;
  let winningOutcomes = 0;

  const resolvedHomeWon = new Array(undecidedGames.length);
  const resolvedBonusPoints = new Array(undecidedGames.length);
  // Reused across every combo instead of allocating a fresh sorted array
  // each time — this loop can run tens of thousands of times per request,
  // and a full sort()-with-closure per combo is what made an earlier
  // version of this (bucketing every player, not just the caller) measure
  // ~4s for a single request. Competition rank only needs "how many
  // *distinct* totals beat the caller's", not a full ordering, so this
  // avoids sorting everyone entirely.
  const allTotals = new Array(players.length);
  const distinctHigher = [];

  for (let combo = 0; combo < totalOutcomes; combo++) {
    let rem = combo;
    let comboProbability = 1;
    for (let i = 0; i < undecidedGames.length; i++) {
      const stateIdx = rem % stateCounts[i];
      rem = (rem - stateIdx) / stateCounts[i];
      const state = gameStates[i][stateIdx];
      comboProbability *= state.prob;
      resolvedHomeWon[i] = state.homeWon;
      resolvedBonusPoints[i] = state.bonusPoints;
    }
    if (comboProbability === 0) continue;

    let callerTotal = 0;
    for (let idx = 0; idx < players.length; idx++) {
      const player = players[idx];
      let total = player.decidedTotal;
      for (const sp of player.swingPicks) {
        if (resolvedHomeWon[sp.gameIdx] !== sp.isHomeTeamPick) continue;
        total += sp.isBonus ? resolvedBonusPoints[sp.gameIdx] : 10;
      }
      allTotals[idx] = total;
      if (player.uid === callerUid) callerTotal = total;
    }

    // Competition ranking (1224) — tied players share the rank they're
    // tied for, same rule used everywhere else scores are ranked in this
    // app (leaderboard, "T-4th of 16 players", etc.): rank = 1 + however
    // many distinct totals beat the caller's.
    distinctHigher.length = 0;
    for (let idx = 0; idx < allTotals.length; idx++) {
      const t = allTotals[idx];
      if (t > callerTotal && !distinctHigher.includes(t)) distinctHigher.push(t);
    }
    const callerRank = distinctHigher.length + 1;

    if (callerRank === 1) {
      callerWinProbability += comboProbability;
      winningOutcomes++;
    }
    if (callerRank <= 3) {
      callerTop3Probability += comboProbability;
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

