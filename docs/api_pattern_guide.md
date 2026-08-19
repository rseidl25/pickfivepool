# Pick 5 Pool — API Route Pattern Guide

How to actually build the Express routes described in `plan_3.0.md`. This is a teaching reference, not a spec — the endpoint list, data model, and business rules live in `plan_3.0.md`; this doc is just "here's the shape every route takes."

## The request lifecycle

```
Browser                          Express server                         Firestore
--------                         --------------                         ---------
authedFetch("/api/leagues/:id
  /picks/:week", {method:"PUT",
  body: {...}})
   │
   │ 1. auth.currentUser.getIdToken()
   │ 2. fetch() with
   │    Authorization: Bearer <token>
   ▼
                                  3. requireAuth middleware:
                                     admin.auth().verifyIdToken(token)
                                     → req.uid = "abc123"
                                     ▼
                                  4. requireOpenSeason middleware:
                                     reads config/season from in-memory
                                     store → 403 if locked
                                     ▼
                                  5. requireLeagueMember middleware:
                                     is req.uid in this league's roster
                                     (in-memory store, not a Firestore read)
                                     ▼
                                  6. route handler:
                                     validate body, check business rules,
                                     write ─────────────────────────────▶ leagues/{id}/seasons/
                                     update in-memory store               {year}/picks/{uid}/...
                                     ◀─────────────────────────────────  (write-through)
                                  7. res.json({...})
   ◀───────────────────────────────
```

**Key rule from `plan_3.0.md`**: reads never touch Firestore. Everything a route needs to check (membership, season lock, current picks) comes from the in-memory `store.js` maps, hydrated once at boot. Firestore is only touched on writes (and boot/periodic resync reads). This is what keeps Firestore usage trivially inside the 50K reads/day Spark budget regardless of traffic.

## The four building blocks

**1. Auth middleware** — verifies the token, knows nothing about leagues:

```js
// middleware/auth.js
import { auth } from "../firebaseAdmin.js";

export async function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
```

**2. Season lock middleware** — reads the in-memory config, not Firestore:

```js
// middleware/seasonLock.js
export function requireOpenSeason(req, res, next) {
  const { lockAt } = store.getSeasonConfig(); // in-memory, hydrated at boot
  if (Date.now() >= lockAt) {
    return res.status(403).json({ error: "Season is locked" });
  }
  next();
}
```

**3. A league-specific membership/ownership check** — same shape every time, written per route-group:

```js
// in routes/leaguePicks.js
function requireLeagueMember(req, res, next) {
  const league = store.getLeague(req.params.id);
  if (!league || !league.members.has(req.uid)) {
    return res.status(403).json({ error: "Not a member of this league" });
  }
  req.league = league; // stash it so the handler doesn't look it up again
  next();
}

function requireLeagueOwner(req, res, next) {
  const league = store.getLeague(req.params.id);
  if (!league || league.ownerUid !== req.uid) {
    return res.status(403).json({ error: "Owner only" });
  }
  req.league = league;
  next();
}
```

**4. Client-side helper every frontend call goes through:**

```js
// src/js/util/api.js
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export async function authedFetch(path, opts = {}) {
  const token = await getAuth().currentUser.getIdToken();
  return fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}
```

## Worked example: `PUT /api/leagues/:id/picks/:week`

The autosave endpoint — fires on every pick click, so worth seeing end to end.

```js
// routes/leaguePicks.js
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireOpenSeason } from "../middleware/seasonLock.js";
import { db } from "../firebaseAdmin.js";
import * as store from "../store.js";

const router = Router({ mergeParams: true }); // mergeParams lets it see :id from the parent mount

router.put("/:week", requireAuth, requireOpenSeason, requireLeagueMember, async (req, res) => {
  const { id: leagueId, week } = req.params;
  const { picks, bonus } = req.body;

  // business-rule validation — never trust the client
  if (!Array.isArray(picks) || picks.length > 5) {
    return res.status(400).json({ error: "Max 5 picks" });
  }
  const alreadySubmitted = store.getSubmission(leagueId, req.uid)?.submitted;
  if (alreadySubmitted) {
    return res.status(403).json({ error: "Picks already submitted for this season" });
  }

  const year = store.getSeasonConfig().year;
  const weekData = { teamsPicked: picks, bonusPick: bonus || null, updatedAt: new Date() };

  // write-through: Firestore first (durable), then update the in-memory mirror
  await db
    .collection("leagues").doc(leagueId)
    .collection("seasons").doc(String(year))
    .collection("picks").doc(req.uid)
    .collection("weeks").doc(`week${week}`)
    .set(weekData, { merge: true });

  store.setWeekPicksInMemory(leagueId, req.uid, week, weekData);

  res.json({ ok: true });
});

export default router;
```

Mounted in `app.js`:
```js
app.use("/api/leagues/:id/picks", leaguePicksRouter);
```

Called from the frontend (`picks_firebase.js`'s `autosaveUserPicks`, per `plan_3.0.md`):
```js
export async function autosaveUserPicks(week, state) {
  await authedFetch(`/api/leagues/${currentLeagueId}/picks/${week}`, {
    method: "PUT",
    body: JSON.stringify({ picks: state.picks, bonus: state.bonus }),
  });
}
```

## Owner-only example: `DELETE /api/leagues/:id/members/:uid` (kick)

Shows the `requireLeagueOwner` variant instead of `requireLeagueMember`:

```js
router.delete("/members/:uid", requireAuth, requireLeagueOwner, async (req, res) => {
  const { id: leagueId, uid } = req.params;
  if (uid === req.uid) {
    return res.status(400).json({ error: "Owner can't kick themselves — transfer ownership first" });
  }
  await db.collection("leagues").doc(leagueId).collection("members").doc(uid).delete();
  store.removeMemberInMemory(leagueId, uid);
  res.json({ ok: true });
});
```

Same four pieces every time: auth → season-lock (only where the rule applies, e.g. not needed for reads) → membership/ownership check (only where relevant) → validate + write-through. Every route in `plan_3.0.md`'s API list is a variation of this.

## Testing a route before the frontend exists

Grab a real ID token from the browser console while logged into the live site (`await firebase.auth().currentUser.getIdToken()`, or `auth.currentUser.getIdToken()` depending on how it's exposed), then hit the route directly:

```bash
TOKEN="paste the token here"
curl -X PUT http://localhost:3000/api/leagues/abc123/picks/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"picks":[{"team":"Kansas City Chiefs","matchup":"week1_game0"}],"bonus":"Kansas City Chiefs"}'
```

This is exactly how `execution_plan.md`'s Phase 3/3b checkpoints are meant to be verified — via curl, before any frontend code exists to call them.
