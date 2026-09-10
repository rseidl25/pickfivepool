import { Router } from "express";
import { hydrateStore, setLeagueLockOverride } from "../store.js";

const router = Router();

function requireAdminKey(req, res) {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// POST /api/admin/resync — on-demand full reload of the in-memory store from
// Firestore. Replaces the old automatic 15-minute resync (removed from
// store.js/index.js), which re-read the entire season's worth of data every
// 15 minutes forever regardless of whether anything had actually changed —
// call this by hand instead, only when it's actually needed (e.g. after a
// manual Firestore edit, or to confirm a change during testing).
router.post("/resync", async (req, res) => {
  if (!requireAdminKey(req, res)) return;
  await hydrateStore();
  res.json({ ok: true, resyncedAt: new Date().toISOString() });
});

// POST /api/admin/leagues/:id/unlock — one-off, time-boxed exception to the
// global season lock for a single league (e.g. a late-joining group that
// still needs a few more hours to get picks in). Body: { until: <ISO 8601> }.
// In-memory only — see store.js's leagueLockOverrides comment.
router.post("/leagues/:id/unlock", (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const until = new Date(req.body?.until);
  if (isNaN(until.getTime())) {
    return res.status(400).json({ error: "body.until must be a valid date/time" });
  }
  setLeagueLockOverride(req.params.id, until.getTime());
  res.json({ ok: true, leagueId: req.params.id, unlockedUntil: until.toISOString() });
});

export default router;
