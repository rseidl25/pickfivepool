import { db } from "./firebaseAdmin.js";

// In-memory mirror, hydrated at boot + rare periodic resync. Routes read from
// here, never from Firestore directly — Firestore is only touched on writes
// (write-through: Firestore first, then update this mirror) and at
// hydration/resync time. See docs/plan_3.0.md + docs/api_pattern_guide.md.

let seasonConfig = null; // { year, lockAt: <ms epoch> }
const leagues = new Map(); // leagueId -> league record (shape below)
const inviteCodeIndex = new Map(); // inviteCode -> leagueId

const RECENT_POSTS_CAP = 50; // message board is a bounded "recent" cache, not full history

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return new Date(value).getTime();
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  return new Date(value);
}

function newLeagueRecord(id, meta) {
  return {
    id,
    name: meta.name,
    photoURL: meta.photoURL ?? null,
    ownerUid: meta.ownerUid,
    inviteCode: meta.inviteCode,
    archived: !!meta.archived,
    createdAt: toDate(meta.createdAt),
    members: new Map(), // uid -> { joinedAt, displayName, photoURL, globalDisplayName, email }
    seasonPicks: new Map(), // uid -> Map<week, { teamsPicked, bonusPick, updatedAt }>
    submissions: new Map(), // uid -> { submitted, submittedAt }
    recentPosts: [], // Phase 3b
    lastRead: new Map(), // uid -> Date (message board "read up to" marker)
  };
}

async function hydrateSeasonConfig() {
  const snap = await db.collection("config").doc("season").get();
  const data = snap.data();
  seasonConfig = { year: data.year, lockAt: toMillis(data.lockAt) };
}

async function hydrateLeagueMeta(leagueDoc) {
  const leagueId = leagueDoc.id;
  const record = newLeagueRecord(leagueId, leagueDoc.data());
  leagues.set(leagueId, record);
  if (record.inviteCode) inviteCodeIndex.set(record.inviteCode, leagueId);

  const membersSnap = await db.collection("leagues").doc(leagueId).collection("members").get();
  membersSnap.forEach((doc) => {
    const d = doc.data();
    record.members.set(doc.id, {
      joinedAt: toDate(d.joinedAt),
      displayName: d.displayName ?? null,
      photoURL: d.photoURL ?? null,
      globalDisplayName: d.globalDisplayName ?? null,
      email: d.email ?? null,
    });
  });

  const year = String(seasonConfig.year);
  const submissionsSnap = await db
    .collection("leagues")
    .doc(leagueId)
    .collection("seasons")
    .doc(year)
    .collection("submissions")
    .get();
  submissionsSnap.forEach((doc) => {
    const d = doc.data();
    record.submissions.set(doc.id, {
      submitted: !!d.submitted,
      submittedAt: toDate(d.submittedAt),
    });
  });

  const postsSnap = await db
    .collection("leagues")
    .doc(leagueId)
    .collection("posts")
    .orderBy("createdAt", "desc")
    .limit(RECENT_POSTS_CAP)
    .get();
  record.recentPosts = postsSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      authorUid: d.authorUid,
      authorName: d.authorName,
      body: d.body,
      createdAt: toDate(d.createdAt),
    };
  });

  const lastReadSnap = await db.collection("leagues").doc(leagueId).collection("messageBoardReads").get();
  lastReadSnap.forEach((doc) => {
    record.lastRead.set(doc.id, toDate(doc.data().lastReadAt));
  });
}

// Picks are written only at picks/{uid}/weeks/{weekId} — the {uid} parent
// doc is never itself .set(), which Firestore allows (subcollections don't
// require an explicit parent). That means .collection("picks").get() would
// silently return nothing. A collectionGroup("weeks") scan, filtered to the
// current season's path shape, is the only reliable way to enumerate them —
// done once for the whole store rather than per-league to avoid redundant
// full scans.
async function hydrateAllLeaguePicks() {
  const year = String(seasonConfig.year);
  const weeksSnap = await db.collectionGroup("weeks").get();

  for (const weekDoc of weeksSnap.docs) {
    const segments = weekDoc.ref.path.split("/");
    // leagues/{leagueId}/seasons/{year}/picks/{uid}/weeks/{weekId}
    if (
      segments.length !== 8 ||
      segments[0] !== "leagues" ||
      segments[2] !== "seasons" ||
      segments[3] !== year ||
      segments[4] !== "picks" ||
      segments[6] !== "weeks"
    ) {
      continue;
    }

    const league = leagues.get(segments[1]);
    if (!league) continue;
    const uid = segments[5];
    const weekId = segments[7];

    const d = weekDoc.data();
    if (!league.seasonPicks.has(uid)) league.seasonPicks.set(uid, new Map());
    league.seasonPicks.get(uid).set(weekId, {
      teamsPicked: d.teamsPicked || [],
      bonusPick: d.bonusPick ?? null,
      updatedAt: toDate(d.updatedAt),
    });
  }
}

export async function hydrateStore() {
  await hydrateSeasonConfig();

  leagues.clear();
  inviteCodeIndex.clear();

  const leaguesSnap = await db.collection("leagues").get();
  for (const leagueDoc of leaguesSnap.docs) {
    await hydrateLeagueMeta(leagueDoc);
  }

  await hydrateAllLeaguePicks();
}

export function startPeriodicResync(intervalMs = 15 * 60 * 1000) {
  setInterval(() => {
    hydrateStore().catch((err) => console.error("[store] Resync failed:", err.message));
  }, intervalMs);
}

// ---- Season config ----

export function getSeasonConfig() {
  return seasonConfig;
}

export function isSeasonLocked() {
  return Date.now() >= seasonConfig.lockAt;
}

// ---- Leagues ----

export function getLeague(leagueId) {
  return leagues.get(leagueId);
}

export function getLeaguesForUser(uid) {
  const result = [];
  for (const league of leagues.values()) {
    if (league.archived) continue;
    const member = league.members.get(uid);
    if (!member) continue;
    result.push({
      id: league.id,
      name: league.name,
      photoURL: league.photoURL,
      role: league.ownerUid === uid ? "owner" : "member",
      submitted: league.submissions.get(uid)?.submitted || false,
      hasUnread: hasUnreadPosts(league.id, uid),
    });
  }
  return result;
}

// Every per-league photo override the user currently has set, across every
// league they're in — used to surface "photos you're already using
// somewhere" as quick-pick options in the profile photo picker.
export function getMemberPhotoURLsForUser(uid) {
  const urls = [];
  for (const league of leagues.values()) {
    if (league.archived) continue;
    const photoURL = league.members.get(uid)?.photoURL;
    if (photoURL) urls.push(photoURL);
  }
  return urls;
}

export function getLeagueIdByInviteCode(code) {
  return inviteCodeIndex.get(code);
}

export function setLeagueInMemory(leagueId, meta) {
  const existing = leagues.get(leagueId);
  const record = existing || newLeagueRecord(leagueId, meta);
  record.name = meta.name ?? record.name;
  record.photoURL = meta.photoURL !== undefined ? meta.photoURL : record.photoURL;
  record.ownerUid = meta.ownerUid ?? record.ownerUid;
  record.inviteCode = meta.inviteCode ?? record.inviteCode;
  record.archived = meta.archived !== undefined ? !!meta.archived : record.archived;
  record.createdAt = meta.createdAt ? toDate(meta.createdAt) : record.createdAt;
  leagues.set(leagueId, record);
  if (record.inviteCode) inviteCodeIndex.set(record.inviteCode, leagueId);
  return record;
}

export function archiveLeagueInMemory(leagueId) {
  const league = leagues.get(leagueId);
  if (league) league.archived = true;
}

export function transferOwnerInMemory(leagueId, newOwnerUid) {
  const league = leagues.get(leagueId);
  if (league) league.ownerUid = newOwnerUid;
}

// ---- Members ----

export function addMemberInMemory(leagueId, uid, memberData) {
  const league = leagues.get(leagueId);
  if (!league) return;
  league.members.set(uid, {
    joinedAt: memberData.joinedAt ? toDate(memberData.joinedAt) : new Date(),
    displayName: memberData.displayName ?? null,
    photoURL: memberData.photoURL ?? null,
    globalDisplayName: memberData.globalDisplayName ?? null,
    email: memberData.email ?? null,
  });
}

export function updateMemberInMemory(leagueId, uid, partial) {
  const league = leagues.get(leagueId);
  if (!league) return;
  const existing = league.members.get(uid);
  if (!existing) return;
  league.members.set(uid, { ...existing, ...partial });
}

export function removeMemberInMemory(leagueId, uid) {
  const league = leagues.get(leagueId);
  if (league) league.members.delete(uid);
}

// ---- Picks & submissions (current season only — historical seasons are read
// directly from Firestore on demand, not mirrored here) ----

export function getWeekPicks(leagueId, uid, week) {
  return leagues.get(leagueId)?.seasonPicks.get(uid)?.get(String(week));
}

export function getUserPicks(leagueId, uid) {
  return leagues.get(leagueId)?.seasonPicks.get(uid);
}

export function setWeekPicksInMemory(leagueId, uid, week, weekData) {
  const league = leagues.get(leagueId);
  if (!league) return;
  if (!league.seasonPicks.has(uid)) league.seasonPicks.set(uid, new Map());
  league.seasonPicks.get(uid).set(String(week), weekData);
}

export function getSubmission(leagueId, uid) {
  return leagues.get(leagueId)?.submissions.get(uid);
}

export function setSubmissionInMemory(leagueId, uid, submissionData) {
  const league = leagues.get(leagueId);
  if (!league) return;
  league.submissions.set(uid, submissionData);
}

// ---- Message board (bounded "recent" cache — see RECENT_POSTS_CAP) ----

export function getRecentPosts(leagueId) {
  return leagues.get(leagueId)?.recentPosts || [];
}

export function addPostInMemory(leagueId, post) {
  const league = leagues.get(leagueId);
  if (!league) return;
  league.recentPosts.unshift(post); // newest-first
  if (league.recentPosts.length > RECENT_POSTS_CAP) {
    league.recentPosts.length = RECENT_POSTS_CAP;
  }
}

export function removePostInMemory(leagueId, postId) {
  const league = leagues.get(leagueId);
  if (!league) return;
  league.recentPosts = league.recentPosts.filter((p) => p.id !== postId);
}

// True if the newest post is newer than this member's last-read marker
// (never having read at all counts as unread the moment any post exists).
export function hasUnreadPosts(leagueId, uid) {
  const league = leagues.get(leagueId);
  if (!league || league.recentPosts.length === 0) return false;
  const lastRead = league.lastRead.get(uid);
  if (!lastRead) return true;
  return league.recentPosts[0].createdAt > lastRead;
}

export function setLastReadInMemory(leagueId, uid, date) {
  const league = leagues.get(leagueId);
  if (!league) return;
  league.lastRead.set(uid, date);
}
