import express from "express";
// Must be imported before any router is created — it patches Express's
// Router so a rejected promise inside an async handler reaches the error
// middleware below, instead of just hanging the request forever (Express 4
// doesn't do this on its own).
import "express-async-errors";
import path from "path";
import { fileURLToPath } from "url";
import profileRouter from "./routes/profile.js";
import gamesRouter from "./routes/games.js";
import lastUpdatedRouter from "./routes/lastUpdated.js";
import configRouter from "./routes/config.js";
import leaguesRouter from "./routes/leagues.js";
import leaguePicksRouter from "./routes/leaguePicks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

const app = express();

app.use(express.json());

app.use(express.static(path.join(root, "public")));
// Only the frontend-facing subfolders of src/ are served — src/server/ (this
// backend's own source) is deliberately excluded from static serving.
app.use("/src/css", express.static(path.join(root, "src", "css")));
app.use("/src/js", express.static(path.join(root, "src", "js")));
app.use("/src/data", express.static(path.join(root, "src", "data")));

app.use("/api/profile", profileRouter);
app.use("/api/games", gamesRouter);
app.use("/api/last-updated", lastUpdatedRouter);
app.use("/api/config", configRouter);
// Order matters: leaguesRouter's specific routes (create/join/:id/leave/etc.)
// are tried first; anything unmatched (scores/stats/seasons/picks/*) falls
// through to leaguePicksRouter, which mergeParams the same :id.
app.use("/api/leagues", leaguesRouter);
app.use("/api/leagues/:id", leaguePicksRouter);

// Final safety net — no route handler does its own try/catch, so this is
// what stands between an unexpected error (a bad Firestore write, a null
// deref) and either a hung request or, with NODE_ENV unset (the default),
// Express's built-in handler leaking a full stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
