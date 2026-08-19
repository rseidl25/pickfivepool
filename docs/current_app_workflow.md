# Pick 5 Pool — Current App Workflow (as-built, pre-migration)

Documents how the app actually behaves today, end to end, based on the code in `pick5/public` and `pick5/src`. This is a reference for the Express/Docker migration (`plan_3.0.md`), not a plan for changes — a few real inconsistencies in the current behavior are called out explicitly (marked **⚠️**) since they're relevant to what the migration needs to fix or preserve.

## 1. The season-gate flag

Almost everything below is controlled by one hardcoded constant:

```js
// src/js/auth/auth.js
export const signup_period = false;
```

- `true` (preseason) → signups are open, the Picks page is editable.
- `false` (season underway) → the Sign Up button on the homepage is disabled ("Sign Up Closed"), and the Picks page redirects everyone to the dashboard regardless of login state.

There's no admin UI for this — it's flipped by editing the source and redeploying. It's the mechanism that both opens the signup window *and* locks the whole league out of pick editing once the season starts.

## 2. Account creation (Sign Up)

1. `index.html` → "Sign Up" button, enabled only if `signup_period === true`.
2. `signup.html` form: display name, email, password, confirm password. An inline auth-guard script redirects away if `signup_period` is false, or straight to the dashboard if the visitor is already logged in.
3. On submit (`auth.js`):
   - `createUserWithEmailAndPassword(auth, email, password)` — creates the Firebase Auth identity.
   - `updateProfile(user, { displayName })` — sets the display name on the Auth record.
   - `setDoc(doc(db, "users", uid), { uid, email, displayName, picks_submitted: false, createdAt: serverTimestamp() }, { merge: true })` — creates the matching Firestore profile doc. **This is a direct client→Firestore write**, not an API call.
   - Redirects to `dashboard.html`. `auth/email-already-in-use` redirects to `login.html` instead.

## 3. Authentication & session

- Firebase Auth (client SDK) handles the actual credential check (`signInWithEmailAndPassword` in `login.html`'s flow) and persists the session in the browser (localStorage) across reloads — no custom session/cookie logic anywhere in this app.
- `onAuthStateChanged` listeners re-run on every page load to re-derive UI state from whatever Firebase Auth already knows. There are **three independent listeners**, not one shared one:
  - `auth.js`'s own listener — runs on `login.html`, `signup.html`, and `picks.html` (wherever `auth.js` is script-tagged). On login it does a Firestore `getDoc` on `users/{uid}` and, only if `signup_period && picks_submitted`, force-signs-out and redirects home. **⚠️** Once the season starts (`signup_period = false`) this specific lock never fires — during the season a submitted user can log back in without being redirected by this check (the actual season lock is the `picks.html` guard below, not this one).
  - `dashboard.js`'s own listener — wires the header (name / Guest, Login/Settings/Logout buttons); `dashboard.html` does **not** load `auth.js` at all, so none of `auth.js`'s Firestore lock-check logic runs on the dashboard.
  - `picks.js`'s own listener — separately drives `loadGameData()`/picks rendering.
  - `picks.html` also has its own inline "Auth Guard" script (independent of all three above): redirects to `dashboard.html` if `!signup_period`, or to `login.html` if nobody's signed in.
- **⚠️** `auth.js` also contains `if (typeof loadProgress === "function") await loadProgress(user.uid)` — but `loadProgress` is a module-scoped function inside `picks.js`, a separate ES module, so it's never actually visible to `auth.js`. This branch is dead code; picks-loading is actually driven entirely by `picks.js`'s own `onAuthStateChanged` handler.
- Logout (`signOut(auth)`) clears the Firebase session and reloads/redirects; no server-side session to invalidate.

## 4. Making picks (`picks.html`)

- 18 week buttons, color-coded via `getWeekStatus()`:
  - grey — no picks yet this week
  - yellow — incomplete (fewer than 5 picks, or no bonus chosen)
  - green — complete (5 picks + 1 bonus)
  - red — bonus team is a duplicate of a bonus already used in another week
- Each week shows that week's matchups (from `games.json`, grouped by day); clicking a team toggles it as a pick. Max 5 picks/week (6th click is rejected with an alert); clicking an already-picked team removes it; picking a different team in the same matchup swaps the pick.
- The sidebar "Your Picks" list shows the current week's selections; clicking one of them sets it as that week's **Bonus Pick**. Scoring: a correct normal pick = 10 points; a correct bonus pick = 10 + that team's actual final score (so the bonus pick's payoff scales with how much the team wins by). Bonus teams must be unique across all 18 weeks — reusing one flags both weeks red.
- A "Bonus Tracker" panel lists all 18 weeks' bonus picks side by side with a duplicate-bonus warning icon.
- **Autosave**: every click that changes `weekStatuses` calls `autosaveUserPicks(currentWeek, ...)`, which does a **direct Firestore `setDoc`** to `picks/{uid}/weeks/week{N}` — no debounce, fires on every single click, silently (no toast/confirmation).
- **Guest mode**: if nobody's logged in, the same picks flow works entirely against `localStorage` (`pick5_progress` key, scoped to `"guest"`) — no server/Firestore write at all, and it doesn't survive switching browsers or devices.
- On load, picks are loaded Firestore-first (`loadUserPicksFromFirestore`), falling back to `localStorage` if Firestore has nothing yet; whichever source wins, `localStorage` is kept as a shadow copy either way.
- **Submit**: the header "Next" button only enables once `updateSubmitButton()` confirms *all 18 weeks* have 5 picks + a bonus and there are no duplicate bonus teams anywhere in the season — this button click just shows a read-only summary screen, it doesn't submit yet.
- **Final submit** (`finalSubmitBtn`, defined in `auth.js` even though the rest of the picks flow lives in `picks.js`/`picks_firebase.js`): re-saves all complete weeks via `saveAllUserPicks()`, shows a native `confirm()` warning that the choice is irreversible for the season, sets `picks_submitted: true` on the Firestore user doc, signs the user out, and redirects to `index.html`.
- **⚠️** The actual "you can't edit picks anymore" enforcement isn't really `picks_submitted` — it's the global `signup_period` flag. Once the season starts, `picks.html`'s auth guard redirects *everyone* away regardless of whether they personally submitted, so the per-user `picks_submitted` flag currently only gates the narrow preseason-relogin case described in §3, not in-season editing.

## 5. Monitoring picks & scores (`dashboard.html`)

- The dashboard is open to guests and logged-in users alike — no auth guard on this page.
- On load it fetches four static files: `scores.json`, `avatars.json`, `last_updated.json`, `dates.json`, and merges avatar `displayName`/`photoURL` onto the scores data (Firestore-derived avatar info wins over whatever name is baked into `scores.json`).
- **Leaderboard tab**: overall or per-week ranking. It re-fetches `games.json` on every render and *re-derives* win/loss live from each game's current `status`/scores rather than trusting `scores.json`'s stored point values outright — so a game that finished after the last backend refresh still shows correctly, it just uses the live game data client-side to correct the stored totals. Ties score 0. Ranks share position on ties, sorted by score then name.
- **Picks tab**: week selector, player filter, team filter (with an "X/Y player(s)" counter for who picked a given team), and a toggle to reveal that week's matchup results alongside the picks grid. Each player's card shows their 5 picks (bonus first), color-coded green/red/black by outcome, with a live corrected point total; the current logged-in user's own card gets a gold border.
- "Last Updated" in the header comes straight from `last_updated.json` — the only visible signal of data freshness.
- **⚠️ Real gap**: picks made on `picks.html` write straight to Firestore, but the dashboard never reads Firestore picks directly — it only reads `picks.json`/`scores.json`, which are static files regenerated by the backend job (§6). And that job's `grab_picks.js` step (which would refresh `picks.json` from Firestore) is **not actually wired into `update_all.js`** — so today, a pick made in the app doesn't reliably show up on the dashboard until someone manually runs `npm run grab-picks`. This is the most concrete functional gap in the current system.

## 6. Settings (profile)

- Gear icon → modal: change display name and/or paste an avatar image URL (no upload — URL only), or reset to the default avatar.
- On save, two writes happen separately and must both succeed to stay in sync: `updateProfile()` on the Firebase Auth record, and a Firestore `setDoc` merge on `users/{uid}`.
- The confirmation alert says changes take effect "on next site update (about every 15 minutes)." **⚠️** The actual GitHub Actions cron runs every 10 minutes, not 15 — the copy is just slightly stale/inaccurate, not a functional bug.

## 7. Backend data refresh (what actually powers the dashboard)

`.github/workflows/update-data.yml`, every 10 minutes via GitHub Actions cron, runs `npm run update-all` → `update_all.js`:

1. `fetch_game_data.js` — scrapes ESPN's HTML scoreboard page (cheerio) for all 18 weeks → overwrites `src/data/game/games.json`.
2. `calculate_scores.js` — reads `picks.json` (see the §5 gap — this file itself may be stale) + the freshly-scraped `games.json` → writes `src/data/player/scores.json` and `src/data/player/last_updated.json`.
3. An inline step in `update_all.js` reads every doc in Firestore's `users` collection (via `firebase-admin`, needs `serviceAccountKey.json`/`FIREBASE_SERVICE_ACCOUNT`) → writes `src/data/player/avatars.json`.
4. The workflow commits and force-pushes all four changed JSON files back into the repo with `[skip ci]` — git itself is the "database" for this generated data, and (presumably) whatever serves the site rebuilds from that push.

`grab_picks.js` (Firestore → `picks.json`) exists in the same folder but, as noted in §5, is never called by `update_all.js` — it has to be run manually.

## 8. Data model (Firestore)

- `users/{uid}` — `{ uid, email, displayName, photoURL, picks_submitted, createdAt }`.
- `picks/{uid}/weeks/week{N}` — `{ userId, week, teamsPicked: [{ team, matchup }], bonusPick, updatedAt }`.
- Firebase Auth holds the credential/identity separately; `displayName`/`photoURL` are duplicated onto the Auth user record via `updateProfile()` in addition to living in the Firestore doc.

## 9. Scoring rules

- Correct normal pick: **10 points**.
- Correct bonus pick: **10 + the picked team's actual final score** (so the bonus is a real risk/reward lever, not just a flat multiplier).
- Incorrect pick, or a tied game: **0 points**.
- Games not yet `"Completed"` keep showing the stored/projected point value until they finish — both the backend (`calculate_scores.js`) and the dashboard's live client-side correction apply this same rule independently.
