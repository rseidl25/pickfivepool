import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireOpenSeason } from "../middleware/seasonLock.js";
import { db } from "../firebaseAdmin.js";
import * as store from "../store.js";
import { getGames } from "../espn/poller.js";
import { computeScores } from "../scoring.js";
import { simulateWinChance } from "../winProbability.js";

const router = Router({ mergeParams: true }); // mergeParams lets it see :id from the parent mount

const TOTAL_WEEKS = 18;

function requireLeagueMember(req, res, next) {
  const league = store.getLeague(req.params.id);
  if (!league || !league.members.has(req.uid)) {
    return res.status(403).json({ error: "Not a member of this league" });
  }
  req.league = league;
  next();
}

// A member's picks are invisible to the rest of the league — leaderboard,
// stats, hate-watch, everywhere — until they've submitted ALL of them.
// Otherwise other members could watch someone's in-progress picks update
// live before that member has locked anything in. Members who haven't
// submitted yet simply have no entry here, so downstream code (which already
// has to handle "no picks yet" as a zero/empty state) treats them the same
// as a brand-new member.
function submittedSeasonPicks(league) {
  const filtered = new Map();
  for (const [uid, weeksMap] of league.seasonPicks.entries()) {
    if (league.submissions.get(uid)?.submitted) filtered.set(uid, weeksMap);
  }
  return filtered;
}

// Every current member appears, even ones with zero picks so far — deriving
// this from `scores` alone would silently drop anyone who hasn't picked a
// single team yet (computeScores only has entries for uids with picks).
function scoresWithNames(scores, league) {
  return [...league.members.keys()]
    .map((uid) => {
      const data = scores[uid] || { overall: 0, weeks: {} };
      return {
        uid,
        displayName: league.members.get(uid)?.displayName || null,
        photoURL: league.members.get(uid)?.photoURL || null,
        overall: data.overall,
        weeks: data.weeks,
      };
    })
    .sort((a, b) => b.overall - a.overall);
}

// GET /api/leagues/:id/scores
router.get("/scores", requireAuth, requireLeagueMember, (req, res) => {
  const scores = computeScores(submittedSeasonPicks(req.league), getGames());
  res.json(scoresWithNames(scores, req.league));
});

// GET /api/leagues/:id/stats — in-season fun stats
router.get("/stats", requireAuth, requireLeagueMember, (req, res) => {
  const league = req.league;
  const scores = computeScores(submittedSeasonPicks(league), getGames());

  const allWeeks = new Set();
  for (const data of Object.values(scores)) {
    Object.keys(data.weeks).forEach((w) => allWeeks.add(w));
  }
  const sortedWeeks = [...allWeeks].sort(
    (a, b) => parseInt(a.replace("week", ""), 10) - parseInt(b.replace("week", ""), 10)
  );

  // per completed week, who had the strictly-highest total (ties share it, an
  // all-zero week counts as no one winning it)
  const weekWinners = {};
  for (const week of sortedWeeks) {
    let maxTotal = 0;
    let leaders = [];
    for (const [uid, data] of Object.entries(scores)) {
      const total = data.weeks[week]?.total ?? 0;
      if (total > maxTotal) {
        maxTotal = total;
        leaders = [uid];
      } else if (total === maxTotal && total > 0) {
        leaders.push(uid);
      }
    }
    weekWinners[week] = leaders;
  }

  const stats = Object.entries(scores).map(([uid, data]) => {
    let highestWeek = null;
    for (const [week, weekData] of Object.entries(data.weeks)) {
      if (!highestWeek || weekData.total > highestWeek.total) {
        highestWeek = { week, total: weekData.total };
      }
    }

    const weeksWon = sortedWeeks.filter((w) => weekWinners[w].includes(uid)).length;
    const totalWeeksPlayed = Object.keys(data.weeks).length;

    let currentStreak = 0;
    for (let i = sortedWeeks.length - 1; i >= 0; i--) {
      if (weekWinners[sortedWeeks[i]].includes(uid)) currentStreak++;
      else break;
    }

    return {
      uid,
      displayName: league.members.get(uid)?.displayName || null,
      highestWeek,
      weeksWon,
      winPct: totalWeeksPlayed ? weeksWon / totalWeeksPlayed : 0,
      currentStreak,
    };
  });

  res.json(stats);
});

// Points earned so far this week from already-COMPLETED games only — the
// caller's/an opponent's "locked in" floor, used as the hate-watch threshold.
function decidedTotalForWeek(weekData, gamesForWeek) {
  let total = 0;
  for (const pick of weekData?.teamsPicked || []) {
    const game = gamesForWeek.find((g) => g.homeTeam.includes(pick.team) || g.awayTeam.includes(pick.team));
    if (!game || game.status !== "Completed") continue;
    const winner = game.homeScore === game.awayScore ? null : game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
    if (winner && winner.includes(pick.team)) {
      const isBonus = pick.team === weekData.bonusPick;
      const actualScore = game.homeTeam.includes(pick.team) ? game.homeScore : game.awayScore;
      total += isBonus ? 10 + actualScore : 10;
    }
  }
  return total;
}

// GET /api/leagues/:id/my-week?week=N
router.get("/my-week", requireAuth, requireLeagueMember, (req, res) => {
  const league = req.league;
  const week = req.query.week;
  if (!week) {
    return res.status(400).json({ error: "?week=N is required" });
  }
  const weekKey = `week${week}`;
  const gamesForWeek = getGames().find((g) => g.week === parseInt(week, 10))?.games || [];

  const myWeekData = league.seasonPicks.get(req.uid)?.get(weekKey);
  const bonusPick = myWeekData?.bonusPick || null;
  const teamsToWatch = (myWeekData?.teamsPicked || [])
    .map((p) => p.team)
    .filter((team) => team !== bonusPick);

  // Scored per-team points for the caller's own picks — computed directly
  // from their raw picks (not submittedSeasonPicks), since the "hidden until
  // fully submitted" rule is about shielding picks from OTHER members, not
  // from the player viewing their own in-progress week.
  const myOwnPicksMap = new Map([[req.uid, league.seasonPicks.get(req.uid) || new Map()]]);
  const myScoredWeek = computeScores(myOwnPicksMap, getGames())[req.uid]?.weeks?.[weekKey] || { teams: {}, total: 0 };

  const myDecidedTotal = decidedTotalForWeek(myWeekData, gamesForWeek);

  // Other members' still-undecided picks that would put them ahead of the
  // caller's current locked-in total if that team wins — a simple deduped
  // list of team names, matching the "Hate watch: Team 1 / Team 2" sketch
  // (not attributed per-opponent).
  const hateWatchSet = new Set();
  for (const [uid, weeksMap] of submittedSeasonPicks(league).entries()) {
    if (uid === req.uid) continue;
    const theirWeekData = weeksMap.get(weekKey);
    if (!theirWeekData) continue;
    const theirDecidedTotal = decidedTotalForWeek(theirWeekData, gamesForWeek);

    for (const pick of theirWeekData.teamsPicked || []) {
      const game = gamesForWeek.find((g) => g.homeTeam.includes(pick.team) || g.awayTeam.includes(pick.team));
      if (!game || game.status === "Completed") continue;
      if (theirDecidedTotal + 10 > myDecidedTotal) hateWatchSet.add(pick.team);
    }
  }

  const winChancePct = simulateWinChance(league.seasonPicks, gamesForWeek, weekKey, req.uid);

  // How many players (league-wide) picked each team this week, for the top-5
  // "Most Picked Teams" list. Gated the same way as everywhere else that
  // aggregates other members' picks — hidden until they've submitted the
  // whole season — except the caller's own pick always counts, even if they
  // haven't submitted yet, since it's their own week being displayed to them.
  const teamCounts = {};
  for (const [uid, weeksMap] of submittedSeasonPicks(league).entries()) {
    const theirWeekData = weeksMap.get(weekKey);
    if (!theirWeekData) continue;
    for (const pick of theirWeekData.teamsPicked || []) {
      teamCounts[pick.team] = (teamCounts[pick.team] || 0) + 1;
    }
  }
  if (!league.submissions.get(req.uid)?.submitted) {
    for (const pick of myWeekData?.teamsPicked || []) {
      teamCounts[pick.team] = (teamCounts[pick.team] || 0) + 1;
    }
  }
  const mostPickedTeams = Object.entries(teamCounts)
    .map(([team, count]) => ({ team, count }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team))
    .slice(0, 5);

  res.json({
    week: parseInt(week, 10),
    bonusPick,
    teamsToWatch,
    teams: myScoredWeek.teams,
    total: myScoredWeek.total,
    hateWatch: [...hateWatchSet],
    mostPickedTeams,
    winChancePct,
  });
});

// GET /api/leagues/:id/seasons — years this league has real pick data for,
// excluding the currently-active season (Hall of Fame is for seasons that
// have actually finished; the active year's live standings live under the
// "This Season" tab instead). Drives the Hall of Fame year picker so it only
// ever offers years the league genuinely existed for.
router.get("/seasons", requireAuth, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const currentYear = String(store.getSeasonConfig().year);

  const weeksSnap = await db.collectionGroup("weeks").get();
  const prefix = `leagues/${leagueId}/seasons/`;
  const years = new Set();
  for (const doc of weeksSnap.docs) {
    const path = doc.ref.path;
    if (!path.startsWith(prefix)) continue;
    const year = path.slice(prefix.length).split("/")[0];
    if (year !== currentYear) years.add(year);
  }

  res.json([...years].sort((a, b) => b.localeCompare(a)));
});

// Longest consecutive run of weekly wins anywhere in the season (not just a
// trailing/current streak — for a finished season, the peak is what matters)
// plus weeks-won and win% for the same finished-season view. Separate from
// /stats' per-week logic since /stats' currentStreak is trailing-only,
// appropriate mid-season but not for a season-in-the-books retrospective.
function computeSeasonAwardsPerUser(scores) {
  const allWeeks = new Set();
  for (const data of Object.values(scores)) {
    Object.keys(data.weeks).forEach((w) => allWeeks.add(w));
  }
  const sortedWeeks = [...allWeeks].sort(
    (a, b) => parseInt(a.replace("week", ""), 10) - parseInt(b.replace("week", ""), 10)
  );

  const weekWinners = {};
  for (const week of sortedWeeks) {
    let maxTotal = 0;
    let leaders = [];
    for (const [uid, data] of Object.entries(scores)) {
      const total = data.weeks[week]?.total ?? 0;
      if (total > maxTotal) {
        maxTotal = total;
        leaders = [uid];
      } else if (total === maxTotal && total > 0) {
        leaders.push(uid);
      }
    }
    weekWinners[week] = leaders;
  }

  const perUser = {};
  for (const [uid, data] of Object.entries(scores)) {
    let highestWeek = null;
    for (const [week, weekData] of Object.entries(data.weeks)) {
      if (!highestWeek || weekData.total > highestWeek.total) {
        highestWeek = { week, total: weekData.total };
      }
    }

    const weeksWon = sortedWeeks.filter((w) => weekWinners[w].includes(uid)).length;
    const tiedWeeks = sortedWeeks.filter((w) => weekWinners[w].length > 1 && weekWinners[w].includes(uid)).length;

    let longestStreak = 0;
    let running = 0;
    for (const week of sortedWeeks) {
      if (weekWinners[week].includes(uid)) {
        running++;
        longestStreak = Math.max(longestStreak, running);
      } else {
        running = 0;
      }
    }

    let bonusesWon = 0;
    for (const weekData of Object.values(data.weeks)) {
      for (const teamData of Object.values(weekData.teams)) {
        if (teamData.bonus && teamData.points > 0) bonusesWon++;
      }
    }

    perUser[uid] = {
      highestWeek,
      weeksWon,
      tiedWeeks,
      longestStreak,
      bonusesWon,
    };
  }
  return perUser;
}

// GET /api/leagues/:id/seasons/:year — Hall of Fame awards for a finished season
router.get("/seasons/:year", requireAuth, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const year = req.params.year;
  const league = req.league;

  const seasonSnap = await db.collection("seasons").doc(year).get();
  if (!seasonSnap.exists) {
    return res.status(404).json({ error: "No archived data for that season" });
  }
  const games = seasonSnap.data().games || [];

  // picks/{uid} parent docs are never explicitly written (only their weeks
  // subcollection is — same Firestore "implicit parent" gotcha as store.js),
  // so .collection("picks").get() would silently find nothing. Scan
  // collectionGroup("weeks") and filter to this league+year's path instead.
  const weeksSnap = await db.collectionGroup("weeks").get();
  const pathPrefix = `leagues/${leagueId}/seasons/${year}/picks/`;

  const leaguePicksMap = new Map();
  for (const weekDoc of weeksSnap.docs) {
    const path = weekDoc.ref.path;
    if (!path.startsWith(pathPrefix)) continue;
    const [uid, , weekId] = path.slice(pathPrefix.length).split("/");

    const d = weekDoc.data();
    if (!leaguePicksMap.has(uid)) leaguePicksMap.set(uid, new Map());
    leaguePicksMap.get(uid).set(weekId, { teamsPicked: d.teamsPicked || [], bonusPick: d.bonusPick ?? null });
  }

  if (leaguePicksMap.size === 0) {
    return res.status(404).json({ error: "No archived data for that season" });
  }

  const scores = computeScores(leaguePicksMap, games);
  const perUserAwards = computeSeasonAwardsPerUser(scores);

  const standings = [];
  for (const [uid, data] of Object.entries(scores)) {
    let displayName = league.members.get(uid)?.displayName;
    if (!displayName) {
      const userSnap = await db.collection("users").doc(uid).get();
      displayName = userSnap.data()?.displayName || "Unknown";
    }
    standings.push({ uid, displayName, overall: data.overall, ...perUserAwards[uid] });
  }
  standings.sort((a, b) => b.overall - a.overall);

  // Each award collects every player tied for the best value, not just
  // whoever happened to sort first — a tie for "most weeks won" is still
  // a shared award, not a coin flip.
  function collectTied(items, getValue) {
    let best = null;
    let winners = [];
    for (const item of items) {
      const value = getValue(item);
      if (value == null) continue;
      if (best === null || value > best) {
        best = value;
        winners = [item];
      } else if (value === best) {
        winners.push(item);
      }
    }
    return { best, winners };
  }

  // Shape: { best, players: [{ name, ...perPlayerExtra }] } — each player
  // carries their own extra fields (e.g. which week) rather than the group
  // sharing one, since tied players don't necessarily share every detail
  // (two players can each have a 91-point "highest week" in different weeks).
  function buildAward(getValue, perPlayerExtra = () => ({})) {
    const { best, winners } = collectTied(standings, getValue);
    if (best == null || !winners.length) return null;
    return { best, players: winners.map((s) => ({ name: s.displayName, ...perPlayerExtra(s) })) };
  }

  const champion = buildAward((s) => s.overall);

  let woodenSpoon = null;
  if (standings.length > 1) {
    const lowest = Math.min(...standings.map((s) => s.overall));
    woodenSpoon = { best: lowest, players: standings.filter((s) => s.overall === lowest).map((s) => ({ name: s.displayName })) };
  }

  const highestScoringWeek = buildAward(
    (s) => s.highestWeek?.total,
    (s) => ({ week: s.highestWeek.week })
  );
  const longestWinStreak = buildAward((s) => s.longestStreak);
  const mostWeeksWon = buildAward((s) => s.weeksWon);
  const mostBonusesWon = buildAward((s) => s.bonusesWon);
  const mostTies = buildAward((s) => s.tiedWeeks);

  res.json({
    year: parseInt(year, 10),
    champion,
    woodenSpoon,
    highestScoringWeek,
    longestWinStreak,
    mostWeeksWon,
    mostBonusesWon,
    mostTies,
    standings: standings.map(({ uid, displayName, overall }) => ({ uid, displayName, overall })),
  });
});

// GET /api/leagues/:id/picks/me
router.get("/picks/me", requireAuth, requireLeagueMember, (req, res) => {
  const picks = store.getUserPicks(req.params.id, req.uid);
  const result = {};
  if (picks) {
    for (const [week, data] of picks.entries()) result[week] = data;
  }
  res.json(result);
});

// PUT /api/leagues/:id/picks/:week — autosave
router.put("/picks/:week", requireAuth, requireOpenSeason, requireLeagueMember, async (req, res) => {
  const { id: leagueId, week } = req.params;
  const { picks, bonus } = req.body;

  if (!Array.isArray(picks) || picks.length > 5) {
    return res.status(400).json({ error: "Max 5 picks" });
  }
  if (bonus && !picks.some((p) => p.team === bonus)) {
    return res.status(400).json({ error: "Bonus pick must be one of the selected teams" });
  }
  if (store.getSubmission(leagueId, req.uid)?.submitted) {
    return res.status(403).json({ error: "Picks already submitted for this season" });
  }

  const year = store.getSeasonConfig().year;
  const weekKey = `week${week}`;
  const weekData = { teamsPicked: picks, bonusPick: bonus || null, updatedAt: new Date() };

  await db
    .collection("leagues")
    .doc(leagueId)
    .collection("seasons")
    .doc(String(year))
    .collection("picks")
    .doc(req.uid)
    .collection("weeks")
    .doc(weekKey)
    .set(weekData, { merge: true });

  store.setWeekPicksInMemory(leagueId, req.uid, weekKey, weekData);

  res.json({ ok: true });
});

// POST /api/leagues/:id/picks/submit
router.post("/picks/submit", requireAuth, requireOpenSeason, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const picks = store.getUserPicks(leagueId, req.uid) || new Map();

  const missingWeeks = [];
  const bonusTeams = new Map(); // team -> week, to catch reuse across the season

  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const weekKey = `week${w}`;
    const weekData = picks.get(weekKey);
    if (!weekData || (weekData.teamsPicked || []).length !== 5 || !weekData.bonusPick) {
      missingWeeks.push(w);
      continue;
    }
    if (bonusTeams.has(weekData.bonusPick)) {
      return res.status(400).json({
        error: `Bonus team "${weekData.bonusPick}" is used in both week ${bonusTeams.get(weekData.bonusPick)} and week ${w}`,
      });
    }
    bonusTeams.set(weekData.bonusPick, w);
  }

  if (missingWeeks.length) {
    return res.status(400).json({ error: `Incomplete weeks: ${missingWeeks.join(", ")}` });
  }

  const year = store.getSeasonConfig().year;
  const submissionData = { submitted: true, submittedAt: new Date() };

  await db
    .collection("leagues")
    .doc(leagueId)
    .collection("seasons")
    .doc(String(year))
    .collection("submissions")
    .doc(req.uid)
    .set(submissionData, { merge: true });

  store.setSubmissionInMemory(leagueId, req.uid, submissionData);

  res.json({ ok: true });
});

export default router;
