import { isSeasonLocked } from "../store.js";

export function requireOpenSeason(req, res, next) {
  if (isSeasonLocked()) {
    return res.status(403).json({ error: "Season is locked" });
  }
  next();
}
