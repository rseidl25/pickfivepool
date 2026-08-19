import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Every authenticated request goes through here — attaches the caller's
// Firebase ID token so the server's requireAuth middleware can verify it.
export async function authedFetch(path, opts = {}) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// Public routes need no token — a thin wrapper just for a consistent
// error-handling shape alongside authedFetch.
export async function publicFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// { year, lockAt, locked } — replaces the old hardcoded signup_period flag.
export function getSeasonConfig() {
  return publicFetch("/api/config/season");
}
