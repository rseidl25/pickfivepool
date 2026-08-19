# Pick 5 Pool — Full Launch Plan: Multi-league Express + Docker on Raspberry Pi 3

> This is now the single source of truth — `plan_4.0.md`'s roadmap has been fully merged in and its items promoted to in-scope-for-launch (not phased as fast-follows). `plan_4.0.md` is retired. One item has since been descoped from launch — the league announcement email — see `backlog.md`.

## Context

Pick 5 Pool has run on GitHub Pages + GitHub Actions + Firebase Auth for 2+ seasons for a friends' league. Ahead of the upcoming NFL season it's being rebuilt as a self-hosted, multi-league app on a Raspberry Pi 3, with the domain `pickfivepool.com` already live through a working Cloudflare Tunnel (tunnel name `pickfivepool`, `cloudflared.service` + a placeholder `pickfivepool-test.service` both confirmed to survive reboot). Everything envisioned for this relaunch — multi-league support with invite codes, full league-owner management (photo/name, member management, a message board), a per-player weekly dashboard, in-season stats and a permanent Hall of Fame, an automatic season lock, and Docker/GitHub resilience — ships together at launch rather than being staged across multiple releases.

**Decided architecture** (infra-level, unchanged throughout this planning process): Express backend in front of the existing vanilla HTML/CSS/JS frontend; Firestore as the only datastore; Firebase Auth retained for the actual sign-in/sign-up handshake; live scores from ESPN's unofficial JSON scoreboard API, polled server-side with in-memory caching (adaptive: 60s while ≥1 game is `In Progress`, slower idle interval otherwise); exposure via the already-live Cloudflare Tunnel; Docker as a portability/failover safety net, `cloudflared` staying host-level outside the container; new GitHub repo (old one has 9,541 commits, 99.5% `[skip ci]` auto-commit noise). Target scale ~75–100 users across a handful of leagues — comfortably inside Pi 3 (1GB RAM) and Firestore Spark-tier (1GB storage, 50K reads/day, 20K writes/day) as long as Firestore reads stay deliberate (in-memory mirror, not per-request reads).

**Standing decisions**:
- **Leagues persist across years.** A league (name, photo, owner, roster, invite code) is a permanent container; only picks/submission state resets each season.
- **Season lock is fully automatic.** A stored cutoff timestamp replaces the hardcoded `signup_period` constant. This season's cutoff: **2026-09-09 17:00 America/New_York = 2026-09-09T21:00:00Z**. Global, not per-league.
- **Historical stats are computed on demand**, not precomputed/archived as a separate snapshot — removes the need for any season-rollover trigger (see Data Model).
- **The ESPN scraper (`fetch_game_data.js`) is kept**, repurposed as a manual once-a-year schedule-building script — not retired, not part of the live poller.

**New decisions (this pass — promoting `plan_4.0.md`'s previously-deferred items to launch scope)**:
- **League owner actions**: name/photo edit, kick a member, transfer ownership, archive (soft-delete) a league — all in scope. **Not** in scope: multiple co-owners (single `ownerUid` + transfer covers the practical need at this scale), the three settings the roadmap itself flagged with a "?" (roster size, custom scoring, pick deadlines) — those are still genuinely undefined and need actual design input before they can be built — and the announcement email, which is speced but deferred (see `backlog.md`).
- **League message board**: a simple flat, newest-first post feed per league. Any member can post; the owner or the post's author can delete a post. No threading/replies for v1.
- **"Hate watch" win-%**: computed via a lightweight Monte Carlo simulation (see My Week section below) rather than left unscoped.
- **Remote SSH via Cloudflare Access**: folded into the main Pi provisioning phase instead of being a post-launch fast-follow.

**Pi infra status**:
- Hardware confirmed: **Raspberry Pi 3**, boot media moving from microSD to a **256GB portable USB SSD** (ordered, in transit — not yet arrived).
- OS is currently end-of-life Raspbian Stretch (dead apt repos, why Docker's installer failed outright). Reflash to Raspberry Pi OS Lite 64-bit onto the SSD is pending the SSD's arrival.
- After reflash: reinstall `cloudflared` as a native arm64 `.deb`, delete + recreate the `pickfivepool` tunnel, rebuild `config.yml`/DNS route/`cloudflared.service`, install Docker, and set up the Cloudflare Access application for SSH (see Deployment).
- **Not done yet**: no reflash has happened. The Pi is still on the old OS as of this handoff.

### Current codebase inventory (from direct file reads)

**Direct client-side Firebase/Firestore touches being replaced** (all move server-side, league-scoped where relevant):
- `src/js/auth/auth.js` — Firebase **Auth** SDK calls retained as-is (`createUserWithEmailAndPassword`, `signInWithEmailAndPassword`, `signOut`, `onAuthStateChanged`, `updateProfile`). Three direct Firestore calls move to the API: signup's `users/{uid}` doc creation, the `picks_submitted` lock-check, and the final-submit lock-write (the latter two become **per-league** checks, not global).
- `src/js/dashboard/dashboard.js` — direct Firestore `setDoc` for profile settings; `fetch()`s of `scores.json`/`avatars.json`/`last_updated.json`/`games.json` (`dates.json` stays static).
- `src/js/picks/picks_firebase.js` — direct Firestore CRUD against `picks/{uid}/weeks/week{N}` — this path's shape changes (see Data Model).
- `src/js/picks/picks.js` — calls into `picks_firebase.js`; fetches `games.json`/`times.json`/`dates.json`.
- `src/js/auth/firebase_init.js` — public client config, unchanged.

**Backend pipeline**:
- `src/js/util/fetch_game_data.js` — **kept, repurposed**, not retired. Its output already matches `times.json`'s per-game shape (`homeTeam`/`awayTeam`/`weekday`/`gameTime`). Becomes a manual once-a-year script (`npm run build-schedule`) run when the new season's schedule is announced. `cheerio`/`axios` stay as dependencies for this reason.
- `src/js/util/calculate_scores.js` — scoring math ported into `scoring.js`, now invoked per-league.
- `src/js/util/grab_picks.js`, `update_all.js`, `.github/workflows/update-data.yml` — superseded entirely by the always-on server; retired once parity is verified.

## Data Model (Firestore)

```
config/season                          { year: 2026, lockAt: <Timestamp 2026-09-09T21:00:00Z> }
                                        Gates league creation, joining, and picks editing/submission.
                                        Bumping year/lockAt annually is the one manual step required —
                                        a Firestore doc edit, no code/redeploy.

users/{uid}                            { email, displayName, photoURL, createdAt }
                                        Global identity, persists forever.

leagues/{leagueId}                     { name, photoURL, ownerUid, inviteCode, createdAt, archived }
                                        Permanent container. `archived: true` = soft-deleted (hidden
                                        from listings, data untouched — see League Management below).

leagueInviteCodes/{code}               { leagueId }
                                        O(1) join-by-code lookup; the code IS the doc ID (uniqueness
                                        for free).

leagues/{id}/members/{uid}             { joinedAt, displayName, photoURL,
                                          globalDisplayName, email }
                                        Permanent roster. `displayName`/`photoURL` are per-league
                                        identity, pre-filled from the user's global `users/{uid}`
                                        values at join time and independently editable afterward
                                        (self-service, via the member's own edit-profile action within
                                        that league) — lets the same person go by a different
                                        name/photo in different leagues. Rendering anywhere in-league
                                        uses these fields directly, with no fallback needed since
                                        they're always populated at join time. `globalDisplayName`/
                                        `email` are a debug-only snapshot of the account's global
                                        identity at join time — never shown in any league UI, purely
                                        so a document can be identified by a human without
                                        cross-referencing `users/{uid}`; they are not kept in sync
                                        with later global-profile edits, an accepted staleness
                                        tradeoff given their debug-only purpose.

leagues/{id}/posts/{postId}            { authorUid, authorName, body, createdAt }
                                        Message board — flat, newest-first, per league.

leagues/{id}/seasons/{year}/
   picks/{uid}/weeks/week{N}           { teamsPicked, bonusPick, updatedAt }
   submissions/{uid}                   { submitted, submittedAt }
                                        Per-league-per-season submit-lock.

seasons/{year}                         { games: [...] }  (global, NOT under leagues/{id})
                                        Standing archive of that year's games/scores, written by the
                                        poller on every successful poll. Doubles as the live cache's
                                        durability backstop and the permanent historical record — no
                                        separate end-of-season archival step or rollover trigger needed.
```

Games/scores stay **global** (same NFL schedule for everyone); *standings* are league-scoped, computed by running `computeScores()` per league against the shared games data.

**Historical stats / Hall of Fame** are computed on demand: `GET /api/leagues/:id/seasons/:year` runs the same computation as the live season, pointed at `seasons/{year}` (archived games) + that league's `leagues/{id}/seasons/{year}/picks`. This also settles `plan_4.0.md`'s open question of whether Hall of Fame is per-league or global — the route is league-scoped, so it's **per-league**, which fits leagues being persistent, self-contained containers. Display names for this view must resolve correctly **regardless of current membership** — a player's picks from a past season stay in `leagues/{id}/seasons/{year}/picks/{uid}/*` even if they've since left or never (re)joined the league, so this route falls back to the global `users/{uid}.displayName` when no current `leagues/{id}/members/{uid}` doc (and thus no per-league name) exists for that uid.

**Import picks between leagues**: copies `leagues/{fromId}/seasons/{year}/picks/{uid}/weeks/*` into `leagues/{toId}/seasons/{year}/picks/{uid}/weeks/*` for the same uid, same season.

## Target Architecture

```
Browser (public/*.html, existing rendering logic + league switcher, league mgmt UI, My Week, Stats/HoF, message board)
   │ fetch() same-origin: /api/games, /api/last-updated, /api/config/season
   │ authedFetch(): /api/leagues/*, /api/profile
   ▼
Express app (Docker container, Pi 3)
   ├─ express.static — public/ + src/ (css, js, logos, icons, still-static dates.json/times.json)
   ├─ routes/*.js — endpoints below
   ├─ middleware/auth.js — verifies Firebase ID token, attaches req.uid
   ├─ middleware/seasonLock.js — reads config/season, rejects league-create/join/picks-write once locked
   ├─ store.js — in-memory mirror keyed by league: Map<leagueId, {meta, members, seasonPicks,
   │             submissions, recentPosts}>, hydrated at boot, write-through on every API write,
   │             rare periodic resync. Firestore reads happen at boot + resync, not per request.
   ├─ scoring.js — computeScores(leaguePicksMap, gamesData), per league
   ├─ winProbability.js — Monte Carlo "chance to win the week" simulation (see My Week)
   └─ espn/poller.js — global adaptive-interval ESPN JSON poller + disk write-through + seasons/{year} archive
   │
   ▼
Firestore (schema above)
```

Host-level (unchanged): `cloudflared` stays its own systemd service, ingress repointed at the container's port; no separate reverse proxy needed.

## API Design

**Public, no auth:**
- `GET /api/games`, `GET /api/last-updated`, `GET /api/config/season` — `{year, lockAt, locked}`.

**Auth-required (Firebase ID token), league-scoped by `:leagueId` unless noted:**

*League lifecycle & membership*
- `GET /api/leagues/mine` — leagues (id, name, photo, role) the caller belongs to.
- `POST /api/leagues` — create (name, photo); generates a unique 6-digit code, auto-joins creator as owner. Rejected if season locked.
- `POST /api/leagues/join` — `{inviteCode}`. Rejected if locked.
- `PATCH /api/leagues/:id` — owner-only: name/photo.
- `POST /api/leagues/:id/leave` — self-service member departure.
- `PATCH /api/leagues/:id/members/me` — self-service: edit the caller's own per-league `displayName`/`photoURL` (see Data Model — distinct from `PATCH /api/leagues/:id`, which edits the league's own name/photo, owner-only).
- `DELETE /api/leagues/:id/members/:uid` — owner-only: kick a member.
- `POST /api/leagues/:id/transfer-owner` — `{newOwnerUid}`, current-owner-only; target must already be a member.
- `DELETE /api/leagues/:id` — owner-only: soft-delete (`archived: true`), no data erased.
- `GET /api/leagues/:id/posts`, `POST /api/leagues/:id/posts`, `DELETE /api/leagues/:id/posts/:postId` — message board (any member posts; owner or the author deletes).
- `POST /api/leagues/:id/picks/import` — `{fromLeagueId}`, copies the caller's current-season picks between two leagues they're both in.

*Picks & standings*
- `GET /api/leagues/:id/scores` — league standings.
- `GET /api/leagues/:id/picks/me`, `PUT /api/leagues/:id/picks/:week`, `POST /api/leagues/:id/picks/submit` — autosave, server-side ≤5-picks + submitted-lock validation, full-season completeness + no-duplicate-bonus check on submit.
- `GET /api/leagues/:id/my-week` — bonus pick, "teams to watch" (other 4 picks), the "hate watch" list (other members' picks that would leapfrog the caller if they win), and **% chance to win the week** (Monte Carlo simulation over that week's not-yet-completed games — uses ESPN's provided win-probability field where the API returns one, falling back to a 50/50 coin-flip per game otherwise; 1,000 trials, tally how often the caller finishes #1, negligible compute cost at this scale).
- `GET /api/leagues/:id/stats` — in-season fun stats (highest week, streaks, win % so far).
- `GET /api/leagues/:id/seasons/:year` — Hall of Fame view for a past season.

*Profile (global, unchanged)*
- `GET /api/profile/me`, `PATCH /api/profile`.

## File-Level Change List

**New (`src/server/`)**:
- `index.js`, `app.js`, `firebaseAdmin.js`, `middleware/auth.js`, `middleware/seasonLock.js` — as previously scoped.
- `store.js` — league-keyed in-memory mirror, now also caching recent message-board posts per league.
- `scoring.js` — `computeScores(leaguePicksMap, gamesData)`.
- `winProbability.js` — Monte Carlo simulation for `my-week`'s win-% figure.
- `espn/poller.js`, `espn/mapGames.js` — adaptive ESPN JSON poller, now also writing `seasons/{year}` on every successful poll.
- `routes/leagues.js` — lifecycle, membership, ownership, archive, posts, import-picks.
- `routes/leaguePicks.js` — picks/scores/my-week/stats/season-history.
- `routes/{games,lastUpdated,profile,config}.js`.

**New (frontend)**:
- `src/js/util/api.js` — `authedFetch()` helper.
- League management UI: create/join forms, owner-only name/photo edit, member list with kick/transfer-ownership actions, archive-league action.
- **Two-tier profile editing**: a global edit-profile menu at the league-select/dashboard screen (edits `users/{uid}` via the existing `/api/profile` routes — display name, photo), plus a separate, per-league edit-profile menu inside each league (edits that league's `members/{uid}` via `PATCH /api/leagues/:id/members/me` — lets the same account go by a different name/photo per league).
- Message board UI: post feed + compose box, delete affordance for the owner/author.
- **"My Week" page**: bonus pick, teams to watch, hate-watch list, win-% figure.
- **League stats / Hall of Fame page**: current-season stats + a past-season picker.

**New (deployment)**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`.

**Modified**:
- `src/js/auth/auth.js` — keep Auth SDK calls; drop the global lock-check (now per-league via `submissions/{uid}`); signup calls `/api/profile`.
- `src/js/dashboard/dashboard.js` — league-switcher dropdown, entry points into league management/message board/My Week/Stats pages, swaps static JSON fetches for league-scoped API calls, settings-modal save via `authedFetch`.
- `src/js/picks/picks.js` — `games.json` → `/api/games`; `times.json`/`dates.json` stay static; picks calls become league-scoped.
- `src/js/picks/picks_firebase.js` — reimplemented against `/api/leagues/:id/picks/*` instead of the Firestore SDK.
- `package.json` — add `express`; keep `axios`/`cheerio` (schedule-builder script) and `firebase-admin`; remove npm `firebase`; add `"start"` and `"build-schedule"` scripts.

**Retired**: `src/js/util/calculate_scores.js`, `grab_picks.js`, `update_all.js`, `src/js/auth/firebase_init_node.js`, `.github/workflows/update-data.yml`, and the generated `src/data/game/games.json` / `src/data/player/{scores,avatars,last_updated,picks}.json` as user-facing files (the poller may reuse `games.json`'s path internally as its own backup, implementation detail only).

## Deployment (Docker + Pi)

- `Dockerfile`: `node:20-bookworm-slim`, arm64-compatible; light enough (no cheerio/axios in the *server's* runtime path, they're only invoked by the manual schedule script) that building directly on the Pi 3 is likely fine, with `docker buildx build --platform linux/arm64` on the dev machine as a fallback.
- `docker-compose.yml`: one `pick5-app` service, `127.0.0.1:3000` only; read-only mount for `serviceAccountKey.json`; a small volume for the poller's disk write-through cache.
- `cloudflared`'s `config.yml` ingress points at `http://localhost:3000`; a **second** ingress rule proxies SSH (`ssh://localhost:22`) behind a Cloudflare Access application (email-based login policy) — this is the promoted remote-SSH item, set up alongside the tunnel itself rather than as a later fast-follow.

**Sequencing**:
1. **App track**: build `src/server/*` (including the newly-promoted message-board/win-% pieces), the frontend surfaces, Docker setup; test locally against the real Firestore project (safe pre-season).
2. **Pi track** (blocked on the SSD): reflash → reinstall `cloudflared` → recreate tunnel (site ingress + SSH ingress + Access policy) → install Docker.
3. **Cutover**: deploy, repoint the tunnel, verify `pickfivepool.com` and SSH-over-Access both work externally, retire the placeholder service and old GitHub Actions workflow.

## Verification

- League lifecycle: create → join via code → kick a member → transfer ownership → archive the league (confirm it disappears from `/api/leagues/mine` but data remains queryable by ID).
- Message board: post, list, delete (as owner and as original author), confirm a non-member/non-author can't delete.
- `config/season` gating: league create/join/picks-submit succeed pre-lock, all rejected server-side post-lock.
- Multi-league picks + import: pick in one league, import into a second, confirm independent correctly-scoped standings.
- `my-week`: with 3+ varied test accounts, confirm the hate-watch list and win-% figure behave sensibly (win-% moves as picks/games change; sums roughly sanely across players sharing a week).
- Historical view: real `seasons/2025` + "The Sunroom" league's migrated 2025 picks already exist in Firestore (see project memory/handoff notes) — confirm `GET /api/leagues/:id/seasons/2025` computes correctly against real data, zero explicit rollover step, and correctly falls back to global `users/{uid}.displayName` for the migrated players who aren't currently members.
- Per-league identity: join a league, confirm the member doc is pre-filled from the global profile; edit the per-league name/photo via `PATCH /api/leagues/:id/members/me`, confirm it only affects that league (a second league's copy of the same account is unaffected); confirm the global edit-profile menu only ever touches `users/{uid}`.
- Schedule builder: `npm run build-schedule` still produces valid `times.json`/`dates.json`.
- ESPN adaptive-poller cadence (60s live / idle otherwise); Firestore read-budget sanity check; Pi smoke test post-cutover including the SSH-over-Access path from an external network.
