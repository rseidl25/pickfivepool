import { Router } from "express";
import { getGames } from "../espn/poller.js";
import { scoreDiffToWinProb } from "../winProbability.js";

const router = Router();

// Attaches each undecided game's win probability (the same figure the
// "chance to win the week" simulation uses — market odds pre-kickoff, the
// live score/clock model once in progress) so the frontend can show a
// team's live odds next to its name without duplicating that math
// client-side. Skipped for completed games — the real result already
// speaks for itself there.
function withWinPct(week) {
  return {
    ...week,
    games: week.games.map((game) => {
      if (game.status === "Completed") return game;
      const homeWinPct = Math.round(scoreDiffToWinProb(game) * 100);
      return { ...game, homeWinPct, awayWinPct: 100 - homeWinPct };
    }),
  };
}

router.get("/", (req, res) => {
  res.json(getGames().map(withWinPct));
});

export default router;
