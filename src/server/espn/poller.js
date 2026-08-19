import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../firebaseAdmin.js";
import { mapEspnWeekToGames } from "./mapGames.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "..", "data", "games-cache.json");

const TOTAL_WEEKS = 18;
const SEASON_TYPE = 2; // regular season, matches the old scraper
const LIVE_INTERVAL_MS = 60 * 1000; // 60s while any game is in progress
const IDLE_INTERVAL_MS = 10 * 60 * 1000; // 10min otherwise, matches the old cron cadence

let latestGames = [];
let lastUpdated = null;
let pollTimer = null;

function loadDiskCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeDiskCache(games) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(games, null, 2));
}

async function fetchWeek(year, week) {
  const url = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const { data } = await axios.get(url, {
    params: { year, seasontype: SEASON_TYPE, week },
    timeout: 10000,
  });
  return mapEspnWeekToGames(data, week);
}

async function getSeasonYear() {
  const snap = await db.collection("config").doc("season").get();
  return snap.data()?.year;
}

async function pollOnce() {
  const year = await getSeasonYear();
  const previous = latestGames.length ? latestGames : loadDiskCache();
  const results = [];

  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    try {
      results.push(await fetchWeek(year, week));
    } catch (err) {
      console.error(`[poller] Week ${week} fetch failed, keeping previous data:`, err.message);
      const prevWeek = previous.find((w) => w.week === week);
      results.push(prevWeek || { week, games: [] });
    }
  }

  latestGames = results;
  lastUpdated = new Date();
  writeDiskCache(latestGames);

  await db
    .collection("seasons")
    .doc(String(year))
    .set({ games: latestGames }, { merge: true });

  const anyInProgress = results.some((w) => w.games.some((g) => g.status === "In Progress"));
  return anyInProgress;
}

async function scheduleNextPoll() {
  let anyInProgress = false;
  try {
    anyInProgress = await pollOnce();
  } catch (err) {
    console.error("[poller] Poll cycle failed:", err.message);
  }

  const nextInterval = anyInProgress ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
  console.log(
    `[poller] Poll complete. ${anyInProgress ? "Live game in progress" : "No live games"} — next poll in ${nextInterval / 1000}s.`
  );
  pollTimer = setTimeout(scheduleNextPoll, nextInterval);
}

export function startPoller() {
  latestGames = loadDiskCache();
  scheduleNextPoll();
}

export function stopPoller() {
  clearTimeout(pollTimer);
}

export function getGames() {
  return latestGames;
}

export function getLastUpdated() {
  return lastUpdated;
}
