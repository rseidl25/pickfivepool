import { isSeasonLocked } from "../store.js";

export function requireOpenSeason(req, res, next) {
  // req.params.id is the league id on every route this guards that's
  // actually scoped to one league (picks routes) — undefined on the
  // league create/join routes, which have no per-league override to check
  // anyway since the league doesn't exist yet (or isn't joined yet).
  if (isSeasonLocked(req.params.id)) {
    return res.status(403).json({ error: "Season is locked" });
  }
  next();
}
