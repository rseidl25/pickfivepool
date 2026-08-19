import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Manual, once-a-year schedule builder — run via `npm run build-schedule`
// once the new season's schedule is announced. Produces the static
// times.json/dates.json the picks/dashboard pages read for game
// times/notes and "what week is it" detection.
//
// Uses the same ESPN JSON scoreboard API the live poller (src/server/espn)
// already relies on, rather than scraping ESPN's HTML site — one less
// fragile dependency (no cheerio needed), and it's the same source already
// proven reliable elsewhere in this app.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "..", "..", "data", "game");

const TOTAL_WEEKS = 18;
const SEASON_TYPE = 2; // regular season
const YEAR = new Date().getFullYear(); // override manually below if building next year's schedule ahead of time

function formatWeekday(isoDate) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(new Date(isoDate));
}

function formatGameTime(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoDate));
}

function formatYYYYMMDD(isoDate) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date(isoDate))
    .replace(/-/g, "");
}

async function fetchWeek(week) {
  const url = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const params = new URLSearchParams({ year: YEAR, seasontype: SEASON_TYPE, week });
  const res = await fetch(`${url}?${params}`);
  if (!res.ok) throw new Error(`ESPN API returned ${res.status} for week ${week}`);
  return res.json();
}

async function buildSchedule() {
  const timesWeeks = [];
  const datesWeeks = [];

  for (let week = 1; week <= TOTAL_WEEKS; week++) {
    console.log(`Fetching week ${week}...`);
    try {
      const data = await fetchWeek(week);
      const events = data.events || [];

      const games = [];
      const dateEntry = { week };

      for (const event of events) {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];
        const home = competitors.find((c) => c.homeAway === "home");
        const away = competitors.find((c) => c.homeAway === "away");
        if (!home || !away) continue;

        const weekday = formatWeekday(event.date);
        games.push({
          homeTeam: home.team.displayName,
          homeScore: 0,
          awayTeam: away.team.displayName,
          awayScore: 0,
          weekday,
          gameTime: formatGameTime(event.date),
          // Raw ISO timestamp alongside the pre-formatted (Eastern-time)
          // string above, so the client can render it in each viewer's own
          // local timezone instead of one fixed zone for everyone.
          gameTimeISO: event.date,
          note: "none",
        });

        const dayKey = weekday.toLowerCase();
        if (!dateEntry[dayKey]) dateEntry[dayKey] = formatYYYYMMDD(event.date);
      }

      timesWeeks.push({ week, games });
      datesWeeks.push(dateEntry);
    } catch (err) {
      console.error(`❌ Week ${week} failed:`, err.message);
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "times.json"), JSON.stringify(timesWeeks, null, 2));
  fs.writeFileSync(path.join(outputDir, "dates.json"), JSON.stringify(datesWeeks, null, 2));
  console.log(`✅ times.json and dates.json written for the ${YEAR} season.`);
}

buildSchedule();
