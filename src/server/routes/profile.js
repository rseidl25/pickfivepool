import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";
import { auth, db } from "../firebaseAdmin.js";
import * as store from "../store.js";

const router = Router();

// Uploaded profile photos live on local disk (not Firestore/Storage — this
// app is self-hosted on a single Pi, no object storage in the stack) under
// public/uploads/{uid}/, which express.static already serves for free at
// /uploads/{uid}/{filename} with zero extra routing.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, "..", "..", "..", "public", "uploads");
const MAX_PHOTOS = 3;
const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_ROOT, req.uid);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${MIME_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!MIME_EXT[file.mimetype]) return cb(new Error("Only JPEG, PNG, WEBP, or GIF images are allowed"));
    cb(null, true);
  },
});

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

  // Firebase Auth's own photoURL field rejects anything that isn't a real
  // absolute URL (throws auth/invalid-photo-url) — an uploaded photo's path
  // is relative (/uploads/...), which this app now saves as photoURL all
  // the time. Firestore is what every read path in this app actually uses
  // for display, so Auth's copy is just cosmetic — skip mirroring it there
  // rather than 500ing the whole request over a field nothing reads.
  const authUpdate = { ...update };
  if (authUpdate.photoURL !== undefined && !/^https?:\/\//i.test(authUpdate.photoURL || "")) {
    delete authUpdate.photoURL;
  }
  if (Object.keys(authUpdate).length > 0) {
    await auth.updateUser(req.uid, authUpdate);
  }
  await db.collection("users").doc(req.uid).set({ ...update, updatedAt: new Date() }, { merge: true });

  res.json({ ok: true });
});

// GET /api/profile/photos — the caller's uploaded-photo library (max 3)
// plus every other "linked" (pasted-URL) photo they currently have set
// somewhere — any per-league overrides — deduped against the uploads so an
// already-uploaded photo doesn't also show up as "linked".
//
// Their current GLOBAL photo specifically gets auto-saved into a gallery
// slot right here (not just offered) if it's a link and there's room, so
// it can never silently disappear just because they switch to something
// else later — every other linked photo (per-league overrides) still only
// gets saved when they actively pick it in the UI, since auto-saving every
// one of those on load could fill all 3 slots without the user choosing
// anything.
router.get("/photos", requireAuth, async (req, res) => {
  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();
  let uploadedPhotos = snap.data()?.uploadedPhotos || [];
  let uploadedUrls = new Set(uploadedPhotos.map((p) => p.url));

  const currentPhotoURL = snap.data()?.photoURL;
  if (currentPhotoURL && !uploadedUrls.has(currentPhotoURL) && uploadedPhotos.length < MAX_PHOTOS) {
    const photo = { id: crypto.randomUUID(), url: currentPhotoURL, uploadedAt: new Date() };
    uploadedPhotos = [...uploadedPhotos, photo];
    uploadedUrls = new Set(uploadedPhotos.map((p) => p.url));
    await ref.set({ uploadedPhotos }, { merge: true });
  }

  const linkedUrls = new Set(store.getMemberPhotoURLsForUser(req.uid));
  for (const url of uploadedUrls) linkedUrls.delete(url);

  res.json({ uploadedPhotos, linkedPhotos: [...linkedUrls].map((url) => ({ url })) });
});

// POST /api/profile/photos — multipart, field name "photo". Rejects once
// the caller already has MAX_PHOTOS stored; they must delete one first
// (no auto-eviction of the oldest — an explicit choice, not silently made
// for them).
router.post("/photos", requireAuth, (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No photo uploaded" });
  }

  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();
  const existing = snap.data()?.uploadedPhotos || [];

  if (existing.length >= MAX_PHOTOS) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `You can only store ${MAX_PHOTOS} photos — remove one first` });
  }

  const photo = { id: req.file.filename, url: `/uploads/${req.uid}/${req.file.filename}`, uploadedAt: new Date() };
  const uploadedPhotos = [...existing, photo];
  await ref.set({ uploadedPhotos }, { merge: true });

  res.json({ uploadedPhotos });
});

// POST /api/profile/photos/link — save a "linked" (pasted-URL) photo into
// one of the caller's 3 gallery slots, so it stays available after they
// switch to a different active photo instead of just disappearing (the
// linked-photos list in GET /photos only reflects what's *currently*
// active anywhere, not a history). No file to store — just a reference,
// same shape as an uploaded entry except its url isn't a /uploads/ path.
router.post("/photos/link", requireAuth, async (req, res) => {
  const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  if (!url) {
    return res.status(400).json({ error: "A photo URL is required" });
  }

  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();
  const existing = snap.data()?.uploadedPhotos || [];

  if (existing.some((p) => p.url === url)) {
    return res.json({ uploadedPhotos: existing });
  }
  if (existing.length >= MAX_PHOTOS) {
    return res.status(400).json({ error: `You can only store ${MAX_PHOTOS} photos — remove one first` });
  }

  const photo = { id: crypto.randomUUID(), url, uploadedAt: new Date() };
  const uploadedPhotos = [...existing, photo];
  await ref.set({ uploadedPhotos }, { merge: true });

  res.json({ uploadedPhotos });
});

// DELETE /api/profile/photos/:photoId
router.delete("/photos/:photoId", requireAuth, async (req, res) => {
  const { photoId } = req.params;
  const ref = db.collection("users").doc(req.uid);
  const snap = await ref.get();
  const existing = snap.data()?.uploadedPhotos || [];
  const photo = existing.find((p) => p.id === photoId);
  if (!photo) {
    return res.status(404).json({ error: "Photo not found" });
  }

  fs.unlink(path.join(UPLOADS_ROOT, req.uid, photoId), () => {}); // best-effort

  const uploadedPhotos = existing.filter((p) => p.id !== photoId);
  const updates = { uploadedPhotos };

  // Don't leave the global profile pointed at a file that no longer
  // exists — per-league photo overrides aren't touched here, since doing
  // that would mean writing into every league the caller belongs to.
  if (snap.data()?.photoURL === photo.url) {
    updates.photoURL = null;
    await auth.updateUser(req.uid, { photoURL: null }).catch(() => {});
  }

  await ref.set(updates, { merge: true });
  res.json({ uploadedPhotos });
});

export default router;
