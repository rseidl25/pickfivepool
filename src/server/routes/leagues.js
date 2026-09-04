import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "../middleware/auth.js";
import { requireOpenSeason } from "../middleware/seasonLock.js";
import { db } from "../firebaseAdmin.js";
import * as store from "../store.js";
import { makeImageUpload, UPLOADS_ROOT } from "../uploads.js";

const router = Router();

const leaguePhotoUpload = makeImageUpload((req) => path.join(UPLOADS_ROOT, "leagues", req.params.id));

function requireLeagueMember(req, res, next) {
  const league = store.getLeague(req.params.id);
  if (!league || !league.members.has(req.uid)) {
    return res.status(403).json({ error: "Not a member of this league" });
  }
  req.league = league;
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

function generateInviteCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function buildMemberDoc(uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data() || {};
  return {
    joinedAt: new Date(),
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    globalDisplayName: user.displayName ?? null,
    email: user.email ?? null,
  };
}

// GET /api/leagues/mine
router.get("/mine", requireAuth, (req, res) => {
  res.json(store.getLeaguesForUser(req.uid));
});

const MAX_LEAGUES_OWNED = 3;

// POST /api/leagues
router.post("/", requireAuth, requireOpenSeason, async (req, res) => {
  const { name, photoURL } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "League name is required" });
  }
  if (name.trim().length > 30) {
    return res.status(400).json({ error: "League name must be 30 characters or fewer" });
  }

  const ownedCount = store.getLeaguesForUser(req.uid).filter((l) => l.role === "owner").length;
  if (ownedCount >= MAX_LEAGUES_OWNED) {
    return res.status(400).json({ error: `You can only create up to ${MAX_LEAGUES_OWNED} leagues` });
  }

  let inviteCode = generateInviteCode();
  while (store.getLeagueIdByInviteCode(inviteCode)) {
    inviteCode = generateInviteCode();
  }

  const leagueRef = db.collection("leagues").doc();
  const meta = {
    name: name.trim(),
    photoURL: photoURL || null,
    ownerUid: req.uid,
    inviteCode,
    archived: false,
    createdAt: new Date(),
  };
  await leagueRef.set(meta);
  await db.collection("leagueInviteCodes").doc(inviteCode).set({ leagueId: leagueRef.id });

  const memberDoc = await buildMemberDoc(req.uid);
  await leagueRef.collection("members").doc(req.uid).set(memberDoc);

  store.setLeagueInMemory(leagueRef.id, meta);
  store.addMemberInMemory(leagueRef.id, req.uid, memberDoc);

  res.status(201).json({ id: leagueRef.id, name: meta.name, photoURL: meta.photoURL, inviteCode, role: "owner" });
});

// POST /api/leagues/join
router.post("/join", requireAuth, requireOpenSeason, async (req, res) => {
  const { inviteCode } = req.body;
  const leagueId = store.getLeagueIdByInviteCode(inviteCode);
  const league = leagueId ? store.getLeague(leagueId) : null;

  if (!league || league.archived) {
    return res.status(404).json({ error: "Invalid invite code" });
  }
  if (league.members.has(req.uid)) {
    return res.status(400).json({ error: "Already a member of this league" });
  }

  const memberDoc = await buildMemberDoc(req.uid);
  await db.collection("leagues").doc(leagueId).collection("members").doc(req.uid).set(memberDoc);
  store.addMemberInMemory(leagueId, req.uid, memberDoc);

  res.json({ id: leagueId, name: league.name, photoURL: league.photoURL, role: "member" });
});

// GET /api/leagues/:id — full detail (invite code, member list) for any
// current member. Not in the original plan's route list — added once the
// League Select screen's owner-management panel needed it; /mine only ever
// returned bare {id, name, photoURL, role} summaries.
router.get("/:id", requireAuth, requireLeagueMember, (req, res) => {
  const league = req.league;
  res.json({
    id: league.id,
    name: league.name,
    photoURL: league.photoURL,
    ownerUid: league.ownerUid,
    inviteCode: league.inviteCode,
    archived: league.archived,
    members: [...league.members.entries()].map(([uid, m]) => ({
      uid,
      displayName: m.displayName,
      photoURL: m.photoURL,
      joinedAt: m.joinedAt,
      role: uid === league.ownerUid ? "owner" : "member",
      submitted: !!league.submissions.get(uid)?.submitted,
    })),
  });
});

// PATCH /api/leagues/:id — owner-only, league name/photo
router.patch("/:id", requireAuth, requireLeagueOwner, async (req, res) => {
  const { name, photoURL } = req.body;
  if (name === undefined && photoURL === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (typeof name === "string" && name.trim().length > 30) {
    return res.status(400).json({ error: "League name must be 30 characters or fewer" });
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (photoURL !== undefined) updates.photoURL = photoURL;

  await db.collection("leagues").doc(req.params.id).set(updates, { merge: true });
  store.setLeagueInMemory(req.params.id, updates);

  res.json({ ok: true });
});

// POST /api/leagues/:id/photo — owner-only image upload, multipart, field
// name "photo". One photo at a time, not a gallery like profile photos —
// uploading a new one replaces (and deletes on disk) whatever was
// previously uploaded, rather than accumulating.
router.post("/:id/photo", requireAuth, requireLeagueOwner, (req, res, next) => {
  leaguePhotoUpload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No photo uploaded" });
  }

  const leagueId = req.params.id;
  const leagueDir = path.join(UPLOADS_ROOT, "leagues", leagueId);
  const oldPhotoURL = req.league.photoURL;
  if (oldPhotoURL && oldPhotoURL.startsWith(`/uploads/leagues/${leagueId}/`)) {
    fs.unlink(path.join(leagueDir, oldPhotoURL.split("/").pop()), () => {}); // best-effort
  }

  const photoURL = `/uploads/leagues/${leagueId}/${req.file.filename}`;
  await db.collection("leagues").doc(leagueId).set({ photoURL }, { merge: true });
  store.setLeagueInMemory(leagueId, { photoURL });

  res.json({ photoURL });
});

// PATCH /api/leagues/:id/members/me — self-service per-league display name/photo
router.patch("/:id/members/me", requireAuth, requireLeagueMember, async (req, res) => {
  const { displayName, photoURL } = req.body;
  if (displayName === undefined && photoURL === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (typeof displayName === "string" && displayName.trim().length > 30) {
    return res.status(400).json({ error: "Display name must be 30 characters or fewer" });
  }

  const updates = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (photoURL !== undefined) updates.photoURL = photoURL;

  await db
    .collection("leagues")
    .doc(req.params.id)
    .collection("members")
    .doc(req.uid)
    .set(updates, { merge: true });

  store.updateMemberInMemory(req.params.id, req.uid, updates);

  res.json({ ok: true });
});

// POST /api/leagues/:id/leave — self-service member departure
router.post("/:id/leave", requireAuth, requireLeagueMember, async (req, res) => {
  if (req.uid === req.league.ownerUid) {
    return res.status(400).json({ error: "Owner can't leave — transfer ownership first" });
  }

  await db.collection("leagues").doc(req.params.id).collection("members").doc(req.uid).delete();
  store.removeMemberInMemory(req.params.id, req.uid);

  res.json({ ok: true });
});

// DELETE /api/leagues/:id/members/:uid — owner-only kick
router.delete("/:id/members/:uid", requireAuth, requireLeagueOwner, async (req, res) => {
  const { id: leagueId, uid } = req.params;
  if (uid === req.uid) {
    return res.status(400).json({ error: "Owner can't kick themselves — transfer ownership first" });
  }

  await db.collection("leagues").doc(leagueId).collection("members").doc(uid).delete();
  store.removeMemberInMemory(leagueId, uid);

  res.json({ ok: true });
});

// POST /api/leagues/:id/transfer-owner
router.post("/:id/transfer-owner", requireAuth, requireLeagueOwner, async (req, res) => {
  const { newOwnerUid } = req.body;
  const leagueId = req.params.id;

  if (!newOwnerUid || !req.league.members.has(newOwnerUid)) {
    return res.status(400).json({ error: "New owner must already be a member of this league" });
  }

  await db.collection("leagues").doc(leagueId).set({ ownerUid: newOwnerUid }, { merge: true });
  store.transferOwnerInMemory(leagueId, newOwnerUid);

  res.json({ ok: true });
});

// DELETE /api/leagues/:id — owner-only soft-delete
router.delete("/:id", requireAuth, requireLeagueOwner, async (req, res) => {
  const leagueId = req.params.id;
  await db.collection("leagues").doc(leagueId).set({ archived: true }, { merge: true });
  store.archiveLeagueInMemory(leagueId);
  res.json({ ok: true });
});

// POST /api/leagues/:id/picks/import — copy the caller's current-season picks
// from another league they're also a member of, into this one.
router.post("/:id/picks/import", requireAuth, requireOpenSeason, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const { fromLeagueId } = req.body;

  if (!fromLeagueId || fromLeagueId === leagueId) {
    return res.status(400).json({ error: "A different source league is required" });
  }
  const fromLeague = store.getLeague(fromLeagueId);
  if (!fromLeague || !fromLeague.members.has(req.uid)) {
    return res.status(403).json({ error: "Not a member of the source league" });
  }
  if (store.getSubmission(leagueId, req.uid)?.submitted) {
    return res.status(403).json({ error: "Picks already submitted for this season" });
  }
  if (!store.getSubmission(fromLeagueId, req.uid)?.submitted) {
    return res.status(400).json({ error: "Source league picks are not fully submitted" });
  }

  const sourcePicks = store.getUserPicks(fromLeagueId, req.uid);
  if (!sourcePicks || sourcePicks.size === 0) {
    return res.json({ ok: true, weeksImported: 0 });
  }

  const year = String(store.getSeasonConfig().year);
  const batch = db.batch();
  for (const [week, weekData] of sourcePicks.entries()) {
    const ref = db
      .collection("leagues")
      .doc(leagueId)
      .collection("seasons")
      .doc(year)
      .collection("picks")
      .doc(req.uid)
      .collection("weeks")
      .doc(week);
    batch.set(ref, weekData);
  }
  await batch.commit();

  for (const [week, weekData] of sourcePicks.entries()) {
    store.setWeekPicksInMemory(leagueId, req.uid, week, weekData);
  }

  res.json({ ok: true, weeksImported: sourcePicks.size });
});

// GET /api/leagues/:id/posts — flat, newest-first message board feed
router.get("/:id/posts", requireAuth, requireLeagueMember, (req, res) => {
  res.json(store.getRecentPosts(req.params.id));
});

// POST /api/leagues/:id/posts/read — marks the message board caught-up-to
// now for the caller, clearing their unread indicator (see hasUnreadPosts
// in store.js, surfaced per-league on GET /api/leagues/mine).
router.post("/:id/posts/read", requireAuth, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const lastReadAt = new Date();
  await db.collection("leagues").doc(leagueId).collection("messageBoardReads").doc(req.uid).set({ lastReadAt });
  store.setLastReadInMemory(leagueId, req.uid, lastReadAt);
  res.json({ ok: true });
});

// POST /api/leagues/:id/posts — any member can post
router.post("/:id/posts", requireAuth, requireLeagueMember, async (req, res) => {
  const leagueId = req.params.id;
  const { body } = req.body;

  if (!body || typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ error: "Post body is required" });
  }
  if (body.trim().length > 250) {
    return res.status(400).json({ error: "Post must be 250 characters or fewer" });
  }

  const member = req.league.members.get(req.uid);
  const authorName = member?.displayName || member?.globalDisplayName || "Unknown";

  const postRef = db.collection("leagues").doc(leagueId).collection("posts").doc();
  const post = {
    authorUid: req.uid,
    authorName,
    body: body.trim(),
    createdAt: new Date(),
  };
  await postRef.set(post);
  store.addPostInMemory(leagueId, { id: postRef.id, ...post });

  // The poster is trivially caught up on their own post — without this
  // they'd see an unread badge appear for a message they just wrote.
  await db.collection("leagues").doc(leagueId).collection("messageBoardReads").doc(req.uid).set({ lastReadAt: post.createdAt });
  store.setLastReadInMemory(leagueId, req.uid, post.createdAt);

  res.status(201).json({ id: postRef.id, ...post });
});

// DELETE /api/leagues/:id/posts/:postId — owner or the post's own author
router.delete("/:id/posts/:postId", requireAuth, requireLeagueMember, async (req, res) => {
  const { id: leagueId, postId } = req.params;
  const isOwner = req.uid === req.league.ownerUid;

  let authorUid = req.league.recentPosts.find((p) => p.id === postId)?.authorUid;
  if (!authorUid) {
    // Post may be older than the in-memory "recent" cache window — fall back
    // to a direct Firestore read rather than assuming it doesn't exist.
    const postSnap = await db.collection("leagues").doc(leagueId).collection("posts").doc(postId).get();
    if (!postSnap.exists) {
      return res.status(404).json({ error: "Post not found" });
    }
    authorUid = postSnap.data().authorUid;
  }

  if (!isOwner && authorUid !== req.uid) {
    return res.status(403).json({ error: "Only the post's author or the league owner can delete it" });
  }

  await db.collection("leagues").doc(leagueId).collection("posts").doc(postId).delete();
  store.removePostInMemory(leagueId, postId);

  res.json({ ok: true });
});

export default router;
