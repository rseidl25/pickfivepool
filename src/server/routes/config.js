import { Router } from "express";
import { getSeasonConfig, isSeasonLocked } from "../store.js";

const router = Router();

router.get("/season", (req, res) => {
  const season = getSeasonConfig();
  if (!season) {
    return res.status(503).json({ error: "Season config not loaded yet" });
  }
  res.json({
    year: season.year,
    lockAt: new Date(season.lockAt).toISOString(),
    locked: isSeasonLocked(),
  });
});

export default router;
