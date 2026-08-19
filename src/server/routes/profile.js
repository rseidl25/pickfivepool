import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { auth, db } from "../firebaseAdmin.js";

const router = Router();

// GET /api/profile/me
router.get("/me", requireAuth, async (req, res) => {
  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();

  if (snap.exists) {
    return res.json(snap.data());
  }

  // Lazily create the Firestore profile doc for an existing Auth user
  // that predates it (e.g. first API call after a client-side signup).
  const authUser = await auth.getUser(req.uid);
  const profile = {
    uid: req.uid,
    email: authUser.email || null,
    displayName: authUser.displayName || null,
    photoURL: authUser.photoURL || null,
    createdAt: new Date(),
  };
  await ref.set(profile, { merge: true });
  res.json(profile);
});

// PATCH /api/profile
router.patch("/", requireAuth, async (req, res) => {
  const { displayName, photoURL } = req.body;
  if (displayName === undefined && photoURL === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (typeof displayName === "string" && displayName.trim().length > 30) {
    return res.status(400).json({ error: "Display name must be 30 characters or fewer" });
  }

  const update = {};
  if (displayName !== undefined) update.displayName = displayName;
  if (photoURL !== undefined) update.photoURL = photoURL;

  await auth.updateUser(req.uid, update);
  await db.collection("users").doc(req.uid).set({ ...update, updatedAt: new Date() }, { merge: true });

  res.json({ ok: true });
});

export default router;
