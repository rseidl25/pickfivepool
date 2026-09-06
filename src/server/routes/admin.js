import { Router } from "express";
import { hydrateStore } from "../store.js";

const router = Router();

// POST /api/admin/resync — on-demand full reload of the in-memory store from
// Firestore. Replaces the old automatic 15-minute resync (removed from
// store.js/index.js), which re-read the entire season's worth of data every
// 15 minutes forever regardless of whether anything had actually changed —
// call this by hand instead, only when it's actually needed (e.g. after a
// manual Firestore edit, or to confirm a change during testing).
router.post("/resync", async (req, res) => {
  const key = req.headers["x-admin-key"];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  await hydrateStore();
  res.json({ ok: true, resyncedAt: new Date().toISOString() });
});

export default router;
