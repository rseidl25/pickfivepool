import { Router } from "express";
import { getGames } from "../espn/poller.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(getGames());
});

export default router;
