// Simple in-memory per-user rate limiter — fixed window, resets on restart.
// Good enough for a self-hosted app with a handful of users; not meant to
// survive multiple server instances (same single-process assumption as the
// in-memory store in store.js).
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map(); // uid -> { count, windowStart }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const entry = hits.get(req.uid);

    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(req.uid, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({ error: "Too many requests — please try again later" });
    }

    entry.count++;
    next();
  };
}
