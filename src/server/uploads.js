import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Shared home for anything uploaded through the app (profile photos, league
// photos) — lives on local disk, not Firestore/Storage (self-hosted on a
// single Pi, no object storage in the stack), under public/uploads/, which
// express.static already serves for free with zero extra routing.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.join(__dirname, "..", "..", "public", "uploads");
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
export const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// destinationFn(req) -> absolute directory path to save into, created on
// demand. Each caller decides its own subfolder (per-uid for profile
// photos, per-league-id for league photos).
export function makeImageUpload(destinationFn) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = destinationFn(req);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${MIME_EXT[file.mimetype]}`),
    }),
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: (req, file, cb) => {
      if (!MIME_EXT[file.mimetype]) return cb(new Error("Only JPEG, PNG, WEBP, or GIF images are allowed"));
      cb(null, true);
    },
  });
}
