import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Neither a stalled fetch() nor a stalled getIdToken() call has a built-in
// timeout — on a flaky mobile connection (seen in the wild right after a
// logout/login cycle) either can hang forever with no error and no visible
// feedback, since await just waits indefinitely. Bounding both closes that
// off: every call either succeeds or fails within this window.
const REQUEST_TIMEOUT_MS = 15000;
const TIMEOUT_MESSAGE = "Request timed out. Check your connection and try again.";

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function fetchWithTimeout(path, opts) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Every authenticated request goes through here — attaches the caller's
// Firebase ID token so the server's requireAuth middleware can verify it.
export async function authedFetch(path, opts = {}) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error("Not signed in");
  }
  const token = await withTimeout(user.getIdToken(), REQUEST_TIMEOUT_MS, TIMEOUT_MESSAGE);
  // FormData (file uploads) needs the browser to set its own multipart
  // Content-Type with the right boundary — setting it ourselves breaks it.
  const isFormData = opts.body instanceof FormData;
  const headers = { ...opts.headers, Authorization: `Bearer ${token}` };
  if (!isFormData) headers["Content-Type"] = "application/json";
  const res = await fetchWithTimeout(path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// Public routes need no token — a thin wrapper just for a consistent
// error-handling shape alongside authedFetch.
export async function publicFetch(path, opts = {}) {
  const res = await fetchWithTimeout(path, opts);
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
