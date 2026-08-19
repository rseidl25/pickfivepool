import { Router } from "express";
import { getLastUpdated } from "../espn/poller.js";

const router = Router();

// Sent as a plain ISO 8601 timestamp — timezone-neutral on purpose. Each
// client formats it for display in the viewer's own local timezone, since
// players are spread across Pacific/Central/etc. and a server-side fixed
// zone (this used to always render as CST) meant everyone but Central players
// saw the wrong local time.
router.get("/", (req, res) => {
  const lastUpdated = getLastUpdated();
  res.json({ last_updated: lastUpdated ? lastUpdated.toISOString() : null });
});

export default router;
