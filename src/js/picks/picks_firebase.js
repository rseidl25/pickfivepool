import { authedFetch } from "../util/api.js";

/**
 * Load all of the caller's picks for a league's current season.
 * Returns { week1: { teamsPicked, bonusPick, updatedAt }, week2: {...}, ... }
 */
export async function getMyPicks(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}/picks/me`);
}

/**
 * Autosave a single week — fires on every pick click.
 * state = { picks: [{ team, matchup }], bonus }
 */
export async function autosaveWeekPicks(leagueId, week, state) {
  try {
    await authedFetch(`/api/leagues/${leagueId}/picks/${week}`, {
      method: "PUT",
      body: JSON.stringify({ picks: state.picks, bonus: state.bonus || null }),
    });
  } catch (err) {
    console.error(`❌ Autosave error for week ${week}:`, err.message);
  }
}

/**
 * Final submit — server validates full-season completeness and
 * no-duplicate-bonus, then locks picks for the season.
 */
export async function submitPicks(leagueId) {
  return authedFetch(`/api/leagues/${leagueId}/picks/submit`, { method: "POST" });
}
